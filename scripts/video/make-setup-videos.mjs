// Makes the three setup videos (Windows, Mac, Linux): branded slides with real
// screenshots, narrated by the computer's built-in voice, with subtitles.
//   node scripts/video/make-setup-videos.mjs <outDir>
// Needs Windows (for the voice) and ffmpeg on PATH. No AI services are used.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import electron from 'electron';
import { root } from '../tasks.mjs';

const outDir = path.resolve(process.argv[2] || path.join(root, 'tutorial'));
const screens = path.join(root, 'tutorial', 'screens');
const SITE = 'sayeemkabir.github.io/frogbot';
const logo = pathToFileURL(path.join(root, 'build', 'icon.png')).href;
const shot = (name) => pathToFileURL(path.join(screens, name)).href;

/** One slide: what's on screen, and what the voice says. */
const slide = (o) => o;

const VIDEOS = {
  usage: [
    slide({ kicker: 'Tutorial', title: 'How to use Frog Bot', body: 'Your AI team, on your computer.', say: 'Welcome to Frog Bot. In the next few minutes you will see how to work with your own team of AI agents, right on your computer.' }),
    slide({ step: 1, title: 'Add your key once', body: 'Paste a Claude or OpenAI API key on the welcome screen. It stays encrypted on your computer.', image: '01-onboarding.png', say: 'The first time you open Frog Bot, paste a Claude or OpenAI API key and click Start. It stays encrypted on your own computer.' }),
    slide({ step: 2, title: 'Chat with Frog', body: 'Frog is your lead agent. Tell it what you need, in plain words.', image: '05-chat.png', say: 'Frog is your lead agent. Just tell it what you need, in plain words, like you would tell a coworker.' }),
    slide({ step: 3, title: 'Add teammates', body: 'Press <b>+</b>, then <b>New agent</b>. Give it a name, an emoji and a job.', image: '03-new-agent.png', say: 'To add a teammate, press the plus button and choose New agent. Give it a name, pick an emoji, and describe its job.' }),
    slide({ step: 4, title: 'Put them in a group', body: 'In a group, everyone sees the chat. Type <b>@Name</b> to talk to one agent. Hand-offs happen right there.', image: '12-teamwork.png', say: 'Put agents in a group, and they work together in front of you. Type at, and a name, to talk to one of them. When two agents work together, you see them glow, with a beam between them.' }),
    slide({ step: 5, title: 'Choose how free they are', body: '<b>✋ Ask first</b>, <b>⚡ Auto</b> or <b>📝 Plan</b>, under the message box. Click it, or press <b>Shift+Tab</b>.', image: '16-plan.png', say: 'Under the message box you choose a mode. Ask first, asks before changing things. Auto, just gets it done. Plan, only makes a plan, and gives you a Run this plan button. Click the mode, or press Shift and Tab to switch.' }),
    slide({ step: 6, title: 'You stay in control', body: 'Anything that sends, posts or deletes shows <b>Allow</b> / <b>Don\'t allow</b> first.', image: '05b-approval.png', say: 'Anything that sends a message, posts, or deletes, always asks you first. You choose Allow, or Don\'t allow.' }),
    slide({ step: 7, title: 'Never miss a request', body: 'If an agent needs you in another chat, a bar shows it on top, with the buttons right there.', image: '13-needs-you.png', say: 'If an agent needs you in a different chat, a bar appears at the top of whatever you are looking at, with the buttons right there.' }),
    slide({ step: 8, title: 'Connect your apps', body: 'Open <b>Integrations</b> (bottom left). The browser is built in. Add Slack, Notion, GitHub and more.', image: '07-integrations.png', say: 'Open Integrations, at the bottom left, to see your connected apps. The browser is built in, and you can add Slack, Notion, GitHub, and more.' }),
    slide({ step: 9, title: 'See everything that happens', body: 'The <b>Logs</b> tab lists every action with date and time. Settings has <b>Save tokens</b> to spend less.', image: '09-logs.png', say: 'The Logs tab shows everything that happened, with the date and time. And in Settings, Save tokens keeps your AI costs low.' }),
    slide({ kicker: 'That\'s it', title: 'Give your team its first job', body: 'Frog Bot keeps working from the tray while your computer is on.', say: 'That is all you need. Give your team its first job. Frog Bot keeps working from the tray, as long as your computer is on.' }),
  ],
  windows: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on Windows', body: 'About two minutes, no technical skills needed.', say: 'Here is how to install Frog Bot on Windows. It takes about two minutes, and you do not need any technical skills.' }),
    slide({ step: 1, title: 'Download the installer', body: `Go to <b>${SITE}</b> and click <b>Download for Windows</b>.`, button: 'Download for Windows', say: `Open your browser and go to ${SITE.replace(/\./g, ' dot ').replace(/\//g, ' slash ')}. Click the green Download for Windows button.` }),
    slide({ step: 2, title: 'Run it', body: 'Open <b>FrogBot-Setup-Windows.exe</b>. If Windows shows “Windows protected your PC”, click <b>More info</b>, then <b>Run anyway</b>.', smartscreen: true, say: 'Open the file you downloaded. If Windows says it protected your PC, that is normal for new apps. Click More info, then Run anyway. Frog Bot installs and opens by itself.' }),
    slide({ step: 3, title: 'Paste your API key', body: 'Paste a Claude or OpenAI API key and click <b>Start</b>. It stays encrypted on your computer.', image: '01-onboarding.png', say: 'On the welcome screen, paste your Claude or OpenAI API key and click Start. Your key stays encrypted on your own computer.' }),
    slide({ step: 4, title: 'Connect your apps', body: 'Open <b>Integrations</b> (bottom left) to add Slack, Notion, GitHub and more. Optional.', image: '07-integrations.png', say: 'If you like, open Integrations at the bottom left to connect apps like Slack, Notion or GitHub.' }),
    slide({ step: 5, title: 'Chat with Frog', body: 'Tell Frog what you need. Add more agents with the <b>+</b> button.', image: '05-chat.png', say: 'That is it. Chat with Frog like you would with a teammate, and add more agents with the plus button.' }),
    slide({ kicker: 'Good to know', title: 'Frog Bot keeps working', body: 'Closing the window keeps it running in the tray. Right-click the tray frog and choose <b>Quit</b> to close it fully.', say: 'One last thing. Closing the window keeps Frog Bot running in the tray, so your agents can keep working. To close it fully, right click the frog in the tray and choose Quit.' }),
  ],
  mac: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on a Mac', body: 'One command does everything. About two minutes.', say: 'Here is how to install Frog Bot on a Mac. One command does everything, and it takes about two minutes.' }),
    slide({ step: 1, title: 'Open Terminal', body: 'Press <b>⌘ Command + Space</b>, type <b>Terminal</b>, and press <b>Enter</b>.', keys: ['⌘', 'Space'], say: 'First, open Terminal. Press Command and Space together, type Terminal, and press Enter.' }),
    slide({ step: 2, title: 'Paste the install command', body: `Copy it from <b>${SITE}</b>, paste it into Terminal, and press <b>Enter</b>.`, code: `curl -fsSL https://${SITE}/install-mac.sh | bash`, say: 'Go to the Frog Bot website and copy the Mac install command. Paste it into Terminal and press Enter. It downloads Frog Bot, puts it in your Applications folder, takes care of Mac security, and opens the app.' }),
    slide({ step: 3, title: 'Paste your API key', body: 'Paste a Claude or OpenAI API key and click <b>Start</b>.', image: '01-onboarding.png', say: 'When Frog Bot opens, paste your Claude or OpenAI API key and click Start.' }),
    slide({ step: 4, title: 'Connect your apps', body: 'Open <b>Integrations</b> (bottom left) to add Slack, Notion, GitHub and more. Optional.', image: '07-integrations.png', say: 'If you like, open Integrations at the bottom left to connect apps like Slack, Notion or GitHub.' }),
    slide({ step: 5, title: 'Chat with Frog', body: 'Find Frog Bot in Applications or Launchpad any time.', image: '05-chat.png', say: 'Now chat with Frog. Next time, open Frog Bot from Applications or Launchpad.' }),
    slide({ kicker: 'Good to know', title: 'Downloaded the zip instead?', body: 'Move it to Applications, then run this once in Terminal:', code: 'xattr -cr "/Applications/Frog Bot.app" && codesign --force --deep --sign - "/Applications/Frog Bot.app"', say: 'If you downloaded the zip file instead, move Frog Bot to Applications, and run the command on screen once in Terminal. The install command does this for you.' }),
  ],
  linux: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on Linux', body: 'One command, for 64-bit Linux. About two minutes.', say: 'Here is how to install Frog Bot on Linux. One command does it, on any 64 bit Linux.' }),
    slide({ step: 1, title: 'Open a terminal', body: 'On Ubuntu, press <b>Ctrl + Alt + T</b>.', keys: ['Ctrl', 'Alt', 'T'], say: 'First, open a terminal. On Ubuntu, press Control, Alt and T together.' }),
    slide({ step: 2, title: 'Paste the install command', body: `Copy it from <b>${SITE}</b> and press <b>Enter</b>. It may ask your password once.`, code: `curl -fsSL https://${SITE}/install-linux.sh | bash`, say: 'Go to the Frog Bot website, copy the Linux install command, paste it into the terminal, and press Enter. It may ask for your password once, to set up the browser security sandbox.' }),
    slide({ step: 3, title: 'Paste your API key', body: 'Frog Bot opens by itself. Paste a Claude or OpenAI API key and click <b>Start</b>.', image: '01-onboarding.png', say: 'Frog Bot opens by itself. Paste your Claude or OpenAI API key and click Start.' }),
    slide({ step: 4, title: 'Connect your apps', body: 'Open <b>Integrations</b> (bottom left) to add Slack, Notion, GitHub and more. Optional.', image: '07-integrations.png', say: 'If you like, open Integrations at the bottom left to connect apps like Slack, Notion or GitHub.' }),
    slide({ step: 5, title: 'Chat with Frog', body: 'Open it later from your apps menu, or type <b>frogbot</b> in a terminal.', image: '05-chat.png', say: 'Now chat with Frog. Next time, open Frog Bot from your apps menu, or type frogbot in a terminal.' }),
  ],
};

const CSS = `
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{background:#07090a;color:#ecf3ee;font-family:'Segoe UI Variable','Segoe UI',Inter,sans-serif;position:relative}
.amb{position:absolute;inset:-20%;filter:blur(40px);background:radial-gradient(35% 30% at 18% 18%,rgba(61,220,132,.28),transparent 70%),radial-gradient(30% 28% at 88% 12%,rgba(79,195,247,.18),transparent 70%),radial-gradient(40% 35% at 60% 95%,rgba(186,104,200,.14),transparent 70%)}
.top{position:absolute;top:56px;left:80px;display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700}
.top img{width:52px;height:52px}
.os{position:absolute;top:62px;right:80px;font-size:24px;color:#a3b1a8;border:1px solid rgba(255,255,255,.12);padding:8px 18px;border-radius:999px}
.main{position:absolute;inset:170px 80px 90px;display:grid;grid-template-columns:1fr 1.25fr;gap:70px;align-items:center}
.main.center{grid-template-columns:1fr;text-align:center;justify-items:center}
.kicker{display:inline-block;font-size:26px;font-weight:700;color:#3ddc84;background:rgba(61,220,132,.12);border:1px solid rgba(61,220,132,.35);padding:8px 20px;border-radius:999px}
h1{font-size:84px;line-height:1.05;margin:26px 0 22px;letter-spacing:-1.5px}
p{font-size:38px;line-height:1.45;color:#c9d6ce;margin:0}
b{color:#fff}
.frame{border-radius:28px;overflow:hidden;border:2px solid rgba(255,255,255,.1);box-shadow:0 40px 120px rgba(0,0,0,.7)}
.frame img{display:block;width:100%}
.code{margin-top:36px;background:#030504;border:2px solid rgba(61,220,132,.35);border-radius:22px;padding:30px 34px;font:34px/1.5 'Cascadia Code',Consolas,monospace;color:#bfe8cf;word-break:break-all;text-align:left}
.btn{display:inline-block;margin-top:40px;padding:30px 60px;border-radius:24px;font-size:44px;font-weight:800;color:#03140a;background:linear-gradient(135deg,#46e690,#22b866);box-shadow:0 20px 60px rgba(61,220,132,.45)}
.keys{display:flex;gap:22px;margin-top:40px}
.key{min-width:140px;padding:30px 36px;border-radius:22px;background:linear-gradient(#2a312e,#171b19);border:2px solid rgba(255,255,255,.14);border-bottom-width:8px;font-size:52px;font-weight:700;text-align:center}
.smart{background:#0b4f8a;border-radius:20px;padding:44px;color:#fff;box-shadow:0 40px 120px rgba(0,0,0,.6);text-align:left}
.smart h2{font-size:52px;margin:0 0 20px;font-weight:600}.smart p{color:#e3eefb;font-size:32px}
.smart .row{display:flex;gap:20px;margin-top:40px}.smart .b{padding:16px 34px;border:2px solid #fff;border-radius:10px;font-size:30px}
.smart .hl{outline:6px solid #ffd54f;outline-offset:6px}
.bigfrog{width:240px;height:240px;filter:drop-shadow(0 30px 60px rgba(61,220,132,.45))}
`;

function slideHtml(s, osLabel) {
  const left = `
    ${s.step ? `<div class="kicker">Step ${s.step}</div>` : `<div class="kicker">${s.kicker}</div>`}
    <h1>${s.title}</h1>
    <p>${s.body}</p>
    ${s.code ? `<div class="code">${s.code}</div>` : ''}
    ${s.button ? `<div class="btn">⬇ ${s.button}</div>` : ''}
    ${s.keys ? `<div class="keys">${s.keys.map((k) => `<div class="key">${k}</div>`).join('')}</div>` : ''}`;
  let right = '';
  if (s.image) right = `<div class="frame"><img src="${shot(s.image)}"></div>`;
  else if (s.smartscreen) {
    right = `<div class="smart"><h2>Windows protected your PC</h2><p>Microsoft Defender SmartScreen prevented an unrecognized app from starting.</p><p style="margin-top:18px"><u class="hl">More info</u></p><div class="row"><span class="b hl">Run anyway</span><span class="b">Don't run</span></div></div>`;
  }
  const centered = !right;
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style><div class="amb"></div>
    <div class="top"><img src="${logo}"> Frog Bot</div><div class="os">${osLabel}</div>
    <div class="main ${centered ? 'center' : ''}">
      ${centered && !s.step ? `<img class="bigfrog" src="${logo}">` : ''}
      <div>${left}</div>${right ? `<div>${right}</div>` : ''}
    </div>`;
}

function speak(text, wav) {
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    `try { $s.SelectVoice('Microsoft Zira Desktop') } catch {}; $s.Rate = 0; $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); ` +
    `$s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { input: text });
}

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

const vttTime = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(3).padStart(6, '0');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`;
};

fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(3);
for (const [osName, slides] of Object.entries(VIDEOS)) {
  if (only.length && !only.includes(osName)) continue;
  const label = { usage: 'Tutorial', windows: 'Windows', mac: 'macOS', linux: 'Linux' }[osName];
  const baseName = osName === 'usage' ? 'frog-bot-tutorial' : `setup-${osName}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `frog-video-${osName}-`));
  const jobs = slides.map((s, i) => {
    const html = path.join(work, `s${i}.html`);
    fs.writeFileSync(html, slideHtml(s, label));
    return { html, png: path.join(work, `s${i}.png`) };
  });
  fs.writeFileSync(path.join(work, 'jobs.json'), JSON.stringify(jobs));
  execFileSync(electron, [path.join(root, 'scripts', 'video', 'render.cjs'), path.join(work, 'jobs.json')], { stdio: 'inherit' });

  const clips = [];
  const cues = [];
  let t = 0;
  slides.forEach((s, i) => {
    const wav = path.join(work, `s${i}.wav`);
    speak(s.say, wav);
    const d = duration(wav) + 0.8;
    const clip = path.join(work, `c${i}.mp4`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', jobs[i].png, '-i', wav, '-af', 'apad', '-t', d.toFixed(2),
      '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-tune', 'stillimage', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', clip]);
    clips.push(clip);
    cues.push(`${vttTime(t)} --> ${vttTime(t + d - 0.4)}\n${s.say}`);
    t += d;
  });
  const list = path.join(work, 'list.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
  const out = path.join(outDir, `${baseName}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
  fs.writeFileSync(path.join(outDir, `${baseName}.vtt`), `WEBVTT\n\n${cues.join('\n\n')}\n`);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`✓ ${out} (${t.toFixed(0)}s)`);
}
