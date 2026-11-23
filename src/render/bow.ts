// 環弓（里鍛ちの環弓）と、矢・矢筒の仮モデル。設定図（art-source/weapon/weapon_kankyu_*_v1.png）の輪郭を測った寸法で
// 形を組み、図をそのまま貼る。v0.4.0 からゲーム内で使う。
// 寸法は依頼の指定を優先する（D-050）: 全高 1.5m、弓の背から弦まで 0.20m、輪の直径 8cm。
// 図は弓の背から弦までが約 0.24m と深く、輪も約 10cm と大きいので、前後の位置だけを縮め、輪は 8cm で作る。
import { Group } from 'three';
import { ArtMesh, type ArtStatus, type P3, type UV } from './artMesh';
import type { WeaponModel } from './heavyBlade';
import { KANKYU_ART, KANKYU_BOW, WEAPON_SHEETS } from './weaponSheets';

const DEPTH = 0.2; // 握りの背から弦まで
const RING_R = 0.04; // 輪の外側の半径
const RING_TUBE = 0.006;
const RING_X = 0.05; // 輪の中心。弓の本体のすぐ横（正面の図で、本体の右）

/** 弓。原点は握りの中央、+Y が上、-Z が弓の背（的の方）、+Z が弦（射手の方）。 */
export function buildBow(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.kankyuBow);
  // 握り（高さ 0 に最も近い点）を基準に、前後の位置を縮める率を決める
  const grip = KANKYU_BOW.reduce((best, s) => (Math.abs(s[0]) < Math.abs(best[0]) ? s : best));
  const kz = (DEPTH - grip[2]) / (KANKYU_ART.stringZ - grip[1]);
  const zOf = (zArt: number): number => (zArt - grip[1]) * kz;
  m.sweep(KANKYU_BOW.map(([y, czArt, rz, rx]) => ({ y, cz: zOf(czArt), rx, rz, czArt, rArt: rz })));
  // 弦: 上下の先端のあいだに、まっすぐ 1 本
  const top = KANKYU_BOW[1]!, bottom = KANKYU_BOW[KANKYU_BOW.length - 2]!;
  const sz = zOf(KANKYU_ART.stringZ);
  m.sweep([{ y: bottom[0], cz: sz, rx: 0.002, rz: 0.002, czArt: KANKYU_ART.stringZ, rArt: 0.001 }, { y: top[0], cz: sz, rx: 0.002, rz: 0.002, czArt: KANKYU_ART.stringZ, rArt: 0.001 }], 6);
  // 狙うための輪（青銅色）: 握りのすぐ上、本体の横。輪の面は的の方を向く。色は、図の輪の所から 1 色で取る。
  const bronze: UV = m.planar([0, KANKYU_ART.ringY, KANKYU_ART.ringZ]);
  const flat: [UV, UV, UV, UV] = [bronze, bronze, bronze, bronze];
  const rz = zOf(KANKYU_ART.ringZ);
  const R = RING_R - RING_TUBE;
  const ringPoint = (i: number, j: number): P3 => {
    const a = (2 * Math.PI * i) / 20, b = (2 * Math.PI * j) / 8;
    const r = R + RING_TUBE * Math.cos(b);
    return [RING_X + r * Math.cos(a), KANKYU_ART.ringY + r * Math.sin(a), rz + RING_TUBE * Math.sin(b)];
  };
  for (let i = 0; i < 20; i++) for (let j = 0; j < 8; j++) m.quad(ringPoint(i, j), ringPoint(i + 1, j), ringPoint(i + 1, j + 1), ringPoint(i, j + 1), flat);
  // 輪を本体へ留める金具
  const v = (x: number, y: number, z: number): P3 => [x, y, z];
  const y0 = KANKYU_ART.ringY - 0.012, y1 = KANKYU_ART.ringY + 0.012, x1 = RING_X - R + 0.004;
  m.quad(v(0, y0, rz - 0.005), v(0, y1, rz - 0.005), v(x1, y1, rz - 0.005), v(x1, y0, rz - 0.005), flat);
  m.quad(v(0, y0, rz + 0.005), v(x1, y0, rz + 0.005), v(x1, y1, rz + 0.005), v(0, y1, rz + 0.005), flat);
  m.quad(v(0, y1, rz - 0.005), v(0, y1, rz + 0.005), v(x1, y1, rz + 0.005), v(x1, y1, rz - 0.005), flat);
  m.quad(v(0, y0, rz + 0.005), v(0, y0, rz - 0.005), v(x1, y0, rz - 0.005), v(x1, y0, rz + 0.005), flat);
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.ring_bow.001';
  group.add(m.build('ring_bow_body', art));
  return { group, art, triangles: m.triangles };
}

/**
 * 矢 1 本ぶんの面を足す。原点は矢の中央、+Y が矢じり。長さ 0.8m。
 * fromY より下（羽根の側）だけを作ることもできる（矢筒から出ている部分）。
 */
function addArrow(m: ArtMesh, fromY = 1): void {
  const R = 0.0045;
  if (fromY >= 0.4) {
    // 矢じり（鉄の平たい葉の形）と、その下の口金
    const tip: P3 = [0, 0.4, 0], T = 0.0015;
    for (const s of [-1, 1]) {
      m.tri(tip, [s * T, 0.3565, -0.0153], [s * T, 0.3565, 0.0153]);
      m.quad([s * T, 0.3565, -0.0153], [s * T, 0.3347, -0.0075], [s * T, 0.3347, 0.0075], [s * T, 0.3565, 0.0153]);
    }
    m.lathe([[-0.386, R, 0.006], [0.3347, R, 0.006]], 8);
  } else {
    m.lathe([[-0.386, R, 0.006], [fromY, R, 0.006]], 8);
  }
  m.lathe([[-0.4, 0.004, 0.005], [-0.386, R, 0.006]], 8); // 矢はず
  // 羽根 3 枚。図の右半分の羽根を、120 度ずつ回して 3 枚に使う
  const outline: [number, number][] = [[-0.27, 0.005], [-0.3, 0.02], [-0.35, 0.0274], [-0.378, 0.022]];
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + Math.PI / 2;
    const at = (y: number, r: number): [P3, UV] => [[r * Math.cos(a), y, r * Math.sin(a)], m.planar([0, y, r])];
    for (let i = 0; i < outline.length - 1; i++) {
      const [p0, u0] = at(outline[i]![0], 0.004), [p1, u1] = at(outline[i]![0], outline[i]![1]);
      const [p2, u2] = at(outline[i + 1]![0], outline[i + 1]![1]), [p3, u3] = at(outline[i + 1]![0], 0.004);
      m.quad(p0, p1, p2, p3, [u0, u1, u2, u3]);
    }
  }
}

export function buildArrow(): WeaponModel {
  const m = new ArtMesh(WEAPON_SHEETS.kankyuArrow);
  addArrow(m);
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.ring_bow.001.arrow';
  group.add(m.build('ring_bow_arrow', art));
  return { group, art, triangles: m.triangles };
}

/** 矢筒。原点は筒の中央、+Y が口。高さ 0.61m、太さ 約 12cm。矢 6 本の羽根の側が口から出ている。 */
export function buildQuiver(): WeaponModel {
  const body = new ArtMesh(WEAPON_SHEETS.kankyuQuiver);
  body.lathe([[-0.303, 0.052, 0.052], [-0.299, 0.056, 0.056], [-0.2646, 0.0565, 0.0565], [-0.0218, 0.06, 0.06], [0.2833, 0.0645, 0.0645], [0.3032, 0.0655, 0.0655]], 16);
  // 腰へ付けるための革の輪（図の右側）
  body.box(-0.012, 0.012, 0.075, 0.18, 0.058, 0.098);
  // 矢 6 本: 筒の中に輪に並べ、少しずつ外へ傾ける
  const arrows = new ArtMesh(WEAPON_SHEETS.kankyuArrow);
  for (let k = 0; k < 6; k++) {
    const a = (2 * Math.PI * k) / 6 + 0.3, lean = 0.06, turn = k * 1.1;
    arrows.transform = (p) => {
      // 矢を上下逆さ（羽根が上）にして、矢筒の口の高さへ持ち上げ、自分の軸で回し、外へ少し傾ける
      const x0 = p[0] * Math.cos(turn) - p[2] * Math.sin(turn), z0 = p[0] * Math.sin(turn) + p[2] * Math.cos(turn);
      const h = -p[1] + 0.075; // 矢はず（-0.4）が 0.475 の高さに来る
      const out = 0.03 + (h - 0.1) * lean;
      return [x0 + out * Math.cos(a), h, z0 + out * Math.sin(a)];
    };
    addArrow(arrows, -0.05);
  }
  arrows.transform = null;
  const art: ArtStatus[] = [];
  const group = new Group();
  group.name = 'model.weapon.ring_bow.001.quiver';
  group.add(body.build('ring_bow_quiver', art), arrows.build('ring_bow_quiver_arrows', art));
  return { group, art, triangles: body.triangles + arrows.triangles };
}
