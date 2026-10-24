// Two Frog Bot agents work together to make the app's tutorial video:
// Director briefs Scriptwriter, Scriptwriter writes the narration, Director
// turns screenshots + narration into an MP4 with the computer's own voice.
//   FROG_LIVE=1 npx vitest run tests/collab.live.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../config/frogbot.config.json';
import { FrogEngine, type AppConfig } from '../src/core/engine';
import { FrogPaths } from '../src/core/paths';
import { MemorySecretBox } from '../src/core/secrets';
import { apiKeyFromEnv, loadDotEnv, openAiKeyFromEnv } from '../src/main/env';

loadDotEnv(path.join(process.cwd(), '.env'));
const claudeKey = apiKeyFromEnv();
const openAiKey = openAiKeyFromEnv();
const live = process.env.FROG_LIVE === '1' && Boolean(claudeKey || openAiKey);

const SCREENS: Record<string, string> = {
  '01-onboarding.png': 'Welcome screen on first launch: paste a Claude or OpenAI API key, click Allow for ROS once, then chat with Frog.',
  '02-home.png': 'Main window: agents and groups on the left, the chat in the middle, Integrations bar bottom-left, suggestion buttons to start.',
  '03-new-agent.png': 'The + button, New agent: pick a name, emoji and colour, a one-line role, and plain-words instructions.',
  '04-group.png': 'A new agent (Docs Guy) and a group chat (Sam Bots) in the sidebar. In groups, @Name talks to one agent.',
  '05-chat.png': 'Chatting with Frog: it explains what it can do (files, web research, browser, commands, delegating to teammates).',
  '05b-approval.png': 'An approval card: "Frog wants to: Run command". Buttons: Allow, Don\'t allow, Details. A Stop button is at the top.',
  '05c-approved.png': 'After clicking Allow: "You allowed this", and Frog reports the command output.',
  '06-panel-details.png': 'About Frog panel, Settings tab: name, instructions, "Work on its own" switch, brain, which apps it can use.',
  '06-panel-computer.png': 'About Frog panel, Screen tab: the agent\'s computer, and a live list of every step it takes.',
  '07-integrations.png': 'Integrations: ROS Dashboard (click Connect, then Allow once) and the Browser, plus Slack, Notion, GitHub, Linear, custom apps.',
  '08-integration-form.png': 'Adding another app: fill in the server address (and a token if needed), then Add.',
  '09-logs.png': 'Logs tab: a live terminal-style list of everything that happens, with date and time, filters, copy and save.',
  '10-settings.png': 'Settings: API key, team name, brain for new agents, start with the computer, Learn from my screen, where files live.',
};

describe.skipIf(!live)('agents collaborate to make the tutorial video', () => {
  it('Director and Scriptwriter produce a narrated MP4', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-collab-'));
    const engine = new FrogEngine({
      paths: new FrogPaths(dir),
      config: { ...(config as AppConfig), integrations: [] },
      secrets: new MemorySecretBox(),
      host: { platform: 'Windows', openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined, nodeRuntime: () => ({ command: process.execPath, env: {} }) },
      envApiKey: claudeKey,
      envOpenAiKey: openAiKey,
    });
    await engine.start();

    const screens = path.join(dir, 'shared', 'screens');
    fs.mkdirSync(screens, { recursive: true });
    for (const name of Object.keys(SCREENS)) fs.copyFileSync(path.join('tutorial', 'screens', name), path.join(screens, name));
    fs.writeFileSync(path.join(screens, 'SCREENS.md'), `# Screenshots of Frog Bot (in order)\n\n${Object.entries(SCREENS).map(([f, d]) => `- ${f}: ${d}`).join('\n')}\n`);
    fs.copyFileSync('README.md', path.join(dir, 'shared', 'FROG-BOT-README.md'));

    engine.createAgent({
      name: 'Director',
      label: 'Plans and produces videos',
      autonomy: 'auto',
      instructions: 'You produce short tutorial videos. You brief writers clearly, then build the final video yourself with ffmpeg and the computer\'s built-in text-to-speech.',
    });
    engine.createAgent({
      name: 'Scriptwriter',
      label: 'Writes narration scripts',
      autonomy: 'auto',
      instructions: 'You write warm, simple narration for non-technical viewers. Short sentences, no jargon. When a teammate asks for a script, write it to the shared folder and message them back with the file path.',
    });
    const director = engine.snapshot().conversations.find((c) => c.title === 'Director')!;

    // Approve anything the agents ask for while they work.
    const approver = setInterval(() => {
      for (const c of engine.snapshot().conversations) {
        for (const m of engine.messages(c.id)) {
          if (m.kind === 'approval' && !m.approval?.decision) engine.decideApproval(m.id, 'allow');
          if (m.kind === 'question' && !m.question?.answer) engine.answerQuestion(m.id, m.question!.options[0]);
        }
      }
    }, 200);

    const shared = path.join(dir, 'shared');
    await engine.sendMessage(
      director.id,
      [
        'We need a 2-3 minute narrated tutorial video for our team showing how to use Frog Bot. Viewers are non-technical.',
        `Screenshots are in ${screens}, described in order in ${path.join(screens, 'SCREENS.md')}. Product details are in ${path.join(shared, 'FROG-BOT-README.md')}.`,
        'Step 1: use message_agent to brief Scriptwriter: describe the idea and ask for a narration script with one section per screenshot (2-4 short sentences each, plus a short intro and outro),',
        `saved as ${path.join(shared, 'tutorial-script.md')} using headings like "## 02-home.png". Then end your turn and wait for Scriptwriter to message you back.`,
        'Step 2 (when Scriptwriter tells you the script is ready): build the video yourself on this Windows computer, no websites needed:',
        '- make one WAV per section with PowerShell System.Speech (voice "Microsoft Zira Desktop", rate 0);',
        '- with ffmpeg (already installed), make one clip per section showing its screenshot scaled and padded to 1920x1080 on a dark background, lasting as long as its narration plus 0.7 s; use the intro/outro over 02-home.png;',
        `- join the clips into ${path.join(shared, 'frog-bot-tutorial.mp4')} (H.264 + AAC), and also write matching subtitles to ${path.join(shared, 'frog-bot-tutorial.srt')}.`,
        'Check the final file with ffprobe and tell me its duration.',
      ].join('\n'),
    );

    // The relay chain (Director → Scriptwriter → Director) runs through the queues.
    const deadline = Date.now() + 25 * 60_000;
    while (Date.now() < deadline) {
      await engine.idle();
      await new Promise((r) => setTimeout(r, 1500));
      const busy = Object.values(engine.snapshot().runtimes).some((r) => r.status === 'working' || r.status === 'waiting');
      if (!busy && fs.existsSync(path.join(shared, 'frog-bot-tutorial.mp4'))) break;
      if (!busy && Date.now() > deadline - 24 * 60_000 && engine.messages(director.id).filter((m) => m.kind === 'relay').length >= 2) {
        // Both hand-offs happened and everyone is idle: the work is finished one way or another.
        await new Promise((r) => setTimeout(r, 3000));
        if (!Object.values(engine.snapshot().runtimes).some((r) => r.status === 'working')) break;
      }
    }
    clearInterval(approver);

    const out = path.resolve('tutorial');
    for (const file of ['frog-bot-tutorial.mp4', 'frog-bot-tutorial.srt', 'tutorial-script.md']) {
      if (fs.existsSync(path.join(shared, file))) fs.copyFileSync(path.join(shared, file), path.join(out, file));
    }
    const transcript = engine.snapshot().conversations.flatMap((c) =>
      engine.messages(c.id).map((m) => `[${c.title}] ${m.author.kind === 'agent' ? engine.snapshot().agents.find((a) => a.id === (m.author as { agentId: string }).agentId)?.name : m.author.kind} (${m.kind}): ${m.text}`),
    );
    // This log is published, so never include the real home folder (it holds the user's name).
    fs.writeFileSync(path.join(out, 'collaboration-log.md'), transcript.join('\n\n').split(os.homedir()).join('C:\\Users\\you').replace(/frog-collab-[A-Za-z0-9]+/g, 'frog-collab'));
    engine.stop();

    expect(engine.messages(director.id).some((m) => m.kind === 'relay')).toBe(true);
    expect(fs.existsSync(path.join(out, 'tutorial-script.md'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'frog-bot-tutorial.mp4'))).toBe(true);
  }, 30 * 60_000);
});
