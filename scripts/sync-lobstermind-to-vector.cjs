#!/usr/bin/env node
// sync-lobstermind-to-vector.cjs — Sync LobsterMind memories to vector server
// Reads from memory.db, compares with vector server, embeds missing ones via POST /embed
const fs = require('fs');
const path = require('path');

const ENV = fs.readFileSync('/home/ubuntu/.config/clawy/.env', 'utf8');
const getEnv = k => ENV.match(new RegExp(`^${k}=(.+)`, 'm'))?.[1]?.trim();
const OR_KEY = getEnv('OPENROUTER_API_KEY');
const DB_PATH = '/home/ubuntu/.openclaw/workspace/memory.db';
const VECTOR_URL = 'http://127.0.0.1:3456';

if (!OR_KEY) {
  console.log('ERROR: missing OPENROUTER_API_KEY');
  process.exit(1);
}

const sqlite3 = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');

async function embed(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'google/gemini-embedding-001', input: text })
  });
  if (!res.ok) throw new Error(`Embed API ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function getVectorIds() {
  try {
    const res = await fetch(`${VECTOR_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'all', top_k: 10000 })
    });
    const data = await res.json();
    return new Set((data.results || []).map(r => r.id));
  } catch {
    return new Set();
  }
}

async function main() {
  const db = sqlite3(DB_PATH, { readonly: true });
  const memories = db.prepare('SELECT id, content FROM memories WHERE content IS NOT NULL AND length(content) > 10 ORDER BY created_at ASC').all();
  db.close();
  
  console.log(`LobsterMind: ${memories.length} memorias`);
  
  const existingIds = await getVectorIds();
  console.log(`Vector server: ${existingIds.size} embeddings existentes`);
  
  const missing = memories.filter(m => !existingIds.has(`mem_${m.id}`));
  console.log(`Missing: ${missing.length} memorias sin embedding`);
  
  if (missing.length === 0) {
    console.log('✅ Todo synced!');
    return;
  }
  
  let synced = 0;
  let errors = 0;
  
  for (const mem of missing) {
    try {
      const vector = await embed(mem.content);
      await fetch(`${VECTOR_URL}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `mem_${mem.id}`,
          text: mem.content,
          vector,
          metadata: { source: 'lobstermind', memory_id: mem.id }
        })
      });
      synced++;
      if (synced % 20 === 0) {
        console.log(`  Progress: ${synced}/${missing.length}`);
        // Rate limit: sleep 1s every 20
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      errors++;
      console.log(`  ERROR mem_${mem.id}: ${e.message}`);
      if (errors > 5) {
        console.log('Too many errors, stopping');
        break;
      }
    }
  }
  
  console.log(`\nDone! Synced: ${synced}, Errors: ${errors}`);
}

main().catch(console.error);
