// 長尖槍（ランス）の技と動き。右手に槍（全長 2.9m。握りから穂先まで 2.36m、石突まで 0.54m）、左腕に大盾。
// 槍は右の脇に抱え（石突が脇の下を通る）、腰の回転と踏み込みで突く。盾は体の前から外さない。
// 座標はアクターのローカル（m、Y 上、+Z 前、+X 左）。数値は机上の初期値。
import { curve, family, sheathOf } from './lib.mjs';

export function longLance() {
  // 手首: 抱えた槍は前腕とほぼ同じ向きになる
  const hands = { primary: 'R', second: 'shield', shieldGrip: [-0.118, 0.033, -0.045], wrist: [0, 142] };
  const { fam, motion, trackOf, action, pose } = family('long_lance', hands, { from: 0.3, to: 2.36, radius: 0.03, maxTurn: 900 });
  const TIP = { radius: 0.1, from: 0.9, to: 2.36 };
  // 背に立てて負った時の、握りの位置と槍の向き（胸の座標）。握りが右の肩甲骨の上、穂先は真上。背と、背負った大盾のあいだに通る。
  const BACK = { grip: [-0.16, 0.14, -0.17], dir: [0.06, 0.995, -0.05], edge: [0, 0.05, 0.99] };
  fam.sheath = sheathOf('chest', [-0.16, 0.42, -0.17], BACK.dir, BACK.edge);
  /** 肩越しに背の槍へ手を伸ばす時の、ひじの向き（上・外・前） */
  const OVER = [-0.5, 0.8, 0.5];
  /** 背の盾へ左手を伸ばす所 */
  const SHIELD_REACH = [0.3, 1.66, -0.06];
  /** 左手が、下げた位置と背の盾のあいだで通る所（肩の外を回す） */
  const VIA = [0.46, 1.42, 0.18];
  /** 背から槍を体の右へ出す途中（手は肩の外を通る） */
  const AROUND = { grip: [-0.4, 0.16, 0.08], dir: [0.05, 0.98, 0.15], edge: [0, -0.15, 0.98], elbowR: [-0.8, 0.4, 0.1] };
  const E = [0, -1, 0]; // 槍に刃の向きは無いので、下に固定する
  const SHIELD_ELBOW = [0.85, -0.5, 0.15];
  /** 盾を背から左腕へ移した時の、左ひじの向き（真下。ひじを脇に付けて前腕を前へ水平に出し、盾を立てたまま体の横に持つ） */
  const SIDE_ELBOW = [0.25, -0.95, -0.2];

  // ---- 立ち姿 ----
  // 構え: 左足が前。腰を落として盾を体の前に立て、槍は右の脇に抱えて穂先を少し上げる。
  const idle = (fam.stances.idle = pose({
    feet: { L: [0.1, 0.22, 6], R: [-0.15, -0.22, -45] },
    hip: [0, -0.08, 0], hipR: [4, -34, 0], spine: [5, -4, 0], chest: [2, -4, 0],
    gripA: [-0.3, 1.02, 0.1], dirA: [0.06, 0.07, 1], edgeA: E,
    offA: [-0.02, 1.1, 0.36], offNA: [0.12, 0, 1], elbowL: SHIELD_ELBOW, on: [1],
  }));
  // 防御: さらに腰を落とし、盾の陰に体を入れる。槍は引いて盾の縁に沿わせる。
  const guard = (fam.stances.guard = pose({
    feet: { L: [0.1, 0.24, 6], R: [-0.16, -0.24, -48] },
    hip: [0, -0.17, -0.02], hipR: [8, -36, 0], spine: [9, -4, 0], chest: [4, -4, 0], look: [0, -3],
    gripA: [-0.32, 0.95, -0.02], dirA: [0.06, 0.1, 1], edgeA: E,
    offA: [-0.05, 1.14, 0.36], offNA: [0.05, 0.05, 1], elbowL: SHIELD_ELBOW, on: [1],
  }));
  const sheathed = (fam.stances.sheathed = pose({
    feet: { L: [0.095, 0, 4], R: [-0.095, 0, -4] },
    grip: BACK.grip, dir: BACK.dir, edge: BACK.edge,
    off: [0.235, -0.555, 0.07], offNA: [1, 0, 0], on: [0], grab: [0],
  }));

  curve('w_lunge_200', [[0, 0], [8, 0], [42, 2.0], [48, 2.05], [66, 2.05]]);
  curve('w_hop_120', [[0, 0], [4, 0.04], [20, 1.16], [24, 1.2], [26, 1.2]]);

  /**
   * 突き。溜め（槍を引いて腰を右へ）→ 腰を左へ回しながら腕を伸ばす → 止める → 戻す。
   * o = { dur, a0, a1, from, to, step（左足の出し方）, reach（伸ばした握りの位置）, aim（槍の向き）, back（引いた握りの位置）, low（腰の落とし）}
   */
  const thrust = (clip, o) => {
    const { a0, a1 } = o;
    const low = o.low ?? 0;
    return motion(clip, {
      dur: o.dur, from: o.from ?? idle, to: o.to, root: o.root,
      keys: [
        { t: a0 - 5, hip: [0, -0.09 - low, -0.04], hipR: [4, -44, 0], spine: [5, -6, 0], chest: [2, -8, 0], gripA: o.back, dirA: o.aim, edgeA: E, offA: o.shield ?? [-0.02, 1.1, 0.38] },
        { t: a0, hip: [0, -0.1 - low, 0.01], hipR: [6, -28, 0], spine: [6, -3, 0], chest: [3, -2, 0], gripA: [(o.back[0] + o.reach[0]) / 2 - 0.02, (o.back[1] + o.reach[1]) / 2, o.back[2] * 0.45 + o.reach[2] * 0.55], dirA: o.aim, edgeA: E },
        { t: a1 - 2, hip: [0, -0.11 - low, 0.07], hipR: [8, -10, 0], spine: [8, 2, 0], chest: [4, 8, 0], gripA: o.reach, dirA: o.aim, edgeA: E, offA: o.shieldEnd ?? [0.06, 1.08, 0.34] },
        { t: a1 + 5, hip: [0, -0.11 - low, 0.06], hipR: [8, -12, 0], spine: [8, 2, 0], chest: [4, 7, 0], gripA: [o.reach[0], o.reach[1], o.reach[2] - 0.03], dirA: o.aim, edgeA: E, offA: o.shieldEnd ?? [0.06, 1.08, 0.34] },
      ],
      feet: o.feet,
    });
  };
  const STEP15 = { L: [[3, 9, 0.1, 0.255, 6, 0.04]], R: [[22, 29, -0.15, -0.22, -45, 0.04]] };

  // ---- 突き（3 連まで同じ動き）----
  const t1 = thrust('ll_thrust_01', { dur: 38, a0: 10, a1: 15, root: 'w_step_015', back: [-0.33, 1.05, -0.12], reach: [-0.2, 1.12, 0.52], aim: [0.02, 0.02, 1], feet: STEP15 });
  trackOf('ll_thrust', TIP, t1);
  // ---- 上段突き: 穂先を上げて、高い所を突く ----
  const high = thrust('ll_high_01', { dur: 42, a0: 12, a1: 17, root: 'w_step_015', back: [-0.33, 0.98, -0.1], reach: [-0.2, 1.3, 0.46], aim: [0.02, 0.42, 0.91], feet: { L: [[4, 10, 0.1, 0.255, 6, 0.04]], R: [[24, 31, -0.15, -0.22, -45, 0.04]] } });
  trackOf('ll_high', TIP, high);
  // ---- 構え突き: 盾の陰から、腰を落としたまま短く突く ----
  const gt = thrust('ll_guard_thrust_01', { dur: 44, a0: 14, a1: 19, from: guard, to: guard, low: 0.07, back: [-0.34, 0.96, -0.12], reach: [-0.24, 1.02, 0.4], aim: [0.03, 0.04, 1], shield: [-0.05, 1.14, 0.36], shieldEnd: [-0.02, 1.13, 0.36] });
  trackOf('ll_guard_thrust', TIP, gt);
  // ---- 受け返しの構え: 盾を前に据え、槍を深く引いて待つ ----
  const BRACE = { hip: [0, -0.2, -0.04], hipR: [9, -44, 0], spine: [10, -6, 0], chest: [4, -8, 0], gripA: [-0.36, 0.95, -0.16], dirA: [0.06, 0.16, 1], edgeA: E, offA: [-0.04, 1.14, 0.38], offNA: [0, 0.05, 1] };
  const counter = motion('ll_counter_01', {
    dur: 60, from: guard, to: guard,
    keys: [{ t: 6, ...BRACE }, { t: 52, ...BRACE }],
  });
  trackOf('ll_counter', TIP, counter);
  // ---- 受け返しの突き: 受けた勢いを腰で返し、大きく踏み込んで突き抜く ----
  const ct = thrust('ll_counter_thrust_01', { dur: 44, a0: 9, a1: 15, from: pose({ feet: { L: [0.1, 0.24, 6], R: [-0.16, -0.24, -48] }, on: [1], elbowL: SHIELD_ELBOW, ...BRACE }), root: 'w_step_030', back: [-0.36, 0.98, -0.16], reach: [-0.18, 1.14, 0.56], aim: [0.01, 0.05, 1], low: 0.03, feet: { L: [[5, 13, 0.1, 0.32, 6, 0.05]], R: [[24, 32, -0.15, -0.22, -45, 0.05]] } });
  trackOf('ll_counter_thrust', TIP, ct);

  // ---- 突進突き（抜刀攻撃）----
  // 背の槍を取りながら 4 歩走り込み、穂先を前へ倒して脇に抱え、最後の 1 歩で突く。
  const lunge = motion('ll_lunge_01', {
    dur: 66, from: sheathed, root: 'w_lunge_200', skipBody: [0, 16],
    keys: [
      { t: 3, offA: VIA },
      { t: 7, hip: [0, -0.04, 0.03], hipR: [10, -6, 0], spine: [6, -4, 0], chest: [2, -8, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, elbowR: OVER, on: [0] },
      { t: 9, off: [0.3, 0.22, -0.04], elbowL: [0.5, 0.8, 0.5] },
      { t: 12, ...AROUND },
      { t: 13, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 14, on: [0] },
      { t: 15, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 16, hip: [0, -0.06, 0.04], hipR: [10, -16, 0], spine: [6, -4, 0], chest: [2, -6, 0], grip: [-0.3, 0.06, 0.12], dir: [0.03, 0.9, 0.44], edge: [0, -0.44, 0.9] },
      { t: 17, elbowR: [0, 0, 0] },
      { t: 24, hip: [0, -0.08, 0.04], hipR: [10, -28, 0], spine: [6, -4, 0], chest: [2, -6, 0], gripA: [-0.33, 1.04, -0.06], dirA: [0.04, 0.42, 0.9], edgeA: E, offA: [0.04, 1.1, 0.32], offNA: [0.3, 0, 1] },
      { t: 30, hip: [0, -0.1, 0.02], hipR: [10, -40, 0], spine: [7, -5, 0], chest: [3, -7, 0], gripA: [-0.34, 1.04, -0.12], dirA: [0.03, 0.06, 1], edgeA: E, offA: [-0.02, 1.1, 0.36], offNA: [0.12, 0, 1] },
      { t: 36, hip: [0, -0.12, 0.06], hipR: [11, -22, 0], spine: [8, -1, 0], chest: [4, 2, 0], gripA: [-0.26, 1.08, 0.24], dirA: [0.02, 0.04, 1], edgeA: E },
      { t: 41, hip: [0, -0.14, 0.1], hipR: [12, -8, 0], spine: [10, 3, 0], chest: [5, 9, 0], gripA: [-0.18, 1.1, 0.56], dirA: [0.01, 0.03, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
      { t: 49, hip: [0, -0.14, 0.09], hipR: [11, -10, 0], spine: [10, 3, 0], chest: [5, 8, 0], gripA: [-0.18, 1.1, 0.53], dirA: [0.01, 0.03, 1], edgeA: E, offA: [0.08, 1.06, 0.3] },
    ],
    feet: {
      R: [[4, 14, -0.11, 0.3, -8, 0.07], [24, 36, -0.12, 0.2, -10, 0.08], [50, 59, -0.15, -0.22, -45, 0.05]],
      L: [[12, 27, 0.1, 0.34, 5, 0.08], [33, 43, 0.1, 0.25, 6, 0.07]],
    },
  });
  trackOf('ll_lunge', TIP, lunge);

  // ---- 跳び（回避）----
  // 沈んで両足で地面を蹴り、低く短く跳んで、構えのまま着く。向きは回避の入力で決まる（体の解き方は同じ）。
  const hop = motion('ll_hop_01', {
    dur: 26, from: idle, root: 'w_hop_120',
    keys: [
      { t: 4, hip: [0, -0.2, 0], hipR: [10, -34, 0], spine: [9, -4, 0] },
      { t: 8, hip: [0, -0.04, 0], hipR: [2, -34, 0], spine: [3, -4, 0] },
      { t: 13, hip: [0, -0.02, 0], hipR: [4, -34, 0], spine: [5, -4, 0] },
      { t: 20, hip: [0, -0.19, 0], hipR: [11, -34, 0], spine: [10, -4, 0] },
    ],
    feet: { R: [[5, 18, -0.15, -0.22, -45, 0.1]], L: [[6, 19, 0.1, 0.22, 6, 0.1]] },
  });
  trackOf('ll_hold', TIP, hop);

  // ---- 抜刀・納刀 ----
  // 抜刀: 右手を腰の後ろへ回して槍を取り、体の右へ立てて抜き、穂先を前へ倒して脇に抱える。左手は背の盾を取る。
  const UP = { grip: [-0.3, 0.06, 0.12], dir: [0.03, 0.9, 0.44], edge: [0, -0.44, 0.9] };
  const LOWER = { gripA: [-0.32, 1.1, 0.04], dirA: [0.05, 0.5, 0.86], edgeA: E };
  const draw = motion('ll_draw_01', {
    dur: 34, from: sheathed, skipBody: [0, 14],
    keys: [
      { t: 3, offA: VIA },
      { t: 7, hipR: [2, -8, 0], chest: [0, -6, 0], grab: [1], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, elbowR: OVER, on: [0] },
      { t: 9, offA: SHIELD_REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 12, ...AROUND },
      { t: 12, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 13, on: [0] },
      { t: 14, on: [1], offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW },
      { t: 16, hipR: [3, -18, 0], ...UP },
      { t: 17, elbowR: [0, 0, 0] },
      { t: 25, hip: [0, -0.06, 0], hipR: [4, -30, 0], ...LOWER, offA: [0.06, 1.12, 0.3], offNA: [0.4, 0, 1] },
    ],
    feet: { L: [[10, 18, 0.1, 0.22, 6, 0.04]], R: [[19, 26, -0.15, -0.22, -45, 0.04]] },
  });
  trackOf('ll_draw', TIP, draw);
  const sheathe = motion('ll_sheathe_01', {
    dur: 40, from: idle, to: sheathed, skipBody: [22, 40],
    keys: [
      { t: 8, hipR: [4, -24, 0], ...LOWER, offA: [0.22, 1.16, 0.3], offNA: [1, 0, 0.2], elbowL: SIDE_ELBOW, on: [1] },
      { t: 9, on: [0] },
      { t: 12, offA: [0.48, 1.36, 0.1], elbowL: [0.9, 0.1, 0] },
      { t: 15, offA: SHIELD_REACH, elbowL: [0.5, 0.8, 0.5] },
      { t: 18, hipR: [3, -14, 0], ...UP },
      { t: 22, offA: VIA },
      { t: 23, ...AROUND },
      { t: 28, hipR: [2, -8, 0], chest: [0, -6, 0], grip: BACK.grip, dir: BACK.dir, edge: BACK.edge, grab: [1], elbowR: OVER },
      { t: 29, grab: [1] },
      { t: 34, grab: [0], elbowR: [0, 0, 0] },
    ],
    feet: { R: [[5, 13, -0.095, 0, -4, 0.04]], L: [[15, 23, 0.095, 0, 4, 0.04]] },
  });
  trackOf('ll_sheathe', TIP, sheathe);

  // ---- 技のデータ ----
  const stab = (t, coef, o = {}) => [{ id: 'tip', track: t, coef, hitstop: 3, ...o }];
  const chain = (name, coef, next) =>
    action(name, { clip: 'll_thrust_01', dur: 38, active: [10, 15], track: 'll_thrust', hits: stab('ll_thrust', coef), curve: 'w_step_015', turn: [8, 120], sound: [9, 'hb_swing_02'], cancels: [[18, 38, [...next, 'roll']]] });
  chain('thrust1', 0.5, ['ll_thrust2', 'll_high']);
  chain('thrust2', 0.5, ['ll_thrust3', 'll_high']);
  chain('thrust3', 0.62, []);
  action('high', { clip: 'll_high_01', dur: 42, active: [12, 17], track: 'll_high', hits: stab('ll_high', 0.55), curve: 'w_step_015', turn: [10, 120], sound: [11, 'hb_swing_02'], cancels: [[22, 42, ['ll_thrust1', 'roll']]] });
  // 構え突き: 突いている間も防御が有効
  action('guard_thrust', { clip: 'll_guard_thrust_01', dur: 44, active: [14, 19], track: 'll_guard_thrust', hits: stab('ll_guard_thrust', 0.36, { hitstop: 2 }), guardWindows: [{ from: 0, to: 44 }], sound: [13, 'hb_swing_02'], cancels: [[30, 44, ['roll']]] });
  // 受け返し: 構えの間に正面から受けると、無傷で大きな突きを返す
  action('counter', { clip: 'll_counter_01', dur: 60, track: 'll_counter', staminaCost: 15, counter: { from: 4, to: 50, into: 'player.long_lance.counter_thrust' }, sound: [2, 'guard'] });
  action('counter_thrust', { clip: 'll_counter_thrust_01', dur: 44, active: [9, 15], track: 'll_counter_thrust', hits: stab('ll_counter_thrust', 1.6, { hitstop: 7 }), curve: 'w_step_030', sound: [8, 'hb_swing_01'], invulnerable: [{ from: 0, to: 9 }], cancels: [[28, 44, ['ll_thrust1', 'roll']]] });
  action('lunge', { clip: 'll_lunge_01', dur: 66, active: [34, 46], track: 'll_lunge', hits: stab('ll_lunge', 0.7, { hitstop: 5 }), curve: 'w_lunge_200', turn: [20, 90], sound: [32, 'hb_swing_01'], events: [{ tick: 4, type: 'sound', id: 'hb_draw_01' }], cancels: [[52, 66, ['ll_thrust1', 'roll']]] });
  // 短い跳び（回避）。続けてもう 1 回跳べる。
  action('hop', { clip: 'll_hop_01', dur: 26, track: 'll_hold', curve: 'w_hop_120', staminaCost: 14, invulnerable: [{ from: 3, to: 11 }], sound: [3, 'roll_01'], cancels: [[18, 26, ['roll']]], dodge: true });
  action('draw', { clip: 'll_draw_01', dur: 34, track: 'll_draw', sound: [5, 'hb_draw_01'] });
  action('sheathe', { clip: 'll_sheathe_01', dur: 40, track: 'll_sheathe', sound: [28, 'hb_sheathe_01'], finish: 'sheathed_idle' });
}
