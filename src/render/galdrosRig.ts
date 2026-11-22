// 岩殻獣ガルドロスの仮モデル。体つきと岩板の分け方は、採用した設定図
// （art-source/monster/galdros/、全長 5.8m・全高 約 2.45m・左肩の岩板が大きい）に合わせてある。
// 箱と多面体の組み合わせで、正式モデル（GLB）が来るまでの仮素材。
// 前脚叩きの脚と尾払いの尾は、判定と同じ軌道データで動かす（見た目 = 判定）。
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { smoothstep } from '../core/math';
import { renderTick } from '../game/action';
import type { MonsterState } from '../game/monster';
import { sampleTrack } from '../game/tracks';
import { mergeByMaterial } from './merge';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';

const lam = (color: number, emissive = 0): MeshLambertMaterial => new MeshLambertMaterial({ color, emissive, flatShading: true });
const DOWN = new Vector3(0, -1, 0);
const UP = new Vector3(0, 1, 0);
const TAIL_REST = new Vector3(0, -0.12, -1).normalize();

export class GaldrosRig implements MonsterRig {
  readonly root = new Group();
  /** 切り落とした尾の先。地面に残るので、モンスターとは別にシーンへ置く。 */
  readonly extras: Group[] = [];
  private drop = new Group();
  private tilt = new Group();
  private torso = new Group();
  private head = new Group();
  private headCap = new Group();
  private dome = new Group();
  private core: Mesh;
  private legs: Group[] = [];
  private tail = new Group();
  private tailEnd = new Group();
  private eyeMat = lam(0xffc46a, 0xa06a10);
  private rimMat = lam(0xb08d57, 0x2a1d08);
  private partMats: MeshLambertMaterial[][] = [];
  private flash: number[] = [];
  private index: Record<string, number> = {};
  private phase = 0;
  private v = new Vector3();
  private v2 = new Vector3();

  constructor(partIds: readonly string[]) {
    const hide = lam(0x6b6257);
    const hideHead = lam(0x716859);
    const belly = lam(0x8b8170);
    const rock = lam(0x80847a);
    const capRock = lam(0x858a7c);
    const moss = lam(0x7b8667);
    const legF = lam(0x665d53);
    const legH = lam(0x665d53);
    const tailMat = lam(0x6b6257);
    const claw = lam(0xb8ab8c);
    const mats: Record<string, MeshLambertMaterial[]> = { head: [hideHead, capRock], tail: [tailMat], back: [rock, moss], foreleg: [legF], hindleg: [legH], body: [hide, belly] };
    partIds.forEach((id, i) => {
      this.index[id] = i;
      this.partMats.push(mats[id] ?? []);
      this.flash.push(0);
    });

    const ico = (m: MeshLambertMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number, detail = 1): Mesh => {
      const mesh = new Mesh(new IcosahedronGeometry(1, detail), m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };
    const box = (m: MeshLambertMaterial, w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };
    /** 岩板。下に一回り大きい青銅色の薄板を重ねて、縁取りに見せる。 */
    const plate = (m: MeshLambertMaterial, w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, rz: number): Group => {
      const g = new Group();
      g.add(box(m, w, h, d, 0, 0, 0), box(this.rimMat, w + 0.09, h * 0.4, d + 0.09, 0, -h * 0.34, 0));
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, rz);
      return g;
    };

    this.root.add(this.tilt);
    this.torso.position.y = 1.25;
    this.tilt.add(this.torso);
    const T = -1.25; // torso の中は、体の中心の高さを原点にする

    // 胴: しわのある厚い皮（上面は岩板で覆う）
    this.torso.add(ico(hide, 1.22, 0.8, 2.0, 0, 1.36 + T, 0), ico(belly, 1.05, 0.5, 1.75, 0, 1.12 + T, 0.05));
    // 背殻: 中央で左右 2 枚に割れた大きな岩板
    this.dome.add(ico(rock, 0.86, 0.36, 1.42, 0.52, 2.02 + T, -0.1, 0), ico(moss, 0.86, 0.36, 1.42, -0.52, 2.02 + T, -0.1, 0));
    this.dome.children[0]!.rotation.z = -0.2;
    this.dome.children[1]!.rotation.z = 0.2;
    this.dome.add(box(this.rimMat, 0.07, 0.1, 2.5, 0, 2.22 + T, -0.1));
    this.core = ico(lam(0x3f3a36), 0.95, 0.3, 1.35, 0, 1.92 + T, -0.1, 0);
    this.torso.add(this.dome, this.core);
    // 肩と腰の岩板: 左は大きな一枚、右は中 1 枚 + 小 1 枚（設定図の左右差）
    this.torso.add(
      plate(moss, 1.35, 0.3, 1.5, 1.08, 1.72 + T, 0.95, 0.05, 0.15, -0.78),
      plate(rock, 0.92, 0.26, 1.0, -1.02, 1.8 + T, 1.05, 0.05, -0.1, 0.72),
      plate(rock, 0.6, 0.2, 0.62, -1.2, 1.32 + T, 1.3, 0, -0.2, 1.0),
      plate(rock, 1.05, 0.26, 1.15, 1.02, 1.55 + T, -1.12, -0.1, -0.1, -0.82),
      plate(moss, 0.72, 0.22, 0.82, -1.02, 1.5 + T, -1.18, -0.1, 0.1, 0.82),
    );

    // 頭: 低く前へ突き出す。口先は嘴状。頭頂に壊せる岩。
    this.head.position.set(0, 1.5 + T, 1.6);
    this.head.add(box(hideHead, 0.88, 0.78, 1.05, 0, 0.05, 0.4), box(hideHead, 0.62, 0.5, 0.5, 0, -0.1, 1.0));
    const beak = new Mesh(new ConeGeometry(0.2, 0.42, 5), claw);
    beak.position.set(0, -0.28, 1.25);
    beak.rotation.x = Math.PI * 0.9;
    this.head.add(beak);
    for (const x of [-0.4, 0.4]) {
      const eye = new Mesh(new IcosahedronGeometry(0.075, 0), this.eyeMat);
      eye.position.set(x, 0.14, 0.82);
      this.head.add(eye);
    }
    this.headCap.add(plate(capRock, 0.52, 0.2, 1.0, 0.27, 0.52, 0.32, 0.12, 0, -0.1), plate(capRock, 0.5, 0.2, 0.95, -0.27, 0.52, 0.3, 0.12, 0, 0.12));
    this.head.add(this.headCap);
    this.torso.add(this.head);

    // 脚 4 本: 前左・前右・後左・後右。支点は肩と腰。左が +X。
    const legSpecs: [number, number, number, MeshLambertMaterial, number][] = [
      [1.0, 1.5, 1.05, legF, 1.5],
      [-1.0, 1.5, 1.05, legF, 1.5],
      [0.95, 1.4, -1.05, legH, 1.4],
      [-0.95, 1.4, -1.05, legH, 1.4],
    ];
    legSpecs.forEach(([x, y, z, m, len], i) => {
      const g = new Group();
      g.position.set(x, y, z);
      const leg = new Mesh(new CylinderGeometry(0.46, 0.5, len - 0.25, 7), m);
      leg.position.y = -(len - 0.25) / 2;
      leg.castShadow = true;
      g.add(leg, box(m, 0.86, 0.3, 1.0, 0, -len + 0.15, 0.12));
      for (const cx of [-0.28, 0, 0.28]) {
        const c = new Mesh(new ConeGeometry(0.09, 0.3, 4), claw);
        c.position.set(cx, -len + 0.1, 0.68);
        c.rotation.x = Math.PI / 2;
        g.add(c);
      }
      // 前脚の外側の甲。左が大きい。
      if (i === 0) g.add(plate(moss, 0.85, 0.16, 0.9, 0.5, -0.8, 0.05, 0, 0, -Math.PI / 2 + 0.1));
      if (i === 1) g.add(plate(rock, 0.55, 0.14, 0.6, -0.5, -0.85, 0.05, 0, 0, Math.PI / 2 - 0.1));
      this.legs.push(g);
      this.tilt.add(g);
    });

    // 尾: 付け根が支点、+Y が尾先。先端に青銅色の晶の塊。
    this.tail.position.set(0, 1.0 + T, -1.5);
    const seg = (r0: number, r1: number, from: number, to: number): Mesh => {
      const mesh = new Mesh(new CylinderGeometry(r1, r0, to - from, 7), tailMat);
      mesh.position.y = (from + to) / 2;
      mesh.castShadow = true;
      return mesh;
    };
    this.tail.add(seg(0.46, 0.38, 0, 0.9));
    const crystals = (g: Group, at: number): void => {
      const cm = lam(0xb8935a, 0x3a2a0c);
      for (const [x, y, z, s] of [[0, at + 0.3, 0, 0.36], [0.16, at + 0.62, 0.1, 0.27], [-0.14, at + 0.6, -0.12, 0.25], [0, at + 0.88, 0, 0.2]] as const) {
        const c = new Mesh(new IcosahedronGeometry(s, 0), cm);
        c.position.set(x, y, z);
        c.castShadow = true;
        g.add(c);
      }
    };
    this.tailEnd.add(seg(0.38, 0.31, 0.9, 1.75));
    crystals(this.tailEnd, 1.7);
    this.tail.add(this.tailEnd);
    this.torso.add(this.tail);

    // 切り落とした尾の先（最初は隠す）
    const piece = new Mesh(new CylinderGeometry(0.31, 0.38, 0.85, 7), tailMat);
    piece.position.y = 0.42;
    this.drop.add(piece);
    crystals(this.drop, 0.8);
    this.drop.rotation.x = Math.PI / 2 - 0.08;
    const dropRoot = new Group();
    dropRoot.add(this.drop);
    this.drop.position.y = 0.34;
    dropRoot.visible = false;
    this.extras.push(dropRoot);

    // 動かす単位ごとに、同じ素材のメッシュをまとめる（描画回数を約半分にする）
    for (const g of [this.head, this.headCap, this.dome, this.core, this.tail, this.tailEnd]) g.userData.dynamic = true;
    for (const g of [this.torso, this.dome, this.head, this.headCap, this.tail, this.tailEnd, this.drop, ...this.legs]) mergeByMaterial(g);
  }

  hitFlash(partIndex: number): void {
    this.flash[partIndex] = 1;
  }

  /** 尾を切った時に、落ちた位置へ尾先を置く。 */
  placeSevered(x: number, y: number, z: number, yaw: number): void {
    const d = this.extras[0]!;
    d.position.set(x, y, z);
    d.rotation.y = yaw + Math.PI;
    d.visible = true;
  }

  update(m: MonsterState, c: MonsterRigCtx): void {
    const part = (id: string): MonsterState['parts'][number] | undefined => m.parts[this.index[id] ?? -1];
    this.headCap.visible = !part('head')?.broken;
    this.dome.visible = !part('back')?.broken;
    this.core.visible = !!part('back')?.broken;
    this.tailEnd.visible = !part('tail')?.severed;
    for (let i = 0; i < this.flash.length; i++) {
      const f = (this.flash[i] = Math.max(0, this.flash[i]! - c.dt * 5));
      for (const mat of this.partMats[i] ?? []) mat.emissive.setRGB(f * 0.9, f * 0.75, f * 0.45);
    }
    // 怒り: 目と岩板の縁が赤く光る
    const rage = m.enraged ? 0.6 + 0.4 * Math.sin(c.time * 7) : 0;
    this.eyeMat.emissive.setRGB(0.63 + rage * 0.37, 0.42 - rage * 0.3, 0.06);
    this.rimMat.emissive.setRGB(0.16 + rage * 0.6, 0.11 + rage * 0.08, 0.03);

    const speed = Math.hypot(m.pos.x - m.prevPos.x, m.pos.z - m.prevPos.z) * 60;
    this.phase += speed * c.dt * 1.9;
    const swing = Math.min(1, speed / 2.6) * 0.32;
    const legSwing = [Math.sin(this.phase), -Math.sin(this.phase), -Math.sin(this.phase), Math.sin(this.phase)].map((s) => s * swing);

    let pitch = 0;
    let twist = 0;
    let headPitch = m.aware ? 0.04 * Math.sin(c.time * 0.9) : 0.22 + 0.05 * Math.sin(c.time * 0.6);
    let jitter = 0;
    let roll = 0;
    let sink = 0;
    let bob = speed > 0.2 ? Math.sin(this.phase * 2) * 0.035 : Math.sin(c.time * 1.3) * 0.012;
    let slamLeg = -1;
    const tailDir = this.v.copy(TAIL_REST);
    tailDir.x += Math.sin(c.time * 1.1) * 0.12;

    const run = m.action;
    if (run && !m.dead) {
      const t = renderTick(run, c.alpha);
      const clip = run.def.clip;
      const track = run.def.weaponTrack ? c.content.tracks.get(run.def.weaponTrack) : undefined;
      if (clip.startsWith('galdros_slam') && track) {
        slamLeg = clip.includes('_l_') ? 0 : 1;
        const s = sampleTrack(track, t);
        this.legs[slamLeg]!.quaternion.setFromUnitVectors(DOWN, this.v2.set(s.dir.x, s.dir.y, s.dir.z).normalize());
        pitch = t < 48 ? -0.1 * smoothstep(t / 40) : 0.09 * (1 - smoothstep((t - 54) / 60));
        headPitch = t < 48 ? -0.18 * smoothstep(t / 40) : 0.28 * (1 - smoothstep((t - 54) / 50));
      } else if (clip === 'galdros_charge_01') {
        const wind = smoothstep(t / 30) * (1 - smoothstep((t - 140) / 40));
        headPitch = 0.42 * wind;
        pitch = 0.07 * wind;
        if (t > 10 && t < 52) legSwing[1] = Math.sin(t * 0.42) * 0.55; // 右前脚で地面を掻く
        bob *= 1.6;
      } else if (clip === 'galdros_tail_sweep_01' && track) {
        const s = sampleTrack(track, t);
        tailDir.set(s.dir.x, s.dir.y, s.dir.z);
        twist = -Math.atan2(s.dir.x, -s.dir.z) * 0.1;
        headPitch = 0.1;
      } else if (clip === 'galdros_rockfall_01') {
        const k = smoothstep(t / 20) * (1 - smoothstep((t - 55) / 30));
        jitter = 0.04 * k;
        pitch = 0.1 * k;
        headPitch = 0.32 * k;
      } else if (clip === 'galdros_roar_01') {
        const k = smoothstep(t / 12) * (1 - smoothstep((t - 58) / 20));
        headPitch = -0.62 * k;
        pitch = -0.09 * k;
        jitter = 0.02 * k;
      }
    }

    if (m.dead) {
      const e = smoothstep(m.deadTicks / 55);
      roll = e * 1.3;
      sink = -e * 0.25;
      headPitch = 0.3 * e;
    } else if (m.staggerTicks > 0 && m.staggerTotal > 0) {
      const u = 1 - m.staggerTicks / m.staggerTotal;
      if (m.staggerKind === 'topple') {
        const k = smoothstep(u / 0.12) * (1 - smoothstep((u - 0.82) / 0.18));
        roll = 1.12 * k;
        sink = -0.2 * k;
        for (let i = 0; i < 4; i++) legSwing[i] = Math.sin(c.time * 8 + i * 1.7) * 0.4 * k;
      } else {
        const k = 1 - smoothstep(u);
        pitch = -0.16 * k;
        headPitch = -0.34 * k;
        jitter = 0.035 * k;
      }
    }

    this.legs.forEach((leg, i) => {
      if (i !== slamLeg) leg.rotation.set(legSwing[i]!, 0, 0);
    });
    this.tilt.rotation.z = roll;
    this.tilt.position.y = sink;
    this.torso.rotation.set(pitch, twist, 0);
    this.torso.position.set(jitter ? Math.sin(c.time * 61) * jitter : 0, 1.25 + bob + (jitter ? Math.sin(c.time * 47) * jitter * 0.6 : 0), 0);
    this.head.rotation.x = headPitch;
    this.tail.quaternion.setFromUnitVectors(UP, tailDir.normalize());
  }
}
