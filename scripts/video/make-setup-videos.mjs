// Makes the tutorial and the three setup videos (Windows, Mac, Linux): branded
// slides plus real recordings of the app being used (src/main/walkthrough.ts),
// narrated by the computer's built-in voice, with subtitles.
//   npm run build && node scripts/video/make-setup-videos.mjs <outDir> [usage|windows|mac|linux…]
// Needs Windows (for the voice) and ffmpeg on PATH. No AI services are used: the
// recordings run with a test sign-in service and a pretend brain.
import { execFileSync, spawnSync } from 'node:child_process';
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
    { record: 'tour' },
  ],
  windows: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on Windows', body: 'About two minutes, no technical skills needed.', say: 'Here is how to install Frog Bot on Windows. It takes about two minutes, and you do not need any technical skills.' }),
    slide({ step: 1, title: 'Download the installer', body: `Go to <b>${SITE}</b> and click <b>Download for Windows</b>.`, button: 'Download for Windows', say: `Open your browser and go to ${SITE.replace(/\./g, ' dot ').replace(/\//g, ' slash ')}. Click the green Download for Windows button.` }),
    slide({ step: 2, title: 'Run it', body: 'Open <b>FrogBot-Setup-Windows.exe</b>. If Windows shows “Windows protected your PC”, click <b>More info</b>, then <b>Run anyway</b>.', smartscreen: true, say: 'Open the file you downloaded. If Windows says it protected your PC, that is normal for new apps. Click More info, then Run anyway. Frog Bot installs and opens by itself.' }),
    { record: 'firstrun' },
    slide({ kicker: 'Good to know', title: 'Frog Bot keeps working', body: 'Closing the window keeps it running in the tray. Right-click the tray frog and choose <b>Quit</b> to close it fully.', say: 'One last thing. Closing the window keeps Frog Bot running in the tray, so your agents can keep working. To close it fully, right click the frog in the tray and choose Quit.' }),
  ],
  mac: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on a Mac', body: 'One command does everything. About two minutes.', say: 'Here is how to install Frog Bot on a Mac. One command does everything, and it takes about two minutes.' }),
    slide({ step: 1, title: 'Open Terminal', body: 'Press <b>⌘ Command + Space</b>, type <b>Terminal</b>, and press <b>Enter</b>.', keys: ['⌘', 'Space'], say: 'First, open Terminal. Press Command and Space together, type Terminal, and press Enter.' }),
    slide({ step: 2, title: 'Paste the install command', body: `Copy it from <b>${SITE}</b>, paste it into Terminal, and press <b>Enter</b>.`, code: `curl -fsSL https://${SITE}/install-mac.sh | bash`, say: 'Go to the Frog Bot website and copy the Mac install command. Paste it into Terminal and press Enter. It downloads Frog Bot, puts it in your Applications folder, takes care of Mac security, and opens the app.' }),
    { record: 'firstrun' },
    slide({ kicker: 'Good to know', title: 'Open it again later', body: 'Frog Bot is in <b>Applications</b> and <b>Launchpad</b>.', say: 'Next time, open Frog Bot from Applications, or from Launchpad.' }),
    slide({ kicker: 'Good to know', title: 'Downloaded the zip instead?', body: 'Move it to Applications, then run this once in Terminal:', code: 'xattr -cr "/Applications/Frog Bot.app" && codesign --force --deep --sign - "/Applications/Frog Bot.app"', say: 'If you downloaded the zip file instead, move Frog Bot to Applications, and run the command on screen once in Terminal. The install command does this for you.' }),
  ],
  linux: [
    slide({ kicker: 'Setup guide', title: 'Install Frog Bot on Linux', body: 'One command, for 64-bit Linux. About two minutes.', say: 'Here is how to install Frog Bot on Linux. One command does it, on any 64 bit Linux.' }),
    slide({ step: 1, title: 'Open a terminal', body: 'On Ubuntu, press <b>Ctrl + Alt + T</b>.', keys: ['Ctrl', 'Alt', 'T'], say: 'First, open a terminal. On Ubuntu, press Control, Alt and T together.' }),
    slide({ step: 2, title: 'Paste the install command', body: `Copy it from <b>${SITE}</b> and press <b>Enter</b>. It may ask your password once.`, code: `curl -fsSL https://${SITE}/install-linux.sh | bash`, say: 'Go to the Frog Bot website, copy the Linux install command, paste it into the terminal, and press Enter. It may ask for your password once, to set up the browser security sandbox.' }),
    { record: 'firstrun' },
    slide({ kicker: 'Good to know', title: 'Open it again later', body: 'From your apps menu, or type <b>frogbot</b> in a terminal.', say: 'Next time, open Frog Bot from your apps menu, or type frogbot in a terminal.' }),
  ],
};

const CSS = `
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{background:#0b0c0e;color:#ededef;font-family:Inter,'Segoe UI Variable','Segoe UI',sans-serif;position:relative}
.amb{position:absolute;inset:0;background:radial-gradient(60% 50% at 50% 115%,rgba(47,191,113,.08),transparent 70%)}
.top{position:absolute;top:56px;left:80px;display:flex;align-items:center;gap:16px;font-size:30px;font-weight:650;letter-spacing:-.3px}
.top img{width:52px;height:52px}
.os{position:absolute;top:62px;right:80px;font-size:24px;color:#a1a1aa;border:1px solid rgba(255,255,255,.12);padding:8px 18px;border-radius:12px}
.main{position:absolute;inset:170px 80px 90px;display:grid;grid-template-columns:1fr 1.25fr;gap:70px;align-items:center}
.main.center{grid-template-columns:1fr;text-align:center;justify-items:center}
.kicker{display:inline-block;font-size:26px;font-weight:600;color:#2fbf71;letter-spacing:.3px}
h1{font-size:84px;line-height:1.05;margin:18px 0 22px;letter-spacing:-2.5px;font-weight:650}
p{font-size:38px;line-height:1.45;color:#a1a1aa;margin:0}
b{color:#fff}
.frame{border-radius:20px;overflow:hidden;border:2px solid rgba(255,255,255,.12);box-shadow:0 40px 120px rgba(0,0,0,.6)}
.frame img{display:block;width:100%}
.code{margin-top:36px;background:#111215;border:2px solid rgba(255,255,255,.14);border-radius:18px;padding:30px 34px;font:34px/1.5 'Cascadia Code',Consolas,monospace;color:#ededef;word-break:break-all;text-align:left}
.btn{display:inline-block;margin-top:40px;padding:28px 56px;border-radius:18px;font-size:42px;font-weight:600;color:#04140b;background:#2fbf71}
.keys{display:flex;gap:22px;margin-top:40px}
.key{min-width:140px;padding:30px 36px;border-radius:18px;background:#16181c;border:2px solid rgba(255,255,255,.14);border-bottom-width:6px;font-size:50px;font-weight:600;text-align:center}
.smart{background:#0b4f8a;border-radius:20px;padding:44px;color:#fff;box-shadow:0 40px 120px rgba(0,0,0,.6);text-align:left}
.smart h2{font-size:52px;margin:0 0 20px;font-weight:600}.smart p{color:#e3eefb;font-size:32px}
.smart .row{display:flex;gap:20px;margin-top:40px}.smart .b{padding:16px 34px;border:2px solid #fff;border-radius:10px;font-size:30px}
.smart .hl{outline:6px solid #ffd54f;outline-offset:6px}
.bigfrog{width:180px;height:180px;border-radius:40px}
`;

function slideHtml(s, osLabel) {
  const left = `
    ${s.step ? `<div class="kicker">Step ${s.step}</div>` : `<div class="kicker">${s.kicker}</div>`}
    <h1>${s.title}</h1>
    <p>${s.body}</p>
    ${s.code ? `<div class="code">${s.code}</div>` : ''}
    ${s.button ? `<div class="btn">${s.button}</div>` : ''}
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

const ENCODE = ['-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '1'];

/** A narrated slide as a clip. */
function slideClip(s, png, work, i) {
  const wav = path.join(work, `s${i}.wav`);
  speak(s.say, wav);
  const d = duration(wav) + 0.8;
  const file = path.join(work, `c${i}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', png, '-i', wav, '-af', 'apad', '-t', d.toFixed(2),
    '-vf', 'scale=1920:1080,setsar=1,fps=30', '-tune', 'stillimage', ...ENCODE, file]);
  return { file, duration: d, cues: [{ start: 0, end: d - 0.4, text: s.say }] };
}

/**
 * Films a scene of the real app (src/main/walkthrough.ts) and narrates it. Where
 * a line takes longer to say than the action on screen, the last frame of that
 * part is held until the voice catches up.
 */
const recordings = new Map();
function recordedClip(scene, work) {
  if (recordings.has(scene)) return recordings.get(scene);
  const dir = path.join(work, `rec-${scene}`);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Filming the app: ${scene}…`);
  const run = spawnSync(electron, ['.', `--smoke=${dir}`], {
    cwd: root,
    stdio: 'ignore',
    timeout: 10 * 60_000,
    env: { ...process.env, FROG_SMOKE_AUTH: '1', FROG_SMOKE_DEMO: '1', FROG_WALKTHROUGH: scene, ELECTRON_ENABLE_LOGGING: '0' },
  });
  const errFile = path.join(dir, 'error.txt');
  if (run.status !== 0 || fs.existsSync(errFile)) throw new Error(`Filming ${scene} failed: ${fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : `exit ${run.status}`}`);
  const { times, chapters, end } = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));

  const frameLen = times.map((t, k) => (k + 1 < times.length ? times[k + 1] : end) - t);
  const cues = [];
  const audio = [];
  let at = 0;
  chapters.forEach((c, i) => {
    const first = c.frame;
    const last = (i + 1 < chapters.length ? chapters[i + 1].frame : times.length) - 1;
    const shown = frameLen.slice(first, last + 1).reduce((a, b) => a + b, 0);
    const wav = path.join(dir, `${c.id}.wav`);
    speak(c.say, wav);
    const said = duration(wav);
    const len = Math.max(shown, said + 0.7);
    frameLen[last] += len - shown;
    const padded = path.join(dir, `${c.id}-pad.wav`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', 'apad', '-t', len.toFixed(3), '-ar', '44100', '-ac', '1', padded]);
    audio.push(padded);
    cues.push({ start: at, end: at + said + 0.3, text: c.say });
    at += len;
  });
  const frames = path.join(dir, 'frames.txt');
  // The film starts at the first chapter, once the app is on screen.
  const lines = times.map((_, k) => `file 'frames/f${String(k).padStart(5, '0')}.jpg'\nduration ${frameLen[k].toFixed(4)}`).slice(chapters[0].frame);
  fs.writeFileSync(frames, `${lines.join('\n')}\nfile 'frames/f${String(times.length - 1).padStart(5, '0')}.jpg'\n`);
  const voice = path.join(dir, 'voice.txt');
  fs.writeFileSync(voice, audio.map((a) => `file '${a.replace(/\\/g, '/')}'`).join('\n'));
  const voiceWav = path.join(dir, 'voice.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', voice, '-c', 'copy', voiceWav]);
  const file = path.join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', frames, '-i', voiceWav,
    '-vf', 'scale=1920:1080:flags=lanczos,setsar=1,fps=30', '-fps_mode', 'cfr', '-t', at.toFixed(3), ...ENCODE, file], { cwd: dir });
  const clip = { file, duration: duration(file), cues };
  recordings.set(scene, clip);
  return clip;
}

fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(3);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-video-'));
for (const [osName, parts] of Object.entries(VIDEOS)) {
  if (only.length && !only.includes(osName)) continue;
  const label = { usage: 'Tutorial', windows: 'Windows', mac: 'macOS', linux: 'Linux' }[osName];
  const baseName = osName === 'usage' ? 'frog-bot-tutorial' : `setup-${osName}`;
  const slideWork = path.join(work, osName);
  fs.mkdirSync(slideWork, { recursive: true });
  const jobs = parts.map((s, i) => (s.record ? null : { html: path.join(slideWork, `s${i}.html`), png: path.join(slideWork, `s${i}.png`) }));
  parts.forEach((s, i) => jobs[i] && fs.writeFileSync(jobs[i].html, slideHtml(s, label)));
  fs.writeFileSync(path.join(slideWork, 'jobs.json'), JSON.stringify(jobs.filter(Boolean)));
  execFileSync(electron, [path.join(root, 'scripts', 'video', 'render.cjs'), path.join(slideWork, 'jobs.json')], { stdio: 'ignore' });

  const clips = parts.map((s, i) => (s.record ? recordedClip(s.record, work) : slideClip(s, jobs[i].png, slideWork, i)));
  const out = path.join(outDir, `${baseName}.mp4`);
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const joined = clips.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${clips.length}:v=1:a=1[v][a]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', joined, '-map', '[v]', '-map', '[a]', ...ENCODE, '-movflags', '+faststart', out]);
  const cues = [];
  let t = 0;
  for (const c of clips) {
    for (const cue of c.cues) cues.push(`${vttTime(t + cue.start)} --> ${vttTime(t + cue.end)}\n${cue.text}`);
    t += c.duration;
  }
  fs.writeFileSync(path.join(outDir, `${baseName}.vtt`), `WEBVTT\n\n${cues.join('\n\n')}\n`);
  console.log(`✓ ${out} (${t.toFixed(0)}s)`);
}
fs.rmSync(work, { recursive: true, force: true });
