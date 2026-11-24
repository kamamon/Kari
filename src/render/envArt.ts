// 景色に貼る絵（依頼 8、v0.13.0）。絵は tools/env-art.py が public/assets/textures/env/ へ出したもの。
// ここは「読む・貼る」だけで、形や当たりは決めない（正本はマップデータ）。
// 絵が届くまでは、その絵の平均の色で塗る（読めなくても、画面が黒くならない）。
import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MirroredRepeatWrapping, Quaternion, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Texture,
} from 'three';
import { assetUrl } from '../core/assets';
import type { SeededRng } from '../core/seededRng';

const DIR = 'assets/textures/env/';

/** 繰り返して敷く絵。tile は 1 枚ぶんの大きさ（m）、mean は平均の色、mirror は鏡写しに繰り返すもの。 */
export const ENV_TILES = {
  grass: { file: 'tex_ground_basin_grass_v1', tile: 6, mean: 0x6d764f, mirror: false },
  gravel: { file: 'tex_ground_basin_gravel_v1', tile: 6, mean: 0x9f8e6f, mirror: false },
  nest: { file: 'tex_ground_nest_v1', tile: 6, mean: 0x6d6b5e, mirror: false },
  earth: { file: 'tex_ground_village_earth_v1', tile: 6, mean: 0xa8977d, mirror: false },
  paving: { file: 'tex_ground_village_paving_v1', tile: 4, mean: 0x867e6e, mirror: true },
  rock: { file: 'tex_rock_basin_v1', tile: 3, mean: 0x837c6f, mirror: false },
  vein: { file: 'tex_rock_vein_v1', tile: 3, mean: 0x867d71, mirror: true },
} as const;
export type EnvTile = keyof typeof ENV_TILES;

/** 空と遠景（1 枚で 90 度ぶん。a・b を、裏返しながら 4 枚つないで 1 周）。 */
export const ENV_FAR = {
  basin: ['env_basin_far_a_v1', 'env_basin_far_b_v1'],
  village: ['env_village_far_a_v1', 'env_village_far_b_v1'],
} as const;
export type EnvPlace = keyof typeof ENV_FAR;

/** 遠景の絵の、上の帯の色（tools/env-art.py が合わせる色。v0.19.0 からは、この部分は透明で、空は src/render/sky.ts が描く） */
export const SKY_COLOR = 0xc5d2cb;

/**
 * 切り抜きの絵（2 × 2 のマス）。rect は絵のある範囲 [x0, y0, x1, y1]（px、1024 四方の中）、rootX は根元の横位置、
 * h は見えている部分の高さ（m）。範囲は tools/env-art.py が測ったもの（art-source/env/request8_v1.measure.json）。
 * 小物の rootX は、範囲の中央（根元が 1 点に決まらないため）。
 */
export interface SpriteCell { readonly rect: readonly [number, number, number, number]; readonly rootX: number; readonly h: number }
export const ENV_SPRITES = {
  grass: {
    file: 'sprite_grass_basin_v1',
    cells: {
      short: { rect: [88, 302, 444, 508], rootX: 260, h: 0.32 },
      tall: { rect: [546, 70, 976, 508], rootX: 763, h: 0.6 },
      dry: { rect: [64, 732, 451, 1009], rootX: 246, h: 0.42 },
      flower: { rect: [553, 887, 958, 1009], rootX: 775, h: 0.15 },
    },
  },
  props: {
    file: 'sprite_props_basin_v1',
    cells: {
      stones: { rect: [95, 367, 413, 512], rootX: 254, h: 0.24 },
      bush: { rect: [533, 277, 996, 510], rootX: 765, h: 0.52 },
      crystal: { rect: [86, 802, 429, 987], rootX: 258, h: 0.3 },
      branch: { rect: [532, 822, 981, 986], rootX: 756, h: 0.22 },
    },
  },
} as const;

const loader = new TextureLoader();
const cache = new Map<string, { tex: Texture | null; waiting: ((t: Texture) => void)[]; failed: boolean }>();

/** 絵を読む（同じ絵は 1 回だけ）。読めたら done を呼ぶ。読めなければ呼ばない（平均の色のまま）。 */
function loadEnv(file: string, setup: (t: Texture) => void, done: (t: Texture) => void): void {
  let e = cache.get(file);
  if (e?.tex) {
    done(e.tex);
    return;
  }
  if (e) {
    if (!e.failed) e.waiting.push(done);
    return;
  }
  e = { tex: null, waiting: [done], failed: false };
  cache.set(file, e);
  const entry = e;
  loader.load(
    assetUrl(`${DIR}${file}.webp`),
    (t) => {
      t.colorSpace = SRGBColorSpace;
      setup(t);
      entry.tex = t;
      for (const w of entry.waiting) w(t);
      entry.waiting = [];
    },
    undefined,
    () => {
      entry.failed = true;
      entry.waiting = [];
      console.warn(`景色の絵を読めません: ${file}`);
    },
  );
}

/** 読み終わった絵の数と、頼んだ絵の数（検査用）。 */
export function envArtStatus(): { loaded: number; asked: number; failed: number } {
  let loaded = 0, failed = 0;
  for (const e of cache.values()) {
    if (e.tex) loaded++;
    if (e.failed) failed++;
  }
  return { loaded, asked: cache.size, failed };
}

const tmpColor = new Color();

/**
 * 繰り返す絵を貼った素材。uv は「m ÷ tile」で作っておくこと（絵の側では繰り返しの数を持たない。同じ絵を、広さの違う面で共有するため）。
 * tint は絵に掛ける色（白でそのまま）、gain は明るさの倍率。
 * 光の当たり方の式では、上を向いた面で絵の 0.8 倍、横を向いた面で 0.5 倍ほどの明るさになるので、絵の色に近づけたい面は gain で持ち上げる。
 * bump を渡すと、同じ絵の明るさを凹凸として使う（割れ目に陰が付く。v0.19.0。岩だけ）。
 */
export function tileMaterial(key: EnvTile, tint = 0xffffff, opts: { flat?: boolean; vertexColors?: boolean; gain?: number; bump?: number } = {}): MeshLambertMaterial {
  const def = ENV_TILES[key];
  const gain = opts.gain ?? 1;
  const mat = new MeshLambertMaterial({ flatShading: opts.flat ?? false, vertexColors: opts.vertexColors ?? false });
  mat.color.set(def.mean).multiply(tmpColor.set(tint)).multiplyScalar(gain);
  // 絵は後から付くので、まとめる時（mergeStatic）に uv を残す目印を付ける
  mat.userData.uv = true;
  loadEnv(
    def.file,
    (t) => {
      t.wrapS = t.wrapT = def.mirror ? MirroredRepeatWrapping : RepeatWrapping;
      t.anisotropy = 4;
    },
    (t) => {
      mat.map = t;
      if (opts.bump) {
        mat.bumpMap = t;
        mat.bumpScale = opts.bump;
      }
      mat.color.set(tint).multiplyScalar(gain);
      mat.needsUpdate = true;
    },
  );
  return mat;
}

/** 切り抜きの絵（草・小物・建物）を貼った素材。絵が届くまでは見せない。 */
export function cutoutMaterial(file: string, gain = 1, oneSided = false, sway = false): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ alphaTest: 0.5, side: oneSided ? FrontSide : DoubleSide });
  mat.color.setScalar(gain);
  mat.userData.uv = true;
  if (sway) swayInWind(mat);
  mat.visible = false;
  loadEnv(
    file,
    (t) => {
      t.anisotropy = 4;
    },
    (t) => {
      mat.map = t;
      mat.visible = true;
      mat.needsUpdate = true;
    },
  );
  return mat;
}

/**
 * 面の向きごとに、置いた場所の座標から uv を作る（上向きの面は x・z、横向きの面は 水平・高さ）。1 = tile m。
 * 置いた後（position / rotation / scale を決めた後）のメッシュに使う。親の Group は動かしていないこと。
 * tileTop は、上向きの面だけ別の大きさで貼る時に渡す（段差の上の地面など）。
 */
export function boxUv(mesh: Mesh, tile: number, tileTop = tile): void {
  mesh.updateMatrix();
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const p = [new Vector3(), new Vector3(), new Vector3()];
  const n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    for (let k = 0; k < 3; k++) p[k]!.fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrix);
    n.crossVectors(e1.subVectors(p[1]!, p[0]!), e2.subVectors(p[2]!, p[0]!));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = p[k]!;
      const top = ay >= ax && ay >= az;
      const [a, b] = top ? [v.x, -v.z] : ax >= az ? [v.z, v.y] : [v.x, v.y];
      const t = top ? tileTop : tile;
      uv[(i + k) * 2] = a / t;
      uv[(i + k) * 2 + 1] = b / t;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  mesh.geometry = g;
}

/**
 * 遠景: 大きな筒の内側に、遠景の絵を 4 枚（a・b・a の裏返し・b の裏返し）つないで貼る。
 * 絵は空の部分が透明（v0.19.0。tools/env-art.py）で、その外側の空（src/render/sky.ts）の前に、山だけが立つ。
 * 霧は掛けない（絵の下の帯が、霧の色そのもの）。カメラと一緒に動かして、近づけないようにする（view が毎フレーム置く）。
 */
export function buildBackdrop(place: EnvPlace): Group {
  const group = new Group();
  const R = 300;
  // 1 枚（1536 × 1024）が 90 度ぶん。縦横の比を保つ高さ
  const H = (R * Math.PI) / 2 / 1.5;
  // 絵の下から 33% の所（山すそが霧に溶ける高さ）を、地面の高さに合わせる
  const y0 = -H * 0.33;
  const SEG = 10;
  ENV_FAR[place].forEach((file, which) => {
    const pos: number[] = [], uv: number[] = [];
    for (const quarter of [which, which + 2]) {
      const mirrored = quarter >= 2;
      for (let s = 0; s < SEG; s++) {
        const t0 = s / SEG, t1 = (s + 1) / SEG;
        const a0 = (quarter + t0) * (Math.PI / 2), a1 = (quarter + t1) * (Math.PI / 2);
        // 中から見て、角度が増える向きは左。絵の左右をそのまま見せるには、u を逆に進める
        const u0 = mirrored ? t0 : 1 - t0, u1 = mirrored ? t1 : 1 - t1;
        const x0 = Math.sin(a0) * R, z0 = Math.cos(a0) * R, x1 = Math.sin(a1) * R, z1 = Math.cos(a1) * R;
        pos.push(x0, y0, z0, x1, y0, z1, x1, y0 + H, z1, x0, y0, z0, x1, y0 + H, z1, x0, y0 + H, z0);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    const mat = new MeshBasicMaterial({ fog: false, side: DoubleSide, depthWrite: false, transparent: true });
    mat.visible = false;
    loadEnv(file, () => undefined, (t) => {
      mat.map = t;
      mat.visible = true;
      mat.needsUpdate = true;
    });
    const mesh = new Mesh(geo, mat);
    mesh.renderOrder = -10;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  group.name = 'backdrop';
  return group;
}

/** 草や小物を、切り抜きの板（十字に組んだ 2 枚）としてたくさん立てる。1 種類につき、描画は 1 回。 */
export class SpriteField {
  private mats = new Map<string, MeshLambertMaterial>();

  constructor(private group: Group, private rng: SeededRng) {}

  /**
   * 1 種類を count 個、pick が返す場所へ置く（pick が null を返したら、その 1 個は置かない）。
   * scale は大きさの幅 [最小, 最大]。
   */
  scatter(sheet: { file: string }, cell: SpriteCell, count: number, pick: () => { x: number; z: number } | null, scale: [number, number] = [0.8, 1.25], vary = 0): void {
    if (count <= 0) return;
    let mat = this.mats.get(sheet.file);
    if (!mat) {
      // 板は表だけを描き、裏向きの面を別に持つ（法線を上向きにそろえて、地面と同じ明るさにするため）。草の絵だけ、風で揺らす
      mat = cutoutMaterial(sheet.file, SPRITE_GAIN, true, sheet.file === ENV_SPRITES.grass.file);
      this.mats.set(sheet.file, mat);
    }
    const mesh = new InstancedMesh(crossGeometry(cell), mat, count);
    const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), at = new Vector3(), sc = new Vector3();
    const tint = new Color();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const p = pick();
      if (!p) continue;
      const s = scale[0] + this.rng.next() * (scale[1] - scale[0]);
      q.setFromAxisAngle(up, this.rng.next() * 6.283);
      m4.compose(at.set(p.x, 0, p.z), q, sc.set(s, s * (0.85 + this.rng.next() * 0.3), s));
      mesh.setMatrixAt(n, m4);
      // 1 本ずつ、明るさと色み（黄み・青み）を少し変える（同じ絵が並んで見えないように）
      if (vary > 0) {
        const lum = 1 + (this.rng.next() - 0.5) * 2 * vary;
        const warm = (this.rng.next() - 0.5) * 2 * vary * 0.7;
        mesh.setColorAt(n, tint.setRGB(lum * (1 + warm * 0.6), lum * (1 + warm * 0.15), lum * (1 - warm)));
      }
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}

/** 草と小物の明るさ（地面と同じくらいに見えるように） */
const SPRITE_GAIN = 1.2;

/** 草を揺らす風の時刻（秒）。描画の側（view）が毎フレーム進める。草の素材すべてで、同じものを使う（v0.19.0） */
export const WIND = { value: 0 };
/** この高さ（m）の草の先が、いちばん大きく揺れる。低い草ほど、少しだけ揺れる */
const SWAY_H = 0.6;

/**
 * 草の板を風で揺らす（頂点の位置を、高さの 2 乗に比例して横へずらす。根元は動かない）。
 * 風は場所によらず同じ向き（北東へ）に吹き、強さは、ゆっくり進む突風の波で変わる。草ごとの小さな揺れを足す。
 * 板は 1 本ずつ向きを変えて置いてあるので、世界の向きの風を、板の向きへ直してからずらす。
 */
export function swayInWind(mat: MeshLambertMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float hgt = clamp(position.y / ${SWAY_H.toFixed(2)}, 0.0, 1.0);
        hgt *= hgt;
        vec3 root = vec3(0.0);
        mat3 im = mat3(1.0);
        #ifdef USE_INSTANCING
          root = instanceMatrix[3].xyz;
          im = mat3(instanceMatrix);
        #endif
        float ph = dot(root.xz, vec2(0.21, 0.17));
        float gust = 0.5 + 0.5 * sin(uWind * 0.5 - root.x * 0.07 - root.z * 0.05);
        vec2 w = vec2(0.8, 0.6) * (0.03 + 0.09 * gust * gust) + vec2(sin(uWind * 2.3 + ph), cos(uWind * 1.9 + ph * 1.3)) * 0.022;
        vec3 lw = transpose(im) * vec3(w.x, 0.0, w.y) / max(dot(im[0], im[0]), 1e-4);
        transformed.xz += lw.xz * hgt;
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'sway-in-wind';
}

const crossCache = new Map<SpriteCell, BufferGeometry>();

/** 十字に組んだ 2 枚の板（表と裏で 4 面）。根元が原点、高さ cell.h。法線はすべて上向き。 */
function crossGeometry(cell: SpriteCell): BufferGeometry {
  const hit = crossCache.get(cell);
  if (hit) return hit;
  const [x0, y0, x1, y1] = cell.rect;
  const m = cell.h / (y1 - y0);
  const l = (x0 - cell.rootX) * m, r = (x1 - cell.rootX) * m, h = cell.h;
  const u0 = x0 / 1024, u1 = x1 / 1024, v0 = 1 - y1 / 1024, v1 = 1 - y0 / 1024;
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, ua: number, ub: number): void => {
    pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
    uv.push(ua, v0, ub, v0, ub, v1, ua, v0, ub, v1, ua, v1);
    for (let i = 0; i < 6; i++) nor.push(0, 1, 0);
  };
  quad(l, 0, r, 0, u0, u1);
  quad(r, 0, l, 0, u1, u0);
  quad(0, l, 0, r, u0, u1);
  quad(0, r, 0, l, u1, u0);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  crossCache.set(cell, geo);
  return geo;
}
