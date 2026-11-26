import { describe, expect, it, vi } from 'vitest';
import { Euler, Quaternion, SkinnedMesh, Texture, TextureLoader, Vector3 } from 'three';
import { ContactLocomotion, GroundedLocomotion, footContactWorld, freeStride, travelGait } from '../src/render/contactLocomotion';
import { HunterAnimator, playerContactFrame, playerRenderTick, solveState } from '../src/render/hunterAnim';
import { groundedHeavyAttack } from '../src/render/heavyBodyMotion';
import { evalMotion, solveBody, vlen, vsub, type Foot } from '../src/render/bodySolve';
import { WEAPON_MOTIONS, WEAPON_STANCES } from '../src/render/weaponClipSpecs';
import { clipPose, locomotionPose } from '../src/render/poses';
import { HunterRig } from '../src/render/rig';
import { sampleTrack } from '../src/game/tracks';
import { checkFrame } from '../src/render/humanLimits';
import { Simulation } from '../src/game/sim';
import { Btn, baseOptions, frame, hold, loadContent, placeInFrontOfHead, press } from './helpers';

const near = (a: readonly number[], b: readonly number[], tolerance = 1e-8): void => {
  expect(Math.hypot(...a.map((v, i) => v - b[i]!))).toBeLessThan(tolerance);
};
const L: Foot = [0.105, 0, 0, 5, 0], R: Foot = [-0.105, 0, 0, -5, 0];
const D = Math.PI / 180;

describe('runtime の動作差し替え', () => {
  it('solveState の時刻が歩行の位相を変える（以前は time を変えても同じ脚だった）', () => {
    for (const family of Object.keys(WEAPON_STANCES)) {
      const a = solveState(family, { kind: 'idle' }, 2.4, 0);
      const b = solveState(family, { kind: 'idle' }, 2.4, 0.13);
      expect(vlen(vsub(a.frames.ankleL, b.frames.ankleL)), family).toBeGreaterThan(0.05);
    }
  });

  it('全ての判定開始で、直前の歩行や遷移時間に関係なく正本の握り/向きに一致する', async () => {
    const content = await loadContent();
    let checked = 0;
    for (const action of content.actions.values()) {
      const m = WEAPON_MOTIONS[action.clip];
      if (!m) continue;
      const S = WEAPON_STANCES[m.family]!;
      const contacts = [...action.hitWindows.map((h) => h.from), ...(action.shoot ?? []).map((s) => s.tick)];
      for (const contact of contacts) {
        const anim = new HunterAnimator();
        for (let f = 0; f < 15; f++) anim.frame(m.family, { kind: 'idle' }, 'idle', 1 / 60, 2.4, f / 60);
        const expectedFrame = evalMotion(m, contact);
        const expected = solveBody(expectedFrame.ctl, expectedFrame.footL, expectedFrame.footR, S.hands);
        const actual = anim.frame(m.family, { kind: 'action', clip: action.clip, t: contact, dirAngle: 0, chargeTicks: 0, freeMove: !!action.freeMove }, `a-${checked}`, 1 / 144, 2.4, 1, { active: playerContactFrame(action, contact) });
        near(actual.weapon.grip, expected.weapon.grip);
        near(actual.weapon.dir, expected.weapon.dir);
        if (expected.off) { expect(actual.off).not.toBeNull(); near(actual.off!.grip, expected.off.grip); near(actual.off!.dir, expected.off.dir); }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('実際の Simulation の命中→最終停止 tick で接触姿勢を保ち、溜め保持時刻も守る', async () => {
    const content = await loadContent();
    const sim = new Simulation(content, baseOptions({ weaponId: 'weapon.guard_blade.001' }));
    placeInFrontOfHead(sim, 1.2);
    for (let i = 0; i < 40 && !sim.recentHits.length; i++) { sim.step(i === 0 ? press(Btn.Main) : frame()); sim.drainEvents(); }
    expect(sim.recentHits.length).toBeGreaterThan(0);
    const run = sim.player.action!, contact = sim.recentHits[sim.recentHits.length - 1]!.actionTick;
    const stops = run.hitstop;
    expect(stops).toBeGreaterThan(0);
    for (let i = 0; i <= stops; i++) {
      for (const alpha of [0, 0.5, 0.99]) expect(playerRenderTick(run, alpha)).toBe(contact);
      if (i < stops) sim.step(frame());
    }
    expect(run.hitstop).toBe(0); expect(run.advanced).toBe(false);
    sim.step(frame());
    expect(playerRenderTick(run, 0.5)).toBeGreaterThan(contact);
    const charge = new Simulation(content, baseOptions());
    placeInFrontOfHead(charge, 10);
    for (let i = 0; i < 40; i++) {
      charge.step(i === 0 ? press(Btn.Main) : hold(Btn.Main));
      const r = charge.player.action;
      if (r?.chargeTicks) for (const alpha of [0, 0.5, 0.99]) expect(playerRenderTick(r, alpha)).toBe(r.def.charge!.holdTick);
    }
    expect(charge.player.action!.chargeTicks).toBeGreaterThan(0);
  });

  it('接地中の母指球は、移動・方向転換・停止を通じて世界座標で滑らない', () => {
    const lock = new ContactLocomotion();
    let x = 0, z = 0, yaw = 0, phase = 0;
    let previous: { at: ReturnType<typeof footContactWorld>; lift: number }[] | null = null;
    let contacts = 0;
    for (let i = 0; i < 300; i++) {
      const speed = i < 160 ? 2.4 : 0, dt = 1 / 60;
      if (i < 160) { yaw += 0.2 * dt; x += Math.sin(yaw) * speed * dt; z += Math.cos(yaw) * speed * dt; }
      const root = { x, z, yaw };
      phase += speed * dt * Math.PI * 2 / 1.2;
      const g = speed ? travelGait(phase, 1.2, L, R) : { L, R };
      const f = lock.frame(root, g.L, g.R, dt, speed > 0);
      const now = [f.L, f.R].map((foot) => ({ at: footContactWorld(foot, root), lift: foot[1] }));
      if (previous) for (let j = 0; j < 2; j++) {
        if (previous[j]!.lift <= 0.004 && now[j]!.lift <= 0.004) {
          near([now[j]!.at.x, now[j]!.at.z], [previous[j]!.at.x, previous[j]!.at.z]); contacts++;
        }
      }
      previous = now;
    }
    expect(contacts).toBeGreaterThan(250);
  });

  it('停止したまま大きく向きを変える時は、足を上げて踏み替える', () => {
    const lock = new ContactLocomotion();
    lock.frame({ x: 0, z: 0, yaw: 0 }, L, R, 1 / 60, false);
    let maxLift = 0;
    for (let f = 0; f < 60; f++) {
      const feet = lock.frame({ x: 0, z: 0, yaw: 0.8 }, L, R, 1 / 60, false);
      maxLift = Math.max(maxLift, feet.L[1], feet.R[1]);
    }
    expect(maxLift).toBeGreaterThan(0.05);
  });

  it('90/180° の急反転でも、7 系統×30/60/120fps で脚の届きと関節範囲を保つ', async () => {
    const content = await loadContent();
    let scenarios = 0;
    for (const family of Object.keys(WEAPON_STANCES)) for (const turn of [Math.PI / 2, Math.PI]) for (const fps of [30, 60, 120]) {
      const anim = new HunterAnimator(), familyDef = content.families.get(family)!;
      const speed = familyDef.drawnMoveSpeed, turnRate = familyDef.drawnTurnDegPerSec * D;
      let x = 0, z = 0, yaw = 0;
      for (let i = 0; i < fps * 3; i++) {
        const dt = 1 / fps, want = i < fps * 0.6 ? 0 : turn;
        const diff = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
        yaw += Math.sign(diff) * Math.min(Math.abs(diff), turnRate * dt);
        const moving = i < fps * 2.2;
        if (moving) { x += Math.sin(want) * speed * dt; z += Math.cos(want) * speed * dt; }
        const s = anim.frame(family, { kind: 'idle' }, 'idle', dt, moving ? speed : 0, i / fps, { root: { x, z, yaw } });
        const label = `${family} ${turn / D}° ${fps}fps frame ${i}`;
        expect(Math.max(s.frames.legShortL, s.frames.legShortR), label).toBeLessThan(0.012);
        const S = WEAPON_STANCES[family]!;
        // 単純な静的重心判定は走行・旋回の動的な釣り合いを評価できない。別の受入項目とする。
        expect(checkFrame(s, S.hands, S.shape).filter((v) => !v.rule.startsWith('重心')), label).toEqual([]);
      }
      scenarios++;
    }
    expect(scenarios).toBe(42);
  });

  it('疾走は、脚の届く歩幅で短い空中局面を持つ（接地する所は体の前 0.30m・後ろ 0.45m まで。v0.28.1）', () => {
    let flight = 0, contacts = 0;
    for (let k = 0; k < 240; k++) {
      const g = travelGait(k / 240 * Math.PI * 2, 2.6, L, R, 1);
      if (g.L[1] > 0.02 && g.R[1] > 0.02) flight++;
      if (g.L[1] <= 0.004) contacts++;
      for (const f of [g.L, g.R]) if (f[1] <= 0.004) {
        expect(f[2]).toBeLessThanOrEqual(0.30);
        expect(f[2]).toBeGreaterThanOrEqual(-0.45);
      }
    }
    expect(flight).toBeGreaterThan(40);
    expect(contacts / 240).toBeLessThan(0.4);
  });
});

/** 歩いて進む間の腰の高さ（骨盤の py）を、毎フレーム記録する */
function walkHeights(step: (dt: number, z: number) => number, speed: number, fps: number, seconds = 6): number[] {
  const dt = 1 / fps, out: number[] = [];
  let z = 0;
  for (let i = 0; i < fps * seconds; i++) {
    z += speed * dt;
    const py = step(dt, z);
    if (i > fps * 2) out.push(py);
  }
  return out;
}
const spread = (ys: number[]): number => Math.max(...ys) - Math.min(...ys);
const maxStep = (ys: number[]): number => ys.reduce((m, y, i) => (i ? Math.max(m, Math.abs(y - ys[i - 1]!)) : 0), 0);

describe('歩く・走る時に、体が跳ねない（v0.28.1。利用者の指摘「歩くたびにバウンドするのは不自然」）', () => {
  it('納刀（全系統）と断岳剣の抜刀: 腰の上下は 4cm 以内のなめらかな波。足が届かずに腰が急に落ちる・跳ねることがない（30/60/120fps）', () => {
    for (const [drawn, speeds] of [[false, [0.6, 1.2, 2, 3, 4, 5, 6.4]], [true, [1.2, 2.4]]] as const) for (const speed of speeds) for (const fps of [30, 60, 120]) {
      const g = new GroundedLocomotion();
      let phase = 0, drop = 0, t = 0;
      const ys = walkHeights((dt, z) => {
        t += dt;
        phase += (speed * dt * Math.PI * 2) / freeStride(speed, drawn);
        const pose = locomotionPose(drawn, speed, phase, t);
        const out = g.frame(pose, drawn, speed, phase, dt, { x: 0, z, yaw: 0 });
        const gait = travelGait(phase, freeStride(speed, drawn), L, R, drawn ? 0 : Math.min(1, Math.max(0, (speed - 3.5) / 2.9)));
        if (t > 2) drop = Math.max(drop, Math.min(pose.py, gait.base) + gait.bob - out.py);
        return out.py;
      }, speed, fps);
      const label = `${drawn ? '抜刀' : '納刀'} ${speed}m/s ${fps}fps`;
      expect(spread(ys), label).toBeLessThan(0.04);
      // なめらかな波の傾き（周期と振れ幅から）を超えて、1 フレームで大きく動かない
      expect(maxStep(ys), label).toBeLessThan(0.45 / fps);
      expect(drop, `${label}: 足へ届かずに落とした量`).toBeLessThan(0.004);
    }
  });

  it('武器を構えて歩く（7 系統）: 腰の上下は 3cm 以内のなめらかな波（30/60/120fps）', async () => {
    const content = await loadContent();
    for (const family of Object.keys(WEAPON_STANCES)) {
      const full = content.families.get(family)!.drawnMoveSpeed;
      for (const speed of [full * 0.5, full]) for (const fps of [30, 60, 120]) {
        const anim = new HunterAnimator();
        let t = 0;
        const ys = walkHeights((dt, z) => {
          t += dt;
          return anim.frame(family, { kind: 'idle' }, 'idle', dt, speed, t, { root: { x: 0, z, yaw: 0 } }).pose.py;
        }, speed, fps);
        const label = `${family} ${speed.toFixed(1)}m/s ${fps}fps`;
        expect(spread(ys), label).toBeLessThan(0.03);
        expect(maxStep(ys), label).toBeLessThan(0.45 / fps);
      }
    }
  });

  it('歩き（両足が着く間がある）は片足で立つ真ん中が高く、走り（両足が浮く間がある）は片足の真ん中が低い', () => {
    const walk = travelGait(0, freeStride(1.0, false), L, R, 0);
    const run = travelGait(0, freeStride(6.4, false), L, R, 1);
    expect(walk.duty).toBeGreaterThan(0.55);
    expect(run.duty).toBeLessThan(0.3);
    const at = (stride: number, run01: number, u: number): number => {
      const g = travelGait(u * Math.PI * 2, stride, L, R, run01);
      return g.bob;
    };
    // 左足の接地の真ん中（u = duty / 2）と、そこから 1/4 周ずれた所（両足の時・空中）
    expect(at(freeStride(1.0, false), 0, walk.duty / 2)).toBeGreaterThan(at(freeStride(1.0, false), 0, walk.duty / 2 + 0.25));
    expect(at(freeStride(6.4, false), 1, run.duty / 2)).toBeLessThan(at(freeStride(6.4, false), 1, run.duty / 2 + 0.25));
  });
});

// v0.56.0 までの断岳剣（キー姿勢の方式。保留の組 v056。D-150）。いまの組の断岳剣は「解く方式」で、tests/human-motion.test.ts が調べる
describe('断岳剣の下半身と体幹（保留の組 v056）', () => {
  it('実際の靴メッシュ254頂点が、五つの攻撃（斬り上げ 2 つを含む。v0.40.0）の全1/4 tickで地面に埋まらない', async () => {
    const mock = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    try {
      const content = await loadContent({ motionSet: 'v056' }), rig = new HunterRig();
      const mesh = rig.root.getObjectByName('hunter_body') as SkinnedMesh;
      const position = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
      const footIds = mesh.skeleton.bones.flatMap((bone, i) => bone.name === 'footL' || bone.name === 'footR' ? [i] : []);
      const vertices: number[] = [];
      for (let i = 0; i < position.count; i++) for (let j = 0; j < 4; j++) {
        if (footIds.includes(indices.getComponent(i, j)) && weights.getComponent(i, j) > 0.01) { vertices.push(i); break; }
      }
      expect(vertices.length).toBeGreaterThan(200);
      const point = new Vector3();
      for (const name of ['overhead', 'side_sweep', 'draw_slash', 'upswing', 'upswing_low']) {
        const a = content.actions.get(`player.heavy_blade.${name}`)!;
        for (let t = 0; t <= a.durationTicks; t += 0.25) {
          rig.setPose(groundedHeavyAttack(clipPose(a.clip, t)!, a.clip, t));
          rig.root.updateMatrixWorld(true); mesh.skeleton.update();
          let lowest = Infinity;
          for (const i of vertices) {
            point.fromBufferAttribute(position, i); mesh.applyBoneTransform(i, point); point.applyMatrix4(mesh.matrixWorld);
            lowest = Math.min(lowest, point.y);
          }
          expect(lowest, `${name} tick ${t}`).toBeGreaterThan(-0.0001);
        }
      }
    } finally { mock.mockRestore(); }
  });

  it('五つの攻撃（斬り上げ 2 つを含む）の全 1/4 tick で、実リグの左右 socket が柄へ 2mm 以内で届く', async () => {
    // GPU を使わず、テクスチャの通信だけを置き換えて、ゲームの本物の骨格/腕 IK を通す。
    const mock = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
    try {
      const content = await loadContent({ motionSet: 'v056' }), rig = new HunterRig();
      for (const name of ['overhead', 'side_sweep', 'draw_slash', 'upswing', 'upswing_low']) {
        const a = content.actions.get(`player.heavy_blade.${name}`)!;
        const track = content.tracks.get(a.weaponTrack!)!;
        for (let t = 0; t <= a.durationTicks; t += 0.25) {
          rig.setPose(groundedHeavyAttack(clipPose(a.clip, t)!, a.clip, t));
          const k = sampleTrack(track, t);
          rig.weaponToTrack(k.grip, k.dir, track.planeNormal ?? [1, 0, 0], { two: true, along: 0.2 });
          rig.root.updateMatrixWorld(true);
          const right = new Vector3(k.grip.x, k.grip.y, k.grip.z);
          const left = right.clone().addScaledVector(new Vector3(k.dir.x, k.dir.y, k.dir.z).normalize(), 0.2);
          expect(rig.sockets.hand_r.getWorldPosition(new Vector3()).distanceTo(right), `${name} R ${t}`).toBeLessThan(0.002);
          expect(rig.sockets.hand_l.getWorldPosition(new Vector3()).distanceTo(left), `${name} L ${t}`).toBeLessThan(0.002);
        }
      }
    } finally { mock.mockRestore(); }
  });

  it('薙ぎ払いは腰へ回転を分け、胸と腰の相対 yaw が 52° に収まる', () => {
    for (let t = 0; t <= 66; t += 0.25) {
      const p = groundedHeavyAttack(clipPose('hb_attack_side_01', t)!, 'hb_attack_side_01', t);
      const q = (v: readonly number[]): Quaternion => new Quaternion().setFromEuler(new Euler(v[0]! * D, v[1]! * D, v[2]! * D));
      const relative = q(p.j.spine).multiply(q(p.j.chest));
      const twist = new Euler().setFromQuaternion(relative, 'XYZ').y / D;
      expect(Math.abs(twist), `tick ${t}`).toBeLessThanOrEqual(52);
    }
  });

  it('五つの攻撃の全 tick で足の FK が地面の下へ突き抜けない', () => {
    for (const [clip, duration] of [['hb_attack_vertical_01', 72], ['hb_attack_side_01', 66], ['hb_draw_slash_01', 64], ['hb_attack_upswing_01', 66], ['hb_attack_upswing_low_01', 54]] as const) {
      for (let t = 0; t <= duration; t++) {
        const p = groundedHeavyAttack(clipPose(clip, t)!, clip, t);
        expect(p.grounded).toBe(true);
        const q = (v: readonly number[]): Quaternion => new Quaternion().setFromEuler(new Euler(v[0]! * D, v[1]! * D, v[2]! * D));
        const qp = q(p.j.pelvis);
        for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
          const hip = new Vector3((p.px ?? 0), 0.92 + p.py, p.pz ?? 0).add(new Vector3(0.095 * sign, -0.04, 0).applyQuaternion(qp));
          const qt = qp.clone().multiply(q(p.j[`thigh${side}`]));
          const qs = qt.clone().multiply(q(p.j[`shin${side}`]));
          const qf = qs.clone().multiply(q(p.j[`foot${side}`]));
          const ankle = hip.add(new Vector3(0, -0.43, 0).applyQuaternion(qt)).add(new Vector3(0, -0.41, 0).applyQuaternion(qs));
          for (const toe of [-0.075, 0.19]) {
            const sole = ankle.clone().add(new Vector3(0, -0.044, toe).applyQuaternion(qf));
            expect(sole.y, `${clip} ${side} tick ${t}`).toBeGreaterThanOrEqual(-0.002);
          }
        }
      }
    }
  });
});
