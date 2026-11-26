// 背面追従の三人称カメラ（手動操作が標準）。上下角と距離に範囲を設け、壁や岩に当たったら手前へ寄せる。
// 正面復帰は少しずつ回し、急に 180 度回らない。
import { PerspectiveCamera, Vector3 } from 'three';
import { angleDiff, clamp, turnToward, yawOf } from '../core/math';
import type { World } from '../game/world';

/** 手で狙う時（v0.61.0）、カメラを目の点の何 m 後ろに置くか */
export const AIM_BACK = 1.5;

export class FollowCamera {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0.3;
  distance = 5.2;
  private currentDist = 5.2;
  private resetTo: number | null = null;
  private shake = 0;
  private shakeTime = 0;
  private pivot = new Vector3();
  /** 手で狙う時の寄せ具合（0 = ふつうの追従、1 = 狙いの線の上。v0.61.0）と、最後の狙い（戻る間に使う） */
  aimBlend = 0;
  private lastAim: { eye: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } | null = null;
  private lookPt = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(58, aspect, 0.1, 400);
  }

  /** 視点操作の入力（ラジアン相当）。 */
  look(dx: number, dy: number, invertX: boolean, invertY: boolean): void {
    if (dx === 0 && dy === 0) return;
    this.yaw -= invertX ? -dx : dx;
    this.pitch = clamp(this.pitch + (invertY ? -dy : dy), -0.25, 1.15);
    this.resetTo = null;
  }

  /** 指定の向きへ正面復帰する。 */
  resetBehind(yaw: number): void {
    this.resetTo = yaw;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  snap(yaw: number): void {
    this.yaw = yaw;
    this.resetTo = null;
  }

  /**
   * lock: ロックオンしている標的の位置（無ければ null）。ロック中は、狩人の後ろから標的を見る向きへ、毎フレーム回し続ける。
   * すぐ近く（水平 2m 以内）では、向きが急に裏返らないよう、回さない。
   */
  /**
   * aim（v0.61.0。環弓で手で狙っている間）: 目の点と狙いの向き。カメラを狙いの線の上（目の点の 1.5m 後ろ）へ寄せ、狙いの向きを見る。
   * 画面の真ん中が、simulation の狙いの線になる（照準の所へ矢が飛ぶ）
   */
  update(
    dt: number,
    target: { x: number; y: number; z: number },
    world: World,
    shakeScale: number,
    lock: { x: number; y: number; z: number } | null = null,
    aim: { eye: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } } | null = null,
  ): void {
    if (lock) {
      const dx = lock.x - target.x, dz = lock.z - target.z;
      if (Math.hypot(dx, dz) > 2) {
        const want = yawOf(dx, dz);
        const off = Math.abs(angleDiff(this.yaw, want));
        // 大きくずれている時ほど速く回す（ずれが小さい時は、ゆっくり合わせる）
        this.yaw = turnToward(this.yaw, want, (2.5 + 7 * Math.min(1, off)) * dt);
      }
      this.resetTo = null;
    }
    if (this.resetTo !== null) {
      this.yaw = turnToward(this.yaw, this.resetTo, 7 * dt);
      this.pitch += (0.3 - this.pitch) * Math.min(1, dt * 6);
      if (Math.abs(angleDiff(this.yaw, this.resetTo)) < 0.01) this.resetTo = null;
    }
    this.pivot.set(target.x, target.y + 1.45, target.z);
    const cp = Math.cos(this.pitch);
    const dir = { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };

    // 視線が壁・岩・地面に当たる手前までカメラを寄せる
    let allowed = this.distance;
    const steps = 14;
    // 視線がある場所のエリア（フィールドでは、エリアごとに外周と岩が違う）
    const area = world.areaAt(this.pivot.x, this.pivot.z);
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const x = this.pivot.x + dir.x * d;
      const y = this.pivot.y + dir.y * d;
      const z = this.pivot.z + dir.z * d;
      // 外周（四角か、自然な形。v0.20.0）の 0.4m 手前で止める
      let hit = world.wallDistance(area, x, z) < 0.4 || y < world.groundHeight(x, z) + 0.25;
      if (!hit) {
        for (const r of area.rocks) {
          // 円柱の上の端（h）と下の端（y。v0.31.0。下の段の建物と人。無ければ地面の下まで）の間
          if (y < r.h && y > (r.y ?? -Infinity) && Math.hypot(x - r.x, z - r.z) < r.r + 0.3) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        allowed = Math.max(0.9, (this.distance * (i - 1)) / steps);
        break;
      }
    }
    // 寄せる時は速く、離す時はゆっくり
    const k = allowed < this.currentDist ? 18 : 3.5;
    this.currentDist += (allowed - this.currentDist) * Math.min(1, dt * k);

    this.camera.position.set(this.pivot.x + dir.x * this.currentDist, this.pivot.y + dir.y * this.currentDist, this.pivot.z + dir.z * this.currentDist);
    this.lookPt.copy(this.pivot);
    // 手で狙う（v0.61.0）: 狙いの線の上へ寄せる（入る・戻るは 0.1 秒ほどで滑らかに）
    if (aim) this.lastAim = aim;
    this.aimBlend += ((aim ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 14);
    if (!aim && this.aimBlend < 0.002) this.aimBlend = 0;
    if (aim && this.aimBlend > 0.998) this.aimBlend = 1;
    const fov = 58 - 12 * this.aimBlend;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.aimBlend > 0 && this.lastAim) {
      const { eye, dir: d } = this.lastAim;
      const u = this.aimBlend;
      this.camera.position.lerp(new Vector3(eye.x - d.x * AIM_BACK, eye.y - d.y * AIM_BACK, eye.z - d.z * AIM_BACK), u);
      this.lookPt.lerp(new Vector3(eye.x + d.x * 20, eye.y + d.y * 20, eye.z + d.z * 20), u);
    }
    this.camera.lookAt(this.lookPt);
    if (this.shake > 0.001 && shakeScale > 0) {
      this.shakeTime += dt;
      const s = this.shake * this.shake * 0.16 * shakeScale;
      this.camera.position.x += Math.sin(this.shakeTime * 71) * s;
      this.camera.position.y += Math.sin(this.shakeTime * 93 + 1.3) * s;
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
  }
}
