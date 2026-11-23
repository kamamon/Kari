// 「岩殻の〜」（ガルドロスの素材で強化した武器）の仮の見た目。
// 設定図がまだ無いので、元の武器の形に、単色の岩の板と青銅色の留め帯を足すだけにしてある（当たり判定は元の武器と同じ）。
// 断岳剣だけは heavyBlade.ts の中で同じことをしている（先に作ったため）。
// 武器の向きは共通: 原点が握り、+Y が先、-Z が刃（弓は背）、+Z が峰（弓は弦）。単位 m。
import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import type { WeaponModel } from './heavyBlade';

/** 岩の板 1 枚: 中心の高さ y と前後の位置 z、高さ h・前後の幅 d・厚み t、傾き。band を false にすると留め帯を付けない */
export interface ShellPlate {
  y: number;
  z: number;
  h: number;
  d: number;
  t: number;
  tilt?: number;
  band?: boolean;
}

/** 強化後のモデルの ID → 足す板。値は見た目だけのもので、机上で決めた */
export const SHELL_PLATES: Record<string, ShellPlate[]> = {
  // 護刃の剣: 峰（+Z 3.9cm）に 3 枚
  'model.weapon.guard_blade.002': [
    { y: 0.3, z: 0.052, h: 0.12, d: 0.044, t: 0.03, tilt: 0.08 },
    { y: 0.47, z: 0.055, h: 0.13, d: 0.05, t: 0.032, tilt: -0.06 },
    { y: 0.63, z: 0.05, h: 0.11, d: 0.04, t: 0.028, tilt: 0.05 },
  ],
  // 大槌: 前後の叩く面（±Z 19cm）に岩のかたまりをかぶせ、頭の上にも 1 枚
  'model.weapon.war_maul.002': [
    { y: 1.12, z: 0.21, h: 0.27, d: 0.06, t: 0.23, band: false },
    { y: 1.12, z: -0.21, h: 0.27, d: 0.06, t: 0.23, band: false },
    { y: 1.255, z: 0, h: 0.035, d: 0.3, t: 0.2, band: false },
  ],
  // 双剣（左右とも）: 峰（+Z 2.3cm）の根元寄りに 2 枚
  'model.weapon.twin_blades.002': [
    { y: 0.17, z: 0.034, h: 0.09, d: 0.03, t: 0.022, tilt: 0.08 },
    { y: 0.31, z: 0.036, h: 0.1, d: 0.034, t: 0.022, tilt: -0.06 },
  ],
  // 太刀: 峰（+Z 1.6cm。先へ行くほど峰の側へ反る）の根元寄りに 3 枚
  'model.weapon.long_blade.002': [
    { y: 0.17, z: 0.027, h: 0.1, d: 0.03, t: 0.02, tilt: 0.06 },
    { y: 0.33, z: 0.03, h: 0.11, d: 0.032, t: 0.02, tilt: -0.03 },
    { y: 0.5, z: 0.036, h: 0.1, d: 0.028, t: 0.018, tilt: 0.06 },
  ],
  // 長尖槍: 穂先（1.73m から上）のすぐ下の柄を、前後から挟む
  'model.weapon.long_lance.002': [
    { y: 1.6, z: 0.045, h: 0.2, d: 0.05, t: 0.075, tilt: -0.05 },
    { y: 1.6, z: -0.045, h: 0.2, d: 0.05, t: 0.075, tilt: 0.05 },
    { y: 1.38, z: 0.04, h: 0.12, d: 0.04, t: 0.065, tilt: -0.04 },
  ],
  // 環弓: 握りの上下の、弓の背（-Z）に 1 枚ずつ
  'model.weapon.ring_bow.002': [
    { y: 0.27, z: -0.035, h: 0.15, d: 0.035, t: 0.045, tilt: -0.12 },
    { y: -0.27, z: -0.035, h: 0.15, d: 0.035, t: 0.045, tilt: 0.12 },
  ],
};

const ROCK = 0xa69c8b, ROCK_DARK = 0x7c7466, BRONZE = 0xb08a4e;

/** 元の武器の形に、岩の板と留め帯を足す。name はモデルの ID（強化後）。 */
export function withShell(base: WeaponModel, name: string): WeaponModel {
  const plates = SHELL_PLATES[name] ?? [];
  const rock = new MeshLambertMaterial({ color: ROCK });
  const rockDark = new MeshLambertMaterial({ color: ROCK_DARK });
  const bronze = new MeshLambertMaterial({ color: BRONZE });
  let triangles = base.triangles;
  plates.forEach((p, i) => {
    const plate = new Mesh(new BoxGeometry(p.t, p.h, p.d), i % 2 ? rockDark : rock);
    plate.position.set(0, p.y, p.z);
    plate.rotation.x = p.tilt ?? 0;
    plate.castShadow = true;
    base.group.add(plate);
    triangles += 12;
    if (p.band !== false) {
      // 板を留める青銅色の帯（板より少しだけ厚く、板の下寄りを巻く）
      const band = new Mesh(new BoxGeometry(p.t + 0.006, Math.max(0.012, p.h * 0.14), p.d + 0.012), bronze);
      band.position.set(0, p.y - p.h * 0.28, p.z - Math.sign(p.z) * 0.004);
      band.rotation.x = p.tilt ?? 0;
      base.group.add(band);
      triangles += 12;
    }
  });
  base.group.name = name;
  return { group: base.group, art: base.art, triangles };
}
