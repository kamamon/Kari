// 防具の見た目（src/render/hunterArmor.ts、v0.10.0。兜の設定図 v2 と、段ごとの違い（設定図 B）は v0.12.1）。
// 依頼 7 の設定図と、依頼文の「動きのための決まり」を、形の数値で確かめる。
// 座標: m、Y 上、+Z 前、+X が本人の左。静止姿勢（腕は真下）。
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { ARMOR_SLOTS, type ArmorSlot } from '../src/data/schemas';
import { REST } from '../src/render/bodySolve';
import { ARMOR_TIERS, HELM_BAND_LIFT, HELM_SHAPE, HELM_Z, armorLookKey, armorTierOf, buildHunterArmor, type ArmorLook } from '../src/render/hunterArmor';
import { HEAD_SHAPE } from '../src/render/hunterBody';
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

describe('防具の見た目: 段ごとの違い（設定図 B。岩の色は変えず、筋と晶が増える）', () => {
  const tris = (slot: ArmorSlot, tier: number): number => {
    const b = buildHunterArmor(only(slot, tier))!;
    return b.rock.triangles + b.rim.triangles;
  };

  it('段の表: 縁は上ほど太く、筋は脈殻から、晶は晶殻から。大きさは少しずつ', () => {
    expect([2, 3, 4, 5].map((t) => ARMOR_TIERS[t]!.veins)).toEqual([0, 2, 2, 3]);
    expect([2, 3, 4, 5].map((t) => ARMOR_TIERS[t]!.grown)).toEqual([0, 0, 1, 2]);
    for (const t of [3, 4, 5]) {
      expect(ARMOR_TIERS[t]!.scale).toBeGreaterThan(ARMOR_TIERS[t - 1]!.scale);
      expect(ARMOR_TIERS[t]!.bevel).toBeGreaterThanOrEqual(ARMOR_TIERS[t - 1]!.bevel);
    }
    expect(ARMOR_TIERS[5]!.scale).toBeLessThanOrEqual(1.12);
  });

  it('岩の板の形（三角形の数）は、どの段も同じ。変わるのは、縁の側（筋と晶）だけ', () => {
    for (const slot of ARMOR_SLOTS) {
      const rock = [2, 3, 4, 5].map((t) => buildHunterArmor(only(slot, t))!.rock.triangles);
      expect(new Set(rock).size, slot).toBe(1);
    }
  });

  it('脈殻から、体の板に晶脈の筋が走る（兜の板には走らせない）', () => {
    for (const slot of ['chest', 'arms', 'waist', 'legs'] as const) expect(tris(slot, 3), slot).toBeGreaterThan(tris(slot, 2));
    expect(tris('head', 3)).toBe(tris('head', 2));
    // 輝殻は、筋が 1 本多い
    expect(tris('legs', 5)).toBeGreaterThan(tris('legs', 4));
    expect(tris('legs', 4)).toBe(tris('legs', 3));
  });

  it('晶殻から、左の肩・左胸・左の腰に晶が育つ。左の籠手は輝殻だけ。脛と兜には育たない', () => {
    expect(tris('chest', 4)).toBeGreaterThan(tris('chest', 3));
    expect(tris('waist', 4)).toBeGreaterThan(tris('waist', 3));
    expect(tris('arms', 4)).toBe(tris('arms', 3));
    expect(tris('arms', 5)).toBeGreaterThan(tris('arms', 4));
    expect(tris('head', 5)).toBe(tris('head', 2));
  });

  it('晶は左側だけ（右側の縁の点の数は、脈殻と晶殻で同じ）', () => {
    for (const slot of ['chest', 'waist'] as const) {
      const right = (t: number): number => points(buildHunterArmor(only(slot, t))!.rim).filter((p) => p.x < -0.03).length;
      expect(right(4), slot).toBe(right(3));
      const left = (t: number): number => points(buildHunterArmor(only(slot, t))!.rim).filter((p) => p.x > 0.03).length;
      expect(left(4), slot).toBeGreaterThan(left(3));
    }
  });

  it('左胸の晶は、板の下の外寄りで、板より前へ出る（同じ場所の右胸より前に、縁の点がある）', () => {
    // 胸の板の、下の外寄り（胴の丸みで、板の中央より奥にある場所）
    const front = (t: number, side: 1 | -1): number => Math.max(...points(buildHunterArmor(only('chest', t))!.rim).filter((p) => p.x * side > 0.09 && p.x * side < 0.145 && p.y > 1.29 && p.y < 1.37 && p.z > 0).map((p) => p.z));
    // 左は、脈殻より 8mm 以上前へ出る。右は、ほとんど変わらない（大きさが 2% 違うだけ）
    expect(front(4, 1)).toBeGreaterThan(front(3, 1) + 0.008);
    expect(Math.abs(front(4, -1) - front(3, -1))).toBeLessThan(0.004);
  });

  it('どの部位を着ているかで、ほかの部位の形は変わらない（一式の頂点は、部位ごとの頂点を合わせたもの）', () => {
    for (const t of [2, 5]) {
      const whole = all(full(t)).length;
      expect(ARMOR_SLOTS.reduce((n, s) => n + all(only(s, t)).length, 0), `段 ${t}`).toBe(whole);
      const chestAlone = box(all(only('chest', t))), chestWithAll = box(all(full(t)).filter((p) => p.y > 1.26 && p.y < 1.56 && Math.abs(p.x) > 0.02));
      expect(chestWithAll.maxX).toBeCloseTo(chestAlone.maxX, 6);
    }
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

  it('兜は、頭の輪郭に沿う（頭より 4mm 以上外で、離れすぎない。利用者の指摘「幅大きすぎ」）', () => {
    // 頭の輪郭（高さごとの、左右・前・後ろの半径）を、鉢の輪の高さで補間する
    const headAt = (y: number): [number, number, number] => {
      const i = HEAD_SHAPE.findIndex((r) => r[0] >= y);
      if (i < 0) return [0, 0, 0];
      const a = HEAD_SHAPE[Math.max(0, i - 1)]!, b = HEAD_SHAPE[i]!;
      const t = b[0] === a[0] ? 0 : (y - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    };
    for (const [y, rx, f, b] of HELM_SHAPE) {
      if (y > 1.7505) continue; // 頭のてっぺんより上は、頭が無い
      const [hx, hf, hb] = headAt(y);
      for (const [helm, head, label] of [[rx, hx, '左右'], [f, hf, '前'], [b, hb, '後ろ']] as const) {
        expect(helm - head, `高さ ${y} ${label}`).toBeGreaterThanOrEqual(0.004);
        // 頭がすぼまる所（1.73m より上）は、丸い鉢が頭から離れる。そこより下は、2cm 以内
        if (y <= 1.73) expect(helm - head, `高さ ${y} ${label}`).toBeLessThanOrEqual(0.02);
      }
    }
    // 額の幅: 頭 15.8cm に対して、鉢 17cm（前の版は 19.4cm）
    const widest = Math.max(...HEAD_SHAPE.map((r) => r[1]));
    expect(HELM_SHAPE[0]![1] - widest).toBeLessThanOrEqual(0.008);
    // 兜ぜんたい（頬当て・鋲を含む）でも、頭の幅から 2cm 以内
    const ps = all(only('head'));
    expect(Math.max(...ps.map((p) => Math.abs(p.x)))).toBeLessThanOrEqual(widest + 0.02);
    // 頬当ては、あごへ向かって内へ傾く（下の縁は、上の縁より 1.2cm 以上、頭の中心に近い）
    for (const side of [1, -1]) {
      const cheek = ps.filter((p) => p.x * side > 0.045 && p.y < 1.655 && p.z > -0.06);
      const upper = Math.max(...cheek.filter((p) => p.y > 1.64).map((p) => p.x * side));
      const lower = Math.max(...cheek.filter((p) => p.y < 1.6).map((p) => p.x * side));
      expect(upper - lower, side > 0 ? '左' : '右').toBeGreaterThan(0.012);
    }
  });

  it('兜（設定図 v2）: 帯が交わるてっぺんに、小さな平たい岩が乗る。うなじの板は、額の帯のすぐ下から下がる（すき間が無い）', () => {
    const b = buildHunterArmor(only('head'))!;
    const rock = points(b.rock);
    // てっぺんの岩: 鉢のてっぺんより上で、頭の真上の小さな範囲
    const domeTop = HELM_SHAPE[HELM_SHAPE.length - 1]![0];
    const tab = rock.filter((p) => p.y > domeTop + 0.003);
    expect(tab.length).toBeGreaterThan(0);
    for (const p of tab) expect(Math.hypot(p.x, p.z)).toBeLessThan(0.03);
    // うなじの板の上の縁は、額の帯（下の縁 1.657m）に届く
    const nape = rock.filter((p) => p.z < -0.085 && Math.abs(p.x) < 0.06 && p.y < 1.662);
    expect(Math.max(...nape.map((p) => p.y))).toBeGreaterThan(1.652);
  });

  it('兜（設定図 v2）: 額の帯に、鋲が 12 個並ぶ（帯より外へ出る小さな粒）', () => {
    const rim = points(buildHunterArmor(only('head'))!.rim);
    // 額の帯の高さで、帯の面（鉢の半径 + 帯の厚み）より外にある点 = 鋲の先
    const [, rx0, f0, b0] = HELM_SHAPE[0]!;
    // （顔の中央の鼻当ては除く）
    const studs = rim.filter((p) => Math.abs(p.x) > 0.015 && p.y > 1.662 && p.y < 1.685 && Math.hypot(p.x / (rx0 + HELM_BAND_LIFT), (p.z - HELM_Z) / ((p.z > HELM_Z ? f0 : b0) + HELM_BAND_LIFT)) > 1.045);
    // 1 個の鋲は、先の 1 点を 5 枚の三角形が共有する（平らな面なので、頂点は 5 つ）
    expect(studs.length).toBe(12 * 5);
    // 前後左右（帯が交わる所）には置かない
    for (const p of studs) expect(Math.min(Math.abs(p.x), Math.abs(p.z - HELM_Z))).toBeGreaterThan(0.018);
  });

  it('頬当ては、左の方が大きい', () => {
    const cheeks = all(only('head')).filter((p) => Math.abs(p.x) > 0.045 && p.y < 1.655 && p.z > -0.06);
    const l = box(cheeks.filter((p) => p.x > 0)), r = box(cheeks.filter((p) => p.x < 0));
    expect(l.maxY - l.minY).toBeGreaterThan(r.maxY - r.minY + 0.015);
    expect(l.maxZ - l.minZ).toBeGreaterThan(r.maxZ - r.minZ + 0.01);
  });

  it('肩当ては、肩から外へ 12cm・上へ 8cm まで（輝殻でも）', () => {
    for (const t of [2, 5]) {
      const b = box(all(only('chest', t)).filter((p) => Math.abs(p.x) > 0.17));
      expect(Math.max(b.maxX, -b.minX), `段 ${t}`).toBeLessThanOrEqual(REST.shoulderX + 0.12);
      // 晶殻・輝殻で左肩に育つ晶も、この中に収める（腕を真上へ振り上げるため）
      expect(b.maxY, `段 ${t}`).toBeLessThanOrEqual(REST.shoulderY + 0.08);
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
