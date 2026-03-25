const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const DB = '/home/ubuntu/.openclaw/workspace/memory.db';
const DIMS = 768;
const OR_KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env','utf8').match(/OPENROUTER_API_KEY=(.+)/)?.[1]?.trim();
const db = new Database(DB);

async function embed(texts) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method:'POST',
    headers:{'Authorization':'Bearer '+OR_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:'google/gemini-embedding-001',input:texts.map(t=>t.slice(0,2000)),dimensions:DIMS})
  });
  if (!res.ok) throw new Error(res.status+' '+await res.text());
  const d = await res.json();
  return d.data.map(r=>Buffer.from(new Float32Array(r.embedding).buffer).toString('base64'));
}

(async()=>{
  // Memories + autoaprendizaje
  const items = [
    ...db.prepare('SELECT id, content FROM memories WHERE embedding IS NULL').all().map(r=>({...r,t:'memories'})),
    ...db.prepare('SELECT id, content FROM autoaprendizaje WHERE embedding IS NULL').all().map(r=>({...r,t:'autoaprendizaje'}))
  ];
  console.log(`Memories+Auto: ${items.length} (${DIMS}d) via OpenRouter`);
  
  let done=0;
  for(let i=0;i<items.length;i+=20){
    const batch=items.slice(i,i+20);
    const embs=await embed(batch.map(b=>b.content));
    db.transaction(()=>{for(let j=0;j<batch.length;j++)db.prepare('UPDATE '+batch[j].t+' SET embedding=? WHERE id=?').run(embs[j],batch[j].id);})();
    done+=batch.length;
    console.log(`✓ ${done}/${items.length}`);
  }

  // Session chunks
  const chunks=db.prepare('SELECT id, content FROM session_chunks WHERE embedding IS NULL').all();
  console.log(`\nSession chunks: ${chunks.length}`);
  done=0;
  for(let i=0;i<chunks.length;i+=20){
    const batch=chunks.slice(i,i+20);
    const embs=await embed(batch.map(b=>b.content));
    db.transaction(()=>{for(let j=0;j<batch.length;j++)db.prepare('UPDATE session_chunks SET embedding=? WHERE id=?').run(embs[j],batch[j].id);})();
    done+=batch.length;
    console.log(`✓ ${done}/${chunks.length}`);
  }

  const total=db.prepare('SELECT (SELECT COUNT(*) FROM memories WHERE embedding IS NOT NULL)+(SELECT COUNT(*) FROM autoaprendizaje WHERE embedding IS NOT NULL)+(SELECT COUNT(*) FROM session_chunks WHERE embedding IS NOT NULL)').get();
  console.log(`\n✅ Total with embedding: ${Object.values(total)[0]}`);
  console.log(`DB: ${(fs.statSync(DB).size/1024).toFixed(0)}KB`);
  db.close();
})().catch(e=>{console.error(e);process.exit(1);});
