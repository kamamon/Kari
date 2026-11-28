// 響笛・銃槍・軽弩・重弩（里鍛ち）の仮モデル（v0.80.0。ChatGPT の #39 の形の案を、1 つのメッシュへまとめ直した。D-180）。
// 設定図はまだ無い: 単色の箱・筒・石を組んだ仮の形で、色は頂点へ焼いてある（1 つの武器 = 1 つのメッシュ = 描画 1 回）。
// どれも原点は握り、+Y が武器の先（銃槍・軽弩・重弩は銃口）。軽弩・重弩は、狙った時に +Z が上（照星の側）、-Z が下（握りと銃床の側）。
// 単位 m。当たり判定（技データ・軌道）は、この形を読まない。
import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshLambertMaterial, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponModel } from './heavyBlade';

const STEEL = 0x7d9097;
const DARK = 0x303b41;
const BRONZE = 0xc29353;
const LEATHER = 0x64432d;
const WOOD = 0x7a5a3a;
const GEM = 0x85bec0;

/** 部品を集めて、色を頂点へ焼き、1 つのメッシュにまとめる */
class Kit {
  private readonly parts: BufferGeometry[] = [];

  private put(g: BufferGeometry, color: number): void {
    const flat = g.toNonIndexed();
    g.dispose();
    flat.deleteAttribute('uv');
    const n = flat.attributes.position!.count;
    const c = new Color(color);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    flat.setAttribute('color', new BufferAttribute(colors, 3));
    this.parts.push(flat);
  }

  /** 箱（中心と大きさ）。rx・rz は傾き（rad） */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rx = 0, rz = 0): void {
    const g = new BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    this.put(g, color);
  }

  /** 筒（武器の軸 = +Y に沿う。上の半径・下の半径・長さ） */
  tube(x: number, y: number, z: number, rTop: number, rBottom: number, h: number, color: number, segments = 10): void {
    const g = new CylinderGeometry(rTop, rBottom, h, segments);
    g.translate(x, y, z);
    this.put(g, color);
  }

  /** 石（面取りした粒。伸ばし方 sx・sy・sz） */
  stone(x: number, y: number, z: number, r: number, sx: number, sy: number, sz: number, color: number): void {
    const g = new IcosahedronGeometry(r, 0);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    this.put(g, color);
  }

  build(name: string): WeaponModel {
    const merged = mergeGeometries(this.parts, false)!;
    for (const g of this.parts) g.dispose();
    merged.computeVertexNormals();
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.castShadow = true;
    mesh.name = `${name}-body`;
    const group = new Group();
    group.name = name;
    group.add(mesh);
    return { group, art: [], triangles: merged.attributes.position!.count / 3 };
  }
}

/** 響笛: 長い柄の先に、鐘の形の響胴（当たりの頭は 0.95〜1.27m。大槌と同じ） */
export function buildHuntingHorn(): WeaponModel {
  const k = new Kit();
  k.tube(0, 0.31, 0, 0.038, 0.045, 0.98, LEATHER);
  k.tube(0, -0.19, 0, 0.059, 0.05, 0.13, BRONZE);
  for (const y of [0.04, 0.25, 0.48, 0.73]) k.tube(0, y, 0, 0.052, 0.052, 0.045, BRONZE);
  // 吹き口の管（柄に沿う）と、響胴の首
  k.box(0.075, 0.54, 0, 0.075, 0.2, 0.07, STEEL);
  k.tube(0, 0.91, 0, 0.115, 0.066, 0.22, STEEL, 8);
  // 響胴: 暗い胴に、青銅の縦の骨 6 本と口の輪
  k.tube(0, 1.12, 0, 0.23, 0.14, 0.3, DARK, 12);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    k.box(0.18 * Math.cos(a), 1.11, 0.18 * Math.sin(a), 0.065, 0.29, 0.065, BRONZE);
  }
  k.tube(0, 1.26, 0, 0.23, 0.19, 0.1, BRONZE, 12);
  k.tube(0, 1.32, 0, 0.19, 0.19, 0.025, DARK, 12);
  k.stone(0, 1.08, -0.23, 0.14, 0.6, 1, 0.6, GEM);
  return k.build('hunting_horn');
}

/** 銃槍: 柄の先に砲の胴、その先に砲身と、下へ付く穂先（当たりは 0.9〜2.36m。長尖槍と同じ） */
export function buildGunlance(): WeaponModel {
  const k = new Kit();
  k.tube(0, 0.32, 0, 0.053, 0.055, 1.22, LEATHER);
  k.tube(0, -0.27, 0, 0.065, 0.05, 0.16, BRONZE);
  // 砲の胴と、弾倉の飾り
  k.box(0, 0.96, 0, 0.23, 0.68, 0.22, DARK);
  for (const z of [-0.12, 0.12]) {
    k.box(0, 1.03, z, 0.18, 0.35, 0.025, BRONZE);
    k.stone(0, 1.02, z * 1.2, 0.09, 1, 1, 0.45, GEM);
  }
  // 砲身と砲口の輪
  k.tube(0, 1.32, 0, 0.085, 0.12, 0.68, STEEL, 12);
  k.tube(0, 1.83, 0, 0.075, 0.09, 0.55, STEEL);
  k.tube(0, 2.08, 0, 0.095, 0.095, 0.075, BRONZE);
  // 穂先（砲口の下 = -Z の側）
  k.box(0, 2.11, -0.1, 0.095, 0.36, 0.07, STEEL);
  k.stone(0, 2.27, -0.08, 0.15, 0.34, 1.0, 0.4, STEEL);
  return k.build('gunlance');
}

/** 軽弩・重弩: 銃床・機関部・銃身と、銃身を横切る弩の腕（弓の形の板ばね）。重弩は太く長く、両脇に受けの板 */
function crossbowGun(heavy: boolean): WeaponModel {
  const k = new Kit();
  const w = heavy ? 0.22 : 0.16;
  const len = heavy ? 1.05 : 0.78;
  // 機関部・銃床（握りの後ろ）・握り
  k.box(0, 0.16, 0, w, 0.48, w * 0.85, DARK);
  k.box(0, -0.17, 0.035, w * 0.73, 0.28, w * 0.8, WOOD);
  k.box(0, 0.02, 0.07, w * 0.5, 0.15, 0.11, LEATHER);
  k.box(0, 0.26, -w * 0.6, w * 0.75, 0.18, 0.09, LEATHER);
  k.box(0, -0.18, -0.09, w * 0.8, 0.23, 0.055, STEEL);
  // 銃身と銃口の輪
  k.tube(0, 0.25 + len / 2, 0, w * 0.4, w * 0.46, len - 0.5, STEEL, 12);
  k.tube(0, len - 0.035, 0, w * 0.5, w * 0.4, 0.07, BRONZE);
  // 上の帯（照星の側）
  for (const y of [0.18, 0.34]) k.box(0, y, w * 0.5, w, 0.06, 0.035, BRONZE);
  k.stone(w * 0.57, 0.18, 0, 0.075, 0.38, 1.3, 0.6, GEM);
  // 弩の腕: 銃身の中ほどから、左右へ開いて後ろへ反る
  const limbY = len * 0.66;
  const limb = heavy ? 0.3 : 0.24;
  for (const side of [-1, 1]) {
    k.box(side * (w * 0.4 + limb * 0.5), limbY - limb * 0.14, 0, limb, 0.045, 0.03, WOOD, 0, side * -0.3);
    k.box(side * (w * 0.4 + limb), limbY - limb * 0.3, 0, 0.035, 0.07, 0.04, BRONZE);
  }
  k.box(0, limbY, 0, w * 1.1, 0.07, w * 0.7, BRONZE);
  if (heavy) {
    // 両脇の受けの板と、下の脚
    for (const side of [-1, 1]) k.box(side * 0.15, 0.29, 0, 0.05, 0.5, 0.19, STEEL);
    k.box(0, 0.52, -w * 0.62, 0.05, 0.05, 0.16, STEEL);
  } else k.box(0.1, 0.22, 0, 0.07, 0.2, 0.09, BRONZE);
  return k.build(heavy ? 'heavy_bowgun' : 'light_bowgun');
}

export const buildLightBowgun = (): WeaponModel => crossbowGun(false);
export const buildHeavyBowgun = (): WeaponModel => crossbowGun(true);
