// 武器の技・軌道・体の動きを作る道具の共通部分。tools/gen-weapons.mjs が使う。
// 体の動きは「いつ・体をどうするか」のキーで書き、ここで解いて（src/render/bodySolve.ts）、
//   - 判定に使う武器の軌道（public/data/tracks）
//   - 描画に使う体の動き（src/render/weaponClipSpecs.ts）
// の両方を同じ値から作る。人にできる範囲かどうか（src/render/humanLimits.ts）も、ここで全 tick を調べる。
import * as B from '../../src/render/bodySolve.ts';
import { checkFrame, checkSpeed, toAction, yawOf } from '../../src/render/humanLimits.ts';

export { B };
export const D2R = Math.PI / 180;
export const r4 = (n) => Math.round(n * 10000) / 10000;
export const v3 = (v) => v.map(r4);

const BODY = ['hip', 'hipR', 'spine', 'chest', 'look', 'elbowR', 'elbowL', 'pull', 'on', 'arrow', 'grab'];
const HAND_POS = ['grip', 'off'];
const HAND_DIR = ['dir', 'edge', 'offN', 'offE'];

export const state = { curves: [], motions: {}, stances: {}, out: {}, clips: new Map(), problems: [] };

/** 移動曲線。keys は [tick, 累積距離 m] */
export const curve = (id, keys) => (state.curves.push({ id, keys }), id);
export const curveKeys = (id) => state.curves.find((c) => c.id === id).keys;

/** アクターの座標で書いた手の値（名前の末尾が A）を、その時の胸の座標へ直す */
function toChest(key, ctl, fL, fR, hands) {
  const f = B.chestFrame(ctl, fL, fR, hands);
  const qi = B.qconj(f.q);
  const o = {};
  for (const c of HAND_POS) {
    if (key[c + 'A']) o[c] = B.qrot(qi, B.vsub(key[c + 'A'], f.sc));
    else if (key[c]) o[c] = key[c];
  }
  for (const c of HAND_DIR) {
    if (key[c + 'A']) o[c] = B.qrot(qi, B.vnorm(key[c + 'A']));
    else if (key[c]) o[c] = B.vnorm(key[c]);
  }
  return o;
}

/** 立ち姿（構え）を作る。def は Ctl の値（手はアクターの座標で書いてよい）と feet: { L, R }。 */
export function pose(hands, def, baseCtl) {
  const ctl = B.fillCtl({ ...(baseCtl ?? {}) });
  for (const c of BODY) if (def[c]) ctl[c] = def[c].slice();
  const fL = [def.feet.L[0], 0, def.feet.L[1], def.feet.L[2] ?? 0, 0];
  const fR = [def.feet.R[0], 0, def.feet.R[1], def.feet.R[2] ?? 0, 0];
  Object.assign(ctl, toChest(def, ctl, fL, fR, hands));
  return { ctl, feet: { L: fL, R: fR } };
}

/** 納めた時の武器の置き場所: どの骨に付くか、その骨の座標での握りの位置、武器の向き、刃（弓は弓の背）の向く方 */
export function sheathOf(parent, pos, dir, edge) {
  const d = B.vnorm(dir);
  const e = B.vnorm(B.vsub(edge, B.vmul(d, B.vdot(edge, d))));
  return { parent, pos, dir: d, normal: B.vnorm(B.vcross(e, d)) };
}

/** 武器系統を始める。 */
export function family(id, hands, shape) {
  state.out[id] = { actions: [], tracks: [] };
  const F = state.out[id];
  const fam = { id, hands, shape, stances: {} };
  state.stances[id] = fam;

  /** 軌道。keys は [tick, 握り, 向き] */
  const track = (tid, o, keys) => {
    F.tracks.push({ id: tid, radius: o.radius, from: o.from, to: o.to, planeNormal: o.normal ?? [1, 0, 0], keys: keys.map(([t, grip, dir]) => ({ t, grip: v3(grip), dir: v3(B.vnorm(dir)) })) });
    return tid;
  };

  /**
   * 体の動き。o = { dur, from, to, root, spin, keys, feet }
   *  from / to: 始まりと終わりの姿（pose() か snap() の結果。to を null にすると、最後のキーのまま終わる）
   *  keys: [{ t, hip, hipR, spine, chest, look, gripA, dirA, edgeA, offA, offNA, elbowR, elbowL, pull, on, arrow }]
   *  feet: { L: [[離す, 着く, x, z, つま先, 高さ, 軸足]...], R: [...] }
   */
  const motion = (clip, o) => {
    const from = o.from, to = o.to === undefined ? fam.stances.idle : o.to;
    // skipBody: 武器が体に触れていてよい区間（背や腰に納めてある間・抜き差しの間）
    const m = { dur: o.dur, family: id, base: from.ctl, skipBody: o.skipBody ?? null, ...(o.root ? { root: curveKeys(o.root) } : {}), ...(o.spin ? { spin: o.spin } : {}), ch: {}, feet: { L: [], R: [] } };
    for (const S of ['L', 'R']) {
      const f0 = from.feet[S];
      m.feet[S] = [[0, 0, f0[0], f0[2], f0[3]], ...((o.feet && o.feet[S]) ?? [])];
      for (let i = 1; i < m.feet[S].length; i++) if (m.feet[S][i][0] < m.feet[S][i - 1][1]) throw new Error(`${clip}: 足 ${S} の ${i} 歩目が、前の歩が着く前に始まっている`);
    }
    const all = [{ t: 0, ...from.ctl, _c: true }, ...o.keys.map((k) => ({ ...k })), ...(to ? [{ t: o.dur, ...to.ctl, _c: true }] : [])].sort((a, b) => a.t - b.t);
    // 体のチャンネル
    for (const c of BODY) {
      const ks = all.filter((k) => k[c]).map((k) => [k.t, ...k[c]]);
      if (ks.some((k) => k.slice(1).some((x, i) => Math.abs(x - ks[0][i + 1]) > 1e-9))) m.ch[c] = ks;
    }
    // 手のチャンネル: キーの時刻での体を解いて、胸の座標へ直す
    const body = (t) => B.evalMotion(m, t);
    const hk = { grip: [], dir: [], edge: [], off: [], offN: [], offE: [] };
    for (const k of all) {
      const e = body(k.t);
      const conv = k._c ? k : toChest(k, e.ctl, e.footL, e.footR, hands);
      for (const c of Object.keys(hk)) if (conv[c]) hk[c].push([k.t, ...conv[c]]);
    }
    for (const c of Object.keys(hk)) if (hk[c].length > 0) m.ch[c] = hk[c];
    // 向きのキーが離れすぎていないか（離れていると、補間の途中で向きが潰れる）
    for (const c of HAND_DIR) {
      const ks = m.ch[c] ?? [];
      for (let i = 1; i < ks.length; i++) {
        const a = B.vangle(ks[i - 1].slice(1), ks[i].slice(1));
        if (a > 115) state.problems.push(`${clip}: ${c} のキー ${ks[i - 1][0]} → ${ks[i][0]} が ${a.toFixed(0)}° 離れている（あいだにキーを足す）`);
      }
    }
    for (const c of Object.keys(m.ch)) m.ch[c] = m.ch[c].map((k) => k.map(r4));
    state.motions[clip] = m;
    return m;
  };

  /** 動き m の tick t を解く */
  const solve = (m, t, dirAngle = 0) => {
    const e = B.evalMotion(m, t, dirAngle);
    return B.solveBody(e.ctl, e.footL, e.footR, hands);
  };
  /** 動き m の tick t の姿を、次の動きの始まりに使える形で取り出す（足は、その時に着いている場所） */
  const snap = (m, t) => {
    const e = B.evalMotion(m, t);
    return { ctl: e.ctl, feet: { L: [e.footL[0], 0, e.footL[2], e.footL[3], 0], R: [e.footR[0], 0, e.footR[2], e.footR[3], 0] } };
  };
  /** 動きから、武器の軌道を作る（毎 tick）。pick は 解いた結果 → [握り, 向き] */
  const trackOf = (tid, o, m, pick = (s) => [s.weapon.grip, s.weapon.dir]) => {
    const keys = [];
    for (let t = 0; t <= m.dur; t++) keys.push([t, ...pick(solve(m, t))]);
    return track(tid, o, keys);
  };

  /** 技。active = [有効判定の始まり, 終わり]。hits は時間枠ごとの上書き。 */
  const action = (name, o) => {
    const actionId = `player.${id}.${name}`;
    const [a0, a1] = o.active ?? [Math.round(o.dur * 0.45), Math.round(o.dur * 0.45)];
    const phases = o.active
      ? [{ id: 'startup', from: 0, to: a0 }, { id: 'active', from: a0, to: a1 }, { id: 'recovery', from: a1, to: o.dur }]
      : [{ id: 'startup', from: 0, to: a0 }, { id: 'recovery', from: a0, to: o.dur }];
    const hitWindows = (o.hits ?? []).map((h) => ({
      id: h.id, from: h.from ?? a0, to: h.to ?? a1, shapeTrack: h.track, damageType: h.type ?? 'cut', damageCoefficient: h.coef,
      maxHitsPerTarget: 1, hitstopTicks: h.hitstop ?? 3, ...(h.group ? { group: h.group } : {}),
    }));
    const events = [...(o.events ?? [])];
    if (o.sound) events.push({ tick: o.sound[0], type: 'sound', id: o.sound[1] });
    if (o.trail !== false && hitWindows.length > 0) events.push({ tick: a0, type: 'trail_on', id: 'blade' }, { tick: a1, type: 'trail_off', id: 'blade' });
    events.sort((x, y) => x.tick - y.tick);
    const def = {
      schemaVersion: 1, actionId, clip: o.clip, tickRate: 60, durationTicks: o.dur, phases,
      rootMotion: o.curve ? { mode: 'controller', curveId: o.curve } : { mode: 'none' },
      ...(o.turn ? { turning: { untilTick: o.turn[0], maxDegreesPerSecond: o.turn[1] } } : {}),
      hitWindows, cancelWindows: (o.cancels ?? []).map(([from, to, into]) => ({ from, to, into })), events,
      onFinish: o.finish ?? 'drawn_idle',
      ...(o.track ? { weaponTrack: o.track } : {}),
    };
    for (const k of ['staminaCost', 'invulnerable', 'charge', 'freeMove', 'guardWindows', 'counter', 'momentum', 'shoot', 'spin', 'offhandTrack']) if (o[k] !== undefined) def[k] = o[k];
    F.actions.push(def);
    const prev = state.clips.get(o.clip);
    if (prev && prev.dur !== o.dur) throw new Error(`clip ${o.clip} の長さが技ごとに違う`);
    state.clips.set(o.clip, { dur: o.dur, a0, a1, family: id });
    const m = state.motions[o.clip];
    if (!m) throw new Error(`clip ${o.clip} の動きが無い`);
    if (m.dur !== o.dur) throw new Error(`clip ${o.clip}: 動きの長さ ${m.dur} と技の長さ ${o.dur} が違う`);
    if (JSON.stringify(m.root ?? null) !== JSON.stringify(o.curve ? curveKeys(o.curve) : null)) throw new Error(`clip ${o.clip}: 動きの移動曲線と、技の移動曲線が違う`);
    if (JSON.stringify(m.spin ?? null) !== JSON.stringify(o.spin ?? null)) throw new Error(`clip ${o.clip}: 動きの回転と、技の回転が違う`);
    m.check = { a0, a1, dodge: !!o.dodge };
    return actionId;
  };
  return { fam, track, motion, solve, snap, trackOf, action, pose: (def, base) => pose(hands, def, base) };
}

/** 全部の動きを、全 tick で調べる。返り値は 見つかった問題の一覧（動き・規則ごとに、いちばん悪い値）。 */
export function checkAll() {
  const rows = [];
  for (const [clip, m] of Object.entries(state.motions)) {
    const fam = state.stances[m.family];
    const worst = new Map();
    const note = (v, t) => {
      const w = worst.get(v.rule);
      if (!w) worst.set(v.rule, { ...v, t, n: 1, t0: t, t1: t });
      else {
        w.n++;
        w.t1 = t;
        if (Math.abs(v.value) > Math.abs(w.value) === !v.limit.startsWith('≥')) Object.assign(w, { value: v.value, t });
      }
    };
    let prev = null;
    for (let t = 0; t <= m.dur; t++) {
      const e = B.evalMotion(m, t);
      const s = B.solveBody(e.ctl, e.footL, e.footR, fam.hands);
      const near = m.skipBody && t >= m.skipBody[0] && t <= m.skipBody[1];
      for (const v of checkFrame(s, fam.hands, near ? null : fam.shape)) note(v, t);
      const root = B.rootAt(m, t);
      const F = s.frames;
      const hand = fam.hands.primary === 'R' ? F.handR : F.handL;
      const d = toAction(B.vadd(s.weapon.grip, s.weapon.dir), root), g = toAction(s.weapon.grip, root);
      const pt = { hand: toAction(hand, root), dir: B.vsub(d, g), pelvis: toAction(F.pelvis, root), chestYaw: yawOf(F.qPelvis) + root.yaw, footL: toAction(F.ballL, root), footR: toAction(F.ballR, root), liftL: F.liftL, liftR: F.liftR };
      if (prev) for (const v of checkSpeed(prev, pt, fam.shape.maxTurn)) note(v, t);
      prev = pt;
    }
    for (const w of worst.values()) rows.push(`${clip}: ${w.rule} = ${w.value}（許す範囲 ${w.limit}）tick ${w.t0}〜${w.t1} の ${w.n} 回、いちばん悪いのは tick ${w.t}`);
  }
  return rows;
}
