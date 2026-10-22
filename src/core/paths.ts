import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Everything Frog Bot owns lives under one folder, "FrogsWorld", so it is easy
 * to find, back up, or move to a server:
 *
 *   FrogsWorld/
 *     agents/<agent-slug>/      the agent's own workspace (its "computer")
 *       memory.md               what the agent has learned and keeps
 *       browser-profile/        the agent's private Chrome profile
 *     shared/                   files every agent can read and write
 *       team-memory.md          notes shared by the whole team
 *     observations/             screenshots from watch mode
 *     logs/                     one activity log file per day
 *     state/                    app state (agents, chats, settings)
 *     engine/                   private config dir for the Claude engine
 */
export class FrogPaths {
  readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root || process.env.FROG_HOME || path.join(os.homedir(), 'FrogsWorld'));
  }

  get agentsDir() { return path.join(this.root, 'agents'); }
  get sharedDir() { return path.join(this.root, 'shared'); }
  get logsDir() { return path.join(this.root, 'logs'); }
  get stateDir() { return path.join(this.root, 'state'); }
  get messagesDir() { return path.join(this.stateDir, 'messages'); }
  get engineDir() { return path.join(this.root, 'engine'); }
  get observationsDir() { return path.join(this.root, 'observations'); }
  get teamMemoryFile() { return path.join(this.sharedDir, 'team-memory.md'); }

  agentDir(slug: string) { return path.join(this.agentsDir, slug); }
  agentMemoryFile(slug: string) { return path.join(this.agentDir(slug), 'memory.md'); }
  agentBrowserProfile(slug: string) { return path.join(this.agentDir(slug), 'browser-profile'); }

  ensure() {
    for (const dir of [this.root, this.agentsDir, this.sharedDir, this.logsDir, this.stateDir, this.messagesDir, this.engineDir, this.observationsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.teamMemoryFile)) {
      fs.writeFileSync(this.teamMemoryFile, '# Team memory\n\nNotes every Frog agent can read. Agents add to this with the `remember` tool.\n');
    }
  }

  ensureAgent(slug: string) {
    const dir = this.agentDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    const memory = this.agentMemoryFile(slug);
    if (!fs.existsSync(memory)) fs.writeFileSync(memory, '# Memory\n\n');
    return dir;
  }

  /** True when `target` is inside `dir` (or is `dir`). */
  static isInside(dir: string, target: string) {
    const rel = path.relative(path.resolve(dir), path.resolve(target));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
}

export function slugify(name: string) {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'agent';
}
