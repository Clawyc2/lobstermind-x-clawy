const D = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.argv[2];
const SUPABASE_URL = 'https://dpdcdunyiusdbsinbzlo.supabase.co';
const SUPABASE_KEY = 'sb_secret_MD5wg1_d4I_JgzVbYAALDw_7jaj3Qsl';

async function sync() {
  const db = new D(DB_PATH);
  const memories = db.prepare('SELECT * FROM memories').all();
  console.log(`Found ${memories.length} memories`);

  // Clean content - remove newlines that break JSON
  const clean = memories.map(m => ({
    id: m.id,
    content: (m.content || '').replace(/\n/g, ' ').replace(/\r/g, '').trim(),
    type: m.type || 'manual',
    confidence: m.confidence || 1.0,
    tags: m.tags || null,
    created_at: m.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  // Delete all and re-insert with clean data
  await fetch(`${SUPABASE_URL}/rest/v1/memories?id=neq.null`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  console.log('Cleared old data');

  // Insert in batches of 20
  for (let i = 0; i < clean.length; i += 20) {
    const batch = clean.slice(i, i + 20);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/memories`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) {
      console.error(`Error batch ${i}: ${await res.text()}`);
    } else {
      console.log(`Synced ${batch.length} (${i + batch.length}/${clean.length})`);
    }
  }

  console.log('Done!');
}

sync().catch(console.error);
