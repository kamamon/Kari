// 環弓（弓）の技と動き。左手で弓の握りを持ち、右手で弦を引く。
// 的に対して体を右へ開いた半身（左肩が的の方）で立ち、顔だけを的へ向ける。弓を上げながら引き分け、あごの横まで引く。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function ringBow() {
  // 手首: 弓は前腕に対してほぼ直角に握る
  const hands = { primary: 'L', second: 'string', stringAt: [0.02, 0.17], stringFinger: 0.07, wrist: [35, 140] };
  const { fam, motion, trackOf, action, pose } = family('ring_bow', hands, { from: -0.72, to: 0.72, radius: 0.015, maxTurn: 900 });
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
  void curve;

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

  // ---- 散らし（3 本を一度に）----
  // 弓を右へ倒して（矢を 3 本並べて載せられる向き）、浅く速く引いて放つ。
  const CANT = { hip: [0, -0.05, 0], hipR: [3, -58, 0], spine: [3, -11, 0], chest: [1, -15, 0], grip: [0.7, -0.06, 0.17], dir: [0, 0.8, 0.6], edge: [1, 0, 0.1] };
  const spread = motion('rb_spread_01', {
    dur: 46, from: idle,
    keys: [
      { t: 2, off: VIA, on: [0], arrow: [0] },
      { t: 4, arrow: [1] },
      { t: 6, ...PRE, dir: [-0.1, 0.9, 0.42], on: [1], pull: [0.03], elbowR: DOWN },
      { t: 9, elbowR: [-0.95, 0.25, 0] },
      { t: 13, ...CANT, pull: [0.4], on: [1], elbowR: DRAWN },
      { t: 16, ...CANT, pull: [0.4], on: [1], arrow: [1], elbowR: DRAWN, off: LOOSE },
      { t: 17, pull: [0], on: [0], arrow: [0], off: LOOSE },
      { t: 20, elbowR: DOWN },
      { t: 27, ...CANT, off: LOOSE },
    ],
  });
  trackOf('rb_spread', BOW, spread);

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
  const after = ['rb_shot', 'rb_spread', 'roll'];
  // 引き絞り → 放つ。溜めの段階（0〜3）で、矢の速さと威力が変わる。溜めている間はスタミナが減り、歩ける。
  action('shot', { clip: 'rb_shot_01', dur: 52, active: [14, 19], track: 'rb_shot',
    charge: { holdTick: 14, button: 'main', levelTicks: [30, 70, 120], maxHoldTicks: 240, coefficientScale: [1, 1, 1, 1], hitstopBonus: [0, 0, 0, 0], staminaPerSec: 12 },
    shoot: [{ tick: 18, count: 1, spreadDeg: 0, speed: [26, 32, 40, 48], coefficient: [0.22, 0.58, 1.12, 1.85] }],
    freeMove: { speed: 1.6, turnDegPerSec: 240, from: 0, to: 18 }, turn: [18, 240], sound: [18, 'orb_throw'], events: [{ tick: 3, type: 'sound', id: 'hb_draw_01' }], cancels: [[14, 15, ['roll']], [32, 52, after]] });
  action('spread', { clip: 'rb_spread_01', dur: 46, active: [12, 17], track: 'rb_spread',
    shoot: [{ tick: 16, count: 3, spreadDeg: 16, speed: [30], coefficient: [0.17] }], turn: [14, 300], sound: [16, 'orb_throw'], cancels: [[30, 46, after]] });
  action('draw', { clip: 'rb_draw_01', dur: 28, track: 'rb_draw', sound: [4, 'hb_draw_01'] });
  action('sheathe', { clip: 'rb_sheathe_01', dur: 32, track: 'rb_sheathe', sound: [20, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
