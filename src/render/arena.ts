// 戦闘区画の見た目。地形の形と寸法はマップデータ（public/data/maps と public/data/fields）が正本で、ここはそれを描くだけ。
// 立体は、箱・板・多面体の簡単な形。その面に、景色の絵（依頼 8。src/render/envArt.ts）を貼る（v0.13.0、docs/spec.md の 21 章）。
// フィールドでは、エリアごとに 1 つの Group を作る（setupSky で空と光を 1 回だけ用意し、buildAreaGroup をエリアの数だけ呼ぶ）。
import {
  BoxGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, FogExp2, Group, HemisphereLight, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, Quaternion, Scene, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRng } from '../core/seededRng';
import type { MapDef } from '../data/schemas';
import { ENV_SPRITES, ENV_TILES, SpriteField, boxUv, buildBackdrop, tileMaterial, type EnvPlace, type EnvTile } from './envArt';
import { boulderGeometry, cliffGeometry } from './rockGeo';
import { SKY_LOOKS, SkyDome } from './sky';

export const FOG_COLOR = 0xaebcab;
/**
 * 霧の濃さ（v0.19.0 から、距離の 2 乗で濃くなる霧）。10m で 1%、40m で 18%、80m で 55%、150m で 94%。
 * 近い所にも少しかかり、遠い所ほど空気の色に溶ける（それまでは 38〜150m の間で、まっすぐ濃くなる霧）。
 */
export const FOG_DENSITY = 0.0112;
/** 太陽の向き（光の当たる側から見た、空の上の太陽の位置）。光（DirectionalLight）と空の日の位置を合わせる */
export const SUN_DIR = new Vector3(-14, 26, -11).normalize();

export interface Arena {
  group: Group;
  sun: DirectionalLight;
  /** 空と遠景（カメラと一緒に動かす） */
  backdrop: Group;
  /** 空（雲を流す。v0.19.0） */
  sky?: SkyDome;
}

/** 1 つのエリアの見た目に要るもの（形は MapDef / FieldAreaDef と同じ）。 */
export interface AreaLook {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  rocks: { x: number; z: number; r: number; h: number }[];
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[];
  /** 天幕を置く場所（無ければ置かない） */
  camp?: { x: number; z: number; r: number } | null;
  /** 外周の岩壁を開ける場所。marker が付いたものは、出口の目印（門柱と踏み跡）も置く */
  gates?: { x: number; z: number; marker?: boolean }[];
  /** 種類。地面の絵と、草の生え方が変わる。nest は晶の柱が立つ。village は里（踏み固めた土） */
  kind?: 'camp' | 'hunt' | 'path' | 'nest' | 'village';
  /** 草や岩壁の散らし方の種（エリアごとに変える） */
  seed?: number;
  /** false なら、rocks を岩として描かない（里の建物の当たりに使う時。草をよける場所としては使う） */
  drawRocks?: boolean;
  /** 草や小物を置かない円（広場など） */
  clear?: { x: number; z: number; r: number }[];
  /** 外周の岩壁の高さ [いちばん低い所, ばらつきの幅]（m）。無ければ [4, 4.5]。里は低くして、遠くの景色を見せる */
  wallHeight?: [number, number];
}

/** これまでの狩場（エリアが 1 つ）: 空と光を用意して、狩場を描く。 */
export function buildArena(scene: Scene, map: MapDef, shadows: boolean): Arena {
  const sky = setupSky(scene, shadows, 'basin');
  // キャンプ側の出入口だけ開ける（見た目のみ。衝突は外周で止まる）
  const group = buildAreaGroup({ bounds: map.bounds, rocks: map.rocks, platforms: map.platforms, camp: map.camp, gates: [{ x: map.camp.x, z: map.bounds.minZ }] });
  scene.add(group);
  return { group, ...sky };
}

/**
 * 空・遠景（貼った絵）・霧・光。シーンに 1 回だけ。place で、遠景の絵と空の色を選ぶ（狩場か、里か）。
 * 空（SkyDome）は遠景の筒の外側。遠景の絵は空の部分が透明で、空の前に山だけが立つ（v0.19.0）。
 */
export function setupSky(scene: Scene, shadows: boolean, place: EnvPlace): { sun: DirectionalLight; backdrop: Group; sky: SkyDome } {
  scene.background = new Color(FOG_COLOR);
  scene.fog = new FogExp2(FOG_COLOR, FOG_DENSITY);
  const backdrop = buildBackdrop(place);
  const sky = new SkyDome(SKY_LOOKS[place], SUN_DIR);
  backdrop.add(sky.mesh);
  scene.add(backdrop);

  const hemi = new HemisphereLight(0xe6efe2, 0x56624f, 1.15);
  const sun = new DirectionalLight(0xfff0d2, 1.9);
  sun.position.copy(SUN_DIR).multiplyScalar(36);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    cam.left = -16;
    cam.right = 16;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 1;
    cam.far = 120;
    sun.shadow.bias = -0.0008;
  }
  scene.add(hemi, sun, sun.target);
  return { sun, backdrop, sky };
}

/** 種類ごとの、地面の絵と、1 m² あたりの草・小物の数。 */
const KIND_LOOK: Record<NonNullable<AreaLook['kind']>, { ground: EnvTile; short: number; tall: number; dry: number; flower: number; stones: number; bush: number; crystal: number; branch: number }> = {
  camp: { ground: 'grass', short: 0.2, tall: 0.06, dry: 0.03, flower: 0.03, stones: 0.008, bush: 0.006, crystal: 0, branch: 0.003 },
  hunt: { ground: 'grass', short: 0.26, tall: 0.09, dry: 0.04, flower: 0.03, stones: 0.01, bush: 0.007, crystal: 0.0012, branch: 0.004 },
  path: { ground: 'gravel', short: 0.035, tall: 0.01, dry: 0.07, flower: 0.006, stones: 0.028, bush: 0.004, crystal: 0.0012, branch: 0.008 },
  nest: { ground: 'nest', short: 0, tall: 0, dry: 0.012, flower: 0, stones: 0.024, bush: 0, crystal: 0.02, branch: 0.004 },
  village: { ground: 'earth', short: 0.07, tall: 0.018, dry: 0.02, flower: 0.03, stones: 0.008, bush: 0.008, crystal: 0, branch: 0 },
};
/** 地面を、歩ける範囲の外へ広げる幅（m）。端が霧の向こうになるように。 */
const GROUND_MARGIN = 130;
/** 絵の明るさの倍率（envArt.tileMaterial の gain）。地面は、色むらで暗くなるぶんも持ち上げる。 */
const GROUND_GAIN = 1.25;
const ROCK_GAIN = 1.5;
/** 岩の絵を凹凸にも使う時の強さ（envArt.tileMaterial の bump） */
const ROCK_BUMP = 2;

/** なめらかな濃淡（0〜1）。地面の色むらと、草のかたまり方に使う。 */
function patchNoise(seed: number): (x: number, z: number) => number {
  const hash = (ix: number, iz: number): number => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 144665)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const layer = (x: number, z: number, size: number): number => {
    const fx = x / size, fz = z / size;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  return (x, z) => layer(x, z, 11) * 0.6 + layer(x + 40, z - 17, 27) * 0.4;
}

/** エリア 1 つぶんの地形（地面・岩・段差・外周の岩壁・遠くの山・草）。シーンへは呼んだ側が足す。 */
export function buildAreaGroup(map: AreaLook): Group {
  const group = new Group();
  const rng = new SeededRng(map.seed ?? 9001);
  const b = map.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const gates = map.gates ?? [];

  const look = KIND_LOOK[map.kind ?? 'hunt'];
  const noise = patchNoise(map.seed ?? 9001);

  // 地面: 絵を、1 枚 = 6m 四方で敷き詰める。同じ絵の並びが目立たないよう、頂点の色で、ゆるい濃淡と色むらを足す
  const gw = w + GROUND_MARGIN * 2, gd = d + GROUND_MARGIN * 2;
  const groundGeo = new PlaneGeometry(gw, gd, Math.ceil(gw / 5), Math.ceil(gd / 5));
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(cx, 0, cz);
  {
    const pos = groundGeo.getAttribute('position');
    const tile = ENV_TILES[look.ground].tile;
    const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      uv[i * 2] = x / tile;
      uv[i * 2 + 1] = -z / tile;
      const shade = 1 - 0.2 * noise(x, z);
      const warm = (noise(x + 91, z + 53) - 0.5) * 0.14;
      col[i * 3] = shade * (1 + warm);
      col[i * 3 + 1] = shade;
      col[i * 3 + 2] = shade * (1 - warm);
    }
    groundGeo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    groundGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  }
  const ground = new Mesh(groundGeo, tileMaterial(look.ground, 0xffffff, { vertexColors: true, gain: GROUND_GAIN }));
  ground.receiveShadow = true;
  ground.userData.noMerge = true;
  group.add(ground);

  const rockDark = tileMaterial('rock', 0xd2d6ce, { flat: true, gain: ROCK_GAIN });
  const bronze = new MeshLambertMaterial({ color: 0xb08d57, emissive: 0x2a1d08, flatShading: true });
  const stepMat = tileMaterial('rock', 0xf2efe6, { flat: true, gain: ROCK_GAIN });
  const stepTop = tileMaterial(look.ground, 0xffffff, { gain: GROUND_GAIN * 0.95 });
  // 岩と岩壁（v0.19.0）: なめらかな凹凸と、頂点の色（苔・陰・晶脈）。色の分だけ暗くなるので、少し持ち上げる
  const boulderMat = tileMaterial('rock', 0xffffff, { vertexColors: true, gain: ROCK_GAIN * 1.12, bump: ROCK_BUMP });
  const veinBoulderMat = tileMaterial('vein', 0xfff6e6, { vertexColors: true, gain: ROCK_GAIN * 1.12, bump: ROCK_BUMP });
  const cliffMat = tileMaterial('rock', 0xf4f1ea, { vertexColors: true, gain: ROCK_GAIN * 1.15, bump: ROCK_BUMP });
  const moss = map.kind === 'nest' ? 0.15 : map.kind === 'path' ? 0.35 : map.kind === 'village' ? 0.5 : 0.65;

  // 岩（円柱として衝突する。見た目は、半径と高さに合わせた、凹凸のある岩）。晶脈の走る岩には、青銅色の筋
  for (const r of map.drawRocks === false ? [] : map.rocks) {
    const veined = rng.next() < 0.45;
    const m = new Mesh(boulderGeometry(rng, { detail: 3, rough: 0.4 + rng.next() * 0.2, moss, vein: veined, strata: rng.next() < 0.6 ? 0.6 + rng.next() * 0.4 : 0, cuts: 3 + Math.floor(rng.next() * 4) }), veined ? veinBoulderMat : boulderMat);
    m.scale.set(r.r, r.h * 0.86, r.r);
    m.position.set(r.x, -0.05, r.z);
    m.rotation.y = rng.next() * 6.28;
    m.castShadow = true;
    m.receiveShadow = true;
    boxUv(m, ENV_TILES.rock.tile);
    group.add(m);
  }

  // 段差（横は岩肌、上は、その場所の地面）
  for (const p of map.platforms) {
    const box = new Mesh(new BoxGeometry(p.maxX - p.minX, p.h, p.maxZ - p.minZ), [stepMat, stepMat, stepTop, stepMat, stepMat, stepMat]);
    box.position.set((p.minX + p.maxX) / 2, p.h / 2, (p.minZ + p.maxZ) / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    boxUv(box, ENV_TILES.rock.tile, ENV_TILES[look.ground].tile);
    group.add(box);
  }

  // 外周の岩壁（v0.19.0）: 四角のすぐ外に立つ、切り立った 1 枚の岩の面。高さと面の凹凸は雑音で変える。出入口の所は開ける
  // （見た目のみ。衝突は外周で止まり、出口は simulation が扱う）
  const wallH = map.wallHeight ?? [5, 5.5];
  const cliff = new Mesh(cliffGeometry(rng, { bounds: b, gates, height: wallH, moss, veins: map.kind === 'village' ? 0 : map.kind === 'nest' ? 0.7 : 0.3 }, ENV_TILES.rock.tile), cliffMat);
  cliff.castShadow = true;
  cliff.receiveShadow = true;
  group.add(cliff);
  // 岩壁の根元の崩れた岩（歩ける範囲の外）と、大きな岩のまわりの小石（足首より低い）
  addRubble(group, rng, b, gates, map.drawRocks === false ? [] : map.rocks, boulderMat, moss, map.kind === 'village' ? 0.35 : 1);

  // 出口の目印: 踏み跡（明るい地面）と、両脇の門柱。柱の頭は青銅色
  const trail = tileMaterial('gravel', map.kind === 'path' ? 0xdcd6c8 : 0xffffff, { gain: GROUND_GAIN });
  for (const g of gates) {
    if (!g.marker) continue;
    // 外向き（エリアの中心から出口へ）
    const ox = Math.abs(g.x - b.minX) < 5 ? -1 : Math.abs(g.x - b.maxX) < 5 ? 1 : 0;
    const oz = ox !== 0 ? 0 : g.z < cz ? -1 : 1;
    const path = new Mesh(new PlaneGeometry(ox !== 0 ? 16 : 5.4, ox !== 0 ? 5.4 : 16), trail);
    path.rotation.x = -Math.PI / 2;
    path.position.set(g.x + ox * 2, 0.015, g.z + oz * 2);
    path.receiveShadow = true;
    boxUv(path, ENV_TILES.gravel.tile);
    group.add(path);
    for (const s of [-1, 1]) {
      const px = g.x + ox * 2.3 + (ox !== 0 ? 0 : s * 3.1), pz = g.z + oz * 2.3 + (ox !== 0 ? s * 3.1 : 0);
      const post = new Mesh(new CylinderGeometry(0.42, 0.6, 3.4, 6), rockDark);
      post.position.set(px, 1.7, pz);
      post.castShadow = true;
      const cap = new Mesh(new ConeGeometry(0.5, 0.7, 6), bronze);
      cap.position.set(px, 3.75, pz);
      group.add(post, cap);
    }
  }

  // 遠くの山は、空と一緒に貼った絵（setupSky の backdrop）。ここでは作らない

  // 巣: 壁ぎわに、晶の柱が立つ
  if (map.kind === 'nest') {
    const crystal = new MeshLambertMaterial({ color: 0xc9a86a, emissive: 0x5a3c12, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const side = i % 4;
      const t = rng.next();
      const x = side < 2 ? b.minX + t * w : side === 2 ? b.minX + 0.6 + rng.next() * 2.2 : b.maxX - 0.6 - rng.next() * 2.2;
      const z = side === 0 ? b.minZ + 0.6 + rng.next() * 2.2 : side === 1 ? b.maxZ - 0.6 - rng.next() * 2.2 : b.minZ + t * d;
      if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 7)) continue;
      const h = 1.4 + rng.next() * 3.2;
      const c = new Mesh(new ConeGeometry(0.28 + rng.next() * 0.3, h, 5), crystal);
      c.position.set(x, h / 2 - 0.1, z);
      c.rotation.set((rng.next() - 0.5) * 0.5, rng.next() * 6, (rng.next() - 0.5) * 0.5);
      group.add(c);
    }
  }

  // キャンプ: 天幕と灯
  if (map.camp) addCamp(group, map.camp, rockDark);

  // 草と小物: 切り抜きの絵を貼った板を立てる（種類ごとに 1 回の描画）。濃淡に合わせて、かたまって生える
  const clear = map.clear ?? [];
  const blocked = (x: number, z: number): boolean =>
    map.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 0.35) ||
    map.platforms.some((p) => x > p.minX - 0.3 && x < p.maxX + 0.3 && z > p.minZ - 0.3 && z < p.maxZ + 0.3) ||
    clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r) ||
    gates.some((g) => g.marker === true && Math.abs(x - g.x) < 3.2 + (Math.abs(g.x - cx) > w / 2 - 6 ? 7 : 0) && Math.abs(z - g.z) < 3.2 + (Math.abs(g.z - cz) > d / 2 - 6 ? 7 : 0)) ||
    (map.camp != null && Math.hypot(x - map.camp.x, z - map.camp.z) < map.camp.r);
  /** 濃い所（clump = 1）か、どこでも（clump = 0）か。置けなければ null */
  const spot = (clump: number) => (): { x: number; z: number } | null => {
    for (let tries = 0; tries < 8; tries++) {
      const x = b.minX + 0.4 + rng.next() * (w - 0.8);
      const z = b.minZ + 0.4 + rng.next() * (d - 0.8);
      if (blocked(x, z)) continue;
      if (clump > 0 && rng.next() > 1 - clump + clump * Math.min(1, noise(x, z) * 1.7)) continue;
      return { x, z };
    }
    return null;
  };
  const area = w * d;
  const count = (perM2: number, max: number): number => Math.min(max, Math.round(perM2 * area));
  const field = new SpriteField(group, rng);
  const G = ENV_SPRITES.grass, P = ENV_SPRITES.props;
  field.scatter(G, G.cells.short, count(look.short, 2000), spot(0.75), [0.8, 1.25], 0.12);
  field.scatter(G, G.cells.tall, count(look.tall, 700), spot(0.9), [0.8, 1.3], 0.12);
  field.scatter(G, G.cells.dry, count(look.dry, 520), spot(0.5), [0.8, 1.25], 0.1);
  field.scatter(G, G.cells.flower, count(look.flower, 260), spot(0.8), [0.8, 1.25], 0.08);
  field.scatter(P, P.cells.stones, count(look.stones, 220), spot(0), [0.8, 1.25], 0.1);
  field.scatter(P, P.cells.bush, count(look.bush, 70), spot(0.4), [0.8, 1.5], 0.1);
  field.scatter(P, P.cells.crystal, count(look.crystal, 120), spot(0), [0.7, 1.6]);
  field.scatter(P, P.cells.branch, count(look.branch, 60), spot(0), [0.8, 1.4]);

  mergeStatic(group);
  return group;
}

/**
 * 崩れた岩（v0.19.0）: 形の違う 3 つの小さな岩を、InstancedMesh で並べる（描画は 3 回）。
 * 岩壁の根元（歩ける範囲の外、0.3〜1.6m）には 0.4〜1.3m の岩、大きな岩のまわりには 0.12〜0.3m の小石（歩ける範囲の中。足首より低い）。
 */
function addRubble(group: Group, rng: SeededRng, b: AreaLook['bounds'], gates: { x: number; z: number }[], rocks: AreaLook['rocks'], mat: MeshLambertMaterial, moss: number, amount: number): void {
  const geos = [0, 1, 2].map(() => {
    const m = new Mesh(boulderGeometry(rng, { detail: 2, rough: 0.45, moss, strata: 0, cuts: 3 }));
    boxUv(m, ENV_TILES.rock.tile * 0.4);
    return m.geometry;
  });
  const lists: { x: number; z: number; s: number; h: number; yaw: number }[][] = [[], [], []];
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const nearGate = (x: number, z: number): boolean => gates.some((g) => Math.hypot(g.x - x, g.z - z) < 9);
  // 岩壁の根元: 周りの長さ 4m ごとに 1 つくらい
  const perim = 2 * (w + d);
  const n1 = Math.round((perim / 4) * amount);
  for (let i = 0; i < n1; i++) {
    const t = rng.next() * perim;
    let x: number, z: number, nx: number, nz: number;
    if (t < w) [x, z, nx, nz] = [b.minX + t, b.minZ, 0, -1];
    else if (t < w + d) [x, z, nx, nz] = [b.maxX, b.minZ + (t - w), 1, 0];
    else if (t < 2 * w + d) [x, z, nx, nz] = [b.maxX - (t - w - d), b.maxZ, 0, 1];
    else [x, z, nx, nz] = [b.minX, b.maxZ - (t - 2 * w - d), -1, 0];
    if (nearGate(x, z)) continue;
    const s = 0.4 + rng.next() * 0.9;
    const out = 0.3 + s * 0.6 + rng.next() * 0.6;
    lists[i % 3]!.push({ x: x + nx * out, z: z + nz * out, s, h: s * (0.6 + rng.next() * 0.5), yaw: rng.next() * 6.28 });
  }
  // 大きな岩のまわりの小石
  for (const r of rocks) {
    const cnt = Math.round((3 + rng.next() * 4) * amount);
    for (let i = 0; i < cnt; i++) {
      const a = rng.next() * 6.28;
      const dist = r.r + 0.2 + rng.next() * 1.4;
      const x = r.x + Math.cos(a) * dist, z = r.z + Math.sin(a) * dist;
      if (x < b.minX + 0.3 || x > b.maxX - 0.3 || z < b.minZ + 0.3 || z > b.maxZ - 0.3 || nearGate(x, z)) continue;
      const s = 0.12 + rng.next() * 0.18;
      lists[(i + 1) % 3]!.push({ x, z, s, h: s * (0.5 + rng.next() * 0.5), yaw: rng.next() * 6.28 });
    }
  }
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), at = new Vector3(), sc = new Vector3();
  lists.forEach((list, k) => {
    if (list.length === 0) return;
    const im = new InstancedMesh(geos[k]!, mat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(at.set(p.x, -0.04, p.z), q, sc.set(p.s, p.h, p.s * (0.8 + 0.4 * ((i * 0.618) % 1))));
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });
}

function addCamp(group: Group, at: { x: number; z: number; r: number }, rockDark: MeshLambertMaterial): void {
  const camp = new Group();
  camp.position.set(at.x, 0, at.z);

  const tent = new Mesh(new ConeGeometry(2.1, 2.6, 4), new MeshLambertMaterial({ color: 0xd4c9a8, flatShading: true }));
  tent.position.set(-3.2, 1.3, -0.4);
  tent.rotation.y = Math.PI / 4;
  tent.castShadow = true;
  const post = new Mesh(new CylinderGeometry(0.06, 0.08, 2.2, 6), rockDark);
  post.position.set(2.4, 1.1, 0.2);
  const lamp = new Mesh(new IcosahedronGeometry(0.2, 0), new MeshBasicMaterial({ color: 0xffd98a }));
  lamp.position.set(2.4, 2.3, 0.2);
  const mat = new Mesh(new CircleGeometry(at.r, 20), new MeshLambertMaterial({ color: 0x8c8468 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.02;
  camp.add(tent, post, lamp, mat);
  group.add(camp);
}

/**
 * 動かない地形を、同じ素材ごとに 1 つのメッシュへまとめる（描画回数を減らす）。
 * 素材を 1 つだけ持つ通常のメッシュが対象。地面（userData.noMerge）・段差（複数素材）・InstancedMesh はそのまま残す。
 */
export function mergeStatic(group: Group): void {
  group.updateMatrixWorld(true);
  const buckets = new Map<MeshLambertMaterial | MeshBasicMaterial, Mesh[]>();
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.userData.noMerge === true) return;
    const mat = m.material as MeshLambertMaterial | MeshBasicMaterial;
    if (mat.transparent) return;
    const list = buckets.get(mat) ?? [];
    list.push(m);
    buckets.set(mat, list);
  });
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // 属性を position / normal だけに揃える（形状ごとに uv の有無が違うとまとめられない）。絵を貼る素材（userData.uv）は、uv も残す。
      // 頂点の色を使う素材（岩と岩壁。v0.19.0）は、色も残す
      const keepUv = mat.userData.uv === true;
      const keepColor = (mat as MeshLambertMaterial).vertexColors === true;
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(keepUv && name === 'uv') && !(keepColor && name === 'color')) g.deleteAttribute(name);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const g of geos) g.dispose();
    group.add(mesh);
  }
}

/** 足元の丸い影（影描画を切っている端末でも接地が分かるように）。 */
export function blobShadow(radius: number): Object3D {
  const m = new Mesh(new CircleGeometry(radius, 16), new MeshBasicMaterial({ color: 0x1a211c, transparent: true, opacity: 0.32, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
