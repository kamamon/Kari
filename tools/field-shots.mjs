// フィールド（エリアに分かれた狩場）の画面をまとめて撮る（見た目の確認用）。
// 使い方: npm run build && node tools/field-shots.mjs   （画像は tools/out/field_*.png）
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4183;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--base', '/Kari/'], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), resolve()));
});
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 620 } })).newPage();
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('page error:', String(e).slice(0, 400)));
await page.goto(`http://localhost:${PORT}/Kari/`);
await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
await page.click('#boot-start');
await page.waitForFunction(() => window.__vh, null, { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}field_base.png` });
await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
await page.waitForTimeout(900);
const shot = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}field_${name}.png` });
};
/** プレイヤーを置く（出口の近くへ置けば、次の tick でエリアが変わる） */
const put = (x, z, yaw) => page.evaluate(([x, z, yaw]) => {
  const s = window.__vh.sim;
  s.player.pos = { x, y: 0, z };
  s.player.prevPos = { ...s.player.pos };
  if (yaw !== null) { s.player.yaw = yaw; s.player.prevYaw = yaw; window.__vh.view.cam.snap(yaw); }
}, [x, z, yaw]);
const info = () => page.evaluate(() => {
  const s = window.__vh.sim, m = s.monsters[0];
  return { area: s.areaId, p: [s.player.pos.x.toFixed(1), s.player.pos.z.toFixed(1)], m: s.monsterArea(m)?.id, roam: m.roam?.state, where: document.querySelector('.hud-quest .where')?.textContent, exit: document.querySelector('.hud-exit')?.textContent };
});
await shot('camp', 1800);
console.log('camp', await info());
const f = await page.evaluate(() => window.__vh.sim.field);
const exit = (from, to) => f.areas.find((a) => a.id === from).exits.find((e) => e.to === to);
// 野営地の出口の手前（案内が出る）
let e = exit('camp', 'a1');
await put(e.x - 6, e.z, Math.PI / 2);
await shot('camp_exit', 400);
console.log('camp exit', await info());
await put(e.x, e.z, null);
await shot('a1_banner', 250);
await shot('a1', 2000);
console.log('a1', await info());
e = exit('a1', 'a3');
await put(e.x, e.z, null);
await shot('a3', 2200);
console.log('a3', await info());
// エリア 3 の東の出口の手前から、出口を見る
e = exit('a3', 'a7');
await put(e.x, e.z - 9, 0);
await shot('a3_exit', 600);
// 巣（エリア 10）へ: 大型を弱らせて、眠るまで進める（検査用に、simulation を先へ進める）
await page.evaluate(() => {
  const app = window.__vh, s = app.sim, m = s.monsters[0];
  m.hp = Math.round(m.def.hp * 0.2);
  const idle = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };
  for (let i = 0; i < 60 * 60 * 5 && !m.asleep; i++) s.step(idle);
  s.drainEvents();
});
console.log('after limp', await info());
e = exit('a6', 'a10');
await put(e.x, e.z, null);
await shot('nest', 2200);
console.log('nest', await info());
// 眠っている標的の近くへ
const mp = await page.evaluate(() => { const m = window.__vh.sim.monsters[0]; return { x: m.pos.x, z: m.pos.z, yaw: m.yaw }; });
await put(mp.x - 7, mp.z - 6, Math.atan2(7, 6));
await shot('nest_sleep', 1200);
console.log('sleep', await info());
await browser.close();
server.kill();
