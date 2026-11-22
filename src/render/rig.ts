// 関節付きの仮ハンター。プリミティブを骨の階層に並べただけの仮素材で、正式モデル（GLB）の差し替え口になる。
// 骨と socket の名前・向きは docs/animation-contract.md と揃える。
//   root → pelvis → spine → chest → neck → head / 腕 / 脚、socket_hand_r / socket_hand_l / socket_back / socket_hip
// 単位 m、Y 上、+Z 前。身長 1.75m。右手側は -X。
import {
  BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshLambertMaterial, Object3D, Quaternion, Shape, SphereGeometry, Vector3,
} from 'three';
import { JOINTS, type BodyPose, type JointName } from './poses';

const D2R = Math.PI / 180;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HAND = 0.04;
const TUMBLE_PIVOT = 0.55;

const mat = (color: number, emissive = 0): MeshLambertMaterial => new MeshLambertMaterial({ color, emissive, flatShading: true });

export const HUNTER_COLORS = { cloth: 0xd9d0b4, leather: 0x6b5a44, skin: 0xcaa687, bronze: 0xb08d57, dark: 0x2f3a33, iron: 0x70766f };

function box(w: number, h: number, d: number, m: MeshLambertMaterial, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** 関節から -Y 方向へ伸びる手足。 */
function limb(rTop: number, rBottom: number, len: number, m: MeshLambertMaterial): Mesh {
  const mesh = new Mesh(new CylinderGeometry(rTop, rBottom, len, 7), m);
  mesh.position.y = -len / 2;
  mesh.castShadow = true;
  return mesh;
}

/** 断岳剣の仮モデル。原点は握り位置、+Y が刃先、X が厚み、Z が刃幅。 */
export function buildHeavyBlade(): Group {
  const g = new Group();
  g.name = 'model.weapon.heavy_blade.001';
  const bronze = mat(HUNTER_COLORS.bronze);
  const iron = mat(HUNTER_COLORS.iron);
  const grip = new Mesh(new CylinderGeometry(0.026, 0.03, 0.42, 6), mat(HUNTER_COLORS.leather));
  grip.position.y = 0.07;
  g.add(grip, box(0.06, 0.06, 0.07, bronze, 0, -0.16, 0), box(0.07, 0.07, 0.36, bronze, 0, 0.3, 0));
  // 片側だけ厚い、削り出しの板のような刃
  const s = new Shape();
  s.moveTo(-0.1, 0.33);
  s.lineTo(-0.125, 1.38);
  s.lineTo(-0.02, 1.77);
  s.lineTo(0.15, 1.34);
  s.lineTo(0.135, 0.33);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: false });
  geo.translate(0, 0, -0.0225);
  geo.rotateY(Math.PI / 2);
  const blade = new Mesh(geo, iron);
  blade.castShadow = true;
  g.add(blade, box(0.055, 0.95, 0.05, bronze, 0, 0.84, 0.105));
  return g;
}

export class HunterRig {
  readonly root = new Group();
  readonly joints = {} as Record<JointName, Object3D>;
  readonly sockets = { hand_r: new Object3D(), hand_l: new Object3D(), back: new Object3D(), hip: new Object3D() };
  readonly weapon: Group;
  private tumbleYaw = new Group();
  private tumble = new Group();
  private tumbleBack = new Group();
  private body = new Group();
  private materials: MeshLambertMaterial[] = [];
  // 計算用の使い回し
  private v1 = new Vector3();
  private v2 = new Vector3();
  private v3 = new Vector3();
  private v4 = new Vector3();
  private q1 = new Quaternion();
  private q2 = new Quaternion();
  private m1 = new Matrix4();
  private m2 = new Matrix4();

  constructor() {
    const C = HUNTER_COLORS;
    const cloth = mat(C.cloth);
    const leather = mat(C.leather);
    const skin = mat(C.skin);
    const bronze = mat(C.bronze);
    const dark = mat(C.dark);
    this.materials = [cloth, leather, skin, bronze, dark];
    this.root.name = 'root';
    const j = (name: JointName, parent: Object3D, x: number, y: number, z: number): Object3D => {
      const o = new Object3D();
      o.name = name;
      o.position.set(x, y, z);
      parent.add(o);
      this.joints[name] = o;
      return o;
    };
    this.tumbleYaw.position.y = TUMBLE_PIVOT;
    this.body.position.y = -TUMBLE_PIVOT;
    this.root.add(this.tumbleYaw);
    this.tumbleYaw.add(this.tumble);
    this.tumble.add(this.tumbleBack);
    this.tumbleBack.add(this.body);

    const pelvis = j('pelvis', this.body, 0, 0.92, 0);
    pelvis.add(box(0.3, 0.16, 0.19, leather), box(0.34, 0.2, 0.04, cloth, 0, -0.08, -0.1));
    const spine = j('spine', pelvis, 0, 0.1, 0);
    spine.add(box(0.27, 0.17, 0.17, cloth, 0, 0.07, 0));
    const chest = j('chest', spine, 0, 0.16, 0);
    chest.add(box(0.36, 0.3, 0.21, cloth, 0, 0.16, 0), box(0.07, 0.07, 0.03, bronze, -0.08, 0.2, 0.11), box(0.4, 0.05, 0.23, leather, 0, 0.03, 0));
    const neck = j('neck', chest, 0, 0.34, 0);
    neck.add(limb(0.045, 0.05, 0.08, skin).translateY(0.08));
    const head = j('head', neck, 0, 0.06, 0);
    const skull = new Mesh(new SphereGeometry(0.108, 10, 8), skin);
    skull.position.y = 0.062;
    skull.castShadow = true;
    const hair = new Mesh(new SphereGeometry(0.115, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
    hair.position.set(0, 0.07, -0.012);
    // 鼻（向きが分かるように）と首巻き
    head.add(skull, hair, box(0.03, 0.035, 0.04, skin, 0, 0.052, 0.108), box(0.2, 0.06, 0.2, mat(0x7d9274), 0, -0.035, 0));

    for (const side of [-1, 1] as const) {
      const S = side < 0 ? 'R' : 'L';
      const upper = j(`upperArm${S}` as JointName, chest, 0.215 * side, 0.28, 0);
      upper.add(limb(0.055, 0.045, UPPER_ARM, cloth), box(0.12, 0.07, 0.13, leather, 0, 0.0, 0));
      const fore = j(`forearm${S}` as JointName, upper, 0, -UPPER_ARM, 0);
      fore.add(limb(0.046, 0.04, FOREARM, leather));
      const hand = j(`hand${S}` as JointName, fore, 0, -FOREARM, 0);
      hand.add(box(0.07, 0.08, 0.075, skin, 0, -HAND, 0));
      const socket = side < 0 ? this.sockets.hand_r : this.sockets.hand_l;
      socket.name = side < 0 ? 'socket_hand_r' : 'socket_hand_l';
      socket.position.set(0, -HAND, 0);
      hand.add(socket);
      const thigh = j(`thigh${S}` as JointName, pelvis, 0.095 * side, -0.04, 0);
      thigh.add(limb(0.075, 0.06, 0.43, cloth));
      const shin = j(`shin${S}` as JointName, thigh, 0, -0.43, 0);
      shin.add(limb(0.058, 0.048, 0.41, leather));
      const foot = j(`foot${S}` as JointName, shin, 0, -0.41, 0);
      foot.add(box(0.095, 0.07, 0.24, leather, 0, -0.005, 0.055));
    }

    // 背中の socket: 納刀時の武器位置（握りが右肩の上、刃は左下へ）
    this.sockets.back.name = 'socket_back';
    this.sockets.back.position.set(-0.22, 0.38, -0.16);
    this.orient(this.sockets.back, new Vector3(0.62, -0.77, -0.13), new Vector3(0, 0, -1));
    chest.add(this.sockets.back);
    this.sockets.hip.name = 'socket_hip';
    this.sockets.hip.position.set(0.16, 0, 0);
    pelvis.add(this.sockets.hip);
    // 手の socket: 刃は前腕の前方やや上へ向く
    this.orient(this.sockets.hand_r, new Vector3(0, 0.35, 1), new Vector3(1, 0, 0));

    this.weapon = buildHeavyBlade();
    this.weapon.matrixAutoUpdate = false;
    this.root.add(this.weapon);
  }

  /** +Y を dir、+X を normal に近い向きへ揃える回転を obj に設定する。 */
  private orient(obj: Object3D, dir: Vector3, normal: Vector3): void {
    obj.quaternion.setFromRotationMatrix(this.basis(dir, normal));
  }

  private basis(dir: Vector3, normal: Vector3): Matrix4 {
    const y = this.v1.copy(dir).normalize();
    const x = this.v2.copy(normal).addScaledVector(y, -normal.dot(y));
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0).addScaledVector(y, -y.x);
    x.normalize();
    const z = this.v3.crossVectors(x, y);
    return this.m1.makeBasis(x, y, z);
  }

  setPose(p: BodyPose): void {
    for (const n of JOINTS) {
      const r = p.j[n];
      this.joints[n].rotation.set(r[0] * D2R, r[1] * D2R, r[2] * D2R);
    }
    this.joints.pelvis.position.y = 0.92 + p.py;
    this.tumbleYaw.position.y = TUMBLE_PIVOT + p.drop;
    this.tumbleYaw.rotation.y = p.tumbleDir;
    this.tumble.rotation.x = p.tumble * D2R;
    this.tumbleBack.rotation.y = -p.tumbleDir;
    // 立っている姿勢では、低い方の足裏が地面（root の高さ）へ付くように骨盤を上下させる。
    // 仮のキー姿勢でも足が沈んだり浮いたりしないようにするための簡易な接地。
    if (Math.abs(p.tumble) < 1 && p.drop === 0) {
      this.root.updateMatrixWorld(true);
      let min = Infinity;
      for (const foot of [this.joints.footL, this.joints.footR]) {
        for (const z of [-0.065, 0.175]) {
          const y = this.root.worldToLocal(foot.localToWorld(this.v1.set(0, -0.04, z))).y;
          if (y < min) min = y;
        }
      }
      this.joints.pelvis.position.y -= min;
    }
  }

  /** 武器を socket（背中・手）へ付ける。姿勢を設定した後に呼ぶ。 */
  weaponToSocket(which: 'back' | 'hand_r'): void {
    this.root.updateMatrixWorld(true);
    const inv = this.m2.copy(this.root.matrixWorld).invert();
    this.weapon.matrix.multiplyMatrices(inv, this.sockets[which].matrixWorld);
    this.weapon.matrixWorldNeedsUpdate = true;
  }

  /**
   * 武器を軌道（アクターのローカル座標）へ置き、両腕を IK で握りへ伸ばす。
   * 判定と同じ軌道データを使うので、見える刃と当たり判定が一致する。
   */
  weaponToTrack(grip: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, normal: readonly number[], twoHanded: boolean): void {
    const d = this.v4.set(dir.x, dir.y, dir.z).normalize();
    const b = this.basis(d, new Vector3(normal[0], normal[1], normal[2]));
    b.setPosition(grip.x, grip.y, grip.z);
    this.weapon.matrix.copy(b);
    this.weapon.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
    const gripW = new Vector3(grip.x, grip.y, grip.z).applyMatrix4(this.root.matrixWorld);
    const dirW = new Vector3(dir.x, dir.y, dir.z).normalize().transformDirection(this.root.matrixWorld);
    const rootQ = this.root.getWorldQuaternion(this.q2);
    this.solveArm(this.joints.upperArmR, this.joints.forearmR, gripW, new Vector3(-0.6, -0.6, -0.5).applyQuaternion(rootQ));
    if (twoHanded) {
      const left = gripW.clone().addScaledVector(dirW, 0.2);
      this.solveArm(this.joints.upperArmL, this.joints.forearmL, left, new Vector3(0.6, -0.6, -0.5).applyQuaternion(rootQ));
    }
  }

  /** 2 本骨の IK。肩から target へ腕を伸ばし、肘は pole の側へ曲げる。 */
  private solveArm(upper: Object3D, fore: Object3D, target: Vector3, pole: Vector3): void {
    const L1 = UPPER_ARM;
    const L2 = FOREARM + HAND;
    const S = upper.getWorldPosition(this.v1);
    const n = this.v2.subVectors(target, S);
    const dist = Math.min(Math.max(n.length(), 0.08), L1 + L2 - 0.002);
    n.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const perp = this.v3.copy(pole).addScaledVector(n, -pole.dot(n));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    const elbow = this.v4.copy(S).addScaledVector(n, a).addScaledVector(perp, h);
    const hand = S.clone().addScaledVector(n, dist);
    this.aim(upper, elbow.clone().sub(S));
    upper.updateMatrixWorld(true);
    this.aim(fore, hand.sub(elbow));
    fore.updateMatrixWorld(true);
  }

  /** 関節のローカル -Y をワールド方向 dir へ向ける。 */
  private aim(obj: Object3D, dir: Vector3): void {
    const world = this.q1.setFromUnitVectors(DOWN, dir.normalize());
    const parent = obj.parent!.getWorldQuaternion(new Quaternion()).invert();
    obj.quaternion.copy(parent.multiply(world));
  }

  /** 無敵中などの点滅表示。 */
  setGhost(on: boolean): void {
    for (const m of this.materials) {
      m.transparent = on;
      m.opacity = on ? 0.55 : 1;
    }
  }

  /** 素材ビューア用: 全高 (m)。 */
  measureHeight(): number {
    this.root.updateMatrixWorld(true);
    const p = this.joints.head.getWorldPosition(new Vector3());
    const base = this.root.getWorldPosition(new Vector3());
    return p.y - base.y + 0.062 + 0.108;
  }
}

const DOWN = new Vector3(0, -1, 0);
