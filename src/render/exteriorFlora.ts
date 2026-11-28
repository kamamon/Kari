// 崖の向こうの木と岩の形（v0.78.0。docs/spec.md の 21.7、D-178）。描画だけ（当たり・戦闘・地図は読まない）。
// 置く場所と大きさは src/render/fieldLandscape.ts（狩場の外側の景観。ChatGPT の #43）が決め、ここが、1 本・1 つの形と色を作る。
//  - 広葉樹: 根元の広がる幹と枝、葉のかたまり（下が暗い、いびつな球を 4〜5 つ）、その表面から外へ出る「葉の付いた小枝の板」
//    （小物の図集の茂みの絵。木の輪郭を、葉の形で不ぞろいにする。下の面にも付けて、見上げた時に、つるりとした底が見えないようにする）
//  - 針葉樹: 幹と、ふちの不ぞろいな傘を 5 段
//  - 岩: 依頼 10 の岩の図（src/render/rockArt.ts。エリアの中の岩と同じ絵）を、斜面に合わせて傾け、根元を地面より下へ埋める
// 乱数は SeededRng（同じエリアは、いつも同じ形）。Math.random は使わない。
import {
  BufferGeometry, Color, Float32BufferAttribute, FrontSide, type Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3,
} from 'three';
import type { SeededRng } from '../core/seededRng';
import { ENV_SPRITES, WIND, loadEnvTexture } from './envArt';
import { imageLambert } from './materialImages';
import { placeBigRock, rockArt, rockArtGeometry, rockOffset, rockTilt, type RockPlacement } from './rockArt';
import { valueNoise3 } from './rockGeo';

export type FloraTree = 'broadleaf' | 'pine' | 'swamp';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---- 形 ----

/** 幹の輪（高さ 0〜1 の位置と、根元の半径を 1 とした太さ）。いちばん下は、根の張り出し */
const TRUNK_RINGS: readonly (readonly [number, number])[] = [[0, 1.5], [0.08, 1.05], [0.5, 0.76], [1, 0.5]];
const TRUNK_SIDES = 5;

/** 幹と枝（高さ 1、根元の半径 1。真ん中が原点）。根元が広がり、上ほど細く、少し曲がる */
export function trunkGeometry(): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (const [t, k] of TRUNK_RINGS) {
    for (let i = 0; i <= TRUNK_SIDES; i++) {
      const a = (i % TRUNK_SIDES) / TRUNK_SIDES * Math.PI * 2;
      // 根の張り出しは、3 つの筋（根）。上は、ほぼ丸
      const root = t < 0.05 ? 1 + 0.22 * Math.max(0, Math.sin(a * 3 + 0.6)) : 1;
      const r = k * root * (1 + 0.07 * Math.sin(a * 2 + t * 5));
      pos.push(Math.cos(a) * r + 0.3 * Math.sin(t * 2.6) * t, t - 0.5, Math.sin(a) * r + 0.22 * Math.sin(t * 3.4 + 1) * t);
      uv.push((i / TRUNK_SIDES) * 2, t * 4);
    }
  }
  const W = TRUNK_SIDES + 1;
  for (let r = 0; r < TRUNK_RINGS.length - 1; r++) {
    for (let i = 0; i < TRUNK_SIDES; i++) {
      const a = r * W + i, b = a + 1, c = a + W, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // つなぎ目（最初と最後の列は同じ場所）の法線をそろえる
  const n = g.getAttribute('normal');
  for (let r = 0; r < TRUNK_RINGS.length; r++) {
    const a = r * W, b = a + TRUNK_SIDES;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  g.computeBoundingSphere();
  return g;
}

/** 葉のかたまりの下の面の明るさ（上の面を 1 として。木の下は暗い） */
export const CROWN_UNDER = 0.5;
/** 葉のかたまりの下の半分の厚み（上の半分を 0.94 として） */
export const CROWN_BELLY = 0.58;

/**
 * 葉のかたまり 1 つ（半径 1 ほどの、いびつな球。80 面）。頂点の色で、下を暗く・上を明るく、むらを付ける（葉の重なりの陰）。
 * 法線は、面の向きと球の向きの間（葉の群れの、やわらかい明暗）。
 */
export function crownGeometry(seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const v = g.getAttribute('position'), n = valueNoise3(seed), m = valueNoise3(seed ^ 0x5bd1);
  const col = new Float32Array(v.count * 3);
  for (let i = 0; i < v.count; i++) {
    const x = v.getX(i), y = v.getY(i), z = v.getZ(i);
    const k = 0.74 + n(x * 2.6 + 3, y * 2.6 + 7, z * 2.6 + 11) * 0.46;
    // 下の半分は平たく（木の下から見える、暗い底のふくらみを小さく）
    v.setXYZ(i, x * k, y * k * (y < 0 ? CROWN_BELLY : 0.94), z * k);
    // 下は暗く（木の中の陰）、上は明るい。かたまりごとのむらを少し。明るい所は、少し黄み
    const lit = CROWN_UNDER + (1.04 - CROWN_UNDER) * smooth(-0.75, 0.7, y) + (m(x * 4.1, y * 4.1, z * 4.1) - 0.5) * 0.16;
    col[i * 3] = lit * (1 + 0.07 * (lit - 0.8));
    col[i * 3 + 1] = lit;
    col[i * 3 + 2] = lit * (1 - 0.12 * (lit - 0.8));
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal'), a = new Vector3(), r = new Vector3();
  for (let i = 0; i < v.count; i++) {
    a.fromBufferAttribute(nrm, i);
    r.fromBufferAttribute(v, i).normalize();
    a.lerp(r, 0.72).normalize();
    nrm.setXYZ(i, a.x, a.y, a.z);
  }
  // かたまりの絵（まだらな明暗）は、2 回繰り返す
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const TIER_TIPS = 9;

/**
 * 針葉樹の枝の傘 1 段（底の半径 1、高さ 1。底が原点）。ふちは、枝先（外へ出て、少し垂れる）と、その間のくぼみが交互に並ぶ。
 * 下の面は暗い（上の段の陰）。枝先は明るい。
 */
export function pineTierGeometry(seed: number): BufferGeometry {
  const n = valueNoise3(seed);
  const pos: number[] = [], col: number[] = [], uv: number[] = [], index: number[] = [];
  const ring: [number, number, number][] = [];
  const N = TIER_TIPS * 2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, tip = i % 2 === 0;
    const r = tip ? 0.9 + n(i * 1.7, 0.5, 2) * 0.2 : 0.56 + n(i * 1.7, 3.5, 2) * 0.14;
    ring.push([Math.cos(a) * r, tip ? -0.1 - n(i * 0.9, 7, 1) * 0.08 : 0.07, Math.sin(a) * r]);
  }
  // 上の面: 頂点・ふち
  pos.push(0, 1, 0);
  col.push(0.96, 0.96, 0.96);
  uv.push(0.5, 1);
  for (let i = 0; i < N; i++) {
    const p = ring[i]!, lit = i % 2 === 0 ? 1.08 : 0.72;
    pos.push(p[0], p[1], p[2]);
    col.push(lit, lit, lit);
    uv.push((i / N) * 4, 0);
  }
  for (let i = 0; i < N; i++) index.push(0, 1 + ((i + 1) % N), 1 + i);
  // 下の面: 真ん中（幹の所）・ふち。暗い
  const base = pos.length / 3;
  pos.push(0, 0.2, 0);
  col.push(CROWN_UNDER * 0.8, CROWN_UNDER * 0.8, CROWN_UNDER * 0.8);
  uv.push(0.5, 0.5);
  for (let i = 0; i < N; i++) {
    const p = ring[i]!;
    pos.push(p[0], p[1], p[2]);
    col.push(CROWN_UNDER, CROWN_UNDER, CROWN_UNDER);
    uv.push((i / N) * 4, 0);
  }
  for (let i = 0; i < N; i++) index.push(base, base + 1 + i, base + 1 + ((i + 1) % N));
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** 葉の付いた小枝の板の高さ（幅 1 に対して。茂みの絵の縦横の比） */
const TUFT_CELL = ENV_SPRITES.props.cells.bush;
export const TUFT_H = (TUFT_CELL.rect[3] - TUFT_CELL.rect[1]) / (TUFT_CELL.rect[2] - TUFT_CELL.rect[0]);

/**
 * 葉の付いた小枝の板（1 枚。表と裏で 2 面 = 三角形 4 つ。幅 1、根元が原点、+Y へ伸びる）。絵は、小物の図集の茂み。
 * 法線はすべて +Y（= 置いた時の、葉のかたまりの外向き。板の向きによらず、かたまりの表面と同じ明るさになる）。
 * 1 枚ずつ向きを変えて、かたまりのまわりに数多く置く（十字に組むより、同じ三角形の数で、輪郭が細かく不ぞろいになる）。
 */
export function tuftGeometry(): BufferGeometry {
  const [x0, y0, x1, y1] = TUFT_CELL.rect;
  const w = x1 - x0, l = (x0 - TUFT_CELL.rootX) / w, r = (x1 - TUFT_CELL.rootX) / w, h = TUFT_H;
  const u0 = x0 / 1024, u1 = x1 / 1024, v0 = 1 - y1 / 1024, v1 = 1 - y0 / 1024;
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, ua: number, ub: number): void => {
    pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
    uv.push(ua, v0, ub, v0, ub, v1, ua, v0, ub, v1, ua, v1);
    for (let i = 0; i < 6; i++) nor.push(0, 1, 0);
  };
  quad(l, 0, r, 0, u0, u1);
  quad(r, 0, l, 0, u1, u0);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

// ---- 素材 ----

/** 茂みの絵の、見えている所の平均の色（線形の値。public/assets/textures/env/sprite_props_basin_v1.webp の茂みのマスで測った） */
export const TUFT_MEAN: readonly [number, number, number] = [0.148, 0.139, 0.09];
/** 葉の板の、根元（かたまりの中）の明るさと、先の明るさ */
const TUFT_ROOT = 0.55, TUFT_TIP = 1.1;
/** 絵の透明の境（草の 0.5 より低い: 遠くで絵が縮んでも、葉の群れが消えない） */
export const TUFT_ALPHA = 0.32;

/**
 * 葉の付いた小枝の板の素材。色は、板 1 枚ずつの色（instanceColor）で、木の葉の色に染める。
 * 根元（葉のかたまりの中）は暗く、先は明るい。風で、先が小さくそよぐ。絵が届くまでは見せない。
 */
export function tuftMaterial(): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ alphaTest: TUFT_ALPHA, side: FrontSide });
  mat.userData.uv = true;
  mat.userData.canopyTuft = true;
  mat.visible = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = 'uniform float uWind;\nvarying float vTuftH;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vTuftH = position.y / ${TUFT_H.toFixed(4)};
      {
        vec3 troot = vec3(0.0);
        #ifdef USE_INSTANCING
          troot = instanceMatrix[3].xyz;
        #endif
        float tph = dot(troot, vec3(0.37, 0.21, 0.29));
        float tgust = 0.5 + 0.5 * sin(uWind * 0.5 - troot.x * 0.07 - troot.z * 0.05);
        transformed.xz += vec2(sin(uWind * 1.7 + tph), cos(uWind * 1.3 + tph * 1.3)) * (0.012 + 0.03 * tgust) * vTuftH;
      }`,
    );
    sh.fragmentShader = 'varying float vTuftH;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb *= mix( ${TUFT_ROOT.toFixed(2)}, ${TUFT_TIP.toFixed(2)}, smoothstep( 0.0, 0.65, vTuftH ) );`,
    );
  };
  mat.customProgramCacheKey = () => 'canopy-tuft';
  loadEnvTexture(ENV_SPRITES.props.file, (t) => {
    t.anisotropy = 4;
  }, (t) => {
    mat.map = t;
    mat.visible = true;
    mat.needsUpdate = true;
  });
  return mat;
}

// ---- 木を組む ----

interface Item { m: Matrix4; r: number; g: number; b: number }

export interface TreeSpec {
  x: number;
  z: number;
  /** 幹の所の地面の高さ */
  ground: number;
  /** 根元のいちばん低い所（斜面の下の側。幹は、ここから立つ） */
  root: number;
  /** 木の高さ（m） */
  h: number;
  yaw: number;
  /** 1 本ごとの明るさ（0.78〜1.13） */
  shade: number;
}

/** 木 1 本の大きさ: 樹冠の半径・樹冠の真ん中の地面からの高さ・樹冠の厚みの半分・幹の根元の半径（m） */
export interface TreeExtent { crownR: number; crownUp: number; crownHalf: number; trunkR: number }

export interface FloraOptions {
  seed: number;
  tree: FloraTree;
  /** 葉の色 */
  foliage: number;
  /** 木の多い所（90 本より多い林）: 1 本の葉のかたまりを 1 つ減らす（4 つ。描く量を抑える） */
  dense?: boolean;
}

const UP = new Vector3(0, 1, 0);

/** 崖の向こうの木（エリア 1 つぶん）。tree() で 1 本ずつ足して、addTo() で、種類ごとに 1 回の描画にまとめる */
export class ExteriorFlora {
  private readonly trunks: Item[] = [];
  private readonly crowns: Item[] = [];
  private readonly tufts: Item[] = [];
  private readonly leaf: Color;
  private readonly tuft: Color;
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  trees = 0;

  constructor(private readonly o: FloraOptions) {
    this.leaf = new Color(o.foliage);
    // 板の絵（茂み）を、葉の色へ染める倍率: 葉のかたまりの上の面と同じくらいの色になる
    this.tuft = new Color(this.leaf.r / TUFT_MEAN[0], this.leaf.g / TUFT_MEAN[1], this.leaf.b / TUFT_MEAN[2]);
  }

  private put(list: Item[], x: number, y: number, z: number, q: Quaternion, sx: number, sy: number, sz: number, r: number, g: number, b: number): void {
    list.push({ m: new Matrix4().compose(this.v.set(x, y, z), q, this.s.set(sx, sy, sz)), r, g, b });
  }

  /** 1 本足す。返すのは、木の大きさ（影を落とす側 = src/render/exteriorShade.ts の treeShade が使う） */
  tree(rng: SeededRng, t: TreeSpec): TreeExtent {
    this.trees++;
    return this.o.tree === 'pine' ? this.pine(rng, t) : this.broadleaf(rng, t);
  }

  /** 茂みの数（shrub で足した数） */
  shrubs = 0;

  /**
   * 丘の低い茂み（v0.79.0）: 葉の板 3 枚を、根元を合わせて、少し外へ開いて立てる。木の葉の板と同じ描画に入る（描画は増えない）。
   * 広葉樹・湿地の木の狩場だけ（針葉樹の狩場には、葉の板の描画が無い）。w は幅（m。高さは、その半分ほど）、lit は明るさ（影の中は暗く）。
   */
  shrub(rng: SeededRng, x: number, y: number, z: number, w: number, lit: number): boolean {
    if (this.o.tree === 'pine') return false;
    this.shrubs++;
    const warm = (rng.next() - 0.5) * 0.2, base = rng.next() * Math.PI;
    for (let i = 0; i < 3; i++) {
      // 3 枚を 60° ずつ回し、それぞれ、板の面の向きへ少し倒す（上から見ても、薄い線に見えない）
      const yaw = base + (i * Math.PI) / 3 + (rng.next() - 0.5) * 0.4, lean = 0.18 + rng.next() * 0.22;
      this.q.setFromAxisAngle(UP, yaw).multiply(this.q2.setFromAxisAngle(this.v.set(1, 0, 0), (i % 2 ? -1 : 1) * lean));
      const k = lit * (0.8 + rng.next() * 0.2), s = w * (0.85 + rng.next() * 0.3);
      this.put(this.tufts, x, y - 0.06 * w, z, this.q, s, s * (1 + rng.next() * 0.25), s, k * (1 + warm) * this.tuft.r, k * this.tuft.g, k * (1 - warm * 1.3) * this.tuft.b);
    }
    return true;
  }

  /** 針葉樹: 幹と、傘を 5 段（上ほど小さい）。段ごとに、向きと大きさを少し変える */
  private pine(rng: SeededRng, t: TreeSpec): TreeExtent {
    const { x, z, h, shade } = t;
    const r = h * 0.04;
    const top = t.ground + h * 0.9;
    this.put(this.trunks, x, (t.root - 0.24 + top) / 2, z, this.q.setFromAxisAngle(UP, t.yaw), r, top - t.root + 0.24, r, shade, shade, shade);
    const cool = (rng.next() - 0.5) * 0.12;
    for (let j = 0; j < 5; j++) {
      const rad = h * (0.235 - j * 0.038) * (0.9 + rng.next() * 0.2), hh = h * (0.27 - j * 0.02);
      const k = shade * (0.9 + j * 0.035);
      this.put(this.crowns, x, t.ground + h * (0.2 + j * 0.15), z, this.q.setFromAxisAngle(UP, t.yaw + j * 0.9 + rng.next()), rad, hh, rad, k * (1 - cool), k, k * (1 + cool));
    }
    // 傘の重なり（下の段の半径は 高さ × 0.235。上ほど細い）: 影は、細長い
    return { crownR: h * 0.19, crownUp: h * 0.52, crownHalf: h * 0.36, trunkR: r };
  }

  /** 広葉樹（と、湿地の木: 低く広い）: 幹、枝 2 本、葉のかたまり（芯・頂・横に 2〜3 つ）、かたまりごとに葉の板 */
  private broadleaf(rng: SeededRng, t: TreeSpec): TreeExtent {
    const { x, z, h, shade } = t;
    const swamp = this.o.tree === 'swamp';
    // 樹冠の半径は、高さの 1/3 ほど（湿地の木は、低く広い）。幹が見えるのは、下の 1/3 ほど
    const R = h * (swamp ? 0.38 + rng.next() * 0.06 : 0.33 + rng.next() * 0.07);
    const flat = swamp ? 0.62 : 0.8;
    const r = h * 0.05 * (0.9 + rng.next() * 0.3);
    const top = t.ground + h * (swamp ? 0.62 : 0.72);
    this.put(this.trunks, x, (t.root - 0.24 + top) / 2, z, this.q.setFromAxisAngle(UP, t.yaw), r, top - t.root + 0.24, r, shade, shade, shade);
    // 1 本ごとの色み（黄み・青み）
    const warm = (rng.next() - 0.5) * 0.2;
    const tr = 1 + warm, tb = 1 - warm * 1.3;
    const sides = this.o.dense ? 2 : 3;
    const lumps: { x: number; y: number; z: number; rx: number; ry: number; rz: number; out: number; a: number; tufts: number }[] = [];
    lumps.push({ x, y: t.ground + h * (swamp ? 0.56 : 0.64), z, rx: R * 0.8, ry: R * 0.62 * (flat / 0.8), rz: R * 0.8, out: 0, a: 0, tufts: 9 });
    const tj = R * 0.2;
    lumps.push({ x: x + (rng.next() - 0.5) * tj, y: t.ground + h * (swamp ? 0.7 : 0.83) + rng.next() * h * 0.04, z: z + (rng.next() - 0.5) * tj, rx: R * (0.52 + rng.next() * 0.08), ry: R * 0.46 * (flat / 0.8), rz: R * (0.52 + rng.next() * 0.08), out: 0, a: 0, tufts: 6 });
    for (let j = 0; j < sides; j++) {
      const a = t.yaw + (j / sides) * Math.PI * 2 + (rng.next() - 0.5) * 0.8;
      const off = R * (0.5 + rng.next() * 0.2), rad = R * (0.46 + rng.next() * 0.16);
      const ly = t.ground + h * ((swamp ? 0.44 : 0.48) + rng.next() * 0.13);
      lumps.push({ x: x + Math.cos(a) * off, y: ly, z: z + Math.sin(a) * off, rx: rad, ry: rad * flat, rz: rad * (0.86 + rng.next() * 0.24), out: 0.5, a, tufts: 8 });
      // 低い 2 つのかたまりへ、枝を渡す（幹の途中から、かたまりの真ん中へ）
      if (j < 2) {
        const ay = t.ground + h * (0.3 + rng.next() * 0.08);
        const dx = Math.cos(a) * off, dy = ly - ay, dz = Math.sin(a) * off, len = Math.hypot(dx, dy, dz);
        this.q.setFromUnitVectors(UP, this.v.set(dx / len, dy / len, dz / len));
        this.put(this.trunks, x + dx / 2, ay + dy / 2, z + dz / 2, this.q, r * 0.36, len, r * 0.36, shade, shade, shade);
      }
    }
    for (const l of lumps) {
      const k = shade * (0.9 + rng.next() * 0.16);
      this.put(this.crowns, l.x, l.y, l.z, this.q.setFromAxisAngle(UP, rng.next() * 6.283), l.rx, l.ry, l.rz, k * tr, k, k * tb);
      for (let i = 0; i < l.tufts; i++) {
        // 板の向き: かたまりの外向き。上・横・下のどれにも付ける（5 枚に 2 枚は、下のふちから斜め下へ: 横から見上げた時の底を隠す）。横のかたまりは、幹から離れる向きへ寄せる
        const th = rng.next() * 6.283, dy0 = i % 5 >= 3 ? -0.75 + rng.next() * 0.6 : -0.15 + rng.next() * 1.15;
        const hr = Math.sqrt(Math.max(0.02, 1 - Math.min(1, Math.abs(dy0)) ** 2));
        let dx = Math.cos(th) * hr + Math.cos(l.a) * l.out, dy = Math.max(-1, Math.min(1, dy0)), dz = Math.sin(th) * hr + Math.sin(l.a) * l.out;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl;
        dy /= dl;
        dz /= dl;
        // 根元は、かたまりの表面の少し内側。幅は、かたまりの半径の 1.5〜2 倍（下の板は、少し小さい）
        const w = ((l.rx + l.rz) / 2) * (1.5 + rng.next() * 0.5) * (dy < -0.2 ? 0.8 : 1);
        this.q.setFromUnitVectors(UP, this.v.set(dx, dy, dz)).multiply(this.q2.setFromAxisAngle(UP, rng.next() * 6.283));
        // 上を向いた板は明るく、下を向いた板は暗い（葉のかたまりの頂点の色と同じ考え方）
        const lit = shade * (0.86 + rng.next() * 0.22) * (CROWN_UNDER + (1.04 - CROWN_UNDER) * smooth(-0.75, 0.7, dy));
        this.put(this.tufts, l.x + dx * l.rx * 0.66, l.y + dy * l.ry * (dy < 0 ? 0.42 : 0.66), l.z + dz * l.rz * 0.66, this.q, w, w, w, lit * tr * this.tuft.r, lit * this.tuft.g, lit * tb * this.tuft.b);
      }
    }
    // 樹冠ぜんぶ（横のかたまりと葉の板まで）の広がり
    return { crownR: R * 1.2, crownUp: h * (swamp ? 0.56 : 0.64), crownHalf: h * (swamp ? 0.14 : 0.2), trunkR: r };
  }

  /** 木を、幹・葉のかたまり・葉の板の 3 つ（針葉樹は 2 つ）の描画にまとめて、group へ足す */
  addTo(group: Group): void {
    const swamp = this.o.tree === 'swamp', pine = this.o.tree === 'pine';
    batch(group, trunkGeometry(), imageLambert('bark', { color: swamp ? 0x6c6149 : 0x6a6253 }, { gain: 1.15 }), this.trunks, 'field-exterior-trunks');
    // 葉のかたまりの絵は、まだらな明暗（苔の絵の明るさだけの版。葉の群れのむらに見える）。針葉樹の傘は、細かな筋（葉の絵）
    batch(group, pine ? pineTierGeometry(this.o.seed + 11) : crownGeometry(this.o.seed + 11), imageLambert(pine ? 'leaf' : 'moss', { color: this.o.foliage, vertexColors: true }, { gain: pine ? 1.3 : 1.25 }), this.crowns, 'field-exterior-canopy');
    batch(group, tuftGeometry(), tuftMaterial(), this.tufts, 'field-exterior-leaves');
  }
}

function batch(group: Group, geo: BufferGeometry, mat: MeshLambertMaterial, items: readonly Item[], name: string): void {
  if (!items.length) {
    geo.dispose();
    mat.dispose();
    return;
  }
  const mesh = new InstancedMesh(geo, mat, items.length), col = new Color();
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    mesh.setColorAt(i, col.setRGB(it.r, it.g, it.b));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = name;
  mesh.userData.noMerge = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

// ---- 岩 ----

/**
 * 岩を斜面へ傾ける割合（1 で、斜面にぴったり）と、傾きの上限（ラジアン）。立ち岩は、ほぼ立てたまま。
 * 半分だけ傾ける: ぴったり傾けると、岩の横の面（図では、ほぼ垂直）が斜面の下の側へせり出して、下から見上げた時に、岩の底が見えているように見える。
 * 傾けないと、斜面の下の側の横の面が高くなって、板が突き出して見える。
 */
export const ROCK_TILT = 0.5, ROCK_TILT_MAX = 0.4, TALL_TILT = 0.25, TALL_TILT_MAX = 0.2;
/** 立ち岩（背の高い岩）を立てるのは、これよりゆるい所だけ（傾き 0.4 = 22°） */
export const TALL_SLOPE_MAX = 0.4;
/** これより急な斜面（傾き = 高さ ÷ 水平の距離。0.7 = 35°）には、岩を置かない（置く側 = src/render/fieldLandscape.ts が見る） */
export const ROCK_SLOPE_MAX = 0.7;
/** 急な斜面（傾き 1 = 45°）の岩は、高さを、この割合まで低くする（斜面から大きく突き出さない） */
export const ROCK_STEEP_LOW = 0.62;
/**
 * 岩の根元を、地面のいちばん低い所より、さらに埋める深さ（m）: 0.1 + 半径 × (0.05 〜 0.27)。
 * 斜面が急なほど深く埋める（斜面に乗った丸い岩ではなく、斜面から顔を出した岩に見える）
 */
export const rockSink = (rad: number, slope = 0): number => 0.1 + rad * (0.05 + 0.22 * smooth(0.2, 0.7, slope));
/** 岩の根元の輪は、どこでも、少なくともこれだけ地面より下（m） */
export const ROCK_ROOT_MIN = 0.06;
/** この距離（m）より近く、この半径（m）より大きい岩は、細かい形。遠い岩・小さい岩は、粗い形（三角形 1080 → 168） */
export const ROCK_NEAR = 16, ROCK_NEAR_RAD = 2.6;

export interface ExteriorRockSpec {
  x: number;
  z: number;
  /** 根元のいちばん外までの半径（m） */
  rad: number;
  /** 高さ（m） */
  h: number;
  /** エリアの外周からの距離（m） */
  dist: number;
  /** 背の高い立ち岩にしたい（谷・洞・高山の景色。ゆるい所でだけ、立ち岩になる） */
  tall?: boolean;
  /** 色の倍率 */
  tint?: readonly [number, number, number];
}

/**
 * 崖の向こうの岩 1 つの置き方。地面の高さ（height）を、根元の輪（半径の 0.5 倍と 0.95 倍の 8 点ずつ）で読んで、
 *  1. 斜面の向きへ、ROCK_TILT の割合で傾ける（上限 ROCK_TILT_MAX。斜面に埋まった岩に見える）
 *  2. 傾けた底の面が、どの点でも地面より rockSink だけ下になる高さへ置く（斜面の下の側が浮かない。上の側は埋まる。急な斜面ほど深く）
 *  3. 岩の形の根元の輪を 1 点ずつ確かめて、地面より上に出る所があれば、その分だけ下げる（どこでも ROCK_ROOT_MIN は埋まる）
 * slope は、その場所の斜面の傾き（高さ ÷ 水平の距離）。
 */
export function placeExteriorRock(rng: SeededRng, height: (x: number, z: number) => number, o: ExteriorRockSpec): RockPlacement & { slope: number } {
  const pts: { dx: number; dz: number; y: number }[] = [{ dx: 0, dz: 0, y: height(o.x, o.z) }];
  let gx = 0, gz = 0;
  for (const k of [0.5, 0.95]) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + (k < 0.9 ? Math.PI / 8 : 0), dx = Math.cos(a) * o.rad * k, dz = Math.sin(a) * o.rad * k;
      const y = height(o.x + dx, o.z + dz);
      pts.push({ dx, dz, y });
      // 外の輪の 8 点から、斜面の傾き（最小二乗: Σcos² = 4）
      if (k > 0.9) {
        gx += (y * Math.cos(a)) / (4 * o.rad * k);
        gz += (y * Math.sin(a)) / (4 * o.rad * k);
      }
    }
  }
  const slope = Math.hypot(gx, gz);
  // 立ち岩は、ゆるい所（尾根の上・谷の底）だけ。斜面では、ふつうの岩（高さは、図の比まで）
  const tall = o.tall === true && slope < TALL_SLOPE_MAX;
  const p = placeBigRock(rng, { x: o.x, z: o.z, r: o.rad, h: o.h, art: tall ? 'R-16' : undefined }, 1);
  // 斜面の法線 (-gx, 1, -gz) へ傾ける
  const ang = tall ? Math.min(TALL_TILT_MAX, Math.atan(slope) * TALL_TILT) : Math.min(ROCK_TILT_MAX, Math.atan(slope) * ROCK_TILT);
  const tilt: [number, number, number] = slope > 1e-5 ? [(-gx / slope) * Math.sin(ang), Math.cos(ang), (-gz / slope) * Math.sin(ang)] : [0, 1, 0];
  // 傾けた底の面（根元の中心を通り、法線が tilt）の、各点での高さ = y0 - (tilt.x dx + tilt.z dz) / tilt.y
  let y0 = Infinity;
  for (const q of pts) y0 = Math.min(y0, q.y + (tilt[0] * q.dx + tilt[2] * q.dz) / tilt[1]);
  const near = o.dist < ROCK_NEAR && o.rad >= ROCK_NEAR_RAD;
  const low = tall ? 1 : 1 - (1 - ROCK_STEEP_LOW) * smooth(0.3, 1, slope);
  const rock: RockPlacement & { slope: number } = { ...p, sy: p.sy * low, y: y0 - rockSink(o.rad, slope), tilt, tint: o.tint, lod: near ? 1 : 0, slope };
  // 3. 確かめ: 岩の形の、根元の輪（図の形で、地面より下の頂点）を 1 つずつ見て、地面より上に出る所があれば、その分だけ下げる
  //    （輪の 16 点では、地面の折れ目・出口の道のくぼみ・水際を読み切れない所がある）
  const local = rockArtGeometry(rockArt(rock.id), rock.lod ?? 1).getAttribute('position'), q = rockTilt(rock, new Quaternion()), v = new Vector3();
  let out = -Infinity;
  for (let i = 0; i < local.count; i++) {
    if (local.getY(i) >= 0) continue;
    rockOffset(rock, q, local.getX(i), local.getY(i), local.getZ(i), v);
    out = Math.max(out, rock.y! + v.y - height(rock.x + v.x, rock.z + v.z));
  }
  if (out > -ROCK_ROOT_MIN) rock.y! -= out + ROCK_ROOT_MIN;
  return rock;
}
