// 素材ビューア（viewer.html）。仮リグ・技データ・GLB を、ゲームと同じ部品で表示して検収する。
//   - 骨 / socket / 軸 / 寸法（1m 立方体と比較）
//   - 0.25 / 0.5 / 1 倍速と 1 tick 送り
//   - 正面 / 側面 / 背面 / 斜め後ろ
//   - 攻撃判定の重ね表示（有効区間は赤）
//   - GLB: scene・骨・clip 名・長さ・大きさの一覧。必須 clip の欠落は似た名前で代用せずに表示する。
import './ui/style.css';
import {
  AnimationMixer, AxesHelper, Box3, BoxGeometry, Color, DirectionalLight, EdgesGeometry, GridHelper, HemisphereLight, LineBasicMaterial, LineSegments, Object3D,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer, type AnimationClip, type Bone, type SkinnedMesh,
} from 'three';
import { assetUrl, fetchJson, loadContent } from './core/assets';
import type { ActionDef, Content } from './data/schemas';
import { inWindow, newRun, phaseAt } from './game/action';
import { createMonster, monsterShapes, type MonsterState } from './game/monster';
import { sampleTrack, trackSegment } from './game/tracks';
import { DebugDraw } from './render/debugDraw';
import { GaldrosRig } from './render/galdrosRig';
import { DummyRig, type MonsterRig } from './render/monsterRig';
import { CLIPS, JOINTS, clipPose, emptyPose, locomotionPose } from './render/poses';
import { HunterRig } from './render/rig';

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
const socketAxes: AxesHelper[] = [];
for (const s of Object.values(hunter.sockets)) {
  const a = new AxesHelper(0.14);
  s.add(a);
  socketAxes.push(a);
}
let glbRoot: Object3D | null = null;
let glbMixer: AnimationMixer | null = null;
let glbClips: AnimationClip[] = [];
let glbInfo = '';

const state = {
  subject: 'hunter' as 'hunter' | MonsterKey | 'glb',
  actionId: '',
  tick: 0,
  playing: true,
  speed: 1,
  bones: true,
  shapes: true,
  camYaw: Math.PI * 0.75,
  camPitch: 0.18,
  camDist: 5.2,
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

function setSubject(s: 'hunter' | MonsterKey | 'glb'): void {
  state.subject = s;
  state.actionId = '';
  state.tick = 0;
  hunter.root.visible = s === 'hunter';
  for (const [k, v] of Object.entries(monsters)) v.rig.root.visible = s === k;
  if (glbRoot) glbRoot.visible = s === 'glb';
  state.camDist = s === 'dummy' ? 9 : s === 'galdros' ? 10 : 5.2;
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

let last = 0;
let time = 0;
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
    const fam = content.families.get('heavy_blade')!;
    let missing = false;
    if (a) {
      const pose = clipPose(a.clip, t);
      missing = !pose;
      hunter.setPose(pose ?? emptyPose());
      if (a.weaponTrack) {
        const tr = content.tracks.get(a.weaponTrack)!;
        const s = sampleTrack(tr, t);
        hunter.weaponToTrack(s.grip, s.dir, tr.planeNormal ?? [1, 0, 0], fam.twoHanded);
      } else hunter.weaponToSocket('back');
    } else {
      hunter.setPose(locomotionPose(false, t < 60 ? 0 : 4, time * 9, time));
      hunter.weaponToSocket('back');
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
  } else if (state.subject !== 'glb') {
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

  const target = new Vector3(0, state.subject === 'dummy' || state.subject === 'galdros' ? 1.2 : 0.95, 0);
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
    content = await loadContent();
    const doc = (await fetchJson('data/asset-manifest.json')) as { assets: ManifestAsset[] };
    manifest = doc.assets;
  } catch (e) {
    panel.textContent = `読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
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
  if (q.has('damaged')) damaged = true;
  if (q.get('shapes') === '0') state.shapes = false;
  if (q.get('bones') === '0') state.bones = false;
  const glb = q.get('glb');
  if (glb) await loadGlb(glb);
  (window as unknown as { __viewer?: unknown }).__viewer = { state, monsters };
  requestAnimationFrame(frame);
}

void main();
