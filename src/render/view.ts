// 描画のまとめ役。simulation の状態を読んで、仮モデル・カメラ・エフェクト・検証表示を更新する。
// ここから simulation へ値を書き戻すことはしない（描画補間や骨の姿勢を計算の正本にしない）。
import { CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { angleDiff, fromArr, lerpV, norm, smoothstep, toWorld, type V3 } from '../core/math';
import type { Content } from '../data/schemas';
import { inWindow, renderTick } from '../game/action';
import type { SimEvent } from '../game/events';
import { monsterBlockers, monsterShapes } from '../game/monster';
import { familyOf, isGuarding, playerHurtCapsule } from '../game/player';
import type { Simulation } from '../game/sim';
import { sampleTrack, trackSegment } from '../game/tracks';
import type { Settings } from '../save/settings';
import { blobShadow, buildArena, type Arena } from './arena';
import { FollowCamera } from './camera';
import { DebugDraw } from './debugDraw';
import { BladeTrail, GroundRings, Particles } from './effects';
import { GaldrosRig } from './galdrosRig';
import { DummyRig, type MonsterRig } from './monsterRig';
import { blendPose, clipPose, deadPose, emptyPose, guardPose, hurtPose, locomotionPose, type BodyPose } from './poses';
import { HunterAnimator, applySolved, canSolve, stowOffhand, type AnimState } from './hunterAnim';
import type { Solved } from './bodySolve';
import { WEAPON_STANCES } from './weaponClipSpecs';
import { buildArrow } from './bow';
import { HunterRig, type HandsSpec } from './rig';

type WeaponPlace = { mode: 'back' } | { mode: 'hand' } | { mode: 'track'; grip: V3; dir: V3; normal: readonly number[] };

const PART_COLORS: Record<string, [number, number, number]> = {
  head: [1, 0.55, 0.2],
  tail: [0.8, 0.5, 1],
  back: [1, 0.9, 0.3],
  legs: [0.5, 1, 0.5],
  body: [0.45, 0.7, 1],
};
const MATERIAL_SPARK: Record<string, [number, number, number]> = { rock: [1, 0.8, 0.45], shell: [0.9, 0.85, 0.6], hide: [0.95, 0.9, 0.8] };

export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly cam: FollowCamera;
  readonly hunter = new HunterRig();
  /** 飛んでいる矢の形（使い回す） */
  private arrows: Group[] = [];
  readonly monsterRig: MonsterRig | null = null;
  private hazardViews = new Map<number, { group: Group; ring: Mesh; rock: Mesh }>();
  private trapViews = new Map<number, { group: Group; ring: Mesh; core: Mesh }>();
  private hazardRock = new IcosahedronGeometry(1, 0);
  private hazardRockMat = new MeshLambertMaterial({ color: 0x80847a, flatShading: true });
  private arena: Arena;
  private trail: BladeTrail;
  private sparks: Particles;
  private dust: Particles;
  private rings: GroundRings;
  private debug: DebugDraw;
  private playerShadow = blobShadow(0.45);
  private monsterShadow = blobShadow(1.7);
  private phase = 0;
  private time = 0;
  /** 見た目の側から鳴らす音（モンスターの足音など）。App が音声へつなぐ。 */
  onSound: ((id: string, intensity: number) => void) | null = null;
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
  private blendFrom: BodyPose | null = null;
  private blendT = 1;
  /** 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）の体を解く係 */
  private anim = new HunterAnimator();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
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
    this.arena = buildArena(this.scene, sim.world.map, settings.shadows);
    this.scene.add(this.hunter.root, this.playerShadow);
    const m = sim.monsters[0];
    if (m) {
      const ids = m.def.parts.map((p) => p.id);
      this.monsterRig = m.def.rigFamily === 'quadruped_heavy' ? new GaldrosRig(ids) : new DummyRig(ids);
      this.monsterShadow.scale.setScalar(m.def.rigFamily === 'quadruped_heavy' ? 1.45 : 1);
      this.scene.add(this.monsterRig.root, this.monsterShadow, ...(this.monsterRig.extras ?? []));
    }
    this.trail = new BladeTrail(this.scene);
    this.sparks = new Particles(this.scene, 260, 0.11, true, 9, 1.2);
    this.dust = new Particles(this.scene, 200, 0.55, false, -0.6, 2.2);
    this.rings = new GroundRings(this.scene);
    this.debug = new DebugDraw(this.scene);
    this.cam.snap(sim.player.yaw);
    this.renderY = sim.player.pos.y;
    this.resize();
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
    const m = sim.monsters[0];
    for (const e of events) {
      switch (e.type) {
        case 'action_event':
          if (e.actor === sim.player.id && e.kind === 'trail_on') this.trail.active = true;
          else if (e.actor === sim.player.id && e.kind === 'trail_off') this.trail.active = false;
          else if (e.kind === 'vfx' && e.id === 'ground_slam' && m?.action?.def.weaponTrack) {
            const tr = this.content.tracks.get(m.action.def.weaponTrack)!;
            const seg = trackSegment(tr, m.action.tick);
            const tip = toWorld(seg.b, m.pos, m.yaw);
            this.rings.spawn(tip.x, 0, tip.z, 2.6, 0.5, 0xe9e2c8);
            this.dust.emit(22, { x: tip.x, y: 0.2, z: tip.z }, 3.6, 1.2, 0.9, [0.62, 0.62, 0.55], 0.5);
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
          this.monsterRig?.hitFlash(e.partIndex);
          this.monsterRig?.hitReact?.(e.partIndex, e.pos.x, e.pos.z, 0.8 + e.chargeLevel * 0.3);
          this.cam.addShake(0.22 + e.chargeLevel * 0.12);
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
          this.monsterRig?.placeSevered?.(e.pos.x, e.pos.y, e.pos.z, e.yaw);
          this.sparks.emit(36, { x: e.pos.x, y: 0.9, z: e.pos.z }, 6, 3, 0.7, [1, 0.8, 0.45]);
          this.dust.emit(12, { x: e.pos.x, y: 0.4, z: e.pos.z }, 2.4, 1.2, 0.9, [0.55, 0.52, 0.48]);
          this.cam.addShake(0.55);
          break;
        case 'monster_stagger':
          if (m && e.kind === 'topple') {
            this.dust.emit(24, { x: m.pos.x, y: 0.4, z: m.pos.z }, 3.4, 1, 1.0, [0.6, 0.6, 0.54], 0.5);
            this.cam.addShake(0.45);
          }
          break;
        case 'monster_aware':
        case 'monster_rage':
          this.cam.addShake(0.35);
          break;
        case 'hazard_impact':
          this.rings.spawn(e.x, 0, e.z, e.radius * 1.5, 0.45, 0xe9e2c8);
          this.dust.emit(14, { x: e.x, y: 0.3, z: e.z }, 3, 1.4, 0.9, [0.6, 0.6, 0.55], 0.6);
          this.sparks.emit(8, { x: e.x, y: 0.4, z: e.z }, 4, 2.5, 0.4, [0.9, 0.85, 0.7]);
          this.cam.addShake(0.3);
          break;
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
        case 'monster_dead':
        case 'monster_respawn':
          if (m) this.dust.emit(26, { x: m.pos.x, y: 0.6, z: m.pos.z }, 3.2, 1.2, 1.1, [0.6, 0.62, 0.55], 0.6);
          break;
        // ---- 道具・捕獲・剥ぎ取り（見た目は仮）----
        case 'item_effect':
          if (e.kind === 'heal') this.sparks.emit(14, { x: e.pos.x, y: 1.1, z: e.pos.z }, 1.2, 2.2, 0.7, [0.55, 0.95, 0.6], 0.5);
          else if (e.kind === 'trap' && e.ok) this.dust.emit(8, { x: e.pos.x, y: 0.15, z: e.pos.z }, 1.4, 0.6, 0.6, [0.6, 0.6, 0.55], 0.5);
          else if (e.kind === 'tranq') this.dust.emit(e.ok ? 22 : 8, e.pos, e.ok ? 2.4 : 1.2, 1.2, 1.2, [0.62, 0.78, 0.92], 0.8);
          break;
        case 'trap_trigger':
          this.rings.spawn(e.x, 0, e.z, 2.6, 0.5, 0xfff0a0);
          this.sparks.emit(24, { x: e.x, y: 0.3, z: e.z }, 5, 3, 0.5, [1, 0.92, 0.6]);
          this.cam.addShake(0.25);
          break;
        case 'monster_captured':
          if (m) this.dust.emit(30, { x: m.pos.x, y: 1.2, z: m.pos.z }, 2.2, 1, 1.6, [0.62, 0.78, 0.92], 0.9);
          break;
        case 'carve':
          this.sparks.emit(6, { x: e.pos.x, y: 0.5, z: e.pos.z }, 1.6, 1.6, 0.4, [0.95, 0.85, 0.6], 0.4);
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
    const yaw = p.prevYaw + angleDiff(p.prevYaw, p.yaw) * alpha;
    this.renderY += (pos.y - this.renderY) * Math.min(1, dt * 16);
    this.hunter.root.position.set(pos.x, this.renderY, pos.z);
    this.hunter.root.rotation.y = yaw;
    const stride = p.drawn ? 1.35 : 1.7 + 0.9 * Math.min(1, p.moveSpeed / 6.4);
    this.phase += (p.moveSpeed * dt * Math.PI * 2) / stride;

    // ---- 姿勢と武器の置き場所を決める ----
    let key: string;
    let pose: BodyPose;
    let weapon: WeaponPlace = p.drawn ? { mode: 'hand' } : { mode: 'back' };
    this.hunter.setFamily(fam.id, fam.offhand, sim.content.weapons.get(p.weaponId)?.assetId);
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
      const t = renderTick(run, alpha);
      const fm = run.def.freeMove;
      st = { kind: 'action', clip: run.def.clip, t, dirAngle: (run.dirIndex * Math.PI) / 2, chargeTicks: run.chargeTicks, freeMove: !!fm && t >= (fm.from ?? 0) && t < (fm.to ?? run.def.durationTicks) };
      const cp = canSolve(fam.id, st) ? emptyPose() : clipPose(run.def.clip, t);
      if (!cp) this.missingClips.add(run.def.clip);
      pose = cp ?? emptyPose();
      pose.tumbleDir = (run.dirIndex * Math.PI) / 2;
      key = `action:${run.instanceId}`;
      if (run.def.weaponTrack) {
        const tr = content.tracks.get(run.def.weaponTrack)!;
        const s = sampleTrack(tr, t);
        weapon = { mode: 'track', grip: s.grip, dir: s.dir, normal: tr.planeNormal ?? [1, 0, 0] };
        shieldOut = true;
      }
      if (run.def.offhandTrack) shieldAt = sampleTrack(content.tracks.get(run.def.offhandTrack)!, t).grip;
      else if (run.def.guardWindows) shieldU = 1;
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
    } else {
      pose = locomotionPose(p.drawn, p.moveSpeed, this.phase, this.time);
      key = p.drawn ? 'free-drawn' : 'free-sheathed';
      if (p.drawn) {
        weapon = ready;
        st = { kind: 'idle' };
      }
    }
    // 断岳剣以外（護刃・長尖槍・環弓・大槌・双剣・太刀）: 体・武器・盾（双剣は左の剣）をまとめて解く（足は地面に、手は武器に付いたままになる）
    const continued = this.anim.continuing;
    let solved: Solved | null = null;
    if (st && canSolve(fam.id, st)) {
      solved = this.anim.frame(fam.id, st, key, dt, p.moveSpeed, this.time);
      pose = solved.pose;
    } else this.anim.reset();

    // 状態が切り替わった瞬間は、直前の姿勢から短く混ぜる
    if (key !== this.poseKey) {
      this.poseKey = key;
      // 解いた姿どうしの切り替えは、解く側が混ぜ終えている
      this.blendFrom = solved && continued ? null : { ...this.lastPose, tumble: ((((this.lastPose.tumble + 180) % 360) + 360) % 360) - 180 };
      this.blendT = 0;
    }
    this.blendT += dt;
    const w = Math.min(1, this.blendT / 0.09);
    if (w < 1 && this.blendFrom) pose = blendPose(this.blendFrom, pose, w);
    this.lastPose = pose;

    if (solved) {
      applySolved(this.hunter, solved, fam.id);
      // 混ぜている途中は、混ぜた姿勢を置き直す（武器と盾は解いた位置のまま）
      if (pose !== solved.pose) this.hunter.setPose(pose);
    } else {
      this.hunter.setPose(pose);
      this.hunter.setString(null);
      const sheath = WEAPON_STANCES[fam.id]?.sheath;
      if (weapon.mode === 'track') this.hunter.weaponToTrack(weapon.grip, weapon.dir, weapon.normal, hands);
      else if (weapon.mode === 'back' && sheath) this.hunter.weaponToSheath(sheath);
      else this.hunter.weaponToSocket(weapon.mode === 'back' ? fam.sheathSocket ?? 'back' : fam.primaryHand === 'left' ? 'hand_l' : 'hand_r');
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
    const base = this.bladePoint(0.05);
    const tip = this.bladePoint(1);
    this.trail.update(dt, this.tmpA.set(base.x, base.y, base.z), new Vector3(tip.x, tip.y, tip.z));

    // ---- モンスター ----
    const m = sim.monsters[0];
    if (m && this.monsterRig) {
      const mp = lerpV(m.prevPos, m.pos, alpha);
      this.monsterRig.root.position.set(mp.x, mp.y, mp.z);
      this.monsterRig.root.rotation.y = m.prevYaw + angleDiff(m.prevYaw, m.yaw) * alpha;
      this.monsterFx.px = pos.x;
      this.monsterFx.pz = pos.z;
      this.monsterRig.update(m, { alpha, dt, time: this.time, content, lookAt: pos, fx: this.monsterFx });
      this.monsterShadow.position.set(mp.x, sim.world.groundHeight(mp.x, mp.z) + 0.03, mp.z);
    }
    this.syncHazards(sim);
    this.syncTraps(sim);
    this.syncArrows(sim, alpha);

    // ---- カメラ・光・エフェクト ----
    const sens = this.settings.camSensitivity;
    this.cam.look(look.x * sens, look.y * sens, this.settings.invertX, this.settings.invertY);
    const shake = this.settings.shake === 'off' ? 0 : this.settings.shake === 'weak' ? 0.5 : 1;
    this.cam.update(dt, { x: pos.x, y: this.renderY, z: pos.z }, sim.world, shake);
    this.arena.sun.target.position.set(pos.x, 0, pos.z);
    this.arena.sun.position.set(pos.x - 14, 26, pos.z - 11);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.rings.update(dt);
    this.drawDebug(sim, alpha, verify);
  }

  /** 罠: 置いた場所に輪と芯を出す。作動前は暗く、作動可能で青銅色に脈打ち、捕らえている間は明るくちらつく。 */
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
        if (Math.sin(this.time * 17 + t.id) > 0.82) this.sparks.emit(1, { x: t.x + Math.sin(this.time * 9) * t.radius, y: 0.3, z: t.z + Math.cos(this.time * 7) * t.radius }, 2, 2.5, 0.35, [1, 0.92, 0.6]);
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
        const rock = new Mesh(this.hazardRock, this.hazardRockMat);
        rock.castShadow = true;
        group.add(ring, disc, rock);
        group.position.set(h.x, sim.world.groundHeight(h.x, h.z), h.z);
        this.scene.add(group);
        v = { group, ring, rock };
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
      v.rock.scale.set(0.55, 0.75 / Math.max(0.5, h.radius) * h.radius, 0.55);
      v.rock.rotation.set(this.time * 3 + h.id, this.time * 2, 0);
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
        const t = renderTick(p.action, alpha);
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
