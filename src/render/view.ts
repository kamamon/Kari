// 描画のまとめ役。simulation の状態を読んで、仮モデル・カメラ・エフェクト・検証表示を更新する。
// ここから simulation へ値を書き戻すことはしない（描画補間や骨の姿勢を計算の正本にしない）。
import { Scene, Vector3, WebGLRenderer } from 'three';
import { angleDiff, fromArr, lerpV, norm, smoothstep, toWorld, type V3 } from '../core/math';
import type { Content } from '../data/schemas';
import { inWindow, renderTick } from '../game/action';
import type { SimEvent } from '../game/events';
import { monsterShapes } from '../game/monster';
import { familyOf, isGuarding, playerHurtCapsule } from '../game/player';
import type { Simulation } from '../game/sim';
import { sampleTrack, trackSegment } from '../game/tracks';
import type { Settings } from '../save/settings';
import { blobShadow, buildArena, type Arena } from './arena';
import { FollowCamera } from './camera';
import { DebugDraw } from './debugDraw';
import { BladeTrail, GroundRings, Particles } from './effects';
import { DummyRig } from './monsterRig';
import { blendPose, clipPose, deadPose, emptyPose, guardPose, hurtPose, locomotionPose, type BodyPose } from './poses';
import { HunterRig } from './rig';

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
  readonly dummy: DummyRig | null = null;
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
  private renderY = 0;
  private poseKey = '';
  private lastPose: BodyPose = emptyPose();
  private blendFrom: BodyPose | null = null;
  private blendT = 1;
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
      this.dummy = new DummyRig(m.def.parts.map((p) => p.id));
      this.scene.add(this.dummy.root, this.monsterShadow);
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
          this.dummy?.hitFlash(e.partIndex);
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
    const ready: WeaponPlace = { mode: 'track', grip: fromArr(fam.ready.grip), dir: norm(fromArr(fam.ready.dir)), normal: fam.ready.planeNormal };

    if (p.mode === 'action' && p.action) {
      const run = p.action;
      const t = renderTick(run, alpha);
      const cp = clipPose(run.def.clip, t);
      if (!cp) this.missingClips.add(run.def.clip);
      pose = cp ?? emptyPose();
      pose.tumbleDir = (run.dirIndex * Math.PI) / 2;
      key = `action:${run.instanceId}`;
      if (run.def.weaponTrack) {
        const tr = content.tracks.get(run.def.weaponTrack)!;
        const s = sampleTrack(tr, t);
        weapon = { mode: 'track', grip: s.grip, dir: s.dir, normal: tr.planeNormal ?? [1, 0, 0] };
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
        const u = smoothstep(blend);
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
      if (p.drawn) weapon = ready;
    }

    // 状態が切り替わった瞬間は、直前の姿勢から短く混ぜる
    if (key !== this.poseKey) {
      this.poseKey = key;
      this.blendFrom = { ...this.lastPose, tumble: ((((this.lastPose.tumble + 180) % 360) + 360) % 360) - 180 };
      this.blendT = 0;
    }
    this.blendT += dt;
    const w = Math.min(1, this.blendT / 0.09);
    if (w < 1 && this.blendFrom) pose = blendPose(this.blendFrom, pose, w);
    this.lastPose = pose;

    this.hunter.setPose(pose);
    if (weapon.mode === 'track') this.hunter.weaponToTrack(weapon.grip, weapon.dir, weapon.normal, fam.twoHanded);
    else this.hunter.weaponToSocket(weapon.mode === 'back' ? 'back' : 'hand_r');
    this.hunter.root.updateMatrixWorld(true);
    this.hunter.setGhost(p.invulnTicks > 0 && p.mode !== 'hurt' && Math.floor(this.time * 14) % 2 === 0);
    this.playerShadow.position.set(pos.x, sim.world.groundHeight(pos.x, pos.z) + 0.03, pos.z);

    if (p.mode !== 'action') this.trail.active = false;
    const base = this.bladePoint(0.05);
    const tip = this.bladePoint(1);
    this.trail.update(dt, this.tmpA.set(base.x, base.y, base.z), new Vector3(tip.x, tip.y, tip.z));

    // ---- 標的 ----
    const m = sim.monsters[0];
    if (m && this.dummy) {
      const mp = lerpV(m.prevPos, m.pos, alpha);
      this.dummy.root.position.set(mp.x, mp.y, mp.z);
      this.dummy.root.rotation.y = m.prevYaw + angleDiff(m.prevYaw, m.yaw) * alpha;
      const trackId = m.action?.def.weaponTrack ?? content.actions.get(m.def.ai.choices[0]!.actionId)?.weaponTrack;
      if (trackId) {
        const s = sampleTrack(content.tracks.get(trackId)!, m.action ? renderTick(m.action, alpha) : 0);
        this.dummy.setArm(s.grip, s.dir);
      }
      this.dummy.update(m, dt, this.time);
      this.monsterShadow.position.set(mp.x, 0.03, mp.z);
    }

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

  dispose(): void {
    this.renderer.dispose();
  }
}
