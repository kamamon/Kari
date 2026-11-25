// 拠点「灯継ぎの里」の見た目。施設の位置と当たりは public/data/hub.json と maps/hub_village.json が正本で、ここは描くだけ。
// 建物は、箱・屋根・板の簡単な立体に、正面と右側面の図（依頼 8 の D、art-source/env/bld_*_v1.png）を貼ったもの（v0.13.0）。
// 図の中の場所は px（1536 × 1024、左上が原点）で書く。立体の大きさは、依頼書の m の値（図の比率は、ほぼ合わせてあるが、製図ではない）。
import {
  BufferGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry,
} from 'three';
import type { FacilityDef, HubDef, MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
import { buildAreaGroup, mergeStatic } from './arena';
import { ENV_TILES, boxUv, cutoutMaterial, tileMaterial } from './envArt';

const M = {
  woodDark: new MeshLambertMaterial({ color: 0x4f3a28, flatShading: true }),
  lamp: new MeshBasicMaterial({ color: 0xffd98a }),
  ring: new MeshBasicMaterial({ color: 0xd9b46a, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
};

const TEX_W = 1536, TEX_H = 1024;
/** 建物の絵の明るさ（光の式で暗くなるぶんを持ち上げる） */
const BUILDING_GAIN = 1.3;
/** 図の中の四角 [x0, y0, x1, y1]（px。左上と右下） */
type Rect = readonly [number, number, number, number];
type P3 = readonly [number, number, number];
type Px = readonly [number, number];

/** 絵を貼った面を集めて、1 つのメッシュにする係。建物の正面は +z、右は +x。 */
class Kit {
  private pos: number[] = [];
  private uv: number[] = [];

  /** 三角形。3D の 3 点と、それぞれの図の中の場所（px）。外から見て左回り。 */
  tri(a: P3, b: P3, c: P3, ua: Px, ub: Px, uc: Px): void {
    this.pos.push(...a, ...b, ...c);
    for (const [x, y] of [ua, ub, uc]) this.uv.push(x / TEX_W, 1 - y / TEX_H);
  }

  /** 四角。a = 左下、b = 右下、c = 右上、d = 左上（見る側から）。flip で、図の左右を裏返して貼る。 */
  quad(a: P3, b: P3, c: P3, d: P3, r: Rect, flip = false): void {
    const [x0, y0, x1, y1] = flip ? [r[2], r[1], r[0], r[3]] : r;
    this.tri(a, b, c, [x0, y1], [x1, y1], [x1, y0]);
    this.tri(a, c, d, [x0, y1], [x1, y0], [x0, y0]);
  }

  /** まっすぐ立った壁。p0 は見る側から左の端（x, z）、p1 は右の端。 */
  wall(p0: Px, p1: Px, y0: number, y1: number, r: Rect, flip = false): void {
    this.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], r, flip);
  }

  /** 箱（x0..x1, y0..y1, z0..z1）。面ごとに貼る場所を渡す: f = 前（+z）、b = 後、r = 右（+x）、l = 左、t = 上。渡さない面は作らない。 */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, faces: { f?: Rect; b?: Rect; r?: Rect; l?: Rect; t?: Rect }): void {
    if (faces.f) this.wall([x0, z1], [x1, z1], y0, y1, faces.f);
    if (faces.b) this.wall([x1, z0], [x0, z0], y0, y1, faces.b);
    if (faces.r) this.wall([x1, z1], [x1, z0], y0, y1, faces.r);
    if (faces.l) this.wall([x0, z0], [x0, z1], y0, y1, faces.l);
    if (faces.t) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], faces.t);
  }

  geometry(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals();
    return geo;
  }
}

/** 工房: 石積みの小屋（幅 6.2 × 奥行 4.6 × 棟 4.5m）。切妻の屋根、右の奥に煙突（5.4m）。 */
function workshop(): BufferGeometry {
  const k = new Kit();
  const hw = 3.1, zf = 1.7, zb = -2.9, zc = -0.6, wallH = 2.9, ridge = 4.5, ov = 0.2;
  const drop = ((ridge - wallH) / (zf - zc)) * ov;
  // 正面（入口・槌の看板・炉と金床は、図に描かれたものを、そのまま壁に貼る）
  k.wall([-hw, zf], [hw, zf], 0, wallH, [106, 545, 748, 862]);
  // 屋根（前と後。後ろも、同じ屋根の図）
  const roof: Rect = [85, 368, 770, 545];
  k.quad([-hw - ov, wallH - drop, zf + ov], [hw + ov, wallH - drop, zf + ov], [hw + ov, ridge, zc], [-hw - ov, ridge, zc], roof);
  k.quad([hw + ov, wallH - drop, zb - ov], [-hw - ov, wallH - drop, zb - ov], [-hw - ov, ridge, zc], [hw + ov, ridge, zc], roof);
  // 横の壁と妻。右側面の図の、炉が描かれていない右半分（中央〜奥の柱）を、中央で折り返して使う
  const side: Rect = [1160, 545, 1396, 862];
  for (const sx of [1, -1]) {
    const x = hw * sx;
    // 見る側から左が、右の面では前（+z）、左の面では奥
    const zl = sx > 0 ? zf : zb, zr = sx > 0 ? zb : zf;
    k.wall([x, zl], [x, zc], 0, wallH, side, true);
    k.wall([x, zc], [x, zr], 0, wallH, side);
    k.tri([x, wallH, zl], [x, wallH, zc], [x, ridge, zc], [1396, 545], [1160, 545], [1160, 372]);
    k.tri([x, wallH, zc], [x, wallH, zr], [x, ridge, zc], [1160, 545], [1396, 545], [1160, 372]);
  }
  // 後ろの壁: 同じ石積み（横の壁の半分を、左右に 1 回ずつ）
  const back: Rect = [1160, 545, 1395, 862];
  k.wall([hw, zb], [0, zb], 0, wallH, back, true);
  k.wall([0, zb], [-hw, zb], 0, wallH, back);
  // 煙突（右の奥。屋根から上を、側面の図から）
  const ch: Rect = [1325, 280, 1408, 540];
  k.box(2.14, 3.02, 2.8, 5.37, -2.99, -2.11, { f: ch, b: ch, r: ch, l: ch });
  return k.geometry();
}

/** 商店: 木の屋台（幅 5.6 × 奥行 3.4m）。前に、縞の日よけが 2.5m 張り出す。台と木箱は、図から前へ押し出した箱。 */
function shop(): BufferGeometry {
  const k = new Kit();
  // 図は、幅 5.6m = 695px（1m = 124px）。高さも、同じ比で取る（台の高さが 1m になる）
  const S = 124, cx = 392.5, ground = 798;
  const X = (px: number): number => (px - cx) / S;
  const Y = (py: number): number => (ground - py) / S;
  const hw = 2.8, zf = 1.1, zb = -2.3, zc = -0.6, ov = 0.22;
  const wallH = Y(398), ridge = Y(283);
  const drop = ((ridge - wallH) / (zf - zc)) * ov;
  // 正面（棚・品物・樽は、図のまま 1 枚）
  k.wall([-hw, zf], [hw, zf], 0, wallH, [51, 398, 737, 798]);
  const roof: Rect = [40, 288, 750, 398];
  k.quad([-hw - ov, wallH - drop, zf + ov], [hw + ov, wallH - drop, zf + ov], [hw + ov, ridge, zc], [-hw - ov, ridge, zc], roof);
  k.quad([hw + ov, wallH - drop, zb - ov], [-hw - ov, wallH - drop, zb - ov], [-hw - ov, ridge, zc], [hw + ov, ridge, zc], roof);
  // 日よけ（前へ下がる 1 枚の布）と、前の柱
  const az = zf + 2.5;
  k.quad([X(55), Y(525), az], [X(730), Y(525), az], [X(730), Y(412), zf + 0.05], [X(55), Y(412), zf + 0.05], [55, 412, 730, 525]);
  const post: Rect = [49, 540, 74, 798];
  for (const x of [X(60), X(722)]) k.box(x - 0.12, x + 0.12, 0, Y(522), az - 0.3, az - 0.06, { f: post, b: post, r: post, l: post });
  // 台: 図の台を、そのまま前へ 0.9m 押し出す（上の面は、台の板）
  const plank: Rect = [300, 692, 410, 796];
  k.box(X(180), X(620), 0, Y(668), zf, zf + 0.9, { f: [180, 668, 620, 798], r: plank, l: plank, t: [186, 669, 614, 684] });
  // 木箱（右に 2 段、左に 1 つ）
  const crateR: Rect = [625, 655, 700, 798], crateL: Rect = [120, 720, 190, 798];
  k.box(X(625), X(700), 0, Y(655), zf, zf + 0.6, { f: crateR, r: crateR, l: crateR, t: [628, 660, 698, 722] });
  k.box(X(120), X(190), 0, Y(720), zf, zf + 0.56, { f: crateL, r: crateL, l: crateL, t: crateL });
  // 横の壁と妻（右側面の図の、小屋の部分。左は裏返し）
  const side: Rect = [1118, 400, 1487, 798];
  for (const sx of [1, -1]) {
    const x = hw * sx;
    const zl = sx > 0 ? zf : zb, zr = sx > 0 ? zb : zf;
    k.wall([x, zl], [x, zr], 0, wallH, side, sx < 0);
    const [ul, ur] = sx > 0 ? [1118, 1487] : [1487, 1118];
    k.tri([x, wallH, zl], [x, wallH, zr], [x, ridge, zc], [ul, 400], [ur, 400], [1297, 283]);
  }
  // 後ろの壁: 横の板壁を、幅に合わせて
  k.wall([hw, zb], [-hw, zb], 0, wallH, side);
  return k.geometry();
}

/** 依頼板: 2 本の柱に板、小さな屋根（高さ 3.4m）。紙は、表と裏の両方に貼ってある。 */
function board(): BufferGeometry {
  const k = new Kit();
  // 図の比率のまま、高さ 3.4m に合わせる（1m = 207px）。依頼書の 2.9 × 3.2m より、少し細長い
  const S = 207, cx = 369, ground = 908;
  const X = (px: number): number => (px - cx) / S;
  const Y = (py: number): number => (ground - py) / S;
  const sidePost: Rect = [1213, 275, 1268, 908];
  for (const r of [[116, 275, 172, 908], [565, 275, 622, 908]] as Rect[]) k.box(X(r[0]), X(r[2]), 0, Y(275), -0.135, 0.135, { f: r, b: r, r: sidePost, l: sidePost });
  const panel: Rect = [160, 335, 578, 720];
  k.box(X(160), X(578), Y(720), Y(335), -0.05, 0.05, { f: panel, b: panel });
  // 屋根（前と後）と、両端の妻
  // 屋根の図は、両端が斜めに切れている（透明）。そのまま貼るので、屋根の端も斜めに見える。棟の線は y = 213
  const roof: Rect = [78, 213, 660, 285];
  const rx = X(660), ye = Y(285), yr = Y(213), rz = 0.36;
  k.quad([-rx, ye, rz], [rx, ye, rz], [rx, yr, 0], [-rx, yr, 0], roof);
  k.quad([rx, ye, -rz], [-rx, ye, -rz], [-rx, yr, 0], [rx, yr, 0], roof);
  k.tri([rx, ye, rz], [rx, ye, -rz], [rx, yr, 0], [1170, 258], [1312, 258], [1241, 209]);
  k.tri([-rx, ye, -rz], [-rx, ye, rz], [-rx, yr, 0], [1170, 258], [1312, 258], [1241, 209]);
  return k.geometry();
}

/** 装備箱: 4 本の柱で支えた天幕（3.6m 四方 × 高さ 4m）の下に、大きな木の箱と、武器立て。 */
function chest(): BufferGeometry {
  const k = new Kit();
  // 天幕の幅 3.6m = 653px（1m = 181px）
  const S = 181, cx = 388.5, ground = 878;
  const X = (px: number): number => (px - cx) / S;
  const Y = (py: number): number => (ground - py) / S;
  const he = 1.8, yE = Y(375), yA = Y(158), yV = Y(440);
  const corners: Px[] = [[-he, he], [he, he], [he, -he], [-he, -he]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!, b = corners[(i + 1) % 4]!;
    // 前と後は正面の図、右と左は側面の図
    const sideView = i % 2 === 1;
    // 布のふちは内へたるんでいるので、三角の中だけを貼る（外の透明な所を踏まないよう、少し内側を取る）
    const [u0, u1, ua] = sideView ? [850, 1451, 1150] : [89, 688, 390];
    k.tri([a[0], yE, a[1]], [b[0], yE, b[1]], [0, yA, 0], [u0, 372], [u1, 372], [ua, 202]);
    k.wall(a, b, yV, yE, sideView ? [832, 375, 1468, 439] : [70, 375, 707, 439]);
  }
  const post: Rect = [91, 445, 142, 875];
  for (const [px, pz] of [[-1.5, 1.5], [1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]] as Px[]) k.box(px - 0.145, px + 0.145, 0, yV + 0.25, pz - 0.145, pz + 0.145, { f: post, b: post, r: post, l: post });
  // 箱（前寄り）。上の面は、側面の板の所
  const front: Rect = [225, 710, 545, 872], side: Rect = [980, 710, 1149, 875];
  k.box(X(225), X(545), 0, Y(705), 0, 0.97, { f: front, b: front, r: side, l: side, t: [1010, 750, 1115, 840] });
  // 武器立て（箱の後ろ）: 正面の図の、箱より上の部分の板と、側面の図の板を、十字に組む
  const zR = -0.55;
  k.wall([X(215), zR], [X(565), zR], Y(705), Y(478), [215, 478, 565, 705]);
  k.wall([0.02, zR + 0.55], [0.02, zR - 0.55], 0, Y(495), [1125, 495, 1325, 875]);
  return k.geometry();
}

/** 施設の種類ごとの、建物の形（絵を貼る面の集まり）と、貼る絵。形は、正面が +z、足元が y = 0。 */
export const BUILDINGS: Record<FacilityDef['kind'], { file: string; shape: () => BufferGeometry }> = {
  workshop: { file: 'bld_workshop_v1', shape: workshop },
  shop: { file: 'bld_shop_v1', shape: shop },
  quest: { file: 'bld_board_v1', shape: board },
  chest: { file: 'bld_chest_v1', shape: chest },
};

/** 広場（石畳）の中心と半径。草は生やさない。 */
const PLAZA = { x: 0, z: 1, r: 9.5 };

/**
 * 里の地形と建物。施設の前（立つ場所）には、青銅色の輪を置く。
 * 外周の岩壁・草は、狩場と同じ作り（buildAreaGroup）。地面は踏み固めた土、広場は石畳。
 */
export function buildHubGroup(hub: HubDef, map: MapDef): Group {
  // 建物の当たり（rocks）は、岩としては描かない
  const g = buildAreaGroup({
    bounds: map.bounds, rocks: map.rocks, platforms: map.platforms, drawRocks: false, kind: 'village', seed: 7001, wallHeight: [2.2, 2.2],
    gates: [{ x: 0, z: map.bounds.minZ + 2, marker: true }],
    clear: [{ ...PLAZA, r: PLAZA.r + 0.2 }, ...hub.facilities.map((f) => ({ x: f.x, z: f.z, r: f.r * 0.6 })), ...(hub.npcs ?? []).map((n) => ({ x: n.x, z: n.z, r: 0.7 }))],
  });
  const plaza = new Mesh(new CircleGeometry(PLAZA.r, 36), tileMaterial('paving', 0xffffff, { gain: 1.3 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PLAZA.x, 0.012, PLAZA.z);
  plaza.receiveShadow = true;
  boxUv(plaza, ENV_TILES.paving.tile);
  g.add(plaza);
  for (const f of hub.facilities) {
    const def = BUILDINGS[f.kind];
    const b = new Mesh(def.shape(), cutoutMaterial(def.file, BUILDING_GAIN));
    b.castShadow = true;
    b.receiveShadow = true;
    // 建物と立つ輪は、その場所の床の高さ（v0.31.0。工房は下の段）
    b.position.set(f.building.x, groundAt(map.platforms, f.building.x, f.building.z), f.building.z);
    b.rotation.y = f.building.yaw;
    g.add(b);
    const ring = new Mesh(new RingGeometry(f.r * 0.5 - 0.09, f.r * 0.5, 28), M.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(f.x, groundAt(map.platforms, f.x, f.z) + 0.03, f.z);
    ring.renderOrder = 1;
    g.add(ring);
  }
  // 広場の灯（当たりは、施設の建物の次の rocks）
  const lampAt = map.rocks[hub.facilities.length];
  if (lampAt) {
    const post = new Mesh(new CylinderGeometry(0.13, 0.15, 3.0, 6), M.woodDark);
    post.position.set(lampAt.x, 1.5, lampAt.z);
    post.castShadow = true;
    const lamp = new Mesh(new IcosahedronGeometry(0.3, 0), M.lamp);
    lamp.position.set(lampAt.x, 3.2, lampAt.z);
    g.add(post, lamp);
  }
  // 同じ素材の部品を 1 つにまとめる（描画回数を減らす）
  mergeStatic(g);
  return g;
}
