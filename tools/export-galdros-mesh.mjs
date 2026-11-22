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
// 皮の絵を貼る区画: いまの形で並べ直し、その並びを src/render/galdrosAtlas.ts へ書く（焼く側も同じ並びを使う）
const atlas = await page.evaluate(() => {
  const rig = window.__viewer.monsters.galdros.rig;
  const rects = window.__viewer.packCharts(rig.atlasCharts);
  return { stored: rig.atlasStored && rig.atlasCharts.every((c) => String(c.rect) === String(rects[c.kind])), rects, charts: rig.atlasCharts.map((c) => ({ kind: c.kind, cols: c.cols, v: c.v, t: c.t, width: c.width, height: c.height, density: c.density, meta: c.meta, rect: rects[c.kind] })) };
});
const SIZE = 2048;
const lines = Object.entries(atlas.rects).map(([k, r]) => `    ${k}: [${r.join(', ')}],`).join('\n');
writeFileSync(new URL('../src/render/galdrosAtlas.ts', import.meta.url).pathname, `// tools/export-galdros-mesh.mjs が書き出す（手で直さない）。
// ガルドロスの皮の絵（public/assets/textures/galdros/galdros_hide_v1.webp）の中の、区画の位置 (px)。
export const GALDROS_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: ${SIZE},
  rects: {
${lines}
  },
};
`);
console.log('区画', atlas.charts.length, '個。並びは', atlas.stored ? '前回と同じ' : '変わった（もう一度 build してから、絵と陰を焼き直す）');
const path = `${OUT}galdros_mesh.json`;
writeFileSync(path, JSON.stringify({ note: '単位 m、Y 上、+Z 前。静止姿勢。', meshes, atlas: { size: SIZE, charts: atlas.charts } }));
for (const [name, m] of Object.entries(meshes)) console.log(name, m.position.length / 3, '頂点', m.index.length / 3, '面');
console.log('保存:', path);
await browser.close();
server.kill();
