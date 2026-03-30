/**
 * Skill Forge - Auto-detección y forja de skills
 * Módulo self-contained para LobsterMind
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// ============================================================================
// ESTADO INTERNO
// ============================================================================

interface ToolCallEntry {
  tool: string;
  context: string;
  timestamp: number;
}

interface SkillCandidate {
  topic: string;
  toolCount: number;
  tools: string[];
}

// Acumulador de tool calls
const toolCallBuffer: ToolCallEntry[] = [];
const MAX_BUFFER_SIZE = 200;
const CANDIDATE_THRESHOLD = 5;

// Cache de credenciales
let credsCache: { url: string; serviceKey: string } | null = null;

// ============================================================================
// CREDENCIALES SUPABASE
// ============================================================================

function getSupabaseCreds(): { url: string; serviceKey: string } {
  if (credsCache) return credsCache;

  try {
    // Leer de env vars primero
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      credsCache = { url, serviceKey };
      return credsCache;
    }

    // Fallback: leer de archivo .env
    const envPaths = [
      join(process.env.HOME || '/root', '.config', 'clawy', '.env'),
      join(process.env.HOME || '/root', '.env'),
    ];

    for (const envPath of envPaths) {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf-8');
        const envUrl = content.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim();
        const envKey = content.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim();
        if (envUrl && envKey) {
          credsCache = { url: envUrl, serviceKey: envKey };
          return credsCache;
        }
      }
    }

    throw new Error('No se encontraron credenciales de Supabase');
  } catch (e: any) {
    console.error('[skill-forge] Error leyendo credenciales:', e.message);
    return { url: '', serviceKey: '' };
  }
}

// ============================================================================
// TRACKING DE TOOL CALLS
// ============================================================================

// Keywords para agrupar por tema
const TOPIC_KEYWORDS: Record<string, string[]> = {
  'git': ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'rebase', 'clone'],
  'web': ['fetch', 'curl', 'html', 'css', 'react', 'next', 'vercel', 'deploy', 'website'],
  'docker': ['docker', 'container', 'image', 'compose', 'dockerfile'],
  'database': ['sql', 'postgres', 'supabase', 'query', 'table', 'insert', 'select'],
  'file': ['read', 'write', 'edit', 'file', 'fs', 'path', 'mkdir'],
  'api': ['api', 'endpoint', 'request', 'response', 'rest', 'http'],
  'memory': ['memory', 'memories', 'remember', 'recall', 'save', 'search'],
  'code': ['code', 'function', 'class', 'module', 'import', 'export', 'typescript', 'javascript'],
  'deploy': ['deploy', 'build', 'compile', 'vercel', 'netlify', 'production'],
  'test': ['test', 'spec', 'jest', 'mocha', 'assert', 'expect'],
};

function detectTopic(toolName: string): string {
  const lower = toolName.toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return topic;
  }
  // Default: usar las primeras letras como tema genérico
  return 'general';
}

export function trackToolCall(toolName: string, context: string): void {
  try {
    toolCallBuffer.push({
      tool: toolName,
      context: context.slice(0, 500),
      timestamp: Date.now(),
    });

    // Mantener buffer acotado
    if (toolCallBuffer.length > MAX_BUFFER_SIZE) {
      toolCallBuffer.splice(0, toolCallBuffer.length - MAX_BUFFER_SIZE);
    }
  } catch (e: any) {
    console.error('[skill-forge] Error tracking tool call:', e.message);
  }
}

export function getSkillCandidates(): SkillCandidate[] {
  try {
    // Agrupar por tema
    const topicMap: Record<string, Set<string>> = {};
    const now = Date.now();
    const WINDOW = 30 * 60 * 1000; // 30 minutos

    for (const entry of toolCallBuffer) {
      if (now - entry.timestamp > WINDOW) continue;
      const topic = detectTopic(entry.tool);
      if (!topicMap[topic]) topicMap[topic] = new Set();
      topicMap[topic].add(entry.tool);
    }

    const candidates: SkillCandidate[] = [];
    for (const [topic, tools] of Object.entries(topicMap)) {
      if (tools.size >= CANDIDATE_THRESHOLD) {
        candidates.push({
          topic,
          toolCount: tools.size,
          tools: Array.from(tools),
        });
      }
    }

    return candidates;
  } catch (e: any) {
    console.error('[skill-forge] Error getting candidates:', e.message);
    return [];
  }
}

// ============================================================================
// GENERACIÓN DE SKILL.MD
// ============================================================================

function generateSkillMd(params: {
  name: string;
  description: string;
  steps: string[];
  tools: string[];
  lessons: string[];
  tags: string[];
  version: number;
}): string {
  const stepsMd = params.steps.length > 0
    ? params.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '- (por definir)';

  const lessonsMd = params.lessons.length > 0
    ? params.lessons.map(l => `- ${l}`).join('\n')
    : '- (por definir)';

  const tagsMd = params.tags.length > 0
    ? params.tags.map(t => `\`${t}\``).join(', ')
    : '(sin tags)';

  const toolsMd = params.tools.length > 0
    ? params.tools.map(t => `- \`${t}\``).join('\n')
    : '- (por definir)';

  return `# ${params.name}

> Auto-forged skill | v${params.version} | Created: ${new Date().toISOString().split('T')[0]}

## Description
${params.description}

## Tags
${tagsMd}

## Tools Used
${toolsMd}

## Steps
${stepsMd}

## Lessons Learned
${lessonsMd}

---
*Skill Forge v1.0 - Auto-generated by Clawy*
`;
}

// ============================================================================
// OPERACIONES SUPABASE
// ============================================================================

async function supabaseRequest(method: string, table: string, body?: any, query?: string): Promise<any> {
  const { url, serviceKey } = getSupabaseCreds();
  if (!url || !serviceKey) throw new Error('Credenciales Supabase no disponibles');

  const fullUrl = `${url}/rest/v1/${table}${query ? '?' + query : ''}`;
  const headers: Record<string, string> = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const response = await fetch(fullUrl, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// ============================================================================
// FORGE SKILL
// ============================================================================

export async function forgeSkill(params: {
  name: string;
  slug: string;
  description: string;
  steps: string[];
  toolsUsed: string[];
  lessons: string[];
  tags: string[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Guardar en Supabase
    await supabaseRequest('POST', 'auto_skills', {
      name: params.name,
      slug: params.slug,
      description: params.description,
      steps: params.steps,
      tools_used: params.toolsUsed,
      lessons: params.lessons,
      tags: params.tags,
      version: 1,
      times_used: 0,
      source_session: 'skill-forge',
    });

    // 2. Guardar archivo SKILL.md
    const skillsDir = join(process.env.HOME || '/root', '.openclaw', 'workspace', 'skills', 'auto', params.slug);
    if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });

    const mdContent = generateSkillMd({
      name: params.name,
      description: params.description,
      steps: params.steps,
      tools: params.toolsUsed,
      lessons: params.lessons,
      tags: params.tags,
      version: 1,
    });

    writeFileSync(join(skillsDir, 'SKILL.md'), mdContent, 'utf-8');

    console.log(`[skill-forge] ✅ Skill forjado: ${params.slug}`);
    return { success: true };
  } catch (e: any) {
    console.error('[skill-forge] Error forjando skill:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================================
// BUSCAR SKILLS RELEVANTES
// ============================================================================

export async function findRelevantSkills(
  query: string,
  limit: number = 5
): Promise<Array<{ name: string; slug: string; description: string; version: number; times_used: number }>> {
  try {
    const keywords = query.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
    if (keywords.length === 0) return [];

    // Buscar por ILIKE en name, description, tags
    const orConditions = keywords.map(kw =>
      `name.ilike.%${kw}%,description.ilike.%${kw}%,tags.cs.{${kw}}`
    ).join(',');

    const result = await supabaseRequest(
      'GET',
      'auto_skills',
      undefined,
      `select=name,slug,description,version,times_used&or=(${orConditions})&limit=${limit}&order=times_used.desc`
    );

    return Array.isArray(result) ? result : [];
  } catch (e: any) {
    console.error('[skill-forge] Error buscando skills:', e.message);
    return [];
  }
}

// ============================================================================
// PATCH SKILL
// ============================================================================

export async function patchSkill(
  slug: string,
  additions: { steps?: string[]; lessons?: string[]; tools?: string[] }
): Promise<{ success: boolean; newVersion: number }> {
  try {
    // Obtener skill actual
    const existing = await supabaseRequest(
      'GET',
      'auto_skills',
      undefined,
      `select=*&slug=eq.${slug}`
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      return { success: false, newVersion: 0 };
    }

    const skill = existing[0];
    const newVersion = (skill.version || 1) + 1;

    const updatedSteps = [...(skill.steps || []), ...(additions.steps || [])];
    const updatedLessons = [...(skill.lessons || []), ...(additions.lessons || [])];
    const updatedTools = [...(skill.tools_used || []), ...(additions.tools || [])];

    await supabaseRequest(
      'PATCH',
      'auto_skills',
      {
        steps: updatedSteps,
        lessons: updatedLessons,
        tools_used: updatedTools,
        version: newVersion,
      },
      `slug=eq.${slug}`
    );

    // Actualizar archivo SKILL.md
    const skillsDir = join(process.env.HOME || '/root', '.openclaw', 'workspace', 'skills', 'auto', slug);
    if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });

    const mdContent = generateSkillMd({
      name: skill.name,
      description: skill.description || '',
      steps: updatedSteps,
      tools: updatedTools,
      lessons: updatedLessons,
      tags: skill.tags || [],
      version: newVersion,
    });

    writeFileSync(join(skillsDir, 'SKILL.md'), mdContent, 'utf-8');

    console.log(`[skill-forge] ✅ Skill parcheado: ${slug} v${newVersion}`);
    return { success: true, newVersion };
  } catch (e: any) {
    console.error('[skill-forge] Error parcheando skill:', e.message);
    return { success: false, newVersion: 0 };
  }
}

// ============================================================================
// INCREMENTAR USO
// ============================================================================

export async function incrementSkillUsage(slug: string): Promise<void> {
  try {
    // Supabase RPC o update manual
    const existing = await supabaseRequest(
      'GET',
      'auto_skills',
      undefined,
      `select=times_used&slug=eq.${slug}`
    );

    if (Array.isArray(existing) && existing.length > 0) {
      const newCount = (existing[0].times_used || 0) + 1;
      await supabaseRequest(
        'PATCH',
        'auto_skills',
        { times_used: newCount, last_used: new Date().toISOString() },
        `slug=eq.${slug}`
      );
    }
  } catch (e: any) {
    console.error('[skill-forge] Error incrementando uso:', e.message);
  }
}

// ============================================================================
// LISTAR SKILLS
// ============================================================================

export async function listSkills(): Promise<Array<any>> {
  try {
    const result = await supabaseRequest(
      'GET',
      'auto_skills',
      undefined,
      'select=*&order=created_at.desc'
    );
    return Array.isArray(result) ? result : [];
  } catch (e: any) {
    console.error('[skill-forge] Error listando skills:', e.message);
    return [];
  }
}

// ============================================================================
// INIT (limpiar buffer al inicio)
// ============================================================================

export function initSkillForge(): void {
  toolCallBuffer.length = 0;
  credsCache = null;
  console.log('[skill-forge] Inicializado');
}
