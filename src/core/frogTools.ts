import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { APP_VERSION } from '../shared/version';

/** What the team tools need from the engine, scoped to one agent's turn. */
export interface TeamBridge {
  listTeam(): { name: string; label: string; status: string }[];
  messageAgent(to: string, message: string): Promise<string>;
  createGroup(name: string, members: string[], message: string): Promise<string>;
  askUser(question: string, options: string[]): Promise<string>;
  requestAgent(input: { name: string; label: string; instructions: string; reason: string }): Promise<string>;
  notifyUser(title: string, body: string): void;
  remember(note: string, scope: 'self' | 'team'): string;
  scheduleTask(prompt: string, everyMinutes: number): string;
  listTasks(): string;
  cancelTask(taskId: string): string;
  recentObservations(count: number): string;
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

/**
 * The "frog" MCP server every agent gets: how agents talk to each other and
 * to the user, keep memory, and plan their own recurring work.
 */
export function createTeamServer(bridge: TeamBridge) {
  return createSdkMcpServer({
    name: 'frog',
    version: APP_VERSION,
    tools: [
      tool('list_team', 'List the other agents on this Frog Bot team with their roles and whether they are busy.', {}, async () => {
        const team = bridge.listTeam();
        return text(team.length ? team.map((a) => `- ${a.name} (${a.label || 'no label'}) — ${a.status}`).join('\n') : 'You are the only agent.');
      }),
      tool(
        'message_agent',
        'Hand work to a teammate or send them a result. They act on it and message you back; you are woken up automatically then, so end your turn after sending. Several messages to the same busy teammate are combined. Never send thanks or acknowledgements.',
        { to: z.string().describe('Exact name of the agent'), message: z.string().describe('What you want them to know or do') },
        async ({ to, message }) => text(await bridge.messageAgent(to, message)),
      ),
      tool(
        'create_group',
        'Start a group chat with teammates when several of you need to discuss, teach each other, or decide something together. You are added automatically. Your opening message is posted there; mention a teammate as @Name to hand them the first step.',
        {
          name: z.string().describe('Group name, e.g. "Launch plan"'),
          members: z.array(z.string()).min(1).max(5).describe('Exact names of the teammates to add'),
          message: z.string().describe('Opening message: the goal, who does what (use @Name), and what the group must decide or deliver'),
        },
        async ({ name, members, message }) => text(await bridge.createGroup(name, members, message)),
      ),
      tool(
        'ask_user',
        'Ask the user a question and wait for the answer. Give 2-4 short options; the user can also type their own answer. Use when a decision is theirs to make.',
        {
          question: z.string(),
          options: z.array(z.string()).min(1).max(4).describe('Short answer choices'),
        },
        async ({ question, options }) => text(`The user answered: ${await bridge.askUser(question, options)}`),
      ),
      tool(
        'request_new_agent',
        'Ask the user to add a new specialist agent to the team when the work needs a role nobody has. The user approves or declines.',
        {
          name: z.string().describe('Short name, e.g. "Docs Guy"'),
          label: z.string().describe('One-line role, e.g. "Writes and reviews drafts"'),
          instructions: z.string().describe('Standing instructions for the new agent'),
          reason: z.string().describe('Why the team needs this agent'),
        },
        async (input) => text(await bridge.requestAgent(input)),
      ),
      tool(
        'notify_user',
        'Show the user a desktop notification. Use for things they should see soon: work finished, something needs them, something went wrong.',
        { title: z.string(), body: z.string() },
        async ({ title, body }) => {
          bridge.notifyUser(title, body);
          return text('Notification shown.');
        },
      ),
      tool(
        'remember',
        'Save a lasting note to memory: how the user likes things done, decisions, facts about their work. "self" is your own memory; "team" is shared with every agent.',
        { note: z.string(), scope: z.enum(['self', 'team']).default('self') },
        async ({ note, scope }) => text(bridge.remember(note, scope)),
      ),
      tool(
        'schedule_task',
        'Run a task for yourself on a repeating schedule while this computer is on (for example, check a Slack channel every 30 minutes).',
        { prompt: z.string().describe('What to do each time'), every_minutes: z.number().int().min(5).max(10080) },
        async ({ prompt, every_minutes }) => text(bridge.scheduleTask(prompt, every_minutes)),
      ),
      tool('list_tasks', 'List your scheduled tasks.', {}, async () => text(bridge.listTasks())),
      tool(
        'cancel_task',
        'Cancel one of your scheduled tasks by id.',
        { task_id: z.string() },
        async ({ task_id }) => text(bridge.cancelTask(task_id)),
      ),
      tool(
        'recent_observations',
        'When watch mode is on, Frog Bot saves screenshots of the user\'s screen. This lists the newest ones so you can look at them with Read and learn how the user works.',
        { count: z.number().int().min(1).max(20).default(5) },
        async ({ count }) => text(bridge.recentObservations(count)),
      ),
    ],
  });
}
