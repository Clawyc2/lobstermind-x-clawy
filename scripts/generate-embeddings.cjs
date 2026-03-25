const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ubuntu/.openclaw/workspace/memory.db';
const BATCH_SIZE = 50;
const OUTPUT_DIMENSIONS = 768;

const db = new Database(DB_PATH);

// Check/add embedding column to autoaprendizaje
const cols = db.prepare("PRAGMA table_info(autoaprendizaje)").all();
if (!cols.some(c => c.name === 'embedding')) {
  db.exec("ALTER TABLE autoaprendizaje ADD COLUMN embedding TEXT");
}

const rows = db.prepare("SELECT id, content FROM memories WHERE embedding IS NULL").all();
const autoRows = db.prepare("SELECT id, content FROM autoaprendizaje WHERE embedding IS NULL").all();

const allItems = [
  ...rows.map(r => ({ id: r.id, content: r.content, table: 'memories' })),
  ...autoRows.map(r => ({ id: r.id, content: r.content, table: 'autoaprendizaje' }))
];

console.log(`Total to embed: ${allItems.length}`);

if (allItems.length === 0) { console.log('Already done!'); process.exit(0); }

const GEMINI_KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env', 'utf8').match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();

async function embedBatch(texts) {
  const requests = texts.map(text => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: t
    },
    outputDimensionality: { outputDimensionality: 768 }ext
    },
    outputDimensionality: { outputDimensionality: 768 }.slice(0, 2000) }] }
  }));
  // Can't set outputDimensionality in batchEmbed easily, so use full 3072
  // Actually let's try:
  const body = { requests: texts.map(t => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: t
    },
    outputDimensionality: { outputDimensionality: 768 }.slice(0, 2000) }] }
  }))};
  
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embeddings.map(e => {
    const arr = new Float32Array(e.values);
    return Buffer.from(arr.buffer).toString('base64');
  });
}

async function main() {
  let processed = 0;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    try {
      const embeddings = await embedBatch(batch.map(b => b.content));
      const tx = db.transaction(() => {
        for (let j = 0; j < batch.length; j++) {
          const tbl = batch[j].table;
          db.prepare(`UPDATE ${tbl} SET embedding = ? WHERE id = ?`).run(embeddings[j], batch[j].id);
        }
      });
      tx();
      processed += batch.length;
      processed += batch.length;
      const batchNum = Math.floor(i/BATCH_SIZE)+1;
      const totalBatches = Math.ceil(allItems.length/BATCH_SIZE);
      console.log(`✓ Batch ${batchNum}/${totalBatches}: +${batch.length} (${processed}/${allItems.length})`);
      
      // Rate limit: 100 req/min free tier, our batch = 50 reqs, wait 35s to be safe
      if (i + BATCH_SIZE < allItems.length) {
        console.log(`  waiting 35s for rate limit...`);
        await new Promise(r => setTimeout(r, 35000));
      }
    } catch(err) {
      console.error(`✗ Batch failed: ${err.message}`);
      if (err.message.includes('429')) { 
        console.log('  Rate limited, waiting 60s...');
        await new Promise(r => setTimeout(r, 60000)); 
        i -= BATCH_SIZE; 
      }
    }
  }
  
  const memW = db.prepare("SELECT COUNT(*) c FROM memories WHERE embedding IS NOT NULL").get().c;
  const autoW = db.prepare("SELECT COUNT(*) c FROM autoaprendizaje WHERE embedding IS NOT NULL").get().c;
  console.log(`\n✅ Memories: ${memW}, Autoaprendizaje: ${autoW}`);
  console.log(`DB: ${(fs.statSync(DB_PATH).size/1024).toFixed(0)}KB`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
