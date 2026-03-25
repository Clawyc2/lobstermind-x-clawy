#!/usr/bin/env node
// Ingest OpenClaw JSONL sessions into SQLite as searchable chunks with embeddings
// Usage: node scripts/ingest-sessions.cjs [session_dir]

const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ubuntu/.openclaw/workspace/memory.db';
const SESSION_DIR = process.argv[2] || '/home/ubuntu/.openclaw/agents/main/sessions';
const CRON_DIR = '/home/ubuntu/.openclaw/cron/runs';
const MAX_CHUNK = 1500;
const OVERLAP = 200;

const db = new Database(DB_PATH);

// Create sessions table if not exists
db.exec(`CREATE TABLE IF NOT EXISTS session_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_type TEXT DEFAULT 'session',
  chunk_index INTEGER DEFAULT 0,
  content TEXT NOT NULL,
  role TEXT DEFAULT 'mixed',
  created_at TEXT,
  timestamp TEXT,
  embedding TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS ingest_log (
  source_path TEXT PRIMARY KEY,
  last_modified TEXT NOT NULL,
  last_ingested TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0
)`);

// Add embedding column if missing
const cols = db.pragma('table_info(session_chunks)');
if (!cols.some(c => c.name === 'embedding')) {
  db.exec('ALTER TABLE session_chunks ADD COLUMN embedding TEXT');
}

const GEMINI_KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env', 'utf8').match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();

function chunkMessages(messages) {
  const chunks = [];
  let current = '';
  let idx = 0;
  let roles = new Set();

  for (const msg of messages) {
    const content = msg.text || '';
    if (!content || content.length < 10) continue;
    // Skip auto-inject/context blocks
    if (content.includes('<clawy-autoaprendizaje>') && content.length > 5000) continue;

    const line = `[${msg.role}]: ${content.slice(0, 800)}\n`;
    roles.add(msg.role);

    if (current.length + line.length > MAX_CHUNK && current.length > OVERLAP) {
      chunks.push({ content: current.trim(), index: idx++, roles: [...roles] });
      current = current.slice(-OVERLAP) + line;
      roles = new Set([msg.role]);
    } else {
      current += line;
    }
  }
  if (current.trim().length > 20) {
    chunks.push({ content: current.trim(), index: idx++, roles: [...roles] });
  }
  return chunks;
}

function parseSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  const messages = [];
  let sessionId = null;
  let timestamp = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'session') { sessionId = obj.id; timestamp = obj.timestamp; }
      if (obj.type === 'message' && obj.message) {
        const role = obj.message.role;
        if (role !== 'user' && role !== 'assistant') continue;
        let text = '';
        const c = obj.message.content;
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) text = c.filter(x => x.type === 'text').map(x => x.text).join('\n');
        if (text) messages.push({ role, text, ts: obj.timestamp });
      }
    } catch(e) {}
  }
  return { sessionId, timestamp, messages };
}

async function embedBatch(texts) {
  const requests = texts.map(t => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: t.slice(0, 2000) }] }
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) }
  );
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.embeddings.map(e => Buffer.from(new Float32Array(e.values).buffer).toString('base64'));
}

async function processFile(filePath, sourceType) {
  const stat = fs.statSync(filePath);
  const log = db.prepare("SELECT chunk_count FROM ingest_log WHERE source_path = ?").get(filePath);
  if (log && log.chunk_count > 0) {
    // Check if file changed
    const lastMod = db.prepare("SELECT last_modified FROM ingest_log WHERE source_path = ?").get(filePath);
    if (lastMod && lastMod.last_modified === stat.mtimeMs.toString()) {
      return { skipped: true, chunks: log.chunk_count };
    }
  }

  const { sessionId, timestamp, messages } = parseSession(filePath);
  if (messages.length === 0) return { skipped: true, chunks: 0, reason: 'no messages' };

  const chunks = chunkMessages(messages);
  if (chunks.length === 0) return { skipped: true, chunks: 0, reason: 'no valid chunks' };

  // Delete old chunks for this session
  db.prepare("DELETE FROM session_chunks WHERE session_id = ?").run(sessionId || filePath);

  // Insert new chunks (without embedding first)
  const insert = db.prepare("INSERT OR REPLACE INTO session_chunks (id, session_id, source_type, chunk_index, content, role, created_at, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

  for (const chunk of chunks) {
    const id = `chunk_${sessionId || path.basename(filePath)}_${chunk.index}`;
    const role = chunk.roles.includes('user') && chunk.roles.includes('assistant') ? 'mixed' : chunk.roles[0];
    insert.run(id, sessionId || filePath, sourceType, chunk.index, chunk.content, role, new Date().toISOString(), timestamp);
  }

  // Update ingest log
  db.prepare("INSERT OR REPLACE INTO ingest_log (source_path, last_modified, last_ingested, chunk_count) VALUES (?, ?, ?, ?)")
    .run(filePath, stat.mtimeMs.toString(), new Date().toISOString(), chunks.length);

  return { ingested: true, chunks: chunks.length, messages: messages.length };
}

async function main() {
  const dirs = [[SESSION_DIR, 'session'], [CRON_DIR, 'cron']];
  let totalIngested = 0, totalSkipped = 0, totalChunks = 0;

  for (const [dir, sourceType] of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
    console.log(`\n📂 ${dir}: ${files.length} files`);

    for (const file of files) {
      const result = await processFile(file, sourceType);
      if (result.skipped) {
        totalSkipped++;
        if (result.chunks > 0) console.log(`  ⏭ ${path.basename(file)}: ${result.chunks} chunks (cached)`);
      } else if (result.ingested) {
        totalIngested++;
        totalChunks += result.chunks;
        console.log(`  ✅ ${path.basename(file)}: ${result.chunks} chunks from ${result.messages} messages`);
      }
    }
  }

  console.log(`\n📊 Ingested: ${totalIngested}, Skipped: ${totalSkipped}, Total chunks: ${totalChunks}`);
  
  // Count total chunks
  const count = db.prepare("SELECT COUNT(*) as c, COUNT(embedding) as e FROM session_chunks").get();
  console.log(`📦 session_chunks: ${count.c} total, ${count.e} with embedding`);

  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
