// 大槌・双剣・太刀（里鍛ち）の仮モデル（2 代目）。依頼 6 の設定図（art-source/weapon/weapon_{otsuchi,soken,tachi}_*）から作る。
// 形は依頼書の寸法（全長・頭・刃の幅と厚み・握りの位置・反り）で組み、図は部品ごとに「図の同じ所」を当てて貼る
// （図の割合は依頼書と少し違う。頭の幅・峰の厚み・反りなど。D-095）。図の部品の行と刃の輪郭は weaponSheets.ts（生成物）。
// どれも原点は握り、+Y が武器の先、-Z が刃（大槌は叩く面の片方）の向く方。単位 m。当たり判定（技データ）は変えていない。
import { Group } from 'three';
import { ArtMesh, type ArtStatus, type P3, type UV } from './artMesh';
import type { WeaponModel } from './heavyBlade';
import { OTSUCHI_ART, SOKEN_ART, TACHI_ART, WEAPON_SHEETS } from './weaponSheets';

/** 形の高さ（m）→ 図の行（px）。[高さ, 行] を高さの順に並べて、間は直線でつなぐ（外は端の 2 点の延長）。 */
export function rowMap(points: readonly (readonly [number, number])[]): (y: number) => number {
  return (y) => {
    let i = 0;
    while (i < points.length - 2 && y > points[i + 1]![0]) i++;
    const [y0, r0] = points[i]!, [y1, r1] = points[i + 1]!;
    return r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  };
}

/** 回した形（握り・柄・金具）。profile は [高さ, 半径（m）, 図での半幅（px）]。図は、柄の中心 cx から左右へ写す。 */
function lathe(m: ArtMesh, cx: number, row: (y: number) => number, profile: readonly (readonly [number, number, number])[], seg = 12): void {
  m.artPx = (p) => [cx + p[2], row(p[1])];
  m.lathe(profile, seg);
  m.artPx = null;
}

/** 箱。図の横は、形の z（または x）を、図の [左端, 右端] へ当てる。 */
function mappedBox(m: ArtMesh, b: { x: [number, number]; y: [number, number]; z: [number, number] }, across: 'z' | 'x', px: [number, number], row: (y: number) => number): void {
  const [a0, a1] = across === 'z' ? b.z : b.x;
  m.artPx = (p) => [px[0] + (((across === 'z' ? p[2] : p[0]) - a0) / (a1 - a0)) * (px[1] - px[0]), row(p[1])];
  m.box(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0], b.z[1]);
  m.artPx = null;
}

/** 片刃の刃（まっすぐ、または峰の側へ反る）。刃は -Z、峰は +Z。切っ先は、峰の側を斜めに落とす。 */
export interface BladeSpec {
  /** 刃の根元（鍔の上面）の高さと、刃の長さ */
  y0: number;
  len: number;
  /** 刃の中心の線が、先で峰の側（+Z）へずれる量（根元からの 2 乗で曲げる。0 = まっすぐ） */
  bend: number;
  /** 幅（根元・先） */
  width: readonly [number, number];
  /** 切っ先の斜めの線の長さ（刃の長さの向き） */
  tipCut: number;
  /** 厚みの半分（平らな面 / 峰の端）と、面取りの幅（研いだ刃 / 峰） */
  T: number;
  TS: number;
  bevelEdge: number;
  bevelSpine: number;
  segments: number;
  /** 図: 刃の根元と先の行、刃の表 [行, 刃の側の端, 欠けていない幅]（px） */
  art: { rowRoot: number; rowTip: number; table: readonly (readonly number[])[] };
}

/** 刃の表を行で引く: [刃の側の端, 幅]（px） */
function edgeAt(table: readonly (readonly number[])[], row: number): [number, number] {
  let i = 0;
  while (i < table.length - 2 && row > table[i + 1]![0]!) i++;
  const a = table[i]!, b = table[i + 1]!;
  const t = Math.min(1, Math.max(0, (row - a[0]!) / (b[0]! - a[0]!)));
  return [a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

export function addBlade(m: ArtMesh, b: BladeSpec): void {
  const cut = b.tipCut / b.len;
  const ts: number[] = [];
  for (let i = 0; i <= b.segments; i++) ts.push((i / b.segments) * (1 - cut));
  for (let i = 1; i <= 5; i++) ts.push(1 - cut + (cut * i) / 5);
  type Pt = { p: P3; uv: UV };
  // 断面の点: 0 = 刃、1 = 研いだ刃の面の端、2 = 峰の面取りの端、3 = 峰の端（x の正負で 2 つずつ）
  const sections = ts.map((t) => {
    const w = b.width[0] + (b.width[1] - b.width[0]) * t;
    const sp = Math.min(w / 2, -w / 2 + (w * (1 - t)) / cut); // 峰の側の端（切っ先では刃の側へ寄る）
    const left = sp + w / 2; // 断面に残っている幅
    const k = Math.min(1, left / (0.5 * w));
    const be = Math.min(b.bevelEdge, left * 0.45), bs = Math.min(b.bevelSpine, left * 0.2);
    const y = b.y0 + b.len * t, z = b.bend * t * t;
    const ty = b.len, tz = 2 * b.bend * t, tl = Math.hypot(ty, tz);
    const ny = -tz / tl, nz = ty / tl; // 峰の側を向く
    const row = b.art.rowRoot + t * (b.art.rowTip - b.art.rowRoot);
    const [xe, wf] = edgeAt(b.art.table, row);
    const pt = (off: number, x: number): Pt => ({ p: [x, y + ny * off, z + nz * off], uv: m.uvOfPx(xe + ((off + w / 2) / w) * wf, row) });
    return (s: number): Pt[] => [pt(-w / 2, 0), pt(-w / 2 + be, s * b.T * k), pt(sp - bs, s * b.T * k), pt(sp, s * b.TS * k)];
  });
  const quad = (a: Pt, c: Pt, d: Pt, e: Pt): void => m.quad(a.p, c.p, d.p, e.p, [a.uv, c.uv, d.uv, e.uv]);
  for (let i = 0; i < sections.length - 1; i++) {
    for (const s of [1, -1]) {
      const A = sections[i]!(s), B = sections[i + 1]!(s);
      for (let j = 0; j < 3; j++) {
        if (s > 0) quad(A[j]!, B[j]!, B[j + 1]!, A[j + 1]!);
        else quad(A[j + 1]!, B[j + 1]!, B[j]!, A[j]!);
      }
    }
    const P = sections[i]!(1), N = sections[i]!(-1), P2 = sections[i + 1]!(1), N2 = sections[i + 1]!(-1);
    quad(P[3]!, P2[3]!, N2[3]!, N[3]!); // 峰（切っ先では斜めの面）
  }
}

function finish(name: string, parts: ArtMesh[]): WeaponModel {
  const group = new Group();
  group.name = name;
  const art: ArtStatus[] = [];
  let triangles = 0;
  parts.forEach((m, i) => {
    group.add(m.build(`${name}.part${i}`, art));
    triangles += m.triangles;
  });
  return { group, art, triangles };
}

// ---------------------------------------------------------------- 大槌

/**
 * 大槌。原点は下の握り（右手）の中央。上の握り（左手）は 0.5m 上。全長 1.45m（石突 -0.2m 〜 頭の上の冠 1.25m）。
 * 頭は高さ 0.995〜1.235m（24cm）、叩く面から反対の面まで 0.38m（±Z）、厚み 0.20m（±X）。角を落とした鉄の塊を、青銅の帯金と鋲で留める。
 */
export function buildWarMaul(): WeaponModel {
  const A = OTSUCHI_ART;
  const front = new ArtMesh(WEAPON_SHEETS.otsuchiFront);
  const side = new ArtMesh(WEAPON_SHEETS.otsuchiSide, 'xy');
  const H0 = 0.995, H1 = 1.235, HX = 0.1, HZ = 0.19, C = 0.022;
  const row = rowMap([
    [-0.2, A.bottom + 0.5], [-0.148, A.buttTop - 0.5], [-0.068, A.lowerGrip[1] + 0.5], [0.068, A.lowerGrip[0] - 0.5],
    [0.432, A.upperGrip[1] + 0.5], [0.568, A.upperGrip[0] - 0.5], [0.95, A.collarBottom + 0.5], [H0, A.headBottom + 0.5], [H1, A.headTop - 0.5], [1.25, A.capTop - 0.5],
  ]);
  const sideRow = rowMap([[H0, A.side.headBottom + 0.5], [H1, A.side.headTop - 0.5]]);
  const cx = (A.headX[0] + A.headX[1] + 1) / 2;
  const half = (A.headX[1] + 1 - A.headX[0]) / 2;
  const scx = (A.side.headX[0] + A.side.headX[1] + 1) / 2;
  const shalf = (A.side.headX[1] + 1 - A.side.headX[0]) / 2;
  const fpx = (p: P3): readonly [number, number] => [cx + (p[2] / HZ) * half, row(p[1])];
  const spx = (p: P3): readonly [number, number] => [scx + (p[0] / HX) * shalf, sideRow(p[1])];

  // 柄・握り・石突・口金・頭の上の冠（回した形）。半径は依頼書の柄 4.5cm に合わせ、図の幅の比で太らせる
  const r = (px: number): number => 0.0225 * (px / A.shaftW);
  const sh = A.shaftW / 2, gr = A.gripW / 2;
  lathe(front, cx, row, [
    [-0.2, r(30), 15], [-0.196, r(44), 22], [-0.19, r(A.buttW), A.buttW / 2], [-0.161, r(A.buttW), A.buttW / 2], [-0.158, r(42), 21], [-0.148, r(42), 21], [-0.148, r(A.shaftW), sh],
    [-0.068, r(A.shaftW), sh], [-0.068, r(A.gripW), gr], [0.068, r(A.gripW), gr], [0.068, r(A.shaftW), sh],
    [0.432, r(A.shaftW), sh], [0.432, r(A.gripW), gr], [0.568, r(A.gripW), gr], [0.568, r(A.shaftW), sh],
    [0.95, r(A.shaftW), sh], [0.953, r(A.collarW[1]), A.collarW[1] / 2], [0.984, r(A.collarW[1]), A.collarW[1] / 2], [0.986, r(A.collarW[0]), A.collarW[0] / 2], [H0 + 0.002, r(A.collarW[0]), A.collarW[0] / 2],
  ], 14);
  lathe(front, cx, row, [[H1 - 0.002, r(A.capW), A.capW / 2], [1.246, r(A.capW), A.capW / 2], [1.25, r(A.capW - 10), A.capW / 2 - 5], [1.2505, 0.001, 1]], 14);

  // 頭: 12 の角を落とした箱。正面の図（±X の面と、その縁）と、真横の図（叩く面 ±Z と、その上下の縁）
  const v = (x: number, y: number, z: number): P3 => [x, y, z];
  front.artPx = fpx;
  side.artPx = spx;
  for (const s of [1, -1]) {
    const X = s * HX, Xi = s * (HX - C);
    const flip = (a: P3, b: P3, c: P3, d: P3, mesh: ArtMesh): void => (s > 0 ? mesh.quad(a, b, c, d) : mesh.quad(d, c, b, a));
    flip(v(X, H0 + C, -HZ + C), v(X, H0 + C, HZ - C), v(X, H1 - C, HZ - C), v(X, H1 - C, -HZ + C), front); // 正面
    flip(v(X, H1 - C, -HZ + C), v(X, H1 - C, HZ - C), v(Xi, H1, HZ - C), v(Xi, H1, -HZ + C), front); // 正面の上の縁
    flip(v(Xi, H0, -HZ + C), v(Xi, H0, HZ - C), v(X, H0 + C, HZ - C), v(X, H0 + C, -HZ + C), front); // 正面の下の縁
    for (const t of [1, -1]) {
      const Z = t * HZ, Zi = t * (HZ - C);
      // 縦の縁（正面と叩く面の間）と、角の三角
      const q = (a: P3, b: P3, c: P3, d: P3): void => (s * t > 0 ? front.quad(a, b, c, d) : front.quad(d, c, b, a));
      q(v(X, H0 + C, Zi), v(Xi, H0 + C, Z), v(Xi, H1 - C, Z), v(X, H1 - C, Zi));
      const tri = (a: P3, b: P3, c: P3): void => (s * t > 0 ? front.tri(a, b, c) : front.tri(c, b, a));
      tri(v(X, H1 - C, Zi), v(Xi, H1 - C, Z), v(Xi, H1, Zi));
      tri(v(Xi, H0, Zi), v(Xi, H0 + C, Z), v(X, H0 + C, Zi));
    }
  }
  for (const t of [1, -1]) {
    const Z = t * HZ, Zi = t * (HZ - C);
    const q = (a: P3, b: P3, c: P3, d: P3): void => (t > 0 ? side.quad(a, b, c, d) : side.quad(d, c, b, a));
    q(v(HX - C, H0 + C, Z), v(-HX + C, H0 + C, Z), v(-HX + C, H1 - C, Z), v(HX - C, H1 - C, Z)); // 叩く面
    q(v(HX - C, H1 - C, Z), v(-HX + C, H1 - C, Z), v(-HX + C, H1, Zi), v(HX - C, H1, Zi)); // 叩く面の上の縁
    q(v(HX - C, H0, Zi), v(-HX + C, H0, Zi), v(-HX + C, H0 + C, Z), v(HX - C, H0 + C, Z)); // 下の縁
  }
  // 上と下の面: 正面の図の、頭の上の端の少し内側の行（鉄の地）を、厚みの向きへ少しずつずらして貼る
  front.artPx = (p) => [cx + (p[2] / HZ) * half, (p[1] > 1 ? A.headTop + 10 : A.headBottom - 10) + (p[0] / HX) * 6];
  front.quad(v(-HX + C, H1, -HZ + C), v(-HX + C, H1, HZ - C), v(HX - C, H1, HZ - C), v(HX - C, H1, -HZ + C));
  front.quad(v(HX - C, H0, -HZ + C), v(HX - C, H0, HZ - C), v(-HX + C, H0, HZ - C), v(-HX + C, H0, -HZ + C));
  front.artPx = null;
  side.artPx = null;

  // 帯金（頭を縦に巻く。厚み 4mm）と、鋲（正面と背面に 4 つずつ）
  const B = A.band;
  const bz0 = ((B.x0 - cx) / half) * HZ, bz1 = ((B.x1 + 1 - cx) / half) * HZ;
  mappedBox(front, { x: [-HX - 0.004, HX + 0.004], y: [H0 - 0.004, H1 + 0.004], z: [bz0, bz1] }, 'z', [B.x0, B.x1 + 1], row);
  const yOfRow = (rw: number): number => H1 - ((rw - A.headTop) / (A.headBottom - A.headTop)) * (H1 - H0);
  const bcx = (B.x0 + B.x1 + 1) / 2, bzc = (bz0 + bz1) / 2;
  for (const s of [1, -1]) {
    for (const rw of B.rivets) {
      const yc = yOfRow(rw);
      front.transform = (p) => [s * (HX + 0.004 + p[1]), yc + p[0], bzc + p[2]];
      front.artPx = (p) => [bcx + (p[2] / HZ) * half, rw - (p[0] / (H1 - H0)) * (A.headBottom - A.headTop)];
      front.lathe([[0, 0.0075, 0], [0.0035, 0.0058, 0], [0.006, 0.0005, 0]], 6);
    }
  }
  front.transform = null;
  front.artPx = null;
  return finish('model.weapon.war_maul.001', [front, side]);
}

// ---------------------------------------------------------------- 双剣

/**
 * 双剣の 1 本。左右で同じ形。原点は握りの中央。全長 0.7m: 柄頭 -0.08m、握り -0.054〜0.047m、口金、鍔 0.06〜0.08m（幅 8cm）、
 * 刃 0.08〜0.62m（幅 4.5cm、峰の厚み 0.8cm。切っ先は峰の側を斜めに落とす）。鍔から刃へ、鋲 2 つの留め金。
 */
export function buildTwinBlade(): WeaponModel {
  const A = SOKEN_ART;
  const m = new ArtMesh(WEAPON_SHEETS.sokenFront);
  const Y0 = 0.08, L = 0.54, W = 0.045;
  const row = rowMap([[-0.08, A.bottom + 0.5], [-0.054, A.pommelTop - 0.5], [0.047, A.ferruleBottom + 0.5], [0.06, A.guardBottom + 0.5], [Y0, A.guardTop - 0.5], [Y0 + L, A.tip - 0.5]]);
  addBlade(m, {
    y0: Y0, len: L, bend: 0, width: [W, W], tipCut: (L * (A.corner - A.tip)) / (A.guardTop - A.tip),
    T: 0.004, TS: 0.0036, bevelEdge: 0.0085, bevelSpine: 0.0015, segments: 6, art: { rowRoot: A.guardTop - 0.5, rowTip: A.tip - 0.5, table: A.edge },
  });
  // 鍔から刃へ伸びる留め金（両面。刃より 1.5mm 厚い）
  const e0 = edgeAt(A.edge, A.guardTop - 4);
  const zOf = (px: number): number => -W / 2 + ((px - e0[0]) / e0[1]) * W;
  const lg = A.langet;
  const ly1 = Y0 + ((A.guardTop - lg.top) / (A.guardTop - A.tip)) * L;
  mappedBox(m, { x: [-0.0055, 0.0055], y: [Y0 - 0.002, ly1], z: [zOf(lg.x0), zOf(lg.x1 + 1)] }, 'z', [lg.x0, lg.x1 + 1], rowMap([[Y0, A.guardTop - 0.5], [ly1, lg.top - 0.5]]));
  // 鍔（幅 8cm。厚み 2.4cm の青銅の板）
  mappedBox(m, { x: [-0.012, 0.012], y: [0.06, Y0], z: [-0.04, 0.04] }, 'z', [A.guardX[0], A.guardX[1] + 1], row);
  // 口金・握り・柄頭
  const cx = A.cx, r = (px: number): number => 0.0135 * (px / A.gripW);
  lathe(m, cx, row, [
    [-0.08, r(24), 12], [-0.078, r(46), 23], [-0.074, r(A.pommelW), A.pommelW / 2], [-0.062, r(A.pommelW), A.pommelW / 2], [-0.059, r(A.pommelW - 6), A.pommelW / 2 - 3], [-0.054, r(A.pommelW - 8), A.pommelW / 2 - 4],
    [-0.054, r(A.gripW), A.gripW / 2], [0.047, r(A.gripW), A.gripW / 2], [0.047, r(A.ferruleW - 6), A.ferruleW / 2 - 3], [0.055, r(A.ferruleW), A.ferruleW / 2], [0.0605, r(A.ferruleW), A.ferruleW / 2],
  ], 12);
  return finish('model.weapon.twin_blades.001', [m]);
}

// ---------------------------------------------------------------- 太刀

/**
 * 太刀。原点は上の手（右手。鍔のすぐ下）の握りの中央。下の手（左手）は 0.2m 下。全長 1.47m: 柄頭 -0.27m、握り -0.24〜0.042m、
 * 口金、鍔 0.06〜0.08m（幅 8cm）、刃 0.08〜1.2m（幅 3.2cm → 先 2.6cm、峰の厚み 0.7cm）。刃は峰の側（+Z）へ反り、切っ先は 4cm ずれる。
 */
export function buildLongBlade(): WeaponModel {
  const A = TACHI_ART;
  const m = new ArtMesh(WEAPON_SHEETS.tachiFront);
  const Y0 = 0.08, L = 1.12, W0 = 0.032, W1 = 0.026;
  const row = rowMap([[-0.27, A.bottom + 0.5], [-0.24, A.pommelTop - 0.5], [0.042, A.ferruleBottom + 0.5], [0.06, A.guardBottom + 0.5], [Y0, A.guardTop - 0.5], [Y0 + L, A.tip - 0.5]]);
  addBlade(m, {
    y0: Y0, len: L, bend: 0.04 + W1 / 2, width: [W0, W1], tipCut: (L * (A.corner - A.tip)) / (A.guardTop - A.tip),
    T: 0.0035, TS: 0.003, bevelEdge: 0.0065, bevelSpine: 0.0012, segments: 14, art: { rowRoot: A.guardTop - 0.5, rowTip: A.tip - 0.5, table: A.edge },
  });
  // 鍔（幅 8cm。鋲 2 つの青銅の板）
  mappedBox(m, { x: [-0.015, 0.015], y: [0.06, Y0], z: [-0.04, 0.04] }, 'z', [A.guardX[0], A.guardX[1] + 1], row);
  // 口金・握り・柄頭
  const cx = A.cx, r = (px: number): number => 0.018 * (px / A.gripW);
  lathe(m, cx, row, [
    [-0.27, r(20), 10], [-0.268, r(36), 18], [-0.264, r(A.pommelW), A.pommelW / 2], [-0.245, r(A.pommelW), A.pommelW / 2], [-0.242, r(A.gripW + 2), A.gripW / 2 + 1], [-0.24, r(A.gripW + 2), A.gripW / 2 + 1],
    [-0.24, r(A.gripW), A.gripW / 2], [0.042, r(A.gripW), A.gripW / 2], [0.042, r(A.ferruleW), A.ferruleW / 2], [0.0605, r(A.ferruleW), A.ferruleW / 2],
  ], 12);
  return finish('model.weapon.long_blade.001', [m]);
}
