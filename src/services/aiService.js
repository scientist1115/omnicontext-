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

/**
 * 새로 발견된 논문들이 기존 문서와 관련 있는지 판단하고,
 * 관련 있다면 문서를 갱신한 새 버전을 만들어 반환합니다.
 * @param {string} topicName
 * @param {string} currentDoc - 현재 문서 내용
 * @param {Array} newSources - [{title, summary, url, published}]
 * @returns {Promise<{updated: boolean, newDoc: string, changeSummary: string}>}
 */
export async function updateDocumentWithSources(topicName, currentDoc, newSources) {
  if (newSources.length === 0) {
    return { updated: false, newDoc: currentDoc, changeSummary: '새로운 자료 없음' };
  }

  const sourcesText = newSources
    .map((s, i) => `[${i + 1}] ${s.title}\n요약: ${s.summary}\n링크: ${s.url}`)
    .join('\n\n');

  const prompt = `당신은 "${topicName}" 주제를 계속 추적하며 문서를 최신 상태로 유지하는 리서치 어시스턴트입니다.

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
4. 마지막 줄에는 반드시 "---CHANGE_SUMMARY---" 구분자 뒤에 이번에 무엇을 바꿨는지 한두 문장으로 요약하세요. 변경사항이 없으면 "변경 없음"이라고 쓰세요.

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
