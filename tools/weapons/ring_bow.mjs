// 環弓（弓）の技と動き。左手で弓の握りを持ち、右手で弦を引く。
// 的に対して体を右へ開いた半身（左肩が的の方）で立ち、顔だけを的へ向ける。弓を上げながら引き分け、あごの横まで引く。
// v0.60.0 で 2G の組み立てへ（#19 の H03 の 01 の 5 章の表。docs/spec.md の 32.26、D-154。動きも 2G を手本に。D-150）:
// 主 = 溜め撃ち（溜めの段階ごとの射ち方は weapons.json の shots）、副 = 近接（矢で斬る → 突く。2 回まで）、主と副の同時押し = ビンを付ける・外す、
// 入力なしの回避 = 後ろへ跳ぶ（入力があれば転がる）。散らし撃ちは外した（射ち方の拡散へ）。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値（Kari の仮の値）。
import { B, curve, family, sheathOf } from './lib.mjs';

export function ringBow() {
  // 手首: 弓は前腕に対してほぼ直角に握る
  const hands = { primary: 'L', second: 'string', stringAt: [0.02, 0.17], stringFinger: 0.07, wrist: [35, 140] };
  const { fam, motion, trackOf, action, pose, snap } = family('ring_bow', hands, { from: -0.72, to: 0.72, radius: 0.015, maxTurn: 900 });
  // 弓は左手で持つ。握りは弓の中央、向きは弓の上。
  const BOW = { radius: 0.05, from: -0.75, to: 0.75 };
  // 背に負った時（握りが左の肩甲骨の上、上の先が左肩の外へ出る斜め）。弓の背は外を向く。
  const BACK = { grip: [0.2, 0.1, -0.19], dir: [0.45, 0.88, -0.1], edge: [0, 0.1, -1] };
  fam.sheath = sheathOf('chest', [0.2, 0.38, -0.19], BACK.dir, BACK.edge);
  /** 肩越しに背の弓へ手を伸ばす時の、ひじの向き（上・外・前） */
  const OVER = [0.5, 0.8, 0.5];
  /** 引き切った時の、右ひじの向き（矢の線の後ろ・少し上） */
  const DRAWN = [-0.3, 0.3, -0.9];
  /** 放した後の右手（胸の座標）: 開いて、右胸の前へ落ちる */
  const LOOSE = [-0.1, -0.12, 0.18];
  /** 右手が弦へ向かう途中に通る所（胸の座標。体の前を回す） */
  const VIA = [-0.24, -0.34, 0.26];

  // ---- 立ち姿 ----
  // 構え: 体を右へ開いて立ち、弓は左手で体の前に低く立てて持つ。右手は下げておく。
  const FEET = { L: [0.08, 0.22, -20], R: [-0.08, -0.22, -65] };
  const idle = (fam.stances.idle = pose({
    feet: FEET,
    hip: [0, -0.03, 0], hipR: [2, -40, 0], spine: [2, -8, 0], chest: [1, -10, 0],
    gripA: [0.26, 1.08, 0.36], dirA: [-0.3, 0.9, 0.3], edgeA: [0, -0.3, 1],
    off: [-0.235, -0.555, 0.07], on: [0],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge,
    off: [-0.235, -0.555, 0.07], on: [0], grab: [0],
  }));

  // 狙いの形（手は胸の座標）: 両肩を結ぶ線が的を向くまで体を開き、左腕を肩の線の少し前へ伸ばす。弓は立てる。
  // 矢の線は胸の前を通り、弦はあごの右へ来る。
  const AIM = { hip: [0, -0.04, 0], hipR: [2, -58, 0], spine: [1, -11, 0], chest: [0, -15, 0], grip: [0.72, 0.02, 0.15], dir: [0, 1, 0], edge: [1, 0, 0.1] };
  // 引き分ける前の形: 弓を胸の前に低く持ち、右手を弦に掛ける
  const PRE = { hip: [0, -0.04, 0], hipR: [2, -50, 0], spine: [1, -10, 0], chest: [0, -13, 0], grip: [0.4, -0.12, 0.36], dir: [-0.1, 0.99, 0.05], edge: [0.9, 0, 0.45] };
  /** 下げた腕の、ひじの向き（自動と同じ形。引き切った形へ滑らかに移すために書く） */
  const DOWN = [-0.8, -0.5, -0.2];
  /** 引き分けの途中の、ひじの向き（体の外を回って上がる） */
  const RISE = [-0.9, 0.1, -0.3];

  // ---- 射る ----
  // 弓を上げながら右手を弦に掛け、左腕を伸ばして引き分ける。押し続けると、さらに深く引く（溜め）。離して、右手は後ろへ抜ける。
  const shot = motion('rb_shot_01', {
    dur: 52, from: idle,
    keys: [
      { t: 2, off: VIA, on: [0], arrow: [0] },
      { t: 4, arrow: [1] },
      { t: 6, ...PRE, on: [1], pull: [0.03], elbowR: DOWN },
      { t: 10, elbowR: RISE },
      { t: 14, ...AIM, pull: [0.45], on: [1], elbowR: DRAWN },
      { t: 18, ...AIM, pull: [0.45], on: [1], arrow: [1], elbowR: DRAWN, off: LOOSE },
      { t: 19, pull: [0], on: [0], arrow: [0], off: LOOSE },
      { t: 22, elbowR: DOWN },
      { t: 30, ...AIM, off: LOOSE },
    ],
  });
  trackOf('rb_shot', BOW, shot);

  // ---- 近接（v0.60.0。2G の弓の ○。2 回まで）----
  // 矢を握った右手の判定: 手から矢じりの方（前腕の向き）へ 0.05〜0.6m
  const ARROW_HELD = { radius: 0.05, from: 0.05, to: 0.6 };
  // 握っていない tick（矢を抜く前・しまった後）は、右手の位置と前腕の向き（判定の区間の外なので当たらない）
  const held = (sv) => (sv.held ? [sv.held.pos, sv.held.dir] : [sv.frames.handR, B.vnorm(B.vsub(sv.frames.handR, sv.frames.elbowR))]);
  /** 矢筒（右の腰の後ろ。見た目の矢筒はまだ体に付いていない）へ右手を伸ばす所 */
  const QUIVER = [-0.27, 0.98, -0.16];
  /** 近接の間、弓は構えの握りのまま胸に付いて回る（胸の座標。体をひねっても左腕の形が変わらない） */
  const BOW_LOW = { grip: idle.ctl.grip, dir: idle.ctl.dir, edge: idle.ctl.edge };
  // 斬る: 右手で矢筒から矢を抜き（〜6）、右の肩の上へ振りかぶって（〜11）、右上から左下へ斬り下ろす（12〜17）
  const melee1 = motion('rb_melee1_01', {
    dur: 36, from: idle,
    keys: [
      { t: 3, offA: QUIVER, ...BOW_LOW },
      { t: 5, hold: [0] },
      { t: 6, hold: [1], offA: QUIVER },
      { t: 11, hip: [0, -0.06, 0], hipR: [3, -58, 0], spine: [3, -12, 0], chest: [1, -18, 0], offA: [-0.42, 1.52, 0.08] },
      { t: 12, offA: [-0.38, 1.5, 0.26] },
      { t: 15, hip: [0, -0.08, 0.02], hipR: [5, -30, 0], spine: [6, -4, 0], chest: [3, 2, 0], offA: [0.0, 1.22, 0.52] },
      { t: 17, hip: [0, -0.09, 0.03], hipR: [6, -18, 0], spine: [7, 0, 0], chest: [3, 8, 0], offA: [0.2, 1.0, 0.46] },
      { t: 24, hip: [0, -0.09, 0.03], hipR: [6, -20, 0], spine: [7, 0, 0], chest: [3, 7, 0], offA: [0.2, 1.0, 0.43], ...BOW_LOW },
      { t: 30, hip: [0, -0.05, 0], hipR: [3, -36, 0], offA: [-0.24, 0.98, -0.08] },
      { t: 31, hold: [1] },
      { t: 32, hold: [0] },
    ],
  });
  trackOf('rb_melee1', BOW, melee1);
  trackOf('rb_melee1_arrow', ARROW_HELD, melee1, held);
  // 突く: 斬った手を右の腰へ引き戻し（〜8）、右足を踏み出して、胸の高さを前へ突く（12〜17）
  curve('w_rb_stab', [[0, 0], [6, 0], [13, 0.2], [40, 0.2]]);
  const M1_SNAP = snap(melee1, 22);
  const melee2 = motion('rb_melee2_01', {
    dur: 40, from: M1_SNAP, root: 'w_rb_stab',
    keys: [
      { t: 8, hip: [0, -0.07, -0.02], hipR: [3, -56, 0], spine: [3, -11, 0], chest: [1, -16, 0], offA: [-0.3, 1.16, -0.02], ...BOW_LOW },
      { t: 12, offA: [-0.26, 1.2, 0.18] },
      { t: 15, hip: [0, -0.1, 0.05], hipR: [5, -24, 0], spine: [7, -2, 0], chest: [3, 6, 0], offA: [-0.14, 1.24, 0.58] },
      { t: 17, hip: [0, -0.1, 0.06], hipR: [6, -18, 0], spine: [7, 0, 0], chest: [3, 8, 0], offA: [-0.12, 1.25, 0.64] },
      { t: 25, hip: [0, -0.09, 0.05], hipR: [6, -20, 0], spine: [7, 0, 0], chest: [3, 7, 0], offA: [-0.14, 1.23, 0.58] },
      { t: 32, hip: [0, -0.05, 0], hipR: [3, -36, 0], offA: [-0.24, 0.98, -0.08] },
      { t: 33, hold: [1] },
      { t: 34, hold: [0] },
    ],
    feet: { R: [[6, 13, -0.1, -0.02, -45, 0.05], [27, 35, -0.08, -0.22, -65, 0.04]] },
  });
  trackOf('rb_melee2', BOW, melee2);
  trackOf('rb_melee2_arrow', ARROW_HELD, melee2, held);

  // ---- ビンを付ける・外す（v0.60.0。2G の弓の △+○）----
  // 右手を腰の袋へ下ろしてビンを取り（〜8）、弓を胸の前へ寄せて、握りの上へ差す（18〜24。24 で付く）。手を戻す
  const COAT_BOW = { gripA: [0.12, 1.14, 0.46], dirA: [-0.15, 0.97, 0.18], edgeA: [0.3, -0.2, 0.93] };
  const coat = motion('rb_coat_01', {
    dur: 44, from: idle,
    keys: [
      { t: 8, hip: [0, -0.05, 0], hipR: [2, -44, 0], spine: [4, -9, 0], chest: [2, -12, 0], offA: [-0.24, 0.9, 0.08] },
      { t: 14, hipR: [2, -24, 0], spine: [3, -4, 0], chest: [1, -3, 0], ...COAT_BOW, offA: [-0.1, 1.06, 0.38] },
      { t: 20, offA: [0.02, 1.16, 0.46], ...COAT_BOW },
      { t: 26, offA: [0.02, 1.16, 0.46], ...COAT_BOW },
      { t: 30, hipR: [2, -30, 0], offA: [-0.16, 1.0, 0.3] },
      { t: 34, hip: [0, -0.03, 0], hipR: [2, -40, 0], spine: [2, -8, 0], chest: [1, -10, 0], off: [-0.235, -0.555, 0.07] },
    ],
  });
  trackOf('rb_coat', BOW, coat);

  // ---- 後ろへ跳ぶ（入力なしの回避。v0.60.0。2G の弓のバックステップ）----
  // 沈んで両足で蹴り、弓を体の前に保ったまま低く後ろへ跳び、構えのまま着く
  curve('w_rb_backstep', [[0, 0], [4, 0.04], [19, 1.26], [23, 1.32], [30, 1.32]]);
  const backstep = motion('rb_backstep_01', {
    dur: 30, from: idle, root: 'w_rb_backstep',
    keys: [
      { t: 3, hip: [0, -0.18, 0], hipR: [8, -40, 0], spine: [8, -8, 0] },
      { t: 8, hip: [0, -0.03, 0], hipR: [2, -40, 0], spine: [2, -8, 0] },
      { t: 13, hip: [0, -0.02, 0], hipR: [3, -40, 0], spine: [4, -8, 0] },
      { t: 21, hip: [0, -0.17, 0], hipR: [9, -40, 0], spine: [9, -8, 0] },
    ],
    feet: { R: [[4, 20, -0.08, -0.22, -65, 0.12]], L: [[5, 21, 0.08, 0.22, -20, 0.12]] },
  });
  trackOf('rb_backstep', BOW, backstep);

  // ---- 抜刀・納刀 ----
  // 抜刀: 左手を肩越しに背の弓へ回し、肩の外を通して前へ下ろしながら、弓の背を的の方へ返す。納刀はその逆。
  const SIDE = { grip: [0.44, -0.02, 0.1], dir: [0.3, 0.95, 0.05], edge: [1, -0.3, 0] };
  const FRONT = { gripA: [0.3, 1.12, 0.32], dirA: [-0.05, 0.97, 0.22], edgeA: [0.4, -0.2, 0.9] };
  const draw = motion('rb_draw_01', {
    dur: 28, from: sheathed, skipBody: [0, 12],
    keys: [
      { t: 6, hipR: [1, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, elbowL: OVER },
      { t: 13, hipR: [2, -22, 0], ...SIDE },
      { t: 14, elbowL: [0, 0, 0] },
      { t: 20, hip: [0, -0.02, 0], hipR: [2, -34, 0], ...FRONT },
    ],
    feet: { L: [[8, 15, 0.08, 0.22, -20, 0.04]], R: [[15, 22, -0.08, -0.22, -65, 0.04]] },
  });
  trackOf('rb_draw', BOW, draw);
  const sheathe = motion('rb_sheathe_01', {
    dur: 32, from: idle, to: sheathed, skipBody: [16, 32],
    keys: [
      { t: 7, hipR: [2, -30, 0], ...FRONT },
      { t: 14, hipR: [2, -18, 0], ...SIDE },
      { t: 15, elbowL: [0, 0, 0] },
      { t: 23, hipR: [1, -8, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowL: OVER },
      { t: 24, grab: [1] },
      { t: 29, grab: [0], elbowL: [0, 0, 0] },
    ],
    feet: { R: [[4, 12, -0.095, 0, -4, 0.04]], L: [[13, 21, 0.095, 0, 4, 0.04]] },
  });
  trackOf('rb_sheathe', BOW, sheathe);

  // ---- 技のデータ ----
  const after = ['rb_shot', 'rb_melee1', 'rb_coat', 'roll'];
  // 引き絞り → 放つ。溜めの段階（0〜3）で、矢の速さと力（射撃の力の合計）が変わる。射ち方（連射・拡散・貫通）は武器と系統の shots（v0.60.0）。
  // 溜めている間はスタミナが減り、歩ける
  action('shot', { clip: 'rb_shot_01', dur: 52, active: [14, 19], track: 'rb_shot',
    charge: { holdTick: 14, button: 'main', levelTicks: [30, 70, 120], maxHoldTicks: 240, coefficientScale: [1, 1, 1, 1], hitstopBonus: [0, 0, 0, 0], staminaPerSec: 12 },
    shoot: [{ tick: 18, count: 1, spreadDeg: 0, speed: [26, 32, 40, 48], coefficient: [0.22, 0.58, 1.12, 1.85], table: true }],
    freeMove: { speed: 1.6, turnDegPerSec: 240, from: 0, to: 18 }, turn: [18, 240], sound: [18, 'orb_throw'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[14, 15, ['roll']], [32, 52, after]] });
  // 近接（v0.60.0）: 斬る → 突く（2 回まで）。矢で当てる（斬。刃の状態は無い）
  action('melee1', { clip: 'rb_melee1_01', dur: 36, active: [12, 17], track: 'rb_melee1', hits: [{ id: 'melee', track: 'rb_melee1_arrow', coef: 0.14 }], turn: [10, 300], sound: [11, 'hb_swing_02'], trail: false, cancels: [[20, 36, ['rb_melee2', 'rb_shot', 'rb_coat', 'roll']]] });
  action('melee2', { clip: 'rb_melee2_01', dur: 40, active: [12, 17], track: 'rb_melee2', hits: [{ id: 'melee', track: 'rb_melee2_arrow', coef: 0.18 }], curve: 'w_rb_stab', turn: [10, 240], sound: [11, 'hb_swing_02'], trail: false, cancels: [[26, 40, ['rb_shot', 'rb_coat', 'roll']]] });
  // ビンを付ける・外す（v0.60.0）: 24 tick で、付けていれば外し、無ければ持っているビンを付ける
  action('coat', { clip: 'rb_coat_01', dur: 44, track: 'rb_coat', coat: { tick: 24 }, sound: [24, 'hb_sheathe_01'], cancels: [[34, 44, ['rb_shot', 'rb_melee1', 'roll']]] });
  // 後ろへ跳ぶ（v0.60.0。入力なしの回避）
  action('backstep', { clip: 'rb_backstep_01', dur: 30, track: 'rb_backstep', curve: 'w_rb_backstep', staminaCost: 18, invulnerable: [{ from: 2, to: 10 }], sound: [3, 'roll_01'], cancels: [[22, 30, ['rb_shot', 'rb_melee1', 'roll']]], dodge: true });
  action('draw', { clip: 'rb_draw_01', dur: 28, track: 'rb_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'rb_sheathe_01', dur: 32, track: 'rb_sheathe', sound: [20, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
