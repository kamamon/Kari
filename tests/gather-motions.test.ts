// 採集・採掘・納品・虫網・釣りの動き（v0.70.0。D-168）: 体の動き（src/render/poses.ts の CLIPS）と、
// 道具の持ち方（src/render/toolMotion.ts。両腕は src/render/rig.ts の toolToTrack の IK）を、本物の骨格で確かめる
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { Texture, TextureLoader, Vector3 } from 'three';
import { HunterRig } from '../src/render/rig';
import { CLIPS, clipPose, type BodyPose } from '../src/render/poses';
import { FISH_BITE, TOOL_TRACKS, fishLineAt, toolHoldAt, type ToolHold } from '../src/render/toolMotion';

const json = (p: string): any => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'));
const common = json('actions/player_common.json');
const gathering = json('field_gathering.json');
const actions = new Map<string, any>([...common.actions, ...gathering.actions].map((a: any) => [a.actionId, a]));

let mock: MockInstance | null = null;
let rig: HunterRig;
beforeAll(() => {
  mock = vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture());
  rig = new HunterRig();
});
afterAll(() => mock?.mockRestore());

/** その tick の体と道具を置いて、測る */
function at(clip: string, t: number): { hold: ToolHold | null; handR: Vector3; handL: Vector3; tip: Vector3 | null; leftAt: Vector3 | null } {
  rig.setPose(clipPose(clip, t)!);
  const hold = toolHoldAt(clip, t);
  if (hold) rig.toolToTrack(hold.tool, hold.grip, hold.dir, hold.face, hold.left, hold.leftW);
  rig.root.updateMatrixWorld(true);
  let tip: Vector3 | null = null, leftAt: Vector3 | null = null;
  if (hold) {
    const g = hold.tool === 'pick' ? rig.tool : hold.tool === 'net' ? rig.netTool : rig.fishTool;
    // つるはしは尖りの先、網は輪の中心、竿は竿先
    tip = (hold.tool === 'pick' ? new Vector3(0, 0.48, 0.25) : hold.tool === 'net' ? new Vector3(0, 0.95, 0) : new Vector3(0, 1.455, 0)).applyMatrix4(g.matrixWorld);
    leftAt = new Vector3(...hold.left).applyMatrix4(g.matrixWorld);
  }
  return { hold, handR: rig.sockets.hand_r.getWorldPosition(new Vector3()), handL: rig.sockets.hand_l.getWorldPosition(new Vector3()), tip, leftAt };
}
/** 足の裏のいちばん低い所（左・右） */
function soles(): [number, number] {
  rig.root.updateMatrixWorld(true);
  return [rig.joints.footL, rig.joints.footR].map((f) => Math.min(...[-0.065, 0.175].map((z) => f.localToWorld(new Vector3(0, -0.04, z)).y))) as [number, number];
}
const maxJointStep = (clip: string, dur: number): number => {
  let m = 0;
  let prev: BodyPose = clipPose(clip, 0)!;
  for (let t = 1; t <= dur; t++) {
    const p = clipPose(clip, t)!;
    for (const k of Object.keys(p.j) as (keyof BodyPose['j'])[]) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(p.j[k][c] - prev.j[k][c]));
    prev = p;
  }
  return m;
};

describe('採集・採掘・納品・虫網・釣りの動き（v0.70.0。D-168）', () => {
  it('動きの長さ・品の入る tick・食いつく間は、データ（行動と釣り場）と同じ', () => {
    const mine = actions.get('player.common.mine');
    expect(mine.durationTicks).toBe(150);
    expect(mine.events.filter((e: any) => e.id === 'hit_rock').map((e: any) => e.tick)).toEqual([42, 76, 110]);
    for (const [clip, id] of [['common_mine_01', 'player.common.mine'], ['common_net_01', 'player.common.field_net'], ['common_fish_01', 'player.common.field_fish'], ['common_gather_01', 'player.common.gather'], ['common_deliver_01', 'player.common.deliver']] as const) {
      const a = actions.get(id);
      expect(a.clip, id).toBe(clip);
      const keys = CLIPS[clip]!.keys;
      expect(keys[keys.length - 1]!.t, clip).toBe(a.durationTicks);
      const tr = TOOL_TRACKS[clip];
      if (tr) expect(tr.keys[tr.keys.length - 1]!.t, clip).toBe(a.durationTicks);
    }
    expect(FISH_BITE.from).toBe(gathering.fish.biteFrom);
    expect(FISH_BITE.to).toBe(gathering.fish.biteTo);
  });

  it('どの tick でも、右手は道具の握りに届き、左手は添える所に届く（IK が届かずに、道具が手から離れない）', () => {
    for (const [clip, dur] of [['common_mine_01', 150], ['common_net_01', 105], ['common_fish_01', 240]] as const) {
      for (let t = 0; t <= dur; t += 0.5) {
        const m = at(clip, t);
        const h = m.hold!;
        expect(m.handR.distanceTo(new Vector3(h.grip.x, h.grip.y, h.grip.z)), `${clip} R ${t}`).toBeLessThan(0.006);
        if (h.leftW >= 0.999) expect(m.handL.distanceTo(m.leftAt!), `${clip} L ${t}`).toBeLessThan(0.01);
      }
    }
  });

  it('採掘: 3 回とも、尖りが前 0.7〜0.9m・高さ 0.2〜0.45m の岩の面に当たって 2 tick 止まる。振りかぶりは、頭の上の後ろ', () => {
    for (const hit of [42, 76, 110]) {
      const m = at('common_mine_01', hit);
      expect(m.tip!.z, `${hit}`).toBeGreaterThan(0.7);
      expect(m.tip!.z, `${hit}`).toBeLessThan(0.9);
      expect(m.tip!.y, `${hit}`).toBeGreaterThan(0.2);
      expect(m.tip!.y, `${hit}`).toBeLessThan(0.45);
      expect(Math.abs(m.tip!.x), `${hit}`).toBeLessThan(0.15);
      // 打つ前の 3 tick は、まだ高い所から下りてくる途中（振り下ろす）
      expect(at('common_mine_01', hit - 3).tip!.y, `${hit}`).toBeGreaterThan(m.tip!.y + 0.3);
      // 2 tick 止まる
      expect(at('common_mine_01', hit + 2).tip!.distanceTo(m.tip!), `${hit}`).toBeLessThan(0.01);
      // 振りかぶり切った所: つるはしの頭は頭の上の後ろ、両手は頭の上
      const up = at('common_mine_01', hit - 18);
      expect(up.tip!.y, `${hit}`).toBeGreaterThan(1.8);
      expect(up.tip!.z, `${hit}`).toBeLessThan(0);
      expect(up.handR.y, `${hit}`).toBeGreaterThan(1.7);
      expect(up.handL.y, `${hit}`).toBeGreaterThan(1.7);
    }
    // 拾う所（128）: 左手は前の低い所、つるはしの頭は地面の近く
    const pick = at('common_mine_01', 128);
    expect(pick.handL.y).toBeLessThan(0.45);
    expect(pick.handL.z).toBeGreaterThan(0.3);
    expect(pick.tip!.y).toBeLessThan(0.25);
  });

  it('虫網: 53〜60 で、輪が低く前を右から左へ通る。76〜82 で、輪を胸から顔の前へ上げる', () => {
    const a = at('common_net_01', 53).tip!, b = at('common_net_01', 60).tip!;
    for (const p of [a, b]) {
      expect(p.y).toBeLessThan(0.9);
      expect(p.z).toBeGreaterThan(0.9);
    }
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(0.3);
    // 振りかぶりは右肩の上
    const up = at('common_net_01', 32).tip!;
    expect(up.y).toBeGreaterThan(1.9);
    for (const t of [76, 82]) {
      const p = at('common_net_01', t).tip!;
      expect(p.y, `${t}`).toBeGreaterThan(1.3);
      expect(p.y, `${t}`).toBeLessThan(1.7);
      expect(p.z, `${t}`).toBeGreaterThan(0.6);
      expect(p.z, `${t}`).toBeLessThan(1.0);
    }
  });

  it('釣り: 投げると竿先が前へ、待つ間は前の上。食いつく間は竿先が小刻みに下がり、引き上げで竿が立つ。浮きは投げてから戻るまで水面', () => {
    expect(at('common_fish_01', 19).tip!.z).toBeLessThan(0);
    expect(at('common_fish_01', 26).tip!.z).toBeGreaterThan(1.6);
    for (const t of [40, 80, 120, 144]) {
      const p = at('common_fish_01', t).tip!;
      expect(p.y, `${t}`).toBeGreaterThan(1.4);
      expect(p.z, `${t}`).toBeGreaterThan(1.4);
    }
    const base = at('common_fish_01', FISH_BITE.from).tip!.y;
    let low = Infinity;
    for (let t = FISH_BITE.from; t <= FISH_BITE.to; t++) low = Math.min(low, at('common_fish_01', t).tip!.y);
    expect(low).toBeLessThan(base - 0.08);
    expect(at('common_fish_01', 219).tip!.y).toBeGreaterThan(2.6);
    // 浮き: 24 まで竿先、24〜34 で飛び、34〜206 は投げた所、206〜218 で戻る。沈むのは食いつく間だけ
    expect(fishLineAt(20).cast).toBe(0);
    expect(fishLineAt(29).cast).toBeGreaterThan(0);
    expect(fishLineAt(29).cast).toBeLessThan(1);
    expect(fishLineAt(100).cast).toBe(1);
    expect(fishLineAt(220).cast).toBe(0);
    expect(fishLineAt(100).sink).toBe(0);
    let sink = 0;
    for (let t = FISH_BITE.from; t <= FISH_BITE.to; t++) sink = Math.max(sink, fishLineAt(t).sink);
    expect(sink).toBeGreaterThan(0.04);
  });

  it('採集: 両足の裏を地面に付けたまましゃがみ、右手は前の低い所の草へ。72 で右の腰の袋へ', () => {
    for (const t of [10, 20, 30, 40, 50, 58, 72]) {
      rig.setPose(clipPose('common_gather_01', t)!);
      const [l, r] = soles();
      expect(Math.abs(l - r), `${t}`).toBeLessThan(0.03);
      // 腰は低い（しゃがむ）
      expect(rig.joints.thighL.getWorldPosition(new Vector3()).y, `${t}`).toBeLessThan(0.55);
    }
    for (const t of [20, 50]) {
      const m = at('common_gather_01', t);
      expect(m.handR.y, `${t}`).toBeLessThan(0.5);
      expect(m.handR.z, `${t}`).toBeGreaterThan(0.4);
    }
    const bag = at('common_gather_01', 72);
    expect(bag.handR.x).toBeLessThan(-0.3);
    expect(bag.handR.z).toBeLessThan(0.3);
  });

  it('納品: 品を腹の前に抱え（8）、26〜30 で両手を前の低い所（箱の中）へ下ろす', () => {
    const hold = at('common_deliver_01', 8);
    expect(hold.handR.y).toBeGreaterThan(1.0);
    expect(hold.handR.z).toBeGreaterThan(0.3);
    for (const t of [26, 30]) {
      const m = at('common_deliver_01', t);
      for (const h of [m.handR, m.handL]) {
        expect(h.y, `${t}`).toBeLessThan(0.65);
        expect(h.z, `${t}`).toBeGreaterThan(0.3);
      }
      expect(Math.abs(m.handR.x + m.handL.x), `${t}`).toBeLessThan(0.02);
    }
  });

  it('なめらか: 体の関節は 1 tick で 25° 未満。道具の先は 1 tick で 0.85m 未満（投げる竿先がいちばん速い）', () => {
    for (const [clip, dur] of [['common_mine_01', 150], ['common_net_01', 105], ['common_fish_01', 240], ['common_gather_01', 90], ['common_deliver_01', 48]] as const) {
      expect(maxJointStep(clip, dur), clip).toBeLessThan(25);
      if (!TOOL_TRACKS[clip]) continue;
      let prev = at(clip, 0).tip!;
      for (let t = 1; t <= dur; t++) {
        const p = at(clip, t).tip!;
        expect(p.distanceTo(prev), `${clip} ${t}`).toBeLessThan(0.85);
        prev = p;
      }
    }
  });
});
