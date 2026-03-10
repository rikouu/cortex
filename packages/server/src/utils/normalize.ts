/**
 * Entity normalization for relation graph.
 * Deterministic rules: full-width → half-width, whitespace collapse,
 * alias resolution, CJK-aware casing.
 */

// Alias table: maps lowercase variants to canonical form
/**
 * Project-specific entity aliases.
 * These are loaded dynamically per-agent in the future;
 * for now, hard-coded for common patterns.
 */
const PROJECT_ALIAS_MAP = new Map<string, string>([
  // Cortex variants → canonical
  ['cortex', 'Cortex'], ['cortex 系统', 'Cortex'], ['cortex 项目', 'Cortex'],
  ['cortex 记忆系统', 'Cortex'], ['cortex记忆系统', 'Cortex'], ['cortex项目', 'Cortex'],
  ['cortex 智能体系统', 'Cortex'], ['cortex 记忆系统开发', 'Cortex'],

  // User identity merging is done at ingest time via agentId
]);

/**
 * Suffix patterns that should be stripped to normalize entity names.
 * E.g. "cortex 关系存储" → check if "cortex" is a known entity → use that.
 * "xxx 服务" / "xxx 插件" / "xxx 系统" / "xxx npm 包" etc.
 */
const STRIP_SUFFIXES = ['npm 包', 'npm包', '服务', '系统', '项目', '插件', '功能', '模块', '工具', '问题', '机器', '实例', '域名', '配置'];

function tryStripSuffix(name: string): string | null {
  const lower = name.toLowerCase().trim();
  for (const suffix of STRIP_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length + 1) {
      const base = lower.slice(0, -suffix.length).trim();
      // Check if the base is a known alias
      const resolved = PROJECT_ALIAS_MAP.get(base) || ALIAS_MAP.get(base);
      if (resolved) return resolved;
    }
  }
  return null;
}

const ALIAS_MAP = new Map<string, string>([
  // Editors
  ['vscode', 'VS Code'], ['vs code', 'VS Code'], ['visual studio code', 'VS Code'],
  // Languages
  ['typescript', 'TypeScript'], ['ts', 'TypeScript'],
  ['javascript', 'JavaScript'], ['js', 'JavaScript'],
  ['python', 'Python'], ['py', 'Python'],
  ['golang', 'Go'], ['go lang', 'Go'],
  // Runtimes
  ['nodejs', 'Node.js'], ['node.js', 'Node.js'], ['node', 'Node.js'],
  // Frameworks
  ['reactjs', 'React'], ['react.js', 'React'],
  ['vuejs', 'Vue'], ['vue.js', 'Vue'],
  ['nextjs', 'Next.js'], ['next.js', 'Next.js'], ['next', 'Next.js'],
  ['nuxtjs', 'Nuxt'], ['nuxt.js', 'Nuxt'],
  ['expressjs', 'Express'], ['express.js', 'Express'],
  ['fastify', 'Fastify'],
  ['angular', 'Angular'], ['angularjs', 'Angular'],
  ['svelte', 'Svelte'], ['sveltekit', 'SvelteKit'],
  // Databases
  ['mongodb', 'MongoDB'], ['mongo', 'MongoDB'],
  ['postgresql', 'PostgreSQL'], ['postgres', 'PostgreSQL'], ['pg', 'PostgreSQL'],
  ['mysql', 'MySQL'],
  ['sqlite', 'SQLite'], ['sqlite3', 'SQLite'],
  ['redis', 'Redis'],
  // DevOps
  ['kubernetes', 'Kubernetes'], ['k8s', 'Kubernetes'],
  ['docker', 'Docker'],
  // Platforms
  ['github', 'GitHub'], ['gh', 'GitHub'],
  ['gitlab', 'GitLab'],
  ['macos', 'macOS'], ['osx', 'macOS'], ['os x', 'macOS'], ['mac os', 'macOS'],
  ['windows', 'Windows'], ['win', 'Windows'],
  ['linux', 'Linux'],
  // Tools
  ['chatgpt', 'ChatGPT'], ['chat gpt', 'ChatGPT'],
  ['openai', 'OpenAI'], ['open ai', 'OpenAI'],
  ['tailwindcss', 'Tailwind CSS'], ['tailwind css', 'Tailwind CSS'], ['tailwind', 'Tailwind CSS'],
  ['webpack', 'webpack'],
  ['vite', 'Vite'],
  ['pnpm', 'pnpm'], ['npm', 'npm'], ['yarn', 'Yarn'],
]);

/** CJK Unicode ranges (Han, Hiragana, Katakana, Hangul) */
const CJK_RE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/** Full-width ASCII → half-width ASCII (U+FF01..U+FF5E → U+0021..U+007E) */
function fullWidthToHalf(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Full-width space U+3000 → regular space
    if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0xFF01 && code <= 0xFF5E) {
      out += String.fromCharCode(code - 0xFEE0);
    } else {
      out += str[i];
    }
  }
  return out;
}

/**
 * Normalize an entity name to a canonical form.
 * 1. Trim + full-width → half-width
 * 2. Collapse whitespace (multiple spaces → single space)
 * 3. Alias resolution (case-insensitive lookup)
 * 4. CJK text preserved as-is (no case concept)
 * 5. Non-CJK text lowercased only if no alias match
 */
export function normalizeEntity(raw: string): string {
  // Step 1: trim + full-width → half-width
  let s = fullWidthToHalf(raw.trim());

  // Step 2: collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return s;

  // Step 3: alias lookup (case-insensitive)
  const lower = s.toLowerCase();

  // 3a: Project-specific aliases first
  const projectAlias = PROJECT_ALIAS_MAP.get(lower);
  if (projectAlias) return projectAlias;

  // 3b: Generic tech aliases
  const alias = ALIAS_MAP.get(lower);
  if (alias) return alias;

  // 3c: Try stripping common suffixes
  const stripped = tryStripSuffix(s);
  if (stripped) return stripped;

  // Step 4 & 5: CJK-aware casing
  if (CJK_RE.test(s)) {
    // Contains CJK characters — preserve original casing
    return s;
  }

  // Pure non-CJK: lowercase for consistency
  return lower;
}
