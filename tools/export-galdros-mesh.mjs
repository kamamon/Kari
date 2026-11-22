// ガルドロスの仮モデルの形（頂点と面）を、素材ビューアから取り出して JSON に保存する。
// Blender で陰を焼く（tools/blender/bake_ao.py）ための入力。
// 使い方: npm run build && node tools/export-galdros-mesh.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4185;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--base', '/Kari/'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext()).newPage();
await page.goto(`http://localhost:${PORT}/Kari/viewer.html?subject=galdros`);
await page.waitForFunction(() => window.__viewer?.monsters?.galdros, null, { timeout: 15000 });
const meshes = await page.evaluate(() => {
  const out = {};
  for (const o of window.__viewer.monsters.galdros.rig.root.children) {
    if (!o.isSkinnedMesh) continue;
    out[o.name] = { position: Array.from(o.geometry.attributes.position.array), index: Array.from(o.geometry.index.array) };
  }
  return out;
});
const path = `${OUT}galdros_mesh.json`;
writeFileSync(path, JSON.stringify({ note: '単位 m、Y 上、+Z 前。静止姿勢。', meshes }));
for (const [name, m] of Object.entries(meshes)) console.log(name, m.position.length / 3, '頂点', m.index.length / 3, '面');
console.log('保存:', path);
await browser.close();
server.kill();
