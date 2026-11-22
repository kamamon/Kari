// 訓練標的「岩偶」の仮モデル。部位の見た目は当たり形状（public/data/monsters/training_dummy.json）に合わせてある。
// 破壊した部位は見た目を切り替え、判定側の状態と一致させる。
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Matrix4, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import type { Content } from '../data/schemas';
import { renderTick } from '../game/action';
import type { MonsterState } from '../game/monster';
import { sampleTrack } from '../game/tracks';

export interface MonsterRigCtx {
  alpha: number;
  dt: number;
  time: number;
  content: Content;
  /** 目で追う相手（狩人）の位置。無ければ正面を向く。 */
  lookAt?: { x: number; y: number; z: number };
  /** 見た目の側から出す効果（足音・土ぼこり）。戦闘の計算には関わらない。 */
  fx?: {
    footfall(x: number, y: number, z: number, strength: number): void;
    puff(x: number, y: number, z: number, amount: number): void;
  };
}

/** モンスターの見た目の共通の口。正式モデル（GLB）へ替える時も、この形に合わせる。 */
export interface MonsterRig {
  readonly root: Group;
  /** モンスターに付いて動かない物（切り落とした尾など）。シーンへ直接置く。 */
  readonly extras?: Group[];
  hitFlash(partIndex: number): void;
  /** 命中した位置（ワールド座標）に応じた、のけぞり。 */
  hitReact?(partIndex: number, wx: number, wz: number, strength?: number): void;
  update(m: MonsterState, c: MonsterRigCtx): void;
  placeSevered?(x: number, y: number, z: number, yaw: number): void;
}

const lam = (color: number, emissive = 0): MeshLambertMaterial => new MeshLambertMaterial({ color, emissive, flatShading: true });

export class DummyRig implements MonsterRig {
  readonly root = new Group();
  private tilt = new Group();
  readonly arm = new Group();
  private partMats: MeshLambertMaterial[][] = [];
  private flash: number[] = [];
  private headMask: Mesh;
  private shell: Group;
  private m1 = new Matrix4();

  constructor(partIds: readonly string[]) {
    const hide = lam(0x6f7767);
    const rock = lam(0x8c9087);
    const headRock = lam(0x8c9087);
    const shellMat = lam(0x9a9c8e);
    const bronze = lam(0xb08d57, 0x241a08);
    const core = lam(0x3c4640);
    const tailMat = lam(0x62695b);
    const mats: Record<string, MeshLambertMaterial[]> = { head: [headRock, bronze], tail: [tailMat], back: [shellMat], legs: [rock.clone()], body: [hide] };
    for (const id of partIds) {
      this.partMats.push(mats[id] ?? []);
      this.flash.push(0);
    }
    const legMat = mats.legs![0]!;
    this.root.add(this.tilt);
    const add = (m: Mesh): Mesh => {
      m.castShadow = true;
      this.tilt.add(m);
      return m;
    };

    // 胴（カプセル z -0.9..0.9, y 1.15, r 0.75）
    const body = add(new Mesh(new IcosahedronGeometry(1, 1), hide));
    body.scale.set(0.82, 0.74, 1.62);
    body.position.set(0, 1.15, 0);
    // 背殻（カプセル z -0.7..0.6, y 1.85, r 0.55）: 左右非対称の板
    this.shell = new Group();
    const plate = (x: number, z: number, w: number, d: number, ry: number, rz: number): void => {
      const p = new Mesh(new BoxGeometry(w, 0.22, d), shellMat);
      p.position.set(x, 1.86, z);
      p.rotation.set(0, ry, rz);
      p.castShadow = true;
      this.shell.add(p);
    };
    plate(-0.28, 0.35, 0.72, 0.8, 0.2, 0.32);
    plate(0.3, 0.2, 0.6, 0.66, -0.15, -0.3);
    plate(-0.05, -0.5, 0.95, 0.72, 0.05, 0.06);
    const vein = new Mesh(new BoxGeometry(0.1, 0.1, 1.5), bronze);
    vein.position.set(0.02, 1.98, -0.05);
    this.shell.add(vein);
    this.tilt.add(this.shell);
    const backCore = add(new Mesh(new IcosahedronGeometry(1, 0), core));
    backCore.scale.set(0.5, 0.28, 1.0);
    backCore.position.set(0, 1.72, -0.05);

    // 頭（球 (0,1.25,1.75) r 0.5）
    const head = add(new Mesh(new BoxGeometry(0.74, 0.62, 0.86), headRock));
    head.position.set(0, 1.25, 1.75);
    this.headMask = add(new Mesh(new BoxGeometry(0.84, 0.34, 0.5), bronze));
    this.headMask.position.set(0, 1.5, 1.86);
    this.headMask.rotation.x = 0.25;
    for (const x of [-0.22, 0.22]) {
      const eye = add(new Mesh(new IcosahedronGeometry(0.07, 0), lam(0x7fd6c2, 0x3c8f7f)));
      eye.position.set(x, 1.22, 2.19);
    }
    const jaw = add(new Mesh(new BoxGeometry(0.6, 0.18, 0.6), core));
    jaw.position.set(0, 0.95, 1.8);

    // 脚（カプセル 4 本）
    for (const [x, z] of [[-0.75, 0.8], [0.75, 0.8], [-0.75, -0.8], [0.75, -0.8]] as const) {
      const leg = add(new Mesh(new CylinderGeometry(0.3, 0.36, 0.95, 7), legMat));
      leg.position.set(x, 0.475, z);
    }
    // 尾（カプセル (0,1.0,-1.5) → (0,0.7,-2.9) r 0.3）
    const tail = add(new Mesh(new ConeGeometry(0.36, 1.7, 7), tailMat));
    tail.position.set(0, 0.85, -2.2);
    tail.rotation.x = -Math.PI / 2 - 0.21;

    // 叩きつけ用の腕。軌道データで動かす（原点 = 肩、+Y = 腕先）。
    const armMesh = new Mesh(new CylinderGeometry(0.22, 0.3, 1.9, 7), rock);
    armMesh.position.y = 1.05;
    armMesh.castShadow = true;
    const fist = new Mesh(new IcosahedronGeometry(0.46, 0), lam(0x7a7f76));
    fist.position.y = 2.0;
    fist.castShadow = true;
    const band = new Mesh(new CylinderGeometry(0.31, 0.31, 0.14, 7), bronze);
    band.position.y = 0.4;
    this.arm.add(armMesh, fist, band);
    this.arm.matrixAutoUpdate = false;
    this.tilt.add(this.arm);
  }

  /** 腕を軌道へ置く（モンスターのローカル座標）。 */
  setArm(grip: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
    const y = new Vector3(dir.x, dir.y, dir.z).normalize();
    const x = new Vector3(1, 0, 0);
    const z = new Vector3().crossVectors(x, y).normalize();
    x.crossVectors(y, z);
    this.m1.makeBasis(x, y, z).setPosition(grip.x, grip.y, grip.z);
    this.arm.matrix.copy(this.m1);
    this.arm.matrixWorldNeedsUpdate = true;
  }

  hitFlash(partIndex: number): void {
    this.flash[partIndex] = 1;
  }

  update(m: MonsterState, c: MonsterRigCtx): void {
    const { dt, time } = c;
    // 腕は技の軌道データで動かす。技を出していない時は軌道の最初の姿勢。
    const trackId = m.action?.def.weaponTrack ?? c.content.actions.get(m.def.ai.choices[0]!.actionId)?.weaponTrack;
    if (trackId) {
      const s = sampleTrack(c.content.tracks.get(trackId)!, m.action ? renderTick(m.action, c.alpha) : 0);
      this.setArm(s.grip, s.dir);
    }
    const headIndex = m.def.parts.findIndex((p) => p.id === 'head');
    this.headMask.visible = !(headIndex >= 0 && m.parts[headIndex]!.broken);
    const backIndex = m.def.parts.findIndex((p) => p.id === 'back');
    this.shell.visible = !(backIndex >= 0 && m.parts[backIndex]!.broken);
    for (let i = 0; i < this.flash.length; i++) {
      const f = (this.flash[i] = Math.max(0, this.flash[i]! - dt * 5));
      for (const mat of this.partMats[i] ?? []) mat.emissive.setRGB(f * 0.9, f * 0.75, f * 0.45);
    }
    // 怯み: 小刻みに揺れる / 死亡: 横倒し
    let rz = 0;
    let rx = 0;
    let y = 0;
    if (m.dead) {
      const u = Math.min(1, m.deadTicks / 45);
      const e = u * u * (3 - 2 * u);
      rz = e * 1.35;
      y = -e * 0.25;
    } else if (m.staggerTicks > 0) {
      const k = Math.min(1, m.staggerTicks / 20);
      rz = Math.sin(time * 34) * 0.05 * k;
      rx = -0.12 * k;
    }
    this.tilt.rotation.set(rx, 0, rz);
    this.tilt.position.y = y;
  }
}
