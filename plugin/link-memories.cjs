const sessions = require('/tmp/sessions.json');
const memories = require('/tmp/memories_dates.json');
const URL = 'https://dpdcdunyiusdbsinbzlo.supabase.co';
const KEY = 'sb_secret_MD5wg1_d4I_JgzVbYAALDw_7jaj3Qsl';

const sessionsByDate = {};
sessions.forEach(s => {
  if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
  sessionsByDate[s.date].push(s.id);
});

async function run() {
  let count = 0;
  let errors = 0;
  for (const m of memories) {
    if (!m.created_at) continue;
    const date = m.created_at.substring(0, 10);
    const sessIds = sessionsByDate[date];
    if (!sessIds) continue;

    try {
      const res = await fetch(`${URL}/rest/v1/memories?id=eq.${m.id}`, {
        method: 'PATCH',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_date: date, session_id: sessIds[0] })
      });
      if (res.ok) count++; else { errors++; console.log('ERR', m.id, await res.text()); }
    } catch(e) { errors++; console.log('ERR', m.id, e.message); }
  }
  console.log(`Updated: ${count}, Errors: ${errors}`);
}
run();
