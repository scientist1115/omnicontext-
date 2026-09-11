import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const dbPath = process.env.DB_PATH || './data/omnicontext.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  keywords TEXT NOT NULL,        -- 검색에 쓸 키워드 (쉼표 구분)
  active INTEGER DEFAULT 1,      -- 1이면 자동 조사 켜짐, 0이면 꺼짐
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS seen_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  found_at TEXT DEFAULT CURRENT_TIMESTAMP,
  applied INTEGER DEFAULT 0,     -- 문서에 반영됐는지
  UNIQUE(topic_id, source_url),
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);

CREATE TABLE IF NOT EXISTS update_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL,
  summary TEXT NOT NULL,         -- 이번 갱신에서 무엇이 바뀌었는지 요약
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id)
);
`);

// 마이그레이션: 이미 배포된 DB에 topics 테이블이 있지만 active 컬럼이 없는 경우 추가
const topicColumns = db.prepare("PRAGMA table_info(topics)").all().map((c) => c.name);
if (!topicColumns.includes('active')) {
  db.exec('ALTER TABLE topics ADD COLUMN active INTEGER DEFAULT 1');
}

export default db;
