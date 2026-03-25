#!/bin/bash
# Carga autoaprendizajes de Supabase
# Uso: bash scripts/load-autoaprendizaje.sh [full|top]
#   full = todas las memorias (inicio de sesión / post-compaction)
#   top  = solo top 8 por categoría (cada mensaje normal, por defecto)

ENV_FILE="$HOME/.config/clawy/.env"
[ -f "$ENV_FILE" ] || { echo "No se encontró .env"; exit 1; }

SUPABASE_URL=$(grep '^SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")
ANON_KEY=$(grep '^SUPABASE_ANON_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

MODE="${1:-top}"

if [ "$MODE" = "full" ]; then
  # === MODO FULL: todas las memorias relevantes ===
  # Errores y reglas (importancia 5)
  echo "=== 🔴 ERRORES CRÍTICOS Y REGLAS ==="
  curl -s "$SUPABASE_URL/rest/v1/autoaprendizaje?select=content,category&importance=gte.5&order=category.asc&limit=20" \
    -H "apikey: $ANON_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
cats = {}
for d in data:
    c = d['category']
    cats.setdefault(c, []).append(d['content'])
for cat, items in cats.items():
    print(f'\n--- {cat.upper()} ---')
    for i in items:
        print(f'• {i}')
"

  # Lecciones recientes
  echo ""
  echo "=== 📘 LECCIONES RECIENTES ==="
  curl -s "$SUPABASE_URL/rest/v1/autoaprendizaje?select=content&importance=lt.5&category=eq.leccion&order=created_at.desc&limit=15" \
    -H "apikey: $ANON_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for i, d in enumerate(data, 1):
    print(f'{i}. {d[\"content\"][:120]}')
"

  # Preferencias y patrones
  echo ""
  echo "=== 💜 PREFERENCIAS Y PATRONES ==="
  curl -s "$SUPABASE_URL/rest/v1/autoaprendizaje?select=content,category&category=in.(preferencia,patron)&order=importance.desc&limit=20" \
    -H "apikey: $ANON_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
cats = {}
for d in data:
    c = d['category']
    cats.setdefault(c, []).append(d['content'])
for cat, items in cats.items():
    print(f'\n--- {cat.upper()} ---')
    for i in items[:8]:
        print(f'• {i}')
"

else
  # === MODO TOP: solo top 8 por categoría (ahorra ~11k tokens) ===
  curl -s "$SUPABASE_URL/rest/v1/autoaprendizaje?select=content,category&order=importance.desc&limit=100" \
    -H "apikey: $ANON_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
cats = {}
for d in data:
    c = d['category']
    items = cats.setdefault(c, [])
    if len(items) < 8:
        items.append(d['content'])
emoji = {'error':'🔴','regla':'⚠️','leccion':'📘','preferencia':'💜','patron':'🟡','decision':'🟢','proyecto':'🚀'}
for cat, items in cats.items():
    if items:
        print(f'--- {emoji.get(cat,\"📝\")} {cat.upper()} ---')
        for i in items[:8]:
            print(f'• {i}')
        print()
"
fi
