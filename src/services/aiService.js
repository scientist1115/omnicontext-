import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-search-api';

async function callModel(messages, maxTokens = 2000) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API 오류: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const SIM_DOMAIN_GUIDE = `사용 가능한 시뮬레이션 도메인 (셋 중 하나만 선택, 해당 없으면 null):

1. thermal_1d (1D 비정상 열전도)
   params: { length_m, n_nodes, thermal_diffusivity_m2s, initial_temp_c,
             left_bc: {type:"fixed"|"insulated", value?}, right_bc: {...}, duration_s }

2. electrical_dc (저항망 DC 회로)
   params: { nodes: ["A","B","gnd",...], ground_node, 
             resistors: [{from,to,ohm}], voltage_source: {positive,negative,volts} }

3. mechanical_beam (보 처짐)
   params: { length_m, elastic_modulus_pa, moment_of_inertia_m4,
             support_type: "cantilever"|"simply_supported",
             load_type: "point"|"distributed",
             load_n?, load_position_m?, load_n_per_m? }

이 세 도메인은 모두 단순화된 1D/2D 이상화 모델입니다 (진짜 3D CFD/FEA가 아님).
논문 내용이 이 중 하나로 대략이라도 환원 가능하면 시도하고, 완전히 무관하면(예: 소프트웨어 알고리즘 논문, 생물학 논문 등) simulatable: false로 답하세요.`;

/**
 * 새 논문이 위 세 시뮬레이션 도메인 중 하나로 검증 가능한지 판단하고,
 * 가능하면 시뮬레이터에 넣을 파라미터를 추출합니다.
 * @returns {Promise<{simulatable: boolean, domain?: string, params?: object, reasoning: string}>}
 */
export async function extractSimulationSpec(topicName, source) {
  const prompt = `당신은 공학 논문의 핵심 주장을 단순화된 물리 시뮬레이션으로 검증할 수 있는지 판단하는 역할입니다.

${SIM_DOMAIN_GUIDE}

주제: ${topicName}
논문 제목: ${source.title}
논문 요약: ${source.summary}

이 논문의 핵심 주장(수치, 현상)을 위 세 도메인 중 하나로 대략 재현해서 "이론적으로 말이 되는지" 확인하고 싶습니다.
가능한 파라미터는 논문에 나온 값을 최대한 쓰고, 없으면 그 분야에서 합리적인 전형적인 값으로 추정하세요.

반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"simulatable": true/false, "domain": "thermal_1d 등 또는 null", "params": {...} 또는 null, "reasoning": "판단 이유 한 문장"}`;

  const result = await callModel([{ role: 'user', content: prompt }], 800);
  try {
    const cleaned = result.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(cleaned);
  } catch (e) {
    return { simulatable: false, domain: null, params: null, reasoning: 'AI 응답 파싱 실패' };
  }
}

/**
 * 새로 발견된 논문들이 기존 문서와 관련 있는지 판단하고,
 * 관련 있다면 문서를 갱신한 새 버전을 만들어 반환합니다.
 * @param {string} topicName
 * @param {string} currentDoc - 현재 문서 내용
 * @param {Array} newSources - [{title, summary, url, published, simulation?}]
 * @returns {Promise<{updated: boolean, newDoc: string, changeSummary: string}>}
 */
export async function updateDocumentWithSources(topicName, currentDoc, newSources) {
  if (newSources.length === 0) {
    return { updated: false, newDoc: currentDoc, changeSummary: '새로운 자료 없음' };
  }

  const sourcesText = newSources
    .map((s, i) => {
      let simText = '';
      if (s.simulation) {
        if (s.simulation.simulatable) {
          simText = `\n시뮬레이션 검증(${s.simulation.domain}): ${JSON.stringify(s.simulation.result)}\n검증 판단 근거: ${s.simulation.reasoning}`;
        } else {
          simText = `\n시뮬레이션: 해당 없음 (${s.simulation.reasoning})`;
        }
      }
      return `[${i + 1}] ${s.title}\n요약: ${s.summary}\n링크: ${s.url}${simText}`;
    })
    .join('\n\n');

  const prompt = `당신은 "${topicName}" 주제를 계속 추적하며 문서를 최신 상태로 유지하는 리서치 어시스턴트입니다.
(참고: 시뮬레이션 검증은 단순화된 1D/2D 이상화 모델 기준이며 실제 3D CFD/FEA 수준의 정밀도는 아닙니다)

현재 문서:
"""
${currentDoc || '(아직 문서 내용 없음)'}
"""

새로 발견된 자료:
"""
${sourcesText}
"""

작업 지침:
1. 새 자료가 기존 문서 내용과 관련이 있고, 문서에 새로운 통찰/데이터/최신 동향을 추가할 가치가 있는지 판단하세요.
2. 관련이 없으면 문서를 그대로 두세요.
3. 관련이 있으면, 문서에 자연스럽게 통합해서 개정된 전체 문서를 작성하세요. 기존 구조와 톤을 유지하면서 새 내용을 적절한 섹션에 추가/보강하세요. 출처는 각주 형태로 [1], [2]처럼 표시하고 문서 맨 아래에 참고자료 목록을 두세요.
4. 시뮬레이션 검증 결과가 있는 자료는 "가설 검증" 소단락을 만들어서: (a) 논문의 핵심 주장을 한 줄로, (b) 단순화 모델로 계산한 결과값, (c) 논문 주장과 비교했을 때 이론적으로 타당해 보이는지에 대한 판단을 적으세요. 시뮬레이션이 "해당 없음"인 자료는 이 단락 없이 내용만 요약하세요.
5. 마지막 줄에는 반드시 "---CHANGE_SUMMARY---" 구분자 뒤에 이번에 무엇을 바꿨는지 한두 문장으로 요약하세요. 변경사항이 없으면 "변경 없음"이라고 쓰세요.

응답은 개정된 전체 문서 내용만 출력하고, 그 뒤에 구분자와 요약을 붙이세요. 다른 설명은 하지 마세요.`;

  const result = await callModel([{ role: 'user', content: prompt }], 4000);

  const [newDoc, changeSummary = '변경 없음'] = result.split('---CHANGE_SUMMARY---').map((s) => s.trim());
  const updated = changeSummary !== '변경 없음' && changeSummary.length > 0;

  return { updated, newDoc: newDoc || currentDoc, changeSummary };
}

/**
 * 사용자와의 일반 대화 응답 (채팅창용)
 */
export async function chatReply(topicName, currentDoc, history, userMessage) {
  const historyText = history.map((h) => `${h.role === 'user' ? '사용자' : 'AI'}: ${h.content}`).join('\n');

  const prompt = `당신은 "${topicName}" 주제를 전담하는 리서치 어시스턴트입니다. 현재 이 주제의 문서 내용은 다음과 같습니다:

"""
${currentDoc || '(아직 문서 내용 없음)'}
"""

지금까지의 대화:
${historyText || '(대화 없음)'}

사용자의 새 메시지: ${userMessage}

이 맥락을 바탕으로 자연스럽게 답변하세요.`;

  return callModel([{ role: 'user', content: prompt }], 1500);
}
