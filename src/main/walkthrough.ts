import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { FrogEngine } from '../core/engine';

interface WalkthroughContext {
  engine: () => FrogEngine;
  window: BrowserWindow;
  outDir: string;
  /** "tour" (how to use Frog Bot) or "firstrun" (sign up, key, first chat: for the setup videos). */
  scene: string;
}

/** The size the app is filmed at (CSS pixels). Captured at 1920x1080. */
export const WALKTHROUGH_SIZE = { width: 1280, height: 720, scale: 1.5 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `electron . --smoke=<dir>` with FROG_WALKTHROUGH=<scene> films the real app
 * for the tutorial videos: a visible cursor clicks and types through the
 * screens while every frame is saved to <dir>/frames. Each chapter has the
 * line the narrator says; scripts/video/make-walkthroughs.mjs adds the voice.
 * It runs with the test sign-in service and the demo brain, so no AI is used.
 */
export async function runWalkthrough({ engine: getEngine, window, outDir, scene }: WalkthroughContext): Promise<number> {
  // Off-screen and without focus, like the self-test, at the filming size.
  window.setTitle('Frog Bot (recording)');
  window.setSkipTaskbar(true);
  window.setFocusable(false);
  window.setPosition(-20000, -20000);
  window.setContentSize(WALKTHROUGH_SIZE.width, WALKTHROUGH_SIZE.height);
  window.showInactive();
  const framesDir = path.join(outDir, 'frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const js = <T>(code: string) => window.webContents.executeJavaScript(code, true) as Promise<T>;
  const waitFor = async (code: string, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await js<boolean>(`Boolean(${code})`).catch(() => false)) return true;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for: ${code}`);
  };

  // Recorder: grab frames as fast as the window gives them, with their times.
  const times: number[] = [];
  let recording = true;
  const t0 = Date.now();
  const recorder = (async () => {
    while (recording) {
      const started = Date.now();
      const image = await window.webContents.capturePage(undefined, { stayAwake: true }).catch(() => null);
      if (image && !image.isEmpty()) {
        const n = times.length;
        times.push((started - t0) / 1000);
        await fs.promises.writeFile(path.join(framesDir, `f${String(n).padStart(5, '0')}.jpg`), image.toJPEG(90));
      }
      await sleep(Math.max(0, 50 - (Date.now() - started)));
    }
  })();

  const chapters: { id: string; say: string; frame: number }[] = [];
  const chapter = async (id: string, say: string) => {
    chapters.push({ id, say, frame: times.length });
    await sleep(300);
  };

  // A cursor the viewer can follow. It survives the page reloading after sign-out.
  let cursor = { x: WALKTHROUGH_SIZE.width / 2, y: WALKTHROUGH_SIZE.height / 2 };
  const ensureCursor = () =>
    js(`(() => {
      if (document.getElementById('wt-cursor')) return;
      const c = document.createElement('div');
      c.id = 'wt-cursor';
      c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.1 1.5 3.7 6.6-2.7 1.5-3.7-6.6L5 18.6z" fill="#fff" stroke="#0b0d0c" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 3px 6px rgba(0,0,0,.55));' +
        'transition:transform .75s cubic-bezier(.35,.75,.25,1);transform:translate(${cursor.x}px,${cursor.y}px)';
      document.body.appendChild(c);
      const s = document.createElement('style');
      s.textContent = '@keyframes wt-ring{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}' +
        '.wt-ring{position:fixed;width:44px;height:44px;border-radius:50%;border:3px solid #3ddc84;z-index:2147483646;pointer-events:none;animation:wt-ring .55s ease-out forwards}';
      document.head.appendChild(s);
    })()`);
  /** Move the cursor onto an element (found by a JS expression) and return whether it exists. */
  const moveTo = async (find: string) => {
    await ensureCursor();
    const point = await js<{ x: number; y: number } | null>(`(() => {
      const el = ${find};
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!point) throw new Error(`Not on screen: ${find}`);
    cursor = point;
    await js(`document.getElementById('wt-cursor').style.transform = 'translate(${point.x - 5}px,${point.y - 3}px)'`);
    await sleep(850);
  };
  const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const withText = (selector: string, text: string) =>
    `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))`;
  const click = async (find: string, after = 700) => {
    await moveTo(find);
    await js(`(() => {
      const r = document.createElement('div');
      r.className = 'wt-ring';
      r.style.left = '${cursor.x}px';
      r.style.top = '${cursor.y}px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
      const el = ${find};
      el.focus?.();
      el.click();
    })()`);
    await sleep(after);
  };
  /** Click into a field and type, a few letters at a time. */
  const type = async (find: string, text: string, { clear = true, cps = 22 } = {}) => {
    await click(find, 250);
    const start = clear ? '' : await js<string>(`(${find}).value`);
    const set = (v: string) =>
      js(`(() => {
        const el = ${find};
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(start + v)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    for (let i = 1; i <= text.length; i++) {
      await set(text.slice(0, i));
      await sleep(1000 / cps);
    }
    await sleep(400);
  };
  const key = (find: string, init: Record<string, unknown>) =>
    js(`(${find}).dispatchEvent(new KeyboardEvent('keydown', { ...${JSON.stringify(init)}, bubbles: true }))`);
  const conversation = (title: string) => {
    const c = getEngine().snapshot().conversations.find((x) => x.title === title);
    if (!c) throw new Error(`No chat called ${title}`);
    return q(`[data-conversation-id="${c.id}"]`);
  };

  let code = 0;
  try {
    await waitFor(q('[data-testid="auth-screen"]'));
    await ensureCursor();
    await sleep(600);

    // Both scenes start the way every new user does: create an account, add a key, say hi.
    await chapter('welcome', scene === 'tour'
      ? 'The first time you open Frog Bot, it asks you to sign in. Click Create an account.'
      : 'Frog Bot opens on the sign in screen. The first time, click Create an account.');
    await sleep(1200);
    await click(q('[data-testid="auth-to-sign-up"]'), 900);

    await chapter('account', 'Enter your name, your email, and a password of at least six characters. Then click Create account. Your team is private to your account.');
    await type(q('[data-testid="auth-name"]'), 'Sam Rivera');
    await type(q('[data-testid="auth-email"]'), 'sam@example.com');
    await type(q('[data-testid="auth-password"]'), 'frog-1234', { cps: 12 });
    await click(q('[data-testid="auth-submit"]'), 300);
    await waitFor(q('[data-testid="onboarding"]'));
    await ensureCursor();
    await sleep(1200);

    await chapter('key', 'Next, paste your Claude or OpenAI API key, and click Start. Your key stays encrypted on your own computer.');
    await type(q('[data-testid="onboarding-key"]'), 'sk-ant-api03-demo-key-for-the-tutorial-video', { cps: 60 });
    await click(withText('.welcome-card button.primary', 'Start'), 300);
    await waitFor(`!${q('[data-testid="onboarding"]')}`);
    await sleep(1500);

    await chapter('chat', 'This is your team. Frog is your lead agent. Say hi, and tell it what you need, in plain words, like you would tell a coworker.');
    await click(conversation('Frog'), 500);
    await type(q('[data-testid="composer"]'), 'Hi Frog, what can you do?');
    await click(q('[data-testid="send"]'), 500);
    await waitFor(`${withText('[data-testid="message"]', 'I am Frog')}`);
    await sleep(2500);

    if (scene === 'firstrun') {
      await chapter('you', 'Your name shows at the bottom left. Click it any time to change your picture, or to sign out. That is it. You are ready to go.');
      await moveTo(q('[data-testid="open-profile"]'));
      await sleep(2500);
    } else {
      await chapter('agent', 'To add a teammate, press the plus button, and choose New agent. Give it a name, a short role, and plain instructions for how it should help. Then click Create agent. Each agent gets its own memory and its own computer.');
      await click(q('[data-testid="new-menu"]'));
      await click(q('[data-testid="new-agent"]'), 900);
      await type(q('[data-testid="agent-name"]'), 'Dog');
      await type(q('[data-testid="agent-label"]'), 'Finds and transcribes videos');
      await type(q('[data-testid="agent-instructions"]'), 'Save transcripts in the shared folder.', { cps: 30 });
      await click(q('[data-testid="agent-save"]'), 1500);

      await chapter('group', 'Now put them in a group, so they can work together in front of you. Press plus, choose New group, name it, and pick who is in it.');
      await click(q('[data-testid="new-menu"]'));
      await click(q('[data-testid="new-group"]'), 900);
      await type(q('[data-testid="group-title"]'), 'Transcription team');
      await click(`${withText('.check-row', 'Frog')}?.querySelector('input')`, 400);
      await click(`${withText('.check-row', 'Dog')}?.querySelector('input')`, 400);
      await click(q('[data-testid="group-save"]'), 1500);

      await chapter('mention', 'In a group, type at, and a name, to talk to one agent. Press Tab to finish the name. Here, we ask Frog to get Dog to transcribe a video.');
      await type(q('[data-testid="composer"]'), '@Fr');
      await waitFor(q('[data-testid="mention-popup"]'), 5000);
      await sleep(900);
      await key(q('[data-testid="composer"]'), { key: 'Tab' });
      await sleep(600);
      await type(q('[data-testid="composer"]'), 'please get Dog to transcribe the Mosh Python video, 2:00 to 3:00', { clear: false, cps: 30 });
      await click(q('[data-testid="send"]'), 300);

      await chapter('teamwork', 'You see every step live. The glowing bubbles show who is working, and when Frog hands the job to Dog, the hand-off shows right in the chat.');
      await waitFor(q('.teamwork'), 20000);
      await moveTo(q('.relay') + ' || ' + q('.teamwork'));
      await sleep(4000);

      await chapter('needs-you', 'Anything that sends, posts, deletes, or runs a command asks you first. Even from another chat, a bar at the top shows who needs you, with the buttons right there.');
      await click(conversation('Frog'), 300);
      await waitFor(withText('[data-testid="needs-you"]', 'Dog needs you'), 30000);
      await sleep(1800);
      await click(q('.needs-card .btn.primary'), 1200);

      await chapter('result', 'Back in the group, Dog reports that the job is done. The transcript is saved in the shared folder for the whole team.');
      await click(conversation('Transcription team'), 300);
      await waitFor(withText('[data-testid="message"]', 'transcript is saved'), 30000);
      await moveTo(withText('[data-testid="message"]', 'transcript is saved'));
      await sleep(2000);

      await chapter('modes', 'Under the message box, choose how free your agents are. Ask first, Auto, or Plan. Click the mode, or press Shift and Tab.');
      await click(conversation('Frog'), 600);
      await click(q('[data-testid="mode-chip"]'), 1200);
      for (let i = 0; i < 3 && !(await js<boolean>(`${q('[data-testid="mode-chip"]')}.textContent.includes('Plan')`)); i++) {
        await key(q('[data-testid="composer"]'), { key: 'Tab', shiftKey: true });
        await sleep(1000);
      }

      await chapter('plan', 'In Plan mode, the agent only makes a plan. When you like it, click Run this plan, and it gets to work.');
      await type(q('[data-testid="composer"]'), 'Make a plan to transcribe the video');
      await click(q('[data-testid="send"]'), 300);
      await waitFor(q('[data-testid="run-plan"]'), 20000);
      await sleep(1200);
      await click(q('[data-testid="run-plan"]'), 2500);

      await chapter('panel', 'Click the panel button to see an agent up close: its setup and brain, its files, and its own screen while it works. Close it with the X.');
      await click(q('[data-testid="toggle-panel"]'), 1200);
      for (const tab of ['library', 'computer']) await click(q(`[data-testid="panel-tab-${tab}"]`), 1600);
      await click(q('[data-testid="close-panel"]'), 900);

      await chapter('apps', 'Open Integrations, at the bottom left, to connect your apps. The browser is built in. For Slack, one button opens Slack with your app already filled in.');
      await click(q('[data-testid="open-integrations"]'), 1500);
      await click(q('[data-testid="template-slack"]'), 1200);
      await moveTo(q('[data-testid="create-app"]'));
      await sleep(2500);
      await click(q('[data-testid="sheet-close"]'), 900);

      await chapter('logs', 'The Logs tab shows everything that happened, with the date and time. And Settings is where you change your key, your team name, and how much to spend.');
      await click(q('[data-testid="nav-logs"]'), 2200);
      await click(q('[data-testid="nav-chats"]'), 600);
      await click(q('[data-testid="open-settings"]'), 2500);
      await click(q('[data-testid="sheet-close"]'), 900);

      await chapter('profile', 'Your name is at the bottom left. Click it to change your name and picture, or to sign out.');
      await click(q('[data-testid="open-profile"]'), 1500);
      await moveTo(q('[data-testid="sign-out"]'));
      await sleep(1500);
      await click(q('[data-testid="sheet-close"]'), 900);

      await chapter('outro', 'Closing the window keeps Frog Bot working from the tray, while your computer is on. That is it. Now give your team its first job.');
      await click(conversation('Transcription team'), 3000);
    }
    await sleep(800);
  } catch (err) {
    code = 1;
    fs.writeFileSync(path.join(outDir, 'error.txt'), err instanceof Error ? err.stack ?? err.message : String(err));
  }
  recording = false;
  await recorder;
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ scene, end: (Date.now() - t0) / 1000, times, chapters }, null, 2));
  return code;
}
