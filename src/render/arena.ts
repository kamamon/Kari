// 戦闘区画の見た目。地形の形と寸法はマップデータ（public/data/maps と public/data/fields）が正本で、ここはそれを描くだけ。
// 立体は、箱・板・多面体の簡単な形。その面に、景色の絵（依頼 8。src/render/envArt.ts）を貼る（v0.13.0、docs/spec.md の 21 章）。
// フィールドでは、エリアごとに 1 つの Group を作る（setupSky で空と光を 1 回だけ用意し、buildAreaGroup をエリアの数だけ呼ぶ）。
import {
  type BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Float32BufferAttribute, FogExp2, Group, HemisphereLight, IcosahedronGeometry,
  DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, Quaternion, Scene, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRng } from '../core/seededRng';
import type { ClimbDef, MapDef, PlatformLook } from '../data/schemas';
import { buildClimbFaces } from './climbArt';
import { reliefAt, type ReliefDef } from '../game/relief';
import { groundAt } from '../game/world';
import { ENV_SPRITES, ENV_TILES, SpriteField, boxUv, buildBackdrop, tileMaterial, type EnvPlace, type EnvTile, type SpriteSpot } from './envArt';
import { AreaShape, type Pt } from '../game/areaShape';
import { ROCK_REACH, ledgeGeometry, polyPath, wallPath } from './rockGeo';
import { artCliffGeometry, cliffArtMaterial, mergeRocks, placeBigRock, rockArt, rockArtGeometry, rockArtMaterial, type RockPlacement } from './rockArt';
import { SKY_LOOKS, SUN_DIR, SkyDome } from './sky';
import { patchNoise } from './noise';
import { imageLambert, projectSurfaceUV } from './materialImages';
import { PlatformIndex, buildTerraces, holedGround } from './terraces';
import { buildLandscapeSurface, buildLandscapeExterior, type LandscapeProfile } from './fieldLandscape';
import { baseTone, buildGroundDetail, toneTint, tuftTint, type GroundDetail, type ToneKind } from './groundDetail';
import { applyGroundDetail, setMaskUv } from './groundDetailMaterial';

export const FOG_COLOR = 0xaebcab;
/**
 * 霧の濃さ（v0.19.0 から、距離の 2 乗で濃くなる霧）。10m で 1%、40m で 18%、80m で 55%、150m で 94%。
 * 近い所にも少しかかり、遠い所ほど空気の色に溶ける（それまでは 38〜150m の間で、まっすぐ濃くなる霧）。
 */
export const FOG_DENSITY = 0.0112;
export const VILLAGE_FOG_DENSITY = 0.0076;
// 太陽の向き SUN_DIR は src/render/sky.ts（v0.79.0。崖の向こうの影 = src/render/exteriorShade.ts も、同じ向きを使う）
export { SUN_DIR };

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
  /** 歩ける範囲の外周（v0.20.0。自然な形のエリア）。あれば、岩壁・草・崩れた岩は、これに沿う。無ければ bounds の四角 */
  shape?: Pt[];
  rocks: { x: number; z: number; r: number; h: number }[];
  /**
   * 段差。h が負のもの（v0.31.0。里の下の段と階段）は、地面に穴を開けて、床・擁壁・柵を描く（src/render/terraces.ts）。
   * 里（kind: village）は、v0.35.0 から、どの段差も同じ描き方（5 つの段・階段・沢・吊り橋）
   */
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number; look?: PlatformLook }[];
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
  /** 登攀（v0.44.0）。壁の面に蔦の板を貼る */
  climbs?: readonly ClimbDef[];
  /** 地面の起伏（v0.46.0）。地面の板・崖の根元・草・岩・門柱を、この高さに合わせる */
  relief?: ReliefDef;
  /** 地面の色に掛ける倍率（v0.51.0。フィールドのエリアの look.ground）。無ければ 1 */
  groundTint?: readonly [number, number, number];
  /** 実フィールドだけ: 外側の立体景観。里と旧1区画の描画は従来のまま。 */
  landscape?: LandscapeProfile;
  /** エリアの真ん中（v0.74.0。踏み分け道の集まる所）。無ければ bounds の真ん中 */
  center?: { x: number; z: number };
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
  scene.fog = new FogExp2(FOG_COLOR, place === 'village' ? VILLAGE_FOG_DENSITY : FOG_DENSITY);
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
export const GROUND_GAIN = 1.25;
/** 巣の踏み分け道の色（v0.76.0）: 巣の暗い地面の上では、砂利の絵そのままの明るさだと、光の帯に見えた。暗い土の色へ落とす */
const NEST_TRAIL = 0xbdb39c;
/** 草むら（v0.76.0）: フィールドの草の地面で、短い草と背の高い草の数に掛ける倍率 */
const GRASS_LUSH = 1.3;
/** 踏み分け道（v0.74.0）: 道の濃さがこれより大きい所には、草・小石・茂みを置かない */
const TRAIL_BARE = 0.4;
const ROCK_GAIN = 1.5;
/** 岩の絵を凹凸にも使う時の強さ（envArt.tileMaterial の bump） */
const ROCK_BUMP = 2;

/** エリア 1 つぶんの地形（地面・岩・段差・外周の岩壁・遠くの山・草）。シーンへは呼んだ側が足す。 */
export function buildAreaGroup(map: AreaLook): Group {
  const group = new Group();
  const rng = new SeededRng(map.seed ?? 9001);
  const b = map.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const gates = map.gates ?? [];

  const initial = KIND_LOOK[map.kind ?? 'hunt'];
  const landscape = map.landscape;
  // 地面の作り込み（v0.74.0。フィールドのエリアだけ）: 出口から真ん中へ続く踏み分け道と、崖・岩・段の際の陰
  const detail: GroundDetail | null = landscape && map.kind !== 'village' && gates.some((g) => g.marker === true)
    ? buildGroundDetail({ bounds: b, shape: map.shape, exits: gates.filter((g) => g.marker === true), center: map.center, rocks: map.rocks, platforms: map.platforms, kind: map.kind, seed: map.seed ?? 9001 })
    : null;
  const cover = landscape && landscape.fieldId !== 'field.basin' ? landscape.cover : 1;
  // 草むら（v0.76.0）: 地面の作り込みのあるフィールドの草の地面は、短い草と背の高い草を 1.3 倍に（湿った所へ寄せて生やすので、かたまりが草むらに見える）
  const lush = detail && initial.ground === 'grass' ? GRASS_LUSH : 1;
  const look = {...initial,short:initial.short*cover*lush,tall:initial.tall*cover*lush,dry:initial.dry*cover,flower:initial.flower*cover,bush:initial.bush*cover,branch:initial.branch*cover};
  const noise = patchNoise(map.seed ?? 9001);
  // 色むらの色（v0.76.0）: 盆地の草の地面は、湿った所が濃い緑・乾いた所が明るい黄み。ほかの地面（砂利・巣・ほかの狩場の雪や砂）は、明るさだけを少し
  const toneKind: ToneKind = !(landscape && landscape.fieldId !== 'field.basin') && look.ground === 'grass' ? 'grass' : 'plain';
  /** 地面の頂点の色: 濃淡（暗い所 = 草がかたまる所）と、少しの色み、エリアの色合い（v0.51.0。#19 の F06。データの look.ground。無ければ 1） */
  const groundTint = map.groundTint ?? [1, 1, 1];
  const groundColor = (x: number, z: number): [number, number, number] => {
    const shade = 1 - 0.2 * noise(x, z);
    const warm = (noise(x + 91, z + 53) - 0.5) * 0.14;
    return [shade * (1 + warm) * groundTint[0]!, shade * groundTint[1]!, shade * (1 - warm) * groundTint[2]!];
  };
  // 自然な形のエリア（v0.20.0）: 内か外か・縁までの距離・外向きを、外周から測る
  const outline = map.shape && map.shape.length >= 3 ? new AreaShape(map.shape) : null;
  const inside = (x: number, z: number, margin: number): boolean =>
    outline ? outline.signedDistance(x, z) >= margin : x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;

  // 地面: 絵を、1 枚 = 6m 四方で敷き詰める。同じ絵の並びが目立たないよう、頂点の色で、ゆるい濃淡と色むらを足す
  const village = map.kind === 'village';
  const plats = new PlatformIndex(map.platforms);
  // 里（v0.35.0）: 地面の板は、外周の 1m 外まで（外は霧の谷）。段差の無い所（広場の高さ）だけに敷く
  const margin = village ? 1 : landscape ? 6 : GROUND_MARGIN;
  const gw = w + margin * 2, gd = d + margin * 2;
  /** 外周の内側へ寄せた点 */
  const clampIn = (x: number, z: number): [number, number] => [Math.min(b.maxX - 0.05, Math.max(b.minX + 0.05, x)), Math.min(b.maxZ - 0.05, Math.max(b.minZ + 0.05, z))];
  /** 地面の起伏（v0.46.0。無ければ 0） */
  const rel = (x: number, z: number): number => reliefAt(map.relief, x, z);
  /** 外周の崖の根元の高さ（里は、外周のすぐ内の床。狩場は起伏。v0.45.0 までは 0） */
  const baseAt = village ? (x: number, z: number): number => plats.ground(...clampIn(x, z)) : (x: number, z: number): number => rel(...clampIn(x, z));
  // 0 より低い段差（v0.31.0）があれば、その形の穴を開けた格子にする（無ければ、これまでと同じ板）。里は、どの段差も穴にする
  const sunken = map.platforms.filter((p) => p.h < 0);
  const holes = village ? map.platforms : sunken;
  const exteriorInput = landscape ? {bounds:b,shape:map.shape,relief:map.relief,gates,profile:landscape} : null;
  const exterior = exteriorInput ? buildLandscapeSurface(exteriorInput) : null;
  let groundGeo: BufferGeometry;
  if (holes.length > 0) groundGeo = holedGround(cx, cz, gw, gd, holes, 5, village ? (x, z) => plats.top(...clampIn(x, z)) === null : undefined);
  else if(exterior)groundGeo=exterior.near;
  else {
    // 旧1区画と里。実フィールドの外側は専用景観に分ける。
    const seg = map.relief ? 2 : 5;
    groundGeo = new PlaneGeometry(gw, gd, Math.ceil(gw / seg), Math.ceil(gd / seg));
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(cx, 0, cz);
    if (map.relief) {
      const pos = groundGeo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, rel(pos.getX(i), pos.getZ(i)));
      groundGeo.computeVertexNormals();
    }
  }
  {
    const pos = groundGeo.getAttribute('position');
    const tile = ENV_TILES[look.ground].tile;
    const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      uv[i * 2] = x / tile;
      uv[i * 2 + 1] = -z / tile;
      const c = groundColor(x, z);
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    groundGeo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    groundGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (detail) setMaskUv(groundGeo, detail.mask);
  }
  const regionalFloor = landscape && landscape.fieldId !== 'field.basin';
  const floorMaterial = regionalFloor ? imageLambert(landscape.floor,{color:landscape.floorColor,vertexColors:true},{gain:1.16}) : tileMaterial(look.ground, 0xffffff, { vertexColors: true, gain: GROUND_GAIN });
  if (detail) {
    // 盆地: 道の絵は砂利（地面が砂利のエリアは、里の土）。色は、これまでの出口の踏み跡と同じ明るさ
    // ほかの狩場（地面の絵が狩場ごと）: 道は、地面の絵を暗くしたもの（雪は、踏み固めた青みの灰色。ほかは、土の色へ寄せる）。氷の上には、道を描かない
    const floor = regionalFloor ? landscape.floor : null;
    const mask = floor === null
      ? applyGroundDetail(floorMaterial, detail.mask, look.ground === 'gravel' ? 'earth' : 'gravel', new Color(look.ground === 'gravel' ? 0xcfc6b4 : look.ground === 'nest' ? NEST_TRAIL : 0xffffff).multiplyScalar(GROUND_GAIN), toneKind)
      : applyGroundDetail(floorMaterial, detail.mask, floor === 'frost_ice' ? null : 'self', new Color(floor === 'frost_snow' ? 0xd3dde9 : 0xd2c2a6), toneKind);
    group.userData.groundMask = mask;
  }
  const ground = new Mesh(groundGeo, floorMaterial);
  ground.receiveShadow = true;
  ground.userData.noMerge = true;
  ground.userData.ground = true;
  group.add(ground);
  if(exterior&&exteriorInput){if(groundGeo!==exterior.near)exterior.near.dispose();group.add(buildLandscapeExterior(exteriorInput,exterior));}

  const rockDark = tileMaterial('rock', 0xd2d6ce, { flat: true, gain: ROCK_GAIN });
  const bronze = imageLambert('bronze',{color:0xb08d57,emissive:0x2a1d08,flatShading:true});
  // 段の上の面（v0.76.0）: フィールドでは、まわりの地面と同じ色（頂点の色 = 地面の濃淡・エリアの色合い・色むら。明るさも地面と同じ）。
  // それまでは、色合いも濃淡も無い明るい緑の四角で、上から見ると、置いた板に見えた。フィールドでない所（これまでの 1 つの狩場）は、これまでどおり
  const stepTop = detail
    ? (regionalFloor ? imageLambert(landscape.floor,{color:landscape.floorColor,vertexColors:true},{gain:1.16}) : tileMaterial(look.ground, 0xffffff, { vertexColors: true, gain: GROUND_GAIN }))
    : (regionalFloor ? imageLambert(landscape.floor,{color:landscape.floorColor},{gain:1.10}) : tileMaterial(look.ground, 0xffffff, { gain: GROUND_GAIN * 0.95 }));
  const moss = map.kind === 'nest' ? 0.15 : map.kind === 'path' ? 0.35 : map.kind === 'village' ? 0.5 : 0.65;
  // 段差の横の面と、崖の上の縁から外へ下る背（岩肌の絵と、頂点の色）。苔の多いエリア（野営地・狩り）は、苔の溜まった岩肌（依頼 10 の T-04）
  const sideTile = moss >= 0.6 ? 'moss' : 'rock';
  const boulderMat = tileMaterial(sideTile, 0xffffff, { vertexColors: true, gain: ROCK_GAIN * 1.12, bump: ROCK_BUMP });
  const capMat = tileMaterial(sideTile, 0xf4f1ea, { vertexColors: true, gain: ROCK_GAIN * 1.15, bump: ROCK_BUMP });

  // 岩（円柱として衝突する）。v0.22.0: 依頼 10 の岩の図から作った形（src/render/rockArt.ts）。当たりの半径に合わせて、
  // 根元のいちばん外が半径の ROCK_REACH 倍に来るように伸ばす。地面に埋まった、低くどっしりした岩。エリアの岩は 1 つの形にまとめる（描画 1 回）
  const placed: RockPlacement[] = [];
  // 起伏の上の岩（v0.46.0）は、根元のいちばん低い所の高さに置く（坂の下の側が浮かない。上の側は埋まる）
  const rockBase = (r: { x: number; z: number; r: number }): number => {
    if (!map.relief) return 0;
    let lo = rel(r.x, r.z);
    for (let k = 0; k < 8; k++) lo = Math.min(lo, rel(r.x + Math.cos((k * Math.PI) / 4) * r.r, r.z + Math.sin((k * Math.PI) / 4) * r.r));
    return lo;
  };
  for (const r of map.drawRocks === false ? [] : map.rocks) placed.push({ ...placeBigRock(rng, r, ROCK_REACH), y: rockBase(r) });
  if (placed.length) {
    const rocks = new Mesh(mergeRocks(placed), landscape?.fieldId==='field.whitefrost' ? imageLambert('frost_ice',{color:0xa6bfd3,vertexColors:true},{gain:1.06}) : rockArtMaterial());
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.userData.noMerge = true;
    rocks.userData.rockArt = placed.map((p) => p.id);
    group.add(rocks);
  }

  // 段差（v0.20.0: 角の丸い岩の棚。上は、その場所の地面。横は岩肌で、下ほど外へ広がって地面に入る）。里は terraces が描く
  for (const p of map.platforms) {
    if (p.h < 0 || village) continue;
    const ledgeGeo = ledgeGeometry(rng, p, ENV_TILES[look.ground].tile, ENV_TILES.rock.tile);
    if (detail) {
      // 上の面の頂点へ、その場所の地面の色（色むらは、段の際の陰を入れない値。段の上は陰にならない）
      const lp = ledgeGeo.getAttribute('position'), lc = ledgeGeo.getAttribute('color'), li = ledgeGeo.getIndex()!, top = ledgeGeo.groups[0]!;
      for (let i = top.start; i < top.start + top.count; i++) {
        const v = li.getX(i), x = lp.getX(v), z = lp.getZ(v);
        const c = groundColor(x, z), t = toneTint(toneKind, baseTone(noise(x, z)));
        lc.setXYZ(v, c[0] * t[0], c[1] * t[1], c[2] * t[2]);
      }
    }
    const ledge = new Mesh(ledgeGeo, [stepTop, boulderMat]);
    ledge.castShadow = true;
    ledge.receiveShadow = true;
    group.add(ledge);
  }
  // 登れる壁の蔦（v0.44.0。仮の見た目）
  if (map.climbs?.length) group.add(buildClimbFaces(map.climbs, (x, z) => groundAt(map.platforms, x, z)));
  // 0 より低い段差（v0.31.0。里の下の段と階段）: 床・擁壁・柵。里（v0.35.0）は、5 つの段・階段・沢・吊り橋のすべて
  if (village) group.add(buildTerraces(map.platforms, GROUND_GAIN, b));
  else if (sunken.length > 0) group.add(buildTerraces(sunken, GROUND_GAIN));

  // 外周の崖（v0.22.0）: 依頼 10 の崖の図（横 24m）を、外周の外 0.5m の道に沿って並べる。出口のわきは C-19・C-20 で、出口の前は開く。
  // 上の縁から外へ下る背は、岩肌の絵（見た目のみ。衝突は外周で止まり、出口は simulation が扱う）
  const wallH = map.wallHeight ?? (landscape?[landscape.wall,5.5]:[5,5.5]);
  const low = wallH[0] < 3.6;
  const cliff = artCliffGeometry({
    path: wallPath(b, outline?.points() ?? null, 0.5, 0.5), gates, vk: low ? wallH[0] / 3.0 : Math.min(1.25, Math.max(0.85, wallH[0] / 4.6)),
    low, nest: map.kind === 'nest', moss, baseAt: village || map.relief ? baseAt : undefined,
    // 崖の向こうの景色（フィールド）があれば、背は、その地面の下まで下る（v0.81.0。D-181）
    outerAt: exterior?.height,
    // 外周に沿って高さを変える（v0.50.0。#19 の F06）。段のある里は、段の擁壁とそろえるので変えない
    vary: village ? 0 : low ? 0.12 : 0.26,
  }, rng);
  const face = new Mesh(cliff.face, landscape?.fieldId==='field.whitefrost' ? imageLambert('frost_ice',{color:0x9ab9cf,vertexColors:true},{gain:1.08}) : cliffArtMaterial());
  face.castShadow = true;
  face.receiveShadow = true;
  face.userData.noMerge = true;
  face.userData.cliffArt = cliff.pieces.map((p) => p.id);
  const back = new Mesh(cliff.cap, landscape?.fieldId==='field.whitefrost' ? imageLambert('frost_snow',{color:0xe0ebf4,vertexColors:true},{gain:1.04}) : capMat);
  back.receiveShadow = true;
  // 崖の背（v0.81.0。D-181）: 崖の向こうの地面がある所（フィールド）では、その地面の下まで下る。検査が、名前と印で確かめる
  back.name = 'cliff-back';
  back.userData.grounded = !!exterior;
  group.add(face, back);
  // 崖の根元の崩れた岩（歩ける範囲の外）と、大きな岩のまわりの小石（足首より低い）。どちらも依頼 10 の小さな岩の図
  addRubble(group, rng, b, outline, gates, map.drawRocks === false ? [] : map.rocks, map.kind === 'village' ? 0.35 : 1, baseAt);

  // 出口の目印: 踏み跡（明るい地面）と、両脇の門柱。柱の頭は青銅色
  const trail = tileMaterial('gravel', map.kind === 'path' ? 0xdcd6c8 : 0xffffff, { gain: GROUND_GAIN });
  /** 出口の外向き（自然な形なら、いちばん近い縁の外向き。四角なら、近い辺の外向き） */
  const outward = (g: { x: number; z: number }): [number, number] => {
    if (outline) {
      const o = outline.outwardAt(g.x, g.z);
      return [o.x, o.z];
    }
    const ox = Math.abs(g.x - b.minX) < 5 ? -1 : Math.abs(g.x - b.maxX) < 5 ? 1 : 0;
    return [ox, ox !== 0 ? 0 : g.z < cz ? -1 : 1];
  };
  for (const g of gates) {
    if (!g.marker) continue;
    const [ox, oz] = outward(g);
    // 踏み跡: 出口から内へ、外向きに沿った細長い帯（v0.74.0 から、フィールドでは地面に混ぜた踏み分け道が代わりになる。板は置かない）
    const gy = baseAt(g.x, g.z);
    const path = new Mesh(new PlaneGeometry(5.4, 16, 3, exterior ? 18 : 8), trail);
    if(exterior){
      // 奥へ続く道の入口を長方形ではなく、両端と路肩を不規則に絞る。
      const pp=path.geometry.getAttribute('position');
      for(let i=0;i<pp.count;i++){
        const y=pp.getY(i),u=(y+8)/16,t=Math.min(1,Math.max(0,u*4));
        const width=(.24+.76*t*t*(3-2*t))*(.94+.065*Math.sin(y*1.63+g.x));
        pp.setX(i,pp.getX(i)*width+.27*Math.sin(y*.45+g.z)*Math.sin(Math.PI*u));
      }
    }
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = Math.atan2(ox, oz) + Math.PI;
    path.position.set(g.x - ox * 3, gy + 0.015, g.z - oz * 3);
    path.receiveShadow = true;
    // 起伏に沿わせる（v0.46.0）: 板の面の向き（ローカルの z）が、世界の上
    if (map.relief || exterior) {
      path.updateMatrix();
      const pp = path.geometry.getAttribute('position');
      const v = new Vector3();
      for (let i = 0; i < pp.count; i++) {
        v.set(pp.getX(i), pp.getY(i), 0).applyMatrix4(path.matrix);
        pp.setZ(i, (exterior ? exterior.height(v.x,v.z) : rel(v.x, v.z)) - gy);
      }
    }
    boxUv(path, ENV_TILES.gravel.tile);
    path.name = 'gateTrail';
    if (detail) path.geometry.dispose();
    else group.add(path);
    for (const s of [-1, 1]) {
      const px = g.x + ox * 2.3 - oz * s * 3.1, pz = g.z + oz * 2.3 + ox * s * 3.1;
      const post = new Mesh(new CylinderGeometry(0.42, 0.6, 3.4, 6), rockDark);
      post.position.set(px, gy + 1.7, pz);
      post.castShadow = true;
      const cap = new Mesh(new ConeGeometry(0.5, 0.7, 6), bronze);
      cap.position.set(px, gy + 3.75, pz);
      group.add(post, cap);
    }
  }

  // 遠くの山は、空と一緒に貼った絵（setupSky の backdrop）。ここでは作らない

  // 巣: 壁ぎわに、晶の柱が立つ
  if (map.kind === 'nest') {
    const crystal = imageLambert('crystal',{color:landscape?.fieldId==='field.whitefrost'?0x96d6ff:0xc9a86a,emissive:landscape?.fieldId==='field.whitefrost'?0x153959:0x5a3c12,flatShading:true});
    const rim = outline ? polyPath(outline.points(), 0, 1) : null;
    for (let i = 0; i < 26; i++) {
      let x: number, z: number;
      if (rim) {
        // 外周の内側 0.6〜2.8m
        const q = rim[Math.floor(rng.next() * rim.length)]!;
        const inn = 0.6 + rng.next() * 2.2;
        x = q.x - q.nx * inn;
        z = q.z - q.nz * inn;
      } else {
        const side = i % 4;
        const t = rng.next();
        x = side < 2 ? b.minX + t * w : side === 2 ? b.minX + 0.6 + rng.next() * 2.2 : b.maxX - 0.6 - rng.next() * 2.2;
        z = side === 0 ? b.minZ + 0.6 + rng.next() * 2.2 : side === 1 ? b.maxZ - 0.6 - rng.next() * 2.2 : b.minZ + t * d;
      }
      if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 7)) continue;
      const h = 1.4 + rng.next() * 3.2;
      const c = new Mesh(new ConeGeometry(0.28 + rng.next() * 0.3, h, 5), crystal);
      c.position.set(x, rel(x, z) + h / 2 - 0.1, z);
      c.rotation.set((rng.next() - 0.5) * 0.5, rng.next() * 6, (rng.next() - 0.5) * 0.5);
      group.add(c);
    }
  }

  // キャンプ: 天幕と灯
  if (map.camp) addCamp(group, map.camp, rockDark);

  // 草と小物: 切り抜きの絵を貼った板を立てる（種類ごとに 1 回の描画）。濃淡に合わせて、かたまって生える
  const clear = map.clear ?? [];
  // 埋まった岩（v0.20.0）は、根元まで草が生える（岩の半径の 0.85 倍まで寄る。地面との境が、草に隠れる）
  /** 里の段（v0.35.0）: 草地と土の床の上なら、その高さ（縁から 0.5m 以内と、石段・水・橋・岩の床は null）。段差の無い所は 0 */
  const tierY = (x: number, z: number): number | null => {
    const p = plats.top(x, z);
    if (!p) return map.platforms.some((q) => x > q.minX - 0.4 && x < q.maxX + 0.4 && z > q.minZ - 0.4 && z < q.maxZ + 0.4) ? null : 0;
    if (p.look !== 'grass' && p.look !== 'yard') return null;
    for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) if (plats.ground(x + dx, z + dz) !== p.h) return null;
    return p.h;
  };
  const blocked = (x: number, z: number): boolean =>
    !inside(x, z, 0.3) ||
    map.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < (map.drawRocks === false ? r.r + 0.35 : r.r * 0.85)) ||
    (village ? tierY(x, z) === null : map.platforms.some((p) => x > p.minX - 0.3 && x < p.maxX + 0.3 && z > p.minZ - 0.3 && z < p.maxZ + 0.3)) ||
    clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r) ||
    (detail !== null && detail.trailAt(x, z) > TRAIL_BARE) ||
    gates.some((g) => {
      if (g.marker !== true || detail) return false;
      // 踏み跡の帯（出口から内へ 11m、幅 6.4m）
      const [ox, oz] = outward(g);
      const along = -((x - g.x) * ox + (z - g.z) * oz), side = Math.abs((x - g.x) * oz - (z - g.z) * ox);
      return along > -3 && along < 11 && side < 3.2;
    }) ||
    (map.camp != null && Math.hypot(x - map.camp.x, z - map.camp.z) < map.camp.r);
  /**
   * 濃い所（clump = 1）か、どこでも（clump = 0）か。置けなければ null。
   * likes（v0.76.0。地面の作り込みのあるフィールドだけ）: 正なら湿った所（色むらの濃い側）に多く、負なら乾いた所に多い。
   * 返す tint は、その場所の地面の色むらと際の陰（草が、まわりの地面と同じ明るさ・色みになる）。
   */
  const spot = (clump: number, likes = 0) => (): SpriteSpot | null => {
    for (let tries = 0; tries < 8; tries++) {
      const x = b.minX + 0.4 + rng.next() * (w - 0.8);
      const z = b.minZ + 0.4 + rng.next() * (d - 0.8);
      if (blocked(x, z)) continue;
      if (clump > 0 && rng.next() > 1 - clump + clump * Math.min(1, noise(x, z) * 1.7)) continue;
      const y = village ? groundAt(map.platforms, x, z) : rel(x, z);
      if (!detail) return { x, z, y };
      const tone = detail.toneAt(x, z);
      if (likes !== 0 && rng.next() < (likes > 0 ? tone : 1 - tone) * Math.abs(likes)) continue;
      return { x, z, y, tint: tuftTint(toneKind, tone, detail.shadeAt(x, z)) };
    }
    return null;
  };
  // 数は、歩ける広さから（自然な形のエリアは、囲む四角より狭い）
  const area = outline ? outline.area() : w * d;
  const count = (perM2: number, max: number): number => Math.min(max, Math.round(perM2 * area));
  const field = new SpriteField(group, rng);
  const G = ENV_SPRITES.grass, P = ENV_SPRITES.props;
  field.scatter(G, G.cells.short, count(look.short, 2600), spot(0.75, 0.7), [0.8, 1.25], 0.12);
  field.scatter(G, G.cells.tall, count(look.tall, 700), spot(0.9, 0.85), [0.8, 1.3], 0.12);
  field.scatter(G, G.cells.dry, count(look.dry, 520), spot(0.5, -0.8), [0.8, 1.25], 0.1);
  field.scatter(G, G.cells.flower, count(look.flower, 260), spot(0.8, 0.5), [0.8, 1.25], 0.08);
  field.scatter(P, P.cells.stones, count(look.stones, 220), spot(0), [0.8, 1.25], 0.1);
  field.scatter(P, P.cells.bush, count(look.bush, 70), spot(0.4, 0.6), [0.8, 1.5], 0.1);
  field.scatter(P, P.cells.crystal, count(look.crystal, 120), spot(0), [0.7, 1.6]);
  field.scatter(P, P.cells.branch, count(look.branch, 60), spot(0), [0.8, 1.4]);
  // 里（v0.35.0）: 高い石積みの根元に、草と茂み（壁から 0.3〜0.9m。歩ける床の上だけ）
  if (village) {
    const bases = (group.getObjectByName('terraces')?.children.find((m) => m.userData.terrace === 'wall')?.userData.bases ?? []) as { ax: number; az: number; bx: number; bz: number; lo: number; nx: number; nz: number }[];
    const total = bases.reduce((a, w) => a + Math.hypot(w.bx - w.ax, w.bz - w.az), 0);
    const atBase = (): { x: number; z: number; y: number } | null => {
      for (let tries = 0; tries < 6; tries++) {
        let t = rng.next() * total;
        for (const w of bases) {
          const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
          if (t > len) {
            t -= len;
            continue;
          }
          const off = 0.3 + rng.next() * 0.6;
          const x = w.ax + ((w.bx - w.ax) * t) / len + w.nx * off, z = w.az + ((w.bz - w.az) * t) / len + w.nz * off;
          const y = tierY(x, z);
          if (y === null || Math.abs(y - w.lo) > 0.01 || !inside(x, z, 0.3) || clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) break;
          if (map.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 0.2)) break;
          return { x, z, y };
        }
      }
      return null;
    };
    field.scatter(G, G.cells.tall, Math.round(total / 2.2), atBase, [0.9, 1.4], 0.12);
    field.scatter(P, P.cells.bush, Math.round(total / 7), atBase, [0.9, 1.5], 0.1);
  }

  mergeStatic(group);
  return group;
}

/**
 * 崩れた岩（v0.22.0。依頼 10 の岩の図。描画は図の種類の数）:
 * 崖の根元（歩ける範囲の外、0.3〜1.6m）には 0.4〜1.3m の岩（R-03・R-04・R-05・R-07・R-11 を縮めて）、
 * 大きな岩のまわりには 0.12〜0.3m の小石（R-01〜R-04。歩ける範囲の中。足首より低い）。
 */
const RUBBLE_RIM = ['R-03', 'R-04', 'R-05', 'R-07', 'R-11'];
const RUBBLE_PEBBLE = ['R-01', 'R-02', 'R-03', 'R-04'];

function addRubble(group: Group, rng: SeededRng, b: AreaLook['bounds'], outline: AreaShape | null, gates: { x: number; z: number }[], rocks: AreaLook['rocks'], amount: number, baseAt: (x: number, z: number) => number): void {
  const lists = new Map<string, { x: number; z: number; s: number; h: number; yaw: number; y?: number }[]>();
  const add = (id: string, p: { x: number; z: number; s: number; h: number; yaw: number; y?: number }): void => {
    const l = lists.get(id) ?? [];
    l.push(p);
    lists.set(id, l);
  };
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const nearGate = (x: number, z: number): boolean => gates.some((g) => Math.hypot(g.x - x, g.z - z) < 9);
  // 崖の根元: 周りの長さ 4m ごとに 1 つくらい（自然な形なら、外周に沿って）
  const rim = outline ? polyPath(outline.points(), 0, 1) : null;
  const perim = rim ? rim.length : 2 * (w + d);
  const n1 = Math.round((perim / 4) * amount);
  for (let i = 0; i < n1; i++) {
    const t = rng.next() * perim;
    let x: number, z: number, nx: number, nz: number;
    if (rim) {
      const q = rim[Math.min(rim.length - 1, Math.floor(t))]!;
      [x, z, nx, nz] = [q.x, q.z, q.nx, q.nz];
    } else if (t < w) [x, z, nx, nz] = [b.minX + t, b.minZ, 0, -1];
    else if (t < w + d) [x, z, nx, nz] = [b.maxX, b.minZ + (t - w), 1, 0];
    else if (t < 2 * w + d) [x, z, nx, nz] = [b.maxX - (t - w - d), b.maxZ, 0, 1];
    else [x, z, nx, nz] = [b.minX, b.maxZ - (t - 2 * w - d), -1, 0];
    if (nearGate(x, z)) continue;
    const s = 0.4 + rng.next() * 0.9;
    const out = 0.3 + s * 0.6 + rng.next() * 0.6;
    add(RUBBLE_RIM[Math.floor(rng.next() * RUBBLE_RIM.length)]!, { x: x + nx * out, z: z + nz * out, s, h: s * (0.8 + rng.next() * 0.4), yaw: rng.next() * 6.28, y: baseAt(x, z) });
  }
  // 大きな岩のまわりの小石
  for (const r of rocks) {
    const cnt = Math.round((3 + rng.next() * 4) * amount);
    for (let i = 0; i < cnt; i++) {
      const a = rng.next() * 6.28;
      const dist = r.r + 0.2 + rng.next() * 1.4;
      const x = r.x + Math.cos(a) * dist, z = r.z + Math.sin(a) * dist;
      if ((outline ? outline.signedDistance(x, z) < 0.3 : x < b.minX + 0.3 || x > b.maxX - 0.3 || z < b.minZ + 0.3 || z > b.maxZ - 0.3) || nearGate(x, z)) continue;
      const s = 0.12 + rng.next() * 0.18;
      add(RUBBLE_PEBBLE[Math.floor(rng.next() * RUBBLE_PEBBLE.length)]!, { x, z, s, h: s * (0.8 + rng.next() * 0.4), yaw: rng.next() * 6.28 });
    }
  }
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), at = new Vector3(), sc = new Vector3();
  const mat = rockArtMaterial();
  for (const [id, list] of lists) {
    const a = rockArt(id);
    // 大きさ s は、根元の幅（図の幅と奥行の大きい方）。高さは、図の比のまま（h で少しだけ変える）
    const span = Math.max(a.w, a.d);
    const im = new InstancedMesh(rockArtGeometry(a, 0), mat, list.length);
    list.forEach((p, i) => {
      const k = p.s / span;
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(at.set(p.x, (p.y ?? 0) - 0.02, p.z), q, sc.set(k, k * (p.h / p.s), k));
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    // 小さな岩は影を落とさない（数が多く、影の描画で三角形が倍になる。崖の根元は崖の影の中）
    im.castShadow = false;
    im.receiveShadow = true;
    im.userData.noMerge = true;
    group.add(im);
  }
}

function addCamp(group: Group, at: { x: number; z: number; r: number }, rockDark: MeshLambertMaterial): void {
  const camp = new Group();
  camp.position.set(at.x, 0, at.z);

  const tent = new Mesh(new ConeGeometry(2.1, 2.6, 4), imageLambert('cloth',{color:0xd4c9a8,flatShading:true},{bump:.02}));
  tent.position.set(-3.2, 1.3, -0.4);
  tent.rotation.y = Math.PI / 4;
  tent.castShadow = true;
  const post=new Mesh(new CylinderGeometry(.06,.08,2.2,6),imageLambert('wood',{color:0x6a5035}));
  post.position.set(2.4, 1.1, 0.2);
  const lamp = new Mesh(new IcosahedronGeometry(0.2, 0), new MeshBasicMaterial({ color: 0xffd98a }));
  lamp.position.set(2.4, 2.3, 0.2);
  const mat = new Mesh(new CircleGeometry(at.r, 20), imageLambert('earth',{color:0x8c8468},{bump:.025}));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.02;
  camp.add(tent, post, lamp, mat);
  // 帰る目印（v0.48.0。#19 の 04「石積みと高い帆布を帰還の目印にする」。仮の形）: 6m の竿に下げた帆布と、根元の石積み
  const pole=new Mesh(new CylinderGeometry(.08,.11,6.4,6),imageLambert('wood',{color:0x6a5035}));
  // 天幕の奥（出発地点・出口の通り道から外す。当たりは持たない）
  pole.position.set(-5.6, 3.2, 2.0);
  pole.castShadow = true;
  const cloth = new Mesh(new PlaneGeometry(1.3, 2.4, 1, 3), imageLambert('cloth',{color:0xb8643a,side:DoubleSide}));
  cloth.position.set(-4.92, 4.9, 2.0);
  cloth.rotation.y = 0.35;
  cloth.castShadow = true;
  cloth.userData.campBanner = true;
  camp.add(pole, cloth);
  for (const [s, y, dx, dz] of [[0.62, 0.3, 0, 0], [0.48, 0.78, 0.08, -0.05], [0.34, 1.15, -0.04, 0.06], [0.22, 1.42, 0.02, 0]] as const) {
    const stone = new Mesh(new IcosahedronGeometry(s, 0), rockDark);
    stone.scale.set(1, 0.62, 1);
    stone.position.set(-4.9 + dx, y, 2.9 + dz);
    stone.castShadow = true;
    camp.add(stone);
  }
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
