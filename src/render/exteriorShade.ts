// 崖の向こうの影と、丘の草（v0.79.0。docs/spec.md の 21.8、D-179）。描画だけ（当たり・戦闘・地図は読まない）。
// 影: エリアの外の木と岩の影を、エリアごとの小さな絵（1 色。上から見た外側の地面の、暗くする量）に描いて、外側の地面の素材が読む。
//     影を落とす描画（光の側からの描画）はしないので、描画の回数も三角形も増えない。木の影は、太陽（src/render/sky.ts の SUN_DIR）の反対へ伸ばす。
// 草: 崖のすぐ向こうの丘に、背の高い草の板を立てる（エリアの中の草と同じ絵と素材。数は、外周の長さと、その狩場の草の量から）。
// 置く場所（木・岩）と外側の起伏は、これまでどおり src/render/fieldLandscape.ts（ChatGPT の #43）が決める。
import { type BufferGeometry, ClampToEdgeWrapping, DataTexture, Float32BufferAttribute, type Group, type InstancedMesh, LinearFilter, RedFormat, UnsignedByteType } from 'three';
import type { SeededRng } from '../core/seededRng';
import { ENV_SPRITES, SpriteField } from './envArt';
import { SUN_DIR } from './sky';

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---- 影の絵 ----

/** 影の絵が覆う広さ: エリアを囲む四角の外へ、この距離（m）まで（木は 78m 先まで立ち、樹冠と影が、その外へ出る） */
export const SHADE_REACH = 96;
/** 影の絵の細かさ（1m あたりの画素）と、1 辺の画素の上限 */
export const SHADE_PX_PER_M = 2, SHADE_MAX_PX = 512;
/** 影が重なった所の、暗くする量の上限（0〜1。地面の色に 1 - 量 を掛ける） */
export const SHADE_CAP = 0.76;
/** 木の影（樹冠の影のいちばん濃い所）・木の真下の陰（日の向きによらない、樹冠の下の暗さ）・幹の影・岩の際の陰の濃さ */
export const TREE_SHADE = 0.62, UNDER_SHADE = 0.46, TRUNK_SHADE = 0.38, ROCK_SHADE = 0.44;

/** 太陽の反対の向き（地面の上。影の伸びる向き。長さ 1）と、高さ 1m の物の影の長さ（m。平らな地面で） */
const sunFlat = Math.hypot(SUN_DIR.x, SUN_DIR.z);
export const SHADOW_DIR: readonly [number, number] = [-SUN_DIR.x / sunFlat, -SUN_DIR.z / sunFlat];
export const SHADOW_PER_M = sunFlat / SUN_DIR.y;

/** 影 1 つ（上から見た、ぼけた楕円）。(x, z) が中心、ra が向き dir の半径、rb がその横の半径、k が中心の濃さ。soft は、濃さが落ち始める所（0〜1。半径に対して） */
export interface ShadeBlob {
  x: number;
  z: number;
  ra: number;
  rb: number;
  /** 長い方の向き（長さ 1 の (x, z)。無ければ影の伸びる向き） */
  dir?: readonly [number, number];
  k: number;
  soft?: number;
}

export interface OuterShade {
  /** 1 画素 1 バイト（0 = 影なし … 255 = 量 1）。行は z の小さい方から */
  data: Uint8Array;
  width: number;
  height: number;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
  /** 場所 (x, z) の、暗くする量（0〜1。絵を、素材と同じに、まわりの 4 画素から読む） */
  at(x: number, z: number): number;
}

/** 影の楕円を集めて、エリア 1 つぶんの絵にする。重なりは、1 - (1 - a)(1 - b)（上限 SHADE_CAP） */
export function buildOuterShade(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, blobs: readonly ShadeBlob[]): OuterShade {
  const minX = bounds.minX - SHADE_REACH, minZ = bounds.minZ - SHADE_REACH;
  const sizeX = bounds.maxX - bounds.minX + SHADE_REACH * 2, sizeZ = bounds.maxZ - bounds.minZ + SHADE_REACH * 2;
  const ppm = Math.min(SHADE_PX_PER_M, SHADE_MAX_PX / Math.max(sizeX, sizeZ));
  const width = Math.max(4, Math.round(sizeX * ppm)), height = Math.max(4, Math.round(sizeZ * ppm));
  const v = new Float32Array(width * height);
  for (const b of blobs) {
    const [dx, dz] = b.dir ?? SHADOW_DIR, soft = b.soft ?? 0.5;
    const R = Math.max(b.ra, b.rb);
    // 画素の真ん中が場所。楕円を囲む四角の画素だけ見る
    const i0 = Math.max(0, Math.floor(((b.x - R - minX) / sizeX) * width)), i1 = Math.min(width - 1, Math.ceil(((b.x + R - minX) / sizeX) * width));
    const j0 = Math.max(0, Math.floor(((b.z - R - minZ) / sizeZ) * height)), j1 = Math.min(height - 1, Math.ceil(((b.z + R - minZ) / sizeZ) * height));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + ((j + 0.5) / height) * sizeZ - b.z;
      for (let i = i0; i <= i1; i++) {
        const x = minX + ((i + 0.5) / width) * sizeX - b.x;
        const a = (x * dx + z * dz) / b.ra, c = (-x * dz + z * dx) / b.rb;
        const d = Math.sqrt(a * a + c * c);
        if (d >= 1) continue;
        const add = b.k * (1 - smooth(soft, 1, d));
        const o = j * width + i;
        v[o] = 1 - (1 - v[o]!) * (1 - add);
      }
    }
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < v.length; i++) data[i] = Math.round(Math.min(SHADE_CAP, v[i]!) * 255);
  const px = (i: number, j: number): number => data[Math.max(0, Math.min(height - 1, j)) * width + Math.max(0, Math.min(width - 1, i))]! / 255;
  const at = (x: number, z: number): number => {
    const fx = ((x - minX) / sizeX) * width - 0.5, fz = ((z - minZ) / sizeZ) * height - 0.5;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (px(i, j) * (1 - tx) + px(i + 1, j) * tx) * (1 - tz) + (px(i, j + 1) * (1 - tx) + px(i + 1, j + 1) * tx) * tz;
  };
  return { data, width, height, minX, minZ, sizeX, sizeZ, at };
}

/** 影の絵を、素材が読む形にする（エリアを捨てる時に dispose する） */
export function shadeTexture(shade: OuterShade): DataTexture {
  const t = new DataTexture(shade.data, shade.width, shade.height, RedFormat, UnsignedByteType);
  t.unpackAlignment = 1;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** 外側の地面の板の頂点へ、影の絵の座標（aShade）を付ける */
export function setShadeUv(geo: BufferGeometry, shade: OuterShade): void {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - shade.minX) / shade.sizeX;
    uv[i * 2 + 1] = (pos.getZ(i) - shade.minZ) / shade.sizeZ;
  }
  geo.setAttribute('aShade', new Float32BufferAttribute(uv, 2));
}

/**
 * 木 1 本の影: 樹冠の影（樹冠の真ん中の高さ × SHADOW_PER_M だけ、太陽の反対へずれた楕円）、木の真下の陰（樹冠の下の丸い暗さ）、根元から樹冠の影へ続く、幹の細い影。
 * crownR は樹冠の半径、crownUp は樹冠の真ん中の、地面からの高さ、crownHalf は樹冠の厚みの半分、trunkR は幹の根元の半径。地面は平らとして置く。
 */
export function treeShade(x: number, z: number, crownR: number, crownUp: number, crownHalf: number, trunkR: number): ShadeBlob[] {
  const off = crownUp * SHADOW_PER_M;
  const cx = x + SHADOW_DIR[0] * off, cz = z + SHADOW_DIR[1] * off;
  // 樹冠（平たい球）の影は、太陽の反対へ少し長い
  const along = Math.hypot(crownR, crownHalf * SHADOW_PER_M);
  return [
    { x: cx, z: cz, ra: along * 1.04, rb: crownR * 1.04, k: TREE_SHADE, soft: 0.45 },
    { x, z, ra: crownR, rb: crownR, k: UNDER_SHADE, soft: 0.2 },
    { x: (x + cx) / 2, z: (z + cz) / 2, ra: off / 2 + trunkR * 2, rb: Math.max(0.9, trunkR * 2.2), k: TRUNK_SHADE, soft: 0.3 },
  ];
}

/** 岩 1 つの際の陰と影: 根元のまわりを暗くし、太陽の反対へ少しずらす（rad は根元の半径、h は高さ） */
export function rockShade(x: number, z: number, rad: number, h: number): ShadeBlob {
  const off = Math.min(rad * 0.5, h * 0.5 * SHADOW_PER_M);
  return { x: x + SHADOW_DIR[0] * off, z: z + SHADOW_DIR[1] * off, ra: rad * 1.5, rb: rad * 1.35, k: ROCK_SHADE, soft: 0.55 };
}

// ---- 丘の草と茂み ----

/** 丘の草を生やす幅: 外周から near〜far（m）。far に近いほど、まばら */
export const HILL_GRASS_NEAR = 2.2, HILL_GRASS_FAR = 58;
/** 外周 1m あたりの本数（草の量 1 の狩場で）と、本数の上限。これより少ない狩場（20 本より少ない）には生やさない */
export const HILL_GRASS_PER_M = 3.2, HILL_GRASS_MAX = 900, HILL_GRASS_MIN = 20;
/** 草の量（景観の定義の cover）が、これより少ない狩場（雪・氷・洞）には、草も茂みも生やさない */
export const HILL_COVER_MIN = 0.05;
/** これより急な斜面（傾き = 高さ ÷ 水平の距離）には生やさない */
export const HILL_GRASS_STEEP = 0.85;
/**
 * 草の大きさの幅（エリアの中の背の高い草は 0.8〜1.3 = 高さ 0.5〜0.8m）。丘の草は、30〜60m 先から見るので、大きな株（高さ 1〜2m）。
 * エリアの中と同じ大きさでは、点にしか見えなかった
 */
export const HILL_GRASS_SCALE: readonly [number, number] = [1.6, 3.4];
/**
 * 丘の草の色の倍率（絵の色は、明るい黄緑。エリアの中では葉の 1 枚ずつが見えるが、遠くでは、丘より明るい点に見えた）。
 * 少し暗く、緑へ寄せて、丘に生えた株に見せる
 */
export const HILL_GRASS_TINT: readonly [number, number, number] = [0.8, 0.92, 0.68];
/** 影の中の草と茂みは、この割合だけ、影の量に合わせて暗くする（地面と同じ 1 にすると、板は暗く沈みすぎる） */
export const HILL_GRASS_SHADE = 0.85;
/** 丘の茂み（葉の板を 3 枚組んだ低い木。src/render/exteriorFlora.ts の shrub）: 外周 1m あたりの数・上限・幅（m） */
export const HILL_SHRUB_PER_M = 0.36, HILL_SHRUB_MAX = 110;
export const HILL_SHRUB_W: readonly [number, number] = [2.2, 4.2];

export interface HillInput {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 外周の長さ（m） */
  perimeter: number;
  /** その狩場の草の量（景観の定義の cover。0〜1） */
  cover: number;
  /** 外周からの距離（外が正）・外側の地面の高さ */
  distance: (x: number, z: number) => number;
  height: (x: number, z: number) => number;
  /** 出口の先の道などを避ける（置いてよい所で true） */
  clear: (x: number, z: number) => boolean;
  /** 岩（根元の円）。中には生やさない */
  rocks: readonly { x: number; z: number; r: number }[];
  /** 濃淡（0〜1。大きい所 = 草がかたまる所。外側の地面の色むらと同じ雑音） */
  noise: (x: number, z: number) => number;
  /** その場所の、草の色の倍率（外側の地面の色むら） */
  tint: (x: number, z: number, n: number) => readonly [number, number, number];
  /** 影の量（0〜1） */
  shade: (x: number, z: number) => number;
  /** これより低い所（水際）には生やさない（無ければ、どこでも） */
  minY?: number;
}

export interface HillSpot { x: number; z: number; y: number; tint: readonly [number, number, number]; slope: number; shade: number }

/** 丘の草の本数（外周の長さ × 草の量。上限あり。少なすぎる狩場は 0） */
export function hillGrassCount(perimeter: number, cover: number): number {
  if (cover < HILL_COVER_MIN) return 0;
  const n = Math.min(HILL_GRASS_MAX, Math.round(perimeter * HILL_GRASS_PER_M * clamp01(cover)));
  return n < HILL_GRASS_MIN ? 0 : n;
}

/** 丘の茂みの数（外周の長さ × 草の量。上限あり） */
export function hillShrubCount(perimeter: number, cover: number): number {
  if (cover < HILL_COVER_MIN) return 0;
  return Math.min(HILL_SHRUB_MAX, Math.round(perimeter * HILL_SHRUB_PER_M * clamp01(cover)));
}

/**
 * 丘の草・茂みを置く場所を 1 つ選ぶ関数を返す（選べなければ null）。
 * 外周から HILL_GRASS_NEAR〜FAR。外周に近いほど多く、濃淡の濃い所（湿った所）へ寄せる。急な斜面・出口の先の道・岩の中・水際は避ける。
 * 色は、外側の地面の色むらと、木と岩の影（影の中は暗い）。
 */
export function hillPicker(rng: SeededRng, o: HillInput): () => HillSpot | null {
  const b = o.bounds, w = b.maxX - b.minX + HILL_GRASS_FAR * 2, d = b.maxZ - b.minZ + HILL_GRASS_FAR * 2;
  return () => {
    for (let tries = 0; tries < 14; tries++) {
      const x = b.minX - HILL_GRASS_FAR + rng.next() * w, z = b.minZ - HILL_GRASS_FAR + rng.next() * d;
      const dist = o.distance(x, z);
      if (dist < HILL_GRASS_NEAR || dist > HILL_GRASS_FAR) continue;
      // 外周に近いほど多い（遠くは、霧の中で板が見えない）
      const fade = 1 - (dist - HILL_GRASS_NEAR) / (HILL_GRASS_FAR - HILL_GRASS_NEAR);
      const n = o.noise(x, z);
      if (rng.next() > Math.pow(fade, 1.3) * (0.25 + 0.75 * smooth(0.3, 0.75, n))) continue;
      if (!o.clear(x, z) || o.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r * 1.05)) continue;
      const y = o.height(x, z);
      if (o.minY !== undefined && y < o.minY) continue;
      const slope = Math.hypot(o.height(x + 0.6, z) - o.height(x - 0.6, z), o.height(x, z + 0.6) - o.height(x, z - 0.6)) / 1.2;
      if (slope > HILL_GRASS_STEEP) continue;
      const shade = o.shade(x, z), t = o.tint(x, z, n), k = 1 - HILL_GRASS_SHADE * shade;
      return { x, z, y, tint: [t[0] * k, t[1] * k, t[2] * k], slope, shade };
    }
    return null;
  };
}

/** 丘に草の板を立てる（1 回の描画。エリアの中の背の高い草と同じ絵と素材）。返すのは、立てた板（無ければ null） */
export function addHillGrass(group: Group, rng: SeededRng, o: HillInput): InstancedMesh | null {
  const count = hillGrassCount(o.perimeter, o.cover);
  if (count <= 0) return null;
  const pick = hillPicker(rng, o);
  const before = group.children.length;
  // 斜面では、板の下の側の角が浮かないように、少し埋める（株が大きいので、傾きの 0.5 倍 m）
  new SpriteField(group, rng).scatter(ENV_SPRITES.grass, ENV_SPRITES.grass.cells.tall, count, () => {
    const p = pick();
    return p && { x: p.x, z: p.z, y: p.y - 0.5 * p.slope, tint: [p.tint[0] * HILL_GRASS_TINT[0], p.tint[1] * HILL_GRASS_TINT[1], p.tint[2] * HILL_GRASS_TINT[2]] as const };
  }, [HILL_GRASS_SCALE[0], HILL_GRASS_SCALE[1]], 0.12);
  const mesh = group.children[before] as InstancedMesh | undefined;
  if (!mesh) return null;
  if (mesh.count === 0) {
    group.remove(mesh);
    (mesh.material as { dispose(): void }).dispose();
    return null;
  }
  mesh.name = 'field-exterior-grass';
  mesh.userData.noMerge = true;
  // 崖の向こうの物は、影の描画を受けない（影の範囲の外。影は、影の絵から色に掛けてある）
  mesh.receiveShadow = false;
  return mesh;
}
