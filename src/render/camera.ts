// 背面追従の三人称カメラ（手動操作が標準）。上下角と距離に範囲を設け、壁や岩に当たったら手前へ寄せる。
// 正面復帰は少しずつ回し、急に 180 度回らない。
import { PerspectiveCamera, Vector3 } from 'three';
import { angleDiff, clamp, turnToward } from '../core/math';
import type { World } from '../game/world';

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

  update(dt: number, target: { x: number; y: number; z: number }, world: World, shakeScale: number): void {
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
    const b = world.map.bounds;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const x = this.pivot.x + dir.x * d;
      const y = this.pivot.y + dir.y * d;
      const z = this.pivot.z + dir.z * d;
      let hit = x < b.minX + 0.4 || x > b.maxX - 0.4 || z < b.minZ + 0.4 || z > b.maxZ - 0.4 || y < world.groundHeight(x, z) + 0.25;
      if (!hit) {
        for (const r of world.map.rocks) {
          if (y < r.h && Math.hypot(x - r.x, z - r.z) < r.r + 0.3) {
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
    this.camera.lookAt(this.pivot);
    if (this.shake > 0.001 && shakeScale > 0) {
      this.shakeTime += dt;
      const s = this.shake * this.shake * 0.16 * shakeScale;
      this.camera.position.x += Math.sin(this.shakeTime * 71) * s;
      this.camera.position.y += Math.sin(this.shakeTime * 93 + 1.3) * s;
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
  }
}
