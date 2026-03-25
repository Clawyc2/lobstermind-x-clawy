#!/usr/bin/env node
/**
 * Migrate LobsterMind memories from hash-based embeddings to real semantic embeddings
 * Usage: OPENROUTER_API_KEY=xxx node /tmp/migrate-embeddings.cjs
 */
const Database = require('better-sqlite3');
const { createHash } = require('crypto');

const DB_PATH = process.argv[2] || '/home/ubuntu/.openclaw/workspace/memory/lobstermind-memory.db';
process.env.NODE_PATH = '/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules';
require('module')._initPaths();
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b';
const BATCH_SIZE = 10;

if (!API_KEY) { console.error('OPENROUTER_API_KEY required'); process.exit(1); }

const db = new Database(DB_PATH);
const memories = db.prepare('SELECT id, content FROM memories').all();
console.log(`Found ${memories.length} memories to migrate`);

// Detect if already has real embeddings (real ones are longer arrays, not 384 hash-based)
function isHashEmbedding(emb) {
  try {
    const arr = JSON.parse(emb);
    return arr.length === 384;
  } catch { return true; }
}

const toMigrate = memories.filter(m => {
  const row = db.prepare('SELECT embedding FROM memories WHERE id = ?').get(m.id);
  return isHashEmbedding(row?.embedding);
});

console.log(`${toMigrate.length} memories need real embeddings`);

async function getEmbedding(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: text.substring(0, 2000) })
  });
  if (!res.ok) { console.error(`API error ${res.status}`); return null; }
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

async function migrate() {
  let migrated = 0, failed = 0;
  const stmt = db.prepare('UPDATE memories SET embedding = ?, updated_at = ? WHERE id = ?');
  
  for (let i = 0; i < toMigrate.length; i += BATCH_SIZE) {
    const batch = toMigrate.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(toMigrate.length/BATCH_SIZE)}...`);
    
    const promises = batch.map(async (m) => {
      const emb = await getEmbedding(m.content);
      if (emb) {
        stmt.run(JSON.stringify(emb), new Date().toISOString(), m.id);
        migrated++;
      } else { failed++; }
    });
    
    await Promise.all(promises);
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`Done! Migrated: ${migrated}, Failed: ${failed}, Total: ${toMigrate.length}`);
  db.close();
}

migrate().catch(e => { console.error(e); db.close(); });
