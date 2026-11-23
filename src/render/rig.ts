// 関節付きの仮ハンター（2 代目）。骨の階層へ、設定図に合わせた体の皮（hunterBody.ts）を重み付けして付ける。
// コードで組んだ仮素材で、正式モデル（GLB）の差し替え口になる。
// 骨と socket の名前・向きは docs/animation-contract.md と揃える。
//   root → pelvis → spine → chest → neck → head / 腕 / 脚、socket_hand_r / socket_hand_l / socket_back / socket_hip
// 単位 m、Y 上、+Z 前。身長 1.75m。右手側は -X。
import { Bone, BufferAttribute, BufferGeometry, DataTexture, DoubleSide, Group, Line, LineBasicMaterial, Matrix4, MeshLambertMaterial, Object3D, Quaternion, SRGBColorSpace, Skeleton, SkinnedMesh, TextureLoader, Vector3 } from 'three';
import { assetUrl } from '../core/assets';
import { BOW_STRING, buildArrow, buildBow } from './bow';
import { buildGuardBladeShield, buildGuardBladeSword } from './guardBlade';
import { buildHeavyBlade, type WeaponModel } from './heavyBlade';
import { buildGreatShield, buildLance } from './lance';
import { buildScythe } from './scythe';
import { HUNTER_ATLAS } from './hunterAtlas';
import { REST, buildHunterBody } from './hunterBody';
import { JOINTS, type BodyPose, type JointName } from './poses';
import { packCharts, type AtlasChart } from './procGeo';

const HUNTER_TEX = 'assets/textures/hunter/hunter_body_v1.webp';

const D2R = Math.PI / 180;
const UPPER_ARM = REST.upperArm;
const FOREARM = REST.forearm;
const HAND = 0.04;
const TUMBLE_PIVOT = 0.55;

/** 武器系統ごとの仮モデル（握りが原点、+Y が武器の先）。無い系統は断岳剣で代用する。 */
const WEAPON_BUILDERS: Record<string, () => WeaponModel> = {
  heavy_blade: buildHeavyBlade,
  guard_blade: buildGuardBladeSword,
  reap_scythe: buildScythe,
  long_lance: buildLance,
  // 弦は、引いた形に合わせてリグが張る
  ring_bow: () => buildBow(false),
};
const SHIELD_BUILDERS = { shield_small: buildGuardBladeShield, shield_great: buildGreatShield } as const;
export type ShieldKind = keyof typeof SHIELD_BUILDERS;

/** 両腕の持ち方。two = 両手で 1 本を持つ（もう片方は握りから along だけ先）/ other = もう片方の手の位置（武器のローカル座標。弓の弦） */
export interface HandsSpec {
  two: boolean;
  along?: number;
  primary?: 'right' | 'left';
  other?: { x: number; y: number; z: number } | null;
}

export class HunterRig {
  readonly root = new Group();
  readonly joints = {} as Record<JointName, Object3D>;
  readonly sockets = { hand_r: new Object3D(), hand_l: new Object3D(), back: new Object3D(), hip: new Object3D() };
  /** 手に持つ武器の入れ物（中身は武器系統ごとに差し替える）と、左腕の盾の入れ物 */
  readonly weapon = new Group();
  readonly shield = new Group();
  familyId = '';
  private models: Record<string, WeaponModel> = {};
  private shields: Partial<Record<ShieldKind, WeaponModel>> = {};
  private tumbleYaw = new Group();
  private tumble = new Group();
  private tumbleBack = new Group();
  private body = new Group();
  private materials: MeshLambertMaterial[] = [];
  /** 弓の弦（上の先 → 引いた点 → 下の先）と、つがえた矢 */
  private bowString: Line | null = null;
  private bowArrow: Group | null = null;
  /** 体の絵を貼る区画（書き出しと検査用）と、区画の並びが焼いた絵と同じか */
  atlasCharts: AtlasChart[] = [];
  atlasStored = false;
  /** 設定図から焼いた絵の読み込みが終わったか / 失敗したか */
  artLoaded = false;
  artFailed = false;
  bodyTriangles = 0;
  /** 断岳剣の絵の読み込み状態と、面の数（検査用） */
  weaponArt: { loaded: boolean; failed: boolean }[] = [];
  weaponTriangles = 0;
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
    this.root.name = 'root';
    const j = (name: JointName, parent: Object3D, x: number, y: number, z: number): Object3D => {
      const o = new Bone();
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

    // 骨の静止位置は hunterBody.ts の REST と同じ値（体の皮はこの位置に合わせて作ってある）
    const pelvis = j('pelvis', this.body, 0, REST.pelvisY, 0);
    const spine = j('spine', pelvis, 0, REST.spineY - REST.pelvisY, 0);
    const chest = j('chest', spine, 0, REST.chestY - REST.spineY, 0);
    const neck = j('neck', chest, 0, REST.neckY - REST.chestY, 0);
    j('head', neck, 0, REST.headY - REST.neckY, 0);
    for (const side of [-1, 1] as const) {
      const S = side < 0 ? 'R' : 'L';
      const upper = j(`upperArm${S}` as JointName, chest, REST.shoulderX * side, REST.shoulderY - REST.chestY, 0);
      const fore = j(`forearm${S}` as JointName, upper, 0, -UPPER_ARM, 0);
      const hand = j(`hand${S}` as JointName, fore, 0, -FOREARM, 0);
      const socket = side < 0 ? this.sockets.hand_r : this.sockets.hand_l;
      socket.name = side < 0 ? 'socket_hand_r' : 'socket_hand_l';
      socket.position.set(0, -HAND, 0);
      hand.add(socket);
      const thigh = j(`thigh${S}` as JointName, pelvis, REST.hipX * side, REST.hipY - REST.pelvisY, 0);
      const shin = j(`shin${S}` as JointName, thigh, 0, -REST.thigh, 0);
      j(`foot${S}` as JointName, shin, 0, -REST.shin, 0);
    }

    // ---- 体の皮: 骨に重み付けした 1 枚のメッシュ。色は設定図から焼いた絵（読み込みが終わるまでは平均の色）----
    const body = buildHunterBody();
    this.atlasCharts = body.charts;
    const stored = HUNTER_ATLAS.rects as Record<string, readonly [number, number, number, number] | undefined>;
    this.atlasStored = body.charts.length === Object.keys(stored).length && body.charts.every((c) => stored[c.kind]);
    const rects = this.atlasStored ? stored : packCharts(body.charts);
    for (const c of body.charts) c.rect = rects[c.kind]!;
    const flat = new DataTexture(new Uint8Array([130, 104, 83, 255]), 1, 1);
    flat.colorSpace = SRGBColorSpace;
    flat.channel = 1;
    flat.needsUpdate = true;
    const bodyMat = new MeshLambertMaterial({ map: flat, vertexColors: true, side: DoubleSide });
    this.materials.push(bodyMat);
    this.root.updateMatrixWorld(true);
    const skeleton = new Skeleton(JOINTS.map((n) => this.joints[n] as Bone));
    const mesh = new SkinnedMesh(body.build(), bodyMat);
    mesh.name = 'hunter_body';
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    mesh.bind(skeleton, new Matrix4());
    this.bodyTriangles = body.triangles;
    new TextureLoader().load(
      assetUrl(HUNTER_TEX),
      (t) => {
        t.colorSpace = SRGBColorSpace;
        t.channel = 1;
        t.anisotropy = 4;
        bodyMat.map = t;
        flat.dispose();
        this.artLoaded = true;
      },
      undefined,
      () => (this.artFailed = true),
    );

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
    this.orient(this.sockets.hand_l, new Vector3(0, 0.35, 1), new Vector3(1, 0, 0));

    // 腰の socket: 短い剣を納める（握りが左腰の前寄り、刃は後ろ下へ）。右手が届く位置にしてある。
    // 位置と向きは、抜刀・納刀の動き（tools/weapons/guard_blade.mjs の HILT・SHEATH）と同じ値。
    this.sockets.hip.position.set(0.17, 0.08, 0.06);
    this.orient(this.sockets.hip, new Vector3(0.1, -0.8, -0.6), new Vector3(1, 0, 0));
    this.weapon.matrixAutoUpdate = false;
    this.shield.matrixAutoUpdate = false;
    this.shield.visible = false;
    this.root.add(this.weapon, this.shield);
    this.setFamily('heavy_blade');
  }

  /** 手に持つ武器（と左腕の盾）を、武器系統のものへ差し替える。 */
  setFamily(id: string, offhand?: ShieldKind): void {
    if (id === this.familyId) return;
    this.familyId = id;
    const m = (this.models[id] ??= (WEAPON_BUILDERS[id] ?? buildHeavyBlade)());
    this.weapon.clear();
    this.weapon.add(m.group);
    this.weaponArt = m.art;
    this.weaponTriangles = m.triangles;
    if (id === 'ring_bow') {
      if (!this.bowString) {
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
        this.bowString = new Line(g, new LineBasicMaterial({ color: 0xd8cfb4 }));
        this.bowString.frustumCulled = false;
        this.bowArrow = buildArrow().group;
        this.bowArrow.rotation.x = -Math.PI / 2;
      }
      this.weapon.add(this.bowString, this.bowArrow!);
      this.setString(null);
    }
    this.shield.clear();
    this.shield.visible = !!offhand;
    if (offhand) {
      const s = (this.shields[offhand] ??= SHIELD_BUILDERS[offhand]());
      this.shield.add(s.group);
      this.weaponArt = [...m.art, ...s.art];
    }
  }

  /** 盾を、アクターのローカル座標の位置へ置き（表は前。yaw で左右へ向ける）、左腕を IK で伸ばす。姿勢と武器を置いた後に呼ぶ。 */
  shieldTo(pos: { x: number; y: number; z: number }, yaw = 0): void {
    this.shield.matrix.makeRotationY(yaw).setPosition(pos.x, pos.y, pos.z);
    this.shield.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
    const target = new Vector3(pos.x, pos.y, pos.z - 0.04).applyMatrix4(this.root.matrixWorld);
    const rootQ = this.root.getWorldQuaternion(this.q2);
    this.solveArm(this.joints.upperArmL, this.joints.forearmL, target, new Vector3(0.7, -0.6, -0.3).applyQuaternion(rootQ));
  }

  /** 盾を背中へ付ける（納刀中）。姿勢を設定した後に呼ぶ。 */
  shieldToBack(): void {
    this.root.updateMatrixWorld(true);
    const inv = this.m2.copy(this.root.matrixWorld).invert();
    const local = this.m1.makeRotationY(Math.PI).setPosition(0.04, 0.2, -0.2);
    this.shield.matrix.multiplyMatrices(inv, this.joints.chest.matrixWorld).multiply(local);
    this.shield.matrixWorldNeedsUpdate = true;
  }

  /** 武器を、解いた置き場所（アクターのローカル座標）へ置く。腕は姿勢の側で解いてあるので、ここでは動かさない。 */
  placeWeapon(grip: readonly number[], dir: readonly number[], normal: readonly number[]): void {
    const b = this.basis(this.v4.set(dir[0]!, dir[1]!, dir[2]!).normalize(), new Vector3(normal[0], normal[1], normal[2]));
    b.setPosition(grip[0]!, grip[1]!, grip[2]!);
    this.weapon.matrix.copy(b);
    this.weapon.matrixWorldNeedsUpdate = true;
  }

  /** 盾を、解いた置き場所（アクターのローカル座標の位置と向き）へ置く。 */
  placeShield(pos: readonly number[], quat: readonly number[]): void {
    this.shield.matrix.compose(this.v1.set(pos[0]!, pos[1]!, pos[2]!), this.q1.set(quat[0]!, quat[1]!, quat[2]!, quat[3]!), this.v2.set(1, 1, 1));
    this.shield.matrixWorldNeedsUpdate = true;
  }

  /** 弓の弦を、引いた点（弓のローカル座標）まで張る。null なら、引いていない形へ戻す。矢をつがえている時は矢も出す。 */
  setString(s: { y: number; z: number; arrow: boolean } | null): void {
    if (!this.bowString || !this.bowArrow || this.familyId !== 'ring_bow') return;
    const y = s ? s.y : 0, z = s ? Math.max(BOW_STRING.z, s.z) : BOW_STRING.z;
    const p = this.bowString.geometry.getAttribute('position') as BufferAttribute;
    p.setXYZ(0, 0, BOW_STRING.top, BOW_STRING.z);
    p.setXYZ(1, 0, s ? y : 0, z);
    p.setXYZ(2, 0, BOW_STRING.bottom, BOW_STRING.z);
    p.needsUpdate = true;
    // 矢: 矢はずを弦の引いた点に掛け、矢じりを的（弓の背の方）へ向ける。矢の原点は中央（長さ 0.8m）。
    this.bowArrow.visible = !!s && s.arrow;
    this.bowArrow.position.set(0, y, z - 0.4);
  }

  /** 武器を、納めた時の置き場所（骨と、その骨の座標での位置・向き）へ付ける。姿勢を設定した後に呼ぶ。 */
  weaponToSheath(sh: { parent: 'chest' | 'pelvis'; pos: readonly number[]; dir: readonly number[]; normal: readonly number[] }): void {
    this.root.updateMatrixWorld(true);
    const inv = this.m2.copy(this.root.matrixWorld).invert();
    const local = this.basis(this.v4.set(sh.dir[0]!, sh.dir[1]!, sh.dir[2]!).normalize(), new Vector3(sh.normal[0], sh.normal[1], sh.normal[2])).setPosition(sh.pos[0]!, sh.pos[1]!, sh.pos[2]!);
    const world = new Matrix4().multiplyMatrices(this.joints[sh.parent].matrixWorld, local);
    this.weapon.matrix.multiplyMatrices(inv, world);
    this.weapon.matrixWorldNeedsUpdate = true;
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
    this.joints.pelvis.position.set(p.px ?? 0, REST.pelvisY + p.py, p.pz ?? 0);
    this.tumbleYaw.position.y = TUMBLE_PIVOT + p.drop;
    this.tumbleYaw.rotation.y = p.tumbleDir;
    this.tumble.rotation.x = p.tumble * D2R;
    this.tumbleBack.rotation.y = -p.tumbleDir;
    // 立っている姿勢では、低い方の足裏が地面（root の高さ）へ付くように骨盤を上下させる。
    // 仮のキー姿勢でも足が沈んだり浮いたりしないようにするための簡易な接地。
    // （足を解き終えた姿勢は、もう地面に合っているので触らない）
    if (!p.grounded && Math.abs(p.tumble) < 1 && p.drop === 0) {
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
  weaponToSocket(which: 'back' | 'hand_r' | 'hand_l' | 'hip'): void {
    this.root.updateMatrixWorld(true);
    const inv = this.m2.copy(this.root.matrixWorld).invert();
    this.weapon.matrix.multiplyMatrices(inv, this.sockets[which].matrixWorld);
    this.weapon.matrixWorldNeedsUpdate = true;
  }

  /**
   * 武器を軌道（アクターのローカル座標）へ置き、両腕を IK で握りへ伸ばす。
   * 判定と同じ軌道データを使うので、見える刃と当たり判定が一致する。
   */
  weaponToTrack(grip: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, normal: readonly number[], hands: HandsSpec): void {
    const d = this.v4.set(dir.x, dir.y, dir.z).normalize();
    const b = this.basis(d, new Vector3(normal[0], normal[1], normal[2]));
    b.setPosition(grip.x, grip.y, grip.z);
    this.weapon.matrix.copy(b);
    this.weapon.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
    const gripW = new Vector3(grip.x, grip.y, grip.z).applyMatrix4(this.root.matrixWorld);
    const dirW = new Vector3(dir.x, dir.y, dir.z).normalize().transformDirection(this.root.matrixWorld);
    const rootQ = this.root.getWorldQuaternion(this.q2);
    const J = this.joints;
    const right: [Object3D, Object3D, Vector3] = [J.upperArmR, J.forearmR, new Vector3(-0.6, -0.6, -0.5).applyQuaternion(rootQ)];
    const left: [Object3D, Object3D, Vector3] = [J.upperArmL, J.forearmL, new Vector3(0.6, -0.6, -0.5).applyQuaternion(rootQ)];
    const [first, second] = hands.primary === 'left' ? [left, right] : [right, left];
    this.solveArm(first[0], first[1], gripW, first[2]);
    if (hands.two) {
      this.solveArm(second[0], second[1], gripW.clone().addScaledVector(dirW, hands.along ?? 0.2), second[2]);
    } else if (hands.other) {
      // もう片方の手は、武器の上の決まった点へ（弓の弦）
      const o = new Vector3(hands.other.x, hands.other.y, hands.other.z).applyMatrix4(this.weapon.matrix).applyMatrix4(this.root.matrixWorld);
      this.solveArm(second[0], second[1], o, second[2]);
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
    return p.y - base.y + (REST.top - REST.headY);
  }
}

const DOWN = new Vector3(0, -1, 0);
