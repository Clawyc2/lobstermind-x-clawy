#!/usr/bin/env node
// ingest-one.cjs — Process ONE file, chunk + embed via OpenRouter, then exit
const Database = require('/home/ubuntu/.openclaw/extensions/lobstermind-memory/node_modules/better-sqlite3');
const fs = require('fs');
const path = require('path');
const DB_PATH = process.argv[4] || '/home/ubuntu/.openclaw/workspace/memory.db';
const FILE = process.argv[2];
const SOURCE = process.argv[3];
const DIMS = 768;
const OR_KEY = fs.readFileSync('/home/ubuntu/.config/clawy/.env','utf8').match(/OPENROUTER_API_KEY=(.+)/)?.[1]?.trim();
if (!FILE || !SOURCE) { console.log('ERROR: missing args'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.log('ERROR: file not found'); process.exit(1); }
const db = new Database(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS session_chunks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source_type TEXT DEFAULT 'session', chunk_index INTEGER DEFAULT 0, content TEXT NOT NULL, role TEXT DEFAULT 'mixed', created_at TEXT, timestamp TEXT, embedding TEXT)`);
db.exec(`CREATE TABLE IF NOT EXISTS ingest_log (source_path TEXT PRIMARY KEY, last_modified TEXT NOT NULL, last_ingested TEXT NOT NULL, chunk_count INTEGER DEFAULT 0)`);
const stat = fs.statSync(FILE);
const mtimeStr = stat.mtimeMs.toString();
const log = db.prepare("SELECT last_modified FROM ingest_log WHERE source_path = ?").get(FILE);
if (log && log.last_modified === mtimeStr) { console.log('SKIP'); process.exit(0); }
const MAX_CHUNK = 1500, OVERLAP = 200;
function chunkText(text, src) {
  const chunks = []; let current = '', idx = 0;
  if (src === 'markdown') {
    const sections = text.split(/^## .+$/m);
    for (const s of sections) { const t = s.trim(); if (!t||t.length<20) continue;
      if (t.length<=MAX_CHUNK) chunks.push({content:t,index:idx++,role:'markdown'});
      else { let buf=''; for(const p of t.split(/\n\n+/)){if(buf.length+p.length>MAX_CHUNK&&buf.length>OVERLAP){chunks.push({content:buf.trim(),index:idx++,role:'markdown'});buf=buf.slice(-OVERLAP)+p;}else buf+='\n\n'+p;}
        if(buf.trim().length>20)chunks.push({content:buf.trim(),index:idx++,role:'markdown'});}}
  } else {
    let sessionId=null,timestamp=null;
    for(const line of fs.readFileSync(FILE,'utf8').split('\n').filter(l=>l.trim())){
      try{const o=JSON.parse(line);if(o.type==='session'){sessionId=o.id;timestamp=o.timestamp;}
        if(o.type==='message'&&o.message){const r=o.message.role;if(r!=='user'&&r!=='assistant')continue;
          let t='';const c=o.message.content;if(typeof c==='string')t=c;else if(Array.isArray(c))t=c.filter(x=>x.type==='text').map(x=>x.text).join('\n');
          if(t&&t.length>10){const l=`[${r}]: ${t.slice(0,800)}\n`;if(current.length+l.length>MAX_CHUNK&&current.length>OVERLAP){chunks.push({content:current.trim(),index:idx++});current=current.slice(-OVERLAP)+l;}else current+=l;}}}
      catch(e){}}
    if(current.trim().length>20)chunks.push({content:current.trim(),index:idx++});
    chunks.sessionId=sessionId||path.basename(FILE);chunks.timestamp=timestamp;}
  return chunks;
}
async function embedBatch(texts) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings',{
    method:'POST',headers:{'Authorization':'Bearer '+OR_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:'google/gemini-embedding-001',input:texts.map(t=>t.slice(0,2000)),dimensions:DIMS})});
  if (!res.ok) throw new Error(res.status+' '+await res.text());
  return (await res.json()).data.map(r=>Buffer.from(new Float32Array(r.embedding).buffer).toString('base64'));
}
(async()=>{
  const text=SOURCE==='markdown'?fs.readFileSync(FILE,'utf8'):null;
  const chunks=chunkText(text,SOURCE);
  if(!chunks.length||chunks.length===0){console.log('SKIP');process.exit(0);}
  const sid=chunks.sessionId||FILE;
  db.prepare("DELETE FROM session_chunks WHERE session_id = ?").run(sid);
  const contents=chunks.map(c=>c.content);
  const embeddings=await embedBatch(contents);
  db.transaction(()=>{for(let i=0;i<chunks.length;i++){const id=`chunk_${sid.replace(/[^a-zA-Z0-9]/g,'_')}_${i}`;
    db.prepare("INSERT OR REPLACE INTO session_chunks (id,session_id,source_type,chunk_index,content,role,created_at,timestamp,embedding) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id,sid,SOURCE,i,chunks[i].content,chunks[i].role||'mixed',new Date().toISOString(),chunks.timestamp||null,embeddings[i]);}
    db.prepare("INSERT OR REPLACE INTO ingest_log (source_path,last_modified,last_ingested,chunk_count) VALUES (?,?,?,?)").run(FILE,mtimeStr,new Date().toISOString(),chunks.length);});
  db.close();console.log(`OK:${chunks.length}`);
})().catch(e=>{console.log(`ERROR:${e.message}`);process.exit(1);});
