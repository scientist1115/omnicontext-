import express from 'express';
import db from '../db/index.js';
import { chatReply } from '../services/aiService.js';

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
    const reply = await chatReply(topic.name, docRow?.content || '', history, message);
    db.prepare('INSERT INTO chat_messages (topic_id, role, content) VALUES (?, ?, ?)').run(
      topicId,
      'assistant',
      reply
    );
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
