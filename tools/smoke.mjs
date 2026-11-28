// 本番ビルドをヘッドレス Chrome で起動し、実際に操作して画面を保存する簡易検査。
// 使い方: npm run build && npm run smoke   （Chrome が必要。CI では実行しない）
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4179;
const BASE = process.env.SMOKE_BASE ?? '/Kari/';
/** 里の描画の呼び出しの目標（v0.67.0。D-165。狩場は 100） */
const HUB_CALLS = 130;

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

/**
 * これまでの検査は、エリアに分ける前の 1 つの狩場（?hunt=arena）と、一覧の拠点（?hub=menu）で行う（位置や画面を決め打ちした確認が多いため）。
 * フィールド（エリアに分かれた狩場）は ?hub=menu だけを付けて、里を歩く拠点は何も付けないアドレスで、最後のまとまりで確かめる。
 */
const ARENA = '?hunt=arena&hub=menu';

async function open(viewport, touch, query = ARENA) {
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
  await page.goto(`http://localhost:${PORT}${BASE}${query}`);
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
/**
 * 条件が成り立つまで待つ。上限は simulation の tick で数える（v0.54.0）: ソフトウェア描画が遅い手元では、1 フレームで進む tick に
 * 上限（6）があるので、ゲームの中の時間が壁の時計より遅れる。待つ長さを「ゲームの中で ticks だけ進んでも成り立たなければ失敗」にする。
 * 壁の時計の上限は wallMs（止まった時に終わらせるため）。
 */
async function untilSim(page, fn, ticks, arg = null, wallMs = 240000) {
  const t0 = await page.evaluate(() => window.__vh.sim.tick);
  const end = Date.now() + wallMs;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    const t = await page.evaluate(() => window.__vh.sim.tick);
    if (t - t0 > ticks || Date.now() > end) return !!(await page.evaluate(fn, arg));
    await page.waitForTimeout(50);
  }
}
/** 押したまま、simulation が ticks だけ進むのを待って離す（歩く長さを、ゲームの中の時間で決める） */
async function holdSim(page, key, ticks) {
  const t0 = await page.evaluate(() => window.__vh.sim.tick);
  await page.keyboard.down(key);
  await page.waitForFunction(([start, n]) => window.__vh.sim.tick - start >= n, [t0, ticks], { timeout: 240000, polling: 30 }).catch(() => {});
  await page.keyboard.up(key);
}
/** 描画が 2 回進むのを待つ（HUD・地図は描画のたびに直すので、遅い手元では決まった時間では足りない） */
const nextFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const click = async (page, button = 'left') => {
  await page.mouse.down({ button });
  await page.waitForTimeout(80);
  await page.mouse.up({ button });
};
const idle = (page) => until(page, () => window.__vh.sim.player.mode === 'free');
// ---- 級別の受付（v0.38.0。ChatGPT の Pull Request #17）: 受付の一覧 → 級の受付 → 星 → 依頼の行 → 詳細 → 受注して出発 ----
/** 受付ごとに星の札を全部押して、依頼の行を集める（拠点の画面の中で。終わったら受付の一覧へ戻す。?hub=menu の時） */
const receptionRows = (page) => page.evaluate(() => {
  const base = window.__vh.base, out = [];
  for (const f of window.__vh.content.hub.facilities.filter((x) => x.kind === 'quest')) {
    base.setOpen(true, 'quest', f.id);
    const stars = [...document.querySelectorAll('.reception-star')].map((b) => b.dataset.stars);
    for (const st of stars) {
      if (document.querySelector('.reception-row')) document.querySelector('.reception-back').click();
      document.querySelector(`.reception-star[data-stars="${st}"]`).click();
      for (const r of document.querySelectorAll('.reception-row')) out.push({ desk: f.id, rank: r.dataset.rank, stars: Number(r.dataset.stars), id: r.dataset.quest, locked: r.classList.contains('locked'), text: r.textContent });
      document.querySelector('.reception-back').click();
    }
  }
  base.setOpen(true, 'all');
  return out;
});
/** 依頼の詳細を開く（?hub=menu では、その級の受付・星・詳細へ。出発はしない） */
const showQuest = async (page, id) => {
  await page.evaluate((q) => window.__vh.base.showQuest(q), id);
  await until(page, (q) => !!document.querySelector(`.reception-depart[data-quest="${q}"], .base-delivery[data-delivery="${q}"]`), 5000, id);
};
/** 詳細の「受注して出発」を押す */
const departQuest = async (page, id) => {
  await showQuest(page, id);
  await page.click(`.reception-depart[data-quest="${id}"]`);
  await page.click(`.reception-confirm-go[data-quest="${id}"]`);
};
/** 訓練場（受付の一覧と初級の受付の下にある） */
const startTraining = async (page, tap = false) => {
  await page.evaluate(() => window.__vh.base.setOpen(true, 'all'));
  if (tap) await page.locator('.reception-training').tap();
  else await page.click('.reception-training');
};

// ---- PC（キーボード・マウス） ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.screenshot({ path: `${OUT}01_boot.png` });
  await page.click('#boot-start');
  check('起動すると拠点の画面が出て、一時停止している', await until(page, () => window.__vh && !document.getElementById('base').hidden && window.__vh.sim.tick === 0));
  await page.screenshot({ path: `${OUT}02_base.png` });
  const desks0 = await page.evaluate(() => [...document.querySelectorAll('.reception-desk[data-reception]')].map((d) => `${d.dataset.reception}:${d.textContent}`));
  const rows0 = await receptionRows(page);
  const rowRank = (id) => rows0.find((r) => r.id === id);
  check('拠点: 依頼は級ごとの受付に分かれる（v0.38.0。v0.75.0 から、初級 3 件 + 里の納品 1・中級 3・上級 3・極級 1）。最初に受けられるのは初級だけで、ほかは未解放', desks0.length === 4
    && ['rank.1', 'rank.2', 'rank.3', 'rank.4'].map((r) => rows0.filter((x) => x.rank === r).length).join() === '5,4,4,1'
    && rows0.filter((x) => x.rank === 'rank.1' && x.id !== 'quest.delivery.009' && x.id !== 'quest.spinegale.r1' && x.id !== 'quest.frostald.r1' && x.id !== 'quest.venolka.r1').every((x) => !x.locked) && rows0.find((x) => x.id === 'quest.delivery.009')?.locked === true && rows0.find(x=>x.id==='quest.spinegale.r1')?.locked===true && rows0.find((x) => x.id === 'quest.frostald.r1')?.locked === true && rows0.find(x=>x.id==='quest.venolka.r1')?.locked===true && rows0.filter((x) => x.rank !== 'rank.1').every((x) => x.locked)
    && rowRank('quest.basin.003')?.rank === 'rank.1' && rowRank('quest.basin.r2.001')?.rank === 'rank.2' && rowRank('quest.basin.r4.001')?.rank === 'rank.4'
    && await page.evaluate(() => /^防御力の合計 0（受けるダメージ ×1\.00）$/.test(document.querySelector('.base-armor-note').textContent) && document.querySelectorAll('.base-armor-row').length === 5),
    JSON.stringify({ desks: desks0.length, n: ['rank.1', 'rank.2', 'rank.3', 'rank.4'].map((r) => rows0.filter((x) => x.rank === r).length) }));
  await showQuest(page, 'quest.basin.r2.001');
  check('拠点: 中級の依頼の詳細は、受けられない時も開け、条件の文が出て「受注して出発」は押せない', await page.evaluate(() => {
    const go = document.querySelector('.reception-depart[data-quest="quest.basin.r2.001"]');
    return !!go && go.disabled && /「岩場の足音」を達成すると受けられます/.test(document.querySelector('.reception-locked-note')?.textContent ?? '') && /中級/.test(document.querySelector('#base h2').textContent);
  }), await page.evaluate(() => document.querySelector('.reception-detail')?.textContent?.slice(0, 160) ?? ''));
  check('まだ受けられない依頼は、呼び出しても始まらない', await page.evaluate(() => {
    window.__vh.startHunt('quest.basin.r4.001');
    return !document.getElementById('base').hidden && !window.__vh.sim.hunt;
  }));
  await startTraining(page);
  check('訓練場を選ぶと simulation が進む', await until(page, () => window.__vh.sim.tick > 10));
  await page.screenshot({ path: `${OUT}02_start.png` });
  // 技を 1 つずつ確かめる間は、標的の攻撃を止めておく（防御・被弾の確認の所で再開する）
  await page.evaluate(() => (window.__vh.sim.monsters[0].aiEnabled = false));

  await page.keyboard.down('KeyW');
  check('W で前進する', await untilSim(page, () => window.__vh.sim.player.pos.z > -16, 1200));
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
  // 段階 2 は 123、離すのが遅れて段階 3 に入ると 164（通常の縦斬りは 58）。v0.23.0 の係数（縦斬り 1.05、溜め ×2.1 / ×2.8。D-092）
  check('溜め斬り（段階 2 以上）が命中し、威力が上がる', s5.hits === 4 && (last.damage === 123 || last.damage === 164), `damage ${last?.damage} part ${last?.partId}`);

  // 斬り上げ（v0.40.0。2G の △+○）: V（主と副の同時押し）で、地面すれすれから振り上げて 1 回だけ当たる。縦斬りの後から、低い所からの斬り上げへつながる
  await page.keyboard.press('KeyV');
  check('V（主と副の同時押し）で斬り上げが出る（v0.40.0）', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.heavy_blade.upswing', 3000));
  await until(page, () => (window.__vh.sim.player.action?.tick ?? 0) >= 21);
  await page.screenshot({ path: `${OUT}09b_upswing.png` });
  await idle(page);
  check('斬り上げが 1 回だけ命中する', (await state(page)).hits === 5, `hits ${(await state(page)).hits}`);
  await click(page);
  await until(page, () => (window.__vh.sim.player.action?.tick ?? 0) >= 44);
  await page.keyboard.press('KeyV');
  check('縦斬りの振り下ろしの後で V を押すと、低い所からの斬り上げへつながる', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.heavy_blade.upswing_low', 3000));
  await idle(page);

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
  check('R で納刀する', await untilSim(page, () => !window.__vh.sim.player.drawn && window.__vh.sim.player.mode === 'free', 180));
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
  await untilSim(page, () => window.__vh.sim.player.pos.z > 4.2, 2400);
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
  // 一時停止が解けたことは、次の描画で知る（その時に押していたキーは離したことにする）。遅い手元では、解ける前に押すと消えるので待つ
  await until(page, () => window.__vh.paused === false, 10000);

  // 段差: 東の段々（0.3m ずつ）を登る。高い岩棚（1.4m）は登れない。
  await page.evaluate(() => {
    window.__vh.sim.monsters[0].aiEnabled = false;
    const p = window.__vh.sim.player;
    p.pos.x = 14;
    p.pos.z = 20;
    window.__vh.view.cam.snap(0);
  });
  await page.keyboard.down('KeyA');
  check('小さな段差を登れる（0.9m の段の上へ）', await untilSim(page, () => window.__vh.sim.player.pos.y > 0.85, 900),
    await page.evaluate(() => { const v = window.__vh, p = v.sim.player; return JSON.stringify({ x: p.pos.x, y: p.pos.y, z: p.pos.z, mode: p.mode, drawn: p.drawn, tick: v.sim.tick, camYaw: v.view.cam.yaw, paused: v.paused ?? null, menu: !document.getElementById('menu').hidden }); }));
  await page.keyboard.up('KeyA');
  await page.screenshot({ path: `${OUT}18_steps.png` });
  await page.evaluate(() => {
    const p = window.__vh.sim.player;
    p.pos.x = -24;
    p.pos.y = 0;
    p.pos.z = -23;
    window.__vh.view.cam.snap(0);
  });
  await holdSim(page, 'KeyA', 90);
  await page.keyboard.down('KeyD');
  await untilSim(page, () => window.__vh.sim.player.pos.x < -26.9, 900);
  await untilSim(page, () => false, 48);
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
  await departQuest(page, 'quest.basin.003');
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
  // ロックオン（v0.16.0）: T で入る。カメラが標的の方を向き続け、標的に照準が出る。もう一度 T で外れる
  await page.keyboard.press('KeyT');
  const lockAim = () => page.evaluate(() => {
    const a = window.__vh, v = a.view, s = a.sim, m = s.monsters[0], p = s.player;
    const want = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    const off = Math.abs(((v.cam.yaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return { lock: v.lockOn, off, mark: !document.getElementById('hud-lock').hidden };
  });
  check('ロックオン: T で入り、カメラが標的の方を向き、標的に照準が出る', await until(page, () => {
    const a = window.__vh, v = a.view, s = a.sim, m = s.monsters[0], p = s.player;
    const want = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    return v.lockOn && Math.abs(((v.cam.yaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.06 && !document.getElementById('hud-lock').hidden;
  }, 5000), JSON.stringify(await lockAim()));
  // 横へ動いても、向きを追い続ける
  await page.evaluate(() => { const p = window.__vh.sim.player; p.pos = { x: p.pos.x + 5, y: 0, z: p.pos.z }; p.prevPos = { ...p.pos }; });
  check('ロックオン: 横へ動いても、カメラが標的を追い続ける', await until(page, () => {
    const a = window.__vh, v = a.view, s = a.sim, m = s.monsters[0], p = s.player;
    const want = Math.atan2(m.pos.x - p.pos.x, m.pos.z - p.pos.z);
    return v.lockOn && Math.abs(((v.cam.yaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.06;
  }, 5000), JSON.stringify(await lockAim()));
  await page.keyboard.press('KeyT');
  check('ロックオン: もう一度 T で外れ、照準が消える', await until(page, () => !window.__vh.view.lockOn && document.getElementById('hud-lock').hidden), JSON.stringify(await lockAim()));
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
  await page.keyboard.press('KeyT');
  await until(page, () => window.__vh.view.lockOn, 3000);
  await click(page);
  check('討伐すると狩猟が成功で終わる', await until(page, () => window.__vh.sim.hunt.phase === 'success', 20000));
  check('ロックオン: 標的を倒すと外れ、「ロックオンが外れた」と出る', await until(page, () => !window.__vh.view.lockOn && document.getElementById('hud-lock').hidden && /ロックオンが外れた/.test(document.getElementById('toasts').textContent), 5000),
    await page.evaluate(() => `lock ${window.__vh.view.lockOn} / ${document.getElementById('toasts').textContent}`));
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
  check('剥ぎ取ると素材が 1 個手に入り、残りが 2 回になる', await untilSim(page, () => window.__vh.sim.hunt.carves.body === 2 && window.__vh.sim.hunt.loot.length === 1, 480));
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
  check('拘束罠を置くと、少しして作動可能になる', await untilSim(page, () => window.__vh.sim.traps[0]?.state === 'armed' && window.__vh.sim.player.items[1].count === 0, 600));
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
  {
    const rows = await receptionRows(page);
    const locked = (id) => rows.find((r) => r.id === id)?.locked;
    // v0.75.0: 白紙にした 19 種の依頼を外した。スパインゲイル・フロストアルドの中級は、初級の自分の依頼も要るので、まだ開かない
    check('初級を達成したので、中級の依頼が受けられる（上級・極級はまだ）。スパインゲイルの初級も開く（v0.38.0 から級別の受付）', ['quest.basin.003', 'quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'].map(locked).join() === 'false,false,true,true'
      && /済/.test(rows.find((r) => r.id === 'quest.basin.003')?.text ?? '') && locked('quest.spinegale.r1') === false && locked('quest.spinegale.r2') === true && locked('quest.frostald.r1') === true,
      JSON.stringify(rows.filter((r) => r.rank !== 'rank.1').map((r) => `${r.id}:${r.locked ? '×' : '○'}`)));
  }
  await departQuest(page, 'quest.basin.r2.001');
  check('中級の依頼: HUD に【中級】と出て、個体の体力は 2430（初級 1800）、与えるダメージは 1.3 倍、出る素材は中級の表', await until(page, () => {
    const v = window.__vh, m = v.sim.monsters[0];
    return v.sim.hunt?.phase === 'active' && v.sim.tick > 5 && m.hp === 2430 && m.def.hp === 2430 && v.sim.monsterAttackScale === 1.3 && v.sim.rank.id === 'rank.2'
      && /【中級】脈打つ岩殻/.test(document.querySelector('.goal')?.textContent ?? '');
  }), await page.evaluate(() => `hp ${window.__vh.sim.monsters[0]?.hp} scale ${window.__vh.sim.monsterAttackScale}`));
  await page.screenshot({ path: `${OUT}74_hunt_rank2.png` });
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu:not([hidden])');
  await page.click('.menu-head .tab:nth-child(1)');
  check('一時停止の画面にも段階が出る', /【中級】脈打つ岩殻/.test(await page.textContent('#menu')));
  await page.evaluate(() => [...document.querySelectorAll('.menu-body button')].find((b) => /リタイア/.test(b.textContent)).click());
  await until(page, () => !document.getElementById('result').hidden, 8000);
  await page.evaluate(() => [...document.querySelectorAll('#result button')].find((b) => /拠点/.test(b.textContent)).click());
  await until(page, () => !document.getElementById('base').hidden);
  const boot = async (pg) => {
    await pg.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
    await pg.click('#boot-start');
    await until(pg, () => window.__vh && !document.getElementById('base').hidden);
  };
  const saved = (pg) => pg.evaluate(() => JSON.parse(JSON.stringify(window.__vh.save.doc)));
  const before = await saved(page);
  check('保存の場所は IndexedDB（ゲーム固有の名前）で、2 回の報酬が revision 2 として入っている',
    (await page.evaluate(() => window.__vh.save.mode)) === 'persistent' && before.revision === 2 && before.settledRuns.length === 2 && before.schemaVersion === 6 && before.claims.length === 0 && before.appearance.profile === 'legacy_hunter_a_v1' && before.armor.length === 5 && before.equippedArmorIds.length === 5
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
  check('書き出した内容に、目印・版・持ち物が入っている', rich.format === 'veilbound-hunters-save' && rich.save.schemaVersion === 6 && rich.save.money === 1250);
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
      && /岩殻の断岳剣に強化しました/.test(document.querySelector('.base-message').textContent)
      // 工房には、次の段（脈殻。中級の個体の素材が要る）が出る
      && /岩殻の断岳剣 → 脈殻の断岳剣/.test(document.querySelector('.forge-recipe').textContent) && /脈岩殻 0 \/ 3（中級から）/.test(document.querySelector('.forge-recipe').textContent);
  }, 6000));
  check('後ろのハンターが、岩殻の断岳剣（岩の板を足した形）を持つ', await until(page, () => window.__vh.sim.player.weaponId === 'weapon.heavy_blade.002' && window.__vh.view.hunter.modelKey === 'model.weapon.heavy_blade.002', 6000));
  await page.screenshot({ path: `${OUT}66_base_forged.png` });
  await page.reload();
  await boot(page);
  check('読み込み直しても、強化した武器と減った素材のまま', await page.evaluate(() => {
    const d = window.__vh.save.doc;
    return d.equippedWeaponId === 'weapon.heavy_blade.002' && d.money === 1130 && d.revision === 5 && window.__vh.weaponId === 'weapon.heavy_blade.002' && /岩殻の断岳剣（攻撃力 92）/.test(document.querySelector('.base-weapon-note').textContent);
  }));
  await startTraining(page);
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
  await page2.goto(`http://localhost:${PORT}${BASE}${ARENA}`);
  await boot(page2);
  await page2.click('.base-weapon[data-weapon="weapon.twin_blades.001"]');
  check('別のタブ: 2 つ目のタブで双剣に持ち替えて保存', await until(page2, () => window.__vh.save.doc.equippedWeaponId === 'weapon.twin_blades.001' && window.__vh.save.doc.revision === 6, 6000));
  // 1 つ目のタブを前へ（人は見ているタブを操作する。後ろのタブは、ヘッドレス Chrome では毎秒 1 回しか描かれず、v0.22.0 の景色では 6 秒に収まらなかった）
  await page.bringToFront();
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
  check('工房: 武器 7 と防具 5 の「次の強化」が並ぶ。いま装備している太刀がいちばん上で、強化できる（岩殻片 7 / 3、青銅晶脈 2 / 2）。断岳剣は硬骨が足りない', await page.evaluate(() => {
    // 強化の行だけ（v0.32.0 から、たたんだ「作る」の欄にも行がある）
    const boxes = [...document.querySelectorAll('.forge-recipe')].filter((b) => !b.closest('.forge-make'));
    const first = boxes[0]?.textContent ?? '';
    const heavy = boxes.find((b) => b.dataset.recipe === 'recipe.heavy_blade.002');
    return boxes.length === 12 && /里鍛ちの太刀 → 岩殻の太刀/.test(first) && /攻撃力 76 → 87/.test(first) && /岩殻片 7 \/ 3/.test(first) && /青銅晶脈 2 \/ 2/.test(first) && !boxes[0].querySelector('button.go').disabled
      && /不足 硬骨 1 \/ 2|硬骨 1 \/ 2/.test(heavy.textContent) && heavy.querySelector('button.go').disabled && /強化できます: 5/.test(document.querySelector('#base-forge > summary').textContent); // 武器は太刀と双剣、防具は頭・胴・腰（どちらも青銅晶脈 2 を使うので、作れるのは片方）
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
    // 絵は読み込みに時間がかかる（遅い手元では、形が替わった時にまだ読めていない）
    await until(page, () => window.__vh.view.hunter.weaponArt.every((a) => a.loaded || a.failed), 20000);
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
  check('読み込み直しても、7 つとも岩殻の〜のまま。工房には、次の段（脈殻の〜）が 7 つ出る', await page.evaluate(() => {
    document.querySelector('#base-forge').open = true;
    const d = window.__vh.save.doc;
    return d.weapons.every((w) => w.endsWith('.002')) && d.equippedWeaponId === 'weapon.heavy_blade.002' && [...document.querySelectorAll('.forge-recipe')].filter((b) => /岩殻の.+ → 脈殻の/.test(b.textContent)).length === 7 && document.querySelectorAll('.base-weapon').length === 7;
  }));
  await ctx.close();
}

// ---- 保存: 版 1（防具が入る前）のデータが端末にある時 ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  // まず 1 回書き込んで置き場所を作り、そこへ v0.7.0 の実機のデータ（版 1）をそのまま置く
  await page.evaluate(() => window.__vh.save.settle({ runId: 'smoke-make-db', questId: 'quest.basin.003', money: 1, items: [] }));
  const v1 = JSON.parse(readFileSync(new URL('../tests/fixtures/save-v1-device-0.7.0.json', import.meta.url), 'utf8')).save;
  await page.evaluate((d) => new Promise((resolve, reject) => {
    const req = indexedDB.open('veilbound-hunters:prod:save');
    req.onsuccess = () => {
      const tx = req.result.transaction('slots', 'readwrite');
      tx.objectStore('slots').put(d);
      tx.oncomplete = () => { req.result.close(); resolve(true); };
      tx.onabort = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), v1);
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  check('版 1 のデータ（v0.7.0 の実機）を開くと、いまの版（4）へ直して保存する。持ち物・武器・進行はそのまま、里の装束が配られ、元のデータは控えに残る', await page.evaluate(async (orig) => {
    const s = window.__vh.save, d = s.doc;
    const bs = await s.backups();
    return s.mode === 'persistent' && d.schemaVersion === 6 && d.claims.length === 0 && d.appearance.profile === 'legacy_hunter_a_v1' && d.equippedArmorIds.join() === d.armor.join() && d.money === 1200 && d.items['mat.galdros.shell_shard'] === 7 && d.equippedWeaponId === 'weapon.long_blade.001' && d.weapons.length === 7
      && d.armor.join() === 'armor.head.001,armor.chest.001,armor.arms.001,armor.waist.001,armor.legs.001' && d.progress.questClears['quest.basin.003'] === 2 && d.revision === 4
      && bs.some((b) => b.reason === 'migrate' && JSON.stringify(b.doc) === JSON.stringify(orig)) && /新しい形へ直しました/.test(document.querySelector('.base-banner')?.textContent ?? '');
  }, v1), await page.evaluate(() => `${window.__vh.save.mode} v${window.__vh.save.doc.schemaVersion} r${window.__vh.save.doc.revision} ${window.__vh.save.notice}`));
  {
    const rows = await receptionRows(page);
    check('初級を達成済みなので、中級の依頼が受けられる', ['quest.basin.003', 'quest.basin.r2.001', 'quest.basin.r3.001', 'quest.basin.r4.001'].map((id) => rows.find((r) => r.id === id)?.locked).join() === 'false,false,true,true');
  }
  // 防具: 岩殻の兜（岩殻片 2 + 硬骨 1 + 80 通貨）
  await page.click('#base-forge > summary');
  await page.screenshot({ path: `${OUT}75_forge_armor.png`, fullPage: false });
  await page.click('.forge-recipe[data-recipe="recipe.armor.head.002"] button.go');
  await page.click('.forge-confirm button.go');
  check('防具の強化: 里の頭巾 → 岩殻の兜。岩殻片 2・硬骨 1・80 通貨が減り、防御力が 0 → 6 になる', await until(page, () => {
    const d = window.__vh.save.doc;
    return d.armor.includes('armor.head.002') && !d.armor.includes('armor.head.001') && d.money === 1120 && d.items['mat.galdros.shell_shard'] === 5 && !('mat.galdros.hard_bone' in d.items)
      && /^防御力の合計 6（受けるダメージ ×0\.94）$/.test(document.querySelector('.base-armor-note').textContent) && document.querySelector('.base-armor-row[data-slot="head"]').dataset.worn === 'armor.head.002' && d.equippedArmorIds.includes('armor.head.002') && /岩殻の兜に強化しました/.test(document.querySelector('.base-message').textContent)
      && /岩殻の兜 → 脈殻の兜/.test(document.querySelector('.forge-recipe[data-recipe="recipe.armor.head.003"]')?.textContent ?? '');
  }, 8000), await page.evaluate(() => document.querySelector('.base-armor-note').textContent));
  check('防具の見た目: 拠点の後ろのハンターが、岩殻の兜をかぶる（頭だけ 2 段目。外套は付けたまま、兜の下の髪の束は描かない）', await until(page, () => {
    const h = window.__vh.view.hunter;
    return h.armorKey === '21111' && h.armorTriangles > 0 && h.hiddenBody.join() === 'hair';
  }, 8000), await page.evaluate(() => window.__vh.view.hunter.armorKey));
  await startTraining(page);
  check('訓練場でも、岩殻の兜をかぶっている', await until(page, () => window.__vh.sim.tick > 5 && window.__vh.view.hunter.armorKey === '21111' && window.__vh.sim.armorIds.includes('armor.head.002')));
  await page.screenshot({ path: `${OUT}78_training_helm.png` });
  check('訓練場でも依頼でも、その防御力で受けるダメージが減る（防御力 6 → 100/106 倍）', await until(page, () => window.__vh.sim.tick > 5 && window.__vh.sim.defense === 6 && Math.abs(window.__vh.sim.defenseScale - 100 / 106) < 1e-9));
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  check('読み込み直しても、岩殻の兜のまま（控えは増えない）', await page.evaluate(async () => {
    const s = window.__vh.save;
    return s.doc.armor.includes('armor.head.002') && s.doc.equippedArmorIds.includes('armor.head.002') && s.doc.schemaVersion === 6 && s.notice === null && (await s.backups()).filter((b) => b.reason === 'migrate').length === 1;
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
  const future = { slotId: 'main', schemaVersion: 99, revision: 40, updatedAt: '2027-01-01T00:00:00.000Z', money: 9999, newThing: { a: [1, 2, 3] } };
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
  await startTraining(page, true);
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
  // v0.23.0: 道具のボタンに、道具の絵（ChatGPT の追加原画のアイコン）が出る。訓練場は研磨石
  const itemBtn = await page.evaluate(() => { const b = document.querySelector('.tbtn-item'); return { icon: b.classList.contains('has-icon'), bg: b.style.backgroundImage, text: b.textContent }; });
  check('タッチ: 道具のボタンに、いま選んでいる道具の絵が出る（訓練場は研磨石）', itemBtn.icon && /icon_item_whetstone_v1\.webp/.test(itemBtn.bg) && /研磨石/.test(itemBtn.text), JSON.stringify(itemBtn));
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

  // ロックオン（v0.16.0）: 「ロック」ボタンで入・切。入っている間はボタンが点く。ほかのボタンと重ならない
  const lockBtn = await page.evaluate(() => {
    const r = document.querySelector('.tbtn-lock').getBoundingClientRect();
    const others = [...document.querySelectorAll('#touch .tbtn')].filter((b) => b.dataset.name !== 'lock' && !b.hidden && getComputedStyle(b).display !== 'none').map((b) => b.getBoundingClientRect());
    const hit = others.some((q) => !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom));
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, hit };
  });
  check('タッチ: 「ロック」ボタンが出ていて、44px 以上で、ほかのボタンと重ならない', lockBtn.w >= 44 && !lockBtn.hit, JSON.stringify(lockBtn));
  await touch('touchStart', [{ x: lockBtn.x, y: lockBtn.y, id: 1 }]);
  await touch('touchEnd', []);
  check('タッチ: 「ロック」を押すとロックオンが入り、ボタンが点く', await until(page, () => window.__vh.view.lockOn && document.querySelector('.tbtn-lock').classList.contains('latched'), 3000));
  await page.screenshot({ path: `${OUT}22_touch_lock.png` });
  await touch('touchStart', [{ x: lockBtn.x, y: lockBtn.y, id: 1 }]);
  await touch('touchEnd', []);
  check('タッチ: もう一度押すと外れ、ボタンが消灯する', await until(page, () => !window.__vh.view.lockOn && !document.querySelector('.tbtn-lock').classList.contains('latched'), 3000));
  await idle(page);

  // v0.40.0（2G）: 主と副の同時押しの小さなボタン「斬上」（断岳剣だけ）。丸いボタンどうしが重ならない。視点を戻すボタンは「背後」
  const comboBtn = await page.evaluate(() => {
    const b = document.querySelector('.tbtn-combo');
    const circ = (q) => ({ x: q.left + q.width / 2, y: q.top + q.height / 2, r: q.width / 2 });
    const me = circ(b.getBoundingClientRect());
    const others = [...document.querySelectorAll('#touch .tbtn')].filter((x) => x !== b && !x.hidden && getComputedStyle(x).display !== 'none' && !x.classList.contains('center')).map((x) => ({ name: x.dataset.name, ...circ(x.getBoundingClientRect()) }));
    const gaps = others.map((o) => ({ name: o.name, gap: Math.round((Math.hypot(o.x - me.x, o.y - me.y) - o.r - me.r) * 10) / 10 })).sort((a, c) => a.gap - c.gap).slice(0, 3);
    return { x: me.x, y: me.y, w: me.r * 2, text: b.textContent, hidden: b.hidden, gaps, cam: document.querySelector('.tbtn-camreset').textContent };
  });
  check('タッチ: 断岳剣では「斬上」（主と副の同時押し）の小さなボタンが出て、ほかの丸いボタンと重ならない。視点を戻すボタンは「背後」', !comboBtn.hidden && comboBtn.text === '斬上' && comboBtn.w >= 34 && comboBtn.gaps[0].gap >= 0 && comboBtn.cam === '背後', JSON.stringify(comboBtn));
  await page.evaluate(() => {
    const p = window.__vh.sim.player;
    p.drawn = true;
  });
  await touch('touchStart', [{ x: comboBtn.x, y: comboBtn.y, id: 1 }]);
  await touch('touchEnd', []);
  check('タッチ: 抜刀して「斬上」を押すと、斬り上げが出る', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.heavy_blade.upswing', 3000));
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
    ['34b_viewer_upswing', '?action=player.heavy_blade.upswing&tick=21&yaw=1.57'],
    ['34c_viewer_drink_flex', '?action=player.item.drink&tick=92&yaw=0.5'],
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
  await page.goto(`http://localhost:${PORT}${BASE}${ARENA}`);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.screenshot({ path: `${OUT}weapon_select.png` });
  // ---- 刃の状態と研磨石（訓練場、断岳剣）----
  await startTraining(page);
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
  check('縦斬りを 1 回当てると、刃が 1.68 減る（v0.23.0 の係数 1.05 × 1.6）', await until(page, () => window.__vh.sim.hitCount === 1 && Math.abs(window.__vh.sim.player.edge - 98.32) < 1e-6, 8000));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  // 並まで減った状態で、硬い部位（頭を一時的に硬くする）を斬る → 弾かれる
  await toHead(50);
  await page.evaluate(() => (window.__vh.sim.content.monsters.get('monster.training_dummy').parts[0].hitzone.cut = 0.3));
  await click(page);
  check('刃が「並」の時に硬い部位を斬ると、弾かれてよろける（棒は黄色、「弾かれた」と出る）', await until(page, () => {
    const p = window.__vh.sim.player;
    const e = document.querySelector('.hud-blade .edge');
    return p.hurt?.kind === 'bounce' && Math.abs(p.edge - 46.64) < 1e-6 && e.dataset.stage === 'worn' && e.querySelector('.stage').textContent === '並' && /弾かれた/.test(document.getElementById('toasts').textContent);
  }, 8000));
  await page.screenshot({ path: `${OUT}70_edge_bounce.png` });
  await page.evaluate(() => (window.__vh.sim.content.monsters.get('monster.training_dummy').parts[0].hitzone.cut = 0.7));
  await until(page, () => window.__vh.sim.player.mode === 'free', 8000);
  // 研磨石（E キー）: v0.40.0（2G）から、抜刀中の E は納刀だけ。納刀してから、もう 1 度 E で、片ひざを突いて研ぎ、最大へ戻る
  await page.keyboard.press('KeyE');
  check('研磨石: 抜刀中に E を押すと、納刀だけをする（研がない。v0.40.0、2G）', await untilSim(page, () => {
    const p = window.__vh.sim.player;
    return p.mode === 'free' && !p.drawn;
  }, 360) && await page.evaluate(() => window.__vh.sim.player.items[0].count === 10 && window.__vh.sim.player.edge < 100), await page.evaluate(() => JSON.stringify({ mode: window.__vh.sim.player.mode, drawn: window.__vh.sim.player.drawn })));
  await page.keyboard.press('KeyE');
  check('研磨石を使うと、研ぐ動きが始まる', await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.item.whet', 6000));
  await until(page, () => (window.__vh.sim.player.action?.tick ?? 0) >= 52, 8000);
  await page.screenshot({ path: `${OUT}71_edge_whet.png` });
  check('研ぎ終わると、刃が最大（鋭い）へ戻り、研磨石が 1 個減る。武器は納めたまま（v0.40.0）', await until(page, () => {
    const p = window.__vh.sim.player;
    const e = document.querySelector('.hud-blade .edge');
    return p.mode === 'free' && p.edge === 100 && p.items[0].count === 9 && !p.drawn && e.dataset.stage === 'keen' && [...window.__vh.view.missingClips].length === 0;
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
    await startTraining(page);
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
    await startTraining(page);
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
  // v0.36.0（#12 の M2・M3）: ガルドロスの転倒の姿勢を、ビューアで戦闘と同じ状態から描く。骨 79 本・ひじ・ひざの補正形状が効いていて、部位の形も倒れている
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?pose=topple&tick=90&yaw=-0.4&dist=8&pitch=0.35`);
  await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
  const topple = await until(page, () => {
    const g = window.__viewer?.monsters?.galdros;
    if (!g) return false;
    const hide = g.rig.root.children.find((o) => o.name === 'hide');
    const infl = hide?.morphTargetInfluences ?? [];
    return g.m.staggerKind === 'topple' && g.rig.bones.length === 79 && infl.length === 4 && infl.some((v) => v > 0.05) && g.rig.root.children.length > 0;
  }, 8000);
  const toppleInfo = await page.evaluate(() => {
    const g = window.__viewer.monsters.galdros;
    const hide = g.rig.root.children.find((o) => o.name === 'hide');
    return { bones: g.rig.bones.length, infl: (hide?.morphTargetInfluences ?? []).map((v) => v.toFixed(2)).join(' '), kind: g.m.staggerKind };
  });
  await page.screenshot({ path: `${OUT}galdros_topple_follow.png` });
  check('ビューア: ガルドロスの転倒（?pose=topple）を描け、骨 79 本・ひじ・ひざの補正形状 4 つが効いている', topple, `骨 ${toppleInfo.bones} / 補正 ${toppleInfo.infl} / ${toppleInfo.kind}`);
  // 武器の一覧: 設定図から組んだ仮モデルは、絵がすべて読み込める（v0.24.0 から、大槌・双剣・太刀も依頼 6 の設定図から。大槌は正面と真横の 2 枚）
  const rackOk = await until(page, () => {
    const rack = window.__viewer?.rack;
    return !!rack && ['guardShield', 'guardSword', 'heavyBlade', 'heavyBladeShell', 'lance', 'greatShield', 'bow', 'arrow', 'quiver', 'warMaul', 'twinBladeR', 'twinBladeL', 'longBlade'].every((k) => rack[k] && rack[k].triangles > 50 && rack[k].art.length > 0 && rack[k].art.every((a) => a.loaded && !a.failed))
      && rack.warMaul.art.length === 2;
  }, 15000);
  check('ビューア: 7 武器の 13 点（護刃の剣・盾、断岳剣と岩殻の断岳剣、長尖槍の槍・大盾、環弓・矢・矢筒、大槌・双剣 2 本・太刀）の形と絵を読み込める', rackOk);
  // 強化後（岩殻の〜）の形: ?tier=2 で並ぶ
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?subject=weapons&tier=2`);
  check('ビューア: ?tier=2 で、強化後（岩殻の〜）の形が 7 武器ぶん並ぶ', await until(page, () => {
    const rack = window.__viewer?.rack;
    return !!rack && ['guardSword', 'heavyBladeShell', 'lance', 'bow'].every((k) => rack[k] && rack[k].art.length > 0 && rack[k].art.every((a) => a.loaded && !a.failed))
      && [['guardSword', 'guard_blade'], ['lance', 'long_lance'], ['warMaul', 'war_maul'], ['twinBladeR', 'twin_blades'], ['twinBladeL', 'twin_blades'], ['longBlade', 'long_blade'], ['bow', 'ring_bow']].every(([k, fam]) => rack[k]?.group?.name === `model.weapon.${fam}.002`);
  }, 15000));
  await page.screenshot({ path: `${OUT}73_viewer_tier2.png` });
  for (const t of [3, 4, 5]) {
    await page.goto(`http://localhost:${PORT}${BASE}viewer.html?subject=weapons&tier=${t}`);
    const ok = await until(page, (tier) => {
      const rack = window.__viewer?.rack;
      return !!rack && ['guardSword', 'heavyBladeShell', 'lance', 'warMaul', 'twinBladeR', 'twinBladeL', 'longBlade', 'bow'].every((k) => rack[k]?.group?.name?.endsWith(`.00${tier}`));
    }, 15000, t);
    if (t === 5) check('ビューア: ?tier=3〜5 で、脈殻・晶殻・輝殻の形（色の違う板）が並ぶ', ok);
    else if (!ok) check(`ビューア: ?tier=${t} が並ばない`, false);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}76_viewer_tier${t}.png` });
  }
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?armor=2&bones=0&shapes=0&yaw=0.4`);
  check('ビューア: ?armor=2 で、ハンターが岩殻の防具一式を着る（板のメッシュが付き、里の外套は描かない）', await until(page, () => {
    const h = window.__viewer?.hunter;
    return !!h && h.armorKey === '22222' && h.armorTriangles > 500 && h.hiddenBody.join() === 'mantle,hair' && Array.isArray(h.bodyMesh.material) && h.bodyMesh.geometry.groups.length === 3;
  }, 15000));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}77_viewer_armor.png` });
  await page.goto(`http://localhost:${PORT}${BASE}viewer.html?armor=3&armorSlots=head,legs`);
  check('ビューア: 部位を絞ると、その部位だけ付く（胴が里の装束なら、外套は描く。描かないのは兜の下の髪の束だけ）', await until(page, () => {
    const h = window.__viewer?.hunter;
    return !!h && h.armorKey === '31113' && h.armorTriangles > 0 && h.hiddenBody.join() === 'hair' && h.bodyMesh.geometry.groups.length === 2;
  }, 15000));
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

// ---- フィールド（エリアに分かれた狩場。v0.11.0）: 野営地から出発し、出口でエリアを移る。標的はエリアを巡り、弱ると巣で眠る ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await showQuest(page, 'quest.basin.003');
  check('フィールド: 依頼の詳細に、狩場の名前と、長くした制限時間（30 分）が出る（v0.38.0 から、受付の詳細）', await page.evaluate(() => {
    const t = document.querySelector('.reception-detail').textContent;
    return window.__vh.fieldHunts === true && /30 分/.test(t) && /風礫盆地/.test(t);
  }), await page.evaluate(() => document.querySelector('.reception-detail')?.textContent?.slice(0, 200) ?? ''));
  await page.screenshot({ path: `${OUT}80_field_base.png` });
  await page.click('.reception-depart[data-quest="quest.basin.003"]');
  await page.click('.reception-confirm-go[data-quest="quest.basin.003"]');
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.click('.classic-supply summary');
  await page.getByRole('button',{name:/標識玉 ×2.*受取 2/}).click();
  await until(page,()=>window.__vh.sim.player.items.some(x=>x.itemId==='item.marker_orb'&&x.count===2));
  await page.click('.classic-supply summary');
  const hudField = () => page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    const cells = [...document.querySelectorAll('.hud-map .cell')];
    return {
      area: s.areaId, x: s.player.pos.x, z: s.player.pos.z, target: s.monsterArea(m)?.id ?? '', roam: m.roam?.state ?? '', asleep: m.asleep,
      where: document.querySelector('.hud-quest .where').textContent, cells: cells.length,
      here: cells.filter((c) => c.classList.contains('here')).map((c) => c.textContent).join(), mark: cells.filter((c) => c.classList.contains('target')).map((c) => c.textContent).join(),
      sleepMark: cells.filter((c) => c.classList.contains('asleep')).map((c) => c.textContent).join(),
      marked: cells.filter((c) => c.classList.contains('marked')).map((c) => c.textContent).join(), seen: cells.filter((c) => c.classList.contains('seen')).map((c) => c.textContent).join(),
      rigVisible: window.__vh.view.monsterRig.root.visible, exit: document.querySelector('.hud-exit').hidden ? '' : document.querySelector('.hud-exit').textContent,
      banner: document.querySelector('.hud-area-banner').textContent, limit: s.hunt.timeLimitTicks,
    };
  });
  let f = await hudField();
  // v0.42.0（#19 の F04）: 出発した時は、標的の居場所を知らない（地図に印は無い）。2G と同じく、見つけて標識玉を当てると分かる
  check('フィールド: 野営地から始まる。標的はエリア 3 に居るが、まだ見ていないので、地図に印は無く「標的: 不明」', f.area === 'camp' && f.target === 'a3' && f.cells === 11 && f.here === '営' && f.mark === '' && f.seen === '' && /^野営地　標的: 不明$/.test(f.where) && f.limit === 108000, JSON.stringify(f));
  check('フィールド: 別のエリアに居る標的は描かない', f.rigVisible === false);
  // 地図（v0.42.0。#19 の F04）: 居るエリアの地図（外周・出口の行き先・自分の矢じり）と、上から見た向きの全体の地図
  const loc0 = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.hud-local .exit-label')].map((t) => t.textContent);
    const tgt = document.querySelector('.hud-local .tgt');
    const cell = (t) => [...document.querySelectorAll('.hud-map .cell')].find((c) => c.textContent === t)?.getBoundingClientRect().left ?? -1;
    return { labels, outline: !!document.querySelector('.hud-local .outline'), me: document.querySelector('.hud-local .me')?.getAttribute('transform') ?? '', tgt: tgt ? getComputedStyle(tgt).display : '', camp: cell('営'), a1: cell('1'), a9: cell('9') };
  });
  check('地図（v0.42.0）: 居るエリアの地図に、外周・出口の行き先（野営地は 1 へ）・自分の矢じりが出て、標的の点は出ない。全体の地図は上から見た向き（+X が左: 野営地が右、エリア 9 が左）', loc0.outline && loc0.labels.join() === '1' && /^translate\(/.test(loc0.me) && loc0.tgt === 'none' && loc0.camp > loc0.a1 && loc0.a9 < loc0.a1, JSON.stringify(loc0));
  await page.screenshot({ path: `${OUT}81_field_camp.png` });
  // 全体の地図（v0.51.0。#19 の F04）: 右上の地図を押すと開く。本当の形のエリア 11・道 14（大型も通る 8）・居るエリア（野営地）・自分の矢じり。
  // 標的はまだ見ていないので点は出ない。開いたまま歩ける（重ねは指を受けない）。M で閉じる
  await page.click('.hud-maps');
  // マウスを画面の真ん中へ戻す（後の click(page) は、いまのマウスの位置で押す。地図の上のままだと、攻撃の代わりに地図を開け閉めする）
  await page.mouse.move(640, 360);
  await page.waitForTimeout(250);
  await nextFrames(page);
  const fieldMap = () => page.evaluate(() => {
    const r = document.querySelector('.field-map');
    const areas = [...document.querySelectorAll('.field-map-svg path.area')];
    const tgt = document.querySelector('.field-map-svg .tgt');
    const tb = tgt.getBoundingClientRect();
    const inArea = (id) => { const b = areas.find((a) => a.dataset.area === id)?.getBoundingClientRect(); return !!b && tb.left + tb.width / 2 >= b.left && tb.left + tb.width / 2 <= b.right && tb.top + tb.height / 2 >= b.top && tb.top + tb.height / 2 <= b.bottom; };
    return {
      open: !!r && !r.hidden, pe: r ? getComputedStyle(r).pointerEvents : '', areas: areas.length, links: document.querySelectorAll('.field-map-svg line.link').length, large: document.querySelectorAll('.field-map-svg line.link:not(.thin)').length,
      here: areas.filter((a) => a.classList.contains('here')).map((a) => a.dataset.area).join(), target: areas.filter((a) => a.classList.contains('target')).map((a) => a.dataset.area).join(),
      marked: areas.filter((a) => a.classList.contains('marked')).map((a) => a.dataset.area).join(), asleep: areas.filter((a) => a.classList.contains('asleep')).map((a) => a.dataset.area).join(),
      seen: [...document.querySelectorAll('.field-map-svg .label.seen')].map((t) => t.textContent).join(), me: document.querySelector('.field-map-svg .me')?.getAttribute('transform') ?? '',
      tgt: getComputedStyle(tgt).display, tgtMarked: tgt.classList.contains('marked'), tgtIn10: inArea('a10'), labels: [...document.querySelectorAll('.field-map-svg .label')].map((t) => t.textContent).sort().join(),
    };
  });
  const fm0 = await fieldMap();
  await page.screenshot({ path: `${OUT}81_field_map.png` });
  const walk0 = await page.evaluate(() => ({ ...window.__vh.sim.player.pos }));
  await holdSim(page, 'KeyW', 30);
  const walk1 = await page.evaluate(() => ({ ...window.__vh.sim.player.pos }));
  await page.keyboard.press('KeyM');
  const fmClosed = await until(page, () => document.querySelector('.field-map').hidden, 8000);
  check('全体の地図（v0.51.0）: 右上の地図を押すと開き、本当の形のエリア 11・道 14（大型も通る 8）・番号・居るエリア（野営地）・自分の矢じりが出る。標的は不明なので点は無い。開いたまま歩け、M で閉じる',
    fm0.open && fm0.pe === 'none' && fm0.areas === 11 && fm0.links === 14 && fm0.large === 8 && fm0.here === 'camp' && /^translate\(/.test(fm0.me) && fm0.tgt === 'none' && fm0.target === '' && fm0.labels === '1,10,2,3,4,5,6,7,8,9,営' && Math.hypot(walk1.x - walk0.x, walk1.z - walk0.z) > 0.5 && fmClosed,
    JSON.stringify({ fm0, walk0, walk1, fmClosed }));
  // 景色の絵（依頼 8。v0.13.0）: 空と遠景・地面・岩・草
  const art = await until(page, () => { const a = window.__vh.envArt(); return a.asked >= 8 && a.loaded === a.asked && a.failed === 0; }, 15000);
  await page.waitForTimeout(300);
  const sky = await page.evaluate(() => {
    const v = window.__vh.view, b = v.scene.getObjectByName('backdrop'), c = v.cam.camera.position;
    let cutouts = 0;
    // エリアの中の草と小物の板（崖の向こうの木の葉の板と丘の草は数えない。v0.78.0・v0.79.0）
    v.scene.traverse((o) => { if (o.isInstancedMesh && o.visible && o.material.alphaTest > 0 && o.material.map && o.material.visible && !o.name.startsWith('field-exterior-')) cutouts += o.count; });
    return { art: window.__vh.envArt(), off: Math.abs(b.position.x - c.x) + Math.abs(b.position.z - c.z), far: b.children.filter((m) => m.material.map && m.material.visible).length, fog: v.scene.fog.color.getHexString(), cutouts, ...v.stats() };
  });
  check('景色の絵（狩場）: 頼んだ絵がすべて読めている。空と遠景の筒（絵 2 枚）が、カメラと一緒に動く。霧の色は絵の下の帯と同じ', art && sky.off < 0.01 && sky.far === 2 && sky.fog === 'aebcab', JSON.stringify(sky));
  check('景色の絵（狩場）: 草と小物の板が立っている（野営地で 150 より多い）。描画量は目標内（100 draw calls / 20万 tri）', sky.cutouts > 150 && sky.calls <= 100 && sky.triangles <= 200000, JSON.stringify(sky));
  // 現実に近づけた景色（v0.19.0）: 空の球と雲の時刻・霧・岩の凹凸と頂点の色・草の揺れと色・ほかのエリアを前もって作る
  const real = async () => page.evaluate(() => {
    const v = window.__vh.view, s = v.scene.getObjectByName('sky');
    let sway = 0, tinted = 0, rocks = 0;
    v.scene.traverse((o) => {
      if (!o.visible || !o.material) return;
      if (o.isInstancedMesh && o.material.customProgramCacheKey?.() === 'sway-in-wind') {
        sway += o.count;
        if (o.instanceColor) tinted++;
      }
      if (o.isMesh && o.material.vertexColors && o.material.bumpMap && o.geometry.getAttribute('color')) rocks++;
    });
    const groups = [...v.areaGroups.values()];
    return { sky: !!s && s.parent?.name === 'backdrop', time: s?.material.uniforms.uTime.value ?? -1, fogExp: v.scene.fog.isFogExp2 === true, sway, tinted, rocks, built: groups.length, shown: groups.filter((g) => g.visible).length };
  });
  const outer=await page.evaluate(()=>{const v=window.__vh.view,g=v.areaGroups.get(window.__vh.sim.areaId),s=g?.getObjectByName('field-natural-exterior');return s?.userData.landscape??null;});
  check('狩場外周: 平らな草原ではなく、起伏のある内外連続の地形・樹林・岩と出口の先が描かれる',outer?.outerMax-outer?.outerMin>9&&outer?.sharedVertices>0&&outer?.trees>10&&outer?.rocks>20,JSON.stringify(outer));
  // 崖の向こう（v0.78.0）: 木は、葉のかたまりと葉の板（小物の図集の茂みの絵）。岩は、依頼 10 の図を 1 つの形にまとめたもの。盆地の外側の地面は、内側と同じ絵
  const far = await until(page, () => {
    const v = window.__vh.view, ext = v.areaGroups.get(window.__vh.sim.areaId)?.getObjectByName('field-natural-exterior');
    const leaves = ext?.getObjectByName('field-exterior-leaves'), rocks = ext?.getObjectByName('field-exterior-rocks'), relief = ext?.getObjectByName('field-exterior-relief');
    return !!leaves?.material.map && leaves.material.visible && rocks?.material.userData.art?.artOn.value === 1 && !!relief?.material.map;
  }, 15000).then(() => page.evaluate(() => {
    const v = window.__vh.view, ext = v.areaGroups.get(window.__vh.sim.areaId)?.getObjectByName('field-natural-exterior');
    const leaves = ext?.getObjectByName('field-exterior-leaves'), canopy = ext?.getObjectByName('field-exterior-canopy'), rocks = ext?.getObjectByName('field-exterior-rocks'), relief = ext?.getObjectByName('field-exterior-relief');
    return {
      trees: ext?.userData.landscape.trees, shrubs: ext?.userData.landscape.shrubs, canopy: canopy?.count ?? 0, leaves: leaves?.count ?? 0, leafArt: !!leaves?.material.map && leaves.material.visible === true, key: leaves?.material.customProgramCacheKey?.(),
      rocks: rocks?.userData.rocks?.length ?? 0, steep: ext?.userData.landscape.steepRocks, rockArt: rocks?.material.userData.rockArt === true && rocks.material.userData.art?.artOn.value === 1, merged: !!rocks && rocks.isInstancedMesh !== true,
      outer: relief?.material.userData.outerGround === true && !!relief.material.map, kids: ext?.children.length,
    };
  }));
  check('崖の向こう（v0.78.0）: 野営地の外の木は、1 本に葉のかたまり 5 つと葉の板 39 枚（茂みの絵が読めている。草の揺れの素材とは別。v0.79.0 から、丘の茂み 1 つに 3 枚が加わる）。岩は、依頼 10 の図をまとめた 1 つの形（急な斜面には無い）。外側の地面は、内側と同じ絵。景観の描画は 9 回まで',
    far.trees > 10 && far.canopy === far.trees * 5 && far.leaves === far.trees * 39 + far.shrubs * 3 && far.leafArt && far.key === 'canopy-tuft' && far.rocks > 20 && far.steep === 0 && far.rockArt && far.merged && far.outer && far.kids <= 9, JSON.stringify(far));
  // 崖の向こうの影と、丘の草・茂み（v0.79.0）: 外側の地面が、木と岩の影の絵（エリアごとに 1 枚）を読む。丘に、草の株と茂み。遠い稜線は 1 つの形（景観の描画は増えない）
  const hill = await until(page, () => {
    const v = window.__vh.view, ext = v.areaGroups.get(window.__vh.sim.areaId)?.getObjectByName('field-natural-exterior'), grass = ext?.getObjectByName('field-exterior-grass');
    return !!grass?.material.map && grass.material.visible;
  }, 15000).then(() => page.evaluate(() => {
    const v = window.__vh.view, ext = v.areaGroups.get(window.__vh.sim.areaId)?.getObjectByName('field-natural-exterior');
    const relief = ext?.getObjectByName('field-exterior-relief'), grass = ext?.getObjectByName('field-exterior-grass'), sh = relief?.material.userData.exShade?.value;
    let on = 0;
    if (sh?.image?.data) for (const b of sh.image.data) if (b > 0) on++;
    return {
      shade: !!sh && sh === relief.userData.outerShade, px: sh ? [sh.image.width, sh.image.height] : null, on: sh ? Math.round((on / sh.image.data.length) * 1000) / 1000 : 0, aShade: !!relief?.geometry.getAttribute('aShade'), key: relief?.material.customProgramCacheKey?.(),
      grass: grass?.count ?? 0, grassArt: !!grass?.material.map && grass.material.visible === true, grassKey: grass?.material.customProgramCacheKey?.(), shrubs: ext?.userData.landscape.shrubs,
      ridge: ext?.getObjectByName('field-distant-ridge')?.userData.layers, kids: ext?.children.length, ...v.stats(),
    };
  }));
  check('崖の向こうの影と丘の草（v0.79.0）: 野営地の外側の地面が、木と岩の影の絵を読む（512 画素まで。影のある所は絵の 3〜40%）。丘に草の株（150 より多い）と茂み（15 より多い）。遠い稜線は 2 層を 1 つの形に。景観の描画は 8 回、全体は目標内（100 draw calls / 20万 tri）',
    hill.shade && hill.aShade && hill.key === 'outer-ground' && Math.max(...hill.px) <= 512 && hill.on > 0.03 && hill.on < 0.4 && hill.grass > 150 && hill.grassArt && hill.grassKey === 'sway-in-wind' && hill.shrubs > 15 && hill.ridge === 2 && hill.kids === 8 && hill.calls <= 100 && hill.triangles <= 200000, JSON.stringify(hill));
  const real1 = await real();
  const real2 = await until(page, () => window.__vh.view.areaGroups.size >= 2, 45000).then(() => real());
  check('景色（v0.19.0）: 空の球が遠景の中にあり、雲の時刻が進む。霧は距離の 2 乗の指数。岩と岩壁に頂点の色と凹凸。草は揺れる素材で、1 本ずつ色が違う', real1.sky && real2.time > real1.time && real1.fogExp && real1.rocks >= 1 && real1.sway > 100 && real1.tinted >= 2, JSON.stringify(real1));
  check('景色（v0.19.0）: まだ入っていないエリアも、前もって作られる（見えるのは、居るエリアだけ）', real2.built >= 2 && real2.shown === 1, JSON.stringify(real2));
  // 草と地面（v0.76.0・v0.77.0）: 草の板 1 本ずつに、その場所の色むらと陰の色が掛かる。草の素材へ、狩人の位置が渡る（足元の草が倒れる）
  const turf = await page.evaluate(() => {
    const v = window.__vh, p = v.sim.player, q = v.view.grassPush.value;
    const g = v.view.areaGroups.get(v.sim.areaId);
    let lo = 9, hi = 0, n = 0;
    g.traverse((o) => {
      if (!o.isInstancedMesh || o.material.customProgramCacheKey?.() !== 'sway-in-wind' || !o.instanceColor) return;
      const c = o.instanceColor.array;
      for (let i = 0; i < o.count; i++) { const l = 0.3 * c[i * 3] + 0.59 * c[i * 3 + 1] + 0.11 * c[i * 3 + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); n++; }
    });
    return { n, lo: Math.round(lo * 100) / 100, hi: Math.round(hi * 100) / 100, mask: !!g.userData.groundMask, push: [q[0].x - p.pos.x, q[0].y - p.pos.z, q[0].z, q[0].w].map((x) => Math.round(x * 100) / 100), rest: q.slice(1).map((x) => x.w).join() };
  });
  check('草と地面（v0.76.0・v0.77.0）: 野営地の草は、場所ごとに明るさが違い（陰の中は暗い）、草の素材へ狩人の位置が渡る（半径 0.85m。野営地に大型は居ない）',
    turf.mask && turf.n > 100 && turf.lo < 0.75 && turf.hi > 0.95 && Math.hypot(turf.push[0], turf.push[1]) < 0.6 && turf.push[2] === 0.85 && turf.push[3] === 1 && turf.rest === '0,0,0', JSON.stringify(turf));
  // 前へ歩く（東の出口へ向いて始まる）。出口に入ると、エリア 1 へ移る
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  const hint = await untilSim(page, () => !document.querySelector('.hud-exit').hidden, 900);
  const hintText = await page.evaluate(() => document.querySelector('.hud-exit').textContent);
  const moved = await until(page, () => window.__vh.sim.areaId === 'a1', 20000);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  f = await hudField();
  // 着く場所は、データの arrive（v0.20.0 から、エリアは自然な形で、出口の位置はデータで決まる）
  const arrive1 = await page.evaluate(() => window.__vh.sim.field.areas.find((a) => a.id === 'camp').exits.find((e) => e.to === 'a1').arrive);
  check('フィールド: 出口へ近づくと「この先」の案内が出て、入るとエリア 1 へ移る（名前が出て、現在地の印が移る）', hint && /この先: エリア 1（礫の坂）/.test(hintText) && moved && f.here === '1' && /^エリア 1 礫の坂/.test(f.where) && /エリア 1礫の坂/.test(f.banner) && Math.abs(f.x - arrive1.x) < 3, `${hintText} / ${JSON.stringify(f)}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}82_field_area1.png` });
  // エリア 3 へ（出口の上へ置く）。同じエリアに入ると、標的が見える
  await page.evaluate(() => {
    const s = window.__vh.sim;
    const e = s.area().exits.find((x) => x.to === 'a3');
    s.player.pos = { x: e.x, y: 0, z: e.z };
    s.player.prevPos = { ...s.player.pos };
  });
  await until(page, () => window.__vh.sim.areaId === 'a3');
  await page.waitForTimeout(300);
  f = await hudField();
  check('フィールド: エリア 3 に入ると、標的が描かれ、地図と文字に出る（着く場所は、これまでの狩場の出発地点）', f.area === 'a3' && f.rigVisible === true && Math.abs(f.x) < 0.5 && Math.abs(f.z + 20) < 1.5 && f.here === '3' && f.mark === '3' && /標的: エリア 3/.test(f.where), JSON.stringify(f));
  await page.screenshot({ path: `${OUT}83_field_area3.png` });
  const loc3 = await page.evaluate(() => {
    const lab = Object.fromEntries([...document.querySelectorAll('.hud-local .exit-label')].map((t) => [t.textContent, { x: +t.getAttribute('x'), y: +t.getAttribute('y') }]));
    return { lab, tgt: getComputedStyle(document.querySelector('.hud-local .tgt')).display };
  });
  check('地図（v0.42.0）: エリア 3 の地図は、北（7）が上・南（1）が下、+X（6）が左・-X（2）が右。標的は同じエリアに居るので点が出る', !!loc3.lab['7'] && !!loc3.lab['1'] && !!loc3.lab['6'] && !!loc3.lab['2'] && loc3.lab['7'].y < loc3.lab['1'].y && loc3.lab['6'].x < loc3.lab['2'].x && loc3.tgt !== 'none', JSON.stringify(loc3));
  // 北を向いて画面の右へ歩くと、地図の自分の印も右へ動く（地図と画面の左右が同じ。v0.41.0 までは鏡写しだった）
  const meAt = () => page.evaluate(() => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d]+)\)/.exec(document.querySelector('.hud-local .me').getAttribute('transform') ?? '');
    return m ? [+m[1], +m[2], +m[3]] : null;
  });
  await page.evaluate(() => { const v = window.__vh, p = v.sim.player; p.yaw = 0; p.prevYaw = 0; v.view.cam.snap(0); });
  await page.waitForTimeout(250);
  const me0 = await meAt();
  await holdSim(page, 'KeyD', 72);
  await page.waitForTimeout(250);
  const me1 = await meAt();
  check('地図（v0.42.0）: 北を向くと矢じりは上（0°）。画面の右へ歩くと、地図の自分の印も右へ動き、矢じりは右（90°）を向く', !!me0 && !!me1 && me0[2] === 0 && me1[0] > me0[0] + 1 && Math.abs(me1[1] - me0[1]) < Math.abs(me1[0] - me0[0]) && Math.abs(me1[2] - 90) <= 20, JSON.stringify({ me0, me1 }));
  // 標識玉（v0.42.0。#19 の F04）: 標的の正面 8m で、納刀して投げる。当たると、別のエリアへ移っても居場所が地図に出る。投げた後は、元の場所へ戻る
  const before = await page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    const keep = { pos: { ...p.pos }, yaw: p.yaw };
    m.aiEnabled = false;
    m.action = null;
    const c = s.world.centerOf(s.world.areaAt(m.pos.x, m.pos.z));
    const d = Math.hypot(c.x - m.pos.x, c.z - m.pos.z);
    const ux = d > 1 ? (c.x - m.pos.x) / d : 1, uz = d > 1 ? (c.z - m.pos.z) / d : 0;
    const r = 8 + m.def.bodyRadius;
    const x = m.pos.x + ux * r, z = m.pos.z + uz * r;
    p.pos = { x, y: s.world.groundHeight(x, z), z };
    p.prevPos = { ...p.pos };
    p.yaw = Math.atan2(m.pos.x - x, m.pos.z - z);
    p.prevYaw = p.yaw;
    p.mode = 'free';
    p.action = null;
    p.hurt = null;
    p.guard = null;
    p.drawn = false;
    p.itemIndex = p.items.findIndex((it) => it.itemId === 'item.marker_orb');
    v.view.cam.snap(p.yaw);
    return keep;
  });
  await page.keyboard.press('KeyE');
  // 待つ長さはゲームの中の tick で数える（手元の描画が遅い時にも、投げ終わるまで待つ。投げる動き 46 tick + 玉が飛ぶ間）。知らせは当たった時に読む
  let orbToast = '';
  const orbHit = await untilSim(page, () => {
    const t = document.getElementById('toasts').textContent;
    if (/標識玉が当たった/.test(t)) window.__orbToast = t;
    return window.__vh.sim.monsters[0].markTicks > 0 && window.__vh.sim.player.mode === 'free' && !window.__vh.sim.player.action;
  }, 400);
  orbToast = await page.evaluate(() => window.__orbToast ?? document.getElementById('toasts').textContent);
  const orbLeft = await page.evaluate(() => window.__vh.sim.player.items.find((it) => it.itemId === 'item.marker_orb')?.count);
  check('標識玉（v0.42.0）: 標的の正面で投げると当たり、1 個減る（支給 2）。「地図に居場所が出る」と知らせる', orbHit && orbLeft === 1 && /標識玉が当たった（5 分ほど、地図に居場所が出る）/.test(orbToast), `${orbLeft} / ${orbToast}`);
  await page.evaluate((keep) => {
    const v = window.__vh, s = v.sim, p = s.player;
    s.monsters[0].aiEnabled = true;
    p.pos = { ...keep.pos };
    p.prevPos = { ...p.pos };
    p.yaw = keep.yaw;
    p.prevYaw = p.yaw;
    v.view.cam.snap(p.yaw);
  }, before);
  // 依頼 10 の岩と崖（v0.22.0）: エリア 3 の岩は図から作った形、外周は崖の図を並べたもの（出口のわきは C-19・C-20）。図集と岩肌が読めている
  const art10 = await until(page, () => {
    const v = window.__vh.view;
    let rocks = [], cliffs = [], cliffOn = false, rockOn = false;
    for (const g of v.areaGroups.values()) {
      if (!g.visible) continue;
      g.traverse((o) => {
        if (o.userData.rockArt) {
          rocks = rocks.concat(o.userData.rockArt);
          rockOn = o.material.userData.art?.artOn.value === 1 && o.material.userData.art?.detailOn.value === 1;
        }
        if (o.userData.cliffArt) {
          cliffs = cliffs.concat(o.userData.cliffArt);
          cliffOn = o.material.visible && !!o.material.map && o.material.userData.art?.detailOn.value === 1;
        }
      });
    }
    window.__art10 = { rocks: rocks.length, cliffs: cliffs.length, kinds: new Set(cliffs).size, exitPieces: cliffs.filter((id) => id === 'C-19' || id === 'C-20').length, exits: window.__vh.sim.area().exits.length, rockOn, cliffOn, area: window.__vh.sim.area().rocks.length };
    return rockOn && cliffOn;
  }, 15000).then(() => page.evaluate(() => ({ ...window.__art10, ...window.__vh.view.stats() })));
  check('岩と崖（v0.22.0）: エリア 3 の岩は依頼 10 の岩の図から作り（データの岩の数だけ）、外周は崖の図を並べる（出口ごとに C-19・C-20）。図集と岩肌が読めている。描画量は目標内',
    art10.rockOn && art10.cliffOn && art10.rocks === art10.area && art10.rocks >= 1 && art10.cliffs >= 6 && art10.kinds >= 4 && art10.exitPieces === art10.exits * 2 && art10.calls <= 100 && art10.triangles <= 200000, JSON.stringify(art10));
  // 標的の移動と休息: 弱らせて、巣で眠るまで simulation を先へ進める（検査用。画面の時間は待たない）
  const slept = await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    m.hp = Math.round(m.def.hp * 0.2);
    const idle = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };
    const seen = [];
    for (let i = 0; i < 60 * 60 * 5 && !m.asleep; i++) {
      s.step(idle);
      for (const e of s.drainEvents()) if (e.type === 'monster_move' || e.type === 'monster_sleep' || e.type === 'monster_leave') seen.push(`${e.type}:${e.areaId ?? e.to}`);
    }
    return { asleep: m.asleep, area: s.monsterArea(m)?.id, seen, markTicks: m.markTicks };
  });
  await page.waitForTimeout(300);
  await nextFrames(page);
  f = await hudField();
  // 印がある間は、移った先（エリア 10）が地図と文字に出る。眠っていることは、見ていないので出ない（v0.42.0）
  check('フィールド: 弱った標的は、エリアを渡って巣（エリア 10）へ行き、眠る。標識玉の印で、居場所が地図と文字に出る（眠りは、見ていないので出ない）', slept.asleep && slept.area === 'a10' && slept.seen[0]?.startsWith('monster_leave') && slept.seen.at(-1) === 'monster_sleep:a10' && f.mark === '10' && f.marked === '10' && f.sleepMark === '' && /標的: エリア 10（印）/.test(f.where) && f.rigVisible === false, `${slept.seen.join(' ')} / ${slept.markTicks} / ${f.where}`);
  await page.screenshot({ path: `${OUT}83b_field_marked.png` });
  // 全体の地図（v0.51.0）: 印のある間は、巣（エリア 10）に標的の点（印の色）。眠りは見ていないので出ない
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(250);
  await nextFrames(page);
  const fmMark = await fieldMap();
  await page.keyboard.press('KeyM');
  check('全体の地図（v0.51.0）: 印のある標的は、居るエリア（10）の中に点で出る（印の色）。眠りは出ない', fmMark.open && fmMark.target === 'a10' && fmMark.marked === 'a10' && fmMark.asleep === '' && fmMark.tgt !== 'none' && fmMark.tgtMarked && fmMark.tgtIn10, JSON.stringify(fmMark));
  // 印が切れると、最後に見た所（エリア 3。点線と ?）に戻り、いまの居場所は分からない
  await page.evaluate(() => { window.__vh.sim.monsters[0].markTicks = 0; });
  const lost = await until(page, () => document.querySelectorAll('.hud-map .cell.seen').length === 1, 4000);
  f = await hudField();
  check('フィールド: 印が切れると、地図は最後に見た所（エリア 3）だけになり、「標的: 不明（最後に見た所 エリア 3）」', lost && f.mark === '' && f.seen === '3' && f.sleepMark === '' && /標的: 不明（最後に見た所 エリア 3）/.test(f.where), JSON.stringify(f));
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(250);
  await nextFrames(page);
  const fmLost = await fieldMap();
  await page.keyboard.press('KeyM');
  check('全体の地図（v0.51.0）: 印が切れると、点は消え、最後に見た所（エリア 3）に「3?」', fmLost.open && fmLost.tgt === 'none' && fmLost.target === '' && fmLost.seen === '3?', JSON.stringify(fmLost));
  // 巣へ行って、眠っている標的を見る → 攻撃すると起きる
  await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    const e = s.field.areas.find((a) => a.id === 'a6').exits.find((x) => x.to === 'a10');
    s.player.pos = { x: e.x, y: 0, z: e.z };
    s.player.prevPos = { ...s.player.pos };
    void m;
  });
  await until(page, () => window.__vh.sim.areaId === 'a10');
  await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    s.player.pos = { x: m.pos.x - 6, y: 0, z: m.pos.z - 5 };
    s.player.prevPos = { ...s.player.pos };
    s.player.yaw = Math.atan2(6, 5);
    window.__vh.view.cam.snap(s.player.yaw);
  });
  await page.waitForTimeout(1200);
  f = await hudField();
  check('フィールド: 巣では、眠っている標的が描かれる（気づかれていない）', f.area === 'a10' && f.rigVisible === true && f.asleep === true && await page.evaluate(() => window.__vh.sim.monsters[0].aware === false), JSON.stringify(f));
  await page.screenshot({ path: `${OUT}84_field_nest_sleep.png` });
  const woke = await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0];
    // 頭の正面へ寄って、抜刀して斬る代わりに、当たり判定を通さず、ダメージの入口を直接呼ぶ検査は自動テストにある。ここでは実際に斬る
    s.player.pos = { x: m.pos.x + Math.sin(m.yaw) * 3.4, y: 0, z: m.pos.z + Math.cos(m.yaw) * 3.4 };
    s.player.prevPos = { ...s.player.pos };
    s.player.yaw = m.yaw + Math.PI;
    window.__vh.view.cam.snap(s.player.yaw);
    return { hp: m.hp };
  });
  await page.waitForTimeout(200);
  await click(page);
  await idle(page);
  await click(page);
  const awake = await until(page, () => window.__vh.sim.monsters[0].asleep === false && window.__vh.sim.monsters[0].aware === true, 8000);
  check('フィールド: 眠っている標的を斬ると、起きて気づく', awake && await page.evaluate((hp) => window.__vh.sim.monsters[0].hp < hp, woke.hp), JSON.stringify(await hudField()));
  await page.screenshot({ path: `${OUT}85_field_nest_wake.png` });
  // 力尽きると、野営地へ戻る
  await page.evaluate(() => {
    const s = window.__vh.sim;
    s.player.hp = 1;
  });
  const fainted = await until(page, () => window.__vh.sim.hunt.faints >= 1 && window.__vh.sim.areaId === 'camp' && window.__vh.sim.player.mode !== 'dead', 60000);
  f = await hudField();
  check('フィールド: 力尽きると野営地へ戻り、標的は巣に残る', fainted && f.here === '営' && f.target === 'a10', JSON.stringify(f));
  await ctx.close();
}

// ---- 地面の起伏（v0.46.0。#19 の F02）: エリア 6 の外周寄りの坂を上る。描いた地面と当たりの高さが同じ ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
  await until(page, () => window.__vh.sim.tick > 5 && !!window.__vh.sim.field);
  // エリア 6 の歩ける所でいちばん高い格子の点の 12m 手前（中心の側）に立ち、そちらを向く（標的は止めておく）
  const goal = await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, a = s.field.areas.find((x) => x.id === 'a6'), r = a.relief;
    let best = -1;
    for (let k = 0; k < r.h.length; k++) {
      const x = r.x0 + (k % r.nx) * r.step, z = r.z0 + Math.floor(k / r.nx) * r.step;
      if (s.world.inArea(a, x, z, 2.5) && (best < 0 || r.h[k] > r.h[best])) best = k;
    }
    const tx = r.x0 + (best % r.nx) * r.step, tz = r.z0 + Math.floor(best / r.nx) * r.step;
    const d = Math.hypot(tx - a.center.x, tz - a.center.z), ux = (tx - a.center.x) / d, uz = (tz - a.center.z) / d;
    const sx = tx - ux * 12, sz = tz - uz * 12;
    p.pos = { x: sx, y: s.world.groundHeight(sx, sz), z: sz };
    p.prevPos = { ...p.pos };
    p.yaw = Math.atan2(ux, uz);
    p.prevYaw = p.yaw;
    s.areaId = 'a6';
    for (const m of s.monsters) m.aiEnabled = false;
    v.view.cam.snap(p.yaw);
    return { tx, tz, top: r.h[best] / 100, start: p.pos.y };
  });
  await until(page, () => window.__vh.view.areaGroups.get('a6')?.visible === true, 30000);
  // 描いた地面の板の頂点の高さ = simulation の地面の高さ（段の無い所。外周の内）。起伏は 1.5m より高い所がある
  const mesh = await page.evaluate(() => {
    const s = window.__vh.sim, a = s.field.areas.find((x) => x.id === 'a6'), b = a.bounds;
    let maxY = -1, n = 0, worst = 0, cnt = 0;
    window.__vh.view.areaGroups.get('a6').traverse((o) => {
      if (!o.userData.ground) return;
      n++;
      const pos = o.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
        maxY = Math.max(maxY, y);
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (a.platforms.some((q) => x > q.minX - 0.1 && x < q.maxX + 0.1 && z > q.minZ - 0.1 && z < q.maxZ + 0.1)) continue;
        worst = Math.max(worst, Math.abs(y - s.world.groundHeight(x, z)));
        cnt++;
      }
    });
    return { n, maxY, worst, cnt };
  });
  // W で坂を上る（ゲームの中で 3 秒）: 足は地面に付いたまま、高い所へ上がる
  await holdSim(page, 'KeyW', 180);
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => { const s = window.__vh.sim, p = s.player; return { y: p.pos.y, g: s.world.groundHeight(p.pos.x, p.pos.z), grounded: p.grounded }; });
  await page.screenshot({ path: `${OUT}86b_relief.png` });
  check('地面の起伏（v0.46.0）: エリア 6 の描いた地面の高さは simulation の地面の高さと同じ（頂点ごと）。坂を歩いて上ると、足は地面に付いたまま高い所へ着く', mesh.n === 1 && mesh.cnt > 500 && mesh.worst < 1e-3 && mesh.maxY > 1.5 && goal.top > 1.5 && up.y > goal.start + 0.5 && Math.abs(up.y - up.g) < 1e-6 && up.grounded, JSON.stringify({ goal, mesh, up }));
  await ctx.close();
}

// ---- 護刃の連係（v0.53.0。#19 の H03）: 斬り下ろし → 横斬り → 斬り返し → 回転斬り、構えからの横斬り、ガード斬り。新しい動きが描けて（欠けた clip が無い）、回転斬りで体が回る ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.guard_blade.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.guard_blade.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0];
    m.aiEnabled = false;
    v.clock.advance = () => 0;
  });
  // simulation を決まった入力で進め、技の途中で 1 枚描かせる（描く側が clip を知らなければ、欠けた clip に入る）
  const reach = (name, tick) => page.evaluate(([name, tick]) => {
    const s = window.__vh.sim, p = s.player, m = s.monsters[0];
    p.mode = 'free'; p.action = null; p.guard = null; p.drawn = true;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.2 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
    const idle = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };
    for (let i = 0; i < 20; i++) { s.step(idle); s.drainEvents(); }
    const target = `player.guard_blade.${name === 'guard_bash' ? 'bash' : name}`, seen = [];
    if (name === 'guard_slash' || name === 'guard_bash') {
      const b = name === 'guard_bash' ? 2 : 1;
      for (let k = 0; k < 10; k++) { s.step({ ...idle, held: 8, pressed: k === 0 ? 8 : 0 }); s.drainEvents(); }
      s.step({ ...idle, held: 8 | b, pressed: b });
      for (const e of s.drainEvents()) if (e.type === 'action_start') seen.push(e.actionId);
      for (let i = 0; i < 100 && p.action?.def.actionId === target && p.action.tick < tick; i++) { s.step({ ...idle, held: 8 }); s.drainEvents(); }
    } else {
      const at = { side: [[0, 2]], round: [[0, 1], [15, 1], [29, 1], [44, 1]], return: [[0, 1], [15, 1], [29, 1]], jump: [[0, 3]] }[name];
      for (let i = 0; i < 300; i++) {
        const b = at.find(([t]) => t === i)?.[1] ?? 0;
        s.step({ ...idle, held: b, pressed: b });
        for (const e of s.drainEvents()) if (e.type === 'action_start') seen.push(e.actionId);
        if (p.action?.def.actionId === target && p.action.tick >= tick) break;
      }
    }
    return { now: p.action?.def.actionId ?? null, tick: p.action?.tick ?? null, yaw: p.yaw, seen };
  }, [name, tick]);
  const frames = async () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r([...window.__vh.view.missingClips])))));
  const side = await reach('side', 11);
  const m1 = await frames();
  const ret = await reach('return', 11);
  const m2 = await frames();
  const round = await reach('round', 26);
  const m3 = await frames();
  await page.screenshot({ path: `${OUT}85c_guard_blade_round.png` });
  const gs = await reach('guard_slash', 10);
  const m4 = await frames();
  check('護刃（v0.53.0）: 構えからの副で横斬り、主の連係は 斬り下ろし → 横斬り → 斬り返し → 回転斬り（回転斬りの途中は体が後ろを向く）、防御から主でガード斬り。新しい動きはどれも描ける（欠けた clip が無い）',
    side.now === 'player.guard_blade.side' && ret.seen.join() === 'player.guard_blade.slash1,player.guard_blade.slash2,player.guard_blade.return' && round.now === 'player.guard_blade.round' && Math.abs(Math.abs(round.yaw) - Math.PI) < 0.3
      && gs.now === 'player.guard_blade.guard_slash' && [...m1, ...m2, ...m3, ...m4].length === 0,
    JSON.stringify({ side, ret, round, gs, missing: [...m1, ...m2, ...m3, ...m4] }));
  // v0.63.0（2G）: 主と副の同時押しで跳び斬り（ボタンは「跳び斬り」）、防御から副で盾打ち
  const jump = await reach('jump', 14);
  const m5 = await frames();
  await page.screenshot({ path: `${OUT}85c2_guard_blade_jump.png` });
  const gb = await reach('guard_bash', 12);
  const m6 = await frames();
  const comboLabel = await page.evaluate(() => document.querySelector('.tbtn-combo')?.textContent ?? null);
  check('護刃（v0.63.0。2G）: 主と副の同時押しで跳び斬り（ボタンは「跳び斬り」）、防御を構えたまま副で盾打ち。新しい動きが描ける',
    jump.now === 'player.guard_blade.jump' && gb.now === 'player.guard_blade.bash' && comboLabel === '跳び斬り' && [...m5, ...m6].length === 0,
    JSON.stringify({ jump, gb, comboLabel, missing: [...m5, ...m6] }));
  await ctx.close();
}

// ---- 双剣の猛り（v0.54.0。#19 の H03）: 副で回転斬り（体が後ろを向く）、固有で猛りに入る（印・スタミナの棒の色・ボタンの表示名が替わる）、
// 猛りの間の同時押しで連ね斬り、固有でもう 1 度押すと解ける。新しい動きはどれも描ける（欠けた clip が無い）----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.twin_blades.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.twin_blades.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    v.clock.advance = () => 0;
    p.mode = 'free'; p.action = null; p.drawn = true;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.0 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  });
  // simulation を決まった入力で進める（presses は [tick, ボタン]）。stopAt の技がその tick まで進んだら止める
  const step = (presses, n, stopAt) => page.evaluate(([presses, n, stopAt]) => {
    const s = window.__vh.sim, p = s.player;
    const idle = { moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 };
    const seen = [], ev = [];
    for (let i = 0; i < n; i++) {
      const b = presses.find(([t]) => t === i)?.[1] ?? 0;
      s.step({ ...idle, held: b, pressed: b });
      for (const e of s.drainEvents()) {
        if (e.type === 'action_start') seen.push(e.actionId.replace('player.twin_blades.', ''));
        if (e.type === 'demon') ev.push(`${e.on}:${e.reason}`);
      }
      if (stopAt && p.action?.def.actionId === `player.twin_blades.${stopAt[0]}` && p.action.tick >= stopAt[1]) break;
    }
    return { now: p.action?.def.actionId.replace('player.twin_blades.', '') ?? null, yaw: Math.round(p.yaw * 100) / 100, demon: p.demon, stamina: Math.round(p.stamina * 10) / 10, seen, ev };
  }, [presses, n, stopAt]);
  const frames = async () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({
    missing: [...window.__vh.view.missingClips],
    mark: !document.querySelector('#hud .hud-demon').hidden,
    bar: document.querySelector('#hud .bar-st').classList.contains('demon'),
    special: document.querySelector('.tbtn-special')?.textContent ?? null,
    combo: document.querySelector('.tbtn-combo')?.textContent ?? null,
  })))));
  const round = await step([[0, 2]], 80, ['round', 27]);
  const f1 = await frames();
  await page.screenshot({ path: `${OUT}85d_twin_blades_round.png` });
  await step([], 40);
  const on = await step([[0, 8]], 60, ['demon_on', 18]);
  const f2 = await frames();
  await page.screenshot({ path: `${OUT}85e_twin_blades_demon.png` });
  await step([], 20);
  const fl = await step([[0, 3]], 80, ['flurry', 40]);
  const f3 = await frames();
  await step([], 60);
  const off = await step([[0, 8]], 30, ['demon_off', 8]);
  const f4 = await frames();
  check('双剣（v0.54.0）: 副で回転斬り（途中で体が後ろを向く）。固有で猛りに入ると、印が出てスタミナの棒の色が変わり、ボタンは「解く」「連ね斬り」になる。猛りの間の同時押しで連ね斬り、固有でもう 1 度押すと解けて元へ戻る。新しい動きはどれも描ける（欠けた clip が無い）',
    round.now === 'round' && Math.abs(Math.abs(round.yaw) - Math.PI) < 0.3
      && on.now === 'demon_on' && on.demon && on.ev.join() === 'true:toggle' && f2.mark && f2.bar && f2.special === '解く' && f2.combo === '連ね斬り'
      && fl.now === 'flurry' && fl.demon && fl.stamina < 100
      && off.now === 'demon_off' && !off.demon && off.ev.join() === 'false:toggle' && !f4.mark && !f4.bar && f4.special === '猛り' && f4.combo === '斬り払い'
      && !f1.mark && [...f1.missing, ...f2.missing, ...f3.missing, ...f4.missing].length === 0,
    JSON.stringify({ round, on, fl, off, f1, f2, f3, f4 }));
  // v0.63.0（2G）: 猛りの外の同時押しは斬り払い（突き込みから替えた）
  await step([], 30);
  const sw = await step([[0, 3]], 60, ['sweep', 16]);
  const f5 = await frames();
  await page.screenshot({ path: `${OUT}85e2_twin_blades_sweep.png` });
  check('双剣（v0.63.0。2G）: 猛りの外の同時押しで斬り払い（ボタンは「斬り払い」）。新しい動きが描ける',
    sw.now === 'sweep' && sw.seen.join() === 'sweep' && !sw.demon && f5.combo === '斬り払い' && f5.missing.length === 0,
    JSON.stringify({ sw, f5 }));
  await ctx.close();
}

// ---- 大槌の溜め（v0.55.0。#19 の H03）: 主の 3 段（叩きつけ → 叩きつけ（二）→ 振り上げ）、固有を押し続けて溜めながら歩き、
// 段階 2 で放すと溜め振り上げ、段階 3 で動きながら放すと回転攻撃（体が後ろを向く）。ボタンの表示名、新しい動きはどれも描ける ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.war_maul.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.war_maul.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    v.clock.advance = () => 0;
    p.mode = 'free'; p.action = null; p.drawn = true;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.2 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  });
  // ticks: tick ごとの [押している, 押した, 左右, 前後]。stopAt の技がその tick まで進んだら止める
  const drive = (ticks, stopAt) => page.evaluate(([ticks, stopAt]) => {
    const s = window.__vh.sim, p = s.player;
    const seen = [];
    for (const [held, pressed, mx, mz] of ticks) {
      s.step({ moveX: mx, moveZ: mz, held, pressed, released: 0 });
      for (const e of s.drainEvents()) if (e.type === 'action_start') seen.push(e.actionId.replace('player.war_maul.', ''));
      if (stopAt && p.action?.def.actionId === `player.war_maul.${stopAt[0]}` && p.action.tick >= stopAt[1]) break;
    }
    return { now: p.action?.def.actionId.replace('player.war_maul.', '') ?? null, yaw: Math.round(p.yaw * 100) / 100, z: Math.round(p.pos.z * 100) / 100, level: p.action?.chargeLevel ?? null, st: Math.round(p.stamina), seen };
  }, [ticks, stopAt]);
  const T = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const frames = async () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({
    missing: [...window.__vh.view.missingClips],
    special: document.querySelector('.tbtn-special')?.textContent ?? null,
    sub: document.querySelector('.tbtn-sub')?.textContent ?? null,
  })))));
  const chain = await drive(T(200, (i) => (i % 10 === 0 ? [1, 1, 0, 0] : [0, 0, 0, 0])), ['upswing', 14]);
  const f1 = await frames();
  await page.screenshot({ path: `${OUT}85f_war_maul_upswing.png` });
  await drive(T(60, () => [0, 0, 0, 0]));
  const z0 = await page.evaluate(() => window.__vh.sim.player.pos.z);
  const walk = await drive(T(80, (i) => [8, i === 0 ? 8 : 0, 0, i > 12 ? 1 : 0]));
  const f2 = await frames();
  await page.screenshot({ path: `${OUT}85g_war_maul_charge_walk.png` });
  const up = await drive(T(30, () => [0, 0, 0, 0]), ['charge_upswing', 12]);
  await drive(T(80, () => [0, 0, 0, 0]));
  const spin = await drive([...T(118, (i) => [8, i === 0 ? 8 : 0, i > 115 ? 1 : 0, 0]), ...T(60, (i) => [0, 0, i < 2 ? 1 : 0, 0])], ['spin', 29]);
  const f3 = await frames();
  await page.screenshot({ path: `${OUT}85h_war_maul_spin.png` });
  check('大槌（v0.55.0）: 主の連係は 叩きつけ → 叩きつけ（二）→ 振り上げ。固有を押し続けると溜めたまま歩け（スタミナが減る）、段階 2 で放すと溜め振り上げ、段階 3 で動きながら放すと回転攻撃（途中で体が後ろを向く）。ボタンは「溜め」「横殴り」。新しい動きはどれも描ける',
    chain.seen.join() === 'smash,smash2,upswing' && chain.now === 'upswing'
      && walk.now === 'charge' && walk.level === 2 && walk.z - z0 > 0.8 && walk.st < 100
      && up.now === 'charge_upswing' && spin.now === 'spin' && Math.abs(Math.abs(spin.yaw) - Math.PI) < 0.3
      && f1.special === '溜め' && f1.sub === '横殴り' && [...f1.missing, ...f2.missing, ...f3.missing].length === 0,
    JSON.stringify({ chain, walk: { ...walk, z0 }, up, spin, f1, f2, f3 }));
  // v0.62.0（2G のハンマー）: 回っている間に主を押すと締めが替わる（1 回転目 = かち上げ、2 回転目 = 叩きつけ）。抜刀攻撃は振り上げ
  const reset = (drawn) => page.evaluate((drawn) => {
    const s = window.__vh.sim, m = s.monsters[0], p = s.player;
    p.mode = 'free'; p.action = null; p.drawn = drawn; p.stamina = 100;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.2 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  }, drawn);
  const spinThen = async (at, stopAt) => {
    await drive(T(170, () => [0, 0, 0, 0]));
    await reset(true);
    return drive([...T(118, (i) => [8, i === 0 ? 8 : 0, i > 115 ? 1 : 0, 0]), ...T(100, (i) => [i === at ? 1 : 0, i === at ? 1 : 0, i < 2 ? 1 : 0, 0])], stopAt);
  };
  const spinUp = await spinThen(30, ['spin_up', 16]);
  const f4 = await frames();
  const spinSlam = await spinThen(62, ['spin_slam', 28]);
  const f5 = await frames();
  await drive(T(120, () => [0, 0, 0, 0]));
  await reset(false);
  const drawUp = await drive(T(60, (i) => (i === 0 ? [1, 1, 0, 0] : [0, 0, 0, 0])), ['draw_upswing', 40]);
  const f6 = await frames();
  check('大槌（v0.62.0。2G）: 回転攻撃の 1 回転目に主でかち上げ、2 回転目に主で叩きつけて締める。納刀中の主は抜刀の振り上げ。新しい動きはどれも描ける',
    spinUp.seen.join() === 'charge,spin,spin_up' && spinUp.now === 'spin_up' && spinSlam.seen.join() === 'charge,spin,spin_slam' && spinSlam.now === 'spin_slam'
      && drawUp.seen.join() === 'draw_upswing' && drawUp.now === 'draw_upswing' && [...f4.missing, ...f5.missing, ...f6.missing].length === 0,
    JSON.stringify({ spinUp, spinSlam, drawUp, f4, f5, f6 }));
  await ctx.close();
}

// ---- 太刀の気と気合い斬り（v0.56.0。#19 の H03）: 当てると「気」の棒が伸び、満ちると光る。固有で 気合い斬り 一 → 二 → 三（v0.62.0 から三で終わる）。
// ボタンの表示名、新しい動きはどれも描ける。v0.62.0: 主は 縦斬り → 突き → 斬り上げ、気合い斬りの間に突き・斬り上げを挟める ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.long_blade.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.long_blade.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    v.clock.advance = () => 0;
    p.mode = 'free'; p.action = null; p.drawn = true;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.3 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  });
  const drive = (ticks, stopAt) => page.evaluate(([ticks, stopAt]) => {
    const s = window.__vh.sim, p = s.player;
    const seen = [];
    for (const [held, pressed] of ticks) {
      s.step({ moveX: 0, moveZ: 0, held, pressed, released: 0 });
      for (const e of s.drainEvents()) if (e.type === 'action_start') seen.push(e.actionId.replace('player.long_blade.', ''));
      if (stopAt && p.action?.def.actionId === `player.long_blade.${stopAt[0]}` && p.action.tick >= stopAt[1]) break;
    }
    return { now: p.action?.def.actionId.replace('player.long_blade.', '') ?? null, yaw: Math.round(p.yaw * 100) / 100, spirit: Math.round(p.spirit * 10) / 10, seen };
  }, [ticks, stopAt]);
  const T = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const hud = async () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const box = document.querySelector('#hud .hud-blade .spirit');
    r({
      missing: [...window.__vh.view.missingClips],
      shown: !!box && !box.hidden, label: box?.querySelector('.label')?.textContent ?? '', full: !!box?.classList.contains('full'),
      fill: box?.querySelector('.gauge i')?.style.transform ?? '',
      special: document.querySelector('.tbtn-special')?.textContent ?? null, sub: document.querySelector('.tbtn-sub')?.textContent ?? null, combo: document.querySelector('.tbtn-combo')?.textContent ?? null,
    });
  }))));
  const h0 = await hud();
  const hit = await drive(T(40, (i) => (i === 0 ? [1, 1] : [0, 0])));
  const h1 = await hud();
  await page.evaluate(() => { window.__vh.sim.player.spirit = 100; });
  const h2 = await hud();
  const chain = await drive(T(260, (i) => (i % 10 === 0 ? [8, 8] : [0, 0])), ['spirit3', 30]);
  const h3 = await hud();
  await page.screenshot({ path: `${OUT}85i_long_blade_spirit3.png` });
  check('太刀（v0.56.0）: 「気」の棒が出て、当てると伸び、満ちると光る。固有で 気合い斬り 一 → 二 → 三（v0.62.0 から三で終わる）。ボタンは「突き」「気合い斬り」「下がり斬り」。新しい動きはどれも描ける',
    h0.shown && h0.label === '気' && !h0.full && hit.spirit > 0 && h1.fill !== h0.fill && h2.full && !h1.full
      && chain.seen.join() === 'spirit1,spirit2,spirit3' && chain.now === 'spirit3' && !h3.full
      && h0.sub === '突き' && h0.special === '気合い斬り' && h0.combo === '下がり斬り' && [...h0.missing, ...h3.missing].length === 0,
    JSON.stringify({ h0, hit, h1, h2, chain, h3 }));
  // v0.62.0（2G の太刀）: 主の連打は 縦斬り → 突き → 斬り上げ。気合い斬り 一 → 主（突き）→ 固有（二）→ 主（斬り上げ）→ 固有（三）と挟める
  const reset = () => page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0], p = s.player;
    p.mode = 'free'; p.action = null; p.drawn = true; p.spirit = 100;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 1.3 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  });
  await drive(T(60, () => [0, 0]));
  await reset();
  const mainChain = await drive(T(150, (i) => (i % 8 === 0 ? [1, 1] : [0, 0])), ['rise', 12]);
  const h4 = await hud();
  await drive(T(60, () => [0, 0]));
  await reset();
  // 次のボタンを 6 tick ごとに押し、技が始まったら次のボタンへ
  const weave = await page.evaluate(() => {
    const s = window.__vh.sim, p = s.player, order = [8, 1, 8, 1, 8], seen = [];
    let k = 0;
    for (let i = 0; i < 320 && k <= order.length; i++) {
      const b = i % 6 === 0 && k < order.length ? order[k] : 0;
      s.step({ moveX: 0, moveZ: 0, held: b, pressed: b, released: 0 });
      for (const e of s.drainEvents()) if (e.type === 'action_start') { seen.push(e.actionId.replace('player.long_blade.', '')); k++; }
      if (k === order.length && p.action?.def.actionId === 'player.long_blade.spirit3' && p.action.tick >= 10) break;
    }
    return { seen, now: p.action?.def.actionId.replace('player.long_blade.', '') ?? null };
  });
  const h5 = await hud();
  check('太刀（v0.62.0。2G）: 主の連打は 縦斬り → 突き → 斬り上げ。気合い斬り 一 → 突き → 二 → 斬り上げ → 三 と、間に主の技を挟める。新しい動き（縦斬り）も描ける',
    mainChain.seen.join() === 'vertical,thrust,rise' && weave.seen.join() === 'spirit1,thrust_s1,spirit2,rise_s2,spirit3' && weave.now === 'spirit3'
      && [...h4.missing, ...h5.missing].length === 0,
    JSON.stringify({ mainChain, weave, h4, h5 }));
  await ctx.close();
}

// ---- ハンターの動きの組（v0.57.0。D-150）: いまの組（断岳剣は 2G を手本に作り直した「解く方式」の動き）と、保留の組 v056（v0.56.0 までの動き。
// ?motions=v056）。どちらも断岳剣の 抜刀斬り → 縦斬り → 斬り上げ → 薙ぎ払い が当たり、描けない動きが無い。設定に「ハンターの動き」が出る ----
{
  const COMBO = 1024;
  const run = async (query) => {
    const { ctx, page } = await open({ width: 1280, height: 720 }, false, query);
    await page.click('#boot-start');
    await until(page, () => window.__vh && !document.getElementById('base').hidden);
    await startTraining(page);
    await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
    await page.evaluate(() => {
      const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
      m.aiEnabled = false;
      v.clock.advance = () => 0;
      p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.3 - 2.2 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
    });
    // 主（抜刀斬り）→ 主（縦斬り）→ 同時押し（斬り上げ・低）→ 副（薙ぎ払い）。描画を挟みながら tick を進める
    const seen = [];
    const step = async (pressed, n) => {
      for (let i = 0; i < n; i += 6) {
        const r = await page.evaluate(([pressed, k]) => {
          const s = window.__vh.sim, out = [];
          for (let j = 0; j < k; j++) {
            s.step({ moveX: 0, moveZ: 0, held: j === 0 ? pressed : 0, pressed: j === 0 ? pressed : 0, released: 0 });
            for (const e of s.drainEvents()) if (e.type === 'action_start' && e.actor === 'player') out.push(e.actionId.replace('player.heavy_blade.', ''));
          }
          return out;
        }, [i === 0 ? pressed : 0, Math.min(6, n - i)]);
        seen.push(...r);
        await nextFrames(page);
      }
    };
    const hp0 = await page.evaluate(() => window.__vh.sim.monsters[0].hp);
    await step(1, 66);
    await step(1, 48);
    await step(COMBO, 34);
    await step(2, 40);
    await page.screenshot({ path: `${OUT}86_motion_set_${query.includes('v056') ? 'v056' : '2g'}.png` });
    const out = await page.evaluate((hp0) => ({ set: window.__vh.sim.content.motionSet, missing: [...window.__vh.view.missingClips], dmg: hp0 - window.__vh.sim.monsters[0].hp }), hp0);
    // 設定の「ハンターの動き」
    await page.keyboard.press('Escape');
    await until(page, () => !document.getElementById('menu').hidden);
    await page.evaluate(() => [...document.querySelectorAll('#menu .menu-head .tab')].find((b) => b.textContent === '設定').click());
    const row = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#menu .row')].find((x) => x.querySelector('label')?.textContent.startsWith('ハンターの動き'));
      const sel = r?.querySelector('select');
      return r ? { value: sel?.value, options: [...(sel?.options ?? [])].map((o) => o.value), note: r.querySelector('small')?.textContent ?? '' } : null;
    });
    await ctx.close();
    return { ...out, seen: seen.join(), row };
  };
  const now = await run(ARENA);
  const held = await run(`${ARENA}&motions=v056`);
  check('ハンターの動きの組（v0.57.0）: いまの組と保留の組 v056 のどちらでも、断岳剣の 抜刀斬り → 縦斬り → 斬り上げ → 薙ぎ払い が当たり、描けない動きが無い。設定に「ハンターの動き」（2G / v0.56.0 まで）が出て、いまの組の名前が書いてある',
    now.set === '2g' && held.set === 'v056'
      && now.seen === 'draw_slash,overhead,upswing_low,side_sweep' && held.seen === now.seen && now.dmg > 0 && held.dmg > 0
      && now.missing.length === 0 && held.missing.length === 0
      && now.row?.options.join() === '2g,v056' && now.row.value === '2g' && /いま: 2G の動き/.test(now.row.note) && /いま: v0\.56\.0 までの動き/.test(held.row?.note ?? ''),
    JSON.stringify({ now, held }));
}

// ---- 共通の動き（v0.58.0。D-150）: 回復液・前転・納刀の疾走を 2G を手本に作り直した。保留の組 v056（?motions=v056）では前の形のまま。
// 素材ビューアで、同じ tick の右手の高さ・頭の前後を比べる ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  const probe = async (q) => {
    await page.goto(`http://localhost:${PORT}${BASE}viewer.html${q}`);
    await page.waitForFunction(() => window.__viewer, null, { timeout: 15000 });
    await nextFrames(page);
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const h = window.__viewer.hunter;
      h.root.updateMatrixWorld(true);
      const at = (o) => { const e = o.matrixWorld.elements; return [e[12], e[13], e[14]].map((v) => Math.round(v * 1000) / 1000); };
      return { handR: at(h.sockets.hand_r), head: at(h.joints.head), panel: document.getElementById('panel').textContent.includes('欠落') };
    });
  };
  const drink = await probe('?action=player.item.drink&tick=12');
  const drinkOld = await probe('?action=player.item.drink&tick=12&motions=v056');
  const roll = await probe('?action=player.common.roll&tick=6');
  const rollOld = await probe('?action=player.common.roll&tick=6&motions=v056');
  const sprint = await probe('?tick=75&move=6.4');
  const sprintOld = await probe('?tick=75&move=6.4&motions=v056');
  await page.screenshot({ path: `${OUT}86b_viewer_sprint_v056.png` });
  check('共通の動き（v0.58.0）: 回復液は腰の袋から取り出し（12 tick で右手が腰の高さ）、前転は腰を落として飛び込み、納刀の疾走は前へ倒れる。保留の組 v056 では前の形（同じ tick で違う）。欠落 clip なし',
    drink.handR[1] < 1.05 && drinkOld.handR[1] > drink.handR[1] + 0.15 && Math.abs(roll.head[1] - rollOld.head[1]) > 0.05 && sprint.head[2] > sprintOld.head[2] + 0.03
      && ![drink, drinkOld, roll, rollOld, sprint, sprintOld].some((x) => x.panel),
    JSON.stringify({ drink, drinkOld, roll, rollOld, sprint, sprintOld }));
  await ctx.close();
}

// ---- 長尖槍の突進（v0.59.0。#19 の H03・D-153）: 同時押し（「突進」）で走り続け、同じ標的に何度も当たる。主でフィニッシュ突き。
// 副の上段突きと混ぜて 3 回まで。回避は後ろへの跳び（前へは跳ばない）。受け返しは無い ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.long_lance.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.long_lance.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  const place = (dz) => page.evaluate((dz) => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    v.clock.advance = () => 0;
    p.mode = 'free'; p.action = null; p.guard = null; p.drawn = true; p.stamina = 100;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - dz }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
    return p.pos.z;
  }, dz);
  const drive = (ticks) => page.evaluate((ticks) => {
    const s = window.__vh.sim, p = s.player;
    const seen = [], hit = [];
    for (const [pressed, mx, mz] of ticks) {
      s.step({ moveX: mx ?? 0, moveZ: mz ?? 0, held: pressed, pressed, released: 0 });
      for (const e of s.drainEvents()) {
        if (e.type === 'action_start' && e.actor === 'player') seen.push(e.actionId.replace('player.long_lance.', ''));
        if (e.type === 'hit' && e.attacker === 'player') hit.push(e.actionId.replace('player.long_lance.', ''));
      }
    }
    return { seen, hit, z: Math.round(p.pos.z * 100) / 100, stamina: Math.round(p.stamina), now: p.action?.def.actionId.replace('player.long_lance.', '') ?? p.mode };
  }, ticks);
  const T = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  await place(9);
  const btn = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ combo: document.querySelector('.tbtn-combo')?.textContent ?? null, sub: document.querySelector('.tbtn-sub')?.textContent ?? null })))));
  const run1 = await drive(T(150, (i) => [i === 0 ? 1024 : 0]));
  await nextFrames(page);
  await page.screenshot({ path: `${OUT}86c_lance_charge.png` });
  const run2 = await drive(T(60, (i) => [i === 0 ? 1 : 0]));
  await place(2.4);
  const mix = await drive(T(150, (i) => [i === 0 ? 1 : i === 20 ? 2 : i === 44 ? 1 : i === 64 ? 2 : 0]));
  const hopZ0 = await place(4);
  const hop = await drive(T(30, (i) => [i === 0 ? 4 : 0]));
  hop.back = Math.round((hopZ0 - hop.z) * 100) / 100;
  const missing = await page.evaluate(() => [...window.__vh.view.missingClips]);
  check('長尖槍（v0.59.0）: 同時押し（「突進」）で走り続け、標的に 2 回以上当たり、スタミナを使う。主でフィニッシュ突き。中段・上段は混ぜて 3 回まで。入力なしの回避は後ろへの跳び。新しい動きはどれも描ける',
    btn.combo === '突進' && btn.sub === '上段' && run1.seen.join() === 'charge' && run1.hit.filter((h) => h === 'charge').length >= 2 && run1.stamina < 90
      && run2.seen[0] === 'charge_finish' && mix.seen.join() === 'thrust1,high2,thrust3' && hop.seen.join() === 'hop' && hop.back > 1 && missing.length === 0,
    JSON.stringify({ btn, run1, run2, mix, hop, missing }));
  await ctx.close();
}

// ---- 環弓の 2G の組み立て（v0.60.0。#19 の H03・D-154）: 副で矢を握って斬る → 突く（2 回まで）。主と副の同時押しでビンを付ける
// （持っていなければ知らせだけ）。溜めの段階で射ち方が変わる（里鍛ちは連射型）。入力なしの回避は後ろへ跳ぶ ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.ring_bow.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.ring_bow.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  const place = (dz) => page.evaluate((dz) => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    v.clock.advance = () => 0;
    p.mode = 'free'; p.action = null; p.guard = null; p.drawn = true; p.stamina = 100;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - dz }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
    return p.pos.z;
  }, dz);
  const drive = (ticks) => page.evaluate((ticks) => {
    const s = window.__vh.sim, p = s.player;
    const seen = [], hit = [], shots = [], coat = [];
    for (const [pressed, held] of ticks) {
      s.step({ moveX: 0, moveZ: 0, held: held ?? pressed, pressed, released: 0 });
      for (const e of s.drainEvents()) {
        if (e.type === 'action_start' && e.actor === 'player') seen.push(e.actionId.replace('player.ring_bow.', '').replace('player.common.', ''));
        if (e.type === 'hit' && e.attacker === 'player') hit.push(e.windowId);
        if (e.type === 'shoot') shots.push(`${e.kind ?? '-'}${e.count}${e.coated ? '+' : ''}`);
        if (e.type === 'coating' || e.type === 'coating_empty') coat.push(e.type === 'coating' ? `${e.on ? 'on' : 'off'}:${e.left}` : 'empty');
      }
    }
    return { seen, hit, shots, coat, z: Math.round(p.pos.z * 100) / 100, coating: p.coating };
  }, ticks);
  const T = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  await place(1.0);
  const btn = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ combo: document.querySelector('.tbtn-combo')?.textContent ?? null, sub: document.querySelector('.tbtn-sub')?.textContent ?? null, coat: document.getElementById('hud-coat')?.textContent ?? null })))));
  const melee = await drive(T(100, (i) => [i === 0 || i === 24 || i === 54 ? 2 : 0]));
  await place(8);
  // 訓練場の支給（強撃ビン 10 本）を空にして、持っていない時を見る
  await page.evaluate(() => { window.__vh.sim.player.coatings = []; });
  const empty = await drive(T(50, (i) => [i === 0 ? 1024 : 0]));
  await page.evaluate(() => { window.__vh.sim.player.coatings = [{ itemId: 'item.power_coating', count: 3 }]; });
  const load = await drive(T(50, (i) => [i === 0 ? 1024 : 0]));
  await nextFrames(page);
  const hud = await page.evaluate(() => { const e = document.getElementById('hud-coat'); return { text: e?.textContent ?? null, on: !!e?.classList.contains('on'), hidden: !!e?.hidden }; });
  const shot = await drive(T(240, (i) => [i === 0 ? 1 : 0, i < 140 ? 1 : 0]));
  await nextFrames(page);
  await page.screenshot({ path: `${OUT}86d_bow_coat.png` });
  const z0 = await place(8);
  const step = await drive(T(34, (i) => [i === 0 ? 4 : 0]));
  step.back = Math.round((z0 - step.z) * 100) / 100;
  const missing = await page.evaluate(() => [...window.__vh.view.missingClips]);
  check('環弓（v0.60.0）: 副で斬る → 突く（どちらも当たる）。訓練場では強撃ビン 10 本。ビンが無ければ同時押しは知らせだけ。強撃ビンを付けると HUD に出て、溜めた射撃（連射 4 本）が 1 本使う。入力なしの回避は後ろへ跳ぶ。新しい動きはどれも描ける',
    btn.combo === 'ビン' && btn.sub === '斬る' && btn.coat === 'ビン 10' && melee.seen.join() === 'melee1,melee2' && melee.hit.filter((h) => h === 'melee').length === 2
      && empty.seen.join() === 'coat' && empty.coat.join() === 'empty' && load.coat.join() === 'on:3' && hud.on && !hud.hidden && /強撃 3/.test(hud.text ?? '')
      && shot.shots.join() === 'rapid4+' && shot.hit.filter((h) => h === 'arrow').length >= 3 && step.seen.join() === 'backstep' && step.back > 1.2 && missing.length === 0,
    JSON.stringify({ btn, melee, empty, load, hud, shot, step, missing }));
  await ctx.close();
}

// ---- 手で狙う（v0.61.0。#19 の H05・D-155）: 環弓で抜刀して固有（C）を押している間、カメラが狙いの線の上へ寄り、照準が出る。
// 視点の操作で狙いが動き、simulation の狙い（入力の aimYaw・aimPitch）と同じ。頭を狙って射ると当たり、横へ外すと当たらない ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.locator('.base-weapon[data-weapon="weapon.ring_bow.001"]').click();
  await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.ring_bow.001');
  await startTraining(page);
  await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  await page.evaluate(() => {
    const s = window.__vh.sim, m = s.monsters[0], p = s.player;
    m.aiEnabled = false;
    p.mode = 'free'; p.action = null; p.drawn = true; p.stamina = 100;
    p.pos = { x: m.pos.x, y: 0, z: m.pos.z - 1.75 - 8 }; p.prevPos = { ...p.pos }; p.yaw = 0; p.prevYaw = 0;
  });
  await page.keyboard.down('KeyC');
  const entered = await until(page, () => !!window.__vh.aim && !!window.__vh.sim.player.aim && window.__vh.view.cam.aimBlend > 0.95 && !document.getElementById('hud-aim').hidden, 6000);
  // 視点の操作（矢印キー）で狙いが動く
  const yaw0 = await page.evaluate(() => window.__vh.aim.yaw);
  await page.keyboard.down('ArrowRight');
  const turned = await until(page, (y0) => window.__vh.aim.yaw < y0 - 0.05, 6000, yaw0);
  await page.keyboard.up('ArrowRight');
  // 頭（標的の正面 1.75m・高さ 1.25m）を狙う
  const aimHead = () => page.evaluate(() => {
    const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
    const head = { x: m.pos.x, y: 1.25, z: m.pos.z - 1.75 };
    let yaw = p.yaw, pitch = 0;
    for (let i = 0; i < 3; i++) {
      const e = { x: p.pos.x - Math.cos(yaw) * 0.32, y: p.pos.y + 1.6, z: p.pos.z + Math.sin(yaw) * 0.32 };
      yaw = Math.atan2(head.x - e.x, head.z - e.z);
      pitch = Math.atan2(head.y - e.y, Math.hypot(head.x - e.x, head.z - e.z));
    }
    v.aim.yaw = yaw; v.aim.pitch = pitch;
  });
  await aimHead();
  await until(page, () => document.getElementById('hud-aim').classList.contains('on') && Math.abs(window.__vh.sim.player.aim.yaw - window.__vh.aim.yaw) < 1e-6, 4000);
  const reticle = await page.evaluate(() => { const e = document.getElementById('hud-aim'); return { on: e.classList.contains('on'), good: e.classList.contains('good'), text: e.textContent }; });
  await nextFrames(page);
  await page.screenshot({ path: `${OUT}86e_bow_aim.png` });
  // 射る: 押して溜めの行動が始まるまで待ち、離して、矢が飛び終わるまで待つ（描画が遅くても tick で待つ）
  const shoot = async () => {
    await page.mouse.down();
    await until(page, () => window.__vh.sim.player.action?.def.actionId === 'player.ring_bow.shot', 6000);
    await page.mouse.up();
    await until(page, () => window.__vh.sim.player.mode === 'free' && window.__vh.sim.projectiles.length === 0, 10000);
  };
  const h0 = await page.evaluate(() => window.__vh.sim.hitCount);
  await page.mouse.move(640, 360);
  await shoot();
  const hitHead = await page.evaluate((h) => window.__vh.sim.hitCount > h, h0);
  // 横へ外して射ると当たらない
  await page.evaluate(() => { window.__vh.aim.yaw += 0.7; });
  await until(page, () => Math.abs(window.__vh.sim.player.aim.yaw - window.__vh.aim.yaw) < 1e-6 && !document.getElementById('hud-aim').classList.contains('on'), 4000);
  const h1 = await page.evaluate(() => window.__vh.sim.hitCount);
  await shoot();
  const missed = await page.evaluate((h) => window.__vh.sim.hitCount === h, h1);
  await page.keyboard.up('KeyC');
  const left = await until(page, () => !window.__vh.aim && !window.__vh.sim.player.aim && document.getElementById('hud-aim').hidden && window.__vh.view.cam.aimBlend < 0.05, 6000);
  const special = await page.evaluate(() => document.querySelector('.tbtn-special')?.textContent ?? null);
  check('手で狙う（v0.61.0）: 環弓で固有（C）を押している間、カメラが狙いの線の上へ寄り照準が出る。矢印キーで狙いが動き、simulation も同じ狙い。頭を狙うと当たり、横へ外すと当たらない。離すと戻る',
    entered && turned && reticle.on && hitHead && missed && left && special === '狙う', JSON.stringify({ entered, turned, reticle, hitHead, missed, left, special }));
  await ctx.close();
  // タッチ: 「狙う」は押すたびに切り替える（押し続けなくてよい）。狙っている間は「狙い中」
  {
    const { ctx, page } = await open({ width: 844, height: 390 }, true);
    await page.tap('#boot-start');
    await until(page, () => window.__vh && !document.getElementById('base').hidden);
    await page.locator('.base-weapon[data-weapon="weapon.ring_bow.001"]').tap();
    await until(page, (id) => window.__vh.weaponId === id && !document.getElementById('base').classList.contains('busy'), 6000, 'weapon.ring_bow.001');
    await startTraining(page);
    await until(page, () => window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
    await page.evaluate(() => { const s = window.__vh.sim; s.monsters[0].aiEnabled = false; s.player.drawn = true; s.player.mode = 'free'; s.player.action = null; });
    await page.tap('.tbtn-special');
    const on = await until(page, () => !!window.__vh.aim && !!window.__vh.sim.player.aim && document.querySelector('.tbtn-special')?.textContent === '狙い中', 6000);
    await page.waitForTimeout(500);
    const stays = await page.evaluate(() => !!window.__vh.aim && !!window.__vh.sim.player.aim);
    await page.tap('.tbtn-special');
    const off = await until(page, () => !window.__vh.aim && !window.__vh.sim.player.aim && document.querySelector('.tbtn-special')?.textContent === '狙う', 6000);
    check('手で狙う（v0.61.0。タッチ）: 「狙う」を押すと狙いに入り、指を離しても狙ったまま（「狙い中」）。もう 1 度押すと戻る', on && stays && off, JSON.stringify({ on, stays, off }));
    await ctx.close();
  }
}

// ---- 弱った足取り（v0.52.0。#19 の M05）: 弱って巣へ向かう大型が歩くと、一歩ごとに体が片側へ傾き、頭が下がる。弱っていなければ傾かない ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
  await until(page, () => window.__vh.sim.tick > 5 && !!window.__vh.sim.field);
  // エリア 3 の標的の横 14m に立つ（標的は止めて、検査が手で前へ動かす）
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, m = s.monsters[0];
    m.aiEnabled = false;
    m.action = null;
    const c = s.world.centerOf(s.field.areas.find((a) => a.id === 'a3'));
    m.pos = { x: c.x - 10, y: s.world.groundHeight(c.x - 10, c.z), z: c.z };
    m.prevPos = { ...m.pos };
    m.yaw = Math.PI / 2;
    m.prevYaw = m.yaw;
    p.pos = { x: c.x, y: s.world.groundHeight(c.x, c.z - 14), z: c.z - 14 };
    p.prevPos = { ...p.pos };
    p.yaw = 0;
    s.areaId = 'a3';
    v.view.cam.snap(0);
  });
  await until(page, () => window.__vh.view.areaGroups.get('a3')?.visible === true, 30000);
  // 標的を +X へ 0.12m ずつ動かして、体の左右の傾き（root の z）を集める
  const sway = async (limping) => {
    await page.evaluate((l) => { window.__vh.sim.monsters[0].roam.limping = l; }, limping);
    const zs = [];
    for (let i = 0; i < 40; i++) {
      zs.push(await page.evaluate(() => {
        const v = window.__vh, s = v.sim, m = s.monsters[0];
        m.prevPos = { ...m.pos };
        m.pos = { x: m.pos.x + 0.12, y: m.pos.y, z: m.pos.z };
        return v.view.rigs.get(m.id)?.rig.root.rotation.z ?? NaN;
      }));
      // 1 歩ぶんの動きを、描画 1 回ずつに見せる（遅い手元では、決まった時間では何歩ぶんもまとめて描く）
      await page.waitForTimeout(60);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    }
    const a = zs.slice(10);
    return { min: Math.min(...a), max: Math.max(...a) };
  };
  const calm = await sway(false);
  const weak = await sway(true);
  await page.screenshot({ path: `${OUT}85b_limp.png` });
  check('弱った足取り（v0.52.0）: 弱って巣へ向かう大型が歩くと、体が一歩ごとに片側へ傾く（0.05 rad より大きく揺れる）。弱っていなければ、平らな所では傾かない',
    weak.max - weak.min > 0.05 && calm.max - calm.min < 0.02, JSON.stringify({ calm, weak }));
  await ctx.close();
}

// ---- 登攀（v0.44.0。#19 の H07）: エリア 4 の 3m の棚へ、蔦の壁を登る・下りる ----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
  await until(page, () => window.__vh.sim.tick > 5 && !!window.__vh.sim.field);
  // エリア 4 の登り口の 1.5m 手前に、壁を向いて立つ（標的は止めておく）
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, c = s.field.areas.find((a) => a.id === 'a4').climbs[0];
    p.pos = { x: c.x - Math.sin(c.yaw) * 1.5, y: 0, z: c.z - Math.cos(c.yaw) * 1.5 };
    p.prevPos = { ...p.pos };
    p.yaw = c.yaw;
    p.prevYaw = c.yaw;
    s.areaId = 'a4';
    for (const m of s.monsters) m.aiEnabled = false;
    v.view.cam.snap(c.yaw);
  });
  await until(page, () => window.__vh.view.areaGroups.get('a4')?.visible === true, 30000);
  await page.waitForTimeout(600);
  const look = await page.evaluate(() => {
    let faces = 0;
    window.__vh.view.areaGroups.get('a4').traverse((o) => { if (o.userData.climbId === 'a4_climb_01' && o.material?.map) faces++; });
    return { faces, hint: document.querySelector('.hud-exit').hidden ? '' : document.querySelector('.hud-exit').textContent };
  });
  check('登攀（v0.44.0）: エリア 4 の棚の登れる壁に蔦が描かれ、登り口の前で「↑ 壁へ押すと登る」と出る', look.faces === 1 && look.hint === '↑ 壁へ押すと登る', JSON.stringify(look));
  // 目印（v0.48.0）: エリア 4 のくびれの割れた立ち岩（依頼 10 の R-16 が 2 本。当たりの円柱もデータのとおり）
  const marks = await page.evaluate(() => {
    let ids = [];
    window.__vh.view.areaGroups.get('a4').traverse((o) => { if (o.userData.rockArt) ids = ids.concat(o.userData.rockArt); });
    const data = window.__vh.sim.field.areas.find((a) => a.id === 'a4').rocks.filter((r) => r.art === 'R-16');
    return { drawn: ids.filter((id) => id === 'R-16').length, data: data.length, rocks: ids.length, all: window.__vh.sim.field.areas.find((a) => a.id === 'a4').rocks.length };
  });
  check('目印（v0.48.0）: エリア 4 のくびれに、割れた立ち岩（R-16 の図）が 2 本描かれ、データの岩の数と描いた岩の数が同じ', marks.drawn === 2 && marks.data === 2 && marks.rocks === marks.all, JSON.stringify(marks));
  // エリアの色合いと風の音（v0.51.0。#19 の F06）: エリア 4 の地面は少し黄みがかり（データの look.ground）、風の音はデータの大きさ（1.15）
  const looks = await until(page, () => window.__vh.audio.ambWant.wind === 1.15, 4000).then(() => page.evaluate(() => {
    const mean = (id) => {
      let ground = null;
      window.__vh.view.areaGroups.get(id)?.traverse((o) => { if (o.userData.ground) ground = o; });
      const c = ground?.geometry.getAttribute('color');
      if (!c) return null;
      let r = 0, b = 0;
      for (let i = 0; i < c.count; i++) { r += c.getX(i); b += c.getZ(i); }
      return r / b;
    };
    return { wind: window.__vh.audio.ambWant.wind, a4: mean('a4'), camp: mean('camp') };
  }));
  check('エリアの色合いと風（v0.51.0）: エリア 4 の地面は暖かい色（赤 ÷ 青が 1.06 より大きい。野営地はほぼ 1）、風の音はデータの 1.15', looks.wind === 1.15 && looks.a4 > 1.06 && Math.abs(looks.camp - 1) < 0.03, JSON.stringify(looks));
  // 壁へ向かって W を押し続ける: 取り付いて登り、上の段（3m）に立つ
  await page.keyboard.down('KeyW');
  const mounted = await untilSim(page, () => window.__vh.sim.player.mode === 'climb', 240);
  // 登り始めるまで待つ（v0.50.0。決まった 0.6 秒で待つと、手元が重い時に、まだ 0.2m に届いていないことがあった）
  await untilSim(page, () => window.__vh.sim.player.pos.y > 0.25, 360);
  const mid = await page.evaluate(() => ({ y: window.__vh.sim.player.pos.y, drawn: window.__vh.sim.player.drawn, hint: document.querySelector('.hud-exit').textContent }));
  await page.screenshot({ path: `${OUT}86_climb.png` });
  const topped = await untilSim(page, () => window.__vh.sim.player.mode === 'free' && window.__vh.sim.player.pos.y === 3, 480);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);
  const top = await page.evaluate(() => ({ y: window.__vh.sim.player.pos.y, grounded: window.__vh.sim.player.grounded, hint: document.querySelector('.hud-exit').textContent }));
  check('登攀（v0.44.0）: 壁へ押し続けると、武器を納めて取り付き、登って、上の段（3m）に立つ。登る間は「↑↓ 登る・下りる」の案内', mounted && mid.y > 0.2 && mid.y < 3 && !mid.drawn && /登る・下りる/.test(mid.hint) && topped && top.grounded && top.hint === '↓ 縁へ押すと下りる', JSON.stringify({ mid, top }));
  // 縁へ向かって S（後ろ）を押すと、向きを変えて取り付き、下まで下りる
  await page.keyboard.down('KeyS');
  const down = await untilSim(page, () => window.__vh.sim.player.climb?.phase === 'climb', 240);
  const bottom = await untilSim(page, () => window.__vh.sim.player.mode === 'free' && window.__vh.sim.player.pos.y === 0, 480);
  await page.keyboard.up('KeyS');
  check('登攀（v0.44.0）: 上の段で縁へ向かって押すと、向きを変えて取り付き、下まで下りて地面に立つ', down && bottom, JSON.stringify(await page.evaluate(() => ({ mode: window.__vh.sim.player.mode, y: window.__vh.sim.player.pos.y }))));
  // 降下と着地（v0.45.0）: 棚の横の縁から歩いて出ると降下になり、着いたらしゃがんで立て直す
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, a = s.field.areas.find((x) => x.id === 'a4'), sh = a.platforms.find((q) => q.h === 3);
    p.pos = { x: sh.minX + 0.8, y: 3, z: (sh.minZ + sh.maxZ) / 2 };
    p.prevPos = { ...p.pos };
    p.yaw = -Math.PI / 2;
    p.prevYaw = p.yaw;
    v.view.cam.snap(0);
  });
  await page.waitForTimeout(300);
  // カメラは +Z（北）を向く: 画面の右（D）が −X（棚の外。入力の右 = (-cos, sin)）
  await page.keyboard.down('KeyD');
  const dropped = await untilSim(page, () => !!window.__vh.sim.player.drop, 240);
  await page.keyboard.up('KeyD');
  const landed = await untilSim(page, () => !!window.__vh.sim.player.land || (window.__vh.sim.player.grounded && window.__vh.sim.player.pos.y === 0), 240);
  const after = await untilSim(page, () => window.__vh.sim.player.land === null && window.__vh.sim.player.pos.y === 0 && window.__vh.sim.player.mode === 'free', 240);
  check('降下と着地（v0.45.0）: 3m の棚の縁から歩いて出ると降下になり、地面に着いて立て直し、また歩ける', dropped && landed && after, JSON.stringify(await page.evaluate(() => ({ y: window.__vh.sim.player.pos.y, drop: window.__vh.sim.player.drop, land: window.__vh.sim.player.land }))));
  // 低い岩棚の乗り越え（v0.49.0。#19 の H07 の低棚）: エリア 4 の 1.1m の棚の帯で、棚へ押すと手を掛けて乗り越える
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, vt = s.field.areas.find((x) => x.id === 'a4').vaults[0];
    p.pos = { x: vt.x - Math.sin(vt.yaw) * 1.2, y: 0, z: vt.z - Math.cos(vt.yaw) * 1.2 };
    p.prevPos = { ...p.pos };
    p.yaw = vt.yaw;
    p.prevYaw = vt.yaw;
    p.drawn = true;
    v.view.cam.snap(vt.yaw);
  });
  await page.waitForTimeout(400);
  await until(page, () => !document.querySelector('.hud-exit').hidden, 8000);
  const vhint = await page.evaluate(() => (document.querySelector('.hud-exit').hidden ? '' : document.querySelector('.hud-exit').textContent));
  await page.keyboard.down('KeyW');
  const vaulting = await untilSim(page, () => window.__vh.sim.player.mode === 'vault', 240);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}87_vault.png` });
  const vtop = await untilSim(page, () => window.__vh.sim.player.mode === 'free' && window.__vh.sim.player.pos.y === 1.1, 240);
  await page.keyboard.up('KeyW');
  const vst = await page.evaluate(() => ({ y: window.__vh.sim.player.pos.y, drawn: window.__vh.sim.player.drawn, grounded: window.__vh.sim.player.grounded }));
  check('低い岩棚（v0.49.0）: エリア 4 の 1.1m の棚の前で「↑ 段へ押すと乗り越える」と出て、押すと武器を納めて手を掛け、段の上に立つ', vhint === '↑ 段へ押すと乗り越える' && vaulting && vtop && !vst.drawn && vst.grounded, JSON.stringify({ vhint, vaulting, vtop, vst }));
  await ctx.close();
}

// ---- 自然な形のエリアと、出ていく大型の速さ（v0.20.0）----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
  await until(page, () => window.__vh.sim.tick > 5 && !!window.__vh.sim.field);
  const shapes = await page.evaluate(() => window.__vh.sim.field.areas.map((a) => ({ id: a.id, n: a.shape?.length ?? 0, size: a.size })));
  check('自然な形のエリア（v0.20.0）: どのエリアも、外周が曲がった線（点が 40 以上）。狭い谷・沢と、広い原がある', shapes.every((s) => s.n >= 40) && shapes.filter((s) => s.size === 'narrow').length >= 3 && shapes.filter((s) => s.size === 'wide').length === 3, JSON.stringify(shapes));
  // 狭い沢（エリア 5）へ移り、壁へ向かって 3 秒歩く。外周の外へは出ない。岩壁は外周に沿う
  await page.evaluate(() => {
    const v = window.__vh, s = v.sim, a = s.field.areas.find((x) => x.id === 'a5');
    s.player.pos = { x: a.center.x, y: 0, z: a.center.z };
    s.player.prevPos = { ...s.player.pos };
    s.areaId = 'a5';
    for (const m of s.monsters) { m.pos = { x: 9999, y: 0, z: 9999 }; m.prevPos = { ...m.pos }; }
    // いちばん近い壁の方を向く（前へ歩くと、壁に当たる）
    const o = s.world.geo(s.world.areaAt(a.center.x, a.center.z)).shape.outwardAt(a.center.x, a.center.z);
    const yaw = Math.atan2(o.x, o.z);
    s.player.yaw = yaw;
    s.player.prevYaw = yaw;
    v.view.cam.snap(yaw);
  });
  await page.keyboard.down('KeyW');
  // 縁に着くまで歩く（v0.52.0。決まった 3 秒だと、手元が重い時に縁まで届かないことがあった）。着いてからも 1 秒押し続ける
  await untilSim(page, () => { const s = window.__vh.sim, p = s.player; return s.world.wallDistance(s.world.areaAt(p.pos.x, p.pos.z), p.pos.x, p.pos.z) < 1.5; }, 540);
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(400);
  const wall = await page.evaluate(() => {
    const v = window.__vh, s = v.sim, p = s.player, a = s.world.areaAt(p.pos.x, p.pos.z);
    return { area: s.areaId, inside: s.world.inArea(a, p.pos.x, p.pos.z, 0.2), wall: +s.world.wallDistance(a, p.pos.x, p.pos.z).toFixed(2), camWall: +s.world.wallDistance(a, v.view.cam.camera.position.x, v.view.cam.camera.position.z).toFixed(2), stats: v.view.stats() };
  });
  check('自然な形のエリア（v0.20.0）: 狭い沢で壁へ歩いても、外周の外へ出ない（縁で止まる）。カメラも外周の内', wall.area === 'a5' && wall.inside && wall.wall < 1.5 && wall.camWall > 0 && wall.stats.calls <= 100, JSON.stringify(wall));
  await page.screenshot({ path: `${OUT}9y_terrain_gully.png` });
  // 大型を、出ていかせる（居る時間を終わらせる）。走り出して 0.5 秒後からの 0.75 秒で、速さを測る
  const leave = await page.evaluate(() => new Promise((resolve) => {
    const s = window.__vh.sim, m = s.monsters[0];
    const a = s.field.areas.find((x) => x.id === m.roam.areaId);
    m.pos = { x: a.center.x, y: 0, z: a.center.z };
    m.prevPos = { ...m.pos };
    m.roam.state = 'stay';
    m.roam.ticks = 1;
    const t0 = performance.now();
    let start = null, began = -1;
    const poll = () => {
      if (m.roam.state === 'leave') {
        if (began < 0) began = s.tick;
        if (!start && s.tick - began >= 30) start = { tick: s.tick, x: m.pos.x, z: m.pos.z };
        else if (start && s.tick - start.tick >= 45) return resolve({ speed: +(Math.hypot(m.pos.x - start.x, m.pos.z - start.z) / ((s.tick - start.tick) / 60)).toFixed(2), from: a.id });
      } else if (began >= 0) return resolve({ speed: -1, from: a.id });
      if (performance.now() - t0 > 20000) return resolve({ speed: -2, state: m.roam.state });
      setTimeout(poll, 30);
    };
    poll();
  }));
  check('出ていく大型（v0.20.0）: 狩人の走る速さ（6.4m/s）の 1.15 倍より速く走って、出口へ向かう', leave.speed > 6.4 * 1.15, JSON.stringify(leave));
  await ctx.close();
}

// ---- 里を歩く拠点・商店・持ち込みの道具（v0.12.0。何も付けないアドレス）----
{
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, '');
  await page.click('#boot-start');
  check('里: 起動すると、里に立っている（一覧の画面は出ない。時間が進む）', await until(page, () => window.__vh && window.__vh.place === 'hub' && document.getElementById('base').hidden && window.__vh.sim.tick > 10 && window.__vh.sim.world.map.id === 'map.hub.village'));
  const hubState = () => page.evaluate(() => {
    const a = window.__vh, p = a.sim.player;
    const disp = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).display : 'none'; };
    return {
      place: a.place, x: p.pos.x, z: p.pos.z, near: a.nearFacility?.id ?? '', drawn: p.drawn, items: p.items.length, monsters: a.sim.monsters.length,
      base: !document.getElementById('base').hidden, section: document.getElementById('base').dataset.section ?? '', title: document.querySelector('#base h2').textContent,
      prompt: document.getElementById('hud-facility').hidden ? '' : document.getElementById('hud-facility').textContent,
      list: !document.getElementById('hud-hub-list').hidden,
      quests: disp('.base-quests'), forge: disp('#base-forge'), shop: disp('#base-shop'), weapons: disp('.base-weapons'), close: disp('.base-close'),
      money: a.save.doc.money, tonic: a.save.doc.items['item.heal_tonic'] ?? 0, shell: a.save.doc.items['mat.galdros.shell_shard'] ?? 0, weapon: p.weaponId,
    };
  });
  let h = await hubState();
  check('里: 標的は居ない。道具は持たない。「一覧」のボタンが出ている', h.monsters === 0 && h.items === 0 && h.list && h.prompt === '', JSON.stringify(h));
  // 景色の絵（依頼 8。v0.13.0）: 里の遠景・土と石畳・建物 4 つ
  const hubArt = await until(page, () => { const a = window.__vh.envArt(); return a.asked >= 13 && a.loaded === a.asked && a.failed === 0; }, 15000);
  await page.waitForTimeout(300);
  const hubLook = await page.evaluate(() => {
    const v = window.__vh.view;
    const files = [];
    // 建物の図（切り抜き）。外周の崖の面（v0.22.0。崖の図集を切り抜く）と、里の人の板（v0.23.0）は除く
    v.scene.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.cliffArt && !o.userData.npc && !o.material.userData?.prop && o.material.alphaTest > 0 && o.material.map && o.material.visible) files.push(String(o.material.map.image?.src ?? '').split('/').pop()); });
    // 主要施設と家屋は、ChatGPT の #40（利用者が 2026-11-27 にマージした）から専用の立体（src/render/hubCraft.ts の hub-crafted-buildings）。切り抜きの図の建物は無い
    const crafted = v.scene.getObjectByName('hub-crafted-buildings');
    const craft = crafted ? { buildings: crafted.userData.buildings, facilities: crafted.userData.facilities, meshes: crafted.children.filter((m) => m.isMesh).length, triangles: crafted.userData.triangles } : null;
    return { art: window.__vh.envArt(), buildings: files.sort(), craft, far: v.scene.getObjectByName('backdrop').children.filter((m) => m.material.map && m.material.visible).length, ...v.stats() };
  });
  check('景色の絵（里）: 頼んだ絵がすべて読めている。主要施設と家屋 12 棟（工房・商店・装備箱・級別の受付 4 つと、宿・民家 2 棟・集会所・倉庫）は専用の立体（#40）で、切り抜きの図の建物は無い', hubArt && hubLook.far === 2 && hubLook.buildings.length === 0 && hubLook.craft?.buildings === 12 && hubLook.craft.facilities === 7 && hubLook.craft.meshes > 0 && hubLook.craft.triangles > 0, JSON.stringify(hubLook));
  // 里の描画の目標は 130 呼び出し（v0.67.0。D-165。#42 の画像の材質で、材質ごとに描く物を分けたため。狩場は 100 のまま）
  check('景色の絵（里）: 描画量は里の目標内（130 draw calls / 20万 tri。D-165）', hubLook.calls <= HUB_CALLS && hubLook.triangles <= 200000, JSON.stringify(hubLook));
  await page.screenshot({ path: `${OUT}90_hub_start.png` });
  // 攻撃のボタンを押しても、武器を抜かない
  await click(page);
  await page.waitForTimeout(300);
  h = await hubState();
  check('里: 施設の前でなければ、主ボタンを押しても何も起きない（武器を抜かない）', !h.drawn && !h.base, JSON.stringify(h));
  // 前へ歩くと、依頼板の前に着く
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  const atBoard = await untilSim(page, () => window.__vh.nearFacility?.id === 'board', 1200);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(200);
  h = await hubState();
  check('里: 前へ歩くと依頼板の前に着き、「初級の依頼を見る」のボタンが出る', atBoard && /初級の依頼を見る/.test(h.prompt), JSON.stringify(h));
  await page.screenshot({ path: `${OUT}91_hub_board.png` });
  await click(page);
  await until(page, () => !document.getElementById('base').hidden);
  h = await hubState();
  check('里: 主ボタンで依頼板の画面が開く（初級の受付。依頼の欄だけ。工房・商店・武器の欄は出ない。「里へ戻る」がある）', h.base && h.section === 'quest' && h.title === '初級受付・広場の依頼板' && h.quests !== 'none' && h.forge === 'none' && h.shop === 'none' && h.weapons === 'none' && h.close !== 'none', JSON.stringify(h));
  const tickBefore = await page.evaluate(() => window.__vh.sim.tick);
  await page.waitForTimeout(300);
  check('里: 画面が開いている間は、一時停止する', await page.evaluate((t) => window.__vh.sim.tick === t, tickBefore));
  await page.screenshot({ path: `${OUT}92_hub_board_panel.png` });
  await page.click('.base-close');
  check('里: 「里へ戻る」で閉じて、また歩ける', await until(page, () => document.getElementById('base').hidden && window.__vh.sim.tick > 0) && await until(page, (t) => window.__vh.sim.tick > t, 5000, tickBefore));
  // 商店: 通貨が無いと買えない → 報酬をもらって、買う・売る
  const put = (id) => page.evaluate((id) => {
    const a = window.__vh, f = a.content.hub.facilities.find((x) => x.id === id), p = a.sim.player;
    // 施設の前の床の高さへ（v0.31.0。工房は 3m 下の段）
    p.pos = { x: f.x, y: a.sim.world.groundHeight(f.x, f.z), z: f.z };
    p.prevPos = { ...p.pos };
    p.yaw = Math.atan2(f.building.x - f.x, f.building.z - f.z);
    p.prevYaw = p.yaw;
    a.view.cam.snap(p.yaw);
  }, id);
  await put('shop');
  await until(page, () => window.__vh.nearFacility?.id === 'shop');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}93_hub_shop.png` });
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  h = await hubState();
  // 道具 7 つ（v0.42.0 で標識玉、v0.60.0 で強撃ビン、ChatGPT の #56 で解毒薬）× 1 個・5 個
  check('里: 商店の前のボタンを押すと、商店の画面が開く。通貨が無い間は、買うボタンが押せない', h.section === 'shop' && h.title === '商店' && h.shop !== 'none' && h.quests === 'none' && await page.evaluate(() => [...document.querySelectorAll('.shop-buy')].length === 14 && !!document.querySelector('.shop-buy[data-item="item.marker_orb"]') && !!document.querySelector('.shop-buy[data-item="item.power_coating"]') && !!document.querySelector('.shop-buy[data-item="item.antidote"]') && [...document.querySelectorAll('.shop-buy')].every((b) => b.disabled) && /売れる素材を持っていません/.test(document.getElementById('base-shop').textContent)), JSON.stringify(h));
  await page.evaluate(() => window.__vh.save.settle({ runId: 'smoke-hub-seed', questId: 'quest.basin.003', money: 1000, items: [{ itemId: 'mat.galdros.shell_shard', count: 3 }] }));
  await until(page, () => window.__vh.save.doc.money === 1000 && !document.querySelector('.shop-buy[data-item="item.heal_tonic"][data-count="1"]').disabled);
  await page.click('.shop-buy[data-item="item.heal_tonic"][data-count="1"]');
  const bought = await until(page, () => window.__vh.save.doc.money === 940 && window.__vh.save.doc.items['item.heal_tonic'] === 1 && /回復液を 1 個買いました/.test(document.querySelector('.base-message').textContent), 8000);
  check('里: 回復液を 1 個買うと、通貨が 60 減って道具が増える（保存が完了してから表示が変わる）', bought && await page.evaluate(() => /通貨 940/.test(document.querySelector('.shop-money').textContent) && /持っている数 1/.test(document.querySelector('.shop-row[data-item="item.heal_tonic"]').textContent) && /道具: 回復液 ×1/.test(document.querySelector('.base-inv').textContent)), JSON.stringify(await hubState()));
  // v0.23.0: 商店の行と持ち物に、道具・素材の絵（アイコン。256 四方）が出る。文字はこれまでどおり
  const icons = await until(page, () => ['.shop-row[data-item="item.heal_tonic"] img.ico', '.shop-row[data-item="mat.galdros.shell_shard"] img.ico'].every((q) => document.querySelector(q)?.naturalWidth === 256), 8000);
  check('アイコン: 商店の行（回復液・岩殻片）に、道具と素材の絵が出る', icons, await page.evaluate(() => [...document.querySelectorAll('#base-shop img.ico')].map((i) => `${i.dataset.icon}:${i.naturalWidth}`).join(' ')));
  await page.click('.shop-sell[data-item="mat.galdros.shell_shard"][data-count="1"]');
  check('里: 岩殻片を 1 個売ると、通貨が 20 増えて素材が減る', await until(page, () => window.__vh.save.doc.money === 960 && window.__vh.save.doc.items['mat.galdros.shell_shard'] === 2, 8000), JSON.stringify(await hubState()));
  await page.screenshot({ path: `${OUT}94_hub_shop_panel.png` });
  await page.click('.base-close');
  // 工房
  await put('workshop');
  await until(page, () => window.__vh.nearFacility?.id === 'workshop');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}95_hub_workshop.png` });
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  h = await hubState();
  check('里: 工房の画面は、強化の欄が開いた状態で出る', h.section === 'workshop' && h.title === '工房' && h.forge !== 'none' && h.shop === 'none' && await page.evaluate(() => document.getElementById('base-forge').open), JSON.stringify(h));
  await page.click('.base-close');
  // ---- 段のある里（v0.31.0。ChatGPT の里の設計 #11 の P0）: 広場から西の階段と踊り場を下りて、3m 低い炉の段の工房へ ----
  const place = (x, z, yaw) => page.evaluate(([x, z, yaw]) => {
    const a = window.__vh, p = a.sim.player;
    p.pos = { x, y: a.sim.world.groundHeight(x, z), z };
    p.prevPos = { ...p.pos };
    p.yaw = yaw;
    p.prevYaw = yaw;
    a.view.cam.snap(yaw);
  }, [x, z, yaw]);
  const tier = await page.evaluate(() => {
    const t = window.__vh.view.scene.getObjectByName('terraces');
    const kinds = t ? t.children.map((m) => m.userData.terrace).sort().join() : '';
    const maps = t ? t.children.filter((m) => m.material.map).every((m) => m.material.map.image?.naturalWidth > 0 || m.material.map.image?.width > 0) : false;
    return { kinds, maps, walls: t?.children.find((m) => m.userData.terrace === 'wall')?.userData.walls ?? 0, rails: t?.children.find((m) => m.userData.terrace === 'rail')?.userData.rails ?? 0 };
  });
  check('段のある里: 段の床（土・石・草・岩）・石積みの擁壁・岩の壁・小滝・水面・柵が描かれ、絵が読めている（v0.35.0 から 5 つの段）', tier.kinds === 'cliff,fall,grass,rail,rock,stone,wall,water,yard' && tier.maps && tier.walls > 100 && tier.rails > 20, JSON.stringify(tier));
  await place(-15, 8.5, -Math.PI / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}95a_hub_stairs_top.png` });
  await page.keyboard.down('KeyW');
  const landing = await untilSim(page, () => Math.abs(window.__vh.sim.player.pos.y + 1.5) < 0.01 && window.__vh.sim.player.pos.x < -19.3, 900);
  const bottom = await untilSim(page, () => window.__vh.sim.player.pos.y < -2.99 && window.__vh.sim.player.pos.x < -24, 900);
  const atForge = await until(page, () => window.__vh.nearFacility?.id === 'workshop', 15000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);
  h = await hubState();
  check('段のある里: 広場から西へ歩くと、階段と踊り場（-1.5m）を下りて炉の段（-3m）へ着き、工房の前で「工房に入る」が出る', landing && bottom && atForge && /工房に入る/.test(h.prompt), JSON.stringify({ landing, bottom, atForge, y: await page.evaluate(() => window.__vh.sim.player.pos.y), prompt: h.prompt }));
  await place(-26, 9, Math.PI / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}95b_hub_forge_terrace.png` });
  // 上の段の縁（階段の北の脇、柵の所）: 工房は開かず、西へ歩いても落ちない
  await place(-22.6, 12.4, -Math.PI / 2);
  await holdSim(page, 'KeyW', 90);
  const edge = await page.evaluate(() => ({ x: window.__vh.sim.player.pos.x, y: window.__vh.sim.player.pos.y, near: window.__vh.nearFacility?.id ?? '' }));
  check('段のある里: 上の段の縁（柵の所）からは工房を開けず、西へ歩いても、体が縁にかからない所で止まる（落ちない）', edge.y === 0 && edge.x > -23.7 + 0.38 && edge.near === '', JSON.stringify(edge));
  await page.screenshot({ path: `${OUT}95c_hub_edge.png` });
  // 炉の段から、階段を上って広場へ戻る
  await place(-25, 8.5, Math.PI / 2);
  await page.keyboard.down('KeyW');
  const back = await untilSim(page, () => window.__vh.sim.player.pos.x > -16.6 && window.__vh.sim.player.pos.y === 0, 900);
  await page.keyboard.up('KeyW');
  check('段のある里: 炉の段から東へ歩くと、階段を上って広場の高さ（0m）へ戻る', back, JSON.stringify(await page.evaluate(() => window.__vh.sim.player.pos)));
  // ---- 里の 5 つの段（v0.35.0。ChatGPT の里の設計 #11 の P1）: 水音の庭・暮らしの段・灯見の台、2 つの回遊路、建物と暮らし ----
  const village = await page.evaluate(() => {
    const v = window.__vh.view.scene.getObjectByName('village');
    if (!v) return null;
    const kinds = v.children.map((o) => o.userData.village).filter(Boolean).sort().join();
    const props = v.children.find((o) => o.userData.props);
    const wheel = v.children.find((o) => o.userData.wheel);
    const lift = v.children.find((o) => o.userData.lift);
    return { kinds, props: props?.userData.props ?? 0, propsArt: !!props?.material.map && props.material.visible, wheel: wheel?.rotation.x ?? null, lift: lift?.position.y ?? null, trails: v.children.find((o) => o.userData.trails)?.userData.trails ?? 0 };
  });
  // 水車は描画の時間で回る。手元の描画が遅い時もあるので、壁の時計で決めずに、回り終わるまで（15 秒まで）待つ
  await until(page, (w0) => (window.__vh.view.scene.getObjectByName('village')?.children.find((o) => o.userData.wheel)?.rotation.x ?? 0) > w0 + 0.35, 15000, village?.wheel ?? 0);
  await page.waitForTimeout(300);
  const village2 = await page.evaluate(() => {
    const v = window.__vh.view.scene.getObjectByName('village');
    const puffs = v.children.find((o) => o.isPoints);
    const a = puffs.geometry.getAttribute('aAlpha');
    let alive = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) > 0.01) alive++;
    return { wheel: v.children.find((o) => o.userData.wheel).rotation.x, puffs: alive };
  });
  check('里の 5 つの段: 建物（頂点の色・石・瓦・灯）・小物の板（#13 の絵）・外の斜面ができ、水車は回り、煙としぶきが出ている', village && village.kinds === 'glow,plain,roof,stone' && village.props >= 15 && village.propsArt && village.trails === 2 && village2.wheel > village.wheel + 0.3 && village2.puffs > 10, JSON.stringify({ village, village2 }));
  // 生活の道: 広場の南東の見晴らし台から、崖沿いの石段を下りて、水音の庭（-10m）へ。跳ばずに、1 段ずつ床に付いたまま
  await place(21, -19.5, -Math.PI / 2);
  await page.keyboard.down('KeyW');
  const gardenLanding = await untilSim(page, () => Math.abs(window.__vh.sim.player.pos.y + 5) < 0.01, 900);
  const garden = await untilSim(page, () => window.__vh.sim.player.pos.y < -9.99 && window.__vh.sim.player.pos.x < -5, 900);
  await page.keyboard.up('KeyW');
  const g1 = await page.evaluate(() => ({ ...window.__vh.sim.player.pos, amb: window.__vh.audio.ambWant }));
  check('里の 5 つの段: 見晴らし台から崖沿いの石段を西へ歩くと、踊り場（-5m）を通って水音の庭（-10m）へ下りる', gardenLanding && garden && Math.abs(g1.y + 10) < 0.01, JSON.stringify(g1));
  await page.screenshot({ path: `${OUT}95d_hub_garden.png` });
  // 沢のそば（小滝の下）では、沢の音が大きい。灯見の台では、風が強い（里の音の大きさ。音そのものは合成の仮の音）
  await place(-38, -22.5, -Math.PI / 2);
  // 里の音の大きさは、描画の時間で 0.25 秒おきに決まる。描画が遅い時は 0.7 秒では届かないことがあるので、沢の音が大きくなるまで待つ（v0.73.0。5 秒まで）
  await until(page, () => window.__vh.audio.ambWant.water > 0.6, 5000);
  const ambWater = await page.evaluate(() => window.__vh.audio.ambWant);
  // 見晴らしの道: 暮らしの段の石段の上から、灯見の台への崖沿いの石段を上り、吊り橋を渡る
  await place(-4.5, 41.5, -Math.PI / 2);
  await page.keyboard.down('KeyW');
  const lookout = await untilSim(page, () => window.__vh.sim.player.pos.y > 21.99 && window.__vh.sim.player.pos.x < -35.5, 1500);
  await page.keyboard.up('KeyW');
  await place(-6, 51.5, Math.PI / 2);
  await page.keyboard.down('KeyW');
  const crossed = await untilSim(page, () => window.__vh.sim.player.pos.x > 4, 900);
  await page.keyboard.up('KeyW');
  const g2 = await page.evaluate(() => ({ ...window.__vh.sim.player.pos, amb: window.__vh.audio.ambWant }));
  check('里の 5 つの段: 暮らしの段から崖沿いの石段を上って灯見の台（+22m）へ。吊り橋を渡って東へ（橋の上も 22m）', lookout && crossed && Math.abs(g2.y - 22) < 0.01, JSON.stringify(g2));
  check('里の 5 つの段: 里の音の大きさ（沢・炉・風）は場所で変わる（沢のそばは沢、灯見の台は風）', ambWater.water > 0.6 && g2.amb.water < ambWater.water && g2.amb.wind > ambWater.wind, JSON.stringify({ ambWater, top: g2.amb }));
  // 灯見の台から、通ってきた里を見下ろす（描画量も目標内）
  await place(4, 44, Math.PI - 0.2);
  await page.evaluate(() => { window.__vh.view.cam.pitch = 0.95; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}95e_hub_lookout_down.png` });
  const topLook = await page.evaluate(() => window.__vh.view.stats());
  check('里の 5 つの段: 灯見の台から見下ろしても、描画量は里の目標内（130 draw calls / 20万 tri。D-165）', topLook.calls <= HUB_CALLS && topLook.triangles <= 200000, JSON.stringify(topLook));
  await page.evaluate(() => { window.__vh.view.cam.pitch = 0.3; });
  await place(0, -9, 0);
  // ---- 工房で作る（v0.32.0。直接生産）: 疾棘穿槌（スパインゲイルの初級の大槌）を作って、装備箱で持つ（v0.75.0: 白紙にした 19 種の系列を外したので、スパインゲイルの系列で） ----
  const CRAFT = 'recipe.craft.weapon.spinegale.war_maul.r1', MADE = 'weapon.war_maul.spinegale.r1';
  await page.evaluate((id) => {
    const r = window.__vh.content.recipes.get(id);
    return window.__vh.save.settle({ runId: 'smoke-craft-1', questId: 'quest.gather.001', money: r.cost.money, items: r.cost.items.map((s) => ({ itemId: s.itemId, count: s.count })) });
  }, CRAFT);
  await put('workshop');
  await until(page, () => window.__vh.nearFacility?.id === 'workshop');
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  const makeBefore = await page.evaluate((id) => {
    document.querySelector('.forge-make').open = true;
    const box = document.querySelector('.forge-series[data-series="series.spinegale"]');
    box.open = true;
    const b = document.querySelector(`.forge-recipe[data-recipe="${id}"] button.go`);
    // 属性・状態異常・防具の技能と耐性（v0.33.0）も、性能の欄に出る
    const stat = (r) => document.querySelector(`.forge-recipe[data-recipe="${r}"] .forge-stat`)?.textContent ?? '';
    return {
      summary: document.querySelector('#base-forge summary').textContent, series: document.querySelectorAll('.forge-series').length, gatherSeries: [...document.querySelectorAll('.forge-series')].map((b) => b.dataset.series).filter((s) => s.startsWith('gathering.')).sort().join(), head: box.querySelector('summary').textContent, button: b?.textContent ?? '', enabled: b ? !b.disabled : false, weapon: window.__vh.save.doc.equippedWeaponId, rev: window.__vh.save.doc.revision,
      ice: stat('recipe.craft.weapon.frostald.heavy_blade.r1'), crit: stat('recipe.craft.weapon.spinegale.heavy_blade.r1'), frost: stat('recipe.craft.armor.frostald.head.r1'),
      allSeries: [...document.querySelectorAll('.forge-series')].map((b) => b.dataset.series).sort().join(),
    };
  }, CRAFT);
  await page.click(`.forge-recipe[data-recipe="${CRAFT}"] button.go`);
  await until(page, () => !!document.querySelector('.forge-confirm button.go'), 3000);
  await page.click('.forge-confirm button.go');
  const made = await until(page, (w) => window.__vh.save.doc.weapons.includes(w) && /を作りました/.test(document.querySelector('.base-message')?.textContent ?? ''), 8000, MADE);
  const makeAfter = await page.evaluate((w) => ({ msg: document.querySelector('.base-message').textContent, weapon: window.__vh.save.doc.equippedWeaponId, rev: window.__vh.save.doc.revision, owned: !!document.querySelector('.forge-series[data-series="series.spinegale"] .forge-recipe.owned'), has: window.__vh.save.doc.weapons.includes(w) }), MADE);
  check('工房で作る（v0.32.0）: 系列 4 の欄（スパインゲイル・フロストアルドと、採集の純鉱石・純骨の 2。#32）に「作る」が出て、素材をそろえると作れる。作ると持ち物に入り、装備は替わらない（保存の書き込みは 1 回）',
    makeBefore.series === 5 && makeBefore.allSeries === 'gathering.bone_only,gathering.ore_only,series.frostald,series.spinegale,series.venolka' && makeBefore.gatherSeries === 'gathering.bone_only,gathering.ore_only' && /作れます/.test(makeBefore.summary) && makeBefore.button === '作る' && makeBefore.enabled && made && makeAfter.has && makeAfter.owned && makeAfter.weapon === makeBefore.weapon && makeAfter.rev === makeBefore.rev + 1,
    JSON.stringify({ makeBefore, makeAfter }));
  check('工房で作る（v0.33.0）: 属性・会心の武器と、防具の技能・耐性が、性能の欄に出る（氷冠断剣 氷 22・疾棘断剣 会心 10%・氷冠頭冠 個別属性耐性（氷）・火 -2 雷 -1 氷 +3）',
    makeBefore.ice === '攻撃力 80・氷 22' && makeBefore.crit === '攻撃力 82・会心 10%' && makeBefore.frost === '防御力 9・個別属性耐性（氷）・火 -2 雷 -1 氷 +3', JSON.stringify(makeBefore));
  await page.click('.base-close');
  await put('chest');
  await until(page, () => window.__vh.nearFacility?.id === 'chest');
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  await page.click(`.base-weapon[data-weapon="${MADE}"]`);
  const holding = await until(page, (w) => window.__vh.sim.player.weaponId === w, 8000, MADE);
  check('工房で作る: 作った疾棘穿槌を、装備箱で持てる（攻撃力 83）', holding && await page.evaluate((w) => window.__vh.content.weapons.get(w).attack === 83 && window.__vh.save.doc.equippedWeaponId === w, MADE));
  await page.click('.base-weapon[data-weapon="weapon.heavy_blade.001"]');
  await until(page, () => window.__vh.sim.player.weaponId === 'weapon.heavy_blade.001', 8000);
  await page.click('.base-close');
  await until(page, () => document.getElementById('base').hidden, 3000);
  // 装備箱: 持ち替えても、立っている場所と開いている画面は変わらない
  await put('chest');
  await until(page, () => window.__vh.nearFacility?.id === 'chest');
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  const before = await hubState();
  await page.click('.base-weapon[data-weapon="weapon.twin_blades.001"]');
  await until(page, () => window.__vh.sim.player.weaponId === 'weapon.twin_blades.001', 8000);
  h = await hubState();
  check('里: 装備箱で持ち替えると、その場で武器が替わる（立っている場所と、開いている画面はそのまま）', before.section === 'chest' && before.weapons !== 'none' && h.weapon === 'weapon.twin_blades.001' && h.base && h.section === 'chest' && Math.abs(h.x - before.x) < 0.01 && Math.abs(h.z - before.z) < 0.01 && h.place === 'hub', JSON.stringify(h));
  await page.click('.base-weapon[data-weapon="weapon.heavy_blade.001"]');
  await until(page, () => window.__vh.sim.player.weaponId === 'weapon.heavy_blade.001', 8000);
  // 装備箱: 防具を、部位ごとに着る・外す（v0.14.0）
  const armorState = () => page.evaluate(() => {
    const a = window.__vh, rows = [...document.querySelectorAll('.base-armor-row')];
    const picks = (slot) => [...document.querySelectorAll(`.base-armor-row[data-slot="${slot}"] .base-armor-pick`)].map((b) => `${b.dataset.armor || '外す'}${b.classList.contains('on') ? '*' : ''}`).join();
    const tall = Math.min(...[...document.querySelectorAll('.base-armor-pick')].map((b) => b.getBoundingClientRect().height));
    return {
      rows: rows.map((r) => `${r.dataset.slot}:${r.dataset.worn}`).join(), head: picks('head'), chest: picks('chest'), note: document.querySelector('.base-armor-note').textContent, gear: document.querySelector('.base-gear-note').textContent,
      sim: a.sim.armorIds.join(), defense: a.sim.defense, worn: a.save.doc.equippedArmorIds.join(), owned: a.save.doc.armor.join(), look: a.view.hunter.armorKey,
      section: document.getElementById('base').dataset.section, open: !document.getElementById('base').hidden, x: a.sim.player.pos.x, z: a.sim.player.pos.z,
      shown: getComputedStyle(document.querySelector('.base-armor')).display !== 'none', tall, rev: a.save.doc.revision,
    };
  });
  let ar = await armorState();
  check('装備箱: 防具の欄に 5 部位が並ぶ。里の装束を着ていて、どの部位にも「外す」がある（ボタンは 44px 以上）',
    ar.shown && ar.rows === 'head:armor.head.001,chest:armor.chest.001,arms:armor.arms.001,waist:armor.waist.001,legs:armor.legs.001' && ar.head === 'armor.head.001*,外す' && ar.chest === 'armor.chest.001*,外す' && ar.tall >= 44 && /^防御力の合計 0（受けるダメージ ×1\.00）$/.test(ar.note), JSON.stringify(ar));
  // 岩殻の兜と胸当てを持たせる（書き出した形を取り込む。工房での強化は、別の項目で確かめている）
  await page.evaluate(async () => {
    const a = window.__vh, d = JSON.parse(JSON.stringify(a.save.doc));
    const up = (x) => (x === 'armor.head.001' ? 'armor.head.002' : x === 'armor.chest.001' ? 'armor.chest.002' : x);
    d.armor = d.armor.map(up);
    d.equippedArmorIds = d.equippedArmorIds.map(up);
    await a.save.importText(JSON.stringify(d));
    a.saveChanged();
  });
  await until(page, () => window.__vh.sim.armorIds.includes('armor.head.002') && document.querySelector('.base-armor-row[data-slot="head"]')?.dataset.worn === 'armor.head.002', 8000);
  await page.waitForTimeout(300);
  ar = await armorState();
  check('装備箱: 岩殻の兜と胸当てを着ている（防御力の合計 12、受けるダメージ ×0.89）。姿にも出ている', ar.head === 'armor.head.002*,外す' && ar.chest === 'armor.chest.002*,外す' && ar.defense === 12 && ar.look === '22111' && /^防御力の合計 12（受けるダメージ ×0\.89）$/.test(ar.note), JSON.stringify(ar));
  check('装備箱（v0.33.0）: 岩殻の兜と胸当ての技能（受け支え Lv1・刃持ち Lv1）と耐性（火 -4・雷 +6）が出る。sim も同じ値',
    ar.gear === '技能: 受け支え Lv1（防御のスタミナ -8%）・刃持ち Lv1（刃の減り -5%）耐性: 火 -4・雷 +6' && await page.evaluate(() => window.__vh.sim.gear.resist.fire === -4 && window.__vh.sim.gear.resist.thunder === 6 && Math.abs(window.__vh.sim.gear.guardStamina - 0.92) < 1e-9), JSON.stringify(ar));
  await page.screenshot({ path: `${OUT}95b_hub_chest_armor.png` });
  const at = { x: ar.x, z: ar.z, rev: ar.rev };
  // 頭を外す
  await page.click('.base-armor-row[data-slot="head"] .base-armor-pick[data-armor=""]');
  await until(page, () => !window.__vh.sim.armorIds.includes('armor.head.002') && document.querySelector('.base-armor-row[data-slot="head"]')?.dataset.worn === '', 8000);
  await page.waitForTimeout(300);
  ar = await armorState();
  check('装備箱: 頭を「外す」と、その場で兜が消え、防御力が 6 になる。持ち物には残る。立っている場所と、開いている画面はそのまま',
    ar.head === 'armor.head.002,外す*' && ar.defense === 6 && ar.look === '12111' && ar.owned.includes('armor.head.002') && !ar.worn.includes('armor.head.') && ar.rev === at.rev + 1 && ar.open && ar.section === 'chest' && Math.abs(ar.x - at.x) < 0.01 && Math.abs(ar.z - at.z) < 0.01 && /^防御力の合計 6（/.test(ar.note), JSON.stringify(ar));
  await page.screenshot({ path: `${OUT}95c_hub_chest_armor_off.png` });
  // もう一度着る
  await page.click('.base-armor-row[data-slot="head"] .base-armor-pick[data-armor="armor.head.002"]');
  await until(page, () => window.__vh.sim.armorIds.includes('armor.head.002') && document.querySelector('.base-armor-row[data-slot="head"]')?.dataset.worn === 'armor.head.002', 8000);
  ar = await armorState();
  check('装備箱: もう一度選ぶと、着直す（防御力の合計 12）', ar.head === 'armor.head.002*,外す' && ar.defense === 12 && ar.look === '22111' && ar.rev === at.rev + 2, JSON.stringify(ar));
  // 胴を外したまま、閉じる（この後の「読み込み直しても残る」で確かめる）
  await page.click('.base-armor-row[data-slot="chest"] .base-armor-pick[data-armor=""]');
  await until(page, () => !window.__vh.sim.armorIds.includes('armor.chest.002'), 8000);
  await page.click('.base-close');
  await until(page, () => document.getElementById('base').hidden);
  await page.waitForTimeout(400);
  check('装備箱: 閉じて里へ戻っても、選んだ装備のまま歩ける（兜あり・胴なし）', await page.evaluate(() => window.__vh.place === 'hub' && window.__vh.sim.armorIds.join() === 'armor.head.002,armor.arms.001,armor.waist.001,armor.legs.001' && window.__vh.view.hunter.armorKey === '21111'), await page.evaluate(() => `${window.__vh.sim.armorIds.join()} ${window.__vh.view.hunter.armorKey}`));
  await page.screenshot({ path: `${OUT}95d_hub_walk_helm.png` });
  // 「一覧」: 歩かずに、すべての欄を開ける
  await page.click('#hud-hub-list');
  await until(page, () => !document.getElementById('base').hidden);
  h = await hubState();
  check('里: 「一覧」で、すべての欄が出る（依頼・武器・工房・商店）', h.section === 'all' && h.title === '灯継ぎの里' && h.quests !== 'none' && h.forge !== 'none' && h.shop !== 'none' && h.weapons !== 'none', JSON.stringify(h));
  // 図鑑（v0.13.0。v0.75.0 で、白紙にした種を外した: いま居る 3 種だけが、はじめて登場する段階の下に並ぶ）。開くと、絵・生態が出る
  const zukan = await page.evaluate(async () => {
    const d = document.getElementById('base-bestiary');
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
    const openItem = (sel) => {
      const e = d.querySelector(sel);
      e.open = true;
      e.dispatchEvent(new Event('toggle'));
      return e;
    };
    // 専用の 3D モデルの種（スパインゲイル・フロストアルド）と、採用した設定図のガルドロス
    const second = openItem('[data-species="monster.spinegale"]');
    const frost = openItem('[data-species="monster.frostald"]');
    const img = second.querySelector('img');
    if (img && !img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
    const field = d.querySelector('[data-field="燠脈台地"]'), basin = d.querySelector('[data-field="風礫盆地"]'), frostField = d.querySelector('[data-field="白霧氷谷"]');
    const labels = (e) => [...e.querySelectorAll('dt')].map((x) => x.textContent).join();
    return {
      shown: getComputedStyle(d).display !== 'none', summary: d.querySelector('summary').textContent, n: d.querySelectorAll('[data-species]').length,
      heads: [...d.querySelectorAll('h4[data-rank]')].map((x) => x.textContent.replace(/\s+/g, ' ')), done: [...d.querySelectorAll('[data-species].implemented')].map((x) => x.dataset.species).join(),
      nos: [...d.querySelectorAll('[data-species] summary .no')].map((x) => x.textContent).join(),
      art: d.querySelectorAll('[data-species].art').length, planned: d.querySelectorAll('[data-species].planned').length, lazy: d.querySelectorAll('[data-species] dl').length,
      note: d.querySelector('.bestiary-note')?.textContent ?? '',
      img: img ? img.naturalWidth : 0, cap: second.querySelector('figcaption')?.textContent ?? '', eco: labels(second), frostCap: frost.querySelector('figcaption')?.textContent ?? '', frostTags: frost.querySelector('.tags').textContent,
      galdrosCap: (() => { const g = openItem('[data-species="monster.galdros"]'); return `${g.querySelector('figcaption')?.textContent ?? ''} ${g.querySelector('img')?.getAttribute('src') ?? ''}`; })(),
      fields: d.querySelectorAll('[data-field]').length, walkable: [...d.querySelectorAll('.bestiary-field.implemented')].map((x) => x.dataset.field).join(), fieldHead: d.querySelector('h4[data-fields]').textContent.replace(/\s+/g, ' '),
      fieldText: field.textContent.replace(/\s+/g, ' ').slice(0, 300), fieldState: field.querySelector('.state').textContent, basinState: basin.querySelector('.state').textContent,
      frostState: frostField.querySelector('.state').textContent, frostText: frostField.textContent.replace(/\s+/g, ' ').slice(0, 300), basinText: basin.textContent.replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  check('図鑑: 依頼の欄に、いま居る 3 種（ガルドロス・スパインゲイル・フロストアルド）が並ぶ（初級から 3 種。種の居ない段階は出ない。番号は 01〜03）。どれも遊べる種で、数の計画は出ない（v0.75.0）',
    zukan.shown && zukan.summary === '図鑑 4種' && zukan.n === 4 && zukan.heads.join('|') === '初級から 4 種' && zukan.done === 'monster.galdros,monster.spinegale,monster.frostald,monster.venolka' && zukan.nos === '01,02,03,04' && zukan.art === 0 && zukan.planned === 0 && zukan.lazy === 2 && /1 種ずつ増えます/.test(zukan.note) && !/計画/.test(zukan.note), JSON.stringify({ ...zukan, fieldText: '', frostText: '', basinText: '' }));
  check('図鑑: 種を開くと、絵と、生態 8 項目が出る。専用の 3D モデルの種には、そう出る。ガルドロスは採用した設定図', zukan.img >= 720 && /専用の 3D モデル/.test(zukan.cap) && /専用の 3D モデル/.test(zukan.frostCap) && /食べ物,行動と気性,なわばり,1 日の動き,巣と眠り,ほかとの関わり,幼体,痕跡$/.test(zukan.eco) && /白霧氷谷／氷/.test(zukan.frostTags)
    && /^設定図（採用済み.*galdros_left_v1\.webp$/.test(zukan.galdrosCap), JSON.stringify({ img: zukan.img, cap: zukan.cap, frostCap: zukan.frostCap, frostTags: zukan.frostTags, eco: zukan.eco, galdrosCap: zukan.galdrosCap }));
  // v0.23.0: 狩場の案を開くと、景色の原画（ChatGPT の追加原画。640 × 427）が出る
  await page.evaluate(() => { document.querySelector('[data-field="根絡み湿原"]').open = true; });
  const fieldArt = await until(page, () => document.querySelector('[data-field="根絡み湿原"] figure img')?.naturalWidth === 640, 8000);
  check('図鑑: 狩場を開くと、景色の原画が出る（ゲーム内地形とは別）', fieldArt && await page.evaluate(() => /この絵とは別/.test(document.querySelector('[data-field="根絡み湿原"] figcaption').textContent)), await page.evaluate(() => document.querySelector('[data-field="根絡み湿原"]')?.innerHTML.slice(0, 200)));
  check('図鑑: 21 狩場を歩ける。狩りの依頼があるのは 2（風礫盆地と白霧氷谷）で、ほかは採取専用の暫定地形（種はまだ居ない）',
    zukan.fields === 21 && zukan.walkable.split(',').length === 21 && zukan.walkable.split(',').includes('白霧氷谷') && zukan.fieldHead === '狩場 21（歩けるのは 21。狩りの依頼があるのは 3）' && zukan.basinState === '歩ける' && zukan.frostState === '歩ける' && /氷冠獣 フロストアルド/.test(zukan.frostText) && /岩殻獣 ガルドロス、疾棘竜 スパインゲイル/.test(zukan.basinText)
    && /燠脈台地/.test(zukan.fieldText) && /まだ居ません/.test(zukan.fieldText) && zukan.fieldState === '採取可（暫定）', JSON.stringify({ fields: zukan.fields, walkable: zukan.walkable, head: zukan.fieldHead, state: zukan.fieldState, frostState: zukan.frostState, text: zukan.fieldText, frostText: zukan.frostText, basinText: zukan.basinText }));
  await page.evaluate(() => document.getElementById('base-bestiary').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${OUT}99_bestiary.png` });
  // 依頼へ: 箱から実体ポーチへ移し、野営地の支給箱は手動で受け取る。
  check('里: 「一覧」の依頼の欄は、4 つの受付の案内（全部の依頼を縦に並べない。歩く里では、そこから出発しない）', await page.evaluate(() => document.querySelectorAll('article.reception-desk[data-reception]').length === 4 && !document.querySelector('.reception-row, .reception-depart')));
  await page.click('.base-close');
  await until(page, () => document.getElementById('base').hidden);
  await put('board');
  await until(page, () => window.__vh.nearFacility?.id === 'board');
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  await page.evaluate(async()=>{const m=window.__vh.save;const i=m.doc.classicBox.layout.findIndex(x=>x?.itemId==='item.heal_tonic');const r=await m.box({kind:'move',from:'box',index:i,itemId:'item.heal_tonic',count:1});if(!r.ok)throw Error(r.message);});
  await departQuest(page, 'quest.basin.003');
  await until(page, () => window.__vh.place === 'hunt' && window.__vh.sim.tick > 5 && document.getElementById('base').hidden);
  const pouch = await page.evaluate(() => {
    const s = window.__vh.sim;
    return { tonic: s.player.items.find((x) => x.itemId === 'item.heal_tonic').count, brought: s.brought['item.heal_tonic'], area: s.areaId };
  });
  check('里: 実体ポーチの回復液1個で出発し、支給品は未取得。野営地から始まる', pouch.tonic === 1 && pouch.brought.supplied === 0 && pouch.brought.own === 1 && pouch.area === 'camp', JSON.stringify(pouch));
  check('里: 依頼へは、装備箱で選んだ防具で出る（兜あり・胴なし。防御力 6）', await page.evaluate(() => window.__vh.sim.defense === 6 && window.__vh.sim.armorIds.join() === 'armor.head.002,armor.arms.001,armor.waist.001,armor.legs.001' && window.__vh.view.hunter.armorKey === '21111'), await page.evaluate(() => `${window.__vh.sim.defense} ${window.__vh.sim.armorIds.join()}`));
  // 支給品は野営地で手動受取。リタイアは自前の品を出発前に戻す。
  await page.click('.classic-supply summary');
  await page.getByRole('button',{name:/回復液 ×5.*受取 5/}).click();
  check('里: 支給箱で手動受取',await until(page,()=>window.__vh.sim.brought['item.heal_tonic'].supplied===5));
  await page.evaluate(() => (window.__vh.sim.player.items.find((x) => x.itemId === 'item.heal_tonic').count = 0));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu-body button');
  await page.click('.menu-body button');
  const settled = await until(page, () => !document.getElementById('result').hidden && window.__vh.save.doc.items['item.heal_tonic'] === undefined, 15000);
  check('里: リタイアで出発前のポーチに戻る。達成回数と通貨は変わらない', settled && await page.evaluate(() => window.__vh.save.doc.money === 960 && window.__vh.save.doc.progress.questClears['quest.basin.003'] === 1 && window.__vh.save.doc.classicBox.pouch.some(x=>x?.itemId==='item.heal_tonic'&&x.count===1)), await page.evaluate(() => document.getElementById('result').textContent.slice(0, 200)));
  await page.screenshot({ path: `${OUT}96_hub_result.png` });
  // 結果から拠点へ → 里に立つ
  await page.evaluate(() => window.__vh.toBase());
  check('里: 結果の画面から拠点へ戻ると、里に立っている', await until(page, () => window.__vh.place === 'hub' && document.getElementById('base').hidden && document.getElementById('result').hidden && window.__vh.sim.world.map.id === 'map.hub.village'));
  // 読み込み直しても、通貨と持ち物が残る
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && window.__vh.place === 'hub');
  h = await hubState();
  check('里: 読み込み直しても、買い物の結果が残っている（通貨 960、岩殻片 2、回復液 0）', h.money === 960 && h.shell === 2 && h.tonic === 0, JSON.stringify(h));
  check('里: 読み込み直しても、選んだ防具が残っている（兜は着たまま、胴は外したまま。胸当ては持っている）', await page.evaluate(() => { const d = window.__vh.save.doc; return d.schemaVersion === 6 && d.armor.includes('armor.chest.002') && !d.equippedArmorIds.includes('armor.chest.002') && d.equippedArmorIds.includes('armor.head.002') && window.__vh.sim.armorIds.join() === 'armor.head.002,armor.arms.001,armor.waist.001,armor.legs.001'; }), await page.evaluate(() => JSON.stringify(window.__vh.save.doc.equippedArmorIds)));

  // ---- 里の人と、物語「帰り道の灯」（v0.23.0。ChatGPT の Pull Request #5・#7）----
  const npcs = await until(page, () => {
    const g = window.__vh.view.scene.getObjectByName('npcs');
    return !!g && g.userData.npcs.length === 4 && g.userData.npcs.every((s) => s.mesh.material.visible && s.mesh.material.map?.image?.naturalWidth > 0);
  }, 15000);
  check('里: ミナギ・ロクハ・イサネが依頼板・工房・商店のそばに、セナキ（v0.29.0）が里の出口の門のそばに立っている（切り抜いた絵の板。絵が読めている）', npcs, await page.evaluate(() => JSON.stringify(window.__vh.content.hub.npcs.map((n) => n.name))));
  await put('board');
  await until(page, () => window.__vh.nearFacility?.id === 'board');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}97_hub_npcs.png` });
  await page.click('#hud-facility');
  await until(page, () => !document.getElementById('base').hidden);
  const panel = () => page.evaluate(() => {
    const b = document.querySelector('.base-story');
    return { shown: getComputedStyle(b).display !== 'none', title: b.querySelector('.story-title').textContent, step: b.querySelector('.story-next-hunt')?.dataset.step ?? '', go: b.querySelector('.story-go')?.dataset.quest ?? '', rec: b.querySelector('.story-records summary').textContent, end: b.querySelector('.story-unplayable')?.textContent ?? '' };
  });
  let sp = await panel();
  // v0.75.0: 第 1 章の狩りは「岩場の足音」だけ（2 つ目の「帆角の風」は、白紙にした種の依頼だったので外した）
  check('物語: 依頼板に物語の欄が出る。ガルドロスは達成済みなので、第 1 章は終わりで、次の狩りは無い（「まだ遊べません」）。帰還記録は 3 つ', sp.shown && sp.title === '物語「帰り道の灯」' && sp.step === '' && sp.go === '' && /次の地域の物語は、まだ遊べません/.test(sp.end) && sp.rec === '帰還記録を読む（3）', JSON.stringify(sp));
  await page.screenshot({ path: `${OUT}98_story_panel.png` });
  const rev0 = await page.evaluate(() => window.__vh.save.doc.revision);
  // v0.38.0: 物語の欄は、受付の下の「物語・帰還記録」の中（たたんである）
  await page.evaluate(() => { document.querySelector('.reception-story-fold').open = true; document.querySelector('.story-records').open = true; });
  await page.click('.story-record[data-scene="sc02"]');
  const opened = await until(page, () => !document.getElementById('story').hidden && document.getElementById('story').dataset.scene === 'sc02' && document.querySelector('.story-face img').naturalWidth === 256, 8000);
  await page.screenshot({ path: `${OUT}98_story_dialog.png` });
  // 台詞を 1 つずつ読み、まとめ（記録）が出たら止める（最後の「閉じる」は、下で押す）
  const said = [];
  const faces = [];
  for (let i = 0; i < 8; i++) {
    said.push(await page.evaluate(() => `${document.querySelector('.story-who').textContent}|${document.querySelector('.story-text').textContent}`));
    faces.push(await page.evaluate(() => document.getElementById('story').dataset.face));
    if (said.at(-1).startsWith('記録|')) break;
    await page.click('.story-buttons button');
  }
  // 場面の絵（v0.29.0。#13）: 会話の窓の後ろに出る。台詞ごとに表情が替わる
  const sceneArt = await page.evaluate(async () => {
    const st = document.getElementById('story');
    const url = (getComputedStyle(st).backgroundImage.match(/url\("?([^")]+)"?\)/) ?? [])[1] ?? '';
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    return { art: st.dataset.art, hasArt: st.classList.contains('has-art'), w: img.naturalWidth, h: img.naturalHeight };
  });
  check('物語（v0.29.0）: 会話の窓の後ろに場面の絵（最初の荷が届く。1280×720）。台詞ごとに表情の顔が替わる（イサネの安堵 → ロクハ → ミナギの安堵 → ミナギ → ミナギの集中）',
    sceneArt.art === 'event_story_first_delivery_v1' && sceneArt.hasArt && sceneArt.w === 1280 && sceneArt.h === 720
      && faces.slice(0, 5).join() === 'merchant_relief,smith,minagi_relief,minagi,minagi_focus', JSON.stringify({ sceneArt, faces }));
  check('物語: 記録を開くと会話の窓が出る（顔の絵・名前・台詞）。読み返す時の報告は、討伐・捕獲の分かれない言葉。最後にまとめが出る',
    opened && said[0] === 'イサネ（荷を運ぶ商い手）|「荷、通ったよ。布も薬も全部。さっきまで向こうで止まってたのが、ここにある。」' && said[3] === 'ミナギ（受付と記録）|「区間の安全を確かめて、荷を通したそう。」' && /^記録\|/.test(said[5] ?? ''), JSON.stringify(said));
  await page.click('.story-buttons button');
  check('物語: 閉じると窓が消え、読んでも保存は変わらない（revision が同じ）', await until(page, () => document.getElementById('story').hidden, 3000) && await page.evaluate((r) => window.__vh.save.doc.revision === r, rev0));
  // 帰還の報告: 「岩場の足音」を初めて達成した保存の後、里で 1 回だけ開く。同じ結果では、もう開かない
  // （この保存では、もう達成しているので、達成する前の達成回数を作って渡す）
  await page.click('.base-close');
  await until(page, () => document.getElementById('base').hidden);
  const clearsBefore = await page.evaluate(() => { const c = { ...window.__vh.save.doc.progress.questClears }; delete c['quest.basin.003']; return c; });
  await page.evaluate((b) => window.__vh.afterSettleStory(b, 'capture'), clearsBefore);
  const auto = await until(page, () => !document.getElementById('story').hidden && document.getElementById('story').dataset.scene === 'sc02', 5000);
  const autoState = await page.evaluate(() => ({ hud: document.getElementById('hud').hidden, paused: window.__vh.sim.tick, text: document.querySelector('.story-text').textContent }));
  await page.waitForTimeout(300);
  check('物語: 「岩場の足音」を初めて達成した保存の後、里で最初の帰還の報告が開く。開いている間は止まり、HUD は隠れる',
    auto && autoState.hud && /荷、通ったよ/.test(autoState.text) && await page.evaluate((t) => window.__vh.sim.tick === t, autoState.paused), JSON.stringify(autoState));
  await page.click('.story-close');
  await until(page, () => document.getElementById('story').hidden, 3000);
  const again = await page.evaluate(() => ({ ...window.__vh.save.doc.progress.questClears }));
  await page.evaluate((b) => window.__vh.afterSettleStory(b, 'slay'), again);
  await page.waitForTimeout(400);
  check('物語: 閉じると HUD が戻り、同じ結果では、報告はもう開かない', await page.evaluate(() => document.getElementById('story').hidden && !document.getElementById('hud').hidden));
  await page.click('#hud-hub-list');
  await until(page, () => !document.getElementById('base').hidden);
  sp = await panel();
  check('物語: 報告を読んだ後も、次の狩りは無く、「まだ遊べません」と出る。帰還記録は 3 つのまま', sp.step === '' && /次の地域の物語は、まだ遊べません/.test(sp.end) && sp.rec === '帰還記録を読む（3）', JSON.stringify(sp));
  // 章の一覧の章の絵（v0.39.0。#13 の残り 3 枚）: 開いた時に、小さな絵（480×270）を読む
  const chArt = await until(page, () => {
    const d = document.querySelector('.story-chapters');
    if (!d) return false;
    if (!d.open) {
      document.querySelector('.reception-story-fold').open = true;
      d.open = true;
      d.dispatchEvent(new Event('toggle'));
    }
    const img = (id) => d.querySelector(`.story-chapter[data-chapter="${id}"] img`);
    // 絵は見える所へ来た時に読む（loading = lazy）。まだの章の札を、順に見える所へ送る
    const wait = ['ch4', 'ch7', 'ch_thunder_return', 'ch9'].find((id) => !(img(id)?.complete && img(id).naturalWidth > 0));
    if (wait) d.querySelector(`.story-chapter[data-chapter="${wait}"]`)?.scrollIntoView({ block: 'center' });
    return ['ch4', 'ch7', 'ch_thunder_return', 'ch9'].every((id) => img(id)?.complete && img(id).naturalWidth === 480 && /story\/thumb\/event_(story|thunder)_/.test(img(id).getAttribute('src')))
      && /assets\/fields\//.test(img('ch2')?.getAttribute('src') ?? '');
  }, 8000);
  check('物語: 章の一覧に、章の絵（第 4 章・第 7 章・追加決戦章（#18）・終章は場面の小さな絵。第 2 章は狩場の景色）', chArt, await page.evaluate(() => JSON.stringify([...document.querySelectorAll('.story-chapter img')].map((i) => `${i.closest('.story-chapter').dataset.chapter}:${i.getAttribute('src').split('/').slice(-2).join('/')}:${i.naturalWidth}`))));
  // 景色の絵は、見える所へ来た時に読む（loading = lazy）。第 2 章の札を見える所へ送ってから待つ
  await page.evaluate(() => { document.querySelector('.story-chapters').open = true; });
  await until(page, () => document.querySelectorAll('.story-chapter').length === 11, 5000);
  await page.evaluate(() => document.querySelector('.story-chapter[data-chapter="ch2"]').scrollIntoView({ block: 'center' }));
  const chapters = await until(page, () => document.querySelectorAll('.story-chapter').length === 11 && document.querySelector('.story-chapter[data-chapter="ch2"] img')?.naturalWidth === 640, 8000);
  check('物語: 章の一覧は 11（序章・8 章・追加決戦章（v0.39.0。#18）・終章）。第 1 章は「済み」、第 2 章から先は「まだ遊べません」。狩場の景色の原画が出る', chapters && await page.evaluate(() => document.querySelector('.story-chapter[data-chapter="ch1"] .state').textContent === '済み' && document.querySelector('.story-chapter[data-chapter="ch8"] .state').textContent === 'まだ遊べません'), await page.evaluate(() => [...document.querySelectorAll('.story-chapter .state')].map((x) => x.textContent).join(',')));
  await page.screenshot({ path: `${OUT}98_story_chapters.png` });
  await ctx.close();
}

// ---- 里（横向きスマホ相当・タッチ）----
{
  const { ctx, page } = await open({ width: 844, height: 390 }, true, '');
  await page.tap('#boot-start');
  await until(page, () => window.__vh && window.__vh.place === 'hub' && window.__vh.sim.tick > 10);
  const vis = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#touch .tbtn')].map((b) => [b.dataset.name, !b.hidden && getComputedStyle(b).display !== 'none' ? b.textContent : null])));
  let v = await vis();
  check('里（タッチ）: 武器を使うボタン（抜刀・薙ぐ・道具・ロック）は出ない。主ボタンは「—」', v.weapon === null && v.sub === null && v.item === null && v.lock === null && v.main === '—' && v.dodge !== null, JSON.stringify(v));
  await page.evaluate(() => {
    const a = window.__vh, f = a.content.hub.facilities.find((x) => x.id === 'shop'), p = a.sim.player;
    p.pos = { x: f.x, y: 0, z: f.z };
    p.prevPos = { ...p.pos };
  });
  await until(page, () => window.__vh.nearFacility?.id === 'shop');
  await page.waitForTimeout(300);
  v = await vis();
  const box = await page.evaluate(() => {
    const r = document.getElementById('hud-facility').getBoundingClientRect();
    const hit = [...document.querySelectorAll('#touch .tbtn')].filter((b) => !b.hidden && getComputedStyle(b).display !== 'none').map((b) => b.getBoundingClientRect()).some((q) => !(q.right < r.left || q.left > r.right || q.bottom < r.top || q.top > r.bottom));
    return { w: r.width, h: r.height, hit };
  });
  check('里（タッチ）: 施設の前では、主ボタンが「入る」になり、入るボタンが出る（44px 以上で、操作ボタンと重ならない）', v.main === '入る' && box.h >= 44 && box.w >= 150 && !box.hit, JSON.stringify({ v: v.main, box }));
  await page.screenshot({ path: `${OUT}97_hub_touch.png` });
  await page.tap('#hud-facility');
  check('里（タッチ）: 入るボタンを指で押すと、商店の画面が開く', await until(page, () => !document.getElementById('base').hidden && document.getElementById('base').dataset.section === 'shop'));
  await page.screenshot({ path: `${OUT}98_hub_touch_shop.png` });
  await page.tap('.base-close');
  check('里（タッチ）: 「里へ戻る」で閉じる', await until(page, () => document.getElementById('base').hidden));
  await ctx.close();
}

// ---- 遊べる 3 種（v0.75.0。利用者の指示で、白紙にした 19 種 = 大型 11・幼体 8 と群れを外した。D-175）: 依頼が始まり、体が出て、近くに立つと技を出す。状態異常の札 ----
// （それまでの「大型 11 種」「幼体 8 種と群れ」の項目は、種と一緒に外した。フロストアルドは、軽い版のモデルで見る）
{
  const ROSTER = [['galdros', 'quest.basin.003'], ['spinegale', 'quest.spinegale.r1'], ['frostald', 'quest.frostald.r1'], ['venolka','quest.venolka.r1']];
  const { ctx, page } = await open({ width: 1280, height: 720 }, false, `${ARENA}&frostaldQuality=game&venolkaQuality=game`);
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  {
    const all = await receptionRows(page);
    const hunts = await page.evaluate(() => [...window.__vh.content.quests.values()].filter((q) => q.kind !== 'gather').map((q) => q.id).sort().join());
    check('遊べる 3 種: 狩りの依頼は 10 件（ガルドロス 4・スパインゲイル 3・フロストアルド 3）。外した種の依頼は、受付に無い',
      hunts === 'quest.basin.003,quest.basin.r2.001,quest.basin.r3.001,quest.basin.r4.001,quest.frostald.r1,quest.frostald.r2,quest.frostald.r3,quest.spinegale.r1,quest.spinegale.r2,quest.spinegale.r3,quest.venolka.r1,quest.venolka.r2,quest.venolka.r3'
        && ROSTER.every(([, q]) => all.some((r) => r.id === q && r.rank === 'rank.1')) && !all.some((r) => /selvark|kordopil|palseit|basin_young|pack/.test(r.id)), JSON.stringify({ hunts, n: all.length }));
  }
  // スパインゲイルとフロストアルドの依頼は、前の依頼の達成が要る（達成した保存にする）
  await page.evaluate(async () => {
    const s = window.__vh.save;
    await s.settle({ runId: 'smoke-roster-1', questId: 'quest.basin.003', money: 0, items: [] });
    await s.settle({ runId: 'smoke-roster-2', questId: 'quest.spinegale.r1', money: 0, items: [] });
    await s.settle({runId:'smoke-roster-3',questId:'quest.frostald.r1',money:0,items:[]});
  });
  const rows = [];
  for (const [key, quest] of ROSTER) {
    await page.evaluate((q) => window.__vh.startHunt(q), quest);
    // 体が出る（専用のモデルは、読み込みが済んでから）
    const ready = await until(page, (id) => {
      const v = window.__vh, m = v.sim?.monsters?.[0];
      if (!m || m.def.id !== id || v.sim.tick <= 5 || !v.view.monsterRig?.root.visible) return false;
      let n = 0;
      v.view.monsterRig.root.traverse((o) => { if (o.isMesh && o.visible && o.geometry?.attributes?.position?.count > 100) n++; });
      return n > 0;
    }, 40000, `monster.${key}`);
    // 横（右側）から見る位置へ。気づかせて、動かないようにする
    await page.evaluate(() => {
      const v = window.__vh, m = v.sim.monsters[0], p = v.sim.player;
      m.aware = true;
      m.aiEnabled = false;
      const dir = m.yaw - Math.PI / 2;
      p.pos = { x: m.pos.x + Math.sin(dir) * 9, y: 0, z: m.pos.z + Math.cos(dir) * 9 };
      p.prevPos = { ...p.pos };
      p.yaw = dir + Math.PI;
      v.view.cam.snap(p.yaw);
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}9${ROSTER.findIndex((r) => r[0] === key)}_roster_${key}.png` });
    const info = await page.evaluate(() => ({ ...window.__vh.view.stats(), name: window.__vh.sim.monsters[0].def.name, herds: window.__vh.sim.herds.length }));
    // 近くに立つと、技を出す（咆哮のほか）。戦闘の計算を直に 5 秒ぶん（300 tick）進めて見る:
    // この検査の環境（GPU の無い描画）では、専用のモデルの種は 1 フレームに数秒かかり、1 フレームに進むのは 6 tick までなので、画面の時間では待てない
    const acted = await page.evaluate(() => {
      const v = window.__vh, s = v.sim, m = s.monsters[0], p = s.player;
      m.aiEnabled = true;
      m.cooldown = 0;
      p.pos = { x: m.pos.x + Math.sin(m.yaw) * 4, y: 0, z: m.pos.z + Math.cos(m.yaw) * 4 };
      p.prevPos = { ...p.pos };
      for (let i = 0; i < 300; i++) {
        s.step({ moveX: 0, moveZ: 0, held: 0, pressed: 0, released: 0 });
        if (m.action && m.action.def.actionId !== m.def.discover?.actionId) return m.action.def.actionId;
      }
      return '';
    });
    rows.push({ key, ready, acted, calls: info.calls, tris: info.triangles, herds: info.herds });
    await page.evaluate(() => window.__vh.toBase());
    await until(page, () => !document.getElementById('base').hidden, 8000);
  }
  check('遊べる 3 種: どの依頼も始まり、標的の体が出る（群れは居ない）', rows.every((r) => r.ready && r.herds === 0), JSON.stringify(rows.map((r) => `${r.key}:${r.ready ? '' : '×'}${r.calls}calls/${r.tris}tri`)));
  check('遊べる 3 種: 近くに立つと、5 秒（300 tick）以内に技を出す', rows.every((r) => !!r.acted), JSON.stringify(rows.map((r) => `${r.key}:${r.acted || '×'}`)));
  // 状態異常の札（HUD）
  await page.evaluate(() => window.__vh.startHunt('quest.basin.003'));
  await until(page, () => window.__vh.sim.tick > 5);
  await page.evaluate(() => {
    const p = window.__vh.sim.player;
    p.mode = 'hurt';
    p.hurt = { kind: 'sleep', tick: 0, duration: 600, dirYaw: 0 };
    p.ailment.poisonTicks = 600;
  });
  check('状態異常: 眠りと毒の札が、体力の棒の下に出る', await until(page, () => {
    const t = [...document.querySelectorAll('#hud-ailments .ail')].map((b) => b.textContent).join();
    return t === '毒,睡眠';
  }, 4000), await page.evaluate(() => document.getElementById('hud-ailments').textContent));
  await page.screenshot({ path: `${OUT}9y_status_sleep.png` });
  await ctx.close();
}

// ---- 依頼の掲示・工房からの支給・里の納品（v0.26.0。ChatGPT のクエスト設計 #9。横向きスマホ相当） ----
{
  const { ctx, page } = await open({ width: 844, height: 390 }, true, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  // v0.38.0（ChatGPT の #17）: 依頼は級ごとの受付で、星ごとの短い一覧 → 詳細
  const boardRows = await receptionRows(page);
  const boardInfo = boardRows.map((r) => `${r.id}:${r.stars}`);
  check('依頼の掲示: 100 件（狩り 10・狩らない 5・採取ツアー84・里の納品 1。v0.75.0 で、白紙にした種の依頼 29 を外した）が、4 つの受付の星ごとの一覧に 1 度ずつ。主線・昇級確認の札が短い行に出る。里の納品は、まだ', boardRows.length === 103 && new Set(boardRows.map((r) => r.id)).size === 103
    && ['r1', 'r2', 'r3', 'r4'].every((k) => boardRows.some((r) => r.id === `quest.explore.basin.${k}`))
    && boardRows.every((r) => r.stars >= 1 && r.stars <= 8) && /主線/.test(boardRows.find((r) => r.id === 'quest.basin.003')?.text ?? '') && /昇級確認/.test(boardRows.find((r) => r.id === 'quest.basin.r4.001')?.text ?? '')
    && !/30 分/.test(boardRows.find((r) => r.id === 'quest.basin.003')?.text ?? '') && /未解放/.test(boardRows.find((r) => r.id === 'quest.delivery.009')?.text ?? '') && boardRows.find((r) => r.id === 'quest.basin.r4.001')?.stars === 8,
    `${boardRows.length} 件 ` + JSON.stringify(boardInfo).slice(0, 300));
  await page.evaluate(() => window.__vh.base.setOpen(true, 'quest', 'board'));
  check('初級の受付: おすすめの順の案内・星の札（件数つき）・押しても出発しない行。訓練場と物語は下にまとめてある', await page.evaluate(() => /おすすめ/.test(document.querySelector('.quest-recommend')?.textContent ?? '')
    && [...document.querySelectorAll('.reception-star')].every((b) => /件/.test(b.textContent)) && document.querySelectorAll('.reception-row').length === 0 && !document.querySelector('.reception-training').hidden && !!document.querySelector('.reception-story-fold')));
  check('星選択から依頼帳へ: 一覧と依頼書を同時に表示し、選択しても出発しない', await page.evaluate(() => {
    document.querySelector('.reception-star[data-stars="2"]').click();
    const row = document.querySelector('.reception-row[data-quest="quest.basin.003"]');
    row.click();
    return row.dataset.rank === 'rank.1' && !!document.querySelector('.reception-list') && !!document.querySelector('.reception-detail .reception-letter') && !window.__vh.sim.hunt;
  }));
  await showQuest(page, 'quest.basin.003');
  check('依頼の詳細: 星の列（★★☆☆☆☆☆☆ 2 / 8）・目標・制限時間・目安・報酬・依頼人の話。開いても出発しない', await page.evaluate(() => {
    const d = document.querySelector('.reception-detail');
    return !!d && /★★☆☆☆☆☆☆ 2 \/ 8/.test(d.textContent) && /クリアの目安/.test(d.textContent) && document.querySelector('.reception-letter').textContent.length > 100 && !document.getElementById('base').hidden && !window.__vh.sim.hunt;
  }), await page.evaluate(() => document.querySelector('.reception-detail')?.textContent?.slice(0, 200) ?? ''));
  await page.screenshot({ path: `${OUT}9z_quest_board.png` });
  await page.click('.reception-depart[data-quest="quest.basin.003"]');
  check('受注の確認: まだ出発しない。やめると同じ依頼帳へ戻る', await page.evaluate(() => {
    const confirm = document.querySelector('.reception-confirm-go[data-quest="quest.basin.003"]');
    if (!confirm || window.__vh.sim.hunt) return false;
    document.querySelector('.reception-confirm-no').click();
    return !!document.querySelector('.reception-depart[data-quest="quest.basin.003"]') && document.querySelector('.reception-row[data-quest="quest.basin.003"]').getAttribute('aria-pressed') === 'true';
  }));
  // 第 1 章の狩り（岩場の足音）を達成した保存データにする（保存の管理役から。岩殻片 2）
  await page.evaluate(async () => {
    const s = window.__vh.save;
    await s.settle({ runId: 'smoke-st01', questId: 'quest.basin.003', money: 600, items: [{ itemId: 'mat.galdros.shell_shard', count: 2 }] });
  });
  await page.evaluate(() => window.__vh.base.setOpen(true, 'all'));
  const support = await until(page, () => document.querySelector('.forge-support')?.dataset.state === 'ready' && /支給を受け取れます/.test(document.querySelector('#base-forge summary')?.textContent ?? '') && !!document.querySelector('.story-support'), 8000);
  await showQuest(page, 'quest.basin.r2.001');
  const r2detail = await page.evaluate(() => document.querySelector('.reception-detail')?.textContent ?? '');
  await showQuest(page, 'quest.delivery.009');
  const delivShort = await page.evaluate(() => document.querySelector('.base-delivery')?.dataset.state === 'short');
  await page.evaluate(() => window.__vh.base.setOpen(true, 'all'));
  check('第 1 章の後: 工房の支給を受け取れる（工房の見出しと物語の欄に知らせ）。中級は制限 35 分（フィールドの時間）。納品は素材が足りない', support && /35 分/.test(r2detail) && /12〜16分/.test(r2detail) && delivShort, r2detail.slice(0, 160));
  await page.evaluate(() => { document.getElementById('base-forge').open = true; document.querySelector('.forge-support').scrollIntoView(); });
  await page.screenshot({ path: `${OUT}9z_support.png` });
  await page.locator('.forge-support button.go').tap();
  check('支給を受け取ると、材料が入り（岩殻片 2 → 16 など）、受け取り済みになる。2 度は押せない', await until(page, () => {
    const d = window.__vh.save.doc;
    return document.querySelector('.forge-support')?.dataset.state === 'claimed' && !document.querySelector('.forge-support button') && d.claims.join() === 'story.support.tier2' && d.items['mat.galdros.shell_shard'] === 16 && d.items['mat.galdros.hard_bone'] === 6;
  }, 8000));
  await showQuest(page, 'quest.delivery.009');
  check('岩殻片が 16 個になったので、里の納品「余った岩殻片を修繕に」ができる（初級の受付の詳細から）', await page.evaluate(() => document.querySelector('.base-delivery')?.dataset.state === 'ready'));
  await page.evaluate(() => document.querySelector('.base-delivery').scrollIntoView());
  await page.locator('.base-delivery button.go').tap();
  const confirmText = await page.evaluate(() => document.querySelector('.base-delivery .forge-confirm')?.textContent ?? '');
  check('納品する → 渡す数・残り・報酬・元に戻せないことを出して、もう 1 度押してもらう（まだ減らない）', /岩殻片 2 個（残り 14 個）を渡して、250 通貨を受け取ります。元には戻せません/.test(confirmText) && (await page.evaluate(() => window.__vh.save.doc.items['mat.galdros.shell_shard'])) === 16, confirmText);
  await page.screenshot({ path: `${OUT}9z_delivery.png` });
  const money0 = await page.evaluate(() => window.__vh.save.doc.money);
  await page.locator('.base-delivery .forge-confirm button.go').tap();
  check('渡すと、岩殻片 14・通貨 +250・達成 1 回・納品済み（1 度だけ）', await until(page, (m0) => {
    const d = window.__vh.save.doc;
    return document.querySelector('.base-delivery')?.dataset.state === 'claimed' && d.money === m0 + 250 && d.items['mat.galdros.shell_shard'] === 14 && d.progress.questClears['quest.delivery.009'] === 1 && d.claims.includes('quest.delivery.009');
  }, 8000, money0));
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])', { timeout: 15000 });
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  const supportClaimed = await page.evaluate(() => document.querySelector('.forge-support')?.dataset.state === 'claimed');
  await showQuest(page, 'quest.delivery.009');
  check('読み込み直しても、受け取りの記録が残る（保存の版 4 からの記録）。支給も納品も、もう受けられない', supportClaimed && await page.evaluate(() => {
    const d = window.__vh.save.doc;
    return d.schemaVersion === 6 && d.claims.length === 2 && document.querySelector('.base-delivery')?.dataset.state === 'claimed';
  }));
  await page.evaluate(() => window.__vh.startHunt('quest.basin.r2.001'));
  await until(page, () => window.__vh.sim.hunt && window.__vh.sim.tick > 5);
  const info = await page.evaluate(() => ({ s: window.__vh.sessionInfo(), t: window.__vh.sim.hunt.timeLimitTicks }));
  check('狩りの中: 一時停止の題に星、時計は 35 分（126000 tick）、依頼人の話を読み返せる', /^★4【中級】脈打つ岩殻/.test(info.s.title) && info.t === 126000 && info.s.lines.some((l) => /^依頼人（盆地の巡回係）: /.test(l)), JSON.stringify(info).slice(0, 160));
  await ctx.close();
}

// ---- 狩らない依頼（採集・採掘・現地の納品。v0.27.0。ChatGPT のクエスト設計 #9。横向きスマホ相当） ----
{
  const { ctx, page } = await open({ width: 844, height: 390 }, true, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  const gRows = await receptionRows(page);
  const er = gRows.filter((r) => /^quest\.(gather|mine|delivery)\./.test(r.id) && r.id !== 'quest.delivery.009');
  await showQuest(page, 'quest.gather.001');
  const g1 = await page.evaluate(() => document.querySelector('.reception-detail')?.textContent ?? '');
  check('狩らない依頼: 初級の受付の ★1 に 5 件（採集 2・採掘 2・現地の納品 1。葉・つるはし・箱の印）。制限 15 分・獣は出ない', er.length === 5 && er.every((r) => r.rank === 'rank.1' && r.stars === 1)
    && /採集/.test(er.find((r) => r.id === 'quest.gather.001')?.text ?? '') && /採掘/.test(er.find((r) => r.id.startsWith('quest.mine.'))?.text ?? '')
    && /ヒラナギの葉 6 枚/.test(g1) && /15 分/.test(g1) && /4〜6分/.test(g1) && /モンスターは出ません/.test(g1), JSON.stringify({ er: er.map((r) => r.id), g1: g1.slice(0, 160) }));
  await page.click('.reception-depart[data-quest="quest.gather.001"]');
  await page.click('.reception-confirm-go[data-quest="quest.gather.001"]');
  await until(page, () => window.__vh.sim.errand && window.__vh.sim.tick > 5);
  check('出発すると、野営地から。モンスターは出ない。HUD の目標は「ヒラナギの葉 0 / 6」、地図には採取点のあるエリア', await page.evaluate(() => {
    const s = window.__vh.sim;
    return s.areaId === 'camp' && s.monsters.length === 0 && s.herds.length === 0 && /ヒラナギの葉 0 \/ 6/.test(document.querySelector('.hud-goal')?.textContent ?? document.getElementById('hud')?.textContent ?? '')
      && /採取点: 野営地 4/.test(document.getElementById('hud').textContent) && s.hunt.timeLimitTicks === 54000;
  }), await page.evaluate(() => document.getElementById('hud').textContent.slice(0, 200)));
  const gatherAt = async (i) => {
    // 前の採集の動き（採った後の戻り）が終わってから移す（動きの最中に押した攻撃ボタンは、先行入力の間に使われずに消える）
    await untilSim(page, () => window.__vh.sim.player.mode === 'free', 300);
    await page.evaluate((k) => {
      const s = window.__vh.sim, n = s.errand.def.nodes[k], p = s.player;
      s.areaId = n.areaId; p.pos = { x: n.x - 1.2, y: 0, z: n.z }; p.prevPos = { ...p.pos }; p.yaw = Math.PI / 2; p.drawn = false;
    }, i);
    await until(page, () => document.querySelector('.tbtn-main')?.textContent === '採集', 8000);
  };
  await gatherAt(0);
  const near = await page.evaluate(() => ({ main: document.querySelector('.tbtn-main')?.textContent ?? '', wrap: document.querySelector('.hud-wrap')?.textContent ?? '', back: document.getElementById('hud-return').hidden }));
  check('採取点のそば（納刀）: 攻撃ボタンが「採集」、案内に「攻撃ボタンで 採集」（帰還するのボタンは出ない）', near.main === '採集' && /攻撃ボタンで 採集（ヒラナギの葉）/.test(near.wrap) && near.back, JSON.stringify(near));
  await page.screenshot({ path: `${OUT}9z_errand_node.png` });
  await page.evaluate(() => window.__vh.hub.pulse(1));
  check('攻撃ボタンで採集: 1.5 秒で 2 枚入り、採取点の印が消える', await untilSim(page, () => (window.__vh.sim.errand.bag['mat.gather.flatnagi_leaf'] ?? 0) === 2 && window.__vh.sim.errand.used.length === 1, 480));
  for (let i = 1; i < 4; i++) {
    await gatherAt(i);
    await page.evaluate(() => window.__vh.hub.pulse(1));
    await untilSim(page, (k) => window.__vh.sim.errand.used.length === k + 1, 480, i);
  }
  check('4 か所で 8 枚。「そろった。野営地の納品箱へ」', await untilSim(page, () => window.__vh.sim.errand.bag['mat.gather.flatnagi_leaf'] === 8 && /そろった。野営地の納品箱へ/.test(document.getElementById('hud').textContent), 300),
    await page.evaluate(() => JSON.stringify({ bag: window.__vh.sim.errand.bag, used: window.__vh.sim.errand.used, mode: window.__vh.sim.player.mode, hud: document.getElementById('hud').textContent.slice(0, 120) })));
  await page.evaluate(() => {
    const s = window.__vh.sim, d = s.errand.def.depot, p = s.player;
    p.pos = { x: d.x - 1.5, y: 0, z: d.z }; p.prevPos = { ...p.pos }; p.yaw = Math.PI / 2;
    window.__vh.view.cam.snap(p.yaw);
  });
  check('納品箱のそば: 攻撃ボタンが「納品」', await until(page, () => document.querySelector('.tbtn-main')?.textContent === '納品', 8000));
  await page.screenshot({ path: `${OUT}9z_errand_depot.png` });
  await page.evaluate(() => window.__vh.hub.pulse(1));
  check('納品すると達成（時計が止まる）。5 秒の帰還の後に結果: 納品しました・採ったもの 8（要る数 6）・余り 2 枚・240 通貨', await untilSim(page, () => {
    const h = window.__vh.sim.hunt;
    const t = document.getElementById('result').textContent;
    return h.phase === 'success' && h.reason === 'deliver' && !document.getElementById('result').hidden && /納品しました/.test(t) && /ヒラナギの葉 8（要る数 6）/.test(t) && /240 通貨/.test(t) && /納品の余り/.test(t);
  }, 1200), await page.evaluate(() => document.getElementById('result').textContent.slice(0, 200)));
  check('保存: 余りの 2 枚と通貨と達成回数（納品した 6 枚は入らない）', await until(page, () => {
    const d = window.__vh.save.doc;
    return d.classicBox.pouch.some(x=>x?.itemId==='mat.gather.flatnagi_leaf'&&x.count===2) && d.progress.questClears['quest.gather.001'] === 1 && d.money === 240;
  }, 20000));
  await page.screenshot({ path: `${OUT}9z_errand_result.png` });
  // 採掘: 道具を持って、3 回振る
  await page.evaluate(() => window.__vh.toBase());
  await until(page, () => !document.getElementById('base').hidden);
  await page.evaluate(() => window.__vh.startHunt('quest.mine.001'));
  await until(page, () => window.__vh.sim.errand && window.__vh.sim.tick > 5);
  await page.evaluate(() => {
    const s = window.__vh.sim, n = s.errand.def.nodes[0], p = s.player;
    s.areaId = n.areaId; p.pos = { x: n.x - 1.3, y: 0, z: n.z }; p.prevPos = { ...p.pos }; p.yaw = Math.PI / 2; p.drawn = false;
  });
  check('採掘: 礫の坂の鉱床で、攻撃ボタンが「採掘」', await until(page, () => document.querySelector('.tbtn-main')?.textContent === '採掘', 8000));
  await page.evaluate(() => window.__vh.hub.pulse(1));
  check('採掘の間だけ、右手に採掘道具。2.5 秒で風礫鉄鉱 2 個', await untilSim(page, () => window.__vh.sim.player.action?.def.actionId === 'player.common.mine' && window.__vh.view.hunter.tool.visible, 120)
    && await untilSim(page, () => window.__vh.sim.errand.bag['mat.ore.basin_iron'] === 2 && !window.__vh.view.hunter.tool.visible, 480));
  await ctx.close();
}

// ---- 見た目を変える（v0.28.0。ChatGPT のキャラメイク設計 #10。横向きスマホ相当・縦向き・キーボード） ----
{
  const { ctx, page } = await open({ width: 844, height: 390 }, true, '?hub=menu');
  await page.click('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  const entry = await page.evaluate(() => ({ btn: document.querySelector('.base-looks-open')?.textContent ?? '', note: document.querySelector('.base-looks-note')?.textContent ?? '', ap: window.__vh.save.doc.appearance, v: window.__vh.save.doc.schemaVersion }));
  check('見た目: 装備箱に「見た目を変える」。新しいデータは基準ハンター A（保存の版 6）', entry.btn === '見た目を変える' && /いまは基準ハンター A の姿/.test(entry.note) && entry.v === 6 && entry.ap.profile === 'legacy_hunter_a_v1' && entry.ap.dataVersion === 1, JSON.stringify(entry));
  await page.tap('.base-looks-open');
  await until(page, () => !document.getElementById('looks').hidden, 3000);
  await page.waitForTimeout(300);
  // 下見の向きと絵の印は描画のたびに当てる（遅い手元では 300ms では足りない）
  await until(page, () => !!window.__vh.view.portrait && window.__vh.view.hunter.maskLoaded, 15000);
  await nextFrames(page);
  const opened = await page.evaluate(() => {
    const v = window.__vh.view, h = v.hunter, pt = v.portrait;
    const small = [...document.querySelectorAll('#looks .looks-bar button, #looks .looks-view button, #looks .looks-tabs button, #looks .looks-choice, #looks .looks-slider .step')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length;
    return {
      tabs: [...document.querySelectorAll('.looks-tabs button')].map((b) => b.textContent).join(),
      baseHidden: document.getElementById('base').hidden, portrait: !!pt, facing: pt ? Math.abs(Math.atan2(Math.sin(h.root.rotation.y - pt.baseYaw - Math.PI), Math.cos(h.root.rotation.y - pt.baseYaw - Math.PI))) < 0.01 : false,
      mask: h.maskLoaded, small, sliders: document.querySelectorAll('.looks-slider').length, paused: window.__vh.sim.tick,
    };
  });
  check('開くと、施設の画面が隠れて、見た目の画面（見本・体型・肌・髪・顔・保存）。狩人はカメラの方を向き、肌と髪の印が読めている。押せる所は 44px 以上', opened.tabs === '見本,体型,肌,髪,顔,保存' && opened.baseHidden && opened.portrait && opened.facing && opened.mask && opened.small === 0 && opened.sliders === 8, JSON.stringify(opened));
  await page.screenshot({ path: `${OUT}9y_looks_open.png` });
  await page.tap('.looks-choice[data-choice="B03"]');
  await page.tap('.looks-tabs button[data-tab="skin"]');
  await page.tap('.looks-choice[data-choice="S10"]');
  await page.tap('.looks-tabs button[data-tab="hair"]');
  await page.tap('.looks-choice[data-choice="C09"]');
  await nextFrames(page);
  const drafted = await page.evaluate(() => ({ key: window.__vh.view.hunter.bodyShapeKey, c: window.__vh.view.hunter.lookColors, undo: document.querySelector('.looks-bar [data-act="undo"]').textContent, saved: window.__vh.save.doc.appearance.profile, rev: window.__vh.save.doc.revision, face: window.__vh.view.portrait?.focus }));
  check('体型 B03・肌 S10・髪 C09 を選ぶと、下見の狩人が替わる（髪の欄へ初めて入ると顔へ寄る）。保存はまだ A のまま', drafted.key.includes('muscleAmount:85') && !!drafted.c.skin && Math.abs(drafted.c.hair[0] - 0xc7 / 255) < 1e-6 && drafted.undo === '元に戻す（3）' && drafted.saved === 'legacy_hunter_a_v1' && drafted.rev === 0 && drafted.face === 'face', JSON.stringify(drafted));
  await page.screenshot({ path: `${OUT}9y_looks_face.png` });
  await page.tap('.looks-bar [data-act="undo"]');
  await nextFrames(page);
  const undone = await page.evaluate(() => ({ hair: window.__vh.view.hunter.lookColors.hair, redo: document.querySelector('.looks-bar [data-act="redo"]').disabled }));
  await page.tap('.looks-bar [data-act="redo"]');
  await nextFrames(page);
  const redone = await page.evaluate(() => !!window.__vh.view.hunter.lookColors.hair);
  check('元に戻すで髪の色が A に戻り、やり直すで C09 に戻る', undone.hair === null && !undone.redo && redone, JSON.stringify(undone));
  await page.tap('.looks-tabs button[data-tab="body"]');
  const slider = async () => page.evaluate(() => ({ v: document.querySelector('.looks-slider[data-axis="muscleAmount"] input[type="number"]').value, undo: document.querySelector('.looks-bar [data-act="undo"]').textContent, err: document.querySelector('.looks-field-error')?.textContent ?? '' }));
  await page.tap('.looks-slider[data-axis="muscleAmount"] .step:last-of-type');
  const plus = await slider();
  await page.fill('.looks-slider[data-axis="muscleAmount"] input[type="number"]', '150');
  await page.press('.looks-slider[data-axis="muscleAmount"] input[type="number"]', 'Enter');
  await page.waitForTimeout(100);
  const bad = await slider();
  check('筋肉量の ＋ で 86（1 操作）。数の欄に 150 を入れると「0〜100で入力してください」で、値は 86 のまま', plus.v === '86' && plus.undo === '元に戻す（4）' && bad.v === '86' && bad.err === '0〜100で入力してください' && bad.undo === '元に戻す（4）', JSON.stringify([plus, bad]));
  await page.tap('.looks-view button[data-view="compare"]');
  await nextFrames(page);
  const cmp = await page.evaluate(() => ({ key: window.__vh.view.hunter.bodyShapeKey, c: window.__vh.view.hunter.lookColors, undo: document.querySelector('.looks-bar [data-act="undo"]').textContent }));
  await page.tap('.looks-view button[data-view="compare"]');
  await nextFrames(page);
  const back = await page.evaluate(() => window.__vh.view.hunter.bodyShapeKey);
  check('比較: 編集開始時（A）を見せ、もう一度押すと現在。比較は履歴に入らない', cmp.key === 'A' && cmp.c.skin === null && cmp.c.hair === null && cmp.undo === '元に戻す（4）' && back.includes('muscleAmount:86'), JSON.stringify(cmp));
  const ready = await page.evaluate(() => {
    document.querySelector('.looks-tabs button[data-tab="hair"]').click();
    const h2 = document.querySelector('.looks-choice[data-choice="H02"]');
    document.querySelector('.looks-tabs button[data-tab="preset"]').click();
    const p2 = document.querySelector('.looks-choice[data-choice="P02"]');
    return { h2: !!h2 && h2.disabled && /準備中/.test(h2.textContent), p2: !!p2 && p2.disabled && /準備中/.test(p2.textContent) };
  });
  check('まだ作っていない髪型 H02・見本 P02 は「準備中」で押せない', ready.h2 && ready.p2, JSON.stringify(ready));
  await page.evaluate(() => {
    document.querySelector('.looks-tabs button[data-tab="body"]').click();
    document.querySelector('[data-lock="body"]').click();
    document.querySelector('.looks-tabs button[data-tab="skin"]').click();
    document.querySelector('[data-lock="skin"]').click();
    document.querySelector('.looks-tabs button[data-tab="hair"]').click();
    document.querySelector('[data-lock="hairColor"]').click();
  });
  await page.tap('.looks-bar [data-act="random"]');
  const locked = await page.evaluate(() => ({ msg: document.querySelector('.looks-status').textContent, undo: document.querySelector('.looks-bar [data-act="undo"]').textContent }));
  await page.evaluate(() => document.querySelector('[data-lock="hairColor"]').click());
  await page.tap('.looks-bar [data-act="random"]');
  await nextFrames(page);
  const rnd = await page.evaluate(() => ({ key: window.__vh.view.hunter.bodyShapeKey, undo: document.querySelector('.looks-bar [data-act="undo"]').textContent }));
  check('ランダム: 全部を固定すると「固定されていない項目がありません」。髪の色だけ外すと、体型は固定したまま（1 操作）', locked.msg === '固定されていない項目がありません。' && locked.undo === '元に戻す（4）' && rnd.key.includes('muscleAmount:86') && rnd.undo === '元に戻す（5）', JSON.stringify([locked, rnd]));
  await page.tap('.looks-bar [data-act="cancel"]');
  const ask = await page.evaluate(() => ({ t: document.querySelector('.looks-modal-box h3')?.textContent, focus: document.activeElement?.textContent }));
  await page.tap('.looks-modal-buttons button.go');
  check('変えた後のキャンセル: 「編集した見た目を破棄しますか？」（編集を続けるが先）。続けると、そのまま', ask.t === '編集した見た目を破棄しますか？' && ask.focus === '編集を続ける' && await page.evaluate(() => !document.getElementById('looks').hidden && document.querySelector('.looks-modal').hidden), JSON.stringify(ask));
  // 縦向き: 編集はできる（狩りは横向き）。「横向きにしてください」は出さない
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await nextFrames(page);
  const tall = await page.evaluate(() => {
    const st = document.querySelector('.looks-stage').getBoundingClientRect(), side = document.querySelector('.looks-side').getBoundingClientRect(), bar = document.querySelector('.looks-bar').getBoundingClientRect();
    return { rotate: getComputedStyle(document.getElementById('rotate')).display, stacked: st.bottom <= side.top + 1 && side.bottom <= bar.top + 1, h: window.__vh.view.portrait?.pane.h ?? 0 };
  });
  check('縦向き: 上に下見、下に選ぶ欄と操作。「横向きにしてください」は出ない', tall.rotate === 'none' && tall.stacked && tall.h > 0.2, JSON.stringify(tall));
  await page.screenshot({ path: `${OUT}9y_looks_portrait.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await page.tap('.looks-bar [data-act="confirm"]');
  const conf = await page.evaluate(() => [...document.querySelectorAll('.looks-changes li')].map((l) => l.textContent));
  check('確認へ: 変わる所を名前で（体型・肌・髪の色）。費用なし', conf.length === 3 && /^体型：A の体つき → 筋肉質（B03・調整あり）$/.test(conf[0]) && /^肌：A の肌 → 深いニュートラルブラウン（S10）$/.test(conf[1]) && /^髪の色：A の髪の色 → /.test(conf[2]), JSON.stringify(conf));
  await page.tap('.looks-modal-buttons button.go');
  check('この見た目に決定: 保存が完了してから装備箱へ戻り「見た目を保存しました。」。保存は custom（体型・肌・髪の色だけ）', await until(page, () => {
    const a = window.__vh.save.doc.appearance;
    return document.getElementById('looks').hidden && !document.getElementById('base').hidden && document.querySelector('.base-message').textContent === '見た目を保存しました。'
      && a.profile === 'custom_hunter_v1' && a.body.presetId === 'B03' && a.body.axes.muscleAmount === 86 && a.skin.colorId === 'S10' && /^C\d\d$/.test(a.hair.colorId) && !('face' in a) && window.__vh.save.doc.revision === 1
      && window.__vh.view.portrait === null && window.__vh.view.hunter.bodyShapeKey.includes('muscleAmount:86') && /いまの見た目: 体型 筋肉質/.test(document.querySelector('.base-looks-note').textContent);
  }, 20000), await page.evaluate(() => JSON.stringify(window.__vh.save.doc.appearance)));
  await page.reload();
  await page.waitForSelector('#boot-start:not([hidden])');
  await page.tap('#boot-start');
  await until(page, () => window.__vh && !document.getElementById('base').hidden);
  await page.waitForTimeout(300);
  check('読み込み直しても、決めた見た目で描く（体型・肌・髪）', await until(page, () => {
    const h = window.__vh.view.hunter;
    return window.__vh.save.doc.appearance.skin.colorId === 'S10' && h.bodyShapeKey.includes('muscleAmount:86') && !!h.lookColors.skin && !!h.lookColors.hair;
  }, 15000), await page.evaluate(() => window.__vh.view.hunter.bodyShapeKey));
  // もう一度開いて、A 全体へ → 破棄して戻る（保存は変わらない）。キーボードの元に戻す
  await page.tap('.base-looks-open');
  await until(page, () => !document.getElementById('looks').hidden, 3000);
  await page.tap('.looks-bar [data-act="legacy"]');
  const legacyAsk = await page.evaluate(() => [...document.querySelectorAll('.looks-changes li')].length);
  await page.tap('.looks-modal-buttons button.go');
  await nextFrames(page);
  const allA = await page.evaluate(() => ({ key: window.__vh.view.hunter.bodyShapeKey, c: window.__vh.view.hunter.lookColors }));
  await page.keyboard.press('Control+z');
  await nextFrames(page);
  const undoKey = await page.evaluate(() => window.__vh.view.hunter.bodyShapeKey);
  check('A全体へ: 変わる所 3 つを見せて当てる（下見は A）。Ctrl+Z で戻る', legacyAsk === 3 && allA.key === 'A' && allA.c.skin === null && allA.c.hair === null && undoKey.includes('muscleAmount:86'), JSON.stringify([legacyAsk, allA, undoKey]));
  await page.tap('.looks-bar [data-act="legacy"]');
  await page.tap('.looks-modal-buttons button.go');
  await page.tap('.looks-bar [data-act="cancel"]');
  await page.tap('.looks-modal-buttons button:not(.go)');
  check('破棄して戻ると、装備箱へ戻り、保存した見た目のまま（保存もしない）', await until(page, () => document.getElementById('looks').hidden && !document.getElementById('base').hidden && window.__vh.save.doc.revision === 1 && window.__vh.save.doc.appearance.skin.colorId === 'S10' && window.__vh.view.hunter.bodyShapeKey.includes('muscleAmount:86'), 4000));
  await ctx.close();
}

check('コンソールエラー・404 なし', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
