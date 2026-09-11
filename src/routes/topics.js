import express from 'express';
import db from '../db/index.js';
import { runTopicCheck } from '../scheduler.js';

const router = express.Router();

// 주제 목록 조회
router.get('/', (req, res) => {
  const topics = db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all();
  res.json(topics);
});

// 새 주제 등록 (예: name="TEC1-12706 펠티어 냉각", keywords="peltier cooling, thermoelectric")
router.post('/', (req, res) => {
  const { name, keywords } = req.body;
  if (!name || !keywords) {
    return res.status(400).json({ error: 'name과 keywords는 필수입니다.' });
  }
  const result = db.prepare('INSERT INTO topics (name, keywords) VALUES (?, ?)').run(name, keywords);
  res.status(201).json({ id: result.lastInsertRowid, name, keywords });
});

// 특정 주제 + 문서 + 최근 갱신 로그 조회
router.get('/:id', (req, res) => {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없습니다.' });

  const document = db.prepare('SELECT * FROM documents WHERE topic_id = ?').get(topic.id);
  const logs = db
    .prepare('SELECT * FROM update_log WHERE topic_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(topic.id);

  res.json({ topic, document: document || null, recentUpdates: logs });
});

// 주제 삭제
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM documents WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM chat_messages WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM seen_sources WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM update_log WHERE topic_id = ?').run(req.params.id);
  db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

// 자동 조사 켜기/끄기 토글
router.patch('/:id/active', (req, res) => {
  const { active } = req.body; // true 또는 false
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없습니다.' });

  db.prepare('UPDATE topics SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ id: Number(req.params.id), active: !!active });
});

// "이미 확인한 논문" 기록 초기화 (막혔던 주제를 처음부터 다시 조사하게 하고 싶을 때)
router.post('/:id/reset-seen', (req, res) => {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없습니다.' });

  const result = db.prepare('DELETE FROM seen_sources WHERE topic_id = ?').run(req.params.id);
  res.json({ id: Number(req.params.id), cleared: result.changes });
});

// 수동으로 지금 바로 확인시키기 (스케줄러 기다리지 않고 테스트용)
router.post('/:id/check-now', async (req, res) => {
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없습니다.' });

  try {
    await runTopicCheck(topic);
    const document = db.prepare('SELECT * FROM documents WHERE topic_id = ?').get(topic.id);
    res.json({ message: '확인 완료', document });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
