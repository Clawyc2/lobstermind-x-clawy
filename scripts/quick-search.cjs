#!/usr/bin/env node
// Quick search - bypasses LobsterMind plugin loading (~7ms vs ~12s)
// Usage: node scripts/quick-search.cjs "query" [--limit 5] [--type error|regla|preferencia]

const Database = require('better-sqlite3');
const db = new Database('/home/ubuntu/.openclaw/workspace/memory.db', { readonly: true });

const args = process.argv.slice(2);
let query = '';
let limit = 5;
let filterType = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i+1]) { limit = parseInt(args[++i]); }
  else if (args[i] === '--type' && args[i+1]) { filterType = args[++i]; }
  else if (!args[i].startsWith('--')) { query = args[i]; }
}

if (!query) {
  console.log('Usage: node scripts/quick-search.cjs "query" [--limit 5] [--type type]');
  process.exit(1);
}

// Search in memories (LIKE-based, case insensitive)
const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);

let sql = `SELECT id, type, content, confidence, tags, created_at FROM memories WHERE 1=1`;
const params = [];

for (const kw of keywords) {
  sql += ` AND content LIKE ?`;
  params.push(`%${kw}%`);
}

if (filterType) {
  sql += ` AND (type LIKE ? OR content LIKE ?)`;
  params.push(`%${filterType}%`, `%${filterType}%`);
}

sql += ` ORDER BY created_at DESC LIMIT ?`;
params.push(limit * 3); // get more, we'll score

const startMs = Date.now();
const rows = db.prepare(sql).all(...params);

// Score results
const scored = rows.map(row => {
  const contentLower = row.content.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const count = (contentLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    score += count;
    // Boost if keyword appears at start
    if (contentLower.startsWith(kw)) score += 2;
  }
  // Boost by confidence
  score *= (row.confidence || 1.0);
  return { ...row, score };
}).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);

const elapsed = Date.now() - startMs;

// Also search in autoaprendizaje
let autoSql = `SELECT id, content, category, importance FROM autoaprendizaje WHERE 1=1`;
const autoParams = [];
for (const kw of keywords) {
  autoSql += ` AND content LIKE ?`;
  autoParams.push(`%${kw}%`);
}
autoSql += ` LIMIT 3`;
const autoRows = db.prepare(autoSql).all(...autoParams);

// Output
console.log(`\n🔍 "${query}" — ${scored.length + autoRows.length} results (${elapsed}ms)\n`);

if (scored.length > 0) {
  console.log(`--- MEMORIAS (${scored.length}) ---`);
  for (const r of scored) {
    console.log(`[${r.score.toFixed(1)}] [${r.type}] ${r.content.slice(0, 120)}...`);
    console.log(`    ID: ${r.id} | ${r.created_at?.slice(0,10) || 'unknown'}`);
    console.log();
  }
}

if (autoRows.length > 0) {
  console.log(`--- AUTOAPRENDIZAJE (${autoRows.length}) ---`);
  for (const r of autoRows) {
    console.log(`[${r.category}] ${r.content.slice(0, 120)}...`);
    console.log();
  }
}

if (scored.length === 0 && autoRows.length === 0) {
  console.log('No results found.');
}

db.close();
