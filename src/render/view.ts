// 描画のまとめ役。simulation の状態を読んで、仮モデル・カメラ・エフェクト・検証表示を更新する。
// ここから simulation へ値を書き戻すことはしない（描画補間や骨の姿勢を計算の正本にしない）。
import { CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Quaternion, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer, type Object3D } from 'three';
import { angleDiff, fromArr, lerpV, norm, smoothstep, toWorld, type V3 } from '../core/math';
import { STATUS_KINDS, type Content, type ElementId, type MonsterDef, type StatusKind } from '../data/schemas';
import { inWindow, renderTick } from '../game/action';
import type { SimEvent } from '../game/events';
import { monsterBlockers, monsterShapes, type MonsterState } from '../game/monster';
import { CLIMB_DOWN_TICKS, CLIMB_EXIT_TICKS, CLIMB_MOUNT_TICKS, VAULT_TICKS, familyOf, isGuarding, playerHurtCapsule } from '../game/player';
import type { Simulation } from '../game/sim';
import { sampleTrack, sampleTrackNormal, trackSegment } from '../game/tracks';
import type { Settings } from '../save/settings';
import { blobShadow, buildArena, buildAreaGroup, setupSky, type Arena } from './arena';
import { WIND } from './envArt';
import { buildHubGroup } from './hubScene';
import type { Ambience, Village } from './villageScene';
import { buildNpcSprites, updateNpcSprites } from './npcSprites';
import { buildErrandProps, updateErrandProps, type ErrandProps } from './errandProps';
import { FollowCamera } from './camera';
import { DebugDraw } from './debugDraw';
import { BladeTrail, GroundRings, Particles } from './effects';
import { GaldrosRig } from './galdrosRig';
import { CreatureRig } from './creatureRig';
import type { HazardLook } from '../data/schemas';
import { CREATURE_PLANS } from './creaturePlans';
import { DummyRig, type MonsterRig } from './monsterRig';
import { blendPose, climbPose, clipPose, deadPose, dropPose, emptyPose, guardPose, hurtPose, landPose, locomotionPose, vaultPose, type BodyPose } from './poses';
import { HunterAnimator, applySolved, canSolve, playerContactFrame, playerRenderTick, stowOffhand, type AnimState } from './hunterAnim';
import type { Solved } from './bodySolve';
import { GroundedLocomotion, freeStride } from './contactLocomotion';
import { groundedHeavyAttack } from './heavyBodyMotion';
import { WEAPON_STANCES } from './weaponClipSpecs';
import { buildArrow } from './bow';
import { armorTierOf, type ArmorLook } from './hunterArmor';
import { HunterRig, type HandsSpec } from './rig';

type WeaponPlace = { mode: 'back' } | { mode: 'hand' } | { mode: 'track'; grip: V3; dir: V3; normal: readonly number[] };

const PART_COLORS: Record<string, [number, number, number]> = {
  head: [1, 0.55, 0.2],
  tail: [0.8, 0.5, 1],
  back: [1, 0.9, 0.3],
  legs: [0.5, 1, 0.5],
  body: [0.45, 0.7, 1],
};
/** 技が替わった時に、武器の位置と向きを混ぜる時間（秒。v0.40.0） */
const WEAPON_BLEND_SEC = 0.1;
const v3From = (v: Vector3): V3 => ({ x: v.x, y: v.y, z: v.z });
const basisM = new Matrix4();
/** 武器の向き（+Y = dir、+X = normal を dir に直交させたもの。HunterRig の置き方と同じ）を、回転にする */
function weaponQuat(dir: V3, normal: readonly number[]): Quaternion {
  const y = new Vector3(dir.x, dir.y, dir.z).normalize();
  const x = new Vector3(normal[0], normal[1], normal[2]);
  x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0).addScaledVector(y, -y.x);
  x.normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(basisM.makeBasis(x, y, z));
}
/** 研磨石で研ぐ時の動きの名前と、武器を渡す位置（アクターのローカル座標。片ひざを突いた時の、ひざの前） */
const WHET_CLIP = 'common_item_whet_01';
const WHET_HOLD = { grip: { x: -0.2, y: 0.74, z: 0.28 }, dir: norm({ x: 0.9, y: -0.08, z: 0.42 }), normal: [0, 1, 0] as [number, number, number] };
const MATERIAL_SPARK: Record<string, [number, number, number]> = { rock: [1, 0.8, 0.45], shell: [0.9, 0.85, 0.6], hide: [0.95, 0.9, 0.8] };
/** 武器の属性が乗った命中の火花の色（v0.33.0。見た目だけ） */
const ELEMENT_SPARK: Record<ElementId, [number, number, number]> = {
  fire: [1, 0.5, 0.2],
  thunder: [1, 0.95, 0.4],
  ice: [0.72, 0.92, 1],
  water: [0.4, 0.68, 1],
  wind: [0.78, 1, 0.78],
  mist: [0.78, 0.95, 0.9],
};
/** モンスターの状態異常の粉の色（v0.33.0）: 毒は紫の泡、麻痺は黄色の火花、睡眠は淡い青、気絶は頭の上の星 */
const AILMENT_FX: Record<StatusKind, [number, number, number]> = { poison: [0.62, 0.36, 0.72], para: [1, 0.92, 0.35], sleep: [0.72, 0.82, 1], stun: [1, 0.95, 0.62] };

/** ロックオンの照準を置く所（モンスターの座標。部位の当たり形状の端の平均）。種ごとに 1 回だけ求める */
const lockCenters = new WeakMap<MonsterDef, { x: number; y: number; z: number }>();
function lockCenter(def: MonsterDef): { x: number; y: number; z: number } {
  let c = lockCenters.get(def);
  if (c) return c;
  let x = 0, y = 0, z = 0, n = 0;
  for (const part of def.parts) {
    for (const s of part.shapes) {
      for (const q of s.b ? [s.a, s.b] : [s.a]) {
        x += q[0];
        y += q[1];
        z += q[2];
        n++;
      }
    }
  }
  c = n > 0 ? { x: x / n, y: y / n, z: z / n } : { x: 0, y: 1, z: 0 };
  lockCenters.set(def, c);
  return c;
}

/** 飛び道具の種類ごとの色: 予告の輪、飛ぶ物、光、当たった時の粉と火花 */
const HAZARD_COLORS: Record<HazardLook, { ring: number; ball: number; glow: number; dust: [number, number, number]; spark: [number, number, number] }> = {
  rock: { ring: 0xff7a3a, ball: 0x80847a, glow: 0, dust: [0.6, 0.6, 0.55], spark: [0.9, 0.85, 0.7] },
  mud: { ring: 0xc08040, ball: 0x5a4028, glow: 0, dust: [0.42, 0.32, 0.22], spark: [0.55, 0.42, 0.3] },
  spark: { ring: 0xfff060, ball: 0xfff4a0, glow: 0xfff080, dust: [0.75, 0.75, 0.55], spark: [1, 0.96, 0.5] },
  ice: { ring: 0x9fd8ff, ball: 0xcdeeff, glow: 0x3a6a88, dust: [0.82, 0.9, 0.96], spark: [0.85, 0.95, 1] },
  mist: { ring: 0xa8e8d0, ball: 0xd8f4ea, glow: 0x5aa890, dust: [0.82, 0.92, 0.88], spark: [0.8, 1, 0.9] },
  poison: { ring: 0xc070e0, ball: 0x8a3aa8, glow: 0x401050, dust: [0.55, 0.32, 0.62], spark: [0.75, 0.45, 0.85] },
  para: { ring: 0xd8e040, ball: 0xb8c030, glow: 0x505810, dust: [0.75, 0.75, 0.35], spark: [0.95, 0.95, 0.45] },
  ash: { ring: 0xc0c0b8, ball: 0x9a9a92, glow: 0, dust: [0.66, 0.66, 0.62], spark: [0.8, 0.8, 0.76] },
};

/**
 * 大型 11 種と幼体の吹き出し（技データの vfx の id）。rear = 尾の側から後ろへ、around = 体のまわりへ輪に（v0.21.0）。
 * 見た目だけ（判定は技データの軌道と落下物）。
 */
const CREATURE_VFX: Record<string, { count: number; speed: number; spread: number; life: number; color: [number, number, number]; bursts?: number; rings?: number; ringColor?: number; rear?: boolean; around?: boolean; dirY?: number; y?: number }> = {
  gust: { count: 34, speed: 9, spread: 3.5, life: 0.7, color: [0.86, 0.88, 0.8], bursts: 2 },
  sound_wave: { count: 18, speed: 7, spread: 2.5, life: 0.6, color: [0.85, 0.6, 0.38], rings: 3, ringColor: 0xf0b070 },
  ash_cloud: { count: 44, speed: 4.5, spread: 5, life: 1.6, color: [0.62, 0.62, 0.6], bursts: 2, dirY: 0.05 },
  mud_splash: { count: 30, speed: 5, spread: 4, life: 0.8, color: [0.42, 0.32, 0.22], dirY: 0.3, y: 0.4 },
  poison_threads: { count: 34, speed: 4, spread: 4.5, life: 1.4, color: [0.62, 0.42, 0.7], rear: true, y: 0.5, dirY: 0 },
  // v0.21.0: 体のまわり・後ろ・前への吹き出し
  wind_ring: { count: 12, speed: 8, spread: 1.6, life: 0.7, color: [0.86, 0.88, 0.8], around: true, rings: 2, ringColor: 0xe6eadc, y: 0.9 },
  sound_ring: { count: 8, speed: 6, spread: 1.2, life: 0.6, color: [0.85, 0.6, 0.38], around: true, rings: 3, ringColor: 0xf0b070, y: 1.0 },
  ash_ring: { count: 14, speed: 3.5, spread: 2.5, life: 1.8, color: [0.62, 0.62, 0.6], around: true, y: 1.0, dirY: 0.05 },
  spark_ring: { count: 10, speed: 7, spread: 1.5, life: 0.5, color: [0.95, 0.95, 0.45], around: true, rings: 2, ringColor: 0xf5f090, y: 0.6 },
  quake_ring: { count: 10, speed: 5, spread: 1.4, life: 0.8, color: [0.6, 0.58, 0.5], around: true, rings: 3, ringColor: 0xe9e2c8, y: 0.3, dirY: 0.25 },
  dust_ring: { count: 8, speed: 3.5, spread: 1.2, life: 0.8, color: [0.62, 0.62, 0.55], around: true, rings: 1, ringColor: 0xe9e2c8, y: 0.2, dirY: 0.2 },
  ice_ring: { count: 12, speed: 6, spread: 1.8, life: 0.9, color: [0.82, 0.92, 1.0], around: true, rings: 2, ringColor: 0xd8ecff, y: 0.6, dirY: 0.35 },
  glass_burst: { count: 12, speed: 5, spread: 2.4, life: 1.0, color: [0.8, 0.9, 0.95], around: true, y: 2.2, dirY: 0.7 },
  poison_cloud: { count: 14, speed: 2.5, spread: 2.4, life: 2.0, color: [0.62, 0.42, 0.7], around: true, y: 0.7, dirY: 0.05 },
  mist_gather: { count: 10, speed: -2.5, spread: 1.4, life: 0.9, color: [0.7, 0.95, 0.9], around: true, y: 1.6, dirY: 0 },
  mist_burst: { count: 16, speed: 5, spread: 2.6, life: 1.6, color: [0.7, 0.95, 0.9], around: true, rings: 2, ringColor: 0xc8f2e8, y: 1.0, dirY: 0.1 },
  mud_rear: { count: 26, speed: 4.5, spread: 3.5, life: 0.8, color: [0.42, 0.32, 0.22], rear: true, y: 0.4, dirY: 0.35 },
  mud_up: { count: 36, speed: 6, spread: 2.5, life: 1.2, color: [0.42, 0.32, 0.22], y: 2.5, dirY: 2.5 },
  spark_rear: { count: 24, speed: 6, spread: 3, life: 0.5, color: [0.95, 0.95, 0.45], rear: true, y: 0.4, dirY: 0.1 },
  water_jet: { count: 40, speed: 13, spread: 1.0, life: 0.6, color: [0.6, 0.7, 0.8], bursts: 3, dirY: -0.08 },
  frost_breath: { count: 40, speed: 8, spread: 2.2, life: 1.0, color: [0.86, 0.95, 1.0], bursts: 3, dirY: -0.1 },
  venom_spray: { count: 30, speed: 7, spread: 2.5, life: 0.9, color: [0.85, 0.85, 0.35], bursts: 2, dirY: -0.1 },
  web_spray: { count: 30, speed: 7, spread: 2.0, life: 1.0, color: [0.62, 0.42, 0.7], bursts: 2, dirY: 0.05 },
};

/**
 * 見た目を変える画面（v0.28.0）の下見。カメラを狩人の前に置き、狩人のほうを回して見せる（描く側だけ。simulation の向きは変えない）。
 * pane は、狩人を真ん中に置く画面の範囲（画面に対する割合。cx・cy は中心、w・h は幅と高さ）。
 */
export interface Portrait {
  /** カメラを置く側（下見を始めた時のカメラの向き。壁の無い側） */
  baseYaw: number;
  /** 狩人を回した角度（0 = 正面、π = 後ろ） */
  spin: number;
  focus: 'body' | 'face';
  /** 1 = ちょうど収まる距離。小さいほど寄る */
  zoom: number;
  pane: { cx: number; cy: number; w: number; h: number };
  /** 服: base = 里の装束（防具なし）/ worn = いまの装備 / helmet = いまの装備に兜（持っていなければ参考の兜 = 2 段） */
  clothes: 'base' | 'worn' | 'helmet';
}

export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly cam: FollowCamera;
  readonly hunter = new HunterRig();
  /** 飛んでいる矢の形（使い回す） */
  private arrows: Group[] = [];
  /** モンスターの見た目（個体の id → 体と影）。群れの幼体は、居るエリアへ入った時に作る（v0.18.0） */
  private rigs = new Map<string, { rig: MonsterRig; shadow: Object3D; tilt?: { x: number; z: number }; limp?: { d: number; w: number; x: number; z: number } }>();
  /** 1 体の標的（依頼の標的・訓練の標的。群れの依頼では、最初の 1 頭）の見た目 */
  monsterRig: MonsterRig | null = null;
  private hazardViews = new Map<number, { group: Group; ring: Mesh; rock: Mesh; look: HazardLook }>();
  /** 飛び道具の見た目（v0.17.0）: 種類ごとの材質。岩は従来どおり */
  private hazardBall = new IcosahedronGeometry(1, 1);
  private hazardMats = new Map<HazardLook, MeshStandardMaterial>();
  private trapViews = new Map<number, { group: Group; ring: Mesh; core: Mesh }>();
  private hazardRock = new IcosahedronGeometry(1, 0);
  private hazardRockMat = new MeshLambertMaterial({ color: 0x80847a, flatShading: true });
  private arena: Arena;
  /** フィールド: 作ったエリアの地形（入った時に作り、居るエリアだけ見せる）と、いま見せているエリア */
  private areaGroups = new Map<string, Group>();
  /** 里に立つ人の板（拠点の時だけ） */
  private npcs: Group | null = null;
  /** 狩らない依頼（v0.27.0）の採取点と納品箱 */
  private errandProps: ErrandProps | null = null;
  private shownArea = '';
  /** まだ入っていないエリアの地形を、前もって 1 つずつ作るまでのフレーム数（エリアを移った時に、作る間だけ止まらないように） */
  private prebuildIn = 90;
  private trail: BladeTrail;
  private sparks: Particles;
  private dust: Particles;
  private rings: GroundRings;
  private debug: DebugDraw;
  private playerShadow = blobShadow(0.45);
  private phase = 0;
  private lastPlayerXZ: { x: number; z: number } | null = null;
  private time = 0;
  /** 見た目を変える画面の下見（null = ふだんのカメラ） */
  portrait: Portrait | null = null;
  private viewOffset = false;
  /** 見た目の側から鳴らす音（モンスターの足音など）。App が音声へつなぐ。 */
  onSound: ((id: string, intensity: number) => void) | null = null;
  /** 里の音の大きさ（v0.35.0。沢・炉・風）。0.25 秒ごと。里でない所では、沢と炉は 0、風は 1。App が音声へつなぐ */
  onAmbience: ((a: Ambience) => void) | null = null;
  private ambienceTimer = 1;
  /** 里の建物と暮らし（v0.35.0。里の時だけ） */
  private village: Village | null = null;
  private tmpSize = new Vector2();
  /** モンスターの見た目が出す効果: 足音と土ぼこり。近いほど大きく、画面も少し揺れる。 */
  private monsterFx = {
    px: 0,
    pz: 0,
    footfall: (x: number, y: number, z: number, strength: number): void => {
      this.dust.emit(Math.round(3 + strength * 4), { x, y: y + 0.12, z }, 1.4 + strength, 0.5, 0.7, [0.62, 0.6, 0.54], 0.7);
      const near = Math.max(0, 1 - Math.hypot(x - this.monsterFx.px, z - this.monsterFx.pz) / 16);
      if (near <= 0) return;
      this.cam.addShake(0.07 * strength * near * near);
      this.onSound?.('galdros_step', strength * near);
    },
    puff: (x: number, y: number, z: number, amount: number): void => {
      this.dust.emit(Math.round(2 + amount * 2), { x, y, z }, 1.2, 0.5, 0.6, [0.7, 0.68, 0.62], 0.5);
    },
  };
  private renderY = 0;
  private poseKey = '';
  private lastPose: BodyPose = emptyPose();
  /**
   * 武器の置き場所の混ぜ（v0.40.0）: 技が替わった時、直前に手に持っていた武器の位置と向きから、短く混ぜる（刃を手首で返す連係で、刃が一瞬で裏返らない）。
   * 判定のある tick は混ぜない（見える刃と判定を合わせる）。描画だけ
   */
  private lastWeapon: { grip: V3; q: Quaternion } | null = null;
  private weaponFrom: { grip: V3; q: Quaternion } | null = null;
  private weaponBlendT = 1;
  private blendFrom: BodyPose | null = null;
  private blendT = 1;
  /** 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）の体を解く係 */
  private anim = new HunterAnimator();
  private groundLocomotion = new GroundedLocomotion();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpLock = new Vector3();
  /** ロックオン（v0.16.0）。App が入・切する。標的が倒れた・別のエリアへ移った時は、ここで切り、lockLost を立てる */
  lockOn = false;
  lockLost = false;
  /** ロック中の、照準の位置（ワールド座標。無ければ null） */
  lockPoint: Vector3 | null = null;
  /** ロックしている個体（群れの依頼で、倒れたら次の近い標的へ移る。v0.18.0） */
  lockId: string | null = null;
  /** 技データが指す clip のうち、仮アニメーションに無いもの。黙って代用せず検証表示へ出す。 */
  readonly missingClips = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private content: Content,
    sim: Simulation,
    private settings: Settings,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = settings.shadows;
    this.cam = new FollowCamera(1);
    if (sim.field) {
      // フィールド: 空と光は 1 回だけ。地形は、居るエリアのぶんを showArea が作る
      this.arena = { group: new Group(), ...setupSky(this.scene, settings.shadows, 'basin') };
      this.showArea(sim);
    } else if (sim.world.map.id === content.hub.mapId) {
      // 拠点（里）: 建物と広場。v0.35.0 から、5 つの段と暮らし（水車・昇降台・煙・音）
      const { group, village } = buildHubGroup(content.hub, sim.world.map);
      this.village = village;
      this.scene.add(group);
      // 里に立つ人（v0.23.0。絵の板。毎フレーム、カメラの方へ向ける）
      this.npcs = buildNpcSprites(content.hub.npcs ?? [], sim.world.map.platforms);
      this.scene.add(this.npcs);
      this.arena = { group, ...setupSky(this.scene, settings.shadows, 'village') };
    } else this.arena = buildArena(this.scene, sim.world.map, settings.shadows);
    this.scene.add(this.hunter.root, this.playerShadow);
    if (sim.errand) {
      this.errandProps = buildErrandProps(sim.errand.def, (x, z) => sim.world.groundHeight(x, z));
      this.scene.add(this.errandProps.group);
    }
    const m = sim.main ?? sim.monsters[0];
    if (m) this.monsterRig = this.rigOf(m).rig;
    this.trail = new BladeTrail(this.scene);
    this.sparks = new Particles(this.scene, 260, 0.11, true, 9, 1.2);
    this.dust = new Particles(this.scene, 200, 0.55, false, -0.6, 2.2);
    this.rings = new GroundRings(this.scene);
    this.debug = new DebugDraw(this.scene);
    this.cam.snap(sim.player.yaw);
    this.renderY = sim.player.pos.y;
    this.resize();
  }

  /**
   * フィールド: プレイヤーが居るエリアの地形を見せる（初めて入るエリアは、ここで作る）。エリアが変わったら true。
   * ほかのエリアは 150m 以上離れていて霧の向こうなので、見せない。
   */
  private showArea(sim: Simulation): boolean {
    const field = sim.field;
    if (!field || sim.areaId === this.shownArea) return false;
    const area = sim.area();
    if (!area) return false;
    this.areaGroupOf(sim, area.id);
    for (const [id, grp] of this.areaGroups) grp.visible = id === area.id;
    this.shownArea = area.id;
    return true;
  }

  /** そのエリアの地形（無ければ作って、見えない状態でシーンへ足す）。岩と岩壁は形を計算で作るので、1 つに数十 ms かかる */
  private areaGroupOf(sim: Simulation, areaId: string): Group | null {
    const field = sim.field;
    const area = field?.areas.find((a) => a.id === areaId);
    if (!field || !area) return null;
    let g = this.areaGroups.get(area.id);
    if (!g) {
      g = buildAreaGroup({
        bounds: area.bounds, shape: area.shape, rocks: area.rocks, platforms: area.platforms, kind: area.kind, seed: 9001 + area.no * 131, climbs: area.climbs, relief: area.relief, groundTint: area.look?.ground,
        camp: area.kind === 'camp' ? field.camp : null,
        gates: area.exits.map((e) => ({ x: e.x, z: e.z, marker: true })),
      });
      g.visible = false;
      this.areaGroups.set(area.id, g);
      this.scene.add(g);
    }
    return g;
  }

  /**
   * フィールド: まだ作っていないエリアの地形を、少しずつ前もって作る（v0.19.0。20 フレームに 1 つ。いま居るエリアの隣から）。
   * 見えない状態で足すので、画面は変わらない。
   */
  private prebuildAreas(sim: Simulation): void {
    const field = sim.field;
    if (!field || this.areaGroups.size >= field.areas.length) return;
    if (--this.prebuildIn > 0) return;
    this.prebuildIn = 20;
    const here = field.areas.find((a) => a.id === sim.areaId);
    const next = [...(here?.exits.map((e) => e.to) ?? []), ...field.areas.map((a) => a.id)].find((id) => !this.areaGroups.has(id));
    if (next) this.areaGroupOf(sim, next);
  }

  /**
   * その個体の見た目（無ければ作る）。大型 11 種と幼体 8 種は設計図から作る仮モデル（幼体は群れの仲間で面を分け合う）、
   * ガルドロスは専用の仮モデル、訓練の標的は岩偶。
   */
  private rigOf(m: MonsterState): { rig: MonsterRig; shadow: Object3D; tilt?: { x: number; z: number }; limp?: { d: number; w: number; x: number; z: number } } {
    const had = this.rigs.get(m.id);
    if (had) return had;
    const ids = m.def.parts.map((p) => p.id);
    const plan = CREATURE_PLANS[m.def.id];
    const rig: MonsterRig = plan ? new CreatureRig(plan, ids) : m.def.id === 'monster.galdros' ? new GaldrosRig(ids) : new DummyRig(ids);
    const shadow = blobShadow(1.7);
    shadow.scale.setScalar(plan ? Math.max(m.herd ? 0.3 : 1, m.def.bodyRadius * 1.1) : m.def.id === 'monster.galdros' ? 1.45 : 1);
    this.scene.add(rig.root, shadow, ...(rig.extras ?? []));
    const e = { rig, shadow };
    this.rigs.set(m.id, e);
    return e;
  }

  /** 見えている（同じエリアに居る）モンスター。フィールドでなければ、全部 */
  private shown(sim: Simulation, m: MonsterState): boolean {
    return !sim.field || sim.monsterArea(m)?.id === sim.areaId;
  }

  /** 下見のカメラ: 狩人の前（baseYaw の側）から、全身か顔が pane に収まる距離で見る。狩人は baseYaw の側を向き、spin だけ回る */
  private placePortrait(pt: Portrait, pos: V3): void {
    const cam = this.cam.camera;
    const W = Math.max(1, this.canvas.clientWidth), H = Math.max(1, this.canvas.clientHeight);
    const face = pt.focus === 'face';
    // 顔: 頭と肩（あご 1.565 〜 頭頂 1.75 と、その下の肩まで）。全身: 足もとから頭の上まで
    const fy = face ? 1.57 : 0.92;
    const [th, tw] = face ? [0.64, 0.56] : [2.0, 1.2];
    const t = 2 * Math.tan((cam.fov * Math.PI) / 360);
    const d = Math.max(th / (t * Math.max(0.1, pt.pane.h)), tw / (t * (W / H) * Math.max(0.1, pt.pane.w))) * pt.zoom;
    const y = this.renderY + fy;
    cam.position.set(pos.x - Math.sin(pt.baseYaw) * d, y + (face ? 0.02 : 0.12), pos.z - Math.cos(pt.baseYaw) * d);
    cam.lookAt(pos.x, y, pos.z);
    cam.setViewOffset(W, H, (0.5 - pt.pane.cx) * W, (0.5 - pt.pane.cy) * H, W, H);
    this.viewOffset = true;
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    // 内部解像度: DPR 上限 1.5 × 倍率。HUD は HTML なので影響を受けない。
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5) * this.settings.renderScale);
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  /** ワールド座標 → 画面座標 (CSS px)。 */
  project(p: V3): { x: number; y: number; visible: boolean } {
    const v = this.tmpA.set(p.x, p.y, p.z).project(this.cam.camera);
    return { x: (v.x * 0.5 + 0.5) * this.canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * this.canvas.clientHeight, visible: v.z < 1 && v.z > -1 };
  }

  handleEvents(events: readonly SimEvent[], sim: Simulation): void {
    /** その場所の地面の高さ（v0.46.0 の起伏。足元の砂ぼこり・輪を地面に合わせる） */
    const gy = (x: number, z: number): number => sim.world.groundHeight(x, z);
    const byId = (id: string): MonsterState | undefined => sim.monsters.find((x) => x.id === id);
    for (const e of events) {
      // その出来事の主のモンスター（無ければ 1 体の標的）
      const m = ('target' in e && typeof e.target === 'string' ? byId(e.target) : 'actor' in e ? byId(e.actor) : undefined) ?? sim.main ?? sim.monsters[0];
      const rig = m ? this.rigs.get(m.id)?.rig : undefined;
      switch (e.type) {
        case 'action_event':
          if (e.actor === sim.player.id && e.kind === 'trail_on') this.trail.active = true;
          else if (e.actor === sim.player.id && e.kind === 'trail_off') this.trail.active = false;
          else if (e.kind === 'vfx' && m && CREATURE_VFX[e.id]) this.creatureVfx(e.id, m);
          else if (e.kind === 'vfx' && e.id === 'ground_slam' && m?.action?.def.weaponTrack) {
            const tr = this.content.tracks.get(m.action.def.weaponTrack)!;
            const seg = trackSegment(tr, m.action.tick);
            const tip = toWorld(seg.b, m.pos, m.yaw);
            this.rings.spawn(tip.x, gy(tip.x, tip.z), tip.z, 2.6, 0.5, 0xe9e2c8);
            this.dust.emit(22, { x: tip.x, y: gy(tip.x, tip.z) + 0.2, z: tip.z }, 3.6, 1.2, 0.9, [0.62, 0.62, 0.55], 0.5);
            this.cam.addShake(0.55);
          }
          break;
        case 'action_start':
          if (e.actor === sim.player.id && e.actionId === this.content.player.rollActionId) {
            this.dust.emit(6, { x: sim.player.pos.x, y: sim.player.pos.y + 0.1, z: sim.player.pos.z }, 1.6, 0.5, 0.5, [0.6, 0.62, 0.55], 0.3);
          }
          break;
        case 'hit': {
          const c = MATERIAL_SPARK[e.material] ?? [1, 1, 1];
          this.sparks.emit(10 + e.chargeLevel * 6, e.pos, 4.5 + e.chargeLevel, 1.6, 0.34, c);
          this.dust.emit(3, e.pos, 1.2, 0.4, 0.5, [0.6, 0.6, 0.55], 0.6);
          // 武器の属性が乗った: その色の火花を足す（v0.33.0）
          if (e.element) this.sparks.emit(8, e.pos, 3.5, 1.8, 0.4, ELEMENT_SPARK[e.element]);
          rig?.hitFlash(e.partIndex);
          rig?.hitReact?.(e.partIndex, e.pos.x, e.pos.z, 0.8 + e.chargeLevel * 0.3);
          this.cam.addShake(0.22 + e.chargeLevel * 0.12);
          // 弾かれた: 白い火花を足す（刃が通っていないことが分かるように）
          if (e.bounced) {
            this.sparks.emit(18, e.pos, 6.5, 2.4, 0.3, [1, 1, 0.92]);
            this.cam.addShake(0.2);
          }
          break;
        }
        case 'part_break':
          if (m) {
            const s = m.def.parts[e.partIndex]!.shapes[0]!;
            const at = toWorld(fromArr(s.a), m.pos, m.yaw);
            this.sparks.emit(40, at, 6, 3, 0.7, [0.95, 0.8, 0.5]);
            this.dust.emit(14, at, 2.6, 1.5, 1.0, [0.55, 0.55, 0.5]);
            this.cam.addShake(0.5);
          }
          break;
        case 'part_sever':
          rig?.placeSevered?.(e.pos.x, e.pos.y, e.pos.z, e.yaw);
          this.sparks.emit(36, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 0.9, z: e.pos.z }, 6, 3, 0.7, [1, 0.8, 0.45]);
          this.dust.emit(12, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 0.4, z: e.pos.z }, 2.4, 1.2, 0.9, [0.55, 0.52, 0.48]);
          this.cam.addShake(0.55);
          break;
        case 'monster_stagger':
          if (m && e.kind === 'topple') {
            this.dust.emit(24, { x: m.pos.x, y: gy(m.pos.x, m.pos.z) + 0.4, z: m.pos.z }, 3.4, 1, 1.0, [0.6, 0.6, 0.54], 0.5);
            this.cam.addShake(0.45);
          }
          break;
        case 'monster_aware':
        case 'monster_rage':
          this.cam.addShake(0.35);
          break;
        case 'monster_ailment':
          // 状態異常が付いた・覚めた（v0.33.0）: その色の粉をまとめて出す
          if (m && (e.on || e.woke)) {
            const at = e.pos ?? this.ailmentPoint(m);
            const col = AILMENT_FX[e.kind];
            if (e.kind === 'para' || e.kind === 'stun') this.sparks.emit(22, at, 4, 1.5, 0.5, col);
            else this.dust.emit(e.woke ? 8 : 20, at, 2, 0.8, 1.2, col, 0.6);
            if (e.on && e.kind === 'stun') this.cam.addShake(0.3);
          }
          break;
        case 'hazard_impact': {
          const look = sim.hazards.find((h) => h.id === e.id)?.look ?? 'rock';
          const hc = HAZARD_COLORS[look];
          this.rings.spawn(e.x, gy(e.x, e.z), e.z, e.radius * 1.5, 0.45, hc.ring === 0xff7a3a ? 0xe9e2c8 : hc.ring);
          this.dust.emit(look === 'mist' || look === 'poison' || look === 'para' ? 26 : 14, { x: e.x, y: gy(e.x, e.z) + 0.3, z: e.z }, look === 'mist' ? 4.5 : 3, 1.4, look === 'poison' || look === 'para' ? 1.6 : 0.9, hc.dust, 0.6);
          this.sparks.emit(look === 'spark' ? 26 : 8, { x: e.x, y: gy(e.x, e.z) + 0.4, z: e.z }, look === 'spark' ? 6 : 4, 2.5, 0.4, hc.spark);
          this.cam.addShake(look === 'rock' ? 0.3 : 0.18);
          break;
        }
        case 'guard':
          this.sparks.emit(16, e.pos, 5, 1.5, 0.3, [1, 0.95, 0.7]);
          this.cam.addShake(0.3);
          break;
        case 'guard_break':
        case 'player_hurt':
          this.sparks.emit(12, e.pos, 4, 1.5, 0.35, [1, 0.5, 0.4]);
          this.cam.addShake(0.5);
          break;
        case 'charge_level': {
          const tip = this.bladePoint(1);
          this.sparks.emit(8 + e.level * 4, tip, 2.2, 1, 0.4, [1, 0.85, 0.5]);
          break;
        }
        case 'demon':
          // 猛り（双剣。v0.54.0）に入った: 刃先から赤い火花（見た目は仮）
          if (e.on) {
            this.sparks.emit(18, this.bladePoint(1), 2.6, 1.2, 0.5, [1, 0.42, 0.3]);
            this.cam.addShake(0.12);
          }
          break;
        case 'monster_dead':
        case 'monster_respawn':
          if (m) {
            const k = m.herd ? 0.4 : 1;
            this.dust.emit(Math.round(26 * k), { x: m.pos.x, y: gy(m.pos.x, m.pos.z) + 0.6 * k, z: m.pos.z }, 3.2 * k, 1.2, 1.1, [0.6, 0.62, 0.55], 0.6);
          }
          break;
        case 'herd_alarm':
          // 群れが騒いだ: 足元に小さな土ぼこり（逃げ出す時は多め）
          this.dust.emit(e.flee ? 8 : 3, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 0.2, z: e.pos.z }, 1.4, 0.6, 0.6, [0.62, 0.6, 0.54], 0.4);
          break;
        // ---- 道具・捕獲・剥ぎ取り（見た目は仮）----
        case 'item_effect':
          if (e.kind === 'heal') this.sparks.emit(14, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 1.1, z: e.pos.z }, 1.2, 2.2, 0.7, [0.55, 0.95, 0.6], 0.5);
          else if (e.kind === 'trap' && e.ok) this.dust.emit(8, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 0.15, z: e.pos.z }, 1.4, 0.6, 0.6, [0.6, 0.6, 0.55], 0.5);
          else if (e.kind === 'tranq') this.dust.emit(e.ok ? 22 : 8, e.pos, e.ok ? 2.4 : 1.2, 1.2, 1.2, [0.62, 0.78, 0.92], 0.8);
          // 標識玉（v0.42.0）: 当たると、相手の体に灯の色の粉が散る（見た目は仮）
          else if (e.kind === 'mark') this.sparks.emit(e.ok ? 18 : 6, e.pos, e.ok ? 2.0 : 1.0, 1.4, 0.9, [1, 0.84, 0.45], 0.6);
          break;
        case 'land':
          // 降りて着いた: 足元に土ぼこり（高いほど多い。仮）
          this.dust.emit(Math.round(6 + e.height * 4), { x: e.pos.x, y: e.pos.y + 0.1, z: e.pos.z }, 1.1 + e.height * 0.25, 0.5, 0.5, [0.6, 0.6, 0.54], 0.45);
          break;
        case 'trap_trigger':
          this.rings.spawn(e.x, gy(e.x, e.z), e.z, 2.6, 0.5, 0xfff0a0);
          this.sparks.emit(24, { x: e.x, y: gy(e.x, e.z) + 0.3, z: e.z }, 5, 3, 0.5, [1, 0.92, 0.6]);
          this.cam.addShake(0.25);
          break;
        case 'monster_captured':
          if (m) this.dust.emit(30, { x: m.pos.x, y: gy(m.pos.x, m.pos.z) + 1.2, z: m.pos.z }, 2.2, 1, 1.6, [0.62, 0.78, 0.92], 0.9);
          break;
        case 'carve':
          this.sparks.emit(6, { x: e.pos.x, y: gy(e.pos.x, e.pos.z) + 0.5, z: e.pos.z }, 1.6, 1.6, 0.4, [0.95, 0.85, 0.6], 0.4);
          break;
        default:
          break;
      }
    }
  }

  /** 刃の上の点（0 = 根元、1 = 刃先）のワールド座標。 */
  private bladePoint(u: number): V3 {
    const fam = [...this.content.families.values()][0]!;
    const v = this.tmpB.set(0, fam.blade.from + (fam.blade.to - fam.blade.from) * u, 0).applyMatrix4(this.hunter.weapon.matrixWorld);
    return { x: v.x, y: v.y, z: v.z };
  }

  update(sim: Simulation, alpha: number, dt: number, look: { x: number; y: number }, verify: boolean): void {
    this.time += dt;
    const p = sim.player;
    const content = this.content;
    const fam = familyOf(p, content);
    const pos = lerpV(p.prevPos, p.pos, alpha);
    // 見た目を変える画面の下見では、狩人をカメラの方へ向けて回す。足を地面に留める計算は、向きに付いて来るよう毎フレーム初めから
    const yaw = this.portrait ? this.portrait.baseYaw + Math.PI + this.portrait.spin : p.prevYaw + angleDiff(p.prevYaw, p.yaw) * alpha;
    if (this.portrait) {
      this.groundLocomotion.reset();
      this.anim.reset();
    }
    this.renderY += (pos.y - this.renderY) * Math.min(1, dt * 16);
    this.hunter.root.position.set(pos.x, this.renderY, pos.z);
    this.hunter.root.rotation.y = yaw;
    const travel = this.lastPlayerXZ ? Math.hypot(pos.x - this.lastPlayerXZ.x, pos.z - this.lastPlayerXZ.z) : 0;
    const visualSpeed = this.lastPlayerXZ && dt > 0 && dt < 0.2 && travel < 1.2 ? Math.min(7, travel / dt) : p.moveSpeed;
    this.lastPlayerXZ = { x: pos.x, z: pos.z };
    this.phase += (visualSpeed * dt * Math.PI * 2) / freeStride(visualSpeed, p.drawn);

    // ---- 姿勢と武器の置き場所を決める ----
    let key: string;
    let pose: BodyPose;
    let weapon: WeaponPlace = p.drawn ? { mode: 'hand' } : { mode: 'back' };
    this.hunter.setFamily(fam.id, fam.offhand, sim.content.weapons.get(p.weaponId)?.assetId);
    // 着ている防具（部位 → 段）。同じ組み合わせの間は、何もしない
    const armorLook: ArmorLook = {};
    if (this.portrait?.clothes !== 'base') {
      for (const id of sim.armorIds) {
        const a = sim.content.armor.get(id);
        if (a) armorLook[a.slot] = armorTierOf(a.assetId);
      }
    }
    if (this.portrait?.clothes === 'helmet' && (armorLook.head ?? 1) < 2) armorLook.head = 2;
    this.hunter.setArmor(armorLook);
    // 盾（左腕）の位置: 構えていない時の位置から、防御の位置へどれだけ寄せるか。行動が軌道を持つ時はそれに従う。
    let shieldU = 0;
    let shieldAt: V3 | null = null;
    let shieldOut = p.drawn;
    const hands: HandsSpec = { two: fam.twoHanded, along: fam.otherHandAlong, primary: fam.primaryHand, other: null };
    const ready: WeaponPlace = { mode: 'track', grip: fromArr(fam.ready.grip), dir: norm(fromArr(fam.ready.dir)), normal: fam.ready.planeNormal };
    // 体を解ける状態（技・構え・防御）なら、その中身。解けない状態（被弾・納刀など）は null のまま。
    let st: AnimState | null = null;

    if (p.mode === 'action' && p.action) {
      const run = p.action;
      const t = playerRenderTick(run, alpha);
      const fm = run.def.freeMove;
      st = { kind: 'action', clip: run.def.clip, t, dirAngle: (run.dirIndex * Math.PI) / 2, chargeTicks: run.chargeTicks, freeMove: !!fm && t >= (fm.from ?? 0) && t < (fm.to ?? run.def.durationTicks) };
      const cp = canSolve(fam.id, st) ? emptyPose() : clipPose(run.def.clip, t);
      if (!cp) this.missingClips.add(run.def.clip);
      pose = cp ?? emptyPose();
      if (fam.id === 'heavy_blade') pose = groundedHeavyAttack(pose, run.def.clip, t);
      pose.tumbleDir = (run.dirIndex * Math.PI) / 2;
      key = `action:${run.instanceId}`;
      if (run.def.weaponTrack) {
        const tr = content.tracks.get(run.def.weaponTrack)!;
        const s = sampleTrack(tr, t);
        const n = sampleTrackNormal(tr, t);
        weapon = { mode: 'track', grip: s.grip, dir: s.dir, normal: [n.x, n.y, n.z] };
        shieldOut = true;
      }
      if (run.def.offhandTrack) shieldAt = sampleTrack(content.tracks.get(run.def.offhandTrack)!, t).grip;
      else if (run.def.guardWindows) shieldU = 1;
      // 研磨石: 武器をひざの前へ渡し（片ひざを突く）、研ぎ終わったら戻す。v0.40.0 から、納刀して使う（背の置き場所から下ろして、背へ納める）。
      // 護刃が防御を構えたまま使った時（抜刀のまま）は、これまでどおり構えの位置から
      if (run.def.clip === WHET_CLIP) {
        const u = smoothstep(Math.min(1, t / 18)) * (1 - smoothstep((t - 102) / 18));
        const drawTr = !run.keepDrawn ? content.actions.get(fam.actions.draw)?.weaponTrack : undefined;
        const tr = drawTr ? content.tracks.get(drawTr) : undefined;
        const home = tr ? { ...sampleTrack(tr, 0), normal: sampleTrackNormal(tr, 0) } : null;
        const homeGrip = home ? home.grip : fromArr(fam.ready.grip);
        const homeDir = home ? home.dir : norm(fromArr(fam.ready.dir));
        const homeNormal = home ? [home.normal.x, home.normal.y, home.normal.z] : fam.ready.planeNormal;
        weapon = {
          mode: 'track',
          grip: lerpV(homeGrip, WHET_HOLD.grip, u),
          dir: norm(lerpV(homeDir, WHET_HOLD.dir, u)),
          normal: u < 0.5 ? homeNormal : WHET_HOLD.normal,
        };
        shieldOut = true;
        // 左手が空く武器（両手持ち、または左の剣を腰へ納める双剣）は、左手の石で刃をなでる（3 往復）。左腕に盾を持つ武器は、右手で支えるだけ（仮）
        if ((!fam.offhand || !fam.offhandReady) && fam.primaryHand !== 'left' && u > 0.5) {
          const s = 0.5 - 0.5 * Math.cos(Math.min(1, Math.max(0, (t - 20) / 76)) * Math.PI * 6);
          const from = Math.min(fam.blade.from + 0.05, 0.4);
          hands.two = false;
          hands.other = { x: 0.03, y: from + 0.3 * s, z: -Math.min(0.08, fam.blade.radius * 0.5) };
        }
      }
      // 弓: 矢を放つまで、右手で弦を引く
      const shoot = run.def.shoot?.[0];
      if (shoot && fam.primaryHand === 'left' && t < shoot.tick) {
        const pull = Math.min(1, (t + run.chargeTicks) / (shoot.tick + 14));
        hands.other = { x: 0, y: 0.02, z: 0.17 + 0.36 * pull };
      }
    } else if (p.mode === 'guard' && p.guard && fam.guard) {
      const g = p.guard;
      const G = fam.guard;
      key = 'guard';
      if (g.phase === 'break') {
        pose = hurtPose('break', g.tick + alpha, G.breakTicks, true);
        key = 'guard-break';
      } else {
        let blend = 1;
        let shake = 0;
        if (g.phase === 'start') blend = (g.tick + alpha) / G.startTicks;
        else if (g.phase === 'end') blend = 1 - (g.tick + alpha) / G.endTicks;
        else if (g.phase === 'recoil') shake = 1 - g.tick / G.recoilTicks;
        pose = guardPose(blend, shake);
        st = { kind: 'guard', blend, shake };
        const u = smoothstep(blend);
        shieldU = u;
        weapon = {
          mode: 'track',
          grip: lerpV(fromArr(fam.ready.grip), fromArr(G.pose.grip), u),
          dir: norm(lerpV(norm(fromArr(fam.ready.dir)), norm(fromArr(G.pose.dir)), u)),
          normal: u < 0.5 ? fam.ready.planeNormal : G.pose.planeNormal,
        };
      }
    } else if (p.mode === 'hurt' && p.hurt) {
      pose = hurtPose(p.hurt.kind, p.hurt.tick + alpha, p.hurt.duration, p.drawn);
      if (p.hurt.kind === 'knockdown') pose.tumbleDir = p.hurt.dirYaw - yaw - Math.PI;
      key = `hurt:${p.hurt.kind}`;
    } else if (p.mode === 'dead') {
      pose = deadPose(p.deadTicks + alpha);
      key = 'dead';
    } else if (p.mode === 'free' && p.drop) {
      // 降下と着地（v0.45.0。仮の姿勢）
      pose = dropPose(p.drop.ticks + alpha);
      key = 'drop';
    } else if (p.mode === 'free' && p.land) {
      pose = landPose(p.land.ticks - alpha, p.land.total);
      key = 'land';
    } else if (p.mode === 'vault' && p.vault) {
      // 低い岩棚の乗り越え（v0.49.0。仮の姿勢）: 武器は背に納めたまま
      pose = vaultPose(Math.min(1, (p.vault.t + alpha) / VAULT_TICKS));
      key = 'vault';
    } else if (p.mode === 'climb' && p.climb) {
      // 登攀（v0.44.0。仮の姿勢）: 武器は背に納めたまま
      const c = p.climb;
      const n = c.phase === 'mount' ? CLIMB_MOUNT_TICKS : c.phase === 'down' ? CLIMB_DOWN_TICKS : c.phase === 'exit' ? CLIMB_EXIT_TICKS : 1;
      pose = climbPose(c.phase, Math.min(1, (c.t + alpha) / n), c.h);
      key = 'climb';
    } else {
      pose = locomotionPose(p.drawn, visualSpeed, this.phase, this.time);
      if (!p.drawn || fam.id === 'heavy_blade') pose = this.groundLocomotion.frame(pose, p.drawn, visualSpeed, this.phase, dt, { x: pos.x, z: pos.z, yaw, y: pos.y, ground: (x, z) => sim.world.groundHeight(x, z) });
      key = p.drawn ? 'free-drawn' : 'free-sheathed';
      if (p.drawn) {
        weapon = ready;
        st = { kind: 'idle' };
      }
    }
    // 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）: 体・武器・盾（双剣は左の剣）をまとめて解く（足は地面に、手は武器に付いたままになる）
    if (p.mode !== 'free') this.groundLocomotion.reset();
    let solved: Solved | null = null;
    if (st && canSolve(fam.id, st)) {
      solved = this.anim.frame(fam.id, st, key, dt, visualSpeed, this.time, {
        root: { x: pos.x, z: pos.z, yaw, y: pos.y, ground: (x, z) => sim.world.groundHeight(x, z) },
        active: st.kind === 'action' && !!p.action && playerContactFrame(p.action.def, st.t),
        frozen: !!p.action && p.action.hitstop > 0,
      });
      pose = solved.pose;
    } else this.anim.reset();

    // 状態が切り替わった瞬間は、直前の姿勢から短く混ぜる
    const keyChanged = key !== this.poseKey;
    if (keyChanged) {
      this.poseKey = key;
      // IK を解いた後で骨だけを混ぜると、手と武器が離れる。解く側だけでブレンドする。
      this.blendFrom = solved ? null : { ...this.lastPose, tumble: ((((this.lastPose.tumble + 180) % 360) + 360) % 360) - 180 };
      this.blendT = 0;
    }
    this.blendT += dt;
    const w = Math.min(1, this.blendT / 0.09);
    if (w < 1 && this.blendFrom) pose = blendPose(this.blendFrom, pose, w);
    this.lastPose = pose;

    if (solved) {
      applySolved(this.hunter, solved, fam.id);
      // applySolved の後で姿勢を上書きしない（握りと添え手を保つ）。
    } else {
      this.hunter.setPose(pose);
      this.hunter.setString(null);
      const sheath = WEAPON_STANCES[fam.id]?.sheath;
      if (weapon.mode === 'track') {
        // 技が替わった直後は、直前の武器の位置と向きから混ぜる（判定のある tick は、正本の軌道のまま）
        const q = weaponQuat(weapon.dir, weapon.normal);
        if (keyChanged) {
          this.weaponFrom = this.lastWeapon;
          this.weaponBlendT = 0;
        }
        this.weaponBlendT += dt;
        const contact = !!p.action && playerContactFrame(p.action.def, playerRenderTick(p.action, alpha));
        const wu = this.weaponBlendT / WEAPON_BLEND_SEC;
        if (this.weaponFrom && wu < 1 && !contact) {
          const e = smoothstep(wu);
          const bq = this.weaponFrom.q.clone().slerp(q, e);
          weapon = { mode: 'track', grip: lerpV(this.weaponFrom.grip, weapon.grip, e), dir: v3From(new Vector3(0, 1, 0).applyQuaternion(bq)), normal: new Vector3(1, 0, 0).applyQuaternion(bq).toArray() };
          this.lastWeapon = { grip: weapon.grip, q: bq };
        } else this.lastWeapon = { grip: weapon.grip, q };
        this.hunter.weaponToTrack(weapon.grip, weapon.dir, weapon.normal, hands);
      } else {
        this.lastWeapon = null;
        if (weapon.mode === 'back' && sheath) this.hunter.weaponToSheath(sheath);
        else this.hunter.weaponToSocket(weapon.mode === 'back' ? fam.sheathSocket ?? 'back' : fam.primaryHand === 'left' ? 'hand_l' : 'hand_r');
      }
    }
    if (fam.offhand && !solved) {
      // 盾: 抜刀中は左腕で前に持ち、納刀中・被弾中・力尽きた時は背中へ
      if (shieldOut && p.mode !== 'hurt' && p.mode !== 'dead' && fam.offhandReady) {
        const ready = fromArr(fam.offhandReady);
        const at = shieldAt ?? (fam.offhandGuard ? lerpV(ready, fromArr(fam.offhandGuard), shieldU) : ready);
        this.hunter.shieldTo(at, shieldAt ? 0 : 0.5 * (1 - shieldU));
      } else {
        stowOffhand(this.hunter, fam.id);
      }
    }
    this.hunter.root.updateMatrixWorld(true);
    this.hunter.setGhost(p.invulnTicks > 0 && p.mode !== 'hurt' && Math.floor(this.time * 14) % 2 === 0);
    this.playerShadow.position.set(pos.x, sim.world.groundHeight(pos.x, pos.z) + 0.03, pos.z);

    if (p.mode !== 'action') this.trail.active = false;
    this.trail.hot = p.demon;
    const base = this.bladePoint(0.05);
    const tip = this.bladePoint(1);
    this.trail.update(dt, this.tmpA.set(base.x, base.y, base.z), new Vector3(tip.x, tip.y, tip.z));

    // ---- モンスター ----
    // フィールド: 別のエリアに居るモンスターは見せない（霧の向こうで、もともと見えない距離）。群れの幼体の体は、見える時に作る
    this.monsterFx.px = pos.x;
    this.monsterFx.pz = pos.z;
    for (const m of sim.monsters) {
      const here = this.shown(sim, m);
      const e = here ? this.rigOf(m) : this.rigs.get(m.id);
      if (!e) continue;
      e.rig.root.visible = here;
      e.shadow.visible = here && !m.dead;
      if (!here) continue;
      const mp = lerpV(m.prevPos, m.pos, alpha);
      e.rig.root.position.set(mp.x, mp.y, mp.z);
      const myaw = m.prevYaw + angleDiff(m.prevYaw, m.yaw) * alpha;
      e.rig.root.rotation.y = myaw;
      // 坂（v0.47.0。地面の起伏）: 体の前後・左右の地面の高さの差だけ、体を傾ける（描画だけ。当たりは傾けない。10° まで、なめらかに）
      {
        const L = Math.max(0.6, m.def.bodyRadius * 1.2), W = Math.max(0.4, m.def.bodyRadius * 0.8);
        const fx = Math.sin(myaw), fz = Math.cos(myaw);
        const g = (x: number, z: number): number => sim.world.groundHeight(x, z);
        const lim = 0.18;
        const pitch = m.dead ? 0 : Math.max(-lim, Math.min(lim, -Math.atan2(g(mp.x + fx * L, mp.z + fz * L) - g(mp.x - fx * L, mp.z - fz * L), 2 * L)));
        const roll = m.dead ? 0 : Math.max(-lim, Math.min(lim, Math.atan2(g(mp.x + fz * W, mp.z - fx * W) - g(mp.x - fz * W, mp.z + fx * W), 2 * W)));
        const t = (e.tilt ??= { x: pitch, z: roll });
        const k = Math.min(1, dt * 6);
        t.x += (pitch - t.x) * k;
        t.z += (roll - t.z) * k;
        e.rig.root.rotation.order = 'YXZ';
        e.rig.root.rotation.x = t.x;
        e.rig.root.rotation.z = t.z;
      }
      // 弱った足取り（v0.52.0。#19 の M05「弱った足取りの崩れ」）: 弱って巣へ向かう大型（roam.limping）が歩く間、一歩ごとに片足をかばって
      // 体が片側へ傾き、頭が下がる（描画だけ。歩幅は体の大きさから、進んだ距離で決める。速さ・当たりは simulation のまま。値は Kari の仮の値。
      // 体の高さ（root の y）は変えない: 仮モデルの足の接地が、root の y を地面として使う）
      {
        const L = (e.limp ??= { d: 0, w: 0, x: mp.x, z: mp.z });
        const moved = Math.hypot(mp.x - L.x, mp.z - L.z);
        L.x = mp.x;
        L.z = mp.z;
        const walking = !!m.roam?.limping && !m.action && !m.dead && !m.asleep && m.staggerTicks <= 0 && moved > 0.002 && moved < 2;
        if (walking) L.d += moved;
        L.w += ((walking ? 1 : 0) - L.w) * Math.min(1, dt * 4);
        if (L.w > 0.001) {
          const stride = Math.max(1.2, m.def.bodyRadius * 1.8);
          const hitch = Math.max(0, Math.sin((2 * Math.PI * L.d) / stride)) ** 3;
          e.rig.root.rotation.z += 0.11 * hitch * L.w;
          e.rig.root.rotation.x += 0.05 * L.w;
        }
      }
      e.rig.update(m, { alpha, dt, time: this.time, content, rankOrder: sim.rank?.order, lookAt: pos, fx: this.monsterFx });
      e.shadow.position.set(mp.x, sim.world.groundHeight(mp.x, mp.z) + 0.03, mp.z);
    }
    this.syncHazards(sim);
    this.syncTraps(sim);
    this.syncArrows(sim, alpha);

    // ---- カメラ・光・エフェクト ----
    // フィールド: エリアが変わったら、地形を替えて、カメラを背中側へ合わせる
    if (this.showArea(sim)) this.cam.snap(p.yaw);
    this.prebuildAreas(sim);
    const sens = this.settings.camSensitivity;
    // ロックオン: 標的の照準の位置。ロック中は、左右の視点操作を使わない（上下は使える）
    this.lockPoint = this.lockOn ? this.lockTargetPoint(sim, alpha) : null;
    if (this.lockOn && !this.lockPoint) {
      this.lockOn = false;
      this.lockLost = true;
    }
    if (!this.lockOn) this.lockId = null;
    this.cam.look(this.lockPoint ? 0 : look.x * sens, look.y * sens, this.settings.invertX, this.settings.invertY);
    const shake = this.settings.shake === 'off' ? 0 : this.settings.shake === 'weak' ? 0.5 : 1;
    this.cam.update(dt, { x: pos.x, y: this.renderY, z: pos.z }, sim.world, shake, this.lockPoint);
    if (this.portrait) this.placePortrait(this.portrait, pos);
    else if (this.viewOffset) {
      this.viewOffset = false;
      this.cam.camera.clearViewOffset();
    }
    // 光と影の向きの元は、狩人の足もとの高さ（v0.35.0。里の上の段でも、影の範囲が狩人の周りに来る）
    this.arena.sun.target.position.set(pos.x, this.renderY, pos.z);
    this.arena.sun.position.set(pos.x - 14, this.renderY + 26, pos.z - 11);
    // 空と遠景は、カメラと一緒に動かす（どこまで歩いても、近づかない）。雲は少しずつ流れる
    this.arena.backdrop.position.set(this.cam.camera.position.x, 0, this.cam.camera.position.z);
    // 採掘（v0.27.0）の間だけ、右手に採掘道具
    this.hunter.tool.visible = p.mode === 'action' && p.action?.def.clip === 'common_mine_01';
    if (this.npcs) updateNpcSprites(this.npcs, this.cam.camera.position, this.time);
    // 里の暮らし（v0.35.0）: 水車・昇降台・煙・しぶき・水の流れ。鍛冶の槌の火花と、里の音
    this.ambienceTimer += dt;
    if (this.village) {
      this.renderer.getDrawingBufferSize(this.tmpSize);
      const fr = this.village.update(dt, this.time, { x: pos.x, y: this.renderY + 1.5, z: pos.z }, this.tmpSize.y / 2);
      for (const s of fr.sounds) this.onSound?.(s.id, s.k);
      for (const sp of fr.sparks) this.sparks.emit(7, sp, 2.6, 1.4, 0.35, [1, 0.72, 0.32]);
      if (this.ambienceTimer >= 0.25) {
        this.ambienceTimer = 0;
        this.onAmbience?.(fr.ambience);
      }
    } else if (this.ambienceTimer >= 0.25) {
      this.ambienceTimer = 0;
      // 狩場の風の音は、居るエリアの大きさ（v0.51.0。#19 の F06。広い原・台地は強く、狭い谷・沢・巣は弱く）
      this.onAmbience?.({ water: 0, forge: 0, wind: sim.field ? sim.area()?.look?.wind ?? 1 : 1 });
    }
    if (this.errandProps && sim.errand) updateErrandProps(this.errandProps, sim.errand, sim.areaId, sim.hunt?.phase === 'active', this.cam.camera.position, this.time);
    this.arena.sky?.setTime(this.time);
    WIND.value = this.time;
    this.ailmentFx(sim, dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.rings.update(dt);
    this.drawDebug(sim, alpha, verify);
  }

  /** 状態異常の粉の出る位置: 頭の部位（無ければ体の真ん中の辺り） */
  private ailmentPoint(m: MonsterState): V3 {
    const head = m.def.parts.find((p) => p.head) ?? m.def.parts[0]!;
    const sh = head.shapes[0]!;
    const a = toWorld(fromArr(sh.a), m.pos, m.yaw);
    return { x: a.x, y: m.pos.y + Math.max(0.6, fromArr(sh.a).y + sh.r), z: a.z };
  }

  /** 効いている間の状態異常（v0.33.0）: 毒の泡・麻痺の火花・眠りの淡い粉・気絶の星を、少しずつ出す（見た目だけ） */
  private ailmentTimer = 0;
  private ailmentFx(sim: Simulation, dt: number): void {
    this.ailmentTimer += dt;
    if (this.ailmentTimer < 0.16) return;
    this.ailmentTimer = 0;
    for (const m of sim.monsters) {
      if (m.dead || m.captured || !this.shown(sim, m)) continue;
      const t = m.ailments.ticks;
      if (!STATUS_KINDS.some((k) => t[k] > 0)) continue;
      const at = this.ailmentPoint(m);
      const k = m.herd ? 0.5 : 1;
      if (t.poison > 0) this.dust.emit(Math.max(1, Math.round(2 * k)), { x: m.pos.x + (Math.random() - 0.5) * m.def.bodyRadius, y: m.pos.y + 0.9 * k + Math.random() * 0.6, z: m.pos.z + (Math.random() - 0.5) * m.def.bodyRadius }, 0.4, 0.9, 1.1, AILMENT_FX.poison, 0.3);
      if (t.para > 0) this.sparks.emit(Math.max(1, Math.round(3 * k)), { x: at.x + (Math.random() - 0.5), y: at.y - 0.3, z: at.z + (Math.random() - 0.5) }, 3, 1, 0.25, AILMENT_FX.para);
      if (t.sleep > 0) this.dust.emit(1, { x: at.x, y: at.y + 0.3, z: at.z }, 0.25, 0.7, 1.6, AILMENT_FX.sleep, 0.2);
      if (t.stun > 0) {
        const a = this.time * 4;
        const r = 0.45 * k + 0.2;
        this.sparks.emit(1, { x: at.x + Math.cos(a) * r, y: at.y + 0.35, z: at.z + Math.sin(a) * r }, 0.3, 0.2, 0.45, AILMENT_FX.stun);
        this.sparks.emit(1, { x: at.x - Math.cos(a) * r, y: at.y + 0.35, z: at.z - Math.sin(a) * r }, 0.3, 0.2, 0.45, AILMENT_FX.stun);
      }
    }
  }

  /**
   * ロックオンできる標的の、照準の位置（無ければ null）。標的が居ない・倒れた・捕獲された・別のエリアに居る・70m より遠い時は null。
   * 位置は、部位の当たり形状の真ん中（モンスターの座標で決まった値）を、描画の位置と向きへ置いたもの。
   */
  lockTargetPoint(sim: Simulation, alpha = 1): Vector3 | null {
    const m = this.lockTarget(sim);
    if (this.lockOn) this.lockId = m?.id ?? null;
    if (!m) return null;
    const x = m.prevPos.x + (m.pos.x - m.prevPos.x) * alpha, z = m.prevPos.z + (m.pos.z - m.prevPos.z) * alpha;
    const c = lockCenter(m.def);
    const yaw = m.prevYaw + angleDiff(m.prevYaw, m.yaw) * alpha;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    return this.tmpLock.set(x + c.x * cs + c.z * sn, m.pos.y + c.y, z - c.x * sn + c.z * cs);
  }

  /**
   * ロックできる相手。1 体の標的の依頼では、その標的。群れの依頼では、ロック中の相手が倒れていなければその相手、
   * 倒れたら（または初めは）同じエリアの、いちばん近いまだ倒していない標的。倒れた・捕獲された・別のエリア・70m より遠い相手は選ばない。
   */
  lockTarget(sim: Simulation): MonsterState | null {
    const p = sim.player.pos;
    const ok = (m: MonsterState | null | undefined): m is MonsterState => !!m && !m.dead && !m.captured && this.shown(sim, m) && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) <= 70;
    if (!sim.pack) {
      const m = sim.main ?? sim.monsters[0];
      return ok(m) ? m : null;
    }
    const cur = this.lockOn && this.lockId ? sim.monsters.find((x) => x.id === this.lockId) : undefined;
    if (ok(cur) && sim.livingTargets().includes(cur)) return cur;
    let best: MonsterState | null = null;
    let bd = Infinity;
    for (const m of sim.livingTargets()) {
      if (!ok(m)) continue;
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** 飛んでいる矢を、simulation の位置へ置く（向きは進む向き）。 */
  private syncArrows(sim: Simulation, alpha: number): void {
    const list = sim.projectiles;
    for (let i = 0; i < Math.max(list.length, this.arrows.length); i++) {
      const a = list[i];
      let g = this.arrows[i];
      if (!a) {
        if (g) g.visible = false;
        continue;
      }
      if (!g) {
        g = buildArrow().group;
        this.arrows[i] = g;
        this.scene.add(g);
      }
      g.visible = true;
      const pos = lerpV(a.prevPos, a.pos, alpha);
      g.position.set(pos.x, pos.y, pos.z);
      g.quaternion.setFromUnitVectors(this.tmpA.set(0, 1, 0), this.tmpB.set(a.vel.x, a.vel.y, a.vel.z).normalize());
    }
  }

  private syncTraps(sim: Simulation): void {
    const seen = new Set<number>();
    for (const t of sim.traps) {
      seen.add(t.id);
      let v = this.trapViews.get(t.id);
      if (!v) {
        const group = new Group();
        const ring = new Mesh(new RingGeometry(0.8, 1, 24), new MeshBasicMaterial({ color: 0xd8b56a, transparent: true, depthWrite: false, side: DoubleSide, fog: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        const core = new Mesh(new CylinderGeometry(0.22, 0.3, 0.12, 8), new MeshLambertMaterial({ color: 0x8a7a55 }));
        core.position.y = 0.06;
        group.add(ring, core);
        group.position.set(t.x, sim.world.groundHeight(t.x, t.z), t.z);
        this.scene.add(group);
        v = { group, ring, core };
        this.trapViews.set(t.id, v);
      }
      v.ring.scale.set(t.radius, t.radius, 1);
      const mat = v.ring.material as MeshBasicMaterial;
      if (t.state === 'arming') {
        mat.color.setHex(0x9a9c88);
        mat.opacity = 0.25 + 0.15 * Math.sin(this.time * 10);
      } else if (t.state === 'armed') {
        mat.color.setHex(0xd8b56a);
        mat.opacity = 0.55 + 0.3 * Math.sin(this.time * 4);
      } else {
        mat.color.setHex(0xfff0a0);
        mat.opacity = 0.6 + 0.4 * Math.sin(this.time * 31);
        if (Math.sin(this.time * 17 + t.id) > 0.82) this.sparks.emit(1, { x: t.x + Math.sin(this.time * 9) * t.radius, y: v.group.position.y + 0.3, z: t.z + Math.cos(this.time * 7) * t.radius }, 2, 2.5, 0.35, [1, 0.92, 0.6]);
      }
    }
    for (const [id, v] of this.trapViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      for (const mesh of [v.ring, v.core]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      this.trapViews.delete(id);
    }
  }

  private hazardMat(look: HazardLook): MeshStandardMaterial {
    let m = this.hazardMats.get(look);
    if (!m) {
      const c = HAZARD_COLORS[look];
      m = new MeshStandardMaterial({ color: c.ball, emissive: c.glow, emissiveIntensity: c.glow ? 0.8 : 0, roughness: 0.5, transparent: look === 'mist', opacity: look === 'mist' ? 0.75 : 1 });
      this.hazardMats.set(look, m);
    }
    return m;
  }

  /** 大型 11 種の吹き出し（風圧・音圧・灰の幕・泥跳ね・毒糸）。頭（または尾）の前へ、向きのある粒を出す。見た目だけ */
  private creatureVfx(id: string, m: Simulation['monsters'][number]): void {
    const v = CREATURE_VFX[id]!;
    if (v.around) {
      // 体のまわりへ、8 方向に吹き出す（速さが負なら、まわりから体へ集まる）
      const R = Math.max(0.8, m.def.bodyRadius);
      for (let k = 0; k < 8; k++) {
        const a = m.yaw + (k * Math.PI) / 4;
        const dx = Math.sin(a), dz = Math.cos(a);
        const inward = v.speed < 0;
        const r0 = inward ? R + 2.2 : R * 0.6;
        const o = { x: m.pos.x + dx * r0, y: m.pos.y + (v.y ?? 0.8), z: m.pos.z + dz * r0 };
        const s = inward ? -1 : 1;
        this.dust.emitDir(v.count, o, { x: dx * s, y: v.dirY ?? 0, z: dz * s }, Math.abs(v.speed), v.spread, v.life, v.color, 0.4);
      }
      if (v.rings) for (let k = 1; k <= v.rings; k++) this.rings.spawn(m.pos.x, m.pos.y, m.pos.z, R + 0.8 + k * 0.9, 0.45 + k * 0.12, v.ringColor ?? 0xe9e2c8);
      this.cam.addShake(0.12);
      return;
    }
    const plan = CREATURE_PLANS[m.def.id];
    const tip = plan ? plan.spine[v.rear ? 0 : plan.spine.length - 1]! : null;
    const z = tip && plan ? (tip[0] - plan.origin[0]) * plan.scale : v.rear ? -2 : 2;
    const y = tip && plan ? Math.max(0.4, (plan.origin[1] - tip[1]) * plan.scale) : 1.2;
    const f = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    const s = v.rear ? -1 : 1;
    const at = { x: m.pos.x + f.x * z, y: Math.min(y, v.y ?? y), z: m.pos.z + f.z * z };
    const dir = { x: f.x * s, y: v.dirY ?? -0.05, z: f.z * s };
    for (let k = 0; k < (v.bursts ?? 1); k++) {
      const o = { x: at.x + dir.x * k * 1.2, y: at.y, z: at.z + dir.z * k * 1.2 };
      this.dust.emitDir(v.count, o, dir, v.speed, v.spread, v.life, v.color, 0.4);
    }
    if (v.rings) for (let k = 1; k <= v.rings; k++) this.rings.spawn(at.x + dir.x * k * 2.2, 0, at.z + dir.z * k * 2.2, 1.6 + k * 0.6, 0.5 + k * 0.1, v.ringColor ?? 0xe9e2c8);
    this.cam.addShake(0.15);
  }

  /** 落下物: 落ちる場所に輪を出し、岩を予告時間ちょうどで地面へ届かせる。 */
  private syncHazards(sim: Simulation): void {
    const seen = new Set<number>();
    for (const h of sim.hazards) {
      seen.add(h.id);
      let v = this.hazardViews.get(h.id);
      if (!v) {
        const group = new Group();
        const ring = new Mesh(new RingGeometry(0.86, 1, 28), new MeshBasicMaterial({ color: 0xff7a3a, transparent: true, depthWrite: false, side: DoubleSide, fog: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        const disc = new Mesh(new CylinderGeometry(1, 1, 0.02, 24), new MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
        disc.position.y = 0.04;
        const look = h.look ?? 'rock';
        const rock = look === 'rock' ? new Mesh(this.hazardRock, this.hazardRockMat) : new Mesh(this.hazardBall, this.hazardMat(look));
        rock.castShadow = look !== 'spark' && look !== 'mist';
        rock.visible = look !== 'spark';
        const rc = HAZARD_COLORS[look];
        (ring.material as MeshBasicMaterial).color.setHex(rc.ring);
        (disc.material as MeshBasicMaterial).color.setHex(rc.ring);
        group.add(ring, disc, rock);
        group.position.set(h.x, sim.world.groundHeight(h.x, h.z), h.z);
        this.scene.add(group);
        v = { group, ring, rock, look };
        this.hazardViews.set(h.id, v);
        // 岩が打ち上がった場所に、土ぼこり
        if (h.from) this.dust.emit(5, { x: h.from.x, y: h.from.y + 0.2, z: h.from.z }, 4, 2.6, 0.8, [0.6, 0.58, 0.5], 0.7);
      }
      const u = h.warnTotal > 0 ? h.warn / h.warnTotal : 0;
      v.group.scale.set(h.radius, 1, h.radius);
      (v.ring.material as MeshBasicMaterial).opacity = 0.35 + 0.65 * (1 - u) * (0.7 + 0.3 * Math.sin(this.time * 22));
      if (h.from) {
        // 打ち上がった場所から、弧を描いて落ちる場所へ（u は 1 → 0）。入れ物は落ちる場所にあり、横は半径で拡大されている。
        const w = 1 - u;
        v.rock.position.set(((h.from.x - h.x) * u) / h.radius, 0.5 + (h.from.y - v.group.position.y) * u + h.peak * 4 * w * (1 - w), ((h.from.z - h.z) * u) / h.radius);
      } else {
        v.rock.position.y = 0.5 + 15 * u * u;
      }
      if (v.look === 'rock') {
        v.rock.scale.set(0.55, 0.75 / Math.max(0.5, h.radius) * h.radius, 0.55);
        v.rock.rotation.set(this.time * 3 + h.id, this.time * 2, 0);
      } else {
        // 泥玉・氷片・霧の球・毒の滴: 落ちる場所の大きさに合わせず、決まった大きさ（入れ物は半径で拡大されている）
        const size = v.look === 'mist' ? 0.55 + 0.08 * Math.sin(this.time * 9) : v.look === 'ice' ? 0.35 : 0.3;
        v.rock.scale.set(size / h.radius, (v.look === 'ice' ? size * 1.8 : size), size / h.radius);
        v.rock.rotation.set(this.time * 4 + h.id, this.time * 3, 0);
        // 雷: 予告の間、輪の上に小さな火花
        if (v.look === 'spark' && Math.random() < 0.25) this.sparks.emit(2, { x: h.x + (Math.random() - 0.5) * h.radius, y: v.group.position.y + 0.15, z: h.z + (Math.random() - 0.5) * h.radius }, 2.5, 1.5, 0.25, [1, 0.95, 0.45]);
      }
    }
    for (const [id, v] of this.hazardViews) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      v.ring.geometry.dispose();
      (v.ring.material as MeshBasicMaterial).dispose();
      this.hazardViews.delete(id);
    }
  }

  private drawDebug(sim: Simulation, alpha: number, verify: boolean): void {
    const d = this.debug;
    d.begin();
    if (verify) {
      const p = sim.player;
      const content = this.content;
      const fam = familyOf(p, content);
      const cap = playerHurtCapsule(p, content);
      const guarding = isGuarding(p, fam.guard);
      d.capsule(cap.a, cap.b, cap.r, guarding ? [1, 1, 0.4] : [0.3, 0.9, 1]);
      if (p.action) {
        const t = playerRenderTick(p.action, alpha);
        for (const hw of p.action.def.hitWindows) {
          const tr = content.tracks.get(hw.shapeTrack)!;
          const seg = trackSegment(tr, t);
          const on = inWindow(Math.floor(t), hw);
          d.capsule(toWorld(seg.a, p.pos, p.yaw), toWorld(seg.b, p.pos, p.yaw), tr.radius, on ? [1, 0.15, 0.1] : [0.7, 0.7, 0.3]);
        }
      }
      for (const m of sim.monsters) {
        for (const s of monsterShapes(m)) {
          const part = m.def.parts[s.partIndex]!;
          const c = PART_COLORS[part.id] ?? [1, 1, 1];
          const k = m.dead ? 0.25 : m.parts[s.partIndex]!.broken ? 0.55 : 1;
          d.capsule(s.a, s.b, s.r, [c[0] * k, c[1] * k, c[2] * k]);
        }
        if (!m.dead) for (const b of monsterBlockers(m)) d.circle({ x: b.x, y: m.pos.y + 0.05, z: b.z }, b.r, [0.45, 0.45, 0.45]);
        if (m.action) {
          const t = renderTick(m.action, alpha);
          for (const hw of m.action.def.hitWindows) {
            const tr = content.tracks.get(hw.shapeTrack)!;
            const seg = trackSegment(tr, t);
            const on = inWindow(Math.floor(t), hw);
            d.capsule(toWorld(seg.a, m.pos, m.yaw), toWorld(seg.b, m.pos, m.yaw), tr.radius, on ? [1, 0.15, 0.1] : [0.7, 0.7, 0.3]);
          }
        }
      }
      for (const h of sim.hazards) d.capsule({ x: h.x, y: 0.1, z: h.z }, { x: h.x, y: 1.8, z: h.z }, h.radius, h.warn > 0 ? [0.8, 0.6, 0.2] : [1, 0.15, 0.1]);
    }
    d.end(verify);
  }

  render(): void {
    this.renderer.render(this.scene, this.cam.camera);
  }

  /** 検証表示用の描画統計。 */
  stats(): { calls: number; triangles: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles };
  }

  /** 依頼の切り替えで作り直す時に、古いシーンの GPU 資源を解放する（同じ canvas を使い続けるため）。 */
  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.geometry) return;
      mesh.geometry.dispose();
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (mat as MeshLambertMaterial).map?.dispose();
        (mat as MeshLambertMaterial).normalMap?.dispose();
        mat?.dispose();
      }
      (mesh as unknown as { skeleton?: { dispose(): void } }).skeleton?.dispose();
    });
    this.hazardViews.clear();
    this.renderer.dispose();
  }
}
