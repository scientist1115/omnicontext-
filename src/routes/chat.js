import express from 'express';
import db from '../db/index.js';
import { chatReply, extractChatSimulationRequest } from '../services/aiService.js';
import { runSimulation } from '../services/simulationService.js';

const router = express.Router();

// 특정 주제의 대화 히스토리 조회
router.get('/:topicId', (req, res) => {
  const messages = db
    .prepare('SELECT * FROM chat_messages WHERE topic_id = ? ORDER BY created_at ASC')
    .all(req.params.topicId);
  res.json(messages);
});

// 메시지 보내기
router.post('/:topicId', async (req, res) => {
  const { message } = req.body;
  const topicId = req.params.topicId;
  if (!message) return res.status(400).json({ error: 'message는 필수입니다.' });

  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없습니다.' });

  const docRow = db.prepare('SELECT * FROM documents WHERE topic_id = ?').get(topicId);
  const history = db
    .prepare('SELECT * FROM chat_messages WHERE topic_id = ? ORDER BY created_at ASC LIMIT 20')
    .all(topicId);

  db.prepare('INSERT INTO chat_messages (topic_id, role, content) VALUES (?, ?, ?)').run(
    topicId,
    'user',
    message
  );

  try {
    // 사용자가 실제 시뮬레이션 실행을 요청한 건지 먼저 판단
    let simulationResult = null;
    try {
      const spec = await extractChatSimulationRequest(topic.name, message);
      if (spec.simulatable && spec.domain && spec.params) {
        const result = await runSimulation({ domain: spec.domain, params: spec.params });
        simulationResult = { domain: spec.domain, reasoning: spec.reasoning, result };

        if (!result.error) {
          db.prepare(
            `INSERT INTO simulations (topic_id, source_title, source_url, domain, reasoning, result_json)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(topicId, message.slice(0, 120), null, spec.domain, spec.reasoning, JSON.stringify(result));
        }
      }
    } catch (simErr) {
      console.error('[채팅] 시뮬레이션 요청 처리 실패:', simErr.message);
      // 시뮬레이션 판단/실행이 실패해도 일반 대화 응답은 계속 진행
    }

    const reply = await chatReply(topic.name, docRow?.content || '', history, message, simulationResult);
    db.prepare('INSERT INTO chat_messages (topic_id, role, content) VALUES (?, ?, ?)').run(
      topicId,
      'assistant',
      reply
    );
    res.json({ reply, simulationRan: !!simulationResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
