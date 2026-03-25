/**
 * LobsterMind Memory - Fixed OpenClaw Plugin
 */
import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export default {
  id: 'lobstermind-memory',
  name: 'LobsterMind Memory',
  description: 'Long-term community memory plugin',
  kind: 'memory',
  configSchema: { 
    type: 'object', 
    properties: { 
      enabled: { type: 'boolean', default: true } 
    } 
  },
  register(api: any) {
    console.log('[lobstermind] Loading...');
    const ws = api.runtime?.workspace || 'C:\\Users\\Paolozky\\.openclaw\\workspace';
    const dbDir = join(ws, 'memory');
    const backupDir = join(ws, 'memory', 'backups');
    const obsidianDir = join(ws, 'obsidian-vault', 'LobsterMind');
    [dbDir, backupDir, obsidianDir].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });
    const db = new Database(join(dbDir, 'lobstermind-memory.db'));
    
    // Initialize database schema with all tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence REAL NOT NULL,
        tags TEXT,
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_relations (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, relation_type),
        FOREIGN KEY (from_id) REFERENCES memories(id),
        FOREIGN KEY (to_id) REFERENCES memories(id)
      );
      CREATE TABLE IF NOT EXISTS memory_clusters (
        cluster_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        centroid_embedding TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        similarity_score REAL NOT NULL,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (cluster_id, memory_id),
        FOREIGN KEY (cluster_id) REFERENCES memory_clusters(cluster_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON memory_relations(from_id);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON memory_relations(to_id);
      CREATE INDEX IF NOT EXISTS idx_relations_type ON memory_relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_memory ON cluster_members(memory_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        txt_link TEXT,
        summary TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        linked_session_ids TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

      CREATE TABLE IF NOT EXISTS session_memories (
        session_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        PRIMARY KEY (session_id, memory_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      );

      CREATE TABLE IF NOT EXISTS autoaprendizaje (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'leccion',
        importance INTEGER NOT NULL DEFAULT 3,
        session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_autoaprendizaje_category ON autoaprendizaje(category);
      CREATE INDEX IF NOT EXISTS idx_autoaprendizaje_importance ON autoaprendizaje(importance DESC);
    `);
    
    // ===== MEJORA #1: Auto-detección de patrones (B+C: Stopwords + Semántica + #5 #7 #8) =====
    const STOPWORDS = new Set([
      // Spanish
      'que','de','el','la','los','las','un','una','unos','unas','en','es','por','con','para','del','al','lo','su','se','yo','me','mi','tu','te','nos','les','mas','muy','ya','no','si','pero','como','este','esta','eso','hay','esta','son','fue','ser','tiene','puede','han','todo','esto','que','cuando','donde','como','bien','mal','ahora','aqui','alli','tambien','despues','antes','entre','sobre','bajo','desde','hasta','otro','otra','cada','donde','cuando','mas','va','voy','vas','solo','sii','ok','estoy','estas','estos','cosa','cosas','hacer','dice','dime','pregunta','pregunto','mira','busca','busque','instala','agrega','crea','puedes','podria','seria','haria','quiero','gustaria','opinas','piensas','cree','crees','ademas','incluso','mejor','peor','claro','bueno','buena','cierto','entonces','asi','tan','sino','ni','nada','algo','alguien','nadie','siempre','nunca','quizas','talvez','seguro','ejemplo','caso','forma','manera','tipo','tema','vez','veces','parte','punto','motivo','razon','problema','solucion','idea','cambios','acuerdo','respecto','ver','saber','conocer','parece','entiendo','entiendes','funciona','trabaja','empieza','termina','necesito','necesitas',
      // English
      'the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','shall','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','that','this','what','which','who','whom','these','those','its','my','your','his','her','our','their','you','they','them','also','even','still','already','never','always','sometimes','usually','maybe','probably','really','actually','exactly','especially','basically','literally','simply',
      // Common fillers
      'clawy','luis','https','github','com','http','repo','link','vale','claro','creo','opino','pues','okey','perfecto','genial','anda','dale','vamos','sigue','listo','ahi','bueno','tienes','tengo','tenemos',
      // Action verbs (not patterns)
      'busca','revisa','chequea','instala','agrega','crea','arma','haz','fork','mira','abre','lee','descarga','ejecuta','corre','prueba','verifica','compara','analiza','explica','muestrame','dame','lista','enumera','describe','resume','borra','elimina','modifica','cambia','actualiza','deploy','push','commit',
      // Question words
      'que','cual','cuales','quien','quienes','cuanto','cuantos'
    ]);

    // Mejora #7: Known proper nouns to exclude
    const PROPER_NOUNS = new Set([
      'karpathy','vitalik','anatoly','satoshi','naval','elon','zuck','bezos',
      'pnll1991','neovertex1','jimmy','holiday','mergisi','anthropic','openai','claude','gpt',
      'npm','git','cli','api','sdk','db','json','md','url','ssh','ssl','tls','cpu','gpu','ram',
      'telegram','discord','whatsapp','vercel','github','gitlab','aws','gcp','azure','docker',
      'lunes','martes','miercoles','jueves','viernes','sabado','domingo',
      'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre',
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'january','february','march','april','may','june','july','august','september','october','november','december'
    ]);

    const PROPER_PATTERNS = [
      /https?:\/\/[^\s]+/g,
      /@[a-zA-Z0-9_]+/g,
      /\b\d{4,}\b/g,
      /\b[A-Z][a-z]{2,}(?:[A-Z][a-z]+)+\b/g,
    ];

    const patternTracker = {
      recentMessages: [] as { content: string; embedding: number[]; timestamp: string }[],
      MAX_RECENT: 50,
      THRESHOLD: 5,
      SIMILARITY_THRESHOLD: 0.65,
      WINDOW_HOURS: 168,
      
      cleanContent(content: string): string {
        let cleaned = content.toLowerCase().trim();
        for (const pattern of PROPER_PATTERNS) {
          cleaned = cleaned.replace(pattern, ' ');
        }
        return cleaned;
      },
      
      extractMeaningfulWords(content: string): string[] {
        const cleaned = this.cleanContent(content);
        return cleaned.split(/[\s,.!?;:'"()\xc2\xa1\xc2\xbf\[\]{}]+/)
          .filter((w: string) => w.length >= 3 && !STOPWORDS.has(w) && !PROPER_NOUNS.has(w) && !/^\d+$/.test(w));
      },
      
      isActionMessage(content: string): boolean {
        const lower = content.toLowerCase().trim();
        // Bug 2 fix: "quiero" + noun = preference, not action. Only filter "quiero" when followed by "que" (question)
        if (/^(busca|revisa|chequea|instala|agrega|crea|arma|haz|fork|mira|abre|lee|descarga|ejecuta|corre|prueba|verifica|compara|analiza|explica|mu\xc3\xa9strame|dame|lista|enumera|describe|resume|borra|elimina|modifica|cambia|actualiza)/i.test(lower)) return true;
        if (/[?]/.test(lower)) return true;
        if (/^(qu\xc3\xa9|como|c\xc3\xb3mo|cu\xc3\xa1l|cuales|qui\xc3\xa9n|d\xc3\xb3nde|cu\xc3\xa1ndo|por qu\xc3\xa9|para qu\xc3\xa9|es esto|qu\xc3\xa9 es|es posible|se puede|podemos|puedo)/i.test(lower)) return true;
        return false;
      },
      
      // Bug 1 fix: Detect if message expresses a preference (should be tracked even with negation)
      isPreferenceStatement(content: string): boolean {
        const lower = content.toLowerCase();
        // Bug 3 fix: Hypotheses/comparisons are NOT preferences
        if (/\b(puede\s+ser|ser\xc3\xada\s+como|ser\xc3\xada|podr\xc3\xada\s+ser|imagino|quiz\xc3\xa1s|tal\s+vez|si\s+lo|si\s+te|creo\s+que|parece\s+que)/i.test(lower)) return false;
        // Bug 4 fix: Technical descriptions/problems are NOT preferences
        if (/\b(no\s+funciona|no\s+puedo|no\s+tengo|error|fail|sin\s+\w+\s+(no|para)|requiere|necesita|hace\s+falta|no\s+tiene)/i.test(lower)) return false;
        // "no me gusta X" = preference about X
        if (/\b(no\s+me\s+gusta|no\s+me\s+interesa|odio|detesto|amo|adoro|prefiero|me\s+encanta|me\s+gusta|suele[ns]?\s+usar|siempre\s+uso|nunca\s+uso|evito|no\s+soporto|me\s+causa\s+)(\w+)/i.test(lower)) return true;
        // "quiero X" / "solo quiero X" = preference
        if (/\b(quiero|solo\s+quiero|me\s+gustar\xc3\xada|me\s+gustar)\s+\w+/i.test(lower)) return true;
        // "me interesa X" / "no me interesa X"
        if (/\b(me\s+interesa|no\s+me\s+interesa)\s+\w+/i.test(lower)) return true;
        return false;
      },
      
      // Bug 5: Detect explicit user instructions (highest priority)
      isExplicitInstruction(content: string): boolean {
        const lower = content.toLowerCase();
        // "recuerda X" / "no te olvides de X" / "acuerdate de X"
        if (/\b(recuerda|recuerda\s+esto|no\s+te\s+olvides|no\s+olvides|acu\xc3\xa9rdate|apunta|toma\s+nota|nota\s+esto)/i.test(lower)) return true;
        // "siempre haz X" / "nunca hagas X" / "cuando X haz Y"
        if (/\b(siempre|nunca)\s+\w+/i.test(lower)) return true;
        if (/\b(cuando|cada\s+vez\s+que)\s+\w+.*\b(haz|has|avisa|verifica|revisa|chequea|comunica|escribe|dime)/i.test(lower)) return true;
        // "importante: X" / "regla: X" / "ojo con X"
        if (/\b(importante|regla|ojo|atenci\xc3\xb3n|nota|fixe|critical|must|siempre)\s*[:;]/i.test(lower)) return true;
        return false;
      },
      
      // Bug 3+4: Filter hypotheses and technical problems from general tracking too
      isNoiseMessage(content: string): boolean {
        const lower = content.toLowerCase();
        if (/\b(puede\s+ser|ser\xc3\xada\s+como|podr\xc3\xada\s+ser|imagino|creo\s+que|parece\s+que|quiz\xc3\xa1s|tal\s+vez)/i.test(lower)) return true;
        if (/\b(no\s+funciona|no\s+puedo|no\s+tengo|error|fail|requiere|hace\s+falta|falta)/i.test(lower)) return true;
        return false;
      },
      
      track(content: string) {
        const trimmed = content.trim().toLowerCase();
        if (trimmed.length < 10) return;
        
        // Bug 5: Explicit instructions → save immediately with highest priority
        if (this.isExplicitInstruction(content)) {
          // Extract the instruction content
          const instMatch = content.match(/(?:recuerda\s+(?:esto)?|no\s+te\s+olvides\s+de?|acu\xc3\xa9rdate\s+de?|apunta|toma\s+nota|nota\s+esto)[:\s]*(.+)/i);
          const instContent = instMatch ? instMatch[1].trim() : content.substring(0, 120);
          const fullInstruction = `INSTRUCCIÓN: ${instContent}`;
          
          // Check if similar instruction exists
          const existing = search(`INSTRUCCIÓN: ${instContent.substring(0, 30)}`, 3);
          if (existing.length === 0) {
            save(fullInstruction, 'INSTRUCTION', 1.0, '#instruccion #auto');
            console.log(`[lobstermind:patterns] \u{1f525} Explicit instruction saved: "${instContent.substring(0, 60)}"`);
          } else {
            const exId = existing[0]?.id;
            if (exId) {
              db.prepare('UPDATE memories SET confidence = 1.0, updated_at = ? WHERE id = ?')
                .run(new Date().toISOString(), exId);
              console.log(`[lobstermind:patterns] \u{1f525} Reinforced instruction: "${instContent.substring(0, 60)}"`);
            }
          }
          return;
        }
        
        // Bug 3+4: Filter hypotheses and technical problems
        if (this.isNoiseMessage(content)) {
          console.log('[lobstermind:patterns] Skipped: hypothesis/technical noise');
          return;
        }
        if (this.isActionMessage(content)) {
          if (!this.isPreferenceStatement(content)) {
            console.log('[lobstermind:patterns] Skipped: action/question message');
            return;
          }
          console.log('[lobstermind:patterns] Action message BUT contains preference - tracking');
        }
        const words = this.extractMeaningfulWords(content);
        if (words.length < 2) return;
        const embedding = embed(trimmed);
        const now = new Date().toISOString();
        this.recentMessages.push({ content: trimmed, embedding, timestamp: now });
        if (this.recentMessages.length > this.MAX_RECENT) this.recentMessages.shift();
        
        // Bug 1+2 fix: Explicit preference statements save immediately (no need for 5 messages)
        if (this.isPreferenceStatement(content)) {
          const words = this.extractMeaningfulWords(content);
          const topic = words.slice(0, 3).join(', ') || 'preferencia';
          // Extract the object of preference
          const prefMatch = content.match(/(?:no\s+me\s+gusta|odio|prefiero|me\s+gusta|me\s+encanta|amo|adoro|quiero|solo\s+quiero|no\s+quiero|evito|siempre\s+uso|nunca\s+uso|me\s+interesa|no\s+me\s+interesa)\s+(.+)/i);
          const prefObject = prefMatch ? prefMatch[1].trim().substring(0, 80) : content.substring(0, 80);
          const prefContent = `PREFERENCIA: "${prefObject}" (detectado en: "${content.substring(0, 80)}")`;
          
          // Check if similar preference already exists
          const existing = search(`PREFERENCIA: "${prefObject.substring(0, 30)}`, 3);
          if (existing.length === 0) {
            save(prefContent, 'PREFERENCE', 0.98, '#preferencia #auto');
            console.log(`[lobstermind:patterns] \u2705 Direct preference saved: "${prefObject}"`);
          } else {
            // Boost existing preference
            const exId = existing[0]?.id;
            if (exId) {
              db.prepare('UPDATE memories SET confidence = MIN(confidence + 0.03, 1.0), updated_at = ? WHERE id = ?')
                .run(new Date().toISOString(), exId);
              console.log(`[lobstermind:patterns] \u{1f4c8} Boosted existing preference: "${prefObject}"`);
            }
          }
          return; // Don't also check for regular patterns
        }
        
        this.checkForPatterns(content, words);
      },
      
      checkForPatterns(originalContent: string, originalWords: string[]) {
        if (this.recentMessages.length < this.THRESHOLD) return;
        const latest = this.recentMessages[this.recentMessages.length - 1];
        const latestEmb = latest.embedding;
        let similarCount = 0;
        const similarMessages: string[] = [];
        for (const msg of this.recentMessages) {
          if (msg === latest) continue;
          const sim = calculateCosineSimilarity(latestEmb, msg.embedding);
          if (sim >= this.SIMILARITY_THRESHOLD) {
            similarCount++;
            similarMessages.push(msg.content.substring(0, 80));
          }
        }
        if (similarCount < this.THRESHOLD - 1) return;
        
        // Mejora #8: Detect mixed/opposing sentiments
        const hasOpposition = /\b(?:pero\s|no\s+me\s+gusta|odio|no\s+quiero|vs|versus|contra|aunque)\b/i.test(originalContent);
        
        if (hasOpposition) {
          // Mejora #8: Split into separate patterns using co-occurrence
          const allMessages = this.recentMessages.filter(msg => {
            const sim = calculateCosineSimilarity(latestEmb, msg.embedding);
            return sim >= this.SIMILARITY_THRESHOLD;
          });
          
          const wordCooccurrence: Record<string, Record<string, number>> = {};
          const wordFreq: Record<string, number> = {};
          
          for (const msg of allMessages) {
            const msgWords = this.extractMeaningfulWords(msg.content);
            for (let i = 0; i < msgWords.length; i++) {
              wordFreq[msgWords[i]] = (wordFreq[msgWords[i]] || 0) + 1;
              for (let j = i + 1; j < msgWords.length; j++) {
                if (!wordCooccurrence[msgWords[i]]) wordCooccurrence[msgWords[i]] = {};
                wordCooccurrence[msgWords[i]][msgWords[j]] = (wordCooccurrence[msgWords[i]][msgWords[j]] || 0) + 1;
                if (!wordCooccurrence[msgWords[j]]) wordCooccurrence[msgWords[j]] = {};
                wordCooccurrence[msgWords[j]][msgWords[i]] = (wordCooccurrence[msgWords[j]][msgWords[i]] || 0) + 1;
              }
            }
          }
          
          const visited = new Set<string>();
          const topics: string[][] = [];
          
          for (const [word, freq] of Object.entries(wordFreq).sort((a, b) => b[1] - a[1])) {
            if (visited.has(word) || freq < 2) continue;
            const cluster = [word];
            visited.add(word);
            const related = wordCooccurrence[word] || {};
            for (const [relatedWord, coCount] of Object.entries(related).sort((a, b) => (b[1] as number) - (a[1] as number))) {
              if (!visited.has(relatedWord) && coCount >= 2) {
                cluster.push(relatedWord);
                visited.add(relatedWord);
              }
            }
            if (cluster.length >= 1) topics.push(cluster);
          }
          
          for (const topicWords of topics) {
            const topic = topicWords.slice(0, 3).join(', ');
            if (topic) this.savePattern(topic, similarCount + 1, similarMessages);
          }
        } else {
          // Normal single pattern
          const wordFreq: Record<string, number> = {};
          for (const msg of this.recentMessages) {
            const msgWords = this.extractMeaningfulWords(msg.content);
            for (const w of msgWords) wordFreq[w] = (wordFreq[w] || 0) + 1;
          }
          const topWords = Object.entries(wordFreq)
            .filter(([w]) => !STOPWORDS.has(w) && !PROPER_NOUNS.has(w))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3).map(([w]) => w);
          const topic = topWords.join(', ') || 'tema recurrente';
          this.savePattern(topic, similarCount + 1, similarMessages);
        }
      },
      
      // Mejora #5: Handle contradictions
      savePattern(topic: string, count: number, samples: string[]) {
        const patternContent = `PATRON: "${topic}" \u2014 detectado ${count} mensajes similares. Ejemplos: ${samples.slice(0, 3).join(' | ')}`;
        const existing = search(`PATRON: "${topic}"`, 5);
        const exactMatch = existing.find((m: any) => m.content.includes(`"${topic}"`) && m.type === 'PATTERN');
        
        if (exactMatch) {
          const latestSample = samples[samples.length - 1] || '';
          // Bug 1 fix: Only flag as contradiction if existing pattern was positive AND new is negative
          // "no me gusta" alone = preference, not contradiction
          // Contradiction = existing was "me gusta X" + new is "ya no me gusta X" or "no quiero X"
          const existingLower = exactMatch.content.toLowerCase();
          const wasPositive = /me\s+gusta|me\s+interesa|prefiero|siempre\s+uso|amo|adoro|encanta/i.test(existingLower);
          const hasRealContradiction = /\b(ya\s+no|ya\s+nunca|ya\s+cambi|ya\s+no\s+uso|ya\s+no\s+quiero|cambi|de\s+opinion|antes\s+(s[ií]|usaba|prefer))/i.test(latestSample);
          const hasNewPreference = /\b(no\s+me\s+gusta|odio|no\s+quiero|no\s+uso|prefiero|me\s+gusta|me\s+interesa|me\s+encanta)/i.test(latestSample);
          
          if (wasPositive && hasRealContradiction && !exactMatch.content.includes('ACTUALIZADO')) {
            const updatedContent = exactMatch.content + `\n\u26a0\ufe0f ACTUALIZADO: Posible contradiccion. Nuevo contexto: "${latestSample}"`;
            db.prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?')
              .run(updatedContent, new Date().toISOString(), exactMatch.id);
            console.log(`[lobstermind:patterns] \u26a0\ufe0f Contradiction for "${topic}" \u2014 updated`);
          } else {
            db.prepare('UPDATE memories SET confidence = MIN(confidence + 0.05, 1.0), updated_at = ? WHERE id = ?')
              .run(new Date().toISOString(), exactMatch.id);
            console.log(`[lobstermind:patterns] \u{1f4c8} Boosted: "${topic}"`);
          }
        } else {
          // Check partial overlap
          const topicWords = topic.split(', ');
          for (const ex of existing) {
            if (ex.type !== 'PATTERN') continue;
            const exTopic = ex.content.match(/PATRON: "([^"]+)"/)?.[1] || '';
            const exWords = exTopic.split(', ');
            const overlap = topicWords.filter(w => exWords.includes(w));
            if (overlap.length >= 1 && overlap.length < topicWords.length) {
              console.log(`[lobstermind:patterns] Partial overlap with "${exTopic}" (shared: ${overlap.join(', ')})`);
              return;
            }
          }
          save(patternContent, 'PATTERN', 0.95, '#patron #auto');
          console.log(`[lobstermind:patterns] \u2705 Saved: "${topic}" (${count} msgs)`);
        }
      },
      
      getPatterns(): any[] {
        return db.prepare("SELECT * FROM memories WHERE type = 'PATTERN' ORDER BY confidence DESC").all() as any[];
      },
      
      stats() {
        const tracked = this.recentMessages.length;
        const patterns = this.getPatterns().length;
        console.log(`[lobstermind:patterns] Tracking ${tracked} msgs, ${patterns} patterns`);
      }
    };
    // ===== MEJORA #6: Confidence score dinámico =====
    const confidenceManager = {
      BOOST_ON_ACCESS: 0.02,
      DECAY_DAILY: 0.01,
      MIN_CONFIDENCE: 0.1,
      MAX_CONFIDENCE: 1.0,
      MAX_ACCESS_COUNT: 50,
      
      boostOnAccess(memoryId: string) {
        db.prepare('UPDATE memories SET confidence = MIN(confidence + ?, ?), access_count = COALESCE(access_count, 0) + 1, updated_at = ? WHERE id = ?')
          .run(this.BOOST_ON_ACCESS, this.MAX_CONFIDENCE, new Date().toISOString(), memoryId);
        console.log(`[lobstermind:confidence] Boosted: ${memoryId}`);
      },
      
      decayAll() {
        const result = db.prepare('UPDATE memories SET confidence = MAX(confidence - ?, ?), updated_at = ? WHERE confidence > ? AND type != ?')
          .run(this.DECAY_DAILY, this.MIN_CONFIDENCE, new Date().toISOString(), this.MIN_CONFIDENCE, 'PATTERN');
        console.log(`[lobstermind:confidence] Decayed ${result.changes} memories`);
        return result.changes;
      },
      
      topConfident(limit: number = 10): any[] {
        return db.prepare('SELECT * FROM memories ORDER BY confidence DESC LIMIT ?').all(limit) as any[];
      },
      
      lowConfidence(threshold: number = 0.2): any[] {
        return db.prepare('SELECT * FROM memories WHERE confidence <= ? AND type != ? ORDER BY confidence ASC LIMIT 20').all(threshold, 'PATTERN') as any[];
      }
    };

    // Run confidence decay once daily on startup
    db.exec("CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT)");
    const lastDecayDate = db.prepare("SELECT key, value FROM plugin_meta WHERE key = 'last_confidence_decay'").get() as any;
    const today = new Date().toISOString().split('T')[0];
    if (!lastDecayDate || lastDecayDate.value !== today) {
      try {
        db.exec("CREATE TABLE IF NOT EXISTS plugin_meta (key TEXT PRIMARY KEY, value TEXT)");
        db.prepare("INSERT OR REPLACE INTO plugin_meta (key, value) VALUES (?, ?)").run('last_confidence_decay', today);
        confidenceManager.decayAll();
        console.log('[lobstermind:confidence] Daily decay applied');
      } catch (e: any) {
        console.error('[lobstermind:confidence] Decay error:', e.message);
      }
    }

    // Boost confidence on search access
    const originalSearch = search;
    function searchWithBoost(q: string, k: number = 8) {
      const results = originalSearch(q, k);
      // Boost accessed memories
      results.forEach((m: any) => {
        if (m.id) confidenceManager.boostOnAccess(m.id);
      });
      return results;
    }

    // ===== MEJORA #2: Recordatorios programados =====
    const reminderManager = {
      reminders: [] as any[],
      
      create(text: string, remindAt: string, context?: string) {
        const id = createHash('sha256').update(`reminder:${text}:${remindAt}`).digest('hex').slice(0, 16);
        const now = new Date().toISOString();
        db.prepare('INSERT OR REPLACE INTO reminders (id, text, remind_at, context, created_at, status) VALUES (?, ?, ?, ?, ?, ?)').run(id, text, remindAt, context || null, now, 'pending');
        console.log(`[lobstermind:reminders] ✅ Created reminder for: ${new Date(remindAt).toLocaleString()} - "${text.substring(0, 50)}"`);
        return id;
      },
      
      check() {
        const now = new Date().toISOString();
        const due = db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?").all(now) as any[];
        if (due.length > 0) {
          console.log(`[lobstermind:reminders] 🔔 ${due.length} reminders due!`);
          due.forEach(r => {
            db.prepare("UPDATE reminders SET status = 'fired', fired_at = ? WHERE id = ?").run(now, r.id);
            console.log(`[lobstermind:reminders] 🔔 FIRED: "${r.text}" (context: ${r.context || 'none'})`);
          });
        }
        return due;
      },
      
      list() {
        return db.prepare("SELECT * FROM reminders WHERE status = 'pending' ORDER BY remind_at ASC").all() as any[];
      },
      
      init() {
        db.exec(`
          CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            remind_at TEXT NOT NULL,
            context TEXT,
            created_at TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            fired_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
          CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(remind_at);
        `);
        console.log('[lobstermind:reminders] Table initialized');
      }
    };
    reminderManager.init();

    // Initialize automatic capture statistics
    let autoCaptureStats = {
      totalProcessed: 0,
      totalCaptured: 0,
      lastCaptureTime: null,
      falsePositives: 0,      // Captured content that shouldn't have been
      falseNegatives: 0,      // Missed content that should have been captured
      truePositives: 0,       // Correctly captured content
      trueNegatives: 0        // Correctly ignored content
    };

    // Simple conversation context tracker to enable temporal awareness
    const conversationContext = {
      recentInputs: [] as string[],
      timestamps: [] as Date[],
      maxContextSize: 5, // Track last 5 inputs
      
      // Add a user input to context with timestamp
      addInput: function(input: string) {
        this.recentInputs.push(input);
        this.timestamps.push(new Date());
        
        // Keep only recent context
        if (this.recentInputs.length > this.maxContextSize) {
          this.recentInputs.shift();
          this.timestamps.shift();
        }
        
        console.log('[lobstermind:context] Added input to context, now tracking:', this.recentInputs.length, 'inputs');
      },
      
      // Get recent context from a certain time window (in minutes)
      getRecentContext(minutes: number = 5): string[] {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - (minutes * 60 * 1000));
        
        // Filter inputs that occurred within the specified timeframe
        const recent: string[] = [];
        for (let i = 0; i < this.timestamps.length; i++) {
          if (this.timestamps[i] > cutoffTime) {
            recent.push(this.recentInputs[i]);
          }
        }
        
        console.log('[lobstermind:context] Retrieved', recent.length, 'inputs from the last', minutes, 'minutes');
        return recent;
      },
      
      // Determine if current input is related to topics discussed recently
      hasTopicOverlap(input: string): boolean {
        const recentInputs = this.getRecentContext(5); // Last 5 minutes
        const inputLower = input.toLowerCase();
        
        for (const recent of recentInputs) {
          const recentLower = recent.toLowerCase();
          
          // Check if there are overlapping words or themes
          const inputWords = inputLower.split(/\s+/);
          for (const word of inputWords) {
            if (word.length > 3 && recentLower.includes(word) && 
                !word.match(/\b(soy|I|me|mi|he|have|was|were|the|and|that|have|for|are|but|not|had|has|with|you|this|from|they|she|will|his|can|would|could|should|all|her|were|there|been|who|did|their|time|will|into|has|more)\b/i)) {
              console.log('[lobstermind:context] Topic overlap detected with word:', word);
              return true;
            }
          }
        }
        
        return false;
      }
    };

    // Cache for computed embeddings to improve performance
    const embeddingCache = new Map<string, number[]>();
    const MAX_CACHE_SIZE = 1000;
    const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'qwen/qwen3-embedding-8b';
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    let useRealEmbeddings = true;
    
    const embedFallback = (t: string) => {
      const h = createHash('sha256').update(t).digest('hex');
      const v: number[] = [];
      for (let i = 0; i < 384; i += 4) {
        v.push((parseInt(h.slice(i % 64, (i % 64) + 4), 16) / 0xFFFFFFFF) * 2 - 1);
      }
      return v;
    };

    const embedReal = async (t: string): Promise<number[]> => {
      if (embeddingCache.has(t)) return embeddingCache.get(t)!;
      try {
        const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EMBEDDING_MODEL, input: t.substring(0, 2000) })
        });
        if (!res.ok) throw new Error(`Embedding API ${res.status}`);
        const data = await res.json();
        const vec = data.data?.[0]?.embedding;
        if (!vec || vec.length === 0) throw new Error('Empty embedding');
        if (embeddingCache.size >= MAX_CACHE_SIZE) {
          const firstKey = embeddingCache.keys().next().value;
          if (firstKey) embeddingCache.delete(firstKey);
        }
        embeddingCache.set(t, vec);
        return vec;
      } catch (err) {
        console.error('[lobstermind] Embedding API failed, using fallback:', err);
        return embedFallback(t);
      }
    };

    // Sync wrapper for backward compat (most callers use sync)
    const embed = (t: string): number[] => {
      // Use cached real embeddings if available, otherwise fallback sync
      if (embeddingCache.has(t)) return embeddingCache.get(t)!;
      return embedFallback(t);
    };

    // Async version for new code that can await
    const embedAsync = embedReal;
    
    // Clear embedding cache for memory management
    const clearCache = () => {
      embeddingCache.clear();
      console.log('[lobstermind] Embedding cache cleared');
    };
    
    // Preload cache with embeddings from DB to avoid recalculation on startup
    const preloadEmbeddings = () => {
      try {
        console.log('[lobstermind] Preloading embeddings into cache...');
        const memories = db.prepare('SELECT content, embedding FROM memories LIMIT 500').all() as any[]; // Limit to avoid overwhelming
        
        memories.forEach(row => {
          try {
            const content = row.content;
            if (!embeddingCache.has(content)) {
              const embedding = JSON.parse(row.embedding);
              if (!embeddingCache.has(content)) {
                embeddingCache.set(content, embedding);
              }
            }
          } catch (e) {
            console.warn('[lobstermind] Failed to preload embedding:', e);
          }
        });
        
        console.log(`[lobstermind] Preloaded ${embeddingCache.size} embeddings into cache`);
      } catch (err) {
        console.error('[lobstermind] Error during embedding preload:', err);
      }
    };
    
    // Initialize cache at startup
    setTimeout(preloadEmbeddings, 1000); // Do it after other initialization
    
    function calculateCosineSimilarity(a: number[], b: number[]): number {
      if (a.length !== b.length || a.length === 0) return 0;
      
      const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      
      return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
    }
    
    // Security validation helper function for sensitive data
    const isSensitiveData = (content: string): boolean => {
      const sensitivePatterns = [
        // Credit card numbers (basic pattern)
        /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
        /\b(?:\d{4}[-\s]?){2}\d{4}[-\s]?\d{4}\b/,
        
        // Email addresses (common format)
        /\b[\w.-]+@[\w.-]+\.\w{2,}\b/,
        
        // Phone numbers (various formats)
        /\b\d{10}\b/, // 10 digits
        /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // (xxx) xxx-xxxx or x.x.x.x or x-x-x-x
        /\+\d{1,3}[-.\s]?\d{3,14}\b/, // International format
        
        // Passwords and credentials
        /password[:\s]+['"][^'"]+['"]\b/i,
        /clave[:\s]+['"][^'"]+['"]\b/i,
        /credential[:\s]+['"][^'"]+['"]\b/i,
        /apikey[:\s]+['"][^'"]+['"]\b/i,
        /token[:\s]+['"][^'"]+['"]\b/i,
        /secret[:\s]+['"][^'"]+['"]\b/i,
        /auth[:\s]+['"][^'"]+['"]\b/i,
        /api[_-]?(?:key|token|secret)[:\s]+['"][^'"]+['"]\b/i,
        
        // Government IDs
        /\b\d{9}\b/, // SSN or similar
        /\d{3}-\d{2}-\d{4}/, // SSN format
        /\b[A-Z]{1,2}\d{6,8}\b/i, // Generic ID format
        
        // Bank account numbers and routing numbers
        /\b\d{8,12}\b/, // Basic bank account pattern
        /\d{3}[-\s]?\d{4}[-\s]?\d{4}\s?\d{1,2}\b/, // Routing + account
        
        // IP addresses
        /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
        
        // Bitcoin/etherium wallet addresses
        /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/, // Bitcoin
        /\b0x[a-fA-F0-9]{40}\b/, // Ethereum
        
        // Keywords that might indicate sensitive content
        /\bpwd\b|\bpass\b/i,
        /contraseña|clave|usuario|username/i
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(content)) {
          console.log('[lobstermind] 🚨 Blocked sensitive data from storage');
          return true;
        }
      }

      return false;
    };

    const save = (c: string, t = 'MANUAL', conf = 0.9, tags?: string) => {
      // Security check: do not save sensitive data
      if (isSensitiveData(c)) {
        console.log('[lobstermind] ❌ Save blocked: sensitive data detected');
        return null; // Don't save anything
      }
      
      const id = createHash('sha256').update(c).digest('hex').slice(0,16);
      const now = new Date().toISOString();
      const embedding = embed(c);
      
      db.prepare('INSERT OR REPLACE INTO memories (id,content,type,confidence,tags,embedding,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,c,t,conf,tags||null,JSON.stringify(embedding),now,now);

      console.log('[lobstermind] Raw save called with params:', { content: c.substring(0, 50), type: t, confidence: conf });

      // Create relations to similar existing memories
      linkMemories(c, id).catch(console.error); // Fire and forget - don't block save operation
      
      // Assign to a cluster
      assignToCluster(id, c, embedding).catch(console.error); // Fire and forget - don't block save operation
      
      // Obsidian sync
      try {
        const date = now.split('T')[0];
        const obs = join(obsidianDir, 'Memories.md');
        const entry = '- [' + t + '] ' + c + ' (confidence: ' + conf.toFixed(2) + ')\n';
        if (!existsSync(obs)) {
          writeFileSync(obs, `# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n## [[${date}]]\n\n${entry}\n`, 'utf-8');
        } else {
          const e = readFileSync(obs, 'utf-8'); 
          if (!e.includes(entry.trim())) appendFileSync(obs, entry, 'utf-8');  
        }
        console.log('[lobstermind] ✅ Synced to Obsidian');
      } catch (err: any) { console.error('[lobstermind] ❌ Obsidian sync error:', err.message); }
      
      // Native MEMORY.md sync
      try {
        const nativePath = join(ws, 'MEMORY.md');
        const nativeEntry = '- [' + t + '] ' + c + ' (confidence: ' + conf.toFixed(2) + ')\n';
        let content = '';
        if (existsSync(nativePath)) {
          content = readFileSync(nativePath, 'utf-8');
        } else {
          writeFileSync(nativePath, '# Memories\n\nAuto-created by LobsterMind Memory plugin\n\n', 'utf-8');
          content = '';
        }
        if (!content.includes(nativeEntry.trim())) {
          appendFileSync(nativePath, nativeEntry, 'utf-8');
          console.log('[lobstermind] ✅ Synced to MEMORY.md');
        }
      } catch (err: any) { console.error('[lobstermind] ❌ MEMORY.md sync error:', err.message); }
      
      console.log('[lobstermind] Saved [' + t + ']:', c.slice(0, 40));
      return id;
    };
    
    // Memory relations: Find and create relationships between memories automatically
    async function linkMemories(content: string, newMemoryId: string) {
      try {
        // Calculate similarity to existing memories in last 50 entries
        const existing = db.prepare('SELECT id, content, embedding FROM memories ORDER BY created_at DESC LIMIT 50').all() as any[];
        const newEmbedding = embed(content);  // Use cached embedding function
        
        console.log(`[lobstermind] Checking relations for "${content.substring(0, 40)}"... Found ${existing.length} existing memories`);
        
        // Batch prepare statement for better performance
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO memory_relations (from_id, to_id, relation_type, weight, created_at) 
          VALUES (?, ?, ?, ?, ?)
        `);
        
        // Transaction for better performance
        const transaction = db.transaction(() => {
          for (const memory of existing) {
            if (memory.id === newMemoryId) continue;
            
            // Use our cached embeddings
            const memEmbedding = JSON.parse(memory.embedding || '[]');
            const similarity = calculateCosineSimilarity(newEmbedding, memEmbedding) || 0;
            
            if (similarity >= 0.6) {  // Link if 60% similar
              // Use batch prepared statement
              stmt.run(newMemoryId, memory.id, 'related_to', similarity, new Date().toISOString());
              stmt.run(memory.id, newMemoryId, 'related_by', similarity * 0.7, new Date().toISOString());
              
              console.log(`[lobstermind] Linked: "${content.substring(0,40)}" ↔ "${memory.content.substring(0,40)}" (similarity: ${similarity.toFixed(2)})`);
            }
          }
        });
        
        transaction();
        
        console.log(`[lobstermind] Completed relation check, processed ${existing.length} memories`);
      } catch (err: any) {
        console.error('[lobstermind] Relations error:', err.message);
      }
    }
    
    // Cluster management functions
    const assignToCluster = (memoryId: string, content: string, embedding: number[]): void => {
      try {
        // Convert embedding to JSON string
        const embeddingJson = JSON.stringify(embedding);
        
        // Get all existing clusters
        const clusters = db.prepare(`
          SELECT cluster_id, name, centroid_embedding 
          FROM memory_clusters
        `).all() as any[];
        
        let bestClusterId: string | null = null;
        let highestSimilarity = 0.3; // Minimum threshold for assignment
        
        // Calculate similarity with each cluster centroid
        for (const cluster of clusters) {
          if (!cluster.centroid_embedding) continue;
          
          const centroid = JSON.parse(cluster.centroid_embedding);
          const similarity = calculateCosineSimilarity(embedding, centroid);
          
          if (similarity > highestSimilarity) {
            highestSimilarity = similarity;
            bestClusterId = cluster.cluster_id;
          }
        }
        
        // If no cluster is a good match, create a new cluster
        if (!bestClusterId) {
          console.log(`[lobstermind:clusters] Need to create new cluster for memory: ${content.substring(0, 50)}...`);
          
          // Generate a thematic name for the cluster based on the content
          const thematicName = generateClusterName(content);
          const newClusterId = createHash('sha256').update(`${content}-${Date.now()}`).digest('hex').slice(0, 16);
          
          // Save the new cluster
          db.prepare(`
            INSERT INTO memory_clusters (cluster_id, name, description, centroid_embedding, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(newClusterId, thematicName, `Cluster for memories related to: ${thematicName}`, embeddingJson, new Date().toISOString(), new Date().toISOString());
          
          console.log(`[lobstermind:clusters] Created new cluster: ${thematicName} (${newClusterId})`);
          
          bestClusterId = newClusterId;
        }
        
        // Assign the memory to the best fitting cluster
        if (bestClusterId) {
          db.prepare(`
            INSERT OR REPLACE INTO cluster_members (cluster_id, memory_id, similarity_score, assigned_at) 
            VALUES (?, ?, ?, ?)
          `).run(bestClusterId, memoryId, highestSimilarity, new Date().toISOString());
          
          // Update cluster centroid to include this memory
          updateClusterCentroid(bestClusterId);
          
          console.log(`[lobstermind:clusters] Assigned memory to cluster ${bestClusterId} with similarity ${highestSimilarity.toFixed(3)}`);
        }
      } catch (error) {
        console.error('[lobstermind:clusters] Error assigning to cluster:', error);
      }
    };
    
    // Generate descriptive name for a cluster based on top memories
    const generateClusterName = (initialContent: string): string => {
      let topic = "General";
      
      // Try to infer topic from the initial content
      const lowerContent = initialContent.toLowerCase();
      
      if (lowerContent.includes('boca') || lowerContent.includes('futbol') || lowerContent.includes('soccer') || lowerContent.includes('equipo')) {
        topic = "Interest in Boca";  
      }
      else if (lowerContent.includes('work') || lowerContent.includes('trabajo') || lowerContent.includes('job') || lowerContent.includes('career') || lowerContent.includes('trabajo en')) {
        topic = "Work & Career";
      }
      else if (lowerContent.includes('live') || lowerContent.includes('vivo') || lowerContent.includes('home') || lowerContent.includes('casa') || lowerContent.includes('city')) {
        topic = "Location & Home";
      }
      else if (lowerContent.includes('family') || lowerContent.includes('familia') || lowerContent.includes('parents') || lowerContent.includes('padre') || lowerContent.includes('madre')) {
        topic = "Family";
      }
      else if (lowerContent.includes('like') || lowerContent.includes('gusta') || lowerContent.includes('love') || lowerContent.includes('prefer') || lowerContent.includes('dislike') || lowerContent.includes('no me gusta')) {
        topic = "Preferences";
      }
      else if (lowerContent.includes('study') || lowerContent.includes('learn') || lowerContent.includes('education') || lowerContent.includes('estudio') || lowerContent.includes('university')) {
        topic = "Education";
      }
      else if (lowerContent.includes('habits') || lowerContent.includes('rutinas') || lowerContent.includes('daily') || lowerContent.includes('every day')) {
        topic = "Daily Habits";
      }
      
      return topic;
    };
    
    // Update cluster centroid to reflect the average of member embeddings
    const updateClusterCentroid = (clusterId: string): void => {
      try {
        // Get all members of the cluster
        const members = db.prepare(`
          SELECT m.embedding 
          FROM cluster_members cm
          JOIN memories m ON cm.memory_id = m.id
          WHERE cm.cluster_id = ?
        `).all(clusterId) as any[];
        
        if (members.length === 0) return;
        
        // Calculate average embedding (centroid)
        const embeddingArrays = members.map(member => JSON.parse(member.embedding));
        const dimensionCount = embeddingArrays[0].length;
        const centroid = new Array(dimensionCount).fill(0);
        
        // Sum all embeddings
        for (const embedding of embeddingArrays) {
          for (let i = 0; i < dimensionCount; i++) {
            centroid[i] += embedding[i];
          }
        }
        
        // Average the values
        for (let i = 0; i < dimensionCount; i++) {
          centroid[i] /= embeddingArrays.length;
        }
        
        // Save the centroid back to the cluster table
        db.prepare(`
          UPDATE memory_clusters 
          SET centroid_embedding = ?, updated_at = ?
          WHERE cluster_id = ?
        `).run(JSON.stringify(centroid), new Date().toISOString(), clusterId);
        
      } catch (error) {
        console.error('[lobstermind:clusters] Error updating cluster centroid:', error);
      }
    };
    
    // Recalculate clusters periodically or when needed to ensure coherence
    function recalculateAllClusters() {
      try {
        console.log('[lobstermind:clusters] Recalculating all clusters...');
        
        // Delete all existing cluster memberships (not clusters themselves, as we want to keep descriptions)
        db.prepare('DELETE FROM cluster_members').run();
        
        // Get all memories
        const memories = db.prepare('SELECT id, content, embedding FROM memories').all() as any[];
        
        console.log(`[lobstermind:clusters] Assigning ${memories.length} memories to clusters...`);
        
        // Reassign each memory to a cluster
        for (const mem of memories) {
          try {
            const embedding = JSON.parse(mem.embedding);
            assignToCluster(mem.id, mem.content, embedding);
          } catch (e) {
            console.error('[lobstermind:clusters] Error assigning memory to cluster:', e);
          }
        }
        
        console.log('[lobstermind:clusters] ✓ Cluster recalculation complete');
        return true;
      } catch (error) {
        console.error('[lobstermind:clusters] Error recalculating clusters:', error);
        return false;
      }
    }
    
    // Helper function to get cluster by id or name
    function getClosestCluster(query: string): any {
      // First check by cluster_id
      let cluster = db.prepare('SELECT * FROM memory_clusters WHERE cluster_id = ?').get(query) as any;
      if (cluster) return cluster;
      
      // Then check by name (partial match)
      cluster = db.prepare('SELECT * FROM memory_clusters WHERE name LIKE ?').get(`%${query}%`) as any;
      return cluster;
    }
    
    // Cache for search queries
    const searchCache = new Map<string, any[]>();
    const MAX_SEARCH_RESULTS_CACHE = 100;
    const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    
    // Optimized search function with caching
    function search(q: string, k: number = 8) { 
      // Check if similar query exists in cache
      const cacheKey = `${q.substring(0, 100)}_${k}`;
      const cachedResult = searchCache.get(cacheKey);
      if (cachedResult && Date.now() - (cachedResult.timestamp || 0) < SEARCH_CACHE_TTL) {
        console.log(`[search] Using cached result for query "${q.substring(0, 50)}..."`);
        return cachedResult.data;
      }
  
      const qe = embed(q); 
      const allMemories = db.prepare('SELECT * FROM memories').all() as any[];
      console.log(`[search] Searching in ${allMemories.length} memories for query: "${q.substring(0, 50)}..."`);
      
      // Filter first to reduce unnecessary computations
      const scoredRaw = allMemories.map(m => ({
        m,
        emb: JSON.parse(m.embedding || '[]')
      }));
      
      const scoredWithSimilarities = scoredRaw.map(item => ({
        ...item.m,
        score: calculateCosineSimilarity(qe, item.emb) || 0  // Use the same similarity function from elsewhere
      }));
      
      const results = scoredWithSimilarities
        .filter((m: any) => m.score >= 0.3) 
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, k);
      
      console.log(`[search] Retrieved ${results.length} memories with scores >= 0.3:`, results.map((r: any) => `${r.type}:${r.score.toFixed(3)}`));

      // Add to cache
      if (searchCache.size >= MAX_SEARCH_RESULTS_CACHE) {
        // Remove oldest cached item
        const firstKey = searchCache.keys().next().value;
        if (firstKey) searchCache.delete(firstKey);
      }
      
      // Store with timestamp
      searchCache.set(cacheKey, {
        data: results,
        timestamp: Date.now()
      });
      
      return results; 
    };
    
    // Advanced automatic capture system - detecting user input automatically
    // This function applies anti-noise filtering and smart identification
    const processUserInputForMemory = (content: string) => {
      autoCaptureStats.totalProcessed++;
      
      // === Mejora #1: Track patterns (B+C: Stopwords + Semántica) ===
      patternTracker.track(content);
      
      // Add to conversation context for future reference
      conversationContext.addInput(content);
      
      console.log(`[lobstermind:auto-capture] Processing user input: "${content.substring(0, 150)}..."`);
      
      // Use contextual information to improve capture logic
      const hasContextualRelevance = conversationContext.hasTopicOverlap(content);
      
      // Filter out noise: questions, greetings, very short messages, commands
      const trimmedContent = content.trim();
      if (trimmedContent.length < 10) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ✂️ Skipped: too short (<10 chars)');
        return false;
      }
      
      // Skip questions
      if (trimmedContent.endsWith('?') || /[¿?]/.test(trimmedContent)) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ❓ Skipped: appears to be a question');
        return false;
      }
      
      // Skip command-like statements (starting with specific command words)
      if (/^(please|could you|can you|tell me|show me|help me|give|list|show)/i.test(trimmedContent)) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] ⚙️ Skipped: appears to be a command');
        return false;
      }
      
      // Skip greetings and pleasantries (but be more restrictive than before)
      if (/^($|hi|hello|hola|hey|good morning|buenos días|gracias|thanks|thank you|please|i see|ok|okay|sure|umm|ah|oh)$/i.test(trimmedContent.toLowerCase().replace(/[.,!?]/g, ''))) {
        autoCaptureStats.trueNegatives++;
        console.log('[lobstermind:auto-capture] 💬 Skipped: appears to be a greeting or pleasantries');
        return false;
      }
      
      // Contextual enhancement: if there's topic overlap with recent conversation
      // and the content is meaningful, increase likelihood of capture
      const isMeaningfulWithContext = trimmedContent.length > 15 && hasContextualRelevance;
      
      // Check if the content includes meaningful personal information
      // Look for indicators of personal info in Spanish/English
      const personalInfoPatterns = [
        /soy |I am |I'm |me llamo |my name is |I go by |I use |I prefer |adore |prefiero |I work |trabajo |I live |vivo |I studied |I studied at /i,
        /mi nombre es |I am from |soy de |from |I support |soy fan |fan de |I'm a supporter |I am a fan |afición a |pasión por |me apasiona |interés en /i,
        /I decided |decidí |elegí |mi rutina es |hábitos diarios |always eat |almuerzo /i
      ];
      
      let hasPersonalInfo = false;
      for (const pattern of personalInfoPatterns) {
        if (pattern.test(trimmedContent)) {
          hasPersonalInfo = true;
          break;
        }
      }
      
      if (!hasPersonalInfo) {
        // Additional check for valuable statements that don't match obvious patterns
        const contentLower = trimmedContent.toLowerCase();
        const valuableIdentifiers = ['Boca', 'soy de', 'de Boca', 'trabajo en', 'me llamo', 'mi nombre', 'mi hobby', 'soy fan', 'soy hincha', 'I am from', 'I work at', 'mi profesión', 'mi trabajo', 'mi posición'];
        hasPersonalInfo = valuableIdentifiers.some(identifier => contentLower.includes(identifier.toLowerCase()));
      }
      
      // Consider both personal info detection and contextual relevance
      const shouldCheckClassification = hasPersonalInfo || isMeaningfulWithContext;
      
      if (shouldCheckClassification) {
        console.log('[lobstermind:auto-capture] 🎯 Identified potential personal info or contextual relevance, checking with classifier...');
        
        // Use the improved classifier
        const classified = classifyMemoryContent(content);
        if (classified.shouldSave) {
          console.log(`[lobstermind:auto-capture] ✅ Auto-captured [${classified.type}] (confidence: ${classified.confidence.toFixed(2)}, contextual: ${isMeaningfulWithContext}): ${classified.content.substring(0, 80)}...`);
          save(classified.content, classified.type, classified.confidence);
          autoCaptureStats.totalCaptured++;
          autoCaptureStats.truePositives++;
          autoCaptureStats.lastCaptureTime = new Date().toISOString();
          return true;
        } else {
          // This might have been a legitimate piece of info, but classifier rejected it - potential misclassification
          autoCaptureStats.falseNegatives++;
          console.log('[lobstermind:auto-capture] ❌ Classifier decided not to save (potential false negative)');
          return false;
        }
      } else {
        autoCaptureStats.trueNegatives++;  // Correctly ignored non-personal information
        console.log('[lobstermind:auto-capture] ℹ️ Skipped: no personal info detected and no contextual relevance');
        return false;
      }
    };
    
    // Define memory content classifier with enhanced logging
    function classifyMemoryContent(rawContent: string): { content: string, type: string, confidence: number, shouldSave: boolean } {
      // Remove special tags and normalize
      const cleanContent = rawContent.replace(/<[\/]?memory_note[^>]*>/g, '').trim();
      
      console.log(`[classifier] Analyzing: "${cleanContent.substring(0, 100)}..."`);
      
      // Extra validation to make sure we are not saving sensitive data that slipped past the initial filters
      if (isSensitiveData(cleanContent)) {
        console.log(`[classifier] 🚨 BLOCKED: Sensitive data detected in content "${cleanContent.substring(0, 50)}..."`);
        return {
          content: cleanContent,
          type: 'SENSITIVE_BLOCKED',
          confidence: 1.0,
          shouldSave: false
        };
      }
      
      // Extract important phrases for classification instead of strict regex
      const lowerContent = cleanContent.toLowerCase();
      const normalizedContent = lowerContent.replace(/\b(the|a|an|un|una|el|la|los|las|en|con|de|del|de\s+la|to|with|my|his|her|me|him|her|i|you|we|they)\b/gi, ' ').trim();
      
      console.log(`[classifier] Normalized: "${normalizedContent.substring(0, 100)}..."`);
      
      // Multi-lang patterns for detection 
      const patterns: { regex: RegExp, type: string, confidence: number, desc: string }[] = [
        // PREFERENCES (likes/dislikes in multiple languages)
        { 
          regex: /(like|love|adore|prefer|enjoy|gusta|amo|adoro|prefiero|me gusta la|me encanta|detesto|odio|no gusto|no me gusta|nunca)/i, 
          type: 'PREFERENCE', 
          confidence: 0.95,
          desc: 'preferences'
        },
        // PERSONAL FACTS (identity in multiple languages)
        { 
          regex: /\b(I\s+am|I'm|soy|yo\s+soy|mi\s+nombre\s+es|llamo|trabajo\s+en|works\s+at|work\s+for|job|posición|cargo|profesión|posicion|position|empleo|vivo\s+en|live\s+in|habito|resido|estudio|study|learning|learn|aprendiendo|de\s+Boca|from\s+Boca|fan\s+of|supporter|soy\s+de|cumpleaños|birthday|nací|nacio|born|cumple|mi\s+lugar\s+de\s+nacimiento|birthplace|edad|age|hobbies|activities|activity|pasatiempos|intereses)/i, 
          type: 'USER_FACT', 
          confidence: 0.90,
          desc: 'personal facts'
        },
        // CONTACT INFO (should NOT be saved due to privacy)
        { 
          regex: /(@|phone|teléfono|móvil|celular|email|correo|dirección|address|tel\s*:|fax\s*:|contact\s*:)/i, 
          type: 'CONTACT_INFO', 
          confidence: 0.99,
          desc: 'contact info (sensitive)'
        },
        // DECISIONS/TIMELINE (choices in multiple languages)
        { 
          regex: /\b(decidí|decid|elegí|elig|tomé|took|chose|opté|opt|picked|select|choice|decision|since|desde|durante|por\s+más\s+de|for\s+more\s+than|I started|comencé|empezar|tiempo\s+que\s+llev|llev|llevo\s+)/i, 
          type: 'DECISION', 
          confidence: 0.90,
          desc: 'decisions'
        },
        // HABITS/ROUTINES (patterns that suggest regular activities)
        { 
          regex: /\b(todos\s+los\s+días|every\s+day|daily|habitualmente|siempre|usualmente|regular|constantemente|routinely|normally|generally|me\s+llevo\s+mi|always\s+have|usually\s+takes|normalmente\s+hago|generalmente\s+tomo|siempre\s+que|cada\s+vez\s+que)/i, 
          type: 'HABIT', 
          confidence: 0.85,
          desc: 'habits and routines'
        },
        // EDUCATION/STUDIES
        { 
          regex: /\b(studied|\s+studying|\s+learned\b|education|school|university|college|graduated|formation|estudié|estudio|aprendí|formación|escuela|universidad|instituto|carrera|cursando|matriculado|cursada|aulas|clases)/i, 
          type: 'EDUCATION', 
          confidence: 0.85,
          desc: 'education'
        },
        // WORK/HISTORY
        { 
          regex: /\b(empresa|company|trabajo\s+anterior|experiencia|\s+worked\s+at|colleague|coworker|boss|manager|jefe|compañero|project|cliente|cliente|sales|ventas|marketing|ingenier|developer|engineer|position|rol|función|cargo|departamento|department|team)/i, 
          type: 'WORK_HISTORY', 
          confidence: 0.85,
          desc: 'work history'
        },
        // TECH/WORK DETAILS
        { 
          regex: /\b(used|working|developing|building|coded|programming|coded\s+with|writing\s+in|create|created|built|made|desarrollando|trabajando|usé|utiliz|programe|programé|uso|creando|construyendo|react|javascript|typescript|python|java|node|express|angular|vue|backend|frontend|fullstack|web\s+development|mobile\s+development|api|rest|graphql|database|sql|mongo|firebase|docker|kubernetes|aws|azure|cloud|machine\s+learning|ai|artificial\s+intelligence|mlops|devops)/i, 
          type: 'TECH_SKILL', 
          confidence: 0.80,
          desc: 'technical skills and details'
        },
        // RELATIONSHIPS/FRIENDSHIP INFO
        { 
          regex: /\b(mi\s+papá|mi\s+mamá|padre|madre|hermano|hermana|cónyuge|esposo|esposa|novio|novia|pareja|relación|friend|amigo|amiga|amigos|amiguitos|compañeros|mates|familia|fam|son|daughter|wife|husband|boyfriend|girlfriend|children|kids)/i, 
          type: 'RELATIONSHIP', 
          confidence: 0.80,
          desc: 'relationships'
        },
        // IMPORTANT NUMBERS/PIN CODES (should NOT be saved)
        { 
          regex: /\bpin\s*:|clave\s+:|code\s*:|password\s*:|contraseña\s+:|123456|0000|1111|2222|3333|4444|5555|6666|7777|8888|9999|\d{4}\s+\d{4}\s+\d{4}\s+\d{4}|\d{16}\b/i, 
          type: 'SECURITY_PIN', 
          confidence: 0.99,
          desc: 'security codes (sensitive)'
        },
      ];
      
      // Scan for pattern matches
      for (const { regex, type, confidence, desc } of patterns) {
        if (regex.test(normalizedContent)) {
          // Block sensitive info patterns
          if (type === 'CONTACT_INFO' || type === 'SECURITY_PIN') {
            console.log(`[classifier] 🚨 BLOCKED ${desc} -> Type: ${type}, Confidence: ${confidence}`);
            return {
              content: cleanContent,
              type: type,
              confidence: confidence,
              shouldSave: false
            };
          }
          
          console.log(`[classifier] MATCHED ${desc} pattern -> Type: ${type}, Confidence: ${confidence}`);
          return {
            content: cleanContent,
            type: type,
            confidence: confidence,
            shouldSave: true
          };
        }
      }
      
      // More specific identity patterns including those in your example
      if (cleanContent.length >= 20 && !cleanContent.includes('?') && 
          (lowerContent.includes('i ') || lowerContent.includes('i\'') || lowerContent.includes(' mi ') || 
           lowerContent.includes(' soy ') || lowerContent.includes(' trabajo ') || lowerContent.includes(' vivo ') ||
           lowerContent.includes(' me llamo ') || lowerContent.includes(' mi hobby ') || lowerContent.includes(' pasatiempos '))) {
        console.log(`[classifier] GENERAL IDENTITY statement detected -> Type: USER_FACT, Confidence: 0.75`);
        return {
          content: cleanContent,
          type: 'USER_FACT',
          confidence: 0.75,  // Medium-high confidence for identity statements
          shouldSave: true
        };
      }
      
      // Specific keywords related to user profile/identity that were mentioned in your instructions
      if (cleanContent.length >= 15 && (cleanContent.includes('Boca') || cleanContent.includes('de Boca'))) {
        console.log(`[classifier] SPECIFIC USER IDENTITY (Boca fan) detected: "${cleanContent}"`);
        return {
          content: cleanContent,
          type: 'USER_FACT',
          confidence: 0.95,
          shouldSave: true
        };
      }
      
      // Don't save if not meaningful
      console.log(`[classifier] ❌ No meaningful pattern matched for: "${cleanContent.substring(0, 50)}..."`);
      return {
        content: cleanContent,
        type: 'IGNORE',
        confidence: 0.0,
        shouldSave: false
      };
    } 

    // Enhanced hook registration for memory detection - Adapting to OpenClaw's system
    if (api.hooks?.onMessageCreate || api.hooks?.afterMessage) {
      // Use proper OpenClaw hook if available - with preference for afterMessage for final processed content
      const messageHook = api.hooks?.afterMessage || api.hooks?.onMessageCreate;
      const hookName = api.hooks?.afterMessage ? 'afterMessage' : 'onMessageCreate';
      
      messageHook((message: any, ctx: any) => {
        console.log(`[lobstermind] ${hookName} hook triggered. Content: ${typeof message?.content === 'string' ? message.content.substring(0, 100) : 'non-string content'}`);
        
        if (message?.role === 'user' && message?.content) {
          const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          
          // Check for Gigabrain memory note protocol in user messages
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            console.log('[lobstermind] Detected Gigabrain memory_note protocol');
            extractMemoryFromNoteTags(content).forEach(memory => {
              save(memory.content, memory.type, memory.confidence);
            });
          }
          
          // Process for automatic capture using the new system
          processUserInputForMemory(content);
        }
      });
    } else if (api.hooks?.conversationParticipantInput) {
      // Hook specifically for participant input (as suggested in your request)
      api.hooks.conversationParticipantInput((input: string | any, context: any) => {
        console.log(`[lobstermind] conversationParticipantInput hook triggered. Input: ${typeof input === 'string' ? input.substring(0, 100) : 'non-string input'}`);
        
        const content = typeof input === 'string' ? input : (input?.content || JSON.stringify(input || ''));
        if (content && typeof content === 'string') {
          // Check for Gigabrain memory note protocol
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            console.log('[lobstermind] Detected Gigabrain memory_note in participant input');
            extractMemoryFromNoteTags(content).forEach(memory => {
              save(memory.content, memory.type, memory.confidence);
            });
          } 
          else {
            // Process for automatic capture
            processUserInputForMemory(content);
          }
        }
      });
    } else if (api.registerMiddleware) {
      // Alternative middleware registration
      api.registerMiddleware({
        priority: 999, // High priority to capture messages early
        handler: (ctx: any, next: () => Promise<any>) => {
          if (ctx?.request?.messages) {
            const userMessages = ctx.request.messages.filter((msg: any) => msg.role === 'user');
            userMessages.forEach((msg: any) => {
              if (msg.content) {
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                
                // Check for Gigabrain memory note protocol
                if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
                  console.log('[lobstermind] Detected Gigabrain memory_note in middleware');
                  extractMemoryFromNoteTags(content).forEach(memory => {
                    save(memory.content, memory.type, memory.confidence);
                  });
                } 
                else {
                  // Process for automatic capture
                  processUserInputForMemory(content);
                }
              }
            });
          }
          return next();
        }
      });
    } else {
      // Fallback to available hooks with correct signature that OpenClaw supports
      console.log('[lobstermind] Using fallback hook registration approach');
      
      // Instead of trying many random event names, we'll check for known OpenClaw hooks
      // and register appropriately - this addresses the warnings from the doctor
      
      // Known functional OpenClaw hooks
      if (typeof api.hooks?.onMessageCreate === 'function') {
        api.hooks.onMessageCreate((message: any) => {
          console.log('[lobstermind] onMessageCreate hook triggered for automatic capture');
          const content = typeof message === 'string' ? message : (message?.content || message?.message || '');
          if (content && typeof content === 'string') {
            console.log(`[lobstermind] Processing content from onMessageCreate: ${content.substring(0, 100)}...`);
            processContentForMemory(content);
          }
        });
        console.log('[lobstermind] Registered official hook: onMessageCreate');
      } else if (typeof api.hooks?.afterMessage === 'function') {
        api.hooks.afterMessage((message: any) => {
          console.log('[lobstermind] afterMessage hook triggered for automatic capture');
          const content = typeof message === 'string' ? message : (message?.content || message?.message || '');
          if (content && typeof content === 'string') {
            console.log(`[lobstermind] Processing content from afterMessage: ${content.substring(0, 100)}...`);
            processContentForMemory(content);
          }
        });
        console.log('[lobstermind] Registered official hook: afterMessage');
      } else if (typeof api.hooks?.beforeRequest === 'function') {
        api.hooks.beforeRequest((context: any) => {
          console.log('[lobstermind] beforeRequest hook triggered for automatic capture');
          const content = context?.input || context?.user_input || (context?.content || '');
          if (content && typeof content === 'string') {
            console.log(`[lobstermind] Processing content from beforeRequest: ${content.substring(0, 100)}...`);
            processContentForMemory(content);
          }
        });
        console.log('[lobstermind] Registered official hook: beforeRequest');
      }
                
      // Helper function to handle various content sources
      function processContentForMemory(content: string) {
        if (content && typeof content === 'string') {
          // Check for Gigabrain memory note protocol
          if (content.includes('<memory_note>') && content.includes('</memory_note>')) {
            console.log('[lobstermind] Detected Gigabrain memory_note protocol in event');
            extractMemoryFromNoteTags(content).forEach(memory => {
              save(memory.content, memory.type, memory.confidence);
            });
          } else {
            // Process for automatic capture
            processUserInputForMemory(content);
          }
        }
      }
    }
    
    // Helper function to extract memories from Gigabrain-style <memory_note> tags
    function extractMemoryFromNoteTags(content: string): Array<{content: string, type: string, confidence: number}> {
      const notePattern = /<memory_note(?:\s+type=["']([A-Z_]+)["']\s*|\s+)confi(?:dence)?=["'](\d*\.?\d+)["']>(.*?)<\/memory_note>/gs;
      const results: Array<{content: string, type: string, confidence: number}> = [];
      
      let match;
      while ((match = notePattern.exec(content)) !== null) {
        const type = match[1] || 'USER_FACT';
        const confidenceStr = match[2] || '0.9';
        const extractedContent = match[3]?.trim() || '';
        
        if (extractedContent) {
          results.push({
            content: extractedContent,
            type: type,
            confidence: parseFloat(confidenceStr) || 0.9
          });
        }
      }
      
      console.log(`[lobstermind] Extracted ${results.length} memories from <memory_note> tags`);
      return results;
    }
    
    // Add recall functionality with hooks that might be better supported by OpenClaw
    if (typeof api.hooks?.onPromptPrepare === 'function') {
      api.hooks.onPromptPrepare((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else if (typeof api.hooks?.beforeRequest === 'function') {
      api.hooks.beforeRequest((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else if (typeof api.hooks?.enhancePrompt === 'function') {
      api.hooks.enhancePrompt((ctx: any) => {
        recallAndInjectMemories(ctx);
      });
    } else {
      // For recall, try to use only established OpenClaw hooks instead of generic event names
      // Use proper api.hooks patterns
      if (typeof api.hooks?.beforeResponse === 'function') {
        api.hooks.beforeResponse((ctx: any) => {
          console.log('[lobstermind] Recall trigger: beforeResponse');
          recallAndInjectMemories(ctx);
        });
        console.log('[lobstermind] Registered recall hook for beforeResponse');
      } else if (typeof api.hooks?.beforePrompt === 'function') {
        api.hooks.beforePrompt((ctx: any) => {
          console.log('[lobstermind] Recall trigger: beforePrompt');
          recallAndInjectMemories(ctx);
        });
        console.log('[lobstermind] Registered recall hook for beforePrompt');
      }
    }

    // Central recall function that handles memory injection
    function recallAndInjectMemories(ctx: any) {
      try {
        console.log('[lobstermind] 🧠 Starting recall process');
        
        // Find the most recent user message to use as query
        let messages = [];
        
        if (ctx?.messages) {
          messages = ctx.messages;
        } else if (ctx?.request?.messages) {
          messages = ctx.request.messages;
        } else if (ctx?.conversation?.messages) {
          messages = ctx.conversation.messages;
        } else if (ctx?.state?.messages) {
          messages = ctx.state.messages;
        }
        
        if (!messages || messages.length === 0) {
          console.log('[lobstermind] No messages found for recall');
          return;
        }
        
        // Get relevant user messages (last few user messages as queries)
        const userMessages = messages.filter((m: any) => m?.role === 'user' && m?.content).slice(-3);
        
        if (userMessages.length > 0) {
          // Use the most recent user message as the primary query
          const lastUserMessage = userMessages[userMessages.length - 1];
          const userQuery = typeof lastUserMessage.content === 'string' 
            ? lastUserMessage.content 
            : JSON.stringify(lastUserMessage.content || '');
            
          if (userQuery.length < 5) {
            console.log('[lobstermind] Query too short for recall');
            return;
          }
          
          console.log(`[lobstermind] 🔎 Recalling memories for query: "${userQuery.substring(0, 100)}"`);
          
          // Find relevant memories
          const relevantMemories = search(userQuery, 5);
          
          if (relevantMemories.length > 0) {
            console.log(`[lobstermind] 🧠 Found ${relevantMemories.length} relevant memories`);
            
            // Construct memory note
            const memoryNote = `\n<memory_note>\n### MEMORY NOTE (${new Date().toISOString()}):\n${relevantMemories.map((mem: any, idx: number) => `${idx + 1}. [${mem.type}] ${mem.content} (confidence: ${Number(mem.score).toFixed(3)})`).join('\n')}\n</memory_note>`;
            
            // Try various methods to inject the memory in different contexts
            if (ctx?.prepends) {
              ctx.prepends.push({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.prepends');
            } else if (ctx?.injects) {
              ctx.injects.push({ type: 'memory', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.injects');
            } else if (ctx?.augments) {
              ctx.augments.push({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to ctx.augments');
            } else if (messages && Array.isArray(messages)) {
              messages.unshift({ role: 'system', content: memoryNote });
              console.log('[lobstermind] Added memory to beginning of messages array');
            } else {
              console.log('[lobstermind] Could not inject memory - no suitable target found');
            }
            
            console.log('[lobstermind] ✅ Memory recall completed');
          } else {
            console.log('[lobstermind] 🌀 No relevant memories found for recall');
          }
        } else {
          console.log('[lobstermind] No user messages found for recall trigger');
        }
      } catch (error) {
        console.error('[lobstermind] Error in recall function:', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Register CLI commands 
    if (api.registerCli) {
      api.registerCli(
        ({program}: any) => {
          const c = program.command('memories').description('LobsterMind CLI');
          c.command('list').option('--limit <n>','Per page','20').option('--page <n>','Page number','1').action((o:any)=>{
            const limit=parseInt(o.limit)||20;
            const page=parseInt(o.page)||1;
            const offset=(page-1)*limit;
            const total=(db.prepare('SELECT COUNT(*) as c FROM memories').get()as any).c;
            const totalPages=Math.ceil(total/limit);
            const r=db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit,offset)as any[];
            console.log(`Memories: showing ${offset+1}-${Math.min(offset+r.length,total)} of ${total} (page ${page}/${totalPages})`);
            r.forEach((m:any,i:number)=>console.log((i+1+offset)+'. ['+m.type+'] '+m.content));
          });
          c.command('add <content>').action((s:string)=>{try{console.log('ID:',save(s));}catch(e:any){console.error('Error:',e.message);}});
          c.command('search <query>').action(async(q:string)=>{const r=searchWithBoost(q);console.log('Found:',r.length);r.forEach((m:any,i:number)=>console.log((i+1)+'. '+m.content+' ('+m.score.toFixed(2)+')'));});
          c.command('stats').action(()=>{const t=db.prepare('SELECT COUNT(*) as c FROM memories').get()as any;console.log('Total:',t.c);});
          c.command('backup').action(()=>{const d=join(ws,'memory','backups');if(!existsSync(d))mkdirSync(d,{recursive:true});const p=join(d,'backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');writeFileSync(p,JSON.stringify(db.prepare('SELECT * FROM memories').all(),null,2));console.log('Backup:',p);});
          // Add command for auto-capture stats
          c.command('autostats').action(()=>{console.log('Auto-capture Statistics:'); console.log('Total processed:', autoCaptureStats.totalProcessed); console.log('Total captured:', autoCaptureStats.totalCaptured); console.log('Success rate:', autoCaptureStats.totalProcessed > 0 ? (autoCaptureStats.totalCaptured/autoCaptureStats.totalProcessed*100).toFixed(1)+'%' : 'N/A'); console.log('Last capture:', autoCaptureStats.lastCaptureTime || 'Never'); console.log('True Positives:', autoCaptureStats.truePositives); console.log('True Negatives:', autoCaptureStats.trueNegatives); console.log('False Positives:', autoCaptureStats.falsePositives); console.log('False Negatives:', autoCaptureStats.falseNegatives); const precision = (autoCaptureStats.truePositives > 0) ? (autoCaptureStats.truePositives / (autoCaptureStats.truePositives + autoCaptureStats.falsePositives)).toFixed(3) : 'N/A'; const recall = (autoCaptureStats.truePositives > 0) ? (autoCaptureStats.truePositives / (autoCaptureStats.truePositives + autoCaptureStats.falseNegatives)).toFixed(3) : 'N/A'; console.log('Precision:', precision); console.log('Recall:', recall); console.log('Context window size:', conversationContext.recentInputs.length); console.log('Context awareness active:', conversationContext.timestamps.length > 0);});
          // Add command to view clusters
          c.command('clusters').option('--min-size <n>', 'Minimum cluster size', '1').action((o: any) => {
            const minSize = parseInt(o.minSize) || 1;
            const clusters = db.prepare(`SELECT c.*, COUNT(cm.memory_id) as member_count FROM memory_clusters c LEFT JOIN cluster_members cm ON c.cluster_id = cm.cluster_id GROUP BY c.cluster_id HAVING member_count >= ?`).all(minSize) as any[];
            
            console.log(`Clusters (minimum size: ${minSize}): ${clusters.length}`);
            clusters.forEach((cluster: any, i: number) => {
              console.log(`${i+1}. ${cluster.name} (${cluster.member_count} memories)`);
              console.log(`   Description: ${cluster.description}`);
              
              // Show sample memories from the cluster
              const sampleMemories = db.prepare(`
                SELECT m.content, m.type, cm.similarity_score 
                FROM cluster_members cm 
                JOIN memories m ON cm.memory_id = m.id 
                WHERE cm.cluster_id = ? 
                ORDER BY cm.similarity_score DESC 
                LIMIT 3
              `).all(cluster.cluster_id) as any[];
              
              sampleMemories.forEach(mem => {
                console.log(`   • [${mem.type}] ${mem.content.substring(0, 100)}... (sim: ${mem.similarity_score.toFixed(2)})`);
              });
            });
          });
          // Add command to show memories by cluster
          c.command('cluster <cluster-id>').action((clusterId: string) => {
            const cluster = db.prepare('SELECT * FROM memory_clusters WHERE cluster_id = ?').get(clusterId) as any;
            if (!cluster) { console.log('Cluster not found'); return; }
            console.log(`Cluster: ${cluster.name}`);
            console.log(`Description: ${cluster.description}`);
            const members = db.prepare(`SELECT m.*, cm.similarity_score FROM cluster_members cm JOIN memories m ON cm.memory_id = m.id WHERE cm.cluster_id = ? ORDER BY cm.similarity_score DESC`).all(clusterId) as any[];
            console.log(`Members (${members.length}):`);
            members.forEach((member: any, i: number) => { console.log(`${i+1}. [${member.type}] ${member.content} (sim: ${member.similarity_score.toFixed(2)})`); });
          });
          
          // ===== NEW CLI COMMANDS =====
          // Mejora #1: Patterns
          c.command('patterns').description('Show auto-detected patterns').action(() => {
            const patterns = patternTracker.getPatterns();
            console.log(`\n🔍 Auto-Detected Patterns (${patterns.length}):`);
            patterns.forEach((p: any, i: number) => { console.log(`${i+1}. [${p.type}] ${p.content.substring(0, 120)} (confidence: ${p.confidence.toFixed(2)})`); });
            patternTracker.stats();
          });
          
          // Mejora #2: Reminders
          c.command('remind <text> <when>').description('Create reminder (when: "30m", "2h", "1d", or ISO date)').action((text: string, when: string) => {
            let remindAt: string;
            const now = Date.now();
            const match = when.match(/^(\d+)(m|h|d)$/);
            if (match) {
              const multipliers: Record<string, number> = { m: 60000, h: 3600000, d: 86400000 };
              remindAt = new Date(now + parseInt(match[1]) * multipliers[match[2]]).toISOString();
            } else {
              remindAt = new Date(when).toISOString();
            }
            reminderManager.create(text, remindAt);
            console.log(`⏰ Reminder set for: ${new Date(remindAt).toLocaleString()}`);
          });
          c.command('reminders').description('List pending reminders').action(() => {
            const pending = reminderManager.list();
            console.log(`\n⏰ Pending Reminders (${pending.length}):`);
            pending.forEach((r: any, i: number) => { console.log(`${i+1}. [${new Date(r.remind_at).toLocaleString()}] ${r.text}${r.context ? ` (ctx: ${r.context})` : ''}`); });
          });
          c.command('reminders-check').description('Check and fire due reminders').action(() => {
            const due = reminderManager.check();
            if (due.length === 0) console.log('No reminders due.');
            else due.forEach((r: any) => { console.log(`🔔 ${r.text}${r.context ? ` — ${r.context}` : ''}`); });
          });
          
          // Mejora #6: Confidence
          c.command('top').description('Show top confident memories').option('-n, --number <n>', 'Limit', '10').action((o: any) => {
            const top = confidenceManager.topConfident(parseInt(o.number) || 10);
            console.log(`\n📊 Top Confident Memories:`);
            top.forEach((m: any, i: number) => { console.log(`${i+1}. [${m.confidence.toFixed(2)}] [${m.type}] ${m.content.substring(0, 100)}`); });
          });
          c.command('decay').description('Run confidence decay manually').action(() => {
            const count = confidenceManager.decayAll();
            console.log(`📉 Decayed ${count} memories`);
          });

          // ===== CLAWY MEMORY EXTENSIONS =====
          
          // Add a new session with optional TXT link
          c.command('add-session <summary>')
            .option('--txt <link>', 'GitHub link to TXT export')
            .option('--date <date>', 'Session date (YYYY-MM-DD)', new Date().toISOString().split('T')[0])
            .option('--tags <tags>', 'Comma-separated tags')
            .description('Register a new session')
            .action((summary: string, opts: any) => {
              try {
                const id = 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
                const now = new Date().toISOString();
                db.prepare('INSERT INTO sessions (id, date, txt_link, summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                  .run(id, opts.date, opts.txt || null, summary, 'active', now, now);
                console.log(`✅ Session created: ${id}`);
                console.log(`📅 Date: ${opts.date}`);
                console.log(`📄 TXT: ${opts.txt || 'sin TXT'}`);
                console.log(`📝 Summary: ${summary}`);
              } catch (e: any) { console.error('Error:', e.message); }
            });

          // List all sessions
          c.command('sessions').description('List all sessions').action(() => {
            const sessions = db.prepare('SELECT s.*, COUNT(sm.memory_id) as memory_count FROM sessions s LEFT JOIN session_memories sm ON s.id = sm.session_id GROUP BY s.id ORDER BY s.date DESC').all() as any[];
            if (sessions.length === 0) { console.log('No sessions found.'); return; }
            console.log(`\n📂 Sessions (${sessions.length}):\n`);
            sessions.forEach((s: any, i: number) => {
              console.log(`${i+1}. [${s.date}] ${s.id}`);
              console.log(`   📝 ${s.summary.substring(0, 80)}${s.summary.length > 80 ? '...' : ''}`);
              console.log(`   📄 TXT: ${s.txt_link || 'sin TXT'}`);
              console.log(`   🔗 Memories: ${s.memory_count} | Status: ${s.status}`);
              console.log(`   🔗 Linked: ${s.linked_session_ids || 'none'}`);
              console.log('');
            });
          });

          // Link a session to another
          c.command('link-session <session-id> <target-id>')
            .description('Link two sessions together')
            .action((sessionId: string, targetId: string) => {
              try {
                // Update source
                const src = db.prepare('SELECT linked_session_ids FROM sessions WHERE id = ?').get(sessionId) as any;
                const existing = src?.linked_session_ids ? JSON.parse(src.linked_session_ids) : [];
                if (!existing.includes(targetId)) {
                  existing.push(targetId);
                  db.prepare('UPDATE sessions SET linked_session_ids = ?, updated_at = ? WHERE id = ?')
                    .run(JSON.stringify(existing), new Date().toISOString(), sessionId);
                }
                // Update target (bidirectional)
                const tgt = db.prepare('SELECT linked_session_ids FROM sessions WHERE id = ?').get(targetId) as any;
                const tgtExisting = tgt?.linked_session_ids ? JSON.parse(tgt.linked_session_ids) : [];
                if (!tgtExisting.includes(sessionId)) {
                  tgtExisting.push(sessionId);
                  db.prepare('UPDATE sessions SET linked_session_ids = ?, updated_at = ? WHERE id = ?')
                    .run(JSON.stringify(tgtExisting), new Date().toISOString(), targetId);
                }
                console.log(`✅ Linked: ${sessionId} ↔ ${targetId}`);
              } catch (e: any) { console.error('Error:', e.message); }
            });

          // Add autoaprendizaje entry
          c.command('learn <content>')
            .option('--category <cat>', 'Category: error|preferencia|leccion|patron|regla|proyecto', 'leccion')
            .option('--importance <n>', 'Importance 1-5', '3')
            .description('Add autoaprendizaje entry')
            .action((content: string, opts: any) => {
              try {
                const id = 'learn_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
                const now = new Date().toISOString();
                db.prepare('INSERT INTO autoaprendizaje (id, content, category, importance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                  .run(id, content, opts.category, parseInt(opts.importance) || 3, now, now);
                console.log(`✅ Learned: [${opts.category}] ${content.substring(0, 80)}`);
              } catch (e: any) { console.error('Error:', e.message); }
            });

          // List autoaprendizaje
          c.command('autoaprendizaje')
            .option('--category <cat>', 'Filter by category')
            .description('Show all autoaprendizaje entries')
            .action((opts: any) => {
              let rows;
              if (opts.category) {
                rows = db.prepare('SELECT * FROM autoaprendizaje WHERE category = ? ORDER BY importance DESC').all(opts.category) as any[];
              } else {
                rows = db.prepare('SELECT * FROM autoaprendizaje ORDER BY category, importance DESC').all() as any[];
              }
              if (rows.length === 0) { console.log('No entries found.'); return; }
              console.log(`\n🧠 Autoaprendizaje (${rows.length}):\n`);
              rows.forEach((r: any, i: number) => {
                console.log(`${i+1}. [${r.category}] ⭐${r.importance} ${r.content.substring(0, 100)}`);
              });
            });
        },
        {commands: ['memories']}
      );
      console.log('[lobstermind] CLI ready');
    }

    // ============================================================
    // AUTO-CAPTURE + AUTO-INJECT (merged from clawy-memory plugin)
    // Source: https://github.com/Clawyc2/clawy-memory-backup
    // ============================================================
    console.log('[lobstermind] Loading auto-capture + auto-inject...');

    // Load env for Supabase + OpenRouter
    const AC_CONFIG = {
      OPENROUTER_KEY: '' as string,
      SUPABASE_URL: '' as string,
      SUPABASE_KEY: '' as string,
      LLM_PRIMARY: 'deepseek/deepseek-chat-v3-0324',
      LLM_FALLBACK: 'stepfun/step-3.5-flash:free',
      MAX_RECALL_RESULTS: 8,
      MIN_TURNS_FOR_PROFILE: 1,
      PROFILE_FREQUENCY: 20,
      SKIP_PROVIDERS: ['exec-event', 'cron-event', 'heartbeat', 'system'],
      CAPTURE_MIN_CHARS: 30,
    };

    try {
      const envRaw = readFileSync('/home/ubuntu/.config/clawy/.env', 'utf-8');
      for (const line of envRaw.split('\n')) {
        const match = line.match(/^([^#]\w+)=(.+)/);
        if (!match) continue;
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (key === 'OPENROUTER_API_KEY') AC_CONFIG.OPENROUTER_KEY = val;
        if (key === 'SUPABASE_URL') AC_CONFIG.SUPABASE_URL = val;
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') AC_CONFIG.SUPABASE_KEY = val;
        if (key === 'SUPABASE_ANON_KEY' && !AC_CONFIG.SUPABASE_KEY) AC_CONFIG.SUPABASE_KEY = val;
      }
    } catch (e: any) {
      console.log('[lobstermind] auto-capture: Could not load .env:', e.message);
    }

    if (!AC_CONFIG.OPENROUTER_KEY || !AC_CONFIG.SUPABASE_URL) {
      console.log('[lobstermind] auto-capture: Missing OPENROUTER_API_KEY or SUPABASE_URL — auto-capture/inject disabled');
    } else {
      console.log('[lobstermind] auto-capture: Config loaded ✅');

      // --- Supabase helpers ---
      async function acSupabaseSelect(table: string, query = '') {
        const url = `${AC_CONFIG.SUPABASE_URL}/rest/v1/${table}${query}`;
        const res = await fetch(url, {
          headers: {
            'apikey': AC_CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${AC_CONFIG.SUPABASE_KEY}`,
          }
        });
        return res.json();
      }

      async function acSupabaseInsert(table: string, data: any) {
        const url = `${AC_CONFIG.SUPABASE_URL}/rest/v1/${table}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': AC_CONFIG.SUPABASE_KEY,
            'Authorization': `Bearer ${AC_CONFIG.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(data),
        });
        return res.json();
      }

      // --- Semantic search ---
      async function acSemanticSearch(query: string, limit = AC_CONFIG.MAX_RECALL_RESULTS) {
        try {
          const embRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${AC_CONFIG.OPENROUTER_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: 'qwen/qwen3-embedding-8b', input: query }),
          });
          const embData = await embRes.json();
          if (!embData.data?.[0]?.embedding) return [];
          const embedding = embData.data[0].embedding;

          const searchUrl = `${AC_CONFIG.SUPABASE_URL}/rest/v1/rpc/search_semantic_memories`;
          const res = await fetch(searchUrl, {
            method: 'POST',
            headers: {
              'apikey': AC_CONFIG.SUPABASE_KEY,
              'Authorization': `Bearer ${AC_CONFIG.SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query_embedding: embedding, match_threshold: 0.5, match_count: limit }),
          });

          if (!res.ok) {
            const all = await acSupabaseSelect('semantic_memories?select=id,content,source');
            if (!Array.isArray(all)) return [];
            const results: any[] = [];
            for (const row of all) {
              if (!row.content || !row.embedding) continue;
              let vec;
              try { vec = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding; } catch { continue; }
              if (!Array.isArray(vec) || vec.length !== embedding.length) continue;
              let dot = 0, normA = 0, normB = 0;
              for (let i = 0; i < embedding.length; i++) { dot += embedding[i] * vec[i]; normA += embedding[i] * embedding[i]; normB += vec[i] * vec[i]; }
              const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
              if (sim >= 0.5) results.push({ content: row.content, score: sim, source: row.source });
            }
            results.sort((a, b) => b.score - a.score);
            return results.slice(0, limit);
          }
          const data = await res.json();
          return Array.isArray(data) ? data.slice(0, limit) : [];
        } catch (e: any) {
          console.log('[lobstermind] auto-capture: Semantic search error:', e.message);
          return [];
        }
      }

      // --- Load autoaprendizaje ---
      async function acLoadAutoaprendizaje(mode: 'full' | 'top' = 'full') {
        try {
          if (mode === 'full') {
            // Bootstrap: TODOS los items, sin límite
            const all = await acSupabaseSelect('autoaprendizaje?select=content,category&order=category.asc,importance.desc');
            if (!Array.isArray(all)) return [];
            return all.filter((d: any) => d.content && d.content.length > 10);
          } else {
            // Subsecuentes: top 5 por categoría
            const cats = ['error', 'regla', 'preferencia', 'leccion', 'patron', 'proyecto'];
            const results: any[] = [];
            for (const cat of cats) {
              const items = await acSupabaseSelect(`autoaprendizaje?select=content,category&category=eq.${cat}&order=importance.desc&limit=5`);
              if (Array.isArray(items)) results.push(...items.filter((d: any) => d.content && d.content.length > 10));
            }
            return results;
          }
        } catch { return []; }
      }

      // --- LLM Classification ---
      const CLASSIFY_PROMPT = `Analiza este fragmento de conversación entre Luis y Clawy (IA).
Responde SOLO con un JSON array. Si nada es memorable, responde [].

Criterios ESTRICTOS por tipo:
- ERROR: Un error técnico cometido con lección clara (qué falló + cómo evitarlo)
- REGLA: Una norma de operación que debe seguirse SIEMPRE (no guías generales)
- LECCION: Un aprendizaje técnico profundo (no trivialidades ni "ya funciona")
- PREFERENCIA: Un gusto/personalidad del usuario expresado DIRECTAMENTE ("me gusta/odio/no quiero"). NO es preferencia si es una simple elección en conversación (ej "opción B")
- PATRON: Comportamiento repetido 3+ veces
- DECISION: Una decisión de arquitectura/configuración que afecta el sistema a futuro
- PROYECTO: Nuevo proyecto creado o milestone significativo

Rechazar SIEMPRE:
- Saludos, confirmaciones, preguntas simples
- Estado temporal ("investigando...", "probando...")
- Elecciones casuales en conversación ("sí", "opción B", "vamos")
- Cosas obvias que cualquier IA ya sabe
- Opiniones del asistente sin impacto técnico
- Duplicados de información ya conocida

El contenido debe ser conciso (máximo 150 chars), en español, con valor duradero.
Formato: [{"type":"TIPO","content":"descripción corta"}]`;

      async function acClassifyTurn(text: string) {
        if (!text || text.length < AC_CONFIG.CAPTURE_MIN_CHARS) return [];
        for (const model of [AC_CONFIG.LLM_PRIMARY, AC_CONFIG.LLM_FALLBACK]) {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${AC_CONFIG.OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model,
                messages: [{ role: 'system', content: CLASSIFY_PROMPT }, { role: 'user', content: text.slice(0, 3000) }],
                temperature: 0.1, max_tokens: 500,
              }),
            });
            const data = await res.json();
            const msg = data.choices?.[0]?.message;
            const content = msg?.content || msg?.reasoning;
            console.log(`[lobstermind] auto-capture: LLM ${model} response:`, content?.substring(0, 200));
            if (!content) { console.log('[lobstermind] auto-capture: LLM returned empty content (content+reasoning both null)'); continue; }
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) { console.log('[lobstermind] auto-capture: No JSON array found in LLM response'); continue; }
            const items = JSON.parse(jsonMatch);
            if (!Array.isArray(items)) { console.log('[lobstermind] auto-capture: Parsed but not array:', typeof items); continue; }
            const filtered = items.filter((item: any) =>
              item.type && item.content &&
              ['ERROR','REGLA','LECCION','PREFERENCIA','PATRON','DECISION','PROYECTO'].includes(item.type) &&
              item.content.length >= 10 && item.content.length <= 200
            );
            console.log(`[lobstermind] auto-capture: Classified ${items.length} items, filtered to ${filtered.length}`);
            return filtered;
          } catch (e: any) {
            console.log(`[lobstermind] auto-capture: LLM ${model} failed:`, e.message);
          }
        }
        return [];
      }

      // --- Dedup ---
      async function acIsDuplicate(content: string) {
        try {
          const existing = await acSupabaseSelect(`autoaprendizaje?select=id,content&content=ilike.%25${encodeURIComponent(content.slice(0, 30))}%25&limit=1`);
          return Array.isArray(existing) && existing.length > 0;
        } catch { return false; }
      }

      // --- Save ---
      async function acSaveMemories(memories: any[]) {
        let saved = 0;
        for (const mem of memories) {
          try {
            if (await acIsDuplicate(mem.content)) continue;
            await acSupabaseInsert('autoaprendizaje', {
              id: 'ac_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
              content: mem.content,
              category: mem.type.toLowerCase(),
              importance: mem.type === 'ERROR' || mem.type === 'REGLA' ? 5 : 3,
              source: 'autoguardado',
            });
            saved++;
          } catch (e: any) {
            console.log('[lobstermind] auto-capture: Save error:', e.message);
          }
        }
        return saved;
      }

      // --- Format context ---
      function acFormatRecallContext(autoaprendizaje: any[], semanticResults: any[]) {
        const parts: string[] = [];
        if (autoaprendizaje.length > 0) {
          const lines = autoaprendizaje.map((a: any) => `- [${(a.category || '').toUpperCase()}] ${a.content}`);
          parts.push(`<clawy-autoaprendizaje>\n${lines.join('\n')}\n</clawy-autoaprendizaje>`);
        }
        if (semanticResults.length > 0) {
          const lines = semanticResults.map((r: any) => {
            const score = r.score ? ` [${Math.round(r.score * 100)}%]` : '';
            return `- ${r.content}${score}`;
          });
          parts.push(`<clawy-memorias-relevantes>\n${lines.join('\n')}\n</clawy-memorias-relevantes>`);
        }
        if (parts.length === 0) return null;
        return ['Usa este contexto para informar tus respuestas. No menciones estas memorias a menos que sea relevante.', ...parts].join('\n\n');
      }

      // --- AUTO-INJECT: before_agent_start (Option B: inject once per session) ---
      let acLastInjectedCount = -1;  // Track what was last injected
      let acSessionStarted = false;  // Track if this is a new session

      api.on('before_agent_start', async (event: any, ctx: any) => {
        const provider = ctx?.messageProvider;
        if (AC_CONFIG.SKIP_PROVIDERS.includes(provider)) return;
        const prompt = event?.prompt;
        if (!prompt || prompt.length < 5) return;

        const messages = Array.isArray(event.messages) ? event.messages : [];
        let userTurns = 0;
        for (const msg of messages) {
          if (msg && typeof msg === 'object' && msg.role === 'user') userTurns++;
        }

        // Detect new session: only 1 user message so far = first turn of session
        if (userTurns <= 1) {
          acSessionStarted = true;
          acLastInjectedCount = -1; // Reset for new session
        }

        try {
          let autoaprendizaje: any[] = [];
          
          if (userTurns <= 1) {
            // First turn: inject FULL autoaprendizaje (all 385 items, all categories)
            autoaprendizaje = await acLoadAutoaprendizaje('full');
            acLastInjectedCount = autoaprendizaje.length;
            console.log(`[lobstermind] auto-inject: BOOTSTRAP - injecting full context (${autoaprendizaje.length} items)`);
          } else {
            // Subsequent turns: inject TOP 5 per category (~30 items)
            autoaprendizaje = await acLoadAutoaprendizaje('top');
            acLastInjectedCount = autoaprendizaje.length;
            console.log(`[lobstermind] auto-inject: TOP - injecting ${autoaprendizaje.length} items (top 5 per category)`);
          }
              }
              return; // No injection needed
            }
          }

          const semantic = await acSemanticSearch(prompt);
          const context = acFormatRecallContext(autoaprendizaje, semantic);
          if (context) {
            return { prependContext: context };
          }
        } catch (e: any) {
          console.log('[lobstermind] auto-inject: Error:', e.message);
        }
      });

      // --- AUTO-CAPTURE: agent_end (fires at end of each turn) ---
      api.on('agent_end', async (event: any, ctx: any) => {
        const provider = ctx?.messageProvider;
        console.log('[lobstermind] auto-capture: agent_end FIRED — provider:', provider);
        if (AC_CONFIG.SKIP_PROVIDERS.includes(provider)) return;

        const messages = Array.isArray(event?.messages) ? event.messages : [];
        if (messages.length === 0) return;

        let lastUserIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) return;

        const lastTurn = messages.slice(lastUserIdx);
        const texts: string[] = [];
        for (const msg of lastTurn) {
          if (!msg || typeof msg !== 'object') continue;
          if (msg.role !== 'user' && msg.role !== 'assistant') continue;
          let content = msg.content;
          if (Array.isArray(content)) {
            content = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          }
          if (typeof content === 'string') {
            content = content
              .replace(/<clawy-autoaprendizaje>[\s\S]*?<\/clawy-autoaprendizaje>/g, '')
              .replace(/<clawy-memorias-relevantes>[\s\S]*?<\/clawy-memorias-relevantes>/g, '')
              .trim();
            if (content.length >= 10) texts.push(`[${msg.role}]\n${content}`);
          }
        }
        if (texts.length === 0) return;
        const turnText = texts.join('\n\n');
        if (turnText.length < AC_CONFIG.CAPTURE_MIN_CHARS) return;

        try {
          console.log('[lobstermind] auto-capture: Classifying turn, length:', turnText.length, 'preview:', turnText.substring(0, 300));
          const memories = await acClassifyTurn(turnText);
          if (memories.length === 0) return;
          const saved = await acSaveMemories(memories);
          if (saved > 0) {
            console.log(`[lobstermind] auto-capture: ✅ Captured ${saved} memories: ${memories.map((m: any) => m.type).join(', ')}`);
            appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ✅ Captured ${saved} memories: ${memories.map((m: any) => m.type).join(', ')}\n`);
          }
        } catch (e: any) {
          console.log('[lobstermind] auto-capture: Error:', e.message);
        }
      });

      console.log('[lobstermind] auto-capture + auto-inject: Ready ✅');
    } // end if config loaded

    return {name:'lobstermind-memory',version:'1.0.0'};
  }
};