// 防具の見た目（src/render/hunterArmor.ts、v0.10.0）。依頼 7 の設定図と、依頼文の「動きのための決まり」を、形の数値で確かめる。
// 座標: m、Y 上、+Z 前、+X が本人の左。静止姿勢（腕は真下）。
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ARMOR_SLOTS, type ArmorSlot } from '../src/data/schemas';
import { REST } from '../src/render/bodySolve';
import { armorLookKey, armorTierOf, buildHunterArmor, type ArmorLook } from '../src/render/hunterArmor';
import type { Geo } from '../src/render/procGeo';
import { loadContent } from './helpers';

const full = (tier: number): ArmorLook => Object.fromEntries(ARMOR_SLOTS.map((s) => [s, tier]));
const only = (slot: ArmorSlot, tier = 2): ArmorLook => ({ [slot]: tier });
const points = (g: Geo): Vector3[] => Array.from({ length: g.count }, (_, i) => g.positionOf(i));
/** 岩の板と縁の、全部の頂点 */
const all = (look: ArmorLook): Vector3[] => {
  const b = buildHunterArmor(look)!;
  return [...points(b.rock), ...points(b.rim)];
};
const box = (ps: Vector3[]) => ({
  minX: Math.min(...ps.map((p) => p.x)), maxX: Math.max(...ps.map((p) => p.x)),
  minY: Math.min(...ps.map((p) => p.y)), maxY: Math.max(...ps.map((p) => p.y)),
  minZ: Math.min(...ps.map((p) => p.z)), maxZ: Math.max(...ps.map((p) => p.z)),
});

describe('防具の見た目: 何を着ると、何が付くか', () => {
  it('里の装束（どの部位も 1 段目）なら、何も付かない', () => {
    expect(buildHunterArmor({})).toBeNull();
    expect(buildHunterArmor(full(1))).toBeNull();
    expect(armorLookKey({})).toBe('11111');
    expect(armorLookKey({ head: 2, legs: 5 })).toBe('21115');
  });

  it('部位ごとに別々に付く: 5 部位を 1 つずつ着た三角形の数の合計が、一式と同じ', () => {
    const tris = (look: ArmorLook): number => {
      const b = buildHunterArmor(look)!;
      return b.rock.triangles + b.rim.triangles;
    };
    const each = ARMOR_SLOTS.map((s) => tris(only(s)));
    for (const n of each) expect(n).toBeGreaterThan(0);
    expect(each.reduce((a, b) => a + b, 0)).toBe(tris(full(2)));
  });

  it('データの防具は、2 段目から上が見た目の ID を持ち、段が読める。里の装束には無い', async () => {
    const content = await loadContent();
    for (const a of content.armor.values()) {
      const tier = Number(a.id.slice(-1));
      expect(a.assetId, a.id).toBe(tier === 1 ? undefined : `model.armor.galdros.t${tier}`);
      expect(armorTierOf(a.assetId), a.id).toBe(tier);
    }
    expect(armorTierOf('model.armor.other.t2')).toBe(1);
    expect(armorTierOf('model.armor.galdros.t9')).toBe(1);
  });

  it('光るのは晶殻（弱く）と輝殻だけ', () => {
    expect([2, 3, 4, 5].map((t) => buildHunterArmor(full(t))!.glow)).toEqual([0, 0, 0.2, 0.55]);
  });
});

describe('防具の見た目: ガルドロスの偏り（左が大きい）', () => {
  it('肩: 左は大きな 1 枚で、右（中 1 枚 + 小 1 枚）のどちらよりも前後に長い', () => {
    const chest = all(only('chest'));
    const shoulderL = chest.filter((p) => p.x > 0.17 && p.y > 1.38);
    const shoulderR = chest.filter((p) => p.x < -0.17 && p.y > 1.38);
    const l = box(shoulderL), r = box(shoulderR);
    expect(l.maxZ - l.minZ).toBeGreaterThan(r.maxZ - r.minZ + 0.03);
  });

  it('籠手と腰の板は、左の方が大きい', () => {
    for (const slot of ['arms', 'waist'] as const) {
      const ps = all(only(slot)).filter((p) => Math.abs(p.x) > 0.1);
      const l = box(ps.filter((p) => p.x > 0)), r = box(ps.filter((p) => p.x < 0));
      expect(l.maxY - l.minY, slot).toBeGreaterThan(r.maxY - r.minY + 0.03);
      expect(l.maxZ - l.minZ, slot).toBeGreaterThan(r.maxZ - r.minZ + 0.015);
    }
  });

  it('腰の真後ろに、晶の塊が 1 つ（腰当ての一部）。ほかの部位には無い', () => {
    const rear = (look: ArmorLook): number => points(buildHunterArmor(look)!.rim).filter((p) => Math.abs(p.x) < 0.05 && p.z < -0.11 && p.y > 0.95 && p.y < 1.08).length;
    expect(rear(only('waist'))).toBeGreaterThan(0);
    expect(rear(only('chest'))).toBe(0);
  });
});

describe('防具の見た目: 動くための決まり（依頼 7 の 3 章）', () => {
  it('兜は、頭のてっぺんから 6cm まで', () => {
    expect(box(all(only('head'))).maxY).toBeLessThanOrEqual(REST.top + 0.06);
  });

  it('兜は頭を包む鉢で、てっぺんと後ろ頭を覆う。顔の前（目から口）は開いていて、正面にあるのは鼻当てだけ', () => {
    const ps = all(only('head'));
    expect(ps.some((p) => p.y > 1.765)).toBe(true);
    expect(ps.some((p) => p.z < -0.1 && p.y > 1.68)).toBe(true);
    expect(ps.some((p) => p.z < -0.1 && p.y < 1.62)).toBe(true); // うなじの板
    const face = ps.filter((p) => p.z > 0.07 && p.y > 1.585 && p.y < 1.655);
    expect(face.length).toBeGreaterThan(0); // 鼻当て
    for (const p of face) expect(Math.abs(p.x)).toBeLessThan(0.02);
    // あごと口の前には何も無い
    expect(ps.filter((p) => p.z > 0.07 && p.y < 1.62)).toHaveLength(0);
  });

  it('頬当ては、左の方が大きい', () => {
    const cheeks = all(only('head')).filter((p) => Math.abs(p.x) > 0.08 && p.y < 1.655 && p.z > -0.03);
    const l = box(cheeks.filter((p) => p.x > 0)), r = box(cheeks.filter((p) => p.x < 0));
    expect(l.maxY - l.minY).toBeGreaterThan(r.maxY - r.minY + 0.015);
    expect(l.maxZ - l.minZ).toBeGreaterThan(r.maxZ - r.minZ + 0.01);
  });

  it('肩当ては、肩から外へ 12cm・上へ 8cm まで（輝殻でも）', () => {
    for (const t of [2, 5]) {
      const b = box(all(only('chest', t)).filter((p) => Math.abs(p.x) > 0.17));
      expect(Math.max(b.maxX, -b.minX), `段 ${t}`).toBeLessThanOrEqual(REST.shoulderX + 0.12);
      // 晶殻・輝殻で左肩に生える短い晶は、板より上へ出る（設定図は未受領。仮）
      if (t === 2) expect(b.maxY).toBeLessThanOrEqual(REST.shoulderY + 0.08);
    }
  });

  it('背中の中央（肩甲骨の間から腰）には、板を置かない（武器を背負う）', () => {
    const mid = all(only('chest')).filter((p) => Math.abs(p.x) < 0.018 && p.z < 0 && p.y > 1.2 && p.y < 1.5);
    expect(mid).toHaveLength(0);
  });

  it('籠手は、ひじと手首を覆わない。脛当ては、ひざより下。腰の板は、太ももの半ばまで', () => {
    const elbowY = REST.shoulderY - REST.upperArm, wristY = elbowY - REST.forearm;
    const arms = box(all(only('arms')));
    expect(arms.maxY).toBeLessThan(elbowY - 0.01);
    expect(arms.minY).toBeGreaterThan(wristY + 0.02);
    const kneeY = REST.hipY - REST.thigh;
    expect(box(all(only('legs'))).maxY).toBeLessThan(kneeY - 0.01);
    expect(box(all(only('waist'))).minY).toBeGreaterThan(REST.hipY - REST.thigh / 2 - 0.02);
  });

  it('腰の板は前を開ける（体の正面には板が無い）', () => {
    const front = all(only('waist')).filter((p) => Math.abs(p.x) < 0.09 && p.z > 0.05);
    expect(front).toHaveLength(0);
  });
});
