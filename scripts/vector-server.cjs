const http = require('http');
const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const DB = '/home/ubuntu/.openclaw/workspace/memory.db';
const PORT = 3456;
const OR_KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env','utf8').match(/OPENROUTER_API_KEY=(.+)/)?.[1]?.trim();
const DIMS = 768;

// Load all embeddings into RAM at startup
const dbRW = new Database(DB); // read-write for /embed
const db = new Database(DB, { readonly: true });
let vectors = [];

function loadVectors() {
  vectors = [];
  const tables = [
    { sql: 'SELECT id, content, embedding FROM memories WHERE embedding IS NOT NULL', src: 'memories' },
    { sql: 'SELECT id, content, embedding FROM autoaprendizaje WHERE embedding IS NOT NULL', src: 'autoaprendizaje' },
    { sql: 'SELECT id, content, embedding FROM session_chunks WHERE embedding IS NOT NULL', src: 'session_chunks' }
  ];
  for (const t of tables) {
    const rows = db.prepare(t.sql).all();
    for (const r of rows) {
      const buf = Buffer.from(r.embedding, 'base64');
      vectors.push({
        id: r.id,
        content: r.content,
        source: t.src,
        emb: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
      });
    }
  }
  console.log(`Loaded ${vectors.length} vectors (${DIMS}d) in RAM`);
}

loadVectors();

// Cosine similarity
function cosine(a, b) {
  let d = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
  return d / (Math.sqrt(nA) * Math.sqrt(nB));
}

// Embed query via OpenRouter
async function embedQuery(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OR_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'google/gemini-embedding-001', input: text, dimensions: DIMS })
  });
  const d = await res.json();
  return new Float32Array(d.data[0].embedding);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Health
  if (url.pathname === '/health') {
    return res.end(JSON.stringify({ status: 'ok', vectors: vectors.length }));
  }

  // Search
  if (url.pathname === '/search' && req.method === 'GET') {
    const q = url.searchParams.get('q');
    const limit = parseInt(url.searchParams.get('limit') || '5');
    if (!q) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing q param' })); }
    const t0 = Date.now();
    try {
      const qEmb = await embedQuery(q);
      const results = vectors
        .map(v => ({ id: v.id, source: v.source, score: cosine(qEmb, v.emb), content: v.content }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ query: q, ms: Date.now() - t0, count: results.length, results }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Recent session chunks (for context at session start)
  if (url.pathname === '/recent') {
    const limit = parseInt(url.searchParams.get('limit') || '5');
    try {
      const recent = db.prepare(
        `SELECT session_id, source_type, chunk_index, content, timestamp 
         FROM session_chunks 
         ORDER BY COALESCE(timestamp, created_at) DESC 
         LIMIT ?`
      ).all(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: recent.length, results: recent }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Embed new content and store in DB + RAM
  if (url.pathname === '/embed' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { content, table, id } = JSON.parse(body);
      if (!content) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing content' })); }
      const emb = await embedQuery(content.slice(0, 2000));
      const b64 = Buffer.from(emb.buffer).toString('base64');
      if (table === 'memories' && id) {
        dbRW.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(b64, id);
        vectors.push({ id, content, source: 'memories', emb });
      } else if (table === 'autoaprendizaje' && id) {
        dbRW.prepare('UPDATE autoaprendizaje SET embedding = ? WHERE id = ?').run(b64, id);
        vectors.push({ id, content, source: 'autoaprendizaje', emb });
      } else if (table === 'session_chunks' && id) {
        dbRW.prepare('UPDATE session_chunks SET embedding = ? WHERE id = ?').run(b64, id);
        vectors.push({ id, content, source: 'session_chunks', emb });
      } else {
        // Just add to RAM for ephemeral use
        vectors.push({ id: 'eph_' + Date.now(), content, source: 'ephemeral', emb });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, vectors: vectors.length }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Reload vectors (after ingest)
  if (url.pathname === '/reload') {
    loadVectors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ reloaded: vectors.length }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🔍 Vector search server on http://127.0.0.1:${PORT}`);
});
