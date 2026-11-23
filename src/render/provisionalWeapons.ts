// 大槌・双剣・太刀の仮モデル。設定図がまだ無いので、寸法だけを決めた単色の形（箱と筒）で組んである。
// 設定図が届いたら、ほかの武器と同じく、図を測った形に図を貼ったものへ作り直す（D-055）。
// どれも原点は握り、+Y が武器の先、-Z が刃（大槌は叩く面）の向く方。単位 m。
import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry } from 'three';
import type { WeaponModel } from './heavyBlade';

const STEEL = 0x8b9097, DARK_STEEL = 0x5d6168, WOOD = 0x6b4a2e, LEATHER = 0x4a3324, BRONZE = 0x9a7a45;

class Parts {
  readonly group = new Group();
  triangles = 0;
  private mats = new Map<number, MeshLambertMaterial>();
  add(g: BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
    let m = this.mats.get(color);
    if (!m) this.mats.set(color, (m = new MeshLambertMaterial({ color })));
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    return mesh;
  }
  done(name: string): WeaponModel {
    this.group.name = name;
    return { group: this.group, art: [], triangles: Math.round(this.triangles) };
  }
}

/**
 * 大槌（仮）。原点は下の握り（右手）の中央。上の握り（左手）は 0.5m 上。
 * 柄 -0.2m（石突）〜 1.25m、頭は高さ 1.0〜1.24m に 幅 0.2 × 奥行 0.38m（叩く面は ±Z）。全長 1.45m。
 */
export function buildWarMaul(): WeaponModel {
  const p = new Parts();
  p.add(new CylinderGeometry(0.02, 0.022, 1.45, 10), WOOD, 0, 0.525, 0);
  p.add(new CylinderGeometry(0.026, 0.026, 0.05, 10), BRONZE, 0, -0.19, 0);
  for (const y of [0, 0.5]) p.add(new CylinderGeometry(0.024, 0.024, 0.16, 10), LEATHER, 0, y, 0);
  // 頭: 中の塊と、前後の叩く面、柄を通す金具
  p.add(new BoxGeometry(0.17, 0.2, 0.26), DARK_STEEL, 0, 1.12, 0);
  for (const z of [-0.16, 0.16]) p.add(new BoxGeometry(0.2, 0.24, 0.06), STEEL, 0, 1.12, z);
  p.add(new CylinderGeometry(0.034, 0.034, 0.3, 10), BRONZE, 0, 1.12, 0);
  return p.done('model.weapon.war_maul.001');
}

/**
 * 双剣の 1 本（仮）。左右で同じ形。原点は握りの中央。
 * 柄頭 -0.08m、握り -0.06〜0.06m、鍔 0.07m、刃 0.08〜0.62m（幅 4.6cm、厚み 0.8cm）。全長 0.7m。
 */
export function buildTwinBlade(): WeaponModel {
  const p = new Parts();
  p.add(new CylinderGeometry(0.015, 0.016, 0.12, 8), LEATHER, 0, 0, 0);
  p.add(new SphereGeometry(0.02, 8, 6), BRONZE, 0, -0.075, 0);
  p.add(new BoxGeometry(0.02, 0.016, 0.1), BRONZE, 0, 0.07, 0);
  p.add(new BoxGeometry(0.008, 0.44, 0.046), STEEL, 0, 0.3, 0);
  // 切っ先: 4 角すいを平たくつぶす
  const tip = p.add(new ConeGeometry(0.0325, 0.1, 4), STEEL, 0, 0.57, 0, 0, Math.PI / 4, 0);
  tip.scale.set(0.175, 1, 1);
  return p.done('model.weapon.twin_blades.001');
}

/**
 * 太刀（仮）。原点は上の手（右手。鍔のすぐ下）の握りの中央。下の手（左手）は 0.2m 下。
 * 柄 -0.27〜0.06m、鍔 0.07m、刃 0.08〜1.2m（幅 3.2cm、厚み 0.7cm。峰の側 = +Z へ少し反る）。全長 1.47m。
 */
export function buildLongBlade(): WeaponModel {
  const p = new Parts();
  p.add(new CylinderGeometry(0.015, 0.016, 0.33, 8), LEATHER, 0, -0.105, 0);
  p.add(new CylinderGeometry(0.018, 0.018, 0.02, 8), BRONZE, 0, -0.275, 0);
  p.add(new CylinderGeometry(0.04, 0.04, 0.008, 12), BRONZE, 0, 0.07, 0);
  // 刃: 6 つに分けて、先へ行くほど峰の側へ少しずつ反らせる
  const N = 6, L = 1.02 / N;
  let y = 0.08, z = 0, tilt = 0;
  for (let i = 0; i < N; i++) {
    tilt = 0.012 * i;
    p.add(new BoxGeometry(0.007, L + 0.004, 0.032 - i * 0.0015), STEEL, 0, y + (L / 2) * Math.cos(tilt), z + (L / 2) * Math.sin(tilt), tilt, 0, 0);
    y += L * Math.cos(tilt);
    z += L * Math.sin(tilt);
  }
  const tip = p.add(new ConeGeometry(0.016, 0.1, 4), STEEL, 0, y + 0.05, z + 0.003, tilt, Math.PI / 4, 0);
  tip.scale.set(0.22, 1, 1);
  return p.done('model.weapon.long_blade.001');
}
