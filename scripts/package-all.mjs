// Build installers for every platform from this one machine.
//   node scripts/package-all.mjs            → windows, linux, mac
//   node scripts/package-all.mjs mac linux  → just those
//
// Windows uses electron-builder as-is. For Linux and macOS the app archive is
// re-packed with that platform's Claude engine (npm only installs the engine
// for the computer it runs on), and the macOS app is assembled straight into a
// zip from Electron's official macOS build, so symlinks inside the Mac app are
// kept even though Windows cannot create them on disk.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import asar from '@electron/asar';
import { downloadArtifact } from '@electron/get';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { root } from './tasks.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const SDK_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'), 'utf8')).version;
const ELECTRON = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
const ENGINES = path.join(root, '.engines');
const RELEASE = path.join(root, 'release');
const PRODUCT = pkg.build.productName;
const UNPACK = '{**/claude-agent-sdk-*/**,**/@playwright/mcp/**,**/playwright/**,**/playwright-core/**}';

const wanted = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['win', 'linux', 'mac']);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
// GNU tar on Windows needs forward slashes and --force-local (else C: looks like a host name).
const fwd = (p) => p.split(path.sep).join('/');
const mb = (file) => `${(fs.statSync(file).size / 1e6).toFixed(0)} MB`;

/** The Claude engine package for a platform, downloaded once into .engines/. */
function engine(platform) {
  const name = `claude-agent-sdk-${platform}`;
  const dir = path.join(ENGINES, `${name}-${SDK_VERSION}`);
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  fs.mkdirSync(ENGINES, { recursive: true });
  console.log(`  downloading the ${platform} engine…`);
  const file = execSync(`npm pack @anthropic-ai/${name}@${SDK_VERSION} --silent --pack-destination "${ENGINES}"`, { cwd: root }).toString().trim().split('\n').pop();
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['--force-local', '-xzf', fwd(path.join(ENGINES, file)), '-C', fwd(dir), '--strip-components=1']);
  fs.rmSync(path.join(ENGINES, file), { force: true });
  return dir;
}

/** Re-pack an app.asar with only the given platform's engine inside. */
async function repack(srcAsar, platform, work) {
  const staging = path.join(work, `app-${platform}`);
  asar.extractAll(srcAsar, staging);
  const scope = path.join(staging, 'node_modules', '@anthropic-ai');
  for (const dir of fs.readdirSync(scope)) if (dir.startsWith('claude-agent-sdk-')) fs.rmSync(path.join(scope, dir), { recursive: true, force: true });
  fs.cpSync(engine(platform), path.join(scope, `claude-agent-sdk-${platform}`), { recursive: true });
  const out = path.join(work, `app-${platform}.asar`);
  await asar.createPackageWithOptions(staging, out, { unpack: UNPACK });
  fs.rmSync(staging, { recursive: true, force: true });
  return out;
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** A macOS .icns with the 512px PNG rendition. */
function makeIcns(png512) {
  const entry = Buffer.alloc(8);
  entry.write('ic09', 0, 'ascii');
  entry.writeUInt32BE(png512.length + 8, 4);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(png512.length + 16, 4);
  return Buffer.concat([head, entry, png512]);
}

function patchPlist(xml) {
  const set = (key, value) => {
    const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    xml = re.test(xml) ? xml.replace(re, (_m, a, b) => `${a}${value}${b}`) : xml.replace(/<dict>/, `<dict>\n\t<key>${key}</key>\n\t<string>${value}</string>`);
  };
  set('CFBundleName', PRODUCT);
  set('CFBundleDisplayName', PRODUCT);
  set('CFBundleIdentifier', pkg.build.appId);
  set('CFBundleShortVersionString', pkg.version);
  set('CFBundleVersion', pkg.version);
  set('NSScreenCaptureUsageDescription', 'Frog Bot takes screenshots only when you turn on Learn from my screen.');
  return xml;
}

const readEntry = (zip, entry) =>
  new Promise((resolve, reject) =>
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const parts = [];
      stream.on('data', (d) => parts.push(d));
      stream.on('end', () => resolve(Buffer.concat(parts)));
      stream.on('error', reject);
    }),
  );

const isExecutable = (rel) => /claude-agent-sdk-[^/]+\/claude$/.test(rel) || /\.(sh|node)$/.test(rel) || /\/bin\/[^/]+$/.test(rel);

/** FrogBot-Mac-<arch>.zip: Electron's macOS app, branded, with our app inside. */
async function buildMac(arch, baseAsar, work) {
  console.log(`\n▶ macOS ${arch}`);
  const appAsar = await repack(baseAsar, `darwin-${arch}`, work);
  const electronZip = await downloadArtifact({ version: ELECTRON, platform: 'darwin', arch, artifactName: 'electron' });
  const outFile = path.join(RELEASE, `FrogBot-Mac-${arch}.zip`);
  const out = new yazl.ZipFile();
  const done = new Promise((resolve, reject) => out.outputStream.pipe(fs.createWriteStream(outFile)).on('close', resolve).on('error', reject));
  const appRoot = `${PRODUCT}.app/`;
  const zip = await new Promise((resolve, reject) => yauzl.open(electronZip, { lazyEntries: true, autoClose: false }, (e, z) => (e ? reject(e) : resolve(z))));
  await new Promise((resolve, reject) => {
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.on('entry', async (entry) => {
      try {
        if (!entry.fileName.startsWith('Electron.app/')) return zip.readEntry();
        const name = appRoot + entry.fileName.slice('Electron.app/'.length);
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const mtime = entry.getLastModDate();
        if (name.endsWith('/')) out.addEmptyDirectory(name, { mode: mode || 0o40755, mtime });
        else if (!name.endsWith('Contents/Resources/default_app.asar')) {
          let data = await readEntry(zip, entry);
          if (name === `${appRoot}Contents/Info.plist`) data = Buffer.from(patchPlist(data.toString('utf8')));
          if (name === `${appRoot}Contents/Resources/electron.icns`) data = makeIcns(fs.readFileSync(path.join(root, 'build', 'icon.png')));
          out.addBuffer(data, name, { mode: mode || 0o100644, mtime, compress: (mode & 0o170000) !== 0o120000 });
        }
        zip.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zip.readEntry();
  });
  zip.close();
  const resources = `${appRoot}Contents/Resources/`;
  out.addBuffer(fs.readFileSync(appAsar), `${resources}app.asar`, { mode: 0o100644 });
  for (const rel of walk(`${appAsar}.unpacked`)) {
    out.addBuffer(fs.readFileSync(path.join(`${appAsar}.unpacked`, rel)), `${resources}app.asar.unpacked/${rel}`, { mode: isExecutable(rel) ? 0o100755 : 0o100644 });
  }
  for (const icon of ['icon.png', 'tray.png']) out.addBuffer(fs.readFileSync(path.join(root, 'build', icon)), `${resources}${icon}`, { mode: 0o100644 });
  out.end();
  await done;
  console.log(`✓ ${path.relative(root, outFile)} (${mb(outFile)})`);
}

/** FrogBot-Linux-x64.tar.gz from electron-builder's Linux folder plus the Linux engine. */
async function buildLinux(work) {
  console.log('\n▶ Linux x64');
  const dir = path.join(RELEASE, 'linux-unpacked');
  const resources = path.join(dir, 'resources');
  const appAsar = await repack(path.join(resources, 'app.asar'), 'linux-x64', work);
  fs.rmSync(path.join(resources, 'app.asar.unpacked'), { recursive: true, force: true });
  fs.copyFileSync(appAsar, path.join(resources, 'app.asar'));
  fs.cpSync(`${appAsar}.unpacked`, path.join(resources, 'app.asar.unpacked'), { recursive: true });
  for (const icon of ['icon.png', 'tray.png']) fs.copyFileSync(path.join(root, 'build', icon), path.join(resources, icon));
  const outFile = path.join(RELEASE, 'FrogBot-Linux-x64.tar.gz');
  fs.rmSync(outFile, { force: true });
  // GNU tar (comes with Git for Windows). Windows has no "executable" flag, so
  // add the programs separately with mode 755 and everything else as 644.
  const programs = ['frog-bot', 'chrome_crashpad_handler', 'chrome-sandbox', 'resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude']
    .map((p) => `linux-unpacked/${p}`)
    .filter((p) => fs.existsSync(path.join(RELEASE, p)));
  const tarFile = outFile.replace(/\.gz$/, '');
  const common = ['--force-local', '-C', fwd(RELEASE), '--owner=0', '--group=0', '--transform', 's,^linux-unpacked,FrogBot-Linux-x64,'];
  fs.rmSync(tarFile, { force: true });
  execFileSync('tar', [...common, '--mode=u=rwX,go=rX', '-cf', fwd(tarFile), ...programs.flatMap((p) => ['--exclude', p]), 'linux-unpacked']);
  execFileSync('tar', [...common, '--mode=0755', '-rf', fwd(tarFile), ...programs]);
  execFileSync('gzip', ['-6', '-f', fwd(tarFile)]);
  console.log(`✓ ${path.relative(root, outFile)} (${mb(outFile)})`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'frog-package-'));
try {
  run('node scripts/build.mjs');
  fs.mkdirSync(RELEASE, { recursive: true });
  if (wanted.has('win')) run('npx electron-builder --win nsis --x64 --publish never');
  if (wanted.has('linux') || wanted.has('mac')) {
    run('npx electron-builder --linux dir --x64 --publish never');
    const baseAsar = path.join(work, 'base.asar');
    // Keep an untouched copy of the app archive (with its unpacked files) as the base for every platform.
    fs.copyFileSync(path.join(RELEASE, 'linux-unpacked', 'resources', 'app.asar'), baseAsar);
    fs.cpSync(path.join(RELEASE, 'linux-unpacked', 'resources', 'app.asar.unpacked'), `${baseAsar}.unpacked`, { recursive: true });
    if (wanted.has('mac')) for (const arch of ['arm64', 'x64']) await buildMac(arch, baseAsar, work);
    if (wanted.has('linux')) await buildLinux(work);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log('\nDone. Installers are in release/');
