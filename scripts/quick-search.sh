#!/bin/bash
# Quick search - ~7ms vs ~12s of openclaw memories search
# Usage: bash scripts/quick-search.sh "query" [limit]

QUERY="${1:-}"
LIMIT="${2:-5}"
DB="$HOME/.openclaw/workspace/memory.db"

if [ -z "$QUERY" ]; then
  echo 'Usage: quick-search.sh "query" [limit]'
  exit 1
fi

START=$(date +%s%3N)

# Build LIKE conditions for each word
KEYWORDS=$(echo "$QUERY" | tr '[:upper:]' '[:lower:]' | tr -s ' ' '\n' | awk 'NF{printf "content LIKE \"%%\" || \"\n\" || \"%%\" AND ", $0}' | sed 's/ AND $//')

# Memories
echo "=== MEMORIAS ==="
sqlite3 -header -column "$DB" "SELECT substr(id,1,12) as id, type, substr(content,1,100) as preview FROM memories WHERE content LIKE '%$QUERY%' ORDER BY created_at DESC LIMIT $LIMIT;" 2>/dev/null

echo ""
echo "=== AUTOAPRENDIZAJE ==="
sqlite3 -header -column "$DB" "SELECT substr(id,1,12) as id, category, substr(content,1,100) as content FROM autoaprendizaje WHERE content LIKE '%$QUERY%' LIMIT 3;" 2>/dev/null

END=$(date +%s%3N)
echo ""
echo "⏱ $((END - START))ms"
