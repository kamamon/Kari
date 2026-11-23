// 本番ビルドをヘッドレス Chrome で起動し、実際に操作して画面を保存する簡易検査。
// 使い方: npm run build && npm run smoke   （Chrome が必要。CI では実行しない）
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const BASE = process.env.SMOKE_BASE ?? '/Kari/';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--base', BASE], { stdio: 'pipe' });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview が起動しない')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local')) {
      clearTimeout(t);
      resolve();
    }
  });
  server.stderr.on('data', (d) => process.stderr.write(d));
});

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed = true;
};

async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (!localStorage.getItem('veilbound-hunters:prod:settings')) {
      localStorage.setItem('veilbound-hunters:prod:settings', JSON.stringify({ schemaVersion: 1, renderScale: 0.65, shadows: false }));
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`http://localhost:${PORT}${BASE}`);
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  return { ctx, page };
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__vh.sim;
    const p = s.player;
    const m = s.monsters[0];
    return { tick: s.tick, x: p.pos.x, z: p.pos.z, y: p.pos.y, hp: p.hp, st: p.stamina, mode: p.mode, drawn: p.drawn, action: p.action?.def.actionId ?? null, mhp: m?.hp, hits: s.hitCount, taken: s.damageTaken };
  });

/** 条件が成り立つまで待つ（ソフトウェア描画は遅いので、固定の待ち時間に頼らない）。 */
async function until(page, fn, timeout = 20000, arg = null) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 50 });
    return true;
  } catch {
    return false;
  }
}
const click = async (page, button = 'left') => {
  await page.mouse.down({ button });
  await page.waitForTimeout(80);
  await page.mouse.up({ button });
};
const idle = (page) => until(page, () => window.__vh.sim.player.mode === 'free');

// ---- PC（キーボード・マウス） ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.screenshot({ path: `${OUT}01_boot.png` });
  await page.click('#boot-start');
  check('起動すると拠点の画面が出て、一時停止している', await until(page, () => window.__vh && !document.getElementById('base').hidden && window.__vh.sim.tick === 0));
  await page.screenshot({ path: `${OUT}02_base.png` });
  await page.locator('.base-choice').last().click();
  check('訓練場を選ぶと simulation が進む', await until(page, () => window.__vh.sim.tick > 10));
  await page.screenshot({ path: `${OUT}02_start.png` });
  // 技を 1 つずつ確かめる間は、標的の攻撃を止めておく（防御・被弾の確認の所で再開する）
  await page.evaluate(() => (window.__vh.sim.monsters[0].aiEnabled = false));

  await page.keyboard.down('KeyW');
  check('W で前進する', await until(page, () => window.__vh.sim.player.pos.z > -16));
  await page.keyboard.down('ShiftLeft');
  check('Shift の疾走でスタミナが減る', await until(page, () => window.__vh.sim.player.stamina < 92));
  await page.screenshot({ path: `${OUT}03_sprint.png` });
  await page.keyboard.up('ShiftLeft');
  // 標的（z=6、胴の半径 1.3）の手前で止まるまで押し続ける
  await until(page, () => window.__vh.sim.player.pos.z > 4.2);
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const s3 = await state(page);
  check('標的の手前で止まる（胴を抜けない）', Math.abs(s3.z - (6 - 1.3 - 0.38)) < 0.05, `z ${s3.z.toFixed(2)} (期待 4.32)`);
  await page.screenshot({ path: `${OUT}04_at_target.png` });

  await idle(page);
  await page.evaluate(() => {
    const p = window.__vh.sim.player;
    p.pos.x = 0;
    p.pos.z = 2.0;
    p.yaw = 0;
    window.__vh.view.cam.snap(0.9);
  });
  await page.keyboard.press('F3');
  await page.mouse.move(640, 360);
  await click(page);
  await until(page, () => window.__vh.sim.player.action?.tick >= 22);
  await page.screenshot({ path: `${OUT}05_draw_slash.png` });
  await idle(page);
  const s4 = await state(page);
  check('抜刀斬りで抜刀状態になり、命中する', s4.drawn && s4.hits === 1, `hits ${s4.hits} 標的HP ${s4.mhp}`);

  await click(page);
  await until(page, () => window.__vh.sim.player.action?.tick >= 17);
  await page.screenshot({ path: `${OUT}06_overhead_raise.png` });
  await until(page, () => window.__vh.sim.player.action?.tick >= 27);
  await page.screenshot({ path: `${OUT}07_overhead_hit.png` });
  await idle(page);
  check('縦斬りが 1 回だけ命中する', (await state(page)).hits === 2);

  await click(page, 'right');
  await until(page, () => window.__vh.sim.player.action?.tick >= 22);
  await page.screenshot({ path: `${OUT}08_side_sweep.png` });
  await idle(page);
  check('横薙ぎが 1 回だけ命中する', (await state(page)).hits === 3);

  // 溜め: 押し続けて段階 2 で離す
  await page.mouse.down();
  await until(page, () => window.__vh.sim.player.action?.chargeLevel >= 2);
  await page.screenshot({ path: `${OUT}09_charge.png` });
  await page.mouse.up();
  await idle(page);
  const s5 = await state(page);
  const last = await page.evaluate(() => window.__vh.sim.recentHits.at(-1));
  // 段階 2 は 92、離すのが遅れて段階 3 に入ると 117（通常の縦斬りは 56）
  check('溜め斬り（段階 2 以上）が命中し、威力が上がる', s5.hits === 4 && (last.damage === 92 || last.damage === 117), `damage ${last?.damage} part ${last?.partId}`);

  // 防御: 標的の攻撃を再開して正面で受ける
  await page.evaluate(() => {
    const m = window.__vh.sim.monsters[0];
    m.aiEnabled = true;
    m.cooldown = 0;
    const p = window.__vh.sim.player;
    p.pos.x = -0.6;
    p.pos.z = 3.6;
    p.yaw = 0;
  });
  await page.keyboard.down('KeyC');
  await until(page, () => window.__vh.sim.monsters[0].action?.tick >= 40);
  await page.screenshot({ path: `${OUT}10_guard_telegraph.png` });
  const guarded = await until(page, () => window.__vh.sim.damageTaken > 0);
  await page.screenshot({ path: `${OUT}11_guard_hit.png` });
  await page.keyboard.up('KeyC');
  const s6 = await state(page);
  check('正面の防御で受け止める（削り 6）', guarded && s6.taken === 6 && s6.hp === 94, `被ダメ ${s6.taken} HP ${s6.hp}`);

  // 被弾 → 転倒
  await idle(page);
  await page.evaluate(() => (window.__vh.sim.monsters[0].cooldown = 0));
  await until(page, () => window.__vh.sim.player.mode === 'hurt' && window.__vh.sim.player.hurt.tick > 24);
  await page.screenshot({ path: `${OUT}12_knockdown.png` });
  check('無防備なら被弾して転倒する', (await state(page)).hp === 70);
  await idle(page);

  // 回避
  await page.keyboard.down('KeyS');
  await page.keyboard.press('Space');
  await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.common.roll' && window.__vh.sim.player.action.tick >= 12);
  await page.screenshot({ path: `${OUT}13_roll.png` });
  await idle(page);
  await page.keyboard.up('KeyS');
  check('回避でスタミナを 25 使う', (await state(page)).st <= 100);
  await page.keyboard.press('KeyR');
  await idle(page);
  check('R で納刀する', !(await state(page)).drawn);
  await page.screenshot({ path: `${OUT}14_sheathed.png` });

  // 30/60fps 一致チェック（メニュー → 検証）
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.click('.menu-head .tab:nth-child(4)');
  await page.click('text=確認する');
  const result = await page.textContent('.menu-body pre');
  // このテストは途中で位置や標的の状態を直接書き換えているので、「いまの画面との一致」は対象外。60 と 30 の一致だけを見る。
  check('30/60fps の一致チェック', /結果: 一致/.test(result), result.split('\n')[3]);
  // 報告用の情報: 装備（選んでいる武器）、設定、描画の間隔の計測値が出る
  const report = await page.evaluate(() => [...document.querySelectorAll('.menu-body pre')].map((e) => e.textContent).join('\n'));
  const frameLine = report.split('\n').find((l) => l.startsWith('描画の間隔')) ?? '';
  check('検証メニューの報告に、装備・設定・描画の間隔（平均 / p95 / 100ms 超）が出る',
    /装備：weapon\.heavy_blade\.001/.test(report) && /設定：描画の上限 \d+fps \/ 内部解像度 [\d.]+ \/ 影/.test(report) && /平均 [\d.]+ms \/ p95 [\d.]+ms \/ 最大 \d+ms \/ 100ms 超 \d+ 回/.test(frameLine),
    `${frameLine}（ヘッドレスのソフトウェア描画の値。実機の値ではない）`);
  await page.screenshot({ path: `${OUT}15_menu_verify.png` });
  await page.click('.menu-head .tab:nth-child(2)');
  await page.screenshot({ path: `${OUT}16_menu_settings.png` });
  await page.click('.menu-head .tab:nth-child(3)');
  await page.screenshot({ path: `${OUT}17_menu_controls.png` });
  const tickA = (await state(page)).tick;
  await page.waitForTimeout(400);
  check('メニュー中は一時停止', (await state(page)).tick === tickA);
  await page.keyboard.press('Escape');

  // やり直し → 手を加えない操作だけで「いまの画面の状態とも一致」を確かめる
  await page.evaluate(() => window.__vh.restartTraining());
  await page.keyboard.down('KeyW');
  await until(page, () => window.__vh.sim.player.pos.z > 4.2, 40000);
  await page.keyboard.up('KeyW');
  await click(page);
  await idle(page);
  await click(page, 'right');
  await idle(page);
  await page.keyboard.press('Space');
  await idle(page);
  await page.keyboard.press('Escape');
  await page.click('.menu-head .tab:nth-child(4)');
  await page.click('text=確認する');
  const result2 = await page.textContent('.menu-body pre');
  check('記録した入力の再生が、いまの画面の状態と一致', /結果: 一致/.test(result2) && /いまの画面の状態とも一致/.test(result2), result2.split('\n').slice(1, 2).join(''));
  await page.keyboard.press('Escape');

  // 段差: 東の段々（0.3m ずつ）を登る。高い岩棚（1.4m）は登れない。
  await page.evaluate(() => {
    window.__vh.sim.monsters[0].aiEnabled = false;
    const p = window.__vh.sim.player;
    p.pos.x = 14;
    p.pos.z = 20;
    window.__vh.view.cam.snap(0);
  });
  await page.keyboard.down('KeyA');
  check('小さな段差を登れる（0.9m の段の上へ）', await until(page, () => window.__vh.sim.player.pos.y > 0.85));
  await page.keyboard.up('KeyA');
  await page.screenshot({ path: `${OUT}18_steps.png` });
  await page.evaluate(() => {
    const p = window.__vh.sim.player;
    p.pos.x = -24;
    p.pos.y = 0;
    p.pos.z = -23;
    window.__vh.view.cam.snap(0);
  });
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD');
  await until(page, () => window.__vh.sim.player.pos.x < -26.9, 15000);
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  const s9 = await state(page);
  // 岩棚の縁は x = -27。1 tick の移動量（約 0.07m）より手前で止まり、上には乗らない。
  check('高い段差は壁として止まる', s9.y === 0 && s9.x >= -27 && s9.x < -26.9, `x ${s9.x.toFixed(2)} y ${s9.y}`);
  await page.screenshot({ path: `${OUT}19_ledge.png` });
  const stats = await page.evaluate(() => ({ ...window.__vh.view.stats(), fps: window.__vh.fps }));
  console.log(`     描画統計: draw calls ${stats.calls} / triangles ${stats.triangles}（ソフトウェア描画 ${stats.fps.toFixed(0)}fps。実機の値ではない）`);
  check('描画量が目標内（100 draw calls / 20万 tri）', stats.calls <= 100 && stats.triangles <= 200000, `calls ${stats.calls} tris ${stats.triangles}`);

  // ---- 依頼: ガルドロス討伐 ----
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.click('.menu-head .tab:nth-child(1)');
  await page.click('.menu-body button');
  check('メニューから拠点へ戻れる', await until(page, () => !document.getElementById('base').hidden));
  await page.locator('.base-choice').first().click();
  check('依頼を選ぶと狩猟が始まる（ガルドロスは未発見）', await until(page, () => window.__vh.sim.hunt?.phase === 'active' && window.__vh.sim.tick > 5 && !window.__vh.sim.monsters[0].aware));
  await page.screenshot({ path: `${OUT}51_hunt_start.png` });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  check('ハンターの体の絵: 区画が焼いた絵と同じ並びで、読み込める', await until(page, () => window.__vh.view.hunter.atlasStored === true && window.__vh.view.hunter.atlasCharts.length === 10 && window.__vh.view.hunter.artLoaded === true && !window.__vh.view.hunter.artFailed, 15000));
  check('ガルドロスの陰（Blender で焼いた値）が、いまの形と合っている', await page.evaluate(() => window.__vh.view.monsterRig.aoApplied === true));
  check('断岳剣: 設定図から作った形で、絵を読み込める', await until(page, () => window.__vh.view.hunter.weaponArt.length > 0 && window.__vh.view.hunter.weaponArt.every((a) => a.loaded && !a.failed) && window.__vh.view.hunter.weaponTriangles > 100, 15000));
  check('ガルドロスの皮の絵の区画が、焼いた絵と同じ並び', await page.evaluate(() => window.__vh.view.monsterRig.atlasStored === true && window.__vh.view.monsterRig.atlasCharts.length === 17));
  check('設定図から焼いた絵（皮・岩）を読み込める', await until(page, () => window.__vh.view.monsterRig.artLoaded === true && !window.__vh.view.monsterRig.artFailed, 15000));
  check('近づくと気付かれて咆哮する', await until(page, () => window.__vh.sim.monsters[0].aware, 60000));
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.press('F3');
  await page.screenshot({ path: `${OUT}52_hunt_roar.png` });
  await page.evaluate(() => (window.__vh.sim.player.invulnTicks = 1e9));
  await until(page, () => {
    const a = window.__vh.sim.monsters[0].action;
    return a && a.def.actionId !== 'monster.galdros.roar' && a.tick > 34;
  }, 60000);
  await page.screenshot({ path: `${OUT}53_hunt_first_attack.png` });
  // 鉱殻崩落だけを選ばせて、落下地点の予告を確かめる
  await page.evaluate(() => {
    const m = window.__vh.sim.monsters[0];
    for (const c of m.def.ai.choices) m.moveCooldowns[c.actionId] = c.actionId.endsWith('rockfall') ? 0 : 1e9;
  });
  check('鉱殻崩落で落下地点の予告が 5 か所に出る', await until(page, () => window.__vh.sim.hazards.length === 5, 60000));
  const launch = await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    return { all: s.hazards.every((h) => !!h.from), clip: m.action?.def.clip ?? '', behind: s.hazards[0]?.from ? Math.hypot(s.hazards[0].from.x - m.pos.x, s.hazards[0].from.z - m.pos.z) : 0 };
  });
  check('鉱殻崩落: 岩は空からではなく、尾で叩いた地面（体の後ろ約 3m）から打ち上がる', launch.all && launch.clip === 'galdros_rockfall_01' && Math.abs(launch.behind - 3) < 0.3, `尾の先まで ${launch.behind.toFixed(2)}m`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}54_hunt_rockfall.png` });
  // 転倒の見た目
  await page.evaluate(() => {
    const m = window.__vh.sim.monsters[0];
    m.action = null;
    m.staggerTicks = 600;
    m.staggerTotal = 600;
    m.staggerKind = 'topple';
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}55_hunt_topple.png` });
  const hstats = await page.evaluate(() => ({ ...window.__vh.view.stats() }));
  check('ガルドロス戦の描画量が目標内（100 draw calls / 20万 tri）', hstats.calls <= 100 && hstats.triangles <= 200000, `calls ${hstats.calls} tris ${hstats.triangles}`);
  // ---- 道具（M2 後半）: 回復液を E キーで飲む ----
  check('依頼では道具ボタンが出て、支給品を持っている', await page.evaluate(() => !document.querySelector('.tbtn-item').hidden && window.__vh.sim.player.items.length === 4 && /回復液 ×5/.test(document.querySelector('.hud-item').textContent)));
  await page.evaluate(() => {
    const v = window.__vh;
    v.sim.monsters[0].aiEnabled = false;
    v.sim.monsters[0].action = null;
    const p = v.sim.player;
    p.hp = 50;
    p.mode = 'free';
    p.action = null;
    p.hurt = null;
    p.guard = null;
    p.drawn = false;
    p.itemIndex = 0;
  });
  await page.keyboard.press('KeyE');
  check('回復液を飲むと体力が 40 回復し、1 個減る', await until(page, () => window.__vh.sim.player.hp === 90 && window.__vh.sim.player.items[0].count === 4, 8000));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  // 頭の正面へ立ち、残り体力わずかの状態から討伐する
  await page.evaluate(() => {
    const v = window.__vh;
    const m = v.sim.monsters[0];
    m.hp = 30;
    const p = v.sim.player;
    const f = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    p.pos.x = m.pos.x + f.x * 4.2;
    p.pos.z = m.pos.z + f.z * 4.2;
    p.yaw = m.yaw + Math.PI;
    p.mode = 'free';
    p.action = null;
    p.hurt = null;
    p.guard = null;
    v.view.cam.snap(p.yaw);
  });
  await click(page);
  check('討伐すると狩猟が成功で終わる', await until(page, () => window.__vh.sim.hunt.phase === 'success', 20000));
  // ---- 剥ぎ取りと帰還 ----
  check('討伐後は結果をすぐ出さず、剥ぎ取りの案内（残り 3 回）が出る', await until(page, () => !document.querySelector('.hud-wrap').hidden && /剥ぎ取り 残り 3 回/.test(document.querySelector('.hud-wrap').textContent) && document.getElementById('result').hidden, 8000));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  await page.evaluate(() => {
    const v = window.__vh;
    const m = v.sim.monsters[0];
    const p = v.sim.player;
    p.pos.x = m.pos.x + 2.4;
    p.pos.z = m.pos.z;
  });
  await page.waitForTimeout(150);
  check('亡骸の近くでは、攻撃ボタンが「剥ぎ取り」に変わる', await until(page, () => document.querySelector('.tbtn-main').textContent === '剥ぎ取り', 3000));
  await click(page);
  check('剥ぎ取ると素材が 1 個手に入り、残りが 2 回になる', await until(page, () => window.__vh.sim.hunt.carves.body === 2 && window.__vh.sim.hunt.loot.length === 1, 8000));
  await page.screenshot({ path: `${OUT}55_hunt_carve.png` });
  await page.click('#hud-return');
  check('「帰還する」で結果が閉じ、少し間を置いて結果の画面が出る', await until(page, () => window.__vh.sim.hunt.closed && !document.getElementById('result').hidden, 20000));
  const resultText = await page.textContent('#result');
  check('結果に「依頼達成」と討伐成功が出る', /依頼達成/.test(resultText) && /討伐に成功/.test(resultText));
  check('結果に報酬（600 通貨、剥ぎ取り 1 + 依頼の報酬 1 = 素材 2 個）が出る', /報酬\s*600 通貨\s*素材 2 個/.test(resultText) && /剥ぎ取り/.test(resultText) && /依頼の報酬/.test(resultText), resultText.slice(0, 200));
  // 持ち物へ入るのは、保存（IndexedDB への書き込み）が完了してから
  check('報酬は、保存が完了してから持ち物へ一度だけ入る', await until(page, () => window.__vh.inventory.money === 600 && [...window.__vh.inventory.items.values()].reduce((a, b) => a + b, 0) === 2, 8000));
  check('結果の画面に「保存しました」が出る', await until(page, () => document.querySelector('.result-save')?.dataset.state === 'saved' && /保存しました/.test(document.querySelector('.result-save').textContent), 8000),
    await page.evaluate(() => `保存の場所: ${window.__vh.save.mode} / revision ${window.__vh.save.doc.revision}`));
  await page.screenshot({ path: `${OUT}56_hunt_result.png` });
  const tickR = (await state(page)).tick;
  await page.waitForTimeout(300);
  check('結果の表示中は止まっている', (await state(page)).tick === tickR);
  await page.click('#result .result-actions button.sub');
  check('「もう一度」で同じ依頼を最初から', await until(page, () => window.__vh.sim.hunt?.phase === 'active' && window.__vh.sim.monsters[0].hp === window.__vh.sim.monsters[0].def.hp && document.getElementById('result').hidden));
  // ---- 捕獲: 弱らせる → 罠 → 鎮静玉 2 個 ----
  await page.evaluate(() => {
    const v = window.__vh;
    const m = v.sim.monsters[0];
    m.aiEnabled = false;
    m.hp = Math.floor(m.def.hp * 0.2);
    const p = v.sim.player;
    p.invulnTicks = 1e9;
    p.itemIndex = 1;
  });
  await page.keyboard.press('KeyE');
  check('拘束罠を置くと、少しして作動可能になる', await until(page, () => window.__vh.sim.traps[0]?.state === 'armed' && window.__vh.sim.player.items[1].count === 0, 10000));
  await page.evaluate(() => {
    const v = window.__vh;
    const t = v.sim.traps[0];
    const m = v.sim.monsters[0];
    m.pos.x = t.x;
    m.pos.z = t.z + 1.2;
    const p = v.sim.player;
    p.pos.x = t.x;
    p.pos.z = t.z - 4;
    p.yaw = 0;
    p.itemIndex = 2;
    v.view.cam.snap(0);
  });
  check('大型が罠を踏むと動きが止まる', await until(page, () => window.__vh.sim.monsters[0].trapTicks > 0 && window.__vh.sim.traps[0]?.state === 'holding', 5000));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}59_hunt_trap.png` });
  await page.keyboard.press('KeyE');
  await until(page, () => window.__vh.sim.monsters[0].tranq === 1 && window.__vh.sim.player.mode === 'free', 8000);
  await page.keyboard.press('KeyE');
  check('弱って罠にかかった相手に鎮静玉を 2 個当てると捕獲になる', await until(page, () => window.__vh.sim.monsters[0].captured && window.__vh.sim.hunt.reason === 'capture', 8000));
  // この依頼の報酬の保存を、1 度だけ失敗させる（容量不足などの代わり）
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = orig;
      throw new DOMException('quota', 'QuotaExceededError');
    };
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}60_hunt_capture.png` });
  check('捕獲の結果画面に、捕獲の素材が出る', await until(page, () => !document.getElementById('result').hidden && /捕獲に成功/.test(document.getElementById('result').textContent) && /素材 5 個/.test(document.getElementById('result').textContent), 20000));
  await page.screenshot({ path: `${OUT}61_hunt_capture_result.png` });
  check('保存に失敗した時は、結果の画面に「保存できませんでした」と出て、持ち物は増えていない', await until(page, () => {
    const e = document.querySelector('.result-save');
    return e?.dataset.state === 'failed' && /保存できませんでした/.test(e.textContent) && /まだ持ち物に入っていません/.test(e.textContent) && !!e.querySelector('button') && window.__vh.inventory.money === 600 && window.__vh.unsavedRewards() === 1;
  }, 8000), await page.textContent('.result-save'));
  await page.screenshot({ path: `${OUT}61b_hunt_save_failed.png` });
  await page.click('.result-save button');
  check('「もう一度保存する」で保存でき、1 回分だけ入る', await until(page, () => document.querySelector('.result-save')?.dataset.state === 'saved' && window.__vh.inventory.money === 1200 && window.__vh.unsavedRewards() === 0, 8000));
  // 結果画面を開いたままでも、もう一度やり直しても、同じ依頼の報酬は増えない
  check('持ち物は 2 回分（通貨 1200）', await until(page, () => window.__vh.inventory.money === 1200, 8000));
  await page.click('#result .result-actions button.sub');
  await until(page, () => window.__vh.sim.hunt?.phase === 'active' && document.getElementById('result').hidden, 8000);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.screenshot({ path: `${OUT}57_menu_quest_hunt.png` });
  await page.click('.menu-body button');
  check('リタイアで失敗として終わる', await until(page, () => window.__vh.sim.hunt.phase === 'failed' && window.__vh.sim.hunt.reason === 'retire', 8000));
  check('リタイアの結果画面が出る', await until(page, () => !document.getElementById('result').hidden && /依頼失敗/.test(document.getElementById('result').textContent), 10000));
  await page.screenshot({ path: `${OUT}58_hunt_retire.png` });
  const det = await page.evaluate(() => window.__vh.runDeterminismCheck());
  check('依頼の入力記録（リタイアを含む）の再生が、いまの状態と一致', /結果: 一致/.test(det) && /いまの画面の状態とも一致/.test(det), det.split('\n')[3]);
  await page.click('#result .result-actions button:not(.sub)');
  check('結果から拠点へ戻れる', await until(page, () => !document.getElementById('base').hidden && document.getElementById('result').hidden));
  check('拠点に持ち物（通貨 1200 と素材）が出る。リタイアでは増えていない', await page.evaluate(() => /通貨 1200/.test(document.querySelector('.base-inv').textContent) && /×/.test(document.querySelector('.base-inv').textContent) && window.__vh.inventory.money === 1200), await page.textContent('.base-inv'));
  await page.screenshot({ path: `${OUT}62_base_inventory.png` });

  // ---- 保存（IndexedDB）: 読み込み直し、二重取り、失敗、取り込み、強化、別のタブ ----
  const boot = async (pg) => {
    await pg.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
    await pg.click('#boot-start');
    await until(pg, () => window.__vh && !document.getElementById('base').hidden);
  };
  const saved = (pg) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__vh.save.doc)));
  const before = await saved(page);
  check('保存の場所は IndexedDB（ゲーム固有の名前）で、2 回の報酬が revision 2 として入っている',
    (await page.evaluate(() => window.__vh.save.mode)) === 'persistent' && before.revision === 2 && before.settledRuns.length === 2 && before.schemaVersion === 1
      && (await page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'veilbound-hunters:prod:save'))),
    `通貨 ${before.money} / 素材 ${JSON.stringify(before.items)} / 達成 ${JSON.stringify(before.progress.questClears)}`);
  await page.reload();
  await boot(page);
  const after = await saved(page);
  check('ページを読み込み直しても、持ち物・装備・進行・処理済みの依頼が同じ', JSON.stringify(after) === JSON.stringify(before) && /通貨 1200/.test(await page.textContent('.base-inv')));
  check('同じ依頼の報酬をもう一度送っても、増えない（処理済みの記録で 1 度だけ）', await page.evaluate(async (runId) => {
    const s = window.__vh.save;
    const r1 = await s.settle({ runId, questId: 'quest.basin.003', money: 600, items: [{ itemId: 'mat.galdros.shell_shard', count: 5 }] });
    const r2 = await s.settle({ runId, questId: 'quest.basin.003', money: 600, items: [] });
    return r1.ok && r2.ok && s.doc.money === 1200 && s.doc.revision === 2;
  }, before.settledRuns[0]));
  // 書き込みの途中で失敗させる（容量不足の代わり）。持ち物は増えず、失敗が返る。やり直すと 1 回分だけ入る
  const fail = await page.evaluate(async () => {
    const s = window.__vh.save;
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = orig;
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const rw = { runId: 'smoke-fail-1', questId: 'quest.basin.003', money: 50, items: [] };
    const r1 = await s.settle(rw);
    const mid = { money: s.doc.money, revision: s.doc.revision, settled: s.isSettled('smoke-fail-1') };
    const r2 = await s.settle(rw);
    return { r1, mid, r2, money: s.doc.money, revision: s.doc.revision };
  });
  check('書き込みに失敗したら、持ち物は増えず「保存できませんでした」が返る。やり直すと 1 回分だけ入る',
    fail.r1.ok === false && fail.r1.reason === 'failed' && fail.mid.money === 1200 && fail.mid.revision === 2 && !fail.mid.settled && fail.r2.ok && fail.money === 1250 && fail.revision === 3, JSON.stringify(fail.r1));

  // 取り込み: 書き出した内容を書き換えて（強化に足りる素材を持たせて）取り込む。壊れた内容は断る
  await page.click('#base-data > summary');
  const exported = await page.evaluate(() => window.__vh.save.exportText());
  const rich = JSON.parse(exported);
  check('書き出した内容に、目印・版・持ち物が入っている', rich.format === 'veilbound-hunters-save' && rich.save.schemaVersion === 1 && rich.save.money === 1250);
  await page.fill('.data-paste', exported.slice(0, 80));
  await page.click('text=貼り付けた内容を確かめる');
  check('途中で切れた内容は取り込まない（理由が出る）', await until(page, () => /取り込めません/.test(document.querySelector('.base-message').textContent), 4000) && (await saved(page)).revision === 3);
  rich.save.items = { 'mat.galdros.shell_shard': 4, 'mat.galdros.hard_bone': 2, 'mat.galdros.bronze_vein': 1, 'mat.future.star_core': 2 };
  await page.fill('.data-paste', JSON.stringify(rich));
  await page.click('text=貼り付けた内容を確かめる');
  await page.click('#base-data button.go');
  check('取り込むと、内容が入れ替わる。知らない素材も消さずに持つ', await until(page, () => window.__vh.save.doc.items['mat.galdros.shell_shard'] === 4 && window.__vh.save.doc.items['mat.future.star_core'] === 2 && window.__vh.save.doc.revision === 4 && /取り込みました/.test(document.querySelector('.base-message').textContent), 6000),
    await page.evaluate(() => document.querySelector('.base-unknown')?.textContent ?? ''));
  check('取り込む前の内容が、控えに残っている', await page.evaluate(async () => {
    const bs = await window.__vh.save.backups();
    return bs.some((b) => b.reason === 'import' && b.doc.money === 1250 && b.doc.revision === 3) && bs.some((b) => b.reason === 'session');
  }));
  await page.screenshot({ path: `${OUT}63_base_data.png` });

  // 工房: 岩殻の断岳剣へ強化
  await page.click('#base-forge > summary');
  await page.screenshot({ path: `${OUT}64_base_forge.png` });
  check('工房に、必要な素材と持っている数が出る', await page.evaluate(() => {
    const t = document.querySelector('.forge-recipe')?.textContent ?? '';
    return /里鍛ちの断岳剣 → 岩殻の断岳剣/.test(t) && /攻撃力 80 → 92/.test(t) && /岩殻片 4 \/ 3/.test(t) && /硬骨 2 \/ 2/.test(t) && /青銅晶脈 1 \/ 1/.test(t) && /通貨 1250 \/ 120/.test(t);
  }), await page.evaluate(() => document.querySelector('.forge-recipe')?.textContent ?? ''));
  await page.click('.forge-recipe button.go');
  await page.screenshot({ path: `${OUT}65_base_forge_confirm.png` });
  await page.click('.forge-confirm button.go');
  check('強化すると、素材 3+2+1 と 120 通貨が減り、断岳剣が岩殻の断岳剣に変わって装備される', await until(page, () => {
    const d = window.__vh.save.doc;
    return d.money === 1130 && d.items['mat.galdros.shell_shard'] === 1 && !('mat.galdros.hard_bone' in d.items) && !('mat.galdros.bronze_vein' in d.items)
      && d.weapons.includes('weapon.heavy_blade.002') && !d.weapons.includes('weapon.heavy_blade.001') && d.equippedWeaponId === 'weapon.heavy_blade.002' && d.revision === 5
      && /岩殻の断岳剣に強化しました/.test(document.querySelector('.base-message').textContent) && /強化済み/.test(document.querySelector('.forge-recipe').textContent);
  }, 6000));
  check('後ろのハンターが、岩殻の断岳剣（岩の板を足した形）を持つ', await until(page, () => window.__vh.sim.player.weaponId === 'weapon.heavy_blade.002' && window.__vh.view.hunter.modelKey === 'model.weapon.heavy_blade.002', 6000));
  await page.screenshot({ path: `${OUT}66_base_forged.png` });
  await page.reload();
  await boot(page);
  check('読み込み直しても、強化した武器と減った素材のまま', await page.evaluate(() => {
    const d = window.__vh.save.doc;
    return d.equippedWeaponId === 'weapon.heavy_blade.002' && d.money === 1130 && d.revision === 5 && window.__vh.weaponId === 'weapon.heavy_blade.002' && /岩殻の断岳剣（攻撃力 92）/.test(document.querySelector('.base-weapon-note').textContent);
  }));
  await page.locator('.base-choice').last().click();
  await until(page, () => window.__vh.sim.tick > 10);
  check('訓練場でも岩殻の断岳剣（攻撃力 92）を持っている', await page.evaluate(() => window.__vh.sim.player.weaponId === 'weapon.heavy_blade.002' && window.__vh.sim.content.weapons.get(window.__vh.sim.player.weaponId).attack === 92));
  await page.keyboard.press('KeyR');
  await until(page, () => window.__vh.sim.player.drawn && !window.__vh.sim.player.action, 6000);
  await page.screenshot({ path: `${OUT}67_forged_in_field.png` });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.click('.menu-body button');
  await until(page, () => !document.getElementById('base').hidden);

  // 別のタブ: 同じ保存データを 2 つのタブで開く。新しい方が書いた後、古い方から書こうとしても上書きしない
  const page2 = await ctx.newPage();
  await page2.goto(`http://localhost:${PORT}${BASE}`);
  await boot(page2);
  await page2.click('.base-weapon[data-weapon="weapon.twin_blades.001"]');
  check('別のタブ: 2 つ目のタブで双剣に持ち替えて保存', await until(page2, () => window.__vh.save.doc.equippedWeaponId === 'weapon.twin_blades.001' && window.__vh.save.doc.revision === 6, 6000));
  await page.click('.base-weapon[data-weapon="weapon.long_blade.001"]');
  check('別のタブ: 古い内容のままの 1 つ目のタブからは上書きせず、新しい内容（双剣）を読み直して知らせる', await until(page, () => {
    const d = window.__vh.save.doc;
    return d.equippedWeaponId === 'weapon.twin_blades.001' && d.revision === 6 && /ほかのタブ/.test(document.querySelector('.base-message').textContent) && window.__vh.sim.player.weaponId === 'weapon.twin_blades.001';
  }, 6000), await page.textContent('.base-message'));
  await page.click('.base-weapon[data-weapon="weapon.long_blade.001"]');
  check('別のタブ: 読み直した後は、ふつうに持ち替えられる', await until(page, () => window.__vh.save.doc.equippedWeaponId === 'weapon.long_blade.001' && window.__vh.save.doc.revision === 7, 6000));
  await page2.close();
  await ctx.close();
}

// ---- 工房: 7 武器すべての強化（岩殻の〜）----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  // 利用者の端末から受け取った保存データ（依頼 2 回分、太刀を装備）を取り込む。太刀の強化だけ、素材が足りている
  const device = readFileSync(new URL('../tests/fixtures/save-v1-device-0.7.0.json', import.meta.url), 'utf8');
  await page.click('#base-data > summary');
  await page.fill('.data-paste', device);
  await page.click('text=貼り付けた内容を確かめる');
  await page.click('#base-data button.go');
  check('実機の保存データ（v0.7.0）を取り込める。太刀を装備した状態になる', await until(page, () => window.__vh.save.doc.money === 1200 && window.__vh.weaponId === 'weapon.long_blade.001' && window.__vh.sim.player.weaponId === 'weapon.long_blade.001', 8000));
  await page.click('#base-forge > summary');
  check('工房: いま装備している太刀がいちばん上に出て、強化できる（岩殻片 7 / 3、青銅晶脈 2 / 2）。断岳剣は硬骨が足りない', await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.forge-recipe')];
    const first = boxes[0]?.textContent ?? '';
    const heavy = boxes.find((b) => b.dataset.recipe === 'recipe.heavy_blade.002');
    return boxes.length === 7 && /里鍛ちの太刀 → 岩殻の太刀/.test(first) && /攻撃力 76 → 87/.test(first) && /岩殻片 7 \/ 3/.test(first) && /青銅晶脈 2 \/ 2/.test(first) && !boxes[0].querySelector('button.go').disabled
      && /不足 硬骨 1 \/ 2|硬骨 1 \/ 2/.test(heavy.textContent) && heavy.querySelector('button.go').disabled && /強化できます: 2/.test(document.querySelector('#base-forge > summary').textContent); // 太刀と双剣（どちらも青銅晶脈 2 を使うので、作れるのは片方）
  }), await page.evaluate(() => document.querySelector('.forge-recipe')?.textContent ?? ''));
  await page.screenshot({ path: `${OUT}72_forge_seven.png` });
  await page.click('.forge-recipe button.go');
  await page.click('.forge-confirm button.go');
  check('太刀を強化すると、岩殻片 3・青銅晶脈 2・120 通貨が減り、岩殻の太刀（攻撃力 87）を装備している', await until(page, () => {
    const d = window.__vh.save.doc;
    return d.money === 1080 && d.items['mat.galdros.shell_shard'] === 4 && !('mat.galdros.bronze_vein' in d.items) && d.equippedWeaponId === 'weapon.long_blade.002'
      && window.__vh.view.hunter.modelKey === 'model.weapon.long_blade.002' && /岩殻の太刀（攻撃力 87）/.test(document.querySelector('.base-weapon-note').textContent);
  }, 8000));
  // 残りの 5 つ（護刃・大槌・双剣・長尖槍・環弓）は、素材を持たせてから強化する
  const all = await page.evaluate(async () => {
    const s = window.__vh.save;
    const text = JSON.parse(s.exportText());
    text.save.items = { 'mat.galdros.shell_shard': 30, 'mat.galdros.hard_bone': 20, 'mat.galdros.bronze_vein': 20, 'mat.galdros.foreleg_plate': 10 };
    await s.importText(JSON.stringify(text));
    const out = [];
    for (const fam of ['heavy_blade', 'guard_blade', 'war_maul', 'twin_blades', 'long_lance', 'ring_bow']) out.push([fam, (await s.craft(`recipe.${fam}.002`)).ok]);
    window.__vh.saveChanged();
    return { out, weapons: s.doc.weapons, money: s.doc.money };
  });
  check('7 武器すべてを強化できる（1 つ 120 通貨）。持っている武器は 7 つのまま、すべて岩殻の〜に変わる',
    all.out.every((x) => x[1]) && all.weapons.length === 7 && all.weapons.every((w) => w.endsWith('.002')) && all.money === 1080 - 120 * 6, JSON.stringify(all.out));
  const shapes = [];
  for (const fam of ['guard_blade', 'war_maul', 'twin_blades', 'long_lance', 'ring_bow', 'heavy_blade']) {
    await page.click(`.base-weapon[data-weapon="weapon.${fam}.002"]`);
    await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy') && window.__vh.view.hunter.modelKey === id.replace('weapon.', 'model.weapon.'), 8000, `weapon.${fam}.002`);
    shapes.push(await page.evaluate(() => {
      const h = window.__vh.view.hunter;
      const names = [];
      h.weapon.traverse((o) => o.name && names.push(o.name));
      const off = [];
      h.shield.traverse((o) => o.name && off.push(o.name));
      return { key: h.modelKey, named: names.includes(h.modelKey), off: off.find((n) => n.startsWith('model.weapon')) ?? '', art: h.weaponArt.every((a) => a.loaded && !a.failed) };
    }));
  }
  check('強化後の武器は、それぞれ岩の板を足した形を持つ（双剣は左の剣も）', shapes.every((x) => x.named && x.art) && shapes.find((x) => x.key === 'model.weapon.twin_blades.002').off === 'model.weapon.twin_blades.002', shapes.map((x) => x.key.split('.')[2]).join(' / '));
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  check('読み込み直しても、7 つとも岩殻の〜のまま。工房は「強化済み」が 7 つ', await page.evaluate(() => {
    document.querySelector('#base-forge').open = true;
    const d = window.__vh.save.doc;
    return d.weapons.every((w) => w.endsWith('.002')) && d.equippedWeaponId === 'weapon.heavy_blade.002' && [...document.querySelectorAll('.forge-recipe')].filter((b) => /強化済み/.test(b.textContent)).length === 7 && document.querySelectorAll('.base-weapon').length === 7;
  }));
  await ctx.close();
}

// ---- 保存: 新しい版のデータ・壊れたデータには触れない ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  const seed = (pg, doc) => pg.evaluate((d) => new Promise((resolve, reject) => {
    const req = indexedDB.open('veilbound-hunters:prod:save');
    req.onsuccess = () => {
      const tx = req.result.transaction('slots', 'readwrite');
      tx.objectStore('slots').put(d);
      tx.oncomplete = () => { req.result.close(); resolve(true); };
      tx.onabort = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), doc);
  const stored = (pg) => pg.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('veilbound-hunters:prod:save');
    req.onsuccess = () => {
      const g = req.result.transaction('slots', 'readonly').objectStore('slots').get('main');
      g.onsuccess = () => { req.result.close(); resolve(g.result ?? null); };
      g.onerror = () => reject(g.error);
    };
    req.onerror = () => reject(req.error);
  }));
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  check('最初は何も書き込まない（保存するものが無い間は、端末に何も置かない）', (await stored(page)) === null && (await page.evaluate(() => window.__vh.save.doc.revision)) === 0);
  const future = { slotId: 'main', schemaVersion: 2, revision: 40, updatedAt: '2027-01-01T00:00:00.000Z', money: 9999, newThing: { a: [1, 2, 3] } };
  await seed(page, future);
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  check('新しい版のデータがある時は、知らせを出して、保存なしで動く', await page.evaluate(() => window.__vh.save.mode === 'readonly' && /新しい版/.test(document.querySelector('.base-banner')?.textContent ?? '') && /保存されません/.test(document.querySelector('.base-save-state').textContent)));
  await page.click('.base-weapon[data-weapon="weapon.ring_bow.001"]');
  await until(page, () => window.__vh.weaponId === 'weapon.ring_bow.001', 6000);
  check('その間に持ち替えても、置いてあるデータは 1 文字も変わらない', JSON.stringify(await stored(page)) === JSON.stringify(future) && (await page.evaluate(() => window.__vh.weaponId)) === 'weapon.ring_bow.001');
  await page.screenshot({ path: `${OUT}68_base_newer_data.png` });
  await ctx.close();
}

// ---- 横向きスマホ（タッチ） ----
{
  const { ctx, page } = await open({ width: 844, height: 390 }, true);
  await page.tap('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.screenshot({ path: `${OUT}20_touch_base.png` });
  await page.locator('.base-choice').last().tap();
  await until(page, () => window.__vh.sim.tick > 10);
  await page.screenshot({ path: `${OUT}20_touch_start.png` });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  // 指 1: 左スティックを上へ / 指 2: 右側ドラッグで視点 / 指 3: 攻撃ボタン。3 本同時。
  await touch('touchStart', [{ x: 120, y: 280, id: 1 }]);
  await touch('touchMove', [{ x: 120, y: 215, id: 1 }]);
  check('タッチ: スティックで移動', await until(page, () => window.__vh.sim.player.pos.z > -17));
  await touch('touchStart', [{ x: 120, y: 215, id: 1 }, { x: 520, y: 180, id: 2 }]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: 120, y: 215, id: 1 }, { x: 520 + i * 12, y: 180, id: 2 }]);
    await page.waitForTimeout(40);
  }
  check('タッチ: 移動しながら視点を回せる', await until(page, () => Math.abs(window.__vh.view.cam.yaw) > 0.2));
  const z1 = (await state(page)).z;
  const main = await page.evaluate(() => {
    const r = document.querySelector('.tbtn-main').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await touch('touchStart', [{ x: 120, y: 215, id: 1 }, { x: 592, y: 180, id: 2 }, { x: main.x, y: main.y, id: 3 }]);
  check('タッチ: 移動+視点+攻撃の同時操作', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.heavy_blade.draw_slash', 5000), `移動中 z ${z1.toFixed(1)}`);
  await page.screenshot({ path: `${OUT}21_touch_three_fingers.png` });
  // 押しっぱなしのまま touchcancel（通知・ジェスチャー等で指が奪われた状況）→ 入力が解除されること
  await touch('touchCancel', []);
  await page.waitForTimeout(300);
  const held = await page.evaluate(() => window.__vh.hub.sample(0));
  check('タッチ: cancel で押しっぱなしが残らない', held.held === 0 && held.moveX === 0 && held.moveZ === 0, JSON.stringify(held));
  await idle(page);
  await page.screenshot({ path: `${OUT}22_touch_after.png` });

  // 同じボタンに 2 本の指 → 押下は 1 回だけ
  const starts0 = await page.evaluate(() => window.__vh.recorded.filter((f) => f.pressed & 1).length);
  await touch('touchStart', [{ x: main.x - 8, y: main.y, id: 1 }]);
  await touch('touchStart', [{ x: main.x - 8, y: main.y, id: 1 }, { x: main.x + 8, y: main.y, id: 2 }]);
  await page.waitForTimeout(200);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const starts1 = await page.evaluate(() => window.__vh.recorded.filter((f) => f.pressed & 1).length);
  check('タッチ: 同じボタンへ 2 本指でも二重発火しない', starts1 - starts0 === 1, `押下 ${starts1 - starts0} 回`);
  await idle(page);

  // HUD のボタンはタッチ操作の層に隠れず押せる
  await page.tap('.hud-btn:nth-of-type(1)');
  check('タッチ: 「検証」ボタンで検証表示が出る', await until(page, () => !document.getElementById('verify').hidden, 3000));
  await page.screenshot({ path: `${OUT}25_touch_verify.png` });
  await page.tap('.hud-btn:nth-of-type(1)');
  await page.tap('.hud-btn:nth-of-type(2)');
  check('タッチ: ☰ でメニューが開く', await until(page, () => !document.getElementById('menu').hidden, 3000));
  await page.screenshot({ path: `${OUT}26_touch_menu.png` });
  await page.tap('.menu-head .close');
  check('タッチ: 「戻る」でメニューが閉じる', await until(page, () => document.getElementById('menu').hidden, 3000));
  // 連続タップ: ボタンは 2 回とも効き、画面は拡大されない
  {
    const tapAt = async (x, y) => {
      await touch('touchStart', [{ x, y, id: 9 }]);
      await touch('touchEnd', []);
    };
    const vb = await page.evaluate(() => {
      const b = document.querySelector('.hud-btn');
      window.__clicks = 0;
      b.addEventListener('click', () => window.__clicks++);
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await tapAt(vb.x, vb.y);
    await page.waitForTimeout(70);
    await tapAt(vb.x, vb.y);
    await page.waitForTimeout(350);
    const clicks = await page.evaluate(() => window.__clicks);
    check('タッチ: ボタンを続けて 2 回叩くと、ちょうど 2 回効く', clicks === 2, `${clicks} 回`);
    await tapAt(600, 120);
    await page.waitForTimeout(70);
    await tapAt(600, 120);
    await page.waitForTimeout(350);
    const zoom = await page.evaluate(() => ({
      scale: window.visualViewport.scale,
      prevented: ['touch', 'game'].map((id) => !document.getElementById(id).dispatchEvent(new TouchEvent('touchstart', { cancelable: true, bubbles: true }))),
    }));
    check('タッチ: 操作領域のダブルタップで拡大されない（既定の動作を止めている）', zoom.scale === 1 && zoom.prevented.every(Boolean), JSON.stringify(zoom));
    await idle(page);
  }
  const pwa = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    const m = await (await fetch(link.href)).json();
    const icons = await Promise.all(m.icons.map((i) => fetch(new URL(i.src, link.href)).then((r) => r.ok)));
    const apple = await fetch(document.querySelector('link[rel=apple-touch-icon]').href).then((r) => r.ok);
    return { display: m.display, icons, apple, start: new URL(m.start_url, link.href).pathname };
  });
  check('ホーム画面用の設定とアイコンが配信される', pwa.display === 'fullscreen' && pwa.icons.every(Boolean) && pwa.apple && pwa.start === new URL(page.url()).pathname.replace(/index\.html$/, ''), JSON.stringify(pwa));
  // ボタン配置の編集: 回避ボタンを左上へ 40px 動かして保存される
  await page.tap('.hud-btn:nth-of-type(2)');
  await page.tap('.menu-head .tab:nth-child(2)');
  await page.tap('text=配置を編集');
  const dodge = await page.evaluate(() => {
    const r = document.querySelector('.tbtn-dodge').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await touch('touchStart', [{ x: dodge.x, y: dodge.y, id: 1 }]);
  await touch('touchMove', [{ x: dodge.x - 40, y: dodge.y - 40, id: 1 }]);
  await touch('touchEnd', []);
  await page.screenshot({ path: `${OUT}27_touch_edit.png` });
  await page.tap('.edit-bar button:not(.sub)');
  const moved = await page.evaluate(() => {
    const r = document.querySelector('.tbtn-dodge').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, saved: JSON.parse(localStorage.getItem('veilbound-hunters:prod:settings')).layout.dodge };
  });
  check('タッチ: ボタンをドラッグで動かして保存できる', Math.abs(moved.x - (dodge.x - 40)) < 2 && Math.abs(moved.y - (dodge.y - 40)) < 2 && moved.saved?.dx === -40, JSON.stringify(moved.saved));
  await page.evaluate(() => window.__vh.store.set({ layout: {} }));

  // 左利き配置
  await page.evaluate(() => window.__vh.store.set({ leftHanded: true }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}23_touch_lefty.png` });
  await page.evaluate(() => window.__vh.store.set({ leftHanded: false }));

  // 縦持ち → 案内と一時停止 → 横へ戻すと再開
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const t0 = (await state(page)).tick;
  await page.waitForTimeout(400);
  const rotateShown = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none');
  check('縦持ち: 回転案内を表示して一時停止', rotateShown && (await state(page)).tick === t0);
  await page.screenshot({ path: `${OUT}24_portrait.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  check('横向きへ戻すと再開', await until(page, () => window.__vh.sim.tick > 0 && !window.__vh.paused, 5000));
  const t1 = (await state(page)).tick;
  check('再開後に simulation が進む', await until(page, `window.__vh.sim.tick > ${t1 + 5}`, 5000));
  // 回転後も入力が効く
  await touch('touchStart', [{ x: 120, y: 280, id: 1 }]);
  await touch('touchMove', [{ x: 120, y: 215, id: 1 }]);
  const zBefore = (await state(page)).z;
  check('回転後の入力復帰', await until(page, `Math.abs(window.__vh.sim.player.pos.z - (${zBefore})) + Math.abs(window.__vh.sim.player.pos.x) > 0.5`, 5000));
  await touch('touchEnd', []);
  await ctx.close();
}

// ---- 素材ビューア ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  const shots = [
    ['30_viewer_idle', ''],
    ['31_viewer_overhead_raise', '?action=player.heavy_blade.overhead&tick=18&yaw=-1.5708'],
    ['32_viewer_overhead_active', '?action=player.heavy_blade.overhead&tick=26&yaw=-1.5708'],
    ['33_viewer_overhead_end', '?action=player.heavy_blade.overhead&tick=34&yaw=-1.5708'],
    ['34_viewer_side_sweep', '?action=player.heavy_blade.side_sweep&tick=22&yaw=0.6'],
    ['35_viewer_roll', '?action=player.common.roll&tick=14&yaw=-1.5708'],
    ['36_viewer_dummy_slam', '?action=monster.training_dummy.slam&tick=52&yaw=-1.2'],
    ['37_viewer_draw', '?action=player.heavy_blade.draw&tick=4&yaw=2.6'],
    ['60_galdros_idle', '?subject=galdros&yaw=0.9&shapes=0'],
    ['61_galdros_right', '?subject=galdros&yaw=-1.5708&shapes=0'],
    ['62_galdros_front', '?subject=galdros&yaw=0&shapes=0'],
    ['69_galdros_left', '?subject=galdros&yaw=1.5708&shapes=0'],
    ['70_galdros_back', '?subject=galdros&yaw=3.1416&shapes=0'],
    ['71_galdros_shapes', '?subject=galdros&yaw=-1.5708'],
    ['63_galdros_slam', '?action=monster.galdros.slam_l&tick=44&yaw=0.9'],
    ['64_galdros_slam_hit', '?action=monster.galdros.slam_l&tick=53&yaw=0.9'],
    ['65_galdros_charge', '?action=monster.galdros.charge&tick=40&yaw=0.9'],
    ['66_galdros_tail', '?action=monster.galdros.tail_sweep&tick=47&yaw=2.6'],
    ['67_galdros_roar', '?action=monster.galdros.roar&tick=30&yaw=0.9'],
    ['68_galdros_damaged', '?subject=galdros&yaw=2.4&damaged=1'],
  ];
  // ---- 断岳剣以外の 6 系統: 拠点で持ち替えて、訓練場で主攻撃を当てる ----
  await page.goto(`http://localhost:${PORT}${BASE}`);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.screenshot({ path: `${OUT}weapon_select.png` });
  // ---- 刃の状態と研磨石（訓練場、断岳剣）----
  await page.locator('.base-choice').last().click();
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  check('訓練場: 刃の棒が出て「鋭い」。道具は研磨石 ×10', await page.evaluate(() => {
    const e = document.querySelector('.hud-blade .edge');
    const it = window.__vh.sim.player.items;
    return !e.hidden && e.dataset.stage === 'keen' && e.querySelector('.stage').textContent === '鋭い' && it.length === 1 && it[0].itemId === 'item.whetstone' && it[0].count === 10 && /研磨石\s*×10/.test(document.querySelector('.hud-item').textContent);
  }), await page.evaluate(() => document.querySelector('.hud-item').textContent.replace(/\s+/g, ' ')));
  const toHead = (edge) => page.evaluate((v) => {
    const s = window.__vh.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 2.25 };
    p.prevPos = { ...p.pos };
    p.yaw = 0;
    p.drawn = true;
    if (v !== null) p.edge = v;
    window.__vh.view.cam.snap(0.9);
  }, edge);
  await toHead(null);
  await page.mouse.move(640, 360);
  await click(page);
  check('縦斬りを 1 回当てると、刃が 1.6 減る', await until(page, () => window.__vh.sim.hitCount === 1 && Math.abs(window.__vh.sim.player.edge - 98.4) < 1e-6, 8000));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  // 並まで減った状態で、硬い部位（頭を一時的に硬くする）を斬る → 弾かれる
  await toHead(50);
  await page.evaluate(() => (window.__vh.sim.content.monsters.get('monster.training_dummy').parts[0].hitzone.cut = 0.3));
  await click(page);
  check('刃が「並」の時に硬い部位を斬ると、弾かれてよろける（棒は黄色、「弾かれた」と出る）', await until(page, () => {
    const p = window.__vh.sim.player;
    const e = document.querySelector('.hud-blade .edge');
    return p.hurt?.kind === 'bounce' && Math.abs(p.edge - 46.8) < 1e-6 && e.dataset.stage === 'worn' && e.querySelector('.stage').textContent === '並' && /弾かれた/.test(document.getElementById('toasts').textContent);
  }, 8000));
  await page.screenshot({ path: `${OUT}70_edge_bounce.png` });
  await page.evaluate(() => (window.__vh.sim.content.monsters.get('monster.training_dummy').parts[0].hitzone.cut = 0.7));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  // 研磨石（E キー）: 片ひざを突いて研ぎ、最大へ戻る
  await page.keyboard.press('KeyE');
  check('研磨石を使うと、研ぐ動きが始まる', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.item.whet', 6000));
  await until(page, () => (window.__vh.sim.player.action?.tick ?? 0) >= 52, 8000);
  await page.screenshot({ path: `${OUT}71_edge_whet.png` });
  check('研ぎ終わると、刃が最大（鋭い）へ戻り、研磨石が 1 個減る。抜刀のまま', await until(page, () => {
    const p = window.__vh.sim.player;
    const e = document.querySelector('.hud-blade .edge');
    return p.mode === 'free' && p.edge === 100 && p.items[0].count === 9 && p.drawn && e.dataset.stage === 'keen' && [...window.__vh.view.missingClips].length === 0;
  }, 10000));
  await page.keyboard.press('KeyE');
  check('刃が最大の時は、研磨石は使えない（減らない）', await until(page, () => /まだ研がなくてよい/.test(document.getElementById('toasts').textContent), 4000) && (await page.evaluate(() => window.__vh.sim.player.items[0].count === 9 && !window.__vh.sim.player.action)));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.click('.menu-body button');
  await until(page, () => !document.getElementById('base').hidden);
  check('環弓では、刃の棒と研磨石が出ない', await (async () => {
    await page.locator('.base-weapon[data-weapon="weapon.ring_bow.001"]').click();
    await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.ring_bow.001');
    await page.locator('.base-choice').last().click();
    await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
    const ok = await page.evaluate(() => document.querySelector('.hud-blade .edge').hidden && window.__vh.sim.player.items.length === 0);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#menu:not([hidden])');
    await page.click('.menu-body button');
    await until(page, () => !document.getElementById('base').hidden);
    return ok;
  })());
  for (const [fam, name, dist, holdMs] of [['guard_blade', '護刃', 1.2, 60], ['long_lance', '長尖槍', 2.4, 60], ['ring_bow', '環弓', 8, 1300], ['war_maul', '大槌', 1.2, 60], ['twin_blades', '双剣', 0.9, 60], ['long_blade', '太刀', 1.3, 60]]) {
    await page.locator(`.base-weapon[data-weapon="weapon.${fam}.001"]`).click();
    // 持ち替えは、保存が完了してから替わる
    await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, `weapon.${fam}.001`);
    const picked = await page.evaluate(() => window.__vh.weaponId);
    await page.locator('.base-choice').last().click();
    await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
    await page.evaluate((d) => {
      const s = window.__vh.sim, m = s.monsters[0], p = s.player;
      m.aiEnabled = false;
      p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - d };
      p.prevPos = { ...p.pos };
      p.yaw = 0;
      p.drawn = true;
      window.__vh.view.cam.snap(0.9);
    }, dist);
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.waitForTimeout(holdMs);
    await page.mouse.up();
    const hit = await until(page, () => window.__vh.sim.hitCount >= 1, 8000);
    await page.screenshot({ path: `${OUT}weapon_${fam}.png` });
    const info = await page.evaluate(() => ({
      fam: window.__vh.view.hunter.familyId,
      // 大槌・双剣・太刀は設定図がまだ無い（単色の仮の形）ので、絵は 0 枚でよい
      art: window.__vh.view.hunter.weaponArt.every((a) => a.loaded && !a.failed),
      hits: window.__vh.sim.hitCount,
      missing: [...window.__vh.view.missingClips],
    }));
    check(`${name}: 拠点で持ち替えて、訓練場で主攻撃が当たる`, picked === `weapon.${fam}.001` && hit && info.fam === fam && info.art && info.missing.length === 0, `命中 ${info.hits} / 形 ${info.fam} / 絵 ${info.art} / 欠落 clip ${info.missing.join(',') || 'なし'}`);
    await page.evaluate(() => window.__vh.toBase());
    await until(page, () => !document.getElementById('base').hidden);
  }
  await page.locator('.base-weapon[data-weapon="weapon.heavy_blade.001"]').click();

  for (const [name, q] of shots) {
    await page.goto(`http://localhost:${PORT}${BASE}viewer.html${q}`);
    await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${name}.png` });
  }
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const text = await page.textContent('#panel');
  check('ビューア: 仮リグの全高が 1.75m', /全高 1\.7[45]\dm/.test(text), (text.match(/全高 [\d.]+m/) ?? [''])[0]);
  // 武器の一覧: 設定図から組んだ仮モデル（護刃・断岳剣・長尖槍・環弓）は絵がすべて読み込める。大槌・双剣・太刀は絵の無い仮の形
  const rackOk = await until(page, () => {
    const rack = window.__viewer?.rack;
    return !!rack && ['guardShield', 'guardSword', 'heavyBlade', 'heavyBladeShell', 'lance', 'greatShield', 'bow', 'arrow', 'quiver'].every((k) => rack[k] && rack[k].triangles > 50 && rack[k].art.length > 0 && rack[k].art.every((a) => a.loaded && !a.failed))
      && ['warMaul', 'twinBladeR', 'twinBladeL', 'longBlade'].every((k) => rack[k] && rack[k].triangles > 20 && rack[k].art.length === 0);
  }, 15000);
  check('ビューア: 7 武器の 13 点（護刃の剣・盾、断岳剣と岩殻の断岳剣、長尖槍の槍・大盾、環弓・矢・矢筒は形と絵。大槌・双剣 2 本・太刀は絵の無い仮の形）を読み込める', rackOk);
  // 強化後（岩殻の〜）の形: ?tier=2 で並ぶ
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?subject=weapons&tier=2`);
  check('ビューア: ?tier=2 で、強化後（岩殻の〜）の形が 7 武器ぶん並ぶ', await until(page, () => {
    const rack = window.__viewer?.rack;
    return !!rack && ['guardSword', 'heavyBladeShell', 'lance', 'bow'].every((k) => rack[k] && rack[k].art.length > 0 && rack[k].art.every((a) => a.loaded && !a.failed))
      && [['guardSword', 'guard_blade'], ['lance', 'long_lance'], ['warMaul', 'war_maul'], ['twinBladeR', 'twin_blades'], ['twinBladeL', 'twin_blades'], ['longBlade', 'long_blade'], ['bow', 'ring_bow']].every(([k, fam]) => rack[k]?.group?.name === `model.weapon.${fam}.002`);
  }, 15000));
  await page.screenshot({ path: `${OUT}73_viewer_tier2.png` });
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?tier=2&stance=idle&family=long_blade`);
  check('ビューア: ?tier=2 で、ハンターも強化後の形（岩殻の太刀）を持つ', await until(page, () => window.__viewer?.hunter?.modelKey === 'model.weapon.long_blade.002', 15000));
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?glb=assets/models/ref_cube_1m.glb`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const glb = await page.textContent('#panel pre');
  check('ビューア: 基準 GLB を読み、1m 立方体と +Z 矢印の寸法が合う', /幅 1\.000 \/ 高さ 1\.000 \/ 奥行 2\.000/.test(glb) && /前端 z=1\.500/.test(glb), glb.split('\n')[1]);
  await page.screenshot({ path: `${OUT}38_viewer_glb.png` });
  await ctx.close();
}

check('コンソールエラー・404 なし', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
