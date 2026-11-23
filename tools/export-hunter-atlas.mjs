// ハンターの体の絵を貼る区画を、素材ビューアから取り出す。
// いまの形で区画を並べ直し、その並びを src/render/hunterAtlas.ts へ書き、焼く側（tools/art/hunter_bake.py）の入力も保存する。
// 使い方: npm run build && node tools/export-hunter-atlas.mjs（「並びが変わった」と出たら、もう一度この 2 つを実行）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4186;
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
await page.goto(`http://localhost:${PORT}/Kari/viewer.html?subject=hunter`);
await page.waitForFunction(() => window.__viewer?.hunter, null, { timeout: 15000 });
const atlas = await page.evaluate(() => {
  const rig = window.__viewer.hunter;
  const rects = window.__viewer.packCharts(rig.atlasCharts);
  return {
    stored: rig.atlasStored && rig.atlasCharts.every((c) => String(c.rect) === String(rects[c.kind])),
    rects,
    charts: rig.atlasCharts.map((c) => ({ kind: c.kind, cols: c.cols, v: c.v, t: c.t, width: c.width, height: c.height, density: c.density, meta: c.meta, rect: rects[c.kind] })),
    triangles: rig.bodyTriangles,
  };
});
const SIZE = 2048;
const lines = Object.entries(atlas.rects).map(([k, r]) => `    ${k}: [${r.join(', ')}],`).join('\n');
writeFileSync(new URL('../src/render/hunterAtlas.ts', import.meta.url).pathname, `// tools/export-hunter-atlas.mjs が書き出す（手で直さない）。
// ハンターの体の絵（public/assets/textures/hunter/hunter_body_v1.webp）の中の、区画の位置（${SIZE} 四方に並べた時の px）。
export const HUNTER_ATLAS: { size: number; rects: Record<string, readonly [number, number, number, number]> } = {
  size: ${SIZE},
  rects: {
${lines}
  },
};
`);
writeFileSync(`${OUT}hunter_atlas.json`, JSON.stringify({ size: SIZE, charts: atlas.charts }));
console.log('区画', atlas.charts.length, '個 / 面', atlas.triangles, '。並びは', atlas.stored ? '前回と同じ' : '変わった（もう一度 build してから、絵を焼き直す）');
await browser.close();
server.kill();
