import fs from 'node:fs';

/** Load KEY=value lines from a .env file into process.env (existing values win). */
export function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
  return true;
}

/**
 * The Claude API key from the environment: ANTHROPIC_API_KEY, or the first
 * line of the file named by ANTHROPIC_API_KEY_FILE (so a key can stay in its
 * own file and never be copied into config).
 */
export function apiKeyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const direct = realApiKey(env.ANTHROPIC_API_KEY);
  if (direct) return direct;
  const file = env.ANTHROPIC_API_KEY_FILE?.trim().replace(/^["']|["']$/g, '');
  if (!file) return undefined;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const match = /sk-ant-[A-Za-z0-9_-]{20,}/.exec(text);
    return realApiKey(match ? match[0] : text.split(/\r?\n/).find((l) => l.trim())?.trim());
  } catch {
    return undefined;
  }
}

/** The OpenAI key from OPENAI_API_KEY or the file named by OPENAI_API_KEY_FILE. */
export function openAiKeyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const direct = realApiKey(env.OPENAI_API_KEY);
  if (direct) return direct;
  const file = env.OPENAI_API_KEY_FILE?.trim().replace(/^["']|["']$/g, '');
  if (!file) return undefined;
  try {
    const match = /sk-[A-Za-z0-9_-]{20,}/.exec(fs.readFileSync(file, 'utf8'));
    return match ? match[0] : undefined;
  } catch {
    return undefined;
  }
}

/** The placeholder from .env.example is not a key. */
export function realApiKey(value: string | undefined) {
  if (!value) return undefined;
  const v = value.trim();
  if (!v || /your-claude-api-key|^sk-ant-\.\.\.$|changeme|placeholder/i.test(v)) return undefined;
  return v;
}
