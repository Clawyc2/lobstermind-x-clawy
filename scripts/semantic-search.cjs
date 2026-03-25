const query = process.argv[2] || 'help';
const limit = parseInt(process.argv[3] || '5');

fetch('http://127.0.0.1:3456/search?q=' + encodeURIComponent(query) + '&limit=' + limit)
  .then(r => r.json())
  .then(d => {
    if (d.error) { console.error('ERROR:', d.error); process.exit(1); }
    console.log(`\n🔍 "${d.query}" — ${d.count} results (${d.ms}ms)\n`);
    for (const r of d.results) {
      console.log(`[${r.score.toFixed(3)}] [${r.source}] ${r.content.slice(0, 130)}...`);
      console.log();
    }
  })
  .catch(e => {
    // Fallback: if server is down, try standalone
    console.error('Server unavailable, falling back to standalone...');
    require('child_process').execSync(
      `node /home/ubuntu/.openclaw/workspace/scripts/semantic-search-standalone.cjs "${query}" ${limit}`,
      { stdio: 'inherit' }
    );
  });
