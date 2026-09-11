import cron from 'node-cron';
import db from './db/index.js';
import { searchArxiv } from './services/searchService.js';
import { updateDocumentWithSources } from './services/aiService.js';

/**
 * 특정 주제 하나를 확인: 새 논문 검색 -> 안 본 것만 골라내기 -> AI로 문서 갱신 -> 저장
 */
export async function runTopicCheck(topic) {
  console.log(`[스케줄러] 주제 확인 중: ${topic.name}`);

  let sources;
  try {
    sources = await searchArxiv(topic.keywords, 5);
  } catch (err) {
    console.error(`[스케줄러] arXiv 검색 실패 (${topic.name}):`, err.message);
    return;
  }

  // 이미 본 자료는 제외
  const seenStmt = db.prepare('SELECT source_url FROM seen_sources WHERE topic_id = ?');
  const seenUrls = new Set(seenStmt.all(topic.id).map((r) => r.source_url));
  const newSources = sources.filter((s) => !seenUrls.has(s.url));

  // 새로 본 자료는 일단 기록 (중복 처리 방지)
  const insertSeen = db.prepare(
    'INSERT OR IGNORE INTO seen_sources (topic_id, source_url, title) VALUES (?, ?, ?)'
  );
  for (const s of newSources) insertSeen.run(topic.id, s.url, s.title);

  if (newSources.length === 0) {
    console.log(`[스케줄러] ${topic.name}: 새 자료 없음`);
    return;
  }

  const docRow = db.prepare('SELECT * FROM documents WHERE topic_id = ?').get(topic.id);
  const currentDoc = docRow ? docRow.content : '';

  const { updated, newDoc, changeSummary } = await updateDocumentWithSources(
    topic.name,
    currentDoc,
    newSources
  );

  if (updated) {
    if (docRow) {
      db.prepare(
        'UPDATE documents SET content = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(newDoc, docRow.id);
    } else {
      db.prepare('INSERT INTO documents (topic_id, content) VALUES (?, ?)').run(topic.id, newDoc);
    }
    db.prepare('INSERT INTO update_log (topic_id, summary) VALUES (?, ?)').run(topic.id, changeSummary);
    console.log(`[스케줄러] ${topic.name} 문서 갱신됨: ${changeSummary}`);
  } else {
    console.log(`[스케줄러] ${topic.name}: 관련성 낮아 갱신 안 함`);
  }
}

async function runAllTopics() {
  const topics = db.prepare('SELECT * FROM topics').all();
  for (const topic of topics) {
    await runTopicCheck(topic);
  }
}

// 스케줄러 시작. .env의 SCHEDULE_CRON 주기로 모든 주제를 순회하며 확인.
// 기본값: 3시간마다 (매 3시간 정각)
export function startScheduler() {
  const cronExpr = process.env.SCHEDULE_CRON || '0 */3 * * *';
  console.log(`[스케줄러] 시작됨. 주기: ${cronExpr}`);
  cron.schedule(cronExpr, () => {
    runAllTopics().catch((err) => console.error('[스케줄러] 실행 오류:', err));
  });
}
