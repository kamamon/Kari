// 素材ビューア（viewer.html）。仮リグ・技データ・GLB を、ゲームと同じ部品で表示して検収する。
//   - 骨 / socket / 軸 / 寸法（1m 立方体と比較）
//   - 0.25 / 0.5 / 1 倍速と 1 tick 送り
//   - 正面 / 側面 / 背面 / 斜め後ろ
//   - 攻撃判定の重ね表示（有効区間は赤）
//   - GLB: scene・骨・clip 名・長さ・大きさの一覧。必須 clip の欠落は似た名前で代用せずに表示する。
import { packCharts } from './render/procGeo';
import './ui/style.css';
import {
  AnimationMixer, AxesHelper, Box3, BoxGeometry, Color, DirectionalLight, EdgesGeometry, GridHelper, Group, HemisphereLight, LineBasicMaterial, LineSegments, Object3D,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer, type AnimationClip, type Bone, type SkinnedMesh,
} from 'three';
import { assetUrl, fetchJson, loadContent } from './core/assets';
import type { ActionDef, Content } from './data/schemas';
import { inWindow, newRun, phaseAt } from './game/action';
import { createMonster, monsterShapes, type MonsterState } from './game/monster';
import { sampleTrack, sampleTrackNormal, trackSegment } from './game/tracks';
import { DebugDraw } from './render/debugDraw';
import { GaldrosRig } from './render/galdrosRig';
import { buildArrow, buildBow, buildQuiver } from './render/bow';
import { buildGuardBladeShield, buildGuardBladeSword } from './render/guardBlade';
import { buildHeavyBlade, type WeaponModel } from './render/heavyBlade';
import { DummyRig, type MonsterRig } from './render/monsterRig';
import { CLIPS, JOINTS, climbPose, clipPose, deadPose, emptyPose, hurtPose, locomotionPose, vaultPose } from './render/poses';
import { buildGreatShield, buildLance } from './render/lance';
import { HunterRig } from './render/rig';
import { armorTierOf, type ArmorLook } from './render/hunterArmor';
import { applySolved, canSolve, solveState, stowOffhand, type AnimState } from './render/hunterAnim';
import type { Solved } from './render/bodySolve';
import { GroundedLocomotion, freeStride } from './render/contactLocomotion';
import { groundedHeavyAttack } from './render/heavyBodyMotion';
import { WEAPON_STANCES } from './render/weaponClipSpecs';
import { motionSetOf, useMotionSet } from './render/motionSet';
import { buildLongBlade, buildTwinBlade, buildWarMaul } from './render/forgedWeapons';
import { withShell } from './render/shellPlates';
import {startHubRoom} from './render/hubRoom';

interface ManifestAsset {
  id: string;
  type: string;
  path: string | null;
  status: string;
  clips?: string[];
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none';
panel.style.cssText =
  'position:absolute;left:0;top:0;bottom:0;width:min(46vw,340px);overflow:auto;padding:10px;background:rgba(14,18,15,.86);font-size:12px;line-height:1.5;-webkit-user-select:text;user-select:text;touch-action:pan-y';

const renderer = new WebGLRenderer({ canvas, antialias: true });
const scene = new Scene();
scene.background = new Color(0x2a322c);
scene.add(new HemisphereLight(0xe6efe2, 0x56624f, 1.2));
const sun = new DirectionalLight(0xfff0d2, 1.8);
sun.position.set(-3, 6, 4);
scene.add(sun);
const camera = new PerspectiveCamera(40, 1, 0.05, 200);
const grid = new GridHelper(10, 10, 0x7d9274, 0x46524a);
scene.add(grid);
// 物差し: 1m 立方体の枠と軸（X 赤 / Y 緑 / Z 青。+Z が前）
const cube = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1)), new LineBasicMaterial({ color: 0xb08d57 }));
cube.position.set(1.6, 0.5, 0);
const axes = new AxesHelper(1);
axes.position.set(1.1, 0.001, -0.5);
scene.add(cube, axes);
const debug = new DebugDraw(scene);

const hunter = new HunterRig();
const MONSTER_IDS = { dummy: 'monster.training_dummy', galdros: 'monster.galdros' } as const;
type MonsterKey = keyof typeof MONSTER_IDS;
const monsters = {} as Record<MonsterKey, { m: MonsterState; rig: MonsterRig }>;
let damaged = false;
/**
 * 確認用（v0.36.0）: 技以外の姿勢を見る。?pose=topple|flinch|sleep|stun|dead と ?tick=（転倒・怯み・死の経過 tick）。
 * 戦闘の状態（怯みの種類・残り・全体、睡眠、気絶、死）を置いて、ゲームと同じ update を通す。部位の形（追従）も同じ状態から出る。
 */
let posePreview: { kind: 'topple' | 'flinch' | 'sleep' | 'stun' | 'dead'; tick: number } | null = null;
/** ハンターの被弾の形の確認（v0.64.0。?hurt=flinch|knockdown|bounce&rel=押された向き（体から測った角度。π = 後ろへ）&tick=） */
let hurtPreview: { kind: 'flinch' | 'knockdown' | 'bounce' | 'dead'; tick: number; rel: number } | null = null;
/** 登攀と乗り越えの形の確認（v0.69.0。?climb=mount|down|climb|exit&u=段の進み（0〜1）&h=壁での足の高さ（m） / ?vault=進み（0〜1）） */
let climbPreview: { phase: 'mount' | 'down' | 'climb' | 'exit' | 'vault'; u: number; h: number } | null = null;
const socketAxes: AxesHelper[] = [];
for (const s of Object.values(hunter.sockets)) {
  const a = new AxesHelper(0.14);
  s.add(a);
  socketAxes.push(a);
}
// 武器の一覧: 設定図から組んだ仮モデルを、立てて並べる（ハンターは大きさの目安）。ゲームに出ているのは断岳剣だけ。
// 剣と鎌は、設定図の正面（-X の面）が手前（+Z）を向くように 90 度回す。
const rack = new Group();
rack.visible = false;
scene.add(rack);
const rackModels: Record<string, WeaponModel> = {};
const stand = (key: string, model: WeaponModel, x: number, y: number, turn: number): void => {
  model.group.position.set(x, y, 0);
  model.group.rotation.y = turn;
  rack.add(model.group);
  rackModels[key] = model;
};
// 左から: 護刃（盾・剣）、断岳剣、長尖槍（槍・大盾）、ハンター、大槌・双剣・太刀（依頼 6 の設定図から。forgedWeapons.ts）、環弓（弓・矢・矢筒）
// URL に ?tier=2〜5 を付けると、強化後（2 岩殻・3 脈殻・4 晶殻・5 輝殻。元の形に岩の板を足した仮の形）を並べる
const tierParam = Number(new URLSearchParams(location.search).get('tier'));
const tier = [2, 3, 4, 5].includes(tierParam) ? tierParam : 0;
const up = (base: WeaponModel, fam: string): WeaponModel => (tier ? withShell(base, `model.weapon.${fam}.00${tier}`) : base);
// URL に ?armor=2〜5 を付けると、ハンターが防具（2 岩殻・3 脈殻・4 晶殻・5 輝殻）を着る。?armorSlots=head,chest で部位を絞れる
const armorParam = Number(new URLSearchParams(location.search).get('armor'));
const armorSlots = (new URLSearchParams(location.search).get('armorSlots') ?? 'head,chest,arms,waist,legs').split(',');
const armorLook: ArmorLook = [2, 3, 4, 5].includes(armorParam) ? Object.fromEntries(armorSlots.map((s) => [s, armorParam])) : {};
/** ?tier= を付けた時、ハンターにも強化後の形を持たせる */
let previewWeaponId: string | null = null;
const held = (fam: string): string | undefined => {
  const w=previewWeaponId?content.weapons.get(previewWeaponId):undefined;
  return w?.family===fam?w.assetId:tier?`model.weapon.${fam}.00${tier}`:undefined;
};
stand('guardShield', buildGuardBladeShield(), -3.0, 0.3, 0);
stand('guardSword', up(buildGuardBladeSword(), 'guard_blade'), -2.68, 0.1224, Math.PI / 2);
stand('heavyBlade', buildHeavyBlade(), -2.27, 0.155, Math.PI / 2);
// 岩殻の断岳剣（強化後。設定図は無く、岩の板を足しただけの仮の形）
stand('heavyBladeShell', buildHeavyBlade('shell', tier || 2), -1.8, 0.155, Math.PI / 2);
stand('lance', up(buildLance(), 'long_lance'), -1.35, 0.541, Math.PI / 2);
stand('greatShield', buildGreatShield(), -0.85, 0.55, 0);
stand('warMaul', up(buildWarMaul(), 'war_maul'), 0.95, 0.2, Math.PI / 2);
stand('twinBladeR', up(buildTwinBlade(), 'twin_blades'), 1.35, 0.1, Math.PI / 2);
stand('twinBladeL', up(buildTwinBlade(), 'twin_blades'), 1.6, 0.1, Math.PI / 2);
stand('longBlade', up(buildLongBlade(), 'long_blade'), 2.0, 0.29, Math.PI / 2);
stand('bow', up(buildBow(), 'ring_bow'), 2.5, 0.75, Math.PI / 2);
stand('arrow', buildArrow(), 2.9, 0.4, Math.PI / 2);
stand('quiver', buildQuiver(), 3.2, 0.303, Math.PI / 2);

let glbRoot: Object3D | null = null;
let glbMixer: AnimationMixer | null = null;
let glbClips: AnimationClip[] = [];
let glbInfo = '';

const state = {
  subject: 'hunter' as 'hunter' | MonsterKey | 'glb' | 'weapons',
  actionId: '',
  tick: 0,
  playing: true,
  speed: 1,
  bones: true,
  shapes: true,
  /** 技を選んでいない時に見せる立ち姿: none = 納刀の歩き / idle = 構え / walk = 構えたまま歩く / guard = 防御（確認用。URL の stance= と family= で決める） */
  stance: 'none' as 'none' | 'idle' | 'walk' | 'guard',
  stanceFamily: 'guard_blade',
  camYaw: Math.PI * 0.75,
  camPitch: 0.18,
  camDist: 5.2,
  /** 注目する点の高さと前後（確認用の指定。NaN は既定） */
  lookY: NaN,
  lookZ: 0,
  lookX: 0,
  /** 納刀の歩き・走りを見る速さ（m/s。確認用。URL の move=。v0.58.0） */
  move: 4,
};

let content: Content;
let restHeight = 0;
let manifest: ManifestAsset[] = [];

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// 視点: ドラッグで回す
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.camYaw -= (e.clientX - drag.x) * 0.008;
  state.camPitch = Math.max(-0.2, Math.min(1.3, state.camPitch + (e.clientY - drag.y) * 0.006));
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointercancel', () => (drag = null));
canvas.addEventListener('wheel', (e) => (state.camDist = Math.max(1.5, Math.min(14, state.camDist + e.deltaY * 0.004))));

function actionsFor(subject: string): ActionDef[] {
  const all = [...content.actions.values()];
  if (subject === 'dummy') return all.filter((a) => a.actionId.startsWith('monster.training_dummy.'));
  if (subject === 'galdros') return all.filter((a) => a.actionId.startsWith('monster.galdros.'));
  if (subject === 'weapons') return [];
  return all.filter((a) => a.actionId.startsWith('player.'));
}

function button(label: string, onClick: () => void, parent: HTMLElement): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'margin:2px;padding:7px 9px;background:#2a332d;color:inherit;border:1px solid rgba(235,231,215,.25);border-radius:3px;font-size:12px';
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

const info = document.createElement('pre');
info.style.cssText = 'white-space:pre-wrap;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:8px 0 0';
let tickLabel: HTMLElement;
let slider: HTMLInputElement;
let actionSelect: HTMLSelectElement;

function buildPanel(): void {
  panel.textContent = '';
  const h = document.createElement('div');
  h.innerHTML = '<b>素材ビューア</b> <a href="./" style="color:#b89460">ゲームへ戻る</a>';
  panel.appendChild(h);
  const row = (): HTMLElement => {
    const d = document.createElement('div');
    d.style.margin = '6px 0';
    panel.appendChild(d);
    return d;
  };
  const r1 = row();
  button('ハンター', () => setSubject('hunter'), r1);
  button('訓練標的', () => setSubject('dummy'), r1);
  button('ガルドロス', () => setSubject('galdros'), r1);
  button('武器', () => {
    setSubject('weapons');
    state.camYaw = 0;
  }, r1);
  for (const a of manifest.filter((m) => m.type === 'model' && m.path?.endsWith('.glb'))) button(`GLB: ${a.id}`, () => void loadGlb(a.path!), r1);
  const r2 = row();
  actionSelect = document.createElement('select');
  actionSelect.style.cssText = 'width:100%;padding:7px;background:#2a332d;color:inherit;border:1px solid rgba(235,231,215,.25)';
  actionSelect.addEventListener('change', () => {
    state.actionId = actionSelect.value;
    state.tick = 0;
    syncSlider();
  });
  r2.appendChild(actionSelect);
  const r3 = row();
  button('再生 / 停止', () => (state.playing = !state.playing), r3);
  for (const s of [0.25, 0.5, 1]) button(`${s}倍`, () => (state.speed = s), r3);
  button('−1 tick', () => step(-1), r3);
  button('+1 tick', () => step(1), r3);
  slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.step = '1';
  slider.style.width = '100%';
  slider.addEventListener('input', () => {
    state.playing = false;
    state.tick = Number(slider.value);
  });
  panel.appendChild(slider);
  tickLabel = document.createElement('div');
  panel.appendChild(tickLabel);
  const r4 = row();
  const view = (label: string, yaw: number, pitch = 0.12): void => {
    button(label, () => {
      state.camYaw = yaw;
      state.camPitch = pitch;
    }, r4);
  };
  // カメラの位置（キャラクターは +Z を向く）
  view('正面', 0);
  view('側面', -Math.PI / 2);
  view('背面', Math.PI);
  view('斜め後ろ', Math.PI * 0.75, 0.25);
  const r5 = row();
  button('骨・socket', () => (state.bones = !state.bones), r5);
  button('判定', () => (state.shapes = !state.shapes), r5);
  button('破壊・切断の姿', () => (damaged = !damaged), r5);
  panel.appendChild(info);
}

function syncActions(): void {
  actionSelect.textContent = '';
  const idle = document.createElement('option');
  idle.value = '';
  idle.textContent = state.subject === 'glb' ? '（GLB の clip は下の一覧）' : '待機 / 歩行（手続き生成）';
  actionSelect.appendChild(idle);
  if (state.subject !== 'glb') {
    for (const a of actionsFor(state.subject)) {
      const o = document.createElement('option');
      o.value = a.actionId;
      o.textContent = `${a.actionId}  [${a.clip}]`;
      actionSelect.appendChild(o);
    }
  }
  actionSelect.value = state.actionId;
  syncSlider();
}

function syncSlider(): void {
  const a = content.actions.get(state.actionId);
  slider.max = String(a ? a.durationTicks : 120);
  slider.value = String(Math.floor(state.tick));
}

function setSubject(s: 'hunter' | MonsterKey | 'glb' | 'weapons'): void {
  state.subject = s;
  state.actionId = '';
  state.tick = 0;
  hunter.root.visible = s === 'hunter' || s === 'weapons';
  rack.visible = s === 'weapons';
  // 一覧では、ハンターは大きさの目安として立たせるだけ（手の剣と、取り付け位置の印は消す）
  hunter.weapon.visible = s !== 'weapons';
  if (s === 'weapons') hunter.shield.visible = false;
  state.lookX = s === 'weapons' ? -0.35 : 0; // 一覧は左右に長いので、中央を見る
  cube.visible = axes.visible = s !== 'weapons'; // 物差しの立方体は、並べた武器と重なるので消す
  if (s === 'weapons') for (const ax of socketAxes) ax.visible = false;
  for (const [k, v] of Object.entries(monsters)) v.rig.root.visible = s === k;
  if (glbRoot) glbRoot.visible = s === 'glb';
  state.camDist = s === 'dummy' ? 9 : s === 'galdros' ? 10 : s === 'weapons' ? 9 : 5.2;
  syncActions();
}

function step(d: number): void {
  state.playing = false;
  const a = content.actions.get(state.actionId);
  const max = a ? a.durationTicks : 120;
  state.tick = (Math.floor(state.tick) + d + max) % max;
}

/** GLB を読み、scene・骨・clip・大きさを一覧にする。 */
async function loadGlb(path: string): Promise<void> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  try {
    const gltf = await new GLTFLoader().loadAsync(assetUrl(path));
    if (glbRoot) scene.remove(glbRoot);
    glbRoot = gltf.scene;
    scene.add(glbRoot);
    glbClips = gltf.animations;
    glbMixer = glbClips.length > 0 ? new AnimationMixer(glbRoot) : null;
    if (glbMixer && glbClips[0]) glbMixer.clipAction(glbClips[0]).play();
    const box = new Box3().setFromObject(glbRoot);
    const size = box.getSize(new Vector3());
    const bones: string[] = [];
    let meshes = 0;
    let tris = 0;
    glbRoot.traverse((o) => {
      if ((o as Bone).isBone) bones.push(o.name);
      const m = o as SkinnedMesh;
      if (m.isMesh) {
        meshes++;
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      }
    });
    const sockets = ['socket_hand_r', 'socket_hand_l', 'socket_back', 'socket_hip'];
    const missingSockets = sockets.filter((n) => !glbRoot!.getObjectByName(n));
    const entry = manifest.find((m) => m.path === path);
    const need = entry?.clips ?? [];
    const have = new Set(glbClips.map((c) => c.name));
    const missingClips = need.filter((n) => !have.has(n));
    glbInfo = [
      `GLB: ${path}`,
      `大きさ (m): 幅 ${size.x.toFixed(3)} / 高さ ${size.y.toFixed(3)} / 奥行 ${size.z.toFixed(3)}`,
      `底面 y=${box.min.y.toFixed(3)}  前端 z=${box.max.z.toFixed(3)}（+Z が前）`,
      `mesh ${meshes} / 三角形 ${Math.round(tris)} / 骨 ${bones.length}`,
      bones.length ? `骨: ${bones.join(', ')}` : '骨: なし',
      `socket の欠落: ${bones.length ? (missingSockets.length ? missingSockets.join(', ') : 'なし') : '（リグ無しのため対象外）'}`,
      `clip ${glbClips.length}: ${glbClips.map((c) => `${c.name} ${c.duration.toFixed(3)}s=${Math.round(c.duration * 60)}tick`).join(' / ') || 'なし'}`,
      `必須 clip の欠落: ${need.length ? (missingClips.length ? missingClips.join(', ') : 'なし') : '（台帳に必須 clip の指定なし）'}`,
    ].join('\n');
    setSubject('glb');
  } catch (e) {
    glbInfo = `GLB の読み込みに失敗: ${path}\n${e instanceof Error ? e.message : String(e)}`;
    setSubject('glb');
  }
}

/** 納めた武器を、その武器系統の置き場所へ付ける */
function sheathWeapon(fam: { id: string; sheathSocket?: 'back' | 'hip' }): void {
  const sh = WEAPON_STANCES[fam.id]?.sheath;
  if (sh) hunter.weaponToSheath(sh);
  else hunter.weaponToSocket(fam.sheathSocket ?? 'back');
}

let last = 0;
let time = 0;
/** 直前に解いた姿（検査用に window.__viewer から読める） */
let lastSolved: Solved | null = null;
function frame(ts: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (ts - last) / 1000 || 0);
  last = ts;
  time += dt;
  const a = content.actions.get(state.actionId);
  const duration = a ? a.durationTicks : 120;
  if (state.playing) state.tick = (state.tick + dt * 60 * state.speed) % duration;
  const t = state.tick;
  slider.value = String(Math.floor(t));
  const lines: string[] = [];
  debug.begin();

  if (state.subject === 'hunter') {
    // 技の id（player.<系統>.<技>）から武器系統を決め、その武器と盾を持たせる。共通の技は断岳剣で見せる。
    const fam = content.families.get(a?.actionId.split('.')[1] ?? (previewWeaponId?content.weapons.get(previewWeaponId)?.family??'':'')) ?? content.families.get('heavy_blade')!;
    hunter.setArmor(armorLook);
    hunter.setFamily(fam.id, fam.offhand, held(fam.id));
    let missing = false;
    const st: AnimState | null = a ? { kind: 'action', clip: a.clip, t, dirAngle: 0, chargeTicks: 0, freeMove: false } : state.stance !== 'none' ? (state.stance === 'guard' ? { kind: 'guard', blend: 1, shake: 0 } : { kind: 'idle' }) : null;
    const stFam = a ? fam : content.families.get(state.stanceFamily) ?? fam;
    if (climbPreview && !a) {
      // 登攀・乗り越え（納刀したまま。ゲームと同じ climbPose / vaultPose。再生中は climb の高さを上へ動かす）
      lastSolved = null;
      hunter.setString(null);
      const cp = climbPreview;
      const pose = cp.phase === 'vault' ? vaultPose(state.playing ? (time * 0.9) % 1 : cp.u) : climbPose(cp.phase, state.playing && cp.phase !== 'climb' ? (time * 0.8) % 1 : cp.u, state.playing && cp.phase === 'climb' ? time * 1.5 : cp.h);
      hunter.setPose(pose);
      sheathWeapon(fam);
      if (fam.offhand) stowOffhand(hunter, fam.id);
    } else if (hurtPreview && !a) {
      // 被弾の形（納刀したまま。ゲームと同じ hurtPose。転倒は押された向きへ倒れる）
      lastSolved = null;
      hunter.setString(null);
      const D = hurtPreview.kind === 'dead' ? 60 : hurtPreview.kind === 'knockdown' ? content.player.knockdownTicks : hurtPreview.kind === 'bounce' ? content.edge.bounce.recoilTicks : content.player.flinchTicks;
      const tk = state.playing ? (time * 60) % D : hurtPreview.tick;
      const pose = hurtPreview.kind === 'dead' ? deadPose(tk) : hurtPose(hurtPreview.kind, tk, D, false, hurtPreview.rel);
      if (hurtPreview.kind === 'knockdown') pose.tumbleDir = hurtPreview.rel - Math.PI;
      hunter.setPose(pose);
      sheathWeapon(fam);
      if (fam.offhand) stowOffhand(hunter, fam.id);
    } else if (st && canSolve(stFam.id, st)) {
      // 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）: ゲームと同じ解き方で、体・武器・盾を置く
      hunter.setFamily(stFam.id, stFam.offhand, held(stFam.id));
      const sol = solveState(stFam.id, st, state.stance === 'walk' ? stFam.drawnMoveSpeed : 0, state.stance === 'walk' ? t / 60 : time);
      applySolved(hunter, sol, stFam.id);
      lastSolved = sol;
    } else if (a) {
      lastSolved = null;
      hunter.setString(null);
      let pose = clipPose(a.clip, t);
      if (pose && fam.id === 'heavy_blade') pose = groundedHeavyAttack(pose, a.clip, t);
      missing = !pose;
      hunter.setPose(pose ?? emptyPose());
      if (a.weaponTrack) {
        const tr = content.tracks.get(a.weaponTrack)!;
        const s = sampleTrack(tr, t);
        const shoot = a.shoot?.[0];
        const other = shoot && fam.primaryHand === 'left' && t < shoot.tick ? { x: 0, y: 0.02, z: 0.17 + 0.36 * Math.min(1, t / shoot.tick) } : null;
        const n = sampleTrackNormal(tr, t);
        hunter.weaponToTrack(s.grip, s.dir, [n.x, n.y, n.z], { two: fam.twoHanded, along: fam.otherHandAlong, primary: fam.primaryHand, other });
        if (fam.offhand && fam.offhandReady) {
          const at = a.offhandTrack ? sampleTrack(content.tracks.get(a.offhandTrack)!, t).grip : { x: fam.offhandReady[0], y: fam.offhandReady[1], z: fam.offhandReady[2] };
          hunter.shieldTo(at, a.offhandTrack ? 0 : 0.5);
        }
      } else {
        sheathWeapon(fam);
        if (fam.offhand) stowOffhand(hunter, fam.id);
      }
    } else {
      lastSolved = null;
      hunter.setString(null);
      const speed = t < 60 ? 0 : state.move;
      const phase = t / 60 * speed * Math.PI * 2 / freeStride(speed, false);
      const pose = locomotionPose(false, speed, phase, time);
      // ビューアはその場で周期を確認する。ゲームでは状態を保持して世界接地する。
      hunter.setPose(new GroundedLocomotion().frame(pose, false, speed, phase, 0, { x: 0, z: 0, yaw: 0 }));
      sheathWeapon(fam);
      if (fam.offhand) stowOffhand(hunter, fam.id);
    }
    hunter.root.updateMatrixWorld(true);
    lines.push(`仮リグ: 関節 ${JOINTS.length} / socket ${Object.keys(hunter.sockets).length} / 全高 ${restHeight.toFixed(3)}m（基準姿勢。規格は 1.75m）`);
    lines.push(`socket: ${Object.values(hunter.sockets).map((s) => s.name).join(', ')}`);
    lines.push(`仮 clip ${Object.keys(CLIPS).length}: ${Object.keys(CLIPS).join(', ')}`);
    if (a && missing) lines.push(`⚠ 欠落 clip: ${a.clip}（似た clip で代用していません）`);
    if (state.bones) {
      for (const n of JOINTS) {
        const j = hunter.joints[n];
        const p = j.getWorldPosition(new Vector3());
        const parent = j.parent && j.parent !== hunter.root ? j.parent.getWorldPosition(new Vector3()) : null;
        if (parent && j.parent!.name) debug.line(parent, p, [1, 1, 1]);
        debug.capsule(p, null, 0.018, [1, 0.85, 0.4]);
      }
    }
    for (const ax of socketAxes) ax.visible = state.bones;
  } else if (state.subject !== 'glb' && state.subject !== 'weapons') {
    // モンスター: ゲームと同じ update を通す（行動の時刻だけビューアが決める）
    const { m, rig } = monsters[state.subject];
    if (a) {
      m.action = newRun(a, 1, 0);
      m.action.tick = Math.floor(t) + 1;
      m.action.advanced = true;
    } else m.action = null;
    m.def.parts.forEach((d, i) => {
      m.parts[i]!.broken = damaged && d.breakDurability !== null;
      m.parts[i]!.severed = damaged && !!d.sever;
    });
    if (posePreview) {
      const k = posePreview.kind, at = state.playing ? Math.floor(time * 60) : posePreview.tick;
      const total = k === 'topple' ? 190 : 46;
      m.action = null;
      m.asleep = k === 'sleep';
      m.ailments.ticks.stun = k === 'stun' ? 100 : 0;
      m.dead = k === 'dead';
      m.deadTicks = at;
      m.staggerKind = k === 'topple' || k === 'flinch' ? k : null;
      m.staggerTotal = m.staggerKind ? total : 0;
      m.staggerTicks = m.staggerKind ? Math.max(1, total - (at % total)) : 0;
    }
    rig.update(m, { alpha: t - Math.floor(t), dt, time, content });
    if (state.shapes) {
      for (const sh of monsterShapes(m)) debug.capsule(sh.a, sh.b, sh.r, [0.5, 0.8, 1]);
    }
    lines.push(`${m.def.name}: 部位 ${m.def.parts.map((p) => `${p.name}(斬 ${p.hitzone.cut})`).join(' / ')}`);
    lines.push(`表示: ${damaged ? '頭・背殻を破壊、尾を切断した姿' : '通常の姿'}`);
  } else {
    glbMixer?.update(state.playing ? dt * state.speed : 0);
    lines.push(glbInfo);
  }

  if (a && state.subject !== 'glb') {
    const ph = phaseAt(a, Math.min(Math.floor(t), a.durationTicks - 1));
    lines.push('', `${a.actionId}`, `clip ${a.clip} / ${a.durationTicks}tick = ${(a.durationTicks / 60).toFixed(2)}秒 / いま ${ph?.id ?? '-'}`);
    lines.push(`区間: ${a.phases.map((p) => `${p.id}[${p.from},${p.to})`).join(' ')}`);
    for (const hw of a.hitWindows) {
      const tr = content.tracks.get(hw.shapeTrack)!;
      const on = inWindow(Math.floor(t), hw);
      lines.push(`判定 ${hw.id}[${hw.from},${hw.to}) ${hw.damageType} ×${hw.damageCoefficient} hitstop ${hw.hitstopTicks}${on ? '  ← 有効' : ''}`);
      if (state.shapes) {
        const seg = trackSegment(tr, t);
        debug.capsule(seg.a, seg.b, tr.radius, on ? [1, 0.15, 0.1] : [0.7, 0.7, 0.3]);
      }
    }
    for (const c of a.cancelWindows) lines.push(`キャンセル [${c.from},${c.to}) → ${c.into.join(', ')}`);
    if (a.invulnerable) lines.push(`無敵 ${a.invulnerable.map((w) => `[${w.from},${w.to})`).join(' ')}`);
    if (a.charge) lines.push(`溜め: ${a.charge.holdTick}tick で保持 / 段階 ${a.charge.levelTicks.join(',')} / 倍率 ${a.charge.coefficientScale.join(',')}`);
    lines.push(`イベント: ${a.events.map((e) => `${e.tick}:${e.type}:${e.id}`).join(' ') || 'なし'}`);
  }
  debug.end(true);
  tickLabel.textContent = `tick ${Math.floor(t)} / ${duration}   ${state.speed}倍速 ${state.playing ? '再生中' : '停止'}`;
  const text = lines.join('\n');
  if (info.textContent !== text) info.textContent = text;

  const target = new Vector3(state.lookX, Number.isNaN(state.lookY) ? (state.subject === 'dummy' || state.subject === 'galdros' ? 1.2 : 0.95) : state.lookY, state.lookZ);
  const cp = Math.cos(state.camPitch);
  // 正面 = カメラがキャラクターの前（+Z 側）に立つ
  camera.position.set(target.x + Math.sin(state.camYaw) * cp * state.camDist, target.y + Math.sin(state.camPitch) * state.camDist, target.z + Math.cos(state.camYaw) * cp * state.camDist);
  camera.lookAt(target);
  // パネルの分だけ被写体を右へ寄せる
  camera.setViewOffset(canvas.clientWidth, canvas.clientHeight, -Math.min(canvas.clientWidth * 0.23, 170), 0, canvas.clientWidth, canvas.clientHeight);
  renderer.render(scene, camera);
}

async function main(): Promise<void> {
  try {
    // ハンターの動きの組（v0.57.0。D-150）: ?motions=v056 で、v0.56.0 までの動き（保留）を見る
    const motionSet = motionSetOf(new URLSearchParams(location.search).get('motions'));
    content = await loadContent({ motionSet });
    await useMotionSet(motionSet);
    const doc = (await fetchJson('data/asset-manifest.json')) as { assets: ManifestAsset[] };
    manifest = doc.assets;
  } catch (e) {
    panel.textContent = `読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  if(new URLSearchParams(location.search).get('room')==='home'){startHubRoom(renderer,canvas,panel,content,new URLSearchParams(location.search));return;}
  scene.add(hunter.root);
  for (const [key, id] of Object.entries(MONSTER_IDS) as [MonsterKey, string][]) {
    const def = content.monsters.get(id)!;
    const m = createMonster(def, { x: 0, z: 0, yaw: 0 }, key);
    m.aware = true;
    const ids = def.parts.map((p) => p.id);
    const rig: MonsterRig = def.rigFamily === 'quadruped_heavy' ? new GaldrosRig(ids) : new DummyRig(ids);
    monsters[key] = { m, rig };
    scene.add(rig.root);
  }
  hunter.setPose(emptyPose());
  restHeight = hunter.measureHeight();
  buildPanel();
  resize();
  setSubject('hunter');
  const q = new URLSearchParams(location.search);
  const act = q.get('action');
  if (act && content.actions.has(act)) {
    if (act.startsWith('monster.galdros.')) setSubject('galdros');
    else if (act.startsWith('monster.')) setSubject('dummy');
    state.actionId = act;
    actionSelect.value = act;
    syncSlider();
  }
  if (q.has('tick')) {
    state.playing = false;
    state.tick = Number(q.get('tick'));
  }
  if (q.has('yaw')) state.camYaw = Number(q.get('yaw'));
  if (q.get('subject') === 'galdros' && !act) setSubject('galdros');
  if (q.get('subject') === 'weapons') {
    setSubject('weapons');
    if (!q.has('yaw')) state.camYaw = 0;
  }
  if (q.has('damaged')) damaged = true;
  const hz = q.get('hurt');
  if (hz === 'flinch' || hz === 'knockdown' || hz === 'bounce' || hz === 'dead') hurtPreview = { kind: hz, tick: Number(q.get('tick') ?? 0), rel: q.has('rel') ? Number(q.get('rel')) : Math.PI };
  const cz = q.get('climb');
  if (cz === 'mount' || cz === 'down' || cz === 'climb' || cz === 'exit') climbPreview = { phase: cz, u: Number(q.get('u') ?? 0.5), h: Number(q.get('h') ?? 0) };
  if (q.has('vault')) climbPreview = { phase: 'vault', u: Number(q.get('vault') ?? 0.5), h: 0 };
  const pz = q.get('pose');
  if (pz === 'topple' || pz === 'flinch' || pz === 'sleep' || pz === 'stun' || pz === 'dead') {
    setSubject('galdros');
    posePreview = { kind: pz, tick: Number(q.get('tick') ?? 0) };
  }
  // 確認用の静止画のための指定: 距離、見上げ・見下ろしの角度、注目する高さと前後
  if (q.has('dist')) state.camDist = Number(q.get('dist'));
  if (q.has('pitch')) state.camPitch = Number(q.get('pitch'));
  if (q.has('ty')) state.lookY = Number(q.get('ty'));
  if (q.has('tz')) state.lookZ = Number(q.get('tz'));
  if (q.has('tx')) state.lookX = Number(q.get('tx'));
  if (q.has('move')) state.move = Number(q.get('move'));
  const stance = q.get('stance');
  if (stance === 'idle' || stance === 'walk' || stance === 'guard') state.stance = stance;
  if (q.get('family')) state.stanceFamily = q.get('family')!;
  const pw=q.get('previewWeapon'),pa=q.get('previewArmor');
  if(pw&&content.weapons.has(pw)){previewWeaponId=pw;state.stanceFamily=content.weapons.get(pw)!.family;state.stance='idle';state.bones=false;state.shapes=false;}
  if(pa){const armor=content.armor.get(pa);if(armor){armorLook[armor.slot]=armorTierOf(armor.assetId);state.stance='idle';state.bones=false;state.shapes=false;}}
  if (q.get('shapes') === '0') state.shapes = false;
  if (q.get('bones') === '0') state.bones = false;
  const glb = q.get('glb');
  if (glb) await loadGlb(glb);
  (window as unknown as { __viewer?: unknown }).__viewer = { state, monsters, packCharts, hunter, rack: rackModels, solved: () => lastSolved };
  requestAnimationFrame(frame);
}

void main();
