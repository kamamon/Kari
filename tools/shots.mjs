// 素材ビューアの静止画をまとめて撮る（見た目の確認用）。
// 使い方: npm run build && node tools/shots.mjs 名前=クエリ ...   例: node tools/shots.mjs idle='?subject=galdros&yaw=0.9&shapes=0'
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4181;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--base', '/Kari/'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('page error:', String(e).slice(0, 400)));
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const name = arg.slice(0, i), q = arg.slice(i + 1);
  await page.goto(`http://localhost:${PORT}/Kari/viewer.html${q}`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
  await page.waitForTimeout(Number(process.env.WAIT ?? 500));
  await page.screenshot({ path: `${OUT}${name}.png` });
}
await browser.close();
server.kill();
