// 灯継ぎの里: 外周の山岳景観。歩行・当たり・施設・セーブには関与しない。
// 5段の内側は既存 map、外側だけをこのモジュールで描く。#24 の景観原画を立体化する第一版。
// 全周の山肌は連続した高さ場、木と建物はインスタンス、川と湯気だけを更新する。
import {
  BoxGeometry, BufferGeometry, Color, DataTexture, DoubleSide, Euler, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Points, PointsMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3,
} from 'three';
import { SeededRng } from '../core/seededRng';
import type { HubDef, MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
import { tileMaterial } from './envArt';

type V = readonly [number, number, number];
type B = MapDef['bounds'];
type WaterRun = { x: number; z: number; y: number; dir: number };
type Instance = { matrix: Matrix4; color: number };
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const outside = (b: B, x: number, z: number): number => Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ, 0);
const C = { timber: 0x594330, timberLight: 0x86664a, roof: 0x51594f, wall: 0xb5a68b, rock: 0x77796e, cloth: 0x9e5440, lamp: 0xffc77a, dark: 0x393a32 };
const RINGS = [1, 3, 6, 10, 15, 21, 28, 36, 46, 58, 72, 90, 112, 138, 170, 205, 238] as const;
const axis = (a: number, b: number): number[] => {
  const n = Math.ceil((b - a) / 4);
  return [...RINGS.slice().reverse().map((d) => a - d), ...Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n)), ...RINGS.map((d) => b + d)];
};

function gateRuns(hub: HubDef, map: MapDef) {
  const b = map.bounds;
  return (hub.gates ?? []).filter((g) => g.trail).map((g) => {
    const [ox, oz] = Math.abs(g.x - b.maxX) < 0.6 ? [1, 0] : Math.abs(g.x - b.minX) < 0.6 ? [-1, 0] : Math.abs(g.z - b.maxZ) < 0.6 ? [0, 1] : [0, -1];
    return { x: g.x, z: g.z, ox, oz, y: groundAt(map.platforms, g.x - ox * 0.5, g.z - oz * 0.5) };
  });
}
function riverRuns(map: MapDef): WaterRun[] {
  const p = map.platforms.filter((q) => q.look === 'water');
  if (!p.length) return [];
  const n = p.reduce((a, q) => q.maxZ > a.maxZ ? q : a);
  const s = p.reduce((a, q) => q.minZ < a.minZ ? q : a);
  return [{ x: (n.minX + n.maxX) / 2, z: n.maxZ, y: n.h, dir: 1 },
    { x: (s.minX + s.maxX) / 2, z: s.minZ, y: s.h, dir: -1 }];
}
function riverX(r: WaterRun, d: number): number {
  return r.x + 5 * Math.sin(d / 24) + 0.035 * d;
}
function riverY(r: WaterRun, d: number): number {
  // 上流から既存の沢へ、さらに谷底へ。急勾配の区間が外周の滝になる。
  return r.y + r.dir * (0.15 * d + 0.0022 * d * d + 9 * smooth(13, 20, d));
}

/** 外周の連続高さ場。内側の段の高さを読み取るが、正本データには書き込まない。 */
function landscape(hub: HubDef, map: MapDef) {
  const b = map.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const gates = gateRuns(hub, map), rivers = riverRuns(map);
  const elevation = (x: number, z: number): number => {
    const d = outside(b, x, z);
    const base = groundAt(map.platforms, clamp(x, b.minX + 0.02, b.maxX - 0.02), clamp(z, b.minZ + 0.02, b.maxZ - 0.02));
    const a = Math.atan2(x - cx, z - cz);
    const south = smooth(0.05, 0.85, -Math.cos(a));
    const shoulder = 13 + 13 * (0.5 + 0.5 * Math.cos(a)) + 8 * Math.sin(3 * a + 0.7);
    const rolling = (7 * Math.sin(x * 0.064 + z * 0.021) + 4.6 * Math.cos(z * 0.092 - x * 0.046) + 2.2 * Math.sin(x * 0.23 + z * 0.17));
    const valley = (8 + 24 * south) * Math.exp(-(((d - 32) / 27) ** 2));
    const distant = (23 + 15 * Math.sin(4 * a + 0.5) + 9 * Math.cos(7 * a)) * smooth(43, 96, d);
    let y = base * Math.exp(-d / 68) - 0.8
      + shoulder * (1 - Math.exp(-d / 31)) * (1 - 0.54 * south)
      - valley * smooth(0, 12, d)
      + rolling * smooth(2, 28, d) + distant;
    // 狩場門・閉鎖された谷門の外の既存斜面（D=45m）を土で埋めない。
    for (const g of gates) {
      const gd = (x - g.x) * g.ox + (z - g.z) * g.oz;
      const l = Math.abs(-(x - g.x) * g.oz + (z - g.z) * g.ox);
      if (gd < 0 || gd > 61 || l > 24) continue;
      const limit = g.y - 0.95 - 0.05 * gd - 0.011 * gd * gd - 0.012 * Math.max(0, l - 4) ** 1.5;
      const influence = (1 - smooth(17, 24, l)) * (1 - smooth(45, 61, gd));
      y = lerp(y, Math.min(y, limit), influence);
    }
    for (const r of rivers) {
      const rd = (z - r.z) * r.dir;
      if (rd < 0 || rd > 105) continue;
      const l = Math.abs(x - riverX(r, rd));
      const fade = (1 - smooth(4, 13, l)) * (1 - smooth(86, 105, rd));
      y = lerp(y, riverY(r, rd) - 1.0 + Math.max(0, l - 2.0) * 0.25, fade);
    }
    return y;
  };
  const xs = axis(b.minX, b.maxX), zs = axis(b.minZ, b.maxZ);
  const heights = zs.map((z) => xs.map((x) => elevation(x, z)));
  const pos: number[] = [], col: number[] = [], uv: number[] = [], ids: number[] = [];
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!, z = zs[j]!, y = heights[j]![i]!;
    const d = outside(b, x, z);
    const moss = 0.5 + 0.5 * Math.sin(x * 0.17 + z * 0.13) * Math.cos(z * 0.097);
    const band = 0.5 + 0.5 * Math.sin(y * 0.56 + x * 0.037 + z * 0.029);
    const tint = 0.87 + 0.14 * band;
    const fade = smooth(100, 238, d);
    pos.push(x, y, z);
    col.push(lerp((0.88 - 0.22 * moss) * tint, 0.94, fade), lerp((0.93 - 0.07 * moss) * tint, 0.97, fade), lerp((0.83 - 0.23 * moss) * tint, 0.91, fade));
    uv.push(x / 5, -z / 5);
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i]! >= b.minX && xs[i + 1]! <= b.maxX && zs[j]! >= b.minZ && zs[j + 1]! <= b.maxZ) continue;
    const a = j * xs.length + i, c = a + xs.length;
    ids.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(ids); geo.computeVertexNormals();
  // 配置する物の足元は、実際に描く三角形の補間高さ（解析式の高さではない）。
  function height(x: number, z: number): number {
    const ix = xs.findIndex((v) => v > x), iz = zs.findIndex((v) => v > z);
    const i = ix < 0 ? xs.length - 2 : Math.max(0, ix - 1);
    const j = iz < 0 ? zs.length - 2 : Math.max(0, iz - 1);
    const u = clamp((x - xs[i]!) / (xs[i + 1]! - xs[i]!), 0, 1);
    const v = clamp((z - zs[j]!) / (zs[j + 1]! - zs[j]!), 0, 1);
    const a = heights[j]![i]!, c = heights[j + 1]![i]!, bb = heights[j]![i + 1]!, dd = heights[j + 1]![i + 1]!;
    return u + v <= 1 ? a * (1 - u - v) + bb * u + c * v : dd * (u + v - 1) + bb * (1 - v) + c * (1 - u);
  }
  const reserved = (x: number, z: number, pad = 0): boolean => {
    if (outside(b, x, z) < 4 + pad) return true;
    if (gates.some((g) => {
      const d = (x - g.x) * g.ox + (z - g.z) * g.oz;
      return d >= 0 && d < 49 && Math.abs(-(x - g.x) * g.oz + (z - g.z) * g.ox) < 9 + pad;
    })) return true;
    return rivers.some((r) => {
      const d = (z - r.z) * r.dir;
      return d >= 0 && d < 98 && Math.abs(x - riverX(r, d)) < 6 + pad;
    });
  };
  return { geo, height, rivers, gates, reserved, b, cx, cz };
}

/** 角材・石・瓦・窓の各部品をインスタンス化する。外周物には動的影も衝突も付けない。 */
class Batch {
  readonly items: Instance[] = [];
  add(p: V, s: V, color: number, yaw = 0, pitch = 0, roll = 0): void {
    this.items.push({ matrix: new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ')), new Vector3(...s)), color });
  }
  beam(a: V, b: V, w: number, color: number): void {
    const v = new Vector3(...b).sub(new Vector3(...a)), l = v.length();
    if (l < 0.001) return;
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), v.multiplyScalar(1 / l));
    this.items.push({ matrix: new Matrix4().compose(new Vector3(...a).add(new Vector3(...b)).multiplyScalar(0.5), q, new Vector3(w, l, w)), color });
  }
  mesh(geometry: BufferGeometry, material: MeshLambertMaterial | MeshBasicMaterial, name: string): InstancedMesh {
    const m = new InstancedMesh(geometry, material, this.items.length);
    const color = new Color();
    this.items.forEach((p, i) => { m.setMatrixAt(i, p.matrix); m.setColorAt(i, color.set(p.color)); });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere(); m.name = name;
    m.castShadow = false; m.receiveShadow = false;
    m.userData.noMerge = true;
    return m;
  }
}

/** 不規則な枝先の4段の針葉樹（幹込み）。各層の頂点に色を持つ。 */
function cedarGeometry(): BufferGeometry {
  const p: number[] = [], c: number[] = [];
  const tri = (a: V, b: V, cc: V, rgb: V): void => { p.push(...a, ...b, ...cc); for (let i = 0; i < 3; i++) c.push(...rgb); };
  for (let k = 0; k < 5; k++) {
    const a = k * Math.PI * 2 / 5, b = (k + 1) * Math.PI * 2 / 5;
    const q: V = [0.035 * Math.cos(a), 0, 0.035 * Math.sin(a)], r: V = [0.035 * Math.cos(b), 0, 0.035 * Math.sin(b)];
    const qt: V = [q[0] * 0.5, 0.78, q[2] * 0.5], rt: V = [r[0] * 0.5, 0.78, r[2] * 0.5];
    tri(q, qt, r, [0.30, 0.21, 0.13]); tri(r, qt, rt, [0.26, 0.18, 0.11]);
  }
  for (let layer = 0; layer < 4; layer++) {
    const y = 0.17 + layer * 0.17, r = 0.23 - layer * 0.043, top: V = [0.013 * Math.sin(layer), y + 0.32, 0];
    const ring = Array.from({ length: 8 }, (_, k): V => {
      const a = (k + layer * 0.33) * Math.PI / 4, rr = r * (k % 2 ? 0.72 : 1);
      return [rr * Math.cos(a), y + (k % 2 ? 0.036 : 0), rr * Math.sin(a)];
    });
    for (let k = 0; k < 8; k++) {
      const a = ring[k]!, b = ring[(k + 1) % 8]!, f = k % 2 ? 0.9 : 1.05;
      tri(a, top, b, [0.17 * f, (0.38 + layer * 0.021) * f, 0.20 * f]);
      tri(a, b, [0, y + 0.045, 0], [0.10, 0.20, 0.10]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3)); g.setAttribute('color', new Float32BufferAttribute(c, 3)); g.computeVertexNormals();
  return g;
}
function gableGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0,
    0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0,
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0,
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0,
  ], 3)); g.computeVertexNormals();
  return g;
}

function rippleTexture(): DataTexture {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, b = j / n * Math.PI * 2;
    const f = Math.pow(0.5 + 0.5 * Math.sin(3 * b + 1.2 * Math.sin(3 * a) + 0.35 * Math.sin(7 * a - b)), 7);
    const k = (j * n + i) * 4;
    data.set([57 + 144 * f, 88 + 130 * f, 81 + 137 * f, 255], k);
  }
  const t = new DataTexture(data, n, n); t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = t.minFilter = LinearFilter; t.needsUpdate = true;
  return t;
}
function steamTexture(): DataTexture {
  const n = 32, a = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const r = Math.hypot((i + 0.5 - n / 2) / (n / 2), (j + 0.5 - n / 2) / (n / 2));
    a.set([240, 240, 231, Math.round(220 * Math.max(0, 1 - r) ** 1.6)], (j * n + i) * 4);
  }
  const t = new DataTexture(a, n, n); t.magFilter = t.minFilter = LinearFilter; t.needsUpdate = true; return t;
}
export interface HubOutskirts { group: Group; update(time: number): void }

export function buildHubOutskirts(hub: HubDef, map: MapDef): HubOutskirts {
  const terrain = landscape(hub, map);
  const { b, cx, cz, height, reserved, rivers } = terrain;
  const group = new Group(); group.name = 'hub-mountain-outskirts'; group.userData.noMerge = true;
  const land = new Mesh(terrain.geo, tileMaterial('moss', 0xffffff, { vertexColors: true, gain: 1.4 }));
  land.name = 'mountain-terrain'; land.userData.noMerge = true; land.receiveShadow = false; group.add(land);
  const boxes = new Batch(), gables = new Batch(), lights = new Batch(), rocks = new Batch(), cedars = new Batch(), leaves = new Batch();
  const sites: { x: number; z: number; r: number }[] = [];
  const rng = new SeededRng(27112026);
  const litMat = new MeshBasicMaterial({ color: 0xffffff });
  const woodMat = new MeshLambertMaterial({ color: 0xffffff });
  const marker = (x: number, y: number, z: number, s = 1): void => {
    boxes.add([x, y + 0.65 * s, z], [0.24 * s, 1.3 * s, 0.24 * s], C.rock);
    boxes.add([x, y + 1.35 * s, z], [0.65 * s, 0.16 * s, 0.65 * s], C.timber);
    lights.add([x, y + 1.65 * s, z], [0.44 * s, 0.49 * s, 0.44 * s], C.lamp);
    boxes.add([x, y + 1.96 * s, z], [0.74 * s, 0.18 * s, 0.74 * s], C.roof);
  };
  function building(x: number, z: number, s: number, tower = false): number | null {
    const radius = 4.5 * s;
    if (reserved(x, z, radius) || sites.some((a) => Math.hypot(a.x - x, a.z - z) < a.r + radius + 1)) return null;
    const yaw = Math.atan2(cx - x, cz - z), ca = Math.cos(yaw), sa = Math.sin(yaw);
    const corners = [[-2.5, -1.8], [2.5, -1.8], [-2.5, 1.8], [2.5, 1.8]] as const;
    const world = (u: number, v: number): [number, number] => [x + s * (u * ca + v * sa), z + s * (-u * sa + v * ca)];
    const foot = corners.map(([u, v]) => { const [xx, zz] = world(u, v); return height(xx, zz); });
    const y = Math.max(height(x, z), ...foot) + 0.4;
    if (y - Math.min(...foot) > 11 * s) return null;
    sites.push({ x, z, r: radius });
    const at = (u: number, v: number, w: number): V => { const [xx, zz] = world(u, w); return [xx, y + v * s, zz]; };
    const box = (u: number, v: number, w: number, a: number, bb: number, c: number, color: number, pitch = 0): void => boxes.add(at(u, v, w), [a * s, bb * s, c * s], color, yaw, pitch);
    const deck = tower ? 4.4 : 0.0;
    const eave = deck + 2.65, rise = 1.25, depth = 4.2;
    for (let i = 0; i < corners.length; i++) {
      const [u, w] = corners[i]!, p = at(u, deck + 0.1, w);
      boxes.beam([p[0], foot[i]! - 0.55, p[2]], p, 0.39 * s, C.timber);
      if (tower) boxes.beam(at(u, 0, w), at(-u, deck, w), 0.20 * s, C.timber);
    }
    box(0, deck, 0, 6.1, 0.22, 4.5, C.timber);
    box(0, deck + 1.25, 0, 4.9, 2.5, 3.55, C.wall);
    gables.add(at(0, eave - 0.16, 0), [4.9 * s, rise * s, 3.55 * s], C.timber, yaw);
    const pitch = Math.atan2(rise, depth / 2);
    for (const sign of [-1, 1]) {
      box(0, eave + rise / 2, sign * depth / 4, 5.9, 0.15, Math.hypot(depth / 2, rise) + 0.38, C.roof, sign * pitch);
      for (const xx of [-2.34, 0, 2.34]) box(xx, deck + 1.25, sign * 1.81, 0.18, 2.52, 0.14, C.timber);
      for (const xx of [-1.35, 1.35]) {
        box(xx, deck + 1.55, sign * 1.82, 0.91, 0.9, 0.15, C.timber);
        lights.add(at(xx, deck + 1.55, sign * 1.915), [0.69 * s, 0.68 * s, 0.06 * s], C.lamp, yaw);
        box(xx, deck + 1.55, sign * 1.96, 0.07, 0.72, 0.05, C.timber);
      }
    }
    box(0, eave + rise, 0, 6.2, 0.20, 0.24, C.timberLight);
    box(0, deck + 0.95, 1.86, 0.94, 1.9, 0.17, C.dark);
    if (tower) {
      for (const sign of [-1, 1]) box(sign * 2.78, deck + 0.6, 0, 0.16, 1.2, 4.5, C.timber);
      box(0, deck + 1.4, 2.3, 1.15, 0.92, 0.09, C.cloth);
    } else {
      box(1.95, deck + 1.65, 2.13, 0.86, 0.56, 0.08, C.cloth);
      box(0, deck + 2.35, 2.14, 2.1, 0.15, 0.78, C.timberLight);
    }
    marker(x + 3.4 * s * ca, height(x + 3.4 * s * ca, z - 3.4 * s * sa), z - 3.4 * s * sa, s * 0.85);
    return y;
  }
  // 同じ集落に見える山腹の小屋・見張り台。座標は既存範囲からの相対値。
  const buildings = [
    [b.minX - 19, cz + 16, 1.08, false], [b.minX - 28, cz - 13, 0.96, false],
    [b.minX - 37, b.maxZ + 12, 1.4, true], [b.minX - 19, b.maxZ + 26, 1.14, false],
    [b.maxX + 23, b.maxZ - 9, 1.12, true], [b.maxX + 28, b.maxZ - 32, 0.98, false],
    [b.maxX + 44, cz - 29, 1.22, true], [b.minX + 14, b.minZ - 24, 0.9, false],
    [b.maxX - 12, b.minZ - 48, 1.05, false], [cx + 5, b.maxZ + 42, 1.3, true],
  ] as const;
  for (const [x, z, s, tower] of buildings) building(x, z, s, tower);

  // 谷沿いの離れた作業桟道。両端に支持脚、床板と二本の手すり。通行可能な橋とは別物。
  const bx = b.maxX + 37, za = b.maxZ - 16, zb = b.maxZ - 42, steps = 20;
  const profile = Array.from({ length: steps + 1 }, (_, i) => height(bx, lerp(za, zb, i / steps)));
  const top = Math.max(...profile) + 2.1;
  const bridgeY = (t: number): number => top - 1.15 * Math.sin(Math.PI * t);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, z = lerp(za, zb, t), y = bridgeY(t);
    boxes.add([bx, y, z], [2.7, 0.18, Math.abs(za - zb) / steps + 0.04], C.timberLight);
    for (const side of [-1, 1]) {
      const xx = bx + side * 1.28;
      if (i % 4 === 0 || i === steps) boxes.beam([xx, height(xx, z) - 0.5, z], [xx, y + 1.2, z], 0.23, C.timber);
      if (i < steps) {
        const nz = lerp(za, zb, (i + 1) / steps), ny = bridgeY((i + 1) / steps);
        boxes.beam([xx, y + 1.05, z], [xx, ny + 1.05, nz], 0.085, C.timber);
        boxes.beam([xx, y - 0.16, z], [xx, ny - 0.16, nz], 0.14, C.timber);
      }
    }
  }
  sites.push({ x: bx, z: (za + zb) / 2, r: Math.abs(za - zb) / 2 + 3 });

  // 温泉の湯気と休憩所。湯船は遠景の飾り（入浴機能は未実装）。
  const tx = b.minX - 28, tz = cz + 2;
  const bathY = building(tx, tz, 0.94);
  let steam: Points | null = null;
  if (bathY !== null) {
    const px = tx - 5.8, pz = tz + 1.5, py = Math.max(height(px, pz), height(px - 2, pz), height(px + 2, pz), height(px, pz - 2), height(px, pz + 2)) + 0.32;
    boxes.add([px, py - 0.35, pz], [4.5, 0.7, 3.8], C.rock);
    boxes.add([px, py + 0.03, pz], [3.9, 0.1, 3.2], 0x719b91);
    for (const side of [-1, 1]) {
      boxes.add([px + side * 2.06, py + 0.23, pz], [0.38, 0.43, 3.8], C.rock);
      boxes.add([px, py + 0.23, pz + side * 1.76], [4.5, 0.43, 0.35], C.rock);
    }
    const g = new BufferGeometry(), steamPos = new Float32Array(18);
    for (let i = 0; i < 6; i++) steamPos.set([px, py + 0.5, pz], i * 3);
    g.setAttribute('position', new Float32BufferAttribute(steamPos, 3));
    steam = new Points(g, new PointsMaterial({ color: 0xe3e0d2, size: 4.2, map: steamTexture(), transparent: true, opacity: 0.28, depthWrite: false }));
    steam.name = 'outer-spring-steam'; steam.frustumCulled = false;
    steam.userData.origin = [px, py, pz]; group.add(steam);
    sites.push({ x: px, z: pz, r: 4 });
  }

  // 森林は4方向×3距離帯、固定seed。通路、沢、建物と桟道から離す。遠い杉は粗い同じ立体のインスタンス。
  const onSite = (x: number, z: number, r: number): boolean => sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + r);
  let cedarCount = 0, autumnCount = 0;
  for (let side = 0; side < 4; side++) for (const [lo, hi, count] of [[6, 20, 17], [20, 50, 21], [50, 104, 24]] as const) {
    for (let i = 0; i < count; i++) {
      const d = rng.range(lo, hi), t = rng.next();
      const x = side === 0 ? b.minX - d : side === 1 ? b.maxX + d : lerp(b.minX - d, b.maxX + d, t);
      const z = side === 2 ? b.minZ - d : side === 3 ? b.maxZ + d : lerp(b.minZ - d, b.maxZ + d, t);
      const h = rng.range(5.1, 11.4), y = height(x, z), r = h * 0.25;
      if (reserved(x, z, r) || onSite(x, z, r)) continue;
      const grade = Math.max(Math.abs(height(x + 1.5, z) - height(x - 1.5, z)), Math.abs(height(x, z + 1.5) - height(x, z - 1.5)));
      if (grade > 6) continue;
      const yaw = rng.range(0, 6.2831853);
      if (d < 26 && rng.next() < 0.11) {
        const palette = [0x934e36, 0xae613a, 0xb28a49, 0x73884b];
        boxes.add([x, y + h * 0.36 - 0.4, z], [0.44, h * 0.77, 0.44], C.timber, yaw);
        for (let k = 0; k < 3; k++) {
          const a = yaw + k * Math.PI * 2 / 3, s = rng.range(0.25, 0.37) * h;
          leaves.add([x + h * 0.16 * Math.cos(a), y + h * rng.range(0.70, 0.88), z + h * 0.16 * Math.sin(a)], [s, s * 0.75, s], palette[rng.int(palette.length)]!, yaw);
        }
        autumnCount++;
      } else {
        cedars.add([x, y - 0.55, z], [h, h, h], rng.next() < 0.5 ? 0xe9eed9 : 0xcddac5, yaw);
        cedarCount++;
      }
      if (d < 38 && i % 3 === 0) {
        const q = rng.range(0.9, 2.3);
        rocks.add([x + 0.8, y - 0.35, z - 0.7], [q * 1.5, q, q * 1.1], rng.next() < 0.5 ? 0x74786c : 0x8d8d80, yaw);
      }
    }
  }

  // 木の幹と葉、家屋と橋の角材を一括描画。遠景は従来の絵と霧も利用する。
  if (cedars.items.length) group.add(cedars.mesh(cedarGeometry(), new MeshLambertMaterial({ vertexColors: true, color: 0xffffff, side: DoubleSide }), 'mountain-cedars'));
  if (leaves.items.length) group.add(leaves.mesh(new IcosahedronGeometry(1, 1), woodMat, 'autumn-canopies'));
  if (rocks.items.length) group.add(rocks.mesh(new IcosahedronGeometry(1, 0), woodMat, 'outer-boulders'));
  if (boxes.items.length) group.add(boxes.mesh(new BoxGeometry(1, 1, 1), woodMat, 'outer-timber-stone'));
  if (gables.items.length) group.add(gables.mesh(gableGeometry(), new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide }), 'outer-gables'));
  if (lights.items.length) group.add(lights.mesh(new BoxGeometry(1, 1, 1), litMat, 'outer-window-lights'));

  const ripple = rippleTexture(), waterPos: number[] = [], waterUv: number[] = [];
  // 各端から水を伸ばす。勾配区間は連続した滝、急流の筋は繰返し水面テクスチャで流す。
  for (const r of rivers) {
    for (let d = 0; d < 88; d += 2) {
      const d2 = d + 2, x = riverX(r, d), x2 = riverX(r, d2);
      const w = 1.65 + 0.6 * smooth(3, 50, d);
      const z = r.z + r.dir * d, z2 = r.z + r.dir * d2;
      const y = riverY(r, d) + 0.055, y2 = riverY(r, d2) + 0.055;
      waterPos.push(x - w, y, z, x + w, y, z, x2 + w, y2, z2, x - w, y, z, x2 + w, y2, z2, x2 - w, y2, z2);
      const v = r.dir * d / 6, v2 = r.dir * d2 / 6;
      waterUv.push(0, v, 1, v, 1, v2, 0, v, 1, v2, 0, v2);
    }
  }
  if (waterPos.length) {
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(waterPos, 3));
    g.setAttribute('uv', new Float32BufferAttribute(waterUv, 2)); g.computeVertexNormals();
    const m = new Mesh(g, new MeshLambertMaterial({ map: ripple, color: 0xb7d4c4, side: DoubleSide }));
    m.name = 'outer-streams'; group.add(m);
  } else ripple.dispose();
  group.userData.sceneryOnly = true;
  group.userData.counts = { cedars: cedarCount, autumn: autumnCount, buildings: gables.items.length, bridges: 1, rivers: rivers.length, steam: steam !== null };
  group.userData.sites = sites.map((s) => ({ ...s }));
  return {
    group,
    update(time: number): void {
      ripple.offset.y = (time * 0.13) % 1;
      if (steam) {
        const o = steam.userData.origin as number[];
        const attr = steam.geometry.getAttribute('position');
        for (let i = 0; i < attr.count; i++) {
          const f = (time * 0.22 + i / attr.count) % 1;
          attr.setXYZ(i, o[0]! + Math.sin(i * 2.1 + f * 2) * 1.2 + f * 1.6, o[1]! + 0.55 + f * 4, o[2]! + Math.cos(i * 1.6) * 0.8);
        }
        attr.needsUpdate = true;
      }
    },
  };
}
