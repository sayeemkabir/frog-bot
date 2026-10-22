import type { Agent } from '../shared/types';

/**
 * Find the agents @mentioned in a message. Agent names can contain spaces and
 * dashes ("Docs Guy -Sam"), so match the longest name that follows each "@".
 */
export function findMentions(text: string, agents: Pick<Agent, 'id' | 'name'>[]): string[] {
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const found: string[] = [];
  let at = lower.indexOf('@');
  while (at !== -1) {
    const rest = lower.slice(at + 1);
    const hit = byLength.find((agent) => {
      const name = agent.name.toLowerCase();
      if (!rest.startsWith(name)) return false;
      const next = rest.charAt(name.length);
      return next === '' || !/[a-z0-9_]/i.test(next);
    });
    if (hit && !found.includes(hit.id)) found.push(hit.id);
    at = lower.indexOf('@', at + 1);
  }
  return found;
}
