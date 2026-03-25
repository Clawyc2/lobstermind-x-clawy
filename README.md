# 🦞 LobsterMind x Clawy

**Backup completo del sistema de memoria v1 de Clawy** antes de migrar a v2 limpia.

Repo: `Clawyc2/lobstermind-x-clawy` (privado)

---

## 📦 Componentes del Sistema

| Componente | Ubicación Original | Estado |
|---|---|---|
| **Plugin principal** | `~/.openclaw/extensions/lobstermind-memory/index.ts` (2,480 líneas) | ✅ Activo |
| **BD local (SQLite)** | `~/.openclaw/workspace/memory.db` (30MB) | ✅ Activa |
| **Vector server** | `~/.openclaw/workspace/scripts/vector-server.cjs` (PM2, puerto 3456) | ✅ Online |
| **Scripts de sync** | `~/.openclaw/workspace/scripts/` (16 archivos) | Varios |
| **Backup BD** | `/tmp/lobstermind-memory-backup-20260325.db` (30MB) | ⚠️ Temporal — NO subir (contiene secrets) |

### Este repo contiene:
- ✅ Código fuente del plugin (`index.ts`, `package.json`, `tsconfig.json`, etc.)
- ✅ Código compilado (`dist/`)
- ✅ Scripts de sync y vector server (copiados a `/scripts/`)
- ❌ **NO** contiene la BD (`memory.db`) — tiene secrets embebidos en memorias
- ❌ **NO** contiene `node_modules/`

---

## 📊 Base de Datos SQLite — Estructura y Registros

### Tablas

| Tabla | Registros | Descripción |
|---|---|---|
| `memories` | **247** | Memorias principales (CRUD + embeddings + búsqueda) |
| `session_chunks` | **2,951** | Fragmentos de sesiones JSONL para búsqueda semántica |
| `autoaprendizaje` | **266** | Errores/reglas/lecciones/patrones (sync bidireccional con Supabase) |
| `memory_relations` | — | Relaciones entre memorias |
| `memory_clusters` | 0 | Clusters semánticos (feature implementada pero sin datos) |
| `cluster_members` | — | Miembros de clusters |
| `sessions` | — | Registro de sesiones |
| `session_memories` | — | Link sesiones ↔ memorias |
| `ingest_log` | 0 | Log de ingestión (feature sin usar) |
| `plugin_meta` | — | Metadata del plugin |

### Tipos de memorias (tabla `memories`)

| Tipo | Cantidad |
|---|---|
| MANUAL (creadas por usuario) | 81 |
| leccion | 98 |
| error | 21 |
| proyecto | 26 |
| regla | 16 |
| patron | 3 |
| preferencia | 1 |
| sesion | 1 |
| **TOTAL** | **247** |

---

## 🧠 Funciones del Plugin (index.ts)

### 1. AUTO-INJECT (líneas ~2045-2090)

**Hook:** `api.on('before_agent_start')`  
**Propósito:** Inyectar autoaprendizaje en el prompt del agente

**Comportamiento:**
- **Primer turno de sesión:** Inyecta TODOS los items de autoaprendizaje (~266 items, full)
- **Turnos subsecuentes:** Solo top 5 por categoría (~30 items)
- Se activa también post-compaction (detecta cuando el contexto se comprimió)
- Inyecta vía `api.systemPromptAddition`

**Config relevante:**
- `NUDGE_INTERVAL: 10` — sync con auto-capture

### 2. AUTO-CAPTURE (líneas ~2092-2170)

**Hook:** `api.on('agent_end')` ⚠️ **NO DISPARA en gateway sessions**  
**Propósito:** Clasificar automáticamente turnos de conversación y guardar memorias

**Comportamiento:**
- Acumula buffer de N turnos (`NUDGE_INTERVAL: 10`)
- Cada 10 turnos, envía batch a LLM para clasificación
- LLM clasifica: ERROR, REGLA, PREFERENCIA, LECCIÓN, DECISIÓN, PATRÓN, PROYECTO
- Guarda en BD local (`memories`) + Supabase (`autoaprendizaje`)
- Deduplicación: score < 0.7 = nueva, 0.7-0.9 = reforzar, > 0.9 = duplicado

**Config AC_CONFIG:**
```typescript
{
  OPENROUTER_KEY: process.env.OPENROUTER_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NUDGE_INTERVAL: 10,  // Procesar cada 10 turnos
  CLASSIFY_MODEL: 'xiaomi/mimo-v2-flash:free',
  CLASSIFY_FALLBACK: 'deepseek/deepseek-r1-0528:free',
}
```

**⚠️ BUG CRÍTICO:** `agent_end` existe en `PluginHookName` pero NO dispara en gateway sessions de OpenClaw. Esto significa que auto-capture y auto-skills **nunca se ejecutan** en producción.

**Funciones internas:**
- `acLoadAutoaprendizaje(mode)` — Cargar desde Supabase (full/top)
- `acClassifyTurn(text)` — Clasificar batch de turnos con LLM
- `acSaveMemories(memories)` — Guardar en BD local + Supabase con dedup

### 3. AUTO-SKILLS (líneas ~2386-2410)

**Hook:** `api.on('agent_end')` — también roto por mismo bug  
**Propósito:** Extraer skills de las herramientas usadas en la sesión

**Comportamiento:**
- Detecta tool calls del agente
- Extrae patrones de uso como "skills"
- Registra en `memory_clusters`
- **Nunca se ejecutó** por el bug de `agent_end`

### 4. BÚSQUEDA SEMÁNTICA INTERNA

**Embeddings:** `qwen/qwen3-embedding-8b` (384 dims) vía OpenRouter  
**Propósito:** Búsqueda semántica dentro del plugin (linkMemories, searchWithBoost, assignToCluster)

**Características:**
- Cache de hasta 500 embeddings en RAM con LRU eviction
- Preload: carga 500 embeddings al iniciar desde BD
- `embeddingCache` con `MAX_CACHE_SIZE` para memory management
- Funciones: `embed()`, `search()`, `assignToCluster()`, `linkMemories()`
- `calculateCosineSimilarity()` para similitud coseno
- Clusters: centroid-based similarity grouping

**⚠️ NOTA:** Estos embeddings (384d, qwen3) son **INTERNOS** del plugin. Son SEPARADOS de los embeddings del vector-server (768d, Gemini). No se deben mezclar.

### 5. DEDUPLICACIÓN (líneas ~800-845)

**Propósito:** Evitar memorias duplicadas o similares

**Lógica:**
- Compara nuevo contenido con últimas 50 memorias existentes
- Genera embedding del nuevo contenido
- Calcula similitud coseno con cada una
- Score < 0.7 → nueva memoria (guardar)
- Score 0.7-0.9 → reforzar existente (actualizar contenido)
- Score > 0.9 → duplicado (no guardar)

### 6. REGISTRO DE MEMORIAS (líneas ~750-770)

**Función:** `addMemory(content, type, confidence, tags)`

**Comportamiento:**
- Genera embedding si no existe en cache
- INSERT OR REPLACE en tabla `memories`
- Campos: id (auto), content, type, confidence, tags, embedding (JSON), created_at, updated_at
- Fire-and-forget: `assignToCluster()` se ejecuta async sin bloquear

### 7. CLI (líneas ~1597-1700)

**Comandos registrados vía `api.registerCli`:**
- `openclaw memories list` — Listar memorias
- `openclaw memories search <query>` — Buscar memorias
- `openclaw memories add <content>` — Agregar memoria manual

**⚠️ NOTA:** `openclaw memories` es lento porque carga todo el plugin incluyendo hooks cada vez.

### 8. HOOKS ALTERNATIVOS (líneas ~1335-1440)

**Fallbacks implementados (en orden de preferencia):**
1. `api.hooks.afterMessage` — Hook oficial de OpenClaw
2. `api.hooks.onMessageCreate` — Fallback
3. `api.registerMiddleware` — Middleware legacy
4. `api.registerHook('message_sent')` — Hook registrado

**Estado:** El código intenta múltiples métodos para capturar mensajes. Solo `afterMessage` o `message_sent` deberían funcionar en gateway sessions.

---

## 🌐 Vector Server (scripts/vector-server.cjs)

**Proceso PM2:** `vector-server` (89MB RAM)  
**DB:** Compartida con LobsterMind (`memory.db`)  
**Embeddings:** `google/gemini-embedding-001` (768 dims) vía OpenRouter

### Endpoints

| Endpoint | Método | Función |
|---|---|---|
| `/search?q=<query>` | GET | Búsqueda semántica en session_chunks (top 10, threshold ≥ 0.5) |
| `/recent?limit=N` | GET | Últimos N chunks de sesiones (por fecha) |
| `/embed` | POST | Crear embedding inmediato para nueva memoria/body con `text` |

### Comportamiento:
- Carga TODOS los embeddings de `session_chunks` en RAM al iniciar
- Búsqueda: genera embedding de query → coseno vs todos los vectores → top N
- POST /embed: genera embedding y lo inserta en la tabla correspondiente
- Restart de gateway no afecta al vector-server (proceso PM2 independiente)
- La DB SQLite persiste — al reiniciar el server recarga desde DB

---

## 📝 Scripts de Sync

Todos en `~/.openclaw/workspace/scripts/`:

| Script | Función | API de Embeddings |
|---|---|---|
| `vector-server.cjs` | Servidor HTTP búsqueda semántica (PM2) | Gemini 768d |
| `semantic-search.cjs` | Búsqueda semántica CLI | Gemini 768d |
| `gen-768.cjs` | Generar embeddings 768d para memorias | Gemini 768d |
| `generate-embeddings-768.cjs` | Alternativa de generación | Gemini 768d |
| `generate-embeddings.cjs` | Generar embeddings (genérico) | Gemini |
| `generate-embeddings.mjs` | Versión ESM de generación | Gemini |
| `ingest-sessions.cjs` | Ingerir sesiones JSONL → session_chunks | Gemini 768d |
| `ingest-one.cjs` | Ingerir un solo chunk | Gemini 768d |
| `ingest.sh` | Wrapper bash para ingest | — |
| `sync-lobstermind-to-vector.cjs` | Sync memorias LobsterMind → vector server | Gemini 768d |
| `sync-txts-to-vector.cjs` | Sync TXTs de Supabase → session_chunks | Gemini 768d |
| `quick-search.cjs` | Búsqueda rápida CLI | Gemini 768d |
| `quick-search.sh` | Wrapper bash búsqueda rápida | — |
| `load-autoaprendizaje.sh` | Cargar autoaprendizaje desde Supabase | — |

### Flujo de datos de embeddings:

```
TXTs (Supabase) ──→ sync-txts-to-vector.cjs ──→ session_chunks (SQLite)
                                                        ↓
JSONL sessions ──→ ingest-sessions.cjs ────────→ session_chunks (SQLite)
                                                        ↓
Memorias ─────────→ sync-lobstermind-to-vector.cjs → session_chunks (SQLite)
                                                        ↓
                                          Vector Server (RAM) ←── memoria.db
                                                        ↓
                                              /search endpoint → resultados
```

---

## 🔌 Integración con Supabase

### Tablas en Supabase

| Tabla | Registros | Propósito |
|---|---|---|
| `session_txts` | **12** | Sesiones completas exportadas (3K+ lines c/u) |
| `sessions` | ~19 | Registro de sesiones diarias |
| `memories` | ~191 | Sync desde LobsterMind |
| `session_memories` | — | Link sesiones ↔ memorias |
| `autoaprendizaje` | ~266 | Errores/reglas/lecciones (sync bidireccional) |

### session_txts (TXTs completos)

| ID | Descripción |
|---|---|
| `txt_sess_2026_03_24_mn5puygk_*` | Sesión 2026-03-25 (2 fragmentos) |
| `txt_sess_2026_03_23_*` | Sesiones 2026-03-23/24 (3 TXTs) |
| `txt_sess_2026-03-21_12861_*` | Clawy Memorias Web: dashboard, sync, TXT import |
| `txt_sess_2026-03-20_14224_*` | DOGGY OnRamp: referidos, admin panel (2 TXTs) |
| `txt_sess_2026-03-19_8159_2` | Vacío (sin contenido) |
| `txt_sess_2026-03-20_14224_1` | DOGGY OnRamp hackathon: revision, repo |
| `txt_sess_2026-03-19_18572_0` | DOGGY Royale: battle royale Discord |

### Sync bidireccional autoaprendizaje:
- Plugin → Supabase: al guardar memorias via auto-capture
- Supabase → Plugin: al cargar autoaprendizaje al inicio de sesión
- Columna `source`: `'manual'` (creada por usuario) o `'autoguardado'` (por plugin)

---

## 🏗️ Arquitectura General

```
┌─────────────────────────────────────────────────┐
│                   OPENCLAW GATEWAY               │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │        LOBSTERMIND PLUGIN (v1)           │    │
│  │  index.ts (2,480 líneas)                 │    │
│  │                                           │    │
│  │  ┌─ AUTO-INJECT ──────────────────┐      │    │
│  │  │ before_agent_start              │      │    │
│  │  │ Full (turno 1) / Top 5 (resto) │      │    │
│  │  └─────────────────────────────────┘      │    │
│  │                                           │    │
│  │  ┌─ AUTO-CAPTURE ─────────────────┐      │    │
│  │  │ agent_end ⚠️ NO DISPARA         │      │    │
│  │  │ Cada 10 turnos → LLM clasifica │      │    │
│  │  │ → BD local + Supabase          │      │    │
│  │  └─────────────────────────────────┘      │    │
│  │                                           │    │
│  │  ┌─ AUTO-SKILLS ──────────────────┐      │    │
│  │  │ agent_end ⚠️ NO DISPARA         │      │    │
│  │  │ Extrae skills de tool calls     │      │    │
│  │  └─────────────────────────────────┘      │    │
│  │                                           │    │
│  │  ┌─ BÚSQUEDA SEMÁNTICA ───────────┐      │    │
│  │  │ qwen3-embedding-8b (384d)       │      │    │
│  │  │ Cache 500 embeddings en RAM      │      │    │
│  │  └─────────────────────────────────┘      │    │
│  │                                           │    │
│  │  ┌─ CLI ───────────────────────────┐      │    │
│  │  │ memories list/search/add         │      │    │
│  │  └─────────────────────────────────┘      │    │
│  └──────────────────────────────────────────┘    │
│                      ↕                           │
│  ┌──────────────────────────────────────────┐    │
│  │         memory.db (SQLite 30MB)          │    │
│  │  memories(247) | session_chunks(2951)    │    │
│  │  autoaprendizaje(266) | clusters(0)      │    │
│  └──────────────────────────────────────────┘    │
│                      ↕                           │
└──────────────────────┼───────────────────────────┘
                       ↕
┌──────────────────────┼───────────────────────────┐
│  VECTOR SERVER (PM2) │                           │
│  puerto 3456         │                           │
│  gemini-embedding(768d)                         │
│  /search | /embed | /recent                      │
└──────────────────────┼───────────────────────────┘
                       ↕
┌──────────────────────┼───────────────────────────┐
│  SUPABASE            │                           │
│  session_txts(12)    │                           │
│  autoaprendizaje(266)│                           │
│  sessions, memories  │                           │
└──────────────────────┴───────────────────────────┘
```

---

## ⚠️ Problemas Conocidos

### Críticos
1. **`agent_end` NO dispara en gateway sessions** — Auto-capture y auto-skills están rotos. El hook existe en `PluginHookName` pero OpenClaw no lo ejecuta para plugins kind="memory" en gateway mode.

### Funcionales
2. **Clusters vacíos** — Feature de clustering semántico implementada pero nunca se pobló
3. **Ingest log vacío** — Tabla `ingest_log` creada pero nunca usada
4. **Embeddings duales** — Plugin usa qwen3-8b (384d interno), vector-server usa Gemini (768d externo). Son sistemas separados.

### De diseño
5. **Auto-inject full en turno 1** — Inyectar ~266 items consume muchos tokens
6. **Auto-capture sin respaldo** — Al no disparar agent_end, todo depende de guardado manual
7. **Scripts duplicados** — Hay 4 versiones de generate-embeddings

---

## 🔑 Variables de Entorno Necesarias

```bash
# En ~/.config/clawy/.env
OPENROUTER_API_KEY=        # Para embeddings (qwen3 + gemini)
SUPABASE_URL=              # URL del proyecto Supabase
SUPABASE_ANON_KEY=         # Key anónima
SUPABASE_SERVICE_ROLE_KEY= # Key de servicio (auto-capture → Supabase)
```

---

## 🔧 Guía de Restauración (si se pierde la instancia)

### Paso 0: Requisitos
- Node.js 22+, npm, git, PM2
- OpenClaw instalado (`openclaw onboard --install-daemon`)
- EC2 t3.medium+ con ~70GB disco

### Paso 1: Restaurar plugin LobsterMind
```bash
# Clonar este repo
git clone https://github.com/Clawyc2/lobstermind-x-clawy.git /tmp/lm-restore
cd /tmp/lm-restore

# Copiar plugin a ubicación de OpenClaw
cp -r lobstermind-memory/ ~/.openclaw/extensions/lobstermind-memory/

# Instalar dependencias y compilar
cd ~/.openclaw/extensions/lobstermind-memory/
npm install
npm run build

# Verificar que dist/index.js existe
ls -la dist/index.js
```

### Paso 2: Restaurar BD
```bash
# Si tienes el backup .db:
cp /ruta/al/backup/memory.db ~/.openclaw/workspace/memory.db

# Si NO tienes backup, la BD se crea automáticamente al iniciar el plugin
# pero estará vacía (0 memorias)
```

### Paso 3: Restaurar scripts de sync
```bash
# Copiar scripts al workspace persistente
mkdir -p ~/.openclaw/workspace/scripts/
cp /tmp/lm-restore/scripts/*.cjs ~/.openclaw/workspace/scripts/

# Iniciar vector-server con PM2
cd ~/.openclaw/workspace/scripts/
pm2 start vector-server.cjs --name vector-server
pm2 save
```

### Paso 4: Configurar variables de entorno
```bash
# Agregar a ~/.config/clawy/.env (NO a este repo):
OPENROUTER_API_KEY=sk-or-v1-...        # Para embeddings
SUPABASE_URL=https://xxx.supabase.co    # Proyecto Supabase
SUPABASE_ANON_KEY=eyJ...                # Key anónima
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Key servicio (sync)
```

### Paso 5: Verificar
```bash
# Reiniciar gateway
openclaw gateway restart

# Verificar memorias
openclaw memories list
openclaw memories search "ERROR"

# Verificar vector server
curl http://127.0.0.1:3456/recent?limit=3

# Verificar PM2
pm2 status
```

### Mapa de archivos y sus ubicaciones en la instancia

| Archivo | Ubicación en instancia | Nota |
|---------|----------------------|------|
| `index.ts` | `~/.openclaw/extensions/lobstermind-memory/index.ts` | Plugin principal |
| `dist/index.js` | `~/.openclaw/extensions/lobstermind-memory/dist/` | Compilado |
| `memory.db` | `~/.openclaw/workspace/memory.db` | ⚠️ NO subir a GitHub |
| `vector-server.cjs` | `~/.openclaw/workspace/scripts/vector-server.cjs` | PM2 process |
| `semantic-search.cjs` | `~/.openclaw/workspace/scripts/semantic-search.cjs` | Búsqueda semántica |
| `sync-*.cjs` | `~/.openclaw/workspace/scripts/` | Scripts de sync |
| `gen-768.cjs` | `~/.openclaw/workspace/scripts/gen-768.cjs` | Generar embeddings |
| Credenciales | `~/.config/clawy/.env` | ⚠️ NUNCA subir |
| Moltbook creds | `moltbook/credentials.json` | ⚠️ NUNCA subir |
| Workspace files | `~/.openclaw/workspace/` | AGENTS.md, MEMORY.md, etc. |

---

## 📋 Plan de Migración v1 → v2

### Fase 1: Backup ✅
- [x] Backup plugin en repo GitHub (este repo)
- [x] Backup BD local en `/tmp/lobstermind-memory-backup-20260325.db`

### Fase 2: Instalar v2 limpia
- [ ] Instalar LobsterMind v2 desde `pnll1991/lobstermind-memory`
- [ ] Preservar BD actual (30MB con 247 memorias)

### Fase 3: Migrar mejoras una por una (ERROR #9: un cambio a la vez)
1. [ ] **Auto-capture funcional** — Mover de `agent_end` a `afterMessage` o `message_sent` (hook que SÍ dispara en gateway)
2. [ ] **Auto-inject optimizado** — Full en turno 1, top 5 por categoría en siguientes
3. [ ] **Auto-skills** — Extraer skills de tool calls (con hook funcional)
4. [ ] **Sync Supabase bidireccional** — autoaprendizaje + session_txts
5. [ ] **Vector server integrado** — Búsqueda semántica 768d con POST /embed
6. [ ] **Deduplicación inteligente** — Score-based (nueva/reforzar/duplicado)

### Fase 4: Verificación
- [ ] Compilar y testear cada mejora antes de la siguiente
- [ ] Verificar que BD existente (247 memorias) se mantiene accesible
- [ ] Confirmar que auto-capture dispara en gateway sessions

---

## 📌 Notas Importantes

- **BD NO se sube a GitHub** — Contiene secrets embebidos en memorias (Discord Bot Tokens, API keys)
- **Kind del plugin:** `"memory"` — OpenClaw solo permite UN plugin de memoria activo
- **Compilación:** TypeScript → `dist/index.js` via tsc
- **Dependencias:** `better-sqlite3` ( bundled en `node_modules/` del plugin)
- **Email git:** `clawaxia@gmail.com` (Clawy)
- **Regla de oro:** ERROR #9 — Un cambio a la vez, testear, confirmar, siguiente

---

_Última actualización: 2026-03-25_
_Autor: Clawy 🐾 — Backup antes de migración a v2_
