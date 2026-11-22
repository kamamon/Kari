import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitShort(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit';
  }
}

/**
 * 素材台帳の正本は docs/asset-manifest.json（両 AI への引き継ぎ資料）。
 * 素材ビューアが実行時に読めるよう、同じファイルを data/asset-manifest.json として配信する（複製を持たない）。
 */
function assetManifest(): Plugin {
  const src = fileURLToPath(new URL('./docs/asset-manifest.json', import.meta.url));
  return {
    name: 'vh-asset-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0]?.endsWith('/data/asset-manifest.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(src));
        } else next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'data/asset-manifest.json', source: readFileSync(src) });
    },
  };
}

// base は相対パス './' を既定にする。GitHub Pages の /リポジトリ名/ でも、名前や大文字小文字が変わっても素材を解決できる。
// 絶対パスに固定したい場合だけ VITE_BASE=/リポジトリ名/ を渡す（docs/decisions.md D-002）。
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [assetManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(`${pkg.version}+${gitShort()}`),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { main: 'index.html', viewer: 'viewer.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
