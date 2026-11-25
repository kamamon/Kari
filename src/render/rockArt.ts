// 依頼 10（ChatGPT）の設定図から作る、岩と外周の崖（v0.22.0。docs/spec.md の 21.3）。
// 形の値（大きさ・上の線・平面の輪郭・図の範囲）は src/render/rockArtData.ts（npm run rocks:art = tools/rock-art.py の出力）。
// 岩: 平面図の輪郭の中を、輪郭から中心へ向かう輪で埋め、各点の高さ = 高さ × 正面の上の線(x) × 右側面の上の線(z)。
//     輪郭の所は、地面の下から立ち上がる壁（地面に埋まった岩）。色は 3 つの図を、面の向きで混ぜて貼る（前後 = 正面図、左右 = 右側面図、上 = 平面図）。
// 崖: 外周に沿って、横 24m の図を並べる（出口のわきには C-19・C-20）。上の線が崖の高さ、明るさから作った凹凸で面を出し入れする。
// どれも見た目だけ。当たりは、これまでどおりマップデータ（岩は円柱、外周は多角形）。
import {
  BufferGeometry, ClampToEdgeWrapping, Float32BufferAttribute, MeshLambertMaterial, RepeatWrapping, type Texture, Vector3,
} from 'three';
import { SeededRng } from '../core/seededRng';
import { loadEnvTexture } from './envArt';
import { CLIFF_ART, CLIFF_ATLAS, CLIFF_M, CLIFF_RELIEF, ROCK_ART, ROCK_ATLAS, ROCK_TILES, type CliffArt, type RockArt } from './rockArtData';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 上の線（64 点。点の真ん中で測った値）を、0〜1 の位置で読む */
function profileAt(p: readonly number[], u: number): number {
  const f = clamp(u, 0, 1) * p.length - 0.5;
  const i = Math.floor(f);
  const a = p[clamp(i, 0, p.length - 1)]!, b = p[clamp(i + 1, 0, p.length - 1)]!;
  return a + (b - a) * (f - i);
}

export function rockArt(id: string): RockArt {
  const a = ROCK_ART.find((r) => r.id === id);
  if (!a) throw new Error(`岩の図が無い: ${id}`);
  return a;
}

/** 平面の点 (x, z) の、地面からの高さ（輪の位置の倍率 k を掛ける前） */
export function rockHeightAt(a: RockArt, x: number, z: number): number {
  const xn = (x + a.w / 2) / a.w, zn = (a.d / 2 - z) / a.d;
  return a.h * profileAt(a.fp, xn) * profileAt(a.sp, zn);
}

/**
 * 輪郭から中心への輪（1 = 輪郭）と、その輪の高さの倍率。いちばん外は地面の下（埋まった根元）、
 * 次の 3 つで急に立ち上がる（地面との境で、岩の横の面がまっすぐ地面に入る）。
 */
const RINGS: readonly (readonly [number, number])[] = [[1, -1], [0.985, 0.45], [0.95, 0.8], [0.89, 0.95], [0.78, 1], [0.6, 1], [0.4, 1], [0.18, 1]];
const RINGS_LOW: readonly (readonly [number, number])[] = [[1, -1], [0.95, 0.6], [0.78, 1], [0.45, 1]];

const geoCache = new Map<string, BufferGeometry>();

/**
 * 岩 1 種の形（図の大きさのまま。m。地面は y = 0）。lod 0 は小石など遠く・小さい物の、粗い形。
 * 属性: position・normal・color（根元の陰）・uvF / uvS / uvT（図集の中の、正面・右側面・平面の図の位置）・wts（3 つの図の混ぜ方）。
 */
export function rockArtGeometry(a: RockArt, lod: 0 | 1 = 1): BufferGeometry {
  const key = `${a.id}:${lod}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const rings = lod ? RINGS : RINGS_LOW;
  const pos: number[] = [], col: number[] = [];
  const index: number[] = [];
  const skirt = -(0.04 + 0.04 * a.h);
  for (const part of a.foot) {
    const P = part.pts;
    const n0 = P.length / 2;
    const ids: number[] = [];
    for (let i = 0; i < n0; i += lod ? 1 : 3) ids.push(i);
    const N = ids.length;
    const base = pos.length / 3;
    const [cx, cz] = part.c;
    for (const [t, k] of rings) {
      for (const i of ids) {
        const x = cx + (P[i * 2]! - cx) * t, z = cz + (P[i * 2 + 1]! - cz) * t;
        const y = k < 0 ? skirt : rockHeightAt(a, x, z) * k;
        pos.push(x, y, z);
      }
    }
    pos.push(cx, rockHeightAt(a, cx, cz), cz);
    const R = rings.length;
    const at = (r: number, j: number): number => base + r * N + ((j + N) % N);
    // 輪郭は x → z へ回る向き。上から見て、面が上（外）を向く巻き方
    for (let r = 0; r < R - 1; r++) {
      for (let j = 0; j < N; j++) {
        const o0 = at(r, j), o1 = at(r, j + 1), i0 = at(r + 1, j), i1 = at(r + 1, j + 1);
        index.push(i0, o1, o0, i0, i1, o1);
      }
    }
    const c = base + R * N;
    for (let j = 0; j < N; j++) index.push(c, at(R - 1, j + 1), at(R - 1, j));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // 巻き方の向きを確かめる（いちばん上の点の法線が下を向いていたら、裏返す）
  const nor = g.getAttribute('normal');
  let top = 0;
  for (let i = 1; i < pos.length / 3; i++) if (pos[i * 3 + 1]! > pos[top * 3 + 1]!) top = i;
  if (nor.getY(top) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2]!, index[i + 1]!];
    g.setIndex(index);
    g.computeVertexNormals();
  }
  const n = g.getAttribute('normal');
  const cnt = pos.length / 3;
  const uvF = new Float32Array(cnt * 2), uvS = new Float32Array(cnt * 2), uvT = new Float32Array(cnt * 2), wts = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    const xn = clamp((x + a.w / 2) / a.w, 0, 1), zn = clamp((a.d / 2 - z) / a.d, 0, 1), yn = clamp(y / a.h, 0, 1);
    uvF[i * 2] = lerp(a.front[0], a.front[2], xn);
    uvF[i * 2 + 1] = lerp(a.front[1], a.front[3], yn);
    uvS[i * 2] = lerp(a.side[0], a.side[2], zn);
    uvS[i * 2 + 1] = lerp(a.side[1], a.side[3], yn);
    uvT[i * 2] = lerp(a.top[0], a.top[2], xn);
    uvT[i * 2 + 1] = lerp(a.top[1], a.top[3], zn);
    // 面の向きで混ぜる（3 乗で、境を狭く）。下を向いた面（地面の下）は、横の図
    const ax = Math.abs(n.getX(i)), ay = Math.max(0, n.getY(i)), az = Math.abs(n.getZ(i));
    let wf = az ** 3, ws = ax ** 3, wt = (ay ** 3) * 1.15;
    const sum = wf + ws + wt;
    if (sum < 1e-4) [wf, ws, wt] = [0.5, 0.5, 0];
    else [wf, ws, wt] = [wf / sum, ws / sum, wt / sum];
    wts[i * 3] = wf;
    wts[i * 3 + 1] = ws;
    wts[i * 3 + 2] = wt;
    // 根元の陰（地面に近いほど暗い。地面の下は土の色に寄せる）
    const ao = y < 0 ? 0.55 : 0.78 + 0.22 * smooth(0, Math.max(0.12, a.h * 0.28), y);
    col.push(ao * (y < 0.03 ? 0.96 : 1), ao * (y < 0.03 ? 0.92 : 1), ao * (y < 0.03 ? 0.86 : 1));
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uvF', new Float32BufferAttribute(uvF, 2));
  g.setAttribute('uvS', new Float32BufferAttribute(uvS, 2));
  g.setAttribute('uvT', new Float32BufferAttribute(uvT, 2));
  g.setAttribute('wts', new Float32BufferAttribute(wts, 3));
  g.computeBoundingSphere();
  geoCache.set(key, g);
  return g;
}

/** 当たりの円柱に置く岩の候補（平たい岩・立ち岩・傾いた板・小さな岩は、当たりの形に合わないので除く） */
export const BIG_ROCKS = ROCK_ART.filter((a) => a.size !== 'S' && !a.tags.includes('flat') && !a.tags.includes('tall')).map((a) => a.id);

export interface RockPlacement {
  id: string;
  x: number;
  /** 根元の高さ（v0.35.0。里の山の岩。無ければ 0） */
  y?: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

/** 輪郭の点の、原点からのいちばん遠い所（横に sx、奥に sz 伸ばした時。向きによらない） */
function footReach(a: RockArt, sx: number, sz: number): number {
  let r = 0;
  for (const part of a.foot) for (let i = 0; i < part.pts.length; i += 2) r = Math.max(r, Math.hypot(part.pts[i]! * sx, part.pts[i + 1]! * sz));
  return r;
}

/**
 * 当たりの円柱（半径 r、高さ h）に置く岩を選ぶ。根元のいちばん外が reach × r に来るように、横と奥を伸ばす
 * （伸ばし方の差は 1.25 倍まで）。高さは h × 0.92 に近づけるが、図の高さの比から 0.8〜1.25 倍まで（埋まった低い岩のまま）。
 * 候補のうち、高さの合う 4 つから、種で 1 つ選ぶ。
 */
export function placeBigRock(rng: SeededRng, r: { x: number; z: number; r: number; h: number }, reach: number): RockPlacement {
  const R = r.r * reach;
  const scored = BIG_ROCKS.map((id) => {
    const a = rockArt(id);
    let sx = R / (a.w / 2), sz = R / (a.d / 2);
    const lim = 1.25;
    if (sz > sx * lim) sz = sx * lim;
    if (sx > sz * lim) sx = sz * lim;
    const k = R / footReach(a, sx, sz);
    sx *= k;
    sz *= k;
    const s = Math.sqrt(sx * sz);
    const want = r.h * 0.92;
    const sy = clamp(want / a.h, s * 0.8, s * 1.25);
    const score = Math.abs(Math.log((a.h * sy) / want)) + 0.35 * Math.abs(Math.log(sz / sx));
    return { id, sx, sy, sz, score };
  }).sort((p, q) => p.score - q.score);
  const pick = scored[Math.floor(rng.next() * Math.min(4, scored.length))]!;
  return { id: pick.id, x: r.x, z: r.z, yaw: rng.next() * Math.PI * 2, sx: pick.sx, sy: pick.sy, sz: pick.sz };
}

/** 置いた岩を、1 つの形にまとめる（描画 1 回。法線は置いた後に作り直す。図の位置と混ぜ方は、置く前の向きのまま） */
export function mergeRocks(list: readonly RockPlacement[]): BufferGeometry {
  const names = ['position', 'color', 'uvF', 'uvS', 'uvT', 'wts'] as const;
  const out: Record<(typeof names)[number], number[]> = { position: [], color: [], uvF: [], uvS: [], uvT: [], wts: [] };
  const index: number[] = [];
  for (const p of list) {
    const g = rockArtGeometry(rockArt(p.id));
    const base = out.position.length / 3;
    const pos = g.getAttribute('position');
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) * p.sx, y = pos.getY(i) * p.sy, z = pos.getZ(i) * p.sz;
      out.position.push(p.x + x * c + z * s, y - 0.03 + (p.y ?? 0), p.z - x * s + z * c);
    }
    for (const nm of names) {
      if (nm === 'position') continue;
      const at = g.getAttribute(nm);
      for (let i = 0; i < at.count * at.itemSize; i++) out[nm].push((at.array as Float32Array)[i]!);
    }
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i));
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(out.position, 3));
  geo.setAttribute('color', new Float32BufferAttribute(out.color, 3));
  geo.setAttribute('uvF', new Float32BufferAttribute(out.uvF, 2));
  geo.setAttribute('uvS', new Float32BufferAttribute(out.uvS, 2));
  geo.setAttribute('uvT', new Float32BufferAttribute(out.uvT, 2));
  geo.setAttribute('wts', new Float32BufferAttribute(out.wts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

// ---- 素材 ----

/** 細かな岩肌（1 枚 = 3m）を、置いた場所の座標で 3 方向から貼って、図の色に掛ける（近くで見ても、ぼけて見えないように） */
const DETAIL_GLSL = `
  vec3 an = abs( normalize( vRockN ) );
  vec3 tw = an * an * an;
  tw /= ( tw.x + tw.y + tw.z + 1e-5 );
  vec3 dA = texture2D( rockDetail, vRockW.zy / 3.0 ).rgb;
  vec3 dB = texture2D( rockDetail, vRockW.xz / 3.0 ).rgb;
  vec3 dC = texture2D( rockDetail, vRockW.xy / 3.0 ).rgb;
  vec3 det = ( dA * tw.x + dB * tw.y + dC * tw.z ) / detailMean;
  det = mix( vec3( 1.0 ), det, detailAmt * detailOn );
`;

const WORLD_VERT = `
  {
    vec4 rw = vec4( transformed, 1.0 );
    vec3 rn = objectNormal;
    #ifdef USE_INSTANCING
      rw = instanceMatrix * rw;
      rn = mat3( instanceMatrix ) * rn;
    #endif
    rw = modelMatrix * rw;
    vRockW = rw.xyz;
    vRockN = mat3( modelMatrix ) * rn;
  }
`;

interface ArtUniforms {
  rockAtlas: { value: Texture | null };
  rockDetail: { value: Texture | null };
  detailMean: { value: Vector3 };
  detailAmt: { value: number };
  artOn: { value: number };
  detailOn: { value: number };
}

/** 細かな岩肌に使う絵（岩 = T-01、崖の面 = T-02。段差・崖の背・門柱の岩肌は envArt.ts の ENV_TILES） */
export const DETAIL_TILES = { rock: 't01', cliff: 't02' } as const satisfies Record<string, keyof typeof ROCK_TILES>;

function detailUniforms(tile: keyof typeof ROCK_TILES, amt: number, gain: number, mat: MeshLambertMaterial): ArtUniforms {
  const t = ROCK_TILES[tile];
  const u: ArtUniforms = {
    rockAtlas: { value: null }, rockDetail: { value: null }, detailMean: { value: new Vector3(...t.mean) }, detailAmt: { value: amt }, artOn: { value: 0 }, detailOn: { value: 0 },
  };
  loadEnvTexture(t.file, (tex) => {
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.anisotropy = 4;
  }, (tex) => {
    u.rockDetail.value = tex;
    u.detailOn.value = 1;
  });
  mat.userData.gain = gain;
  return u;
}

let rockMat: MeshLambertMaterial | null = null;

/**
 * 岩の素材（どの岩も、この 1 つ。図集 rocks_atlas_v1 の 3 つの図を、面の向きの重み wts で混ぜる）。
 * 図が届くまでは、図の平均の色で塗る。
 */
export function rockArtMaterial(gain = 1.75): MeshLambertMaterial {
  if (rockMat) return rockMat;
  const mat = new MeshLambertMaterial({ vertexColors: true });
  const mean = ROCK_ART.reduce((s, a) => s.add(new Vector3(...a.mean)), new Vector3()).multiplyScalar(1 / ROCK_ART.length);
  mat.color.setRGB(mean.x * gain, mean.y * gain, mean.z * gain);
  const u = detailUniforms(DETAIL_TILES.rock, 0.45, gain, mat);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute vec2 uvF;\nattribute vec2 uvS;\nattribute vec2 uvT;\nattribute vec3 wts;\nvarying vec2 vUvF;\nvarying vec2 vUvS;\nvarying vec2 vUvT;\nvarying vec3 vWts;\nvarying vec3 vRockW;\nvarying vec3 vRockN;\n' +
      sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vUvF = uvF; vUvS = uvS; vUvT = uvT; vWts = wts;
  ${WORLD_VERT}`);
    sh.fragmentShader = 'uniform sampler2D rockAtlas;\nuniform sampler2D rockDetail;\nuniform vec3 detailMean;\nuniform float detailAmt;\nuniform float artOn;\nuniform float detailOn;\nvarying vec2 vUvF;\nvarying vec2 vUvS;\nvarying vec2 vUvT;\nvarying vec3 vWts;\nvarying vec3 vRockW;\nvarying vec3 vRockN;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `
  {
    vec3 art = texture2D( rockAtlas, vUvF ).rgb * vWts.x + texture2D( rockAtlas, vUvS ).rgb * vWts.y + texture2D( rockAtlas, vUvT ).rgb * vWts.z;
    ${DETAIL_GLSL}
    diffuseColor.rgb *= mix( vec3( 1.0 ), art * det, artOn );
  }`);
  };
  mat.customProgramCacheKey = () => 'rock-art-v1';
  loadEnvTexture(ROCK_ATLAS, (t) => {
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.anisotropy = 4;
  }, (t) => {
    u.rockAtlas.value = t;
    u.artOn.value = 1;
    mat.color.setScalar(gain);
  });
  mat.userData.rockArt = true;
  // 検査用: 図集と岩肌が読めたか
  mat.userData.art = u;
  rockMat = mat;
  return mat;
}

let cliffMat: MeshLambertMaterial | null = null;

/** 崖の面の素材（図集 cliffs_atlas_v1。上の線より上は透明で、切り抜く） */
export function cliffArtMaterial(gain = 1.85): MeshLambertMaterial {
  if (cliffMat) return cliffMat;
  const mat = new MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5 });
  const mean = CLIFF_ART.reduce((s, a) => s.add(new Vector3(...a.mean)), new Vector3()).multiplyScalar(1 / CLIFF_ART.length);
  mat.color.setRGB(mean.x * gain, mean.y * gain, mean.z * gain);
  const u = detailUniforms(DETAIL_TILES.cliff, 0.4, gain, mat);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRockW;\nvarying vec3 vRockN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  ${WORLD_VERT}`);
    sh.fragmentShader = 'uniform sampler2D rockDetail;\nuniform vec3 detailMean;\nuniform float detailAmt;\nuniform float detailOn;\nvarying vec3 vRockW;\nvarying vec3 vRockN;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    ${DETAIL_GLSL}
    diffuseColor.rgb *= det;
  }`);
  };
  mat.customProgramCacheKey = () => 'cliff-art-v1';
  mat.userData.uv = true;
  mat.userData.art = u;
  // 絵が届くまでは、面を見せない（透明の所の形が分からないので、上の線の上まで四角く塗ってしまう）
  mat.visible = false;
  loadEnvTexture(CLIFF_ATLAS, (t) => {
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.anisotropy = 4;
  }, (t) => {
    mat.map = t;
    mat.color.setScalar(gain);
    mat.visible = true;
    mat.needsUpdate = true;
  });
  cliffMat = mat;
  return mat;
}

// ---- 崖 ----

export interface WallPt { x: number; z: number; nx: number; nz: number; reach: number }

/** 崖の図 1 枚の置き方: 外周の道の上の、始め s0 から、横の伸ばし方 k で（図の 24m が 24k m） */
export interface CliffPiece { id: string; s0: number; k: number }

const TALL_CLIFFS = CLIFF_ART.filter((c) => !c.exit && Math.min(...c.edges) > 3.6).map((c) => c.id);
const LOW_CLIFFS = CLIFF_ART.filter((c) => !c.exit && Math.max(...c.edges) <= 3.6).map((c) => c.id);
const EXIT_L = CLIFF_ART.find((c) => c.exit === 'right')!;
const EXIT_R = CLIFF_ART.find((c) => c.exit === 'left')!;
/** 出口の開ける幅の半分（m）。出口のわきの図の、何も無い所の始まりを、ここへ合わせる */
export const GATE_HALF = 4.5;

export function cliffArt(id: string): CliffArt {
  const c = CLIFF_ART.find((x) => x.id === id);
  if (!c) throw new Error(`崖の図が無い: ${id}`);
  return c;
}

/**
 * 外周の道（閉じた輪、長さ L）に、崖の図を並べる。出口があれば、出口の左に C-19（右の端が何も無い）、右に C-20 を、
 * 何も無い所が出口に重なるように置き、その間を、ふつうの図で埋める（同じ図を続けない）。間の長さに合わせて、図を横に伸び縮みさせる。
 * low = 低い崖（端の高さ 3m の図）。nest = 晶の図を多めに。
 */
export function planCliffs(L: number, gateS: readonly number[], rng: SeededRng, o: { low: boolean; nest: boolean }): CliffPiece[] {
  const pool = o.low ? LOW_CLIFFS : TALL_CLIFFS;
  const weight = (id: string): number => {
    const t = cliffArt(id).tags;
    return o.nest && (t.includes('vein') || t.includes('crystal')) ? 3 : 1;
  };
  let last = '';
  const pick = (): string => {
    const cand = pool.filter((id) => id !== last);
    const total = cand.reduce((s, id) => s + weight(id), 0);
    let r = rng.next() * total;
    for (const id of cand) {
      r -= weight(id);
      if (r <= 0) return (last = id);
    }
    return (last = cand[cand.length - 1]!);
  };
  const out: CliffPiece[] = [];
  if (gateS.length === 0) {
    const n = Math.max(3, Math.round(L / CLIFF_M));
    const k = L / (CLIFF_M * n);
    for (let i = 0; i < n; i++) out.push({ id: pick(), s0: (i * L) / n, k });
    return out;
  }
  const gs = [...gateS].sort((a, b) => a - b);
  // 出口のわきの図の、壁のある長さ（C-20 は何も無い所の後ろ、C-19 は前）
  const wallR = CLIFF_M - EXIT_R.empty![1], wallL = EXIT_L.empty![0];
  for (let j = 0; j < gs.length; j++) {
    const a = gs[j]! + GATE_HALF;
    const b = (j + 1 < gs.length ? gs[j + 1]! : gs[0]! + L) - GATE_HALF;
    const D = b - a;
    if (D <= 1) continue;
    // 間に入れるふつうの図の数は、横の伸び縮みが、比で 1 にいちばん近くなる数（1.3 倍に伸ばすより、0.78 倍に縮める方を選ぶ。
    // 出口が 4 つあるエリア 3 では、間が 45m ほどで、四捨五入だと出口のわきの 2 枚だけを 1.3 倍に伸ばして並べていた）
    const kOf = (n: number): number => D / (wallR + wallL + n * CLIFF_M);
    let m = Math.max(0, Math.floor((D - wallR - wallL) / CLIFF_M));
    if (Math.abs(Math.log(kOf(m + 1))) < Math.abs(Math.log(kOf(m)))) m += 1;
    const k = kOf(m);
    // C-20: 何も無い所の終わり（empty[1]）が、出口の端 a に来る
    out.push({ id: EXIT_R.id, s0: a - EXIT_R.empty![1] * k, k });
    let s = a + wallR * k;
    for (let i = 0; i < m; i++) {
      out.push({ id: pick(), s0: s, k });
      s += CLIFF_M * k;
    }
    // C-19: 何も無い所の始まり（empty[0]）が、出口の端 b に来る
    out.push({ id: EXIT_L.id, s0: b - EXIT_L.empty![0] * k, k });
  }
  return out;
}

const relief = new Map<string, Int8Array>();
function reliefOf(c: CliffArt): Int8Array {
  let r = relief.get(c.id);
  if (!r) {
    const bin = atob(c.relief);
    r = new Int8Array(bin.length);
    for (let i = 0; i < bin.length; i++) r[i] = (bin.charCodeAt(i) << 24) >> 24;
    relief.set(c.id, r);
  }
  return r;
}

/** 凹凸（-1 = 奥、1 = 手前）を、図の中の位置（横 0〜24m、地面からの高さ m）で読む */
export function cliffReliefAt(c: CliffArt, xm: number, ym: number): number {
  const [W, H] = CLIFF_RELIEF;
  const r = reliefOf(c);
  const fx = clamp(xm / CLIFF_M, 0, 1) * (W - 1);
  const vfrac = c.g + ym / c.hM;
  const fy = clamp(1 - vfrac, 0, 1) * (H - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const v = (x: number, y: number): number => r[y * W + x]! / 127;
  return lerp(lerp(v(x0, y0), v(x1, y0), tx), lerp(v(x0, y1), v(x1, y1), tx), ty);
}

/** 上の線（地面からの高さ m）を、図の中の横の位置（0〜24m）で読む */
export function cliffTopAt(c: CliffArt, xm: number): number {
  const n = c.top.length;
  const f = clamp(xm / CLIFF_M, 0, 1) * n - 0.5;
  const i = Math.floor(f);
  const a = c.top[clamp(i, 0, n - 1)]!, b = c.top[clamp(i + 1, 0, n - 1)]!;
  return a + (b - a) * (f - i);
}

/** 道の上の位置 s（輪を回る。0〜L）の点と外向き */
function pathAt(path: readonly WallPt[], cum: readonly number[], L: number, s: number): WallPt {
  s = ((s % L) + L) % L;
  let lo = 0, hi = path.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = path[lo]!, b = path[(lo + 1) % path.length]!;
  const len = (lo + 1 < path.length ? cum[lo + 1]! : L) - cum[lo]!;
  const t = len > 1e-9 ? (s - cum[lo]!) / len : 0;
  const nx = lerp(a.nx, b.nx, t), nz = lerp(a.nz, b.nz, t);
  const nl = Math.hypot(nx, nz) || 1;
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), nx: nx / nl, nz: nz / nl, reach: Math.min(a.reach, b.reach) };
}

/** 道の長さ（点ごとの、始めからの長さ）と、全体の長さ */
export function pathLengths(path: readonly WallPt[]): { cum: number[]; L: number } {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  const L = cum[cum.length - 1]! + Math.hypot(path[0]!.x - path[path.length - 1]!.x, path[0]!.z - path[path.length - 1]!.z);
  return { cum, L };
}

/** 道の上で、点にいちばん近い位置 s */
export function pathSOf(path: readonly WallPt[], cum: readonly number[], x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = (path[i]!.x - x) ** 2 + (path[i]!.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return cum[best]!;
}

const COLS = 48;
/** 面の行（地面の下 0.5m から、上の線の 0.25m 上まで。割合） */
const ROWS = [0, 0.06, 0.16, 0.3, 0.46, 0.63, 0.8, 0.9, 1];

export interface ArtCliffOptions {
  /** 外周の外 0.5m の道（rockGeo.polyPath。x → z へ回る向き） */
  path: readonly WallPt[];
  gates: readonly { x: number; z: number }[];
  /** 崖の高さの倍率（図の高さ × vk） */
  vk: number;
  low: boolean;
  nest: boolean;
  moss: number;
  /** 崖の根元の高さ（v0.35.0。段のある里は、外周のすぐ内の床の高さ。無ければ 0）。段の境の列の間には、面を張らない */
  baseAt?: (x: number, z: number) => number;
}

/**
 * 外周の崖: 面（図を貼る。uv・頂点の色）と、上の縁から外へ下る背（岩肌の絵。uv は m ÷ 3）の 2 つの形。
 * 面は、図の上の線より 0.25m 上まで作り、上の線より上は、素材の切り抜き（alphaTest）で消す。何も無い所（出口）には面を作らない。
 * 面の出し入れ: 上ほど 6% 外へ（奥へ傾く）、明るい所は手前へ、暗い所は奥へ（凹凸の 0.45m）。歩ける範囲へは入らない（外周の外 0.08m まで）。
 */
export function artCliffGeometry(o: ArtCliffOptions, rng: SeededRng): { face: BufferGeometry; cap: BufferGeometry; pieces: CliffPiece[] } {
  const { cum, L } = pathLengths(o.path);
  const gateS = o.gates.map((g) => pathSOf(o.path, cum, g.x, g.z));
  const pieces = planCliffs(L, gateS, rng, { low: o.low, nest: o.nest });
  const fp: number[] = [], fuv: number[] = [], fcol: number[] = [], fidx: number[] = [];
  const cp: number[] = [], cuv: number[] = [], ccol: number[] = [], cidx: number[] = [];
  const R = ROWS.length;
  // 背の断面: [面の上の縁から外への距離 m, 上の線からの高さ m]。どこも上の線より下（下から見上げても、面の上へはみ出さない）
  const capRows: [number, number][] = [[0.1, -0.3], [1.0, -0.4], [3.0, -0.75], [6.0, -1.4], [9.5, -2.3]];
  for (const pc of pieces) {
    const c = cliffArt(pc.id);
    const base = fp.length / 3;
    const capBase = cp.length / 3;
    const have: boolean[] = [];
    // 列ごとの根元の高さ（外周の道から 0.9m 内の床）
    const yb: number[] = [];
    for (let i = -1; i <= COLS + 1; i++) {
      const q = pathAt(o.path, cum, L, pc.s0 + (i / COLS) * CLIFF_M * pc.k);
      yb.push(o.baseAt ? o.baseAt(q.x - q.nx * 0.9, q.z - q.nz * 0.9) : 0);
    }
    for (let i = 0; i <= COLS; i++) {
      const xm = (i / COLS) * CLIFF_M;
      const s = pc.s0 + xm * pc.k;
      const q = pathAt(o.path, cum, L, s);
      const y0 = yb[i + 1]!;
      const topImg = cliffTopAt(c, xm);
      // 隣の列も見て、何も無い所か決める（出口のわきの図の、透明の側）
      const topNear = Math.max(topImg, cliffTopAt(c, ((i - 1) / COLS) * CLIFF_M), cliffTopAt(c, ((i + 1) / COLS) * CLIFF_M));
      have.push(topNear > 0.05);
      const H = Math.max(0.3, topImg) * o.vk;
      const yTop = H + 0.25;
      let dTop = 0;
      for (let k = 0; k < R; k++) {
        const y = -0.5 + (yTop + 0.5) * ROWS[k]!;
        const ym = y / o.vk;
        // 図のつなぎ目（左右の端 0.8m）では、凹凸を 0 へ（隣の図と面の位置がそろい、すき間から空が見えない）
        const edgeFade = smooth(0, 0.8, Math.min(xm, CLIFF_M - xm));
        const rel = cliffReliefAt(c, xm, Math.max(0, ym)) * edgeFade;
        const d = Math.max(-0.42, 0.06 * Math.max(0, y) - 0.45 * rel);
        if (k === R - 2) dTop = d;
        fp.push(q.x + q.nx * d, y0 + y, q.z + q.nz * d);
        fuv.push(lerp(c.rect[0], c.rect[2], xm / CLIFF_M), lerp(c.rect[1], c.rect[3], clamp(c.g + ym / c.hM, 0, 1)));
        const ao = 0.74 + 0.26 * smooth(-0.3, 1.6, y);
        fcol.push(ao, ao, ao);
      }
      // 背: 上の縁から外へ下る（道の reach を超えない）
      for (const [out, dy] of capRows) {
        const dd = Math.min(dTop + out, Math.max(dTop + 0.1, q.reach));
        const y = Math.max(-0.3, H + dy * o.vk);
        cp.push(q.x + q.nx * dd, y0 + y, q.z + q.nz * dd);
        cuv.push(s / 3, (dd + y * 0.4) / 3);
        const mossy = o.moss * (out <= 3 ? 0.65 : 0.35);
        const sh = 0.82 - 0.12 * (out / 9.5);
        ccol.push(sh * (1 - mossy * 0.25), sh * (1 + mossy * 0.08), sh * (1 - mossy * 0.35));
      }
    }
    for (let i = 0; i < COLS; i++) {
      if (!have[i] && !have[i + 1]) continue;
      // 段の境（根元の高さが跳ぶ所）では、列の間に面を張らない（斜めに伸びた面になる。境は段の擁壁が外周の外まで延びて隠す）
      if (Math.abs(yb[i + 1]! - yb[i + 2]!) > 0.6) continue;
      const capOk = cliffTopAt(c, (i / COLS) * CLIFF_M) > 0.5 && cliffTopAt(c, ((i + 1) / COLS) * CLIFF_M) > 0.5;
      for (let k = 0; k < R - 1; k++) {
        const a = base + i * R + k, b = base + (i + 1) * R + k, cc = base + i * R + k + 1, d = base + (i + 1) * R + k + 1;
        // 内側（歩ける範囲）から見て表になる向き（道は、上から見て x → z の向きに回る）
        fidx.push(a, b, cc, b, d, cc);
      }
      const CR = capRows.length;
      for (let k = 0; k < CR - 1 && capOk; k++) {
        const a = capBase + i * CR + k, b = capBase + (i + 1) * CR + k, cc = capBase + i * CR + k + 1, d = capBase + (i + 1) * CR + k + 1;
        cidx.push(a, b, cc, b, d, cc);
      }
    }
  }
  const face = new BufferGeometry();
  face.setAttribute('position', new Float32BufferAttribute(fp, 3));
  face.setAttribute('uv', new Float32BufferAttribute(fuv, 2));
  face.setAttribute('color', new Float32BufferAttribute(fcol, 3));
  face.setIndex(fidx);
  face.computeVertexNormals();
  const cap = new BufferGeometry();
  cap.setAttribute('position', new Float32BufferAttribute(cp, 3));
  cap.setAttribute('uv', new Float32BufferAttribute(cuv, 2));
  cap.setAttribute('color', new Float32BufferAttribute(ccol, 3));
  cap.setIndex(cidx);
  cap.computeVertexNormals();
  return { face, cap, pieces };
}
