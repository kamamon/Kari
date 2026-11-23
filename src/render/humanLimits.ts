// 解いた姿勢が「人にできる範囲」かを調べる。関節の曲がる範囲、手が武器に届いているか、手首の角度、
// 足が届いているか、重心が足の上にあるか、武器が自分の体を通り抜けていないか、動きの速さ。
// 値は成人の関節可動域のおおよその上限（余裕を少し見てある）。tools/gen-weapons.mjs と tests/human-motion.test.ts が使う。
// このファイルも Node で直接読むので、import は拡張子付き・消せる型だけにする。
import { type Hands, type Quat, type Solved, type Vec, qconj, qeuler, qmul, qrot, vadd, vangle, vdot, vlen, vmul, vnorm, vsub } from './bodySolve.ts';

export interface Violation {
  rule: string;
  value: number;
  limit: string;
}

const D2R = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** 点 p と線分 ab の距離 */
function distPointSeg(p: Vec, a: Vec, b: Vec): number {
  const ab = vsub(b, a);
  const l2 = vdot(ab, ab);
  const u = l2 < 1e-9 ? 0 : clamp(vdot(vsub(p, a), ab) / l2, 0, 1);
  return vlen(vsub(p, vadd(a, vmul(ab, u))));
}
/** 線分どうしの最短距離（細かく刻んで求める。検査用なので速さは要らない） */
function distSegSeg(a0: Vec, a1: Vec, b0: Vec, b1: Vec): number {
  let best = Infinity;
  for (let i = 0; i <= 12; i++) {
    const p = vadd(a0, vmul(vsub(a1, a0), i / 12));
    best = Math.min(best, distPointSeg(p, b0, b1));
  }
  for (let i = 0; i <= 6; i++) {
    const p = vadd(b0, vmul(vsub(b1, b0), i / 6));
    best = Math.min(best, distPointSeg(p, a0, a1));
  }
  return best;
}

export interface WeaponShape {
  /** 自分の体と重なってはいけない部分（握りからの距離 m）と太さ */
  from: number;
  to: number;
  radius: number;
  /** 鎌の刃のように、柄から横へ伸びる部分（v0.5.0 の時点では使う武器が無い）: 握りからの距離と、武器の -Z 方向への長さ */
  blade?: { at: number; out: number };
  /** 武器を回す速さの上限（°/秒）。軽い片手の剣は速く、長く重い武器は遅い。 */
  maxTurn?: number;
}

/** 1 つの姿勢を調べる。 */
export function checkFrame(s: Solved, hands: Hands, weapon?: WeaponShape | null): Violation[] {
  const v: Violation[] = [];
  const F = s.frames;
  const bad = (rule: string, value: number, limit: string): void => void v.push({ rule, value: Math.round(value * 100) / 100, limit });
  const qCi = qconj(F.qChest), qPi = qconj(F.qPelvis);

  // ---- 腕 ----
  for (const [S, sh, el, hand, target, side] of [['L', F.shoulderL, F.elbowL, F.handL, F.targetL, 1], ['R', F.shoulderR, F.elbowR, F.handR, F.targetR, -1]] as const) {
    const w = hands.primary === S ? F.grab : hands.second === 'string' || hands.second === 'along' || hands.second === 'blade' ? F.on : 1;
    const holds = w > 0.99;
    // 持ち替えの途中（下げた手から握りへ向かう間）は、手の通り道をまっすぐ結んだだけなので、ひじと胴の検査はしない
    const transit = w > 0.01 && w < 0.99;
    const miss = vlen(vsub(hand, target));
    if (holds && miss > 0.02) bad(`手が届かない_${S}`, miss, '≤ 0.02m');
    const flex = 180 - vangle(vsub(sh, el), vsub(hand, el));
    if (flex > 154 && !transit) bad(`ひじの曲げ_${S}`, flex, '≤ 154°');
    const u = qrot(qCi, vnorm(vsub(el, sh)));
    const lat = u[0] * side, up = u[1], fwd = u[2];
    if (fwd < -0.86) bad(`肩を後ろへ引きすぎ_${S}`, Math.asin(clamp(-fwd, -1, 1)) / D2R, '後ろへ ≤ 59°');
    // （肩より高く上げた腕は、肩甲骨ごと引けるので、もう少し後ろまで行く。弓の引き手・肩越しに背へ伸ばす手）
    if (up > -0.2 && fwd < (up > 0.3 ? -0.82 : -0.6)) bad(`上げた腕を後ろへ引きすぎ_${S}`, Math.asin(clamp(-fwd, -1, 1)) / D2R, '肩の高さでは後ろへ ≤ 37°（肩より上は ≤ 55°）');
    if (lat < -0.74) bad(`腕を内へ入れすぎ_${S}`, Math.asin(clamp(-lat, -1, 1)) / D2R, '体の前で内へ ≤ 48°');
    if (fwd < -0.25 && lat < -0.3 && up < 0.3) bad(`腕が背中の後ろへ回っている_${S}`, lat, '後ろでは内へ入らない');
    // ひじ・手が胴にめり込んでいないか
    for (const [name, p] of [['ひじ', el], ['手', hand]] as const) {
      const d = distPointSeg(p, vadd(F.pelvis, [0, 0.02, 0]), vadd(F.chest, qrot(F.qChest, [0, 0.2, 0])));
      if (d < 0.1 && !transit) bad(`${name}が胴に入っている_${S}`, d, '背骨から ≥ 0.10m');
    }
  }
  // 手首: 前腕（ひじ → 手）と武器のなす角
  const prim = hands.primary === 'R' ? [F.elbowR, F.handR] as const : [F.elbowL, F.handL] as const;
  const wrist = vangle(vsub(prim[1], prim[0]), s.weapon.dir);
  if (F.grab > 0.99 && (wrist < hands.wrist[0] || wrist > hands.wrist[1])) bad('手首の角度', wrist, `${hands.wrist[0]}〜${hands.wrist[1]}°`);
  if (s.off && F.on > 0.99) {
    const sec = hands.primary === 'R' ? [F.elbowL, F.handL] as const : [F.elbowR, F.handR] as const;
    const w2 = vangle(vsub(sec[1], sec[0]), s.off.dir);
    if (w2 < hands.wrist[0] || w2 > hands.wrist[1]) bad('もう 1 本の剣の手首の角度', w2, `${hands.wrist[0]}〜${hands.wrist[1]}°`);
  }
  if (hands.second === 'along' && F.grab > 0.99 && F.on > 0.99) {
    const sec = hands.primary === 'R' ? [F.elbowL, F.handL] as const : [F.elbowR, F.handR] as const;
    const w2 = vangle(vsub(sec[1], sec[0]), s.weapon.dir);
    if (w2 < 30 || w2 > 150) bad('添える手の手首の角度', w2, '30〜150°');
  }

  // ---- 胴と首 ----
  const tw = qeuler(qmul(qPi, F.qChest));
  if (Math.abs(tw[1]) > 52) bad('腰と胸のひねり', tw[1], '±52°');
  if (tw[0] > 70 || tw[0] < -30) bad('背の前後の曲げ', tw[0], '-30〜70°');
  if (Math.abs(tw[2]) > 35) bad('背の横の曲げ', tw[2], '±35°');
  // 首: 胸から見た、顔の向き（左右と上下）と、頭の傾き
  const face = qrot(qCi, qrot(F.qHead, [0, 0, 1])), crown = qrot(qCi, qrot(F.qHead, [0, 1, 0]));
  const neckYaw = Math.atan2(face[0], face[2]) / D2R, neckPitch = -Math.asin(clamp(face[1], -1, 1)) / D2R;
  if (Math.abs(neckYaw) > 80) bad('首のひねり', neckYaw, '±80°');
  if (neckPitch > 50 || neckPitch < -45) bad('首の前後の曲げ', neckPitch, '-45〜50°');
  const tilt = Math.acos(clamp(crown[1], -1, 1)) / D2R;
  if (tilt > 48) bad('頭の傾き', tilt, '≤ 48°');

  // ---- 脚 ----
  const fwdP = qrot(F.qPelvis, [0, 0, 1]);
  const pelvisYaw = Math.atan2(fwdP[0], fwdP[2]) / D2R;
  for (const [S, hip, knee, ankle, side, footYaw, flexA, short, lift] of [
    ['L', F.hipL, F.kneeL, F.ankleL, 1, F.footYawL, F.ankleFlexL, F.legShortL, F.liftL],
    ['R', F.hipR, F.kneeR, F.ankleR, -1, F.footYawR, F.ankleFlexR, F.legShortR, F.liftR],
  ] as const) {
    if (short > 0.012) bad(`足が届かない_${S}`, short, '≤ 0.012m');
    const t = qrot(qPi, vnorm(vsub(knee, hip)));
    const flex = Math.atan2(t[2], -t[1]) / D2R;
    if (flex > 125 || flex < -32) bad(`股関節の前後_${S}`, flex, '-32〜125°');
    const abd = Math.asin(clamp(t[0] * side, -1, 1)) / D2R;
    if (abd > 52 || abd < -30) bad(`股関節の開き_${S}`, abd, '-30〜52°');
    const kneeFlex = 180 - vangle(vsub(hip, knee), vsub(ankle, knee));
    if (kneeFlex > 150) bad(`ひざの曲げ_${S}`, kneeFlex, '≤ 150°');
    if (lift < 0.004 && (flexA > 32 || flexA < -55)) bad(`足首の曲げ_${S}`, flexA, '-55〜32°');
    // つま先の向き: 腰の向きに対して、外へ 70°・内へ 40° まで
    let rel = footYaw - pelvisYaw;
    rel = ((((rel + 180) % 360) + 360) % 360) - 180;
    const out = rel * side;
    if (lift < 0.004 && (out > 72 || out < -42)) bad(`つま先の向き_${S}`, out, '内 42°〜外 72°');
  }
  if (F.liftL < 0.05 && F.liftR < 0.05) {
    const d = Math.hypot(F.ankleL[0] - F.ankleR[0], F.ankleL[2] - F.ankleR[2]);
    if (d < 0.12) bad('両足が重なっている', d, '≥ 0.12m');
  }
  // 重心（骨盤と胸の中ほど）が、着いている足のあいだ（から少しの範囲）にあるか
  const com: Vec = [F.pelvis[0] * 0.6 + F.chest[0] * 0.4, 0, F.pelvis[2] * 0.6 + F.chest[2] * 0.4];
  // 足の位置は、足首と母指球の中ほど（体重が乗る所）
  const fl: Vec = [(F.ankleL[0] + F.ballL[0]) / 2, 0, (F.ankleL[2] + F.ballL[2]) / 2], fr: Vec = [(F.ankleR[0] + F.ballR[0]) / 2, 0, (F.ankleR[2] + F.ballR[2]) / 2];
  // （踏み出している足は、これから着く側。体はその足へ向かって倒れ込むので、両足のあいだに居ればよい。両足とも浮いている間は調べない）
  if (F.liftL < 0.02 || F.liftR < 0.02) {
    const d = distPointSeg(com, fl, fr);
    if (d > 0.2) bad('重心が両足の外', d, '≤ 0.20m');
  }

  // ---- 武器が自分の体を通り抜けていないか ----
  if (weapon && F.grab > 0.99) {
    const g = s.weapon.grip, d = s.weapon.dir;
    const segs: [Vec, Vec][] = [[vadd(g, vmul(d, weapon.from)), vadd(g, vmul(d, weapon.to))]];
    if (weapon.blade) {
      const wz = vnorm(vsub([0, 0, 0], crossOf(s.weapon.normal, d)));
      const base = vadd(g, vmul(d, weapon.blade.at));
      segs.push([base, vadd(base, vmul(wz, weapon.blade.out))]);
    }
    const body: [string, Vec, Vec, number][] = [
      ['胴', vadd(F.pelvis, [0, -0.02, 0]), F.sc, 0.13],
      ['頭', F.head, vadd(F.head, qrot(F.qHead, [0, 0.1, 0])), 0.1],
      ['左脚', F.hipL, F.kneeL, 0.07], ['左すね', F.kneeL, F.ankleL, 0.055],
      ['右脚', F.hipR, F.kneeR, 0.07], ['右すね', F.kneeR, F.ankleR, 0.055],
    ];
    for (const [a, b] of segs) {
      for (const [name, p, q, r] of body) {
        const dist = distSegSeg(a, b, p, q);
        if (dist < r + weapon.radius * 0.5) bad(`武器が${name}を通る`, dist, `≥ ${(r + weapon.radius * 0.5).toFixed(2)}m`);
      }
    }
  }
  return v;
}

function crossOf(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 速さの上限（1 tick = 1/60 秒のあいだの変化）。pos は技の始まりを基準にした座標（体の移動と回転を含む）。 */
export interface MotionPoint {
  hand: Vec;
  dir: Vec;
  pelvis: Vec;
  chestYaw: number;
  footL: Vec;
  footR: Vec;
  liftL: number;
  liftR: number;
}
export function checkSpeed(a: MotionPoint, b: MotionPoint, maxTurn = 1500): Violation[] {
  const v: Violation[] = [];
  const bad = (rule: string, value: number, limit: string): void => void v.push({ rule, value: Math.round(value * 100) / 100, limit });
  const hand = vlen(vsub(b.hand, a.hand)) * 60;
  if (hand > 14) bad('手の速さ', hand, '≤ 14 m/s');
  const ang = vangle(a.dir, b.dir) * 60;
  if (ang > maxTurn) bad('武器を回す速さ', ang, `≤ ${maxTurn} °/s`);
  const body = vlen(vsub(b.pelvis, a.pelvis)) * 60;
  if (body > 6) bad('体の移動の速さ', body, '≤ 6 m/s');
  let dy = b.chestYaw - a.chestYaw;
  dy = ((((dy + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(dy) * 60 > 760) bad('体を回す速さ', Math.abs(dy) * 60, '≤ 760 °/s');
  for (const [S, p, q, l0, l1] of [['L', a.footL, b.footL, a.liftL, b.liftL], ['R', a.footR, b.footR, a.liftR, b.liftR]] as const) {
    const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (l0 < 0.004 && l1 < 0.004 && d > 0.006) bad(`着いた足が滑る_${S}`, d, '≤ 0.006 m/tick');
    if (d * 60 > 9) bad(`足を運ぶ速さ_${S}`, d * 60, '≤ 9 m/s');
  }
  return v;
}

/** アクターの座標の点を、技の始まりを基準にした座標へ（体の移動 x,z と回転 yaw 度） */
export function toAction(p: Vec, root: { x: number; z: number; yaw: number }): Vec {
  const c = Math.cos(root.yaw * D2R), s = Math.sin(root.yaw * D2R);
  return [root.x + p[0] * c + p[2] * s, p[1], root.z - p[0] * s + p[2] * c];
}
export const yawOf = (q: Quat): number => {
  const f = qrot(q, [0, 0, 1]);
  return Math.atan2(f[0], f[2]) / D2R;
};
