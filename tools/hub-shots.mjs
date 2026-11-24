// 里（拠点）の建物を、いくつかの向きから撮る（見た目の確認用）。
// 使い方: npm run build && node tools/hub-shots.mjs   （画像は tools/out/hub_*.png）
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4184;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--base', '/Kari/'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 620 } })).newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
  page.on('pageerror', (e) => console.log('page error:', String(e).slice(0, 400)));
  await page.goto(`http://localhost:${PORT}/Kari/`);
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await page.waitForFunction(() => window.__vh, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  /** プレイヤーを置いて、yaw の向きを見る */
  const put = (x, z, yaw) => page.evaluate(([x, z, yaw]) => {
    const s = window.__vh.sim;
    s.player.pos = { x, y: 0, z };
    s.player.prevPos = { ...s.player.pos };
    s.player.yaw = yaw; s.player.prevYaw = yaw; window.__vh.view.cam.snap(yaw);
  }, [x, z, yaw]);
  const views = {
    workshop_front: [-14, 2.5, 0], workshop_left: [-7.5, 5, -1.0], workshop_right: [-20.5, 5, 1.0], workshop_back: [-14, 16, Math.PI],
    shop_front: [14, 1.5, 0], shop_left: [20.5, 4, -1.0], shop_right: [7.5, 4, 1.0], shop_back: [14, 16, Math.PI],
    board_front: [0, 8.5, 0], board_side: [4.5, 12, -1.2], board_back: [0, 16.2, Math.PI],
    chest_front: [-12.5, -5, -Math.PI / 2], chest_side: [-16.5, -10.5, -0.35], chest_back: [-22.8, -5, Math.PI / 2],
    wide: [0, -13, 0], wide_back: [0, 6, Math.PI], east: [-20, -12, 0.9],
  };
  for (const [name, [x, z, yaw]] of Object.entries(views)) {
    if (process.argv[2] && !name.startsWith(process.argv[2])) continue;
    await put(x, z, yaw);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}hub_${name}.png` });
  }
  console.log('art', await page.evaluate(() => window.__vh.envArt?.()));
} finally {
  await browser.close();
  server.kill();
}
