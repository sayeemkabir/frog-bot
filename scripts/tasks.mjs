// Shared build steps for build.mjs and dev.mjs.
import { build as esbuild, context } from 'esbuild';
import { build as viteBuild } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ESM bundles still get a `require` for the few CommonJS-only lookups.
const esmBanner = { js: "import { createRequire as __frogRequire } from 'node:module'; const require = __frogRequire(import.meta.url);" };

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  packages: 'external',
  logLevel: 'warning',
  absWorkingDir: root,
};

const mainOptions = {
  ...common,
  entryPoints: ['src/main/main.ts'],
  outfile: 'dist/main/main.mjs',
  format: 'esm',
  external: ['electron'],
  banner: esmBanner,
};

const preloadOptions = {
  ...common,
  entryPoints: ['src/main/preload.ts'],
  outfile: 'dist/main/preload.cjs',
  format: 'cjs',
  external: ['electron'],
};

const serverOptions = {
  ...common,
  entryPoints: ['src/server/server.ts'],
  outfile: 'dist/server/server.mjs',
  format: 'esm',
  banner: esmBanner,
};

export async function buildMain() {
  await Promise.all([esbuild(mainOptions), esbuild(preloadOptions)]);
}

export async function watchMain(onRebuild) {
  const plugin = { name: 'notify', setup: (b) => b.onEnd((r) => r.errors.length === 0 && onRebuild?.()) };
  const contexts = await Promise.all([
    context({ ...mainOptions, plugins: [plugin] }),
    context({ ...preloadOptions, plugins: [plugin] }),
  ]);
  await Promise.all(contexts.map((c) => c.watch()));
  return contexts;
}

export async function buildServer() {
  await esbuild(serverOptions);
}

export async function buildRenderer() {
  await viteBuild({ configFile: path.join(root, 'vite.config.mjs'), logLevel: 'warn' });
}
