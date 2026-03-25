#!/usr/bin/env node
// sync-txts-to-vector.cjs — Read new TXTs from Supabase session_txts, chunk + embed, save to vector server
const fs = require('fs');

const ENV = fs.readFileSync('/home/ubuntu/.config/clawy/.env', 'utf8');
const getEnv = k => ENV.match(new RegExp(`^${k}=(.+)`, 'm'))?.[1]?.trim();
const SUPABASE_URL = getEnv('SUPABASE_URL');
const SUPABASE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const OR_KEY = getEnv('OPENROUTER_API_KEY');
const DB_PATH = '/home/ubuntu/.openclaw/workspace/memory.db';
const VECTOR_URL = 'http://127.0.0.1:3456';
const DIMS = 768;
const MAX_CHUNK = 1500;
const OVERLAP = 200;
const LOG_FILE = '/home/ubuntu/.openclaw/workspace/memory/txt-sync-log.json';

if (!SUPABASE_URL || !SUPABASE_KEY || !OR_KEY) {
  console.log('ERROR: missing env vars');
  process.exit(1);
}

// Load sync log
let syncLog = {};
try { syncLog = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}

async function getTxts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/session_txts?select=id,description,created_at&order=created_at.asc`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function getTxtContent(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/session_txts?id=eq.${id}&select=content`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const data = await res.json();
  return data[0]?.content || '';
}

function chunkTxt(text, sessionId) {
  const chunks = [];
  let current = '', idx = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length + 1 > MAX_CHUNK && current.length > OVERLAP) {
      chunks.push({ content: current.trim(), index: idx++, session_id: sessionId });
      current = current.slice(-OVERLAP);
    }
    current += '\n' + trimmed;
  }
  if (current.trim().length > 20) {
    chunks.push({ content: current.trim(), index: idx++, session_id: sessionId });
  }
  return chunks;
}

async function embedBatch(texts) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'google/gemini-embedding-001', input: texts.map(t => t.slice(0, 2000)), dimensions: DIMS })
  });
  if (!res.ok) throw new Error(`Embed ${res.status}: ${await res.text()}`);
  return (await res.json()).data.map(r => Buffer.from(new Float32Array(r.embedding).buffer).toString('base64'));
}

async function sendToVectorServer(chunks, embeddings) {
  // Insert directly into SQLite + reload vector server
  const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS session_chunks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source_type TEXT DEFAULT 'session', chunk_index INTEGER DEFAULT 0, content TEXT NOT NULL, role TEXT DEFAULT 'mixed', created_at TEXT, timestamp TEXT, embedding TEXT)`);
  
  db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const id = `chunk_${chunks[i].session_id.replace(/[^a-zA-Z0-9]/g, '_')}_${chunks[i].globalIdx}`;
      db.prepare("INSERT OR REPLACE INTO session_chunks (id,session_id,source_type,chunk_index,content,role,created_at,timestamp,embedding) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, chunks[i].session_id, 'txt_import', chunks[i].index, chunks[i].content, 'mixed', new Date().toISOString(), null, embeddings[i]);
    }
  })();
  db.close();
  
  // Reload vector server RAM
  await fetch(`${VECTOR_URL}/reload`);
}

async function main() {
  console.log('Fetching TXTs from Supabase...');
  const txts = await getTxts();
  console.log(`Found ${txts.length} TXTs in Supabase`);

  let newCount = 0, totalChunks = 0;

  for (const txt of txts) {
    if (syncLog[txt.id]) {
      console.log(`SKIP ${txt.id} (already synced)`);
      continue;
    }

    console.log(`Processing ${txt.id}...`);
    const content = await getTxtContent(txt.id);
    if (!content || content.length < 50) {
      console.log(`SKIP ${txt.id} (empty or too short)`);
      syncLog[txt.id] = { synced: true, chunks: 0, date: new Date().toISOString() };
      continue;
    }

    const sessionId = txt.id;
    const chunks = chunkTxt(content, sessionId);
    console.log(`  → ${chunks.length} chunks`);

    // Assign global IDs before batching
    for (let ci = 0; ci < chunks.length; ci++) {
      chunks[ci].globalIdx = ci;
    }

    // Embed in batches of 20
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      const embeddings = await embedBatch(batch.map(c => c.content));
      await sendToVectorServer(batch, embeddings);
      console.log(`  → Embedded ${i + batch.length}/${chunks.length}`);
    }

    syncLog[txt.id] = { synced: true, chunks: chunks.length, date: new Date().toISOString() };
    newCount++;
    totalChunks += chunks.length;
  }

  // Save sync log
  fs.writeFileSync(LOG_FILE, JSON.stringify(syncLog, null, 2));
  console.log(`\nDone! ${newCount} new TXTs, ${totalChunks} total chunks`);
}

main().catch(e => { console.error(`ERROR: ${e.message}`); process.exit(1); });
