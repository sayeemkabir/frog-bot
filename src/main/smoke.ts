import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { FrogEngine } from '../core/engine';

interface SmokeContext {
  engine: FrogEngine;
  window: BrowserWindow;
  outDir: string;
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `electron . --smoke=<dir>` boots the real app against a throwaway FrogsWorld,
 * clicks through every screen, saves a screenshot of each, and writes
 * results.json. Exit code 0 means every check passed.
 */
export async function runSmoke({ engine, window, outDir }: SmokeContext): Promise<number> {
  fs.mkdirSync(outDir, { recursive: true });
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, ok, detail });
    engine.log.info('smoke', `${ok ? 'PASS' : 'FAIL'} ${name}`, detail);
  };
  const js = <T>(code: string) => window.webContents.executeJavaScript(code, true) as Promise<T>;
  const waitFor = async (code: string, timeoutMs = 15000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        if (await js<boolean>(`Boolean(${code})`)) return true;
      } catch {
        // Page still loading.
      }
      await sleep(150);
    }
    return false;
  };
  const shot = async (name: string) => {
    // Let animations settle, then force a fresh frame before capturing.
    await sleep(1100);
    window.webContents.invalidate();
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await sleep(120);
    const image = await window.webContents.capturePage(undefined, { stayAwake: true });
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  };
  // FROG_SMOKE_VISIBLE: run on screen at a pace a person can follow, with captions.
  const visible = Boolean(process.env.FROG_SMOKE_VISIBLE);
  const pause = (ms = 900) => (visible ? sleep(ms) : Promise.resolve());
  const caption = async (text: string) => {
    if (!visible) return;
    await js(`(() => {
      let el = document.getElementById('live-test-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'live-test-caption';
        el.style.cssText = 'position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:99999;pointer-events:none;' +
          'padding:10px 18px;border-radius:999px;background:rgba(10,30,20,.92);border:1px solid rgba(61,220,132,.6);' +
          'color:#e9fff1;font:600 15px/1.3 Segoe UI,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:80%;text-align:center';
        document.body.appendChild(el);
      }
      el.textContent = '🧪 Live test · ' + ${JSON.stringify(text)};
    })()`).catch(() => undefined);
    await sleep(1200);
  };
  const click = async (selector: string) => {
    const ok = await js<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
    await pause();
    return ok;
  };
  const typeInto = async (selector: string, value: string) => {
    const set = (v: string) =>
      js<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
    if (!visible) return set(value);
    // Type it out so the viewer can read along.
    for (let i = 4; i < value.length; i += 4) {
      await set(value.slice(0, i));
      await sleep(30);
    }
    const ok = await set(value);
    await pause(600);
    return ok;
  };

  try {
    if (visible) {
      window.setTitle('Frog Bot (live test)');
      window.setBounds({ x: 80, y: 40, width: 1360, height: 860 });
      window.show();
    } else {
      // Run off-screen and without focus so a self-test is never mistaken for the real app.
      window.setTitle('Frog Bot (self-test)');
      window.setSkipTaskbar(true);
      window.setFocusable(false);
      window.setBounds({ x: -20000, y: -20000, width: 1360, height: 860 });
      window.showInactive();
    }

    check('UI loads', await waitFor(`document.querySelector('[data-testid="app-ready"]')`, 20000));
    if (!process.env.FROG_SMOKE_LIVE) check('Onboarding shows when there is no API key', await waitFor(`document.querySelector('[data-testid="onboarding"]')`, 5000));
    await shot('01-onboarding');
    await click('[data-testid="onboarding-skip"]');
    check('Onboarding can be skipped', await waitFor(`!document.querySelector('[data-testid="onboarding"]')`, 5000));

    const snapshot = engine.snapshot();
    check('Default agent "Frog" exists', snapshot.agents.some((a) => a.name === 'Frog'));
    check('ROS integration is built in', snapshot.integrations.some((i) => i.id === 'ros' && i.builtin));
    check('Sidebar lists Frog', await waitFor(`[...document.querySelectorAll('[data-testid="conversation-item"]')].some(e => e.textContent.includes('Frog'))`));
    await shot('02-home');

    // Create an agent through the real dialog.
    await caption("Creating a new agent with the + button");
    await click('[data-testid="new-menu"]');
    check('New menu opens', await waitFor(`document.querySelector('[data-testid="new-agent"]')`));
    await click('[data-testid="new-agent"]');
    check('New agent dialog opens', await waitFor(`document.querySelector('[data-testid="agent-dialog"]')`));
    await typeInto('[data-testid="agent-name"]', 'Docs Guy');
    await typeInto('[data-testid="agent-label"]', 'Writes and reviews drafts');
    await typeInto('[data-testid="agent-instructions"]', 'Keep the house voice. Lowercase, short, no em dashes.');
    await shot('03-new-agent');
    await click('[data-testid="agent-save"]');
    check('Agent created from the dialog', await waitFor(`[...document.querySelectorAll('[data-testid="conversation-item"]')].some(e => e.textContent.includes('Docs Guy'))`));
    check('Agent folder created on disk', fs.existsSync(engine.paths.agentDir('docs-guy')));
    check('New agent opens its chat', await waitFor(`document.querySelector('[data-testid="chat-title"]')?.textContent.includes('Docs Guy')`));

    // Group chat.
    await caption("Making a group chat");
    const agents = engine.snapshot().agents;
    const group = engine.createGroup('Sam Bots', agents.map((a) => a.id));
    check('Group created', Boolean(group.id));
    await sleep(300);
    await click(`[data-conversation-id="${group.id}"]`);
    check('Group opens with members panel', await waitFor(`document.querySelector('[data-testid="chat-title"]')?.textContent.includes('Sam Bots')`));
    await shot('04-group');

    // Sending without a key surfaces a clear error in the chat.
    await caption("Saying hi to Frog (a real AI reply)");
    const frogThread = engine.snapshot().conversations.find((c) => c.kind === 'direct' && c.title === 'Frog')!;
    await click(`[data-conversation-id="${frogThread.id}"]`);
    await waitFor(`document.querySelector('[data-testid="composer"]')`);
    await typeInto('[data-testid="composer"]', 'Hi Frog, what can you do?');
    await click('[data-testid="send"]');
    check('User message appears', await waitFor(`[...document.querySelectorAll('[data-testid="message"]')].some(e => e.textContent.includes('what can you do'))`));
    if (process.env.FROG_SMOKE_DEMO) {
      await shot('05-chat');
    } else if (!process.env.FROG_SMOKE_LIVE) {
      check('Missing key error is shown', await waitFor(`[...document.querySelectorAll('[data-testid="message"]')].some(e => e.textContent.includes('API key'))`, 20000));
      await shot('05-chat');
    } else {
      // With a real key: a real reply, then an approval card, captured for the tutorial.
      const replied = () => engine.messages(frogThread.id).some((m) => m.author.kind === 'agent' && m.kind === 'text' && !m.streaming);
      const end = Date.now() + 120_000;
      while (!replied() && Date.now() < end) await sleep(500);
      check('Live: agent replied', replied());
      await shot('05-chat');
      await typeInto('[data-testid="composer"]', 'Please run the command: echo hello from Frog Bot');
      await click('[data-testid="send"]');
      check('Live: approval card shown', await waitFor(`document.querySelector('[data-testid="approval-card"]')`, 120_000));
      await shot('05b-approval');
      await caption('Frog asked before running a command. Clicking Allow…');
      await click('[data-testid="approve"]');
      const done = Date.now() + 120_000;
      while (Date.now() < done && engine.snapshot().runtimes[frogThread.memberIds[0]]?.status !== 'idle') await sleep(500);
      check('Live: command ran after approval', engine.messages(frogThread.id).some((m) => m.author.kind === 'agent' && m.kind === 'text' && /hello\s+from\s+frog\s+bot/i.test(m.text)));
      await shot('05c-approved');

      // Real teamwork: Frog hands a job to a new teammate inside a group, in Auto mode.
      await caption('Adding a teammate called Dog and a group for the two of them');
      const { agent: dog } = engine.createAgent({ name: 'Dog', label: 'Writes short pieces', emoji: '🐶', color: '#ffb74d', instructions: 'When a teammate gives you a writing job, do it and save it where they say. Keep it short.' });
      const team = engine.createGroup('Live test team', [frogThread.memberIds[0], dog.id]);
      await sleep(400);
      await click(`[data-conversation-id="${team.id}"]`);
      await waitFor(`document.querySelector('[data-testid="chat-title"]')?.textContent.includes('Live test team')`);
      await caption('Switching the group to Auto mode (same as Shift+Tab)');
      for (let i = 0; i < 3 && !(await js<boolean>(`Boolean(document.querySelector('[data-testid="mode-chip"]')?.textContent.includes('Auto'))`)); i++) {
        await click('[data-testid="mode-chip"]');
      }
      check('Live: group switched to Auto', engine.conversation(team.id)?.mode === 'auto');
      await caption('Asking Frog to get Dog to write a haiku into the shared folder');
      await typeInto('[data-testid="composer"]', '@Frog please ask Dog to write a 3-line haiku about frogs and save it as frog-haiku.md in the shared folder. Tell me when it is done.');
      await click('[data-testid="send"]');
      const haiku = path.join(engine.paths.sharedDir, 'frog-haiku.md');
      const teamEnd = Date.now() + 240_000;
      let sawTogether = false;
      while (Date.now() < teamEnd) {
        if (!sawTogether && (await js<boolean>(`Boolean(document.querySelector('.working-bubble'))`).catch(() => false))) {
          sawTogether = true;
          await caption('Watch: the glowing bubbles show who is working, live');
          await shot('17-live-working');
        }
        const busy = Object.values(engine.snapshot().runtimes).some((r) => r.status === 'working' || r.status === 'waiting');
        if (fs.existsSync(haiku) && !busy) break;
        await sleep(700);
      }
      check('Live: work shown as it happened', sawTogether);
      check('Live: Frog handed the job to Dog in the group', engine.messages(team.id).some((m) => m.kind === 'relay' && m.relay?.toAgentId === dog.id));
      check('Live: Dog saved the haiku to the shared folder', fs.existsSync(haiku), fs.existsSync(haiku) ? fs.readFileSync(haiku, 'utf8').trim() : 'missing');
      check('Live: Dog replied in the group', engine.messages(team.id).some((m) => m.author.kind === 'agent' && m.author.agentId === dog.id && m.kind === 'text'));
      await caption('Done: Dog wrote the haiku and saved it');
      await shot('18-live-teamwork-done');
      await click(`[data-conversation-id="${frogThread.id}"]`);
    }

    // Right panel tabs.
    await caption("Opening Frog's panel: settings, files, screen");
    await click('[data-testid="toggle-panel"]');
    check('Agent panel opens', await waitFor(`document.querySelector('[data-testid="panel"]')`));
    for (const tab of ['details', 'library', 'computer']) {
      await click(`[data-testid="panel-tab-${tab}"]`);
      check(`Right panel: ${tab}`, await waitFor(`document.querySelector('[data-testid="panel-${tab}"]')`));
      await shot(`06-panel-${tab}`);
    }
    await click('[data-testid="toggle-panel"]');
    check('Agent panel closes', await waitFor(`!document.querySelector('[data-testid="panel"]')`));

    // Integrations sheet.
    await caption("Checking Integrations (ROS and the browser)");
    await click('[data-testid="open-integrations"]');
    check('Integrations sheet opens', await waitFor(`document.querySelector('[data-testid="integrations-sheet"]')`));
    check('ROS card shown', await waitFor(`document.querySelector('[data-integration-id="ros"]')`));
    await sleep(500);
    await shot('07-integrations');
    await click('[data-testid="template-custom-http"]');
    check('Custom integration form opens', await waitFor(`document.querySelector('[data-testid="integration-form"]')`));
    await shot('08-integration-form');
    await click('[data-testid="sheet-close"]');
    await waitFor(`!document.querySelector('[data-testid="integrations-sheet"]')`);
    // Slack: setup steps and the manifest button for making your own Slack app.
    await click('[data-testid="open-integrations"]');
    await waitFor(`document.querySelector('[data-testid="integrations-sheet"]')`);
    await click('[data-testid="template-slack"]');
    check('Slack form shows setup steps', await waitFor(`document.querySelector('[data-testid="integration-help"]')?.textContent.includes('api.slack.com/apps')`));
    check('Slack form offers the app manifest', await waitFor(`document.querySelector('[data-testid="copy-manifest"]')`));
    await shot('08b-slack-form');
    await click('[data-testid="sheet-close"]');
    await waitFor(`!document.querySelector('[data-testid="integrations-sheet"]')`);

    // Logs tab.
    await caption("Checking the Logs tab and Settings");
    await click('[data-testid="nav-logs"]');
    check('Logs view opens', await waitFor(`document.querySelector('[data-testid="logs-view"]')`));
    check('Logs show timestamped lines', await waitFor(`[...document.querySelectorAll('[data-testid="log-line"]')].length > 5`));
    check('Logs contain agent activity', await waitFor(`[...document.querySelectorAll('[data-testid="log-line"]')].some(e => e.textContent.includes('agent:Frog'))`));
    await shot('09-logs');
    await click('[data-testid="nav-chats"]');

    // Settings.
    await click('[data-testid="open-settings"]');
    check('Settings opens', await waitFor(`document.querySelector('[data-testid="settings-sheet"]')`));
    await shot('10-settings');
    await click('[data-testid="sheet-close"]');

    if (process.env.FROG_SMOKE_DEMO) {
      // A scripted teamwork scene (no AI calls): live bubbles, hand-off beam, needs-you bar, modes, plan.
      const frogId = frogThread.memberIds[0];
      const { agent: dog } = engine.createAgent({ name: 'Dog', label: 'Finds and transcribes videos', emoji: '🐶', color: '#ffb74d' });
      const team = engine.createGroup('Transcription team', [frogId, dog.id]);
      await sleep(300);
      await click(`[data-conversation-id="${team.id}"]`);
      await waitFor(`document.querySelector('[data-testid="chat-title"]')?.textContent.includes('Transcription team')`);
      await typeInto('[data-testid="composer"]', '@Frog please get Dog to transcribe the Mosh Python video, 2:00 to 3:00');
      await click('[data-testid="send"]');
      check('Demo: live working bubble appears', await waitFor(`document.querySelector('.working-bubble')`, 10000));
      await shot('11-working');
      check('Demo: teamwork beam when two agents work together', await waitFor(`document.querySelector('.teamwork')`, 15000));
      await shot('12-teamwork');
      check('Demo: hand-off shown in the group', await waitFor(`[...document.querySelectorAll('.relay')].some(e => e.textContent.includes('Dog'))`, 5000));

      await click(`[data-conversation-id="${frogThread.id}"]`);
      check('Demo: "needs you" bar shows Dog waiting, from another chat', await waitFor(`document.querySelector('[data-testid="needs-you"]')?.textContent.includes('Dog needs you')`, 25000));
      await shot('13-needs-you');
      await click('.needs-card .btn.primary');
      check('Demo: approving from the bar works', await waitFor(`!document.querySelector('[data-testid="needs-you"]')`, 10000));
      await click(`[data-conversation-id="${team.id}"]`);
      check('Demo: Dog\'s result lands in the group', await waitFor(`[...document.querySelectorAll('[data-testid="message"]')].some(e => e.textContent.includes('transcript is saved'))`, 20000));
      await shot('14-group-result');

      await click(`[data-conversation-id="${frogThread.id}"]`);
      await waitFor(`document.querySelector('[data-testid="mode-chip"]')`);
      const modeText = () => js<string>(`document.querySelector('[data-testid="mode-chip"]')?.textContent ?? ''`);
      const startMode = await modeText();
      await click('[data-testid="mode-chip"]');
      check('Demo: clicking the mode chip switches mode', await waitFor(`!document.querySelector('[data-testid="mode-chip"]')?.textContent.includes(${JSON.stringify(startMode.slice(0, 6))})`, 5000));
      await js(`document.querySelector('[data-testid="composer"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))`);
      check('Demo: Shift+Tab reaches Plan mode', await waitFor(`document.querySelector('[data-testid="mode-chip"]')?.textContent.includes('Plan')`, 5000));
      await shot('15-plan-mode');
      await typeInto('[data-testid="composer"]', 'Make a plan to transcribe the video');
      await click('[data-testid="send"]');
      check('Demo: "Run this plan" button after a plan', await waitFor(`document.querySelector('[data-testid="run-plan"]')`, 15000));
      await shot('16-plan');
      await click('[data-testid="run-plan"]');
      check('Demo: running the plan switches to Auto', await waitFor(`document.querySelector('[data-testid="mode-chip"]')?.textContent.includes('Auto')`, 5000));
    }

    // Engine-level checks.
    check('Logs recorded', engine.logs().length > 10, `${engine.logs().length} entries`);
    check('Log file written', fs.readdirSync(engine.paths.logsDir).some((f) => f.endsWith('.log')));
    engine.flush();
    check('State saved', fs.existsSync(path.join(engine.paths.stateDir, 'agents.json')));
  } catch (err) {
    check('Smoke run finished without crashing', false, err instanceof Error ? err.stack : String(err));
  }

  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
  if (visible) {
    await caption(failed.length ? `Finished: ${checks.length - failed.length} passed, ${failed.length} failed` : `Finished: all ${checks.length} checks passed ✅`);
    await sleep(15000);
  }
  return failed.length ? 1 : 0;
}
