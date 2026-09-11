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

const SIM_DOMAIN_GUIDE = `사용 가능한 시뮬레이션 도메인 (넷 중 하나만 선택, 해당 없으면 null):

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

4. risk_probability (위험 요인 조합에 따른 확률 몬테카를로 시뮬레이션 - 실제 통계 아님, 가정치 기반)
   params: { trials?(기본 100000), base_probability(0~1),
             factors: [{ name, odds_multiplier(이 요인이 있으면 승산이 몇 배가 되는지 가정),
                          uncertainty_pct?(가정치의 불확실성, 기본 0), prevalence?(이 요인이 적용될 확률, 기본 1.0) }] }
   주의: base_probability와 각 factor의 odds_multiplier는 실제 통계가 아니라 합리적으로 추정한 가정치여야 하며,
   그 사실을 reasoning에 명시하세요.

1~3은 단순화된 1D/2D 물리 이상화 모델(진짜 3D CFD/FEA 아님), 4는 가정 기반 확률 추정 모델입니다.
셋 다 완전히 무관하면(예: 순수 알고리즘/수학 증명 등 물리·확률로 환원 불가능한 내용) simulatable: false로 답하세요.`;

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
 * 사용자가 채팅에서 직접 시뮬레이션을 요청했는지 판단하고 파라미터를 추출합니다.
 * (논문 자동 분석용 extractSimulationSpec와 별개로, 사용자가 "~해봐", "계산해줘" 등으로
 * 직접 요청했을 때 쓰입니다.)
 * @returns {Promise<{simulatable: boolean, domain?: string, params?: object, reasoning: string}>}
 */
export async function extractChatSimulationRequest(topicName, userMessage) {
  const prompt = `당신은 사용자의 채팅 메시지가 "실제로 시뮬레이션을 돌려달라"는 요청인지 판단하는 역할입니다.

${SIM_DOMAIN_GUIDE}

주제: ${topicName}
사용자 메시지: "${userMessage}"

이 메시지가 위 네 도메인 중 하나로 실제 계산 가능한 시뮬레이션 요청이면, 메시지에 나온 조건을 최대한 반영하고
부족한 값은 상식적으로 합리적인 값으로 채워서 파라미터를 만드세요. risk_probability의 경우 메시지에 언급된
위험 요인들을 factors로, 명시 안 된 odds_multiplier는 일반적으로 알려진 수준으로 합리적으로 추정하세요.
단순 질문(설명해줘, 어떻게 생각해? 등)이면 simulatable: false로 답하세요.

반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{"simulatable": true/false, "domain": "risk_probability 등 또는 null", "params": {...} 또는 null, "reasoning": "판단 이유이자 어떤 가정을 썼는지 한두 문장"}`;

  const result = await callModel([{ role: 'user', content: prompt }], 1000);
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
3. 관련이 있으면, 문서에 자연스럽게 통합해서 개정된 전체 문서를 작성하세요. 출처는 각주 형태로 [1], [2]처럼 표시하고 문서 맨 아래에 참고자료 목록을 두세요.
4. 시뮬레이션 검증 결과가 있는 자료는 "가설 검증" 소단락을 만들어서: (a) 논문의 핵심 주장을 한 줄로, (b) 단순화 모델로 계산한 결과값, (c) 논문 주장과 비교했을 때 이론적으로 타당해 보이는지에 대한 판단을 적으세요. 시뮬레이션이 "해당 없음"인 자료는 이 단락 없이 내용만 요약하세요.
5. 마지막 줄에는 반드시 "---CHANGE_SUMMARY---" 구분자 뒤에 이번에 무엇을 바꿨는지 한두 문장으로 요약하세요. 변경사항이 없으면 "변경 없음"이라고 쓰세요.

문서 형식 (매우 중요 - 사람이 읽는 리서치 노트라고 생각하고 쓰세요):
- 마크다운 문법을 적극 활용하세요: ## 소제목, 굵게(핵심 용어/수치), - 목록.
- 긴 문단으로 늘어놓지 말고, 각 문단은 3~4줄 이내로 짧게 끊으세요. 한 문단에 한 가지 요점만 담으세요.
- 수치를 비교하거나 여러 자료를 나열할 때는 마크다운 표(| 헤더 | 헤더 |)를 사용하세요. 예: 논문별 주장 비교, 시뮬레이션 결과 vs 논문 주장 비교.
- 톤은 동료 연구자에게 브리핑하듯 직접적이고 담백하게 쓰세요. "~라고 사료됩니다", "~로 보여집니다" 같은 딱딱한 보고서체 대신 자연스러운 설명체를 쓰세요.
- 문서 맨 위에는 항상 3줄 이내의 "핵심 요약"을 두어서, 바빠서 훑어만 보는 사람도 핵심을 알 수 있게 하세요.

응답은 개정된 전체 문서 내용만 출력하고, 그 뒤에 구분자와 요약을 붙이세요. 다른 설명은 하지 마세요.`;

  const result = await callModel([{ role: 'user', content: prompt }], 4000);

  const [newDoc, changeSummary = '변경 없음'] = result.split('---CHANGE_SUMMARY---').map((s) => s.trim());
  const updated = changeSummary !== '변경 없음' && changeSummary.length > 0;

  return { updated, newDoc: newDoc || currentDoc, changeSummary };
}

/**
 * 사용자와의 일반 대화 응답 (채팅창용).
 * simulationResult가 주어지면 그 실제 계산 결과를 바탕으로 답하고,
 * 없으면 일반 대화로 답합니다.
 */
export async function chatReply(topicName, currentDoc, history, userMessage, simulationResult = null) {
  const historyText = history.map((h) => `${h.role === 'user' ? '사용자' : 'AI'}: ${h.content}`).join('\n');

  const simText = simulationResult
    ? `\n\n방금 사용자의 요청으로 실제 시뮬레이터를 실행했습니다. 아래는 그 실제 계산 결과입니다. 이 숫자만 사용해서 답변하세요 (지어내지 마세요):\n${JSON.stringify(simulationResult, null, 2)}\n이 결과가 어떤 가정 위에서 계산된 것인지, 그리고 그 가정이 달라지면 결과도 달라질 수 있다는 점을 답변에 자연스럽게 포함하세요.`
    : '';

  const prompt = `당신은 "${topicName}" 주제를 전담하는 리서치 어시스턴트입니다. 현재 이 주제의 문서 내용은 다음과 같습니다:

"""
${currentDoc || '(아직 문서 내용 없음)'}
"""

지금까지의 대화:
${historyText || '(대화 없음)'}

사용자의 새 메시지: ${userMessage}${simText}

이 맥락을 바탕으로 자연스럽게 답변하세요.`;

  return callModel([{ role: 'user', content: prompt }], 1500);
}
