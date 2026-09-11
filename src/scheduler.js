import cron from 'node-cron';
import db from './db/index.js';
import { searchArxiv } from './services/searchService.js';
import { updateDocumentWithSources, extractSimulationSpec } from './services/aiService.js';
import { runSimulation } from './services/simulationService.js';

/**
 * 특정 주제 하나를 확인: 새 논문 검색 -> 안 본 것만 골라내기 ->
 * (가능하면) 단순화 시뮬레이션으로 가설 검증 -> AI로 문서 갱신 -> 저장
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

  // 이미 처리 완료된(성공적으로 반영된) 자료는 제외
  const seenStmt = db.prepare('SELECT source_url FROM seen_sources WHERE topic_id = ?');
  const seenUrls = new Set(seenStmt.all(topic.id).map((r) => r.source_url));
  const newSources = sources.filter((s) => !seenUrls.has(s.url));

  if (newSources.length === 0) {
    console.log(`[스케줄러] ${topic.name}: 새 자료 없음`);
    return;
  }

  try {
    // 각 새 자료에 대해 시뮬레이션으로 검증 가능한지 확인하고, 가능하면 실행
    for (const source of newSources) {
      try {
        const spec = await extractSimulationSpec(topic.name, source);
        if (spec.simulatable && spec.domain && spec.params) {
          console.log(`[스케줄러] "${source.title}" 시뮬레이션 실행 중 (${spec.domain})`);
          const result = await runSimulation({ domain: spec.domain, params: spec.params });
          source.simulation = { simulatable: true, domain: spec.domain, reasoning: spec.reasoning, result };

          if (!result.error) {
            db.prepare(
              `INSERT INTO simulations (topic_id, source_title, source_url, domain, reasoning, result_json)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(topic.id, source.title, source.url, spec.domain, spec.reasoning, JSON.stringify(result));
          }
        } else {
          source.simulation = { simulatable: false, reasoning: spec.reasoning || '해당 도메인 아님' };
        }
      } catch (err) {
        console.error(`[스케줄러] 시뮬레이션 단계 실패 (${source.title}):`, err.message);
        source.simulation = { simulatable: false, reasoning: '시뮬레이션 단계 오류' };
      }
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

    // AI 처리가 여기까지 성공적으로 끝난 자료만 "본 것"으로 기록 (실패하면 다음에 재시도됨)
    const insertSeen = db.prepare(
      'INSERT OR IGNORE INTO seen_sources (topic_id, source_url, title) VALUES (?, ?, ?)'
    );
    for (const s of newSources) insertSeen.run(topic.id, s.url, s.title);
  } catch (err) {
    console.error(`[스케줄러] ${topic.name} 처리 중 오류 (다음 주기에 재시도됨):`, err.message);
  }
}

async function runAllTopics() {
  const topics = db.prepare('SELECT * FROM topics WHERE active = 1').all();
  for (const topic of topics) {
    try {
      await runTopicCheck(topic);
    } catch (err) {
      console.error(`[스케줄러] ${topic.name} 처리 중 예상치 못한 오류:`, err.message);
    }
  }
}

// 스케줄러 시작. .env의 SCHEDULE_CRON 주기로 모든 주제를 순회하며 확인.
// 기본값: 20분마다
export function startScheduler() {
  const cronExpr = process.env.SCHEDULE_CRON || '*/20 * * * *';
  console.log(`[스케줄러] 시작됨. 주기: ${cronExpr}`);
  cron.schedule(cronExpr, () => {
    runAllTopics().catch((err) => console.error('[스케줄러] 실행 오류:', err));
  });
}
