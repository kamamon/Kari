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
  const put = (x, z, yaw, pitch = 0.3) => page.evaluate(([x, z, yaw, pitch]) => {
    const s = window.__vh.sim;
    s.player.pos = { x, y: s.world.groundHeight(x, z), z };
    s.player.prevPos = { ...s.player.pos };
    s.player.yaw = yaw; s.player.prevYaw = yaw; window.__vh.view.cam.snap(yaw);
    window.__vh.view.cam.pitch = pitch;
  }, [x, z, yaw, pitch]);
  const views = {
    workshop_front: [-14, 2.5, 0], workshop_left: [-7.5, 5, -1.0], workshop_right: [-20.5, 5, 1.0], workshop_back: [-14, 16, Math.PI],
    shop_front: [14, 1.5, 0], shop_left: [20.5, 4, -1.0], shop_right: [7.5, 4, 1.0], shop_back: [14, 16, Math.PI],
    board_front: [0, 8.5, 0], board_side: [4.5, 12, -1.2], board_back: [0, 16.2, Math.PI],
    chest_front: [-12.5, -5, -Math.PI / 2], chest_side: [-16.5, -10.5, -0.35], chest_back: [-22.8, -5, Math.PI / 2],
    wide: [0, -13, 0], wide_back: [0, 6, Math.PI], east: [-20, -12, 0.9],
    // v0.35.0: 5 つの段（水音の庭 -10・炉の段 -3・広場 0・暮らしの段 +8・灯見の台 +22）
    v_plaza_north: [4, -14, -0.25], v_plaza_south: [6, 12, Math.PI + 0.3], v_balcony: [21, -19.5, Math.PI + 0.6], v_garden_north: [-8, -40, 0.2],
    v_garden_mill: [-30, -33, -1.9], v_garden_lift: [-31, -30, -0.6], v_forge_yard: [-26, -4, Math.PI + 0.5], v_stairs_c: [-2, 13, -1.0],
    v_living_south: [-18, 32, Math.PI + 0.4], v_living_inn: [-24, 24, -0.9], v_living_east: [4, 30, 1.6], v_lookout_south: [8, 47, Math.PI - 0.3],
    v_lookout_hall: [-14, 46, -0.5], v_bridge: [-7, 51.5, Math.PI / 2], v_watch: [6, 50, 0.6], v_gate_east: [16, -9, Math.PI / 2], v_valley_gate: [12, -36, Math.PI - 0.3],
    v_stream: [-38, 12, Math.PI + 0.3], v_e_stairs: [12, 26, 1.0],
    v_canal: [-41, -3, 0.15], v_fall_garden: [-37.5, -25, -0.35], v_wheel: [-38, -36.5, -0.55, 0.15],
    v_down_lookout: [4, 44, Math.PI - 0.2, 0.95], v_down_living: [-10, 23, Math.PI + 0.2, 0.8], v_up_garden: [-14, -34, 0.3, -0.2],
  };
  for (const [name, [x, z, yaw, pitch]] of Object.entries(views)) {
    if (process.argv[2] && !name.startsWith(process.argv[2])) continue;
    await put(x, z, yaw, pitch);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}hub_${name}.png` });
  }
  console.log('art', await page.evaluate(() => window.__vh.envArt?.()));
} finally {
  await browser.close();
  server.kill();
}
