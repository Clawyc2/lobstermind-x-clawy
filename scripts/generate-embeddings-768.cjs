const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const DB_PATH = '/home/ubuntu/.openclaw/workspace/memory.db';
const BATCH_SIZE = 50;
const DIMS = 768;
const db = new Database(DB_PATH);
const cols = db.pragma('table_info(autoaprendizaje)');
if (!cols.some(c => c.name === 'embedding')) db.exec("ALTER TABLE autoaprendizaje ADD COLUMN embedding TEXT");
const rows = db.prepare("SELECT id, content FROM memories WHERE embedding IS NULL").all();
const autoRows = db.prepare("SELECT id, content FROM autoaprendizaje WHERE embedding IS NULL").all();
const allItems = [...rows.map(r => ({ id: r.id, content: r.content, table: 'memories' })), ...autoRows.map(r => ({ id: r.id, content: r.content, table: 'autoaprendizaje' }))];
console.log(`Total: ${allItems.length} (${DIMS}d)`);
if (!allItems.length) { console.log('Done!'); process.exit(0); }
const KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env', 'utf8').match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();
async function embedBatch(texts) {
  const requests = texts.map(t => ({ model: 'models/gemini-embedding-001', content: { parts: [{ text: t.slice(0, 2000) }] }, outputDimensionality: DIMS }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests }) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).embeddings.map(e => Buffer.from(new Float32Array(e.values).buffer).toString('base64'));
}
(async () => {
  let p = 0;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    try {
      const embs = await embedBatch(batch.map(b => b.content));
      db.transaction(() => { for (let j = 0; j < batch.length; j++) db.prepare(`UPDATE ${batch[j].table} SET embedding = ? WHERE id = ?`).run(embs[j], batch[j].id); })();
      p += batch.length;
      console.log(`✓ ${p}/${allItems.length}`);
      if (i + BATCH_SIZE < allItems.length) { console.log('  wait 35s...'); await new Promise(r => setTimeout(r, 35000)); }
    } catch(e) { console.error(`✗ ${e.message}`); if (e.message.includes('429')) { await new Promise(r => setTimeout(r, 60000)); i -= BATCH_SIZE; } }
  }
  console.log(`\n✅ DB: ${(fs.statSync(DB_PATH).size/1024).toFixed(0)}KB`);
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
