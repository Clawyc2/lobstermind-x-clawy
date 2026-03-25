#!/bin/bash
# ingest.sh — Incremental ingestion of all sources
# Each file processed in separate Node.js process (no RAM accumulation)
# Usage: bash scripts/ingest.sh

set -euo pipefail

DB_PATH="${DB_PATH:-/home/ubuntu/.openclaw/workspace/memory.db}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INGEST_ONE="$SCRIPT_DIR/ingest-one.cjs"

SESSIONS_DIR="/home/ubuntu/.openclaw/agents/main/sessions"
CRON_DIR="/home/ubuntu/.openclaw/cron/runs"
MEMORY_DIR="/home/ubuntu/.openclaw/workspace"
MEMORY_FILE="/home/ubuntu/.openclaw/workspace/MEMORY.md"
DAILY_DIR="/home/ubuntu/.openclaw/workspace/memory"

INGESTED=0
SKIPPED=0
ERRORS=0
TOTAL_CHUNKS=0

process_files() {
  local dir="$1"
  local source_type="$2"
  
  if [ ! -d "$dir" ]; then return; fi
  
  for f in "$dir"/*.jsonl; do
    [ -f "$f" ] || continue
    RESULT=$(node "$INGEST_ONE" "$f" "$source_type" "$DB_PATH" 2>&1) || true
    case "$RESULT" in
      OK:*) 
        CHUNKS="${RESULT#OK:}"
        TOTAL_CHUNKS=$((TOTAL_CHUNKS + CHUNKS))
        INGESTED=$((INGESTED + 1))
        echo "  ✅ $(basename "$f"): $CHUNKS chunks"
        ;;
      SKIP) 
        SKIPPED=$((SKIPPED + 1))
        ;;
      ERROR:*|*) 
        ERRORS=$((ERRORS + 1))
        echo "  ❌ $(basename "$f"): $RESULT"
        ;;
    esac
  done
}

process_markdown() {
  local file="$1"
  [ -f "$file" ] || return
  
  RESULT=$(node "$INGEST_ONE" "$file" markdown "$DB_PATH" 2>&1) || true
  case "$RESULT" in
    OK:*) 
      CHUNKS="${RESULT#OK:}"
      TOTAL_CHUNKS=$((TOTAL_CHUNKS + CHUNKS))
      INGESTED=$((INGESTED + 1))
      echo "  ✅ $(basename "$file"): $CHUNKS chunks"
      ;;
    SKIP) SKIPPED=$((SKIPPED + 1)) ;;
    ERROR:*|*) 
      ERRORS=$((ERRORS + 1))
      echo "  ❌ $(basename "$file"): $RESULT"
      ;;
  esac
}

echo "🔄 Ingesta incremental — $(date)"
echo ""

echo "📁 Sessions ($SESSIONS_DIR)"
process_files "$SESSIONS_DIR" session

echo ""
echo "📁 Cron runs ($CRON_DIR)"
process_files "$CRON_DIR" cron

echo ""
echo "📁 Markdown"
process_markdown "$MEMORY_FILE"

if [ -d "$DAILY_DIR" ]; then
  for f in "$DAILY_DIR"/*.md; do
    [ -f "$f" ] || continue
    process_markdown "$f"
  done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Ingested: $INGESTED | Skipped: $SKIPPED | Errors: $ERRORS | Chunks: $TOTAL_CHUNKS"

# Stats
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM session_chunks;" 2>/dev/null || echo "0")
EMB=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM session_chunks WHERE embedding IS NOT NULL;" 2>/dev/null || echo "0")
echo "📦 session_chunks: $COUNT total, $EMB with embedding"
echo "💾 DB: $(du -h "$DB_PATH" | cut -f1)"
