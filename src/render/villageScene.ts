// 里の 5 つの段の建物と暮らし（v0.35.0。ChatGPT の里の設計 #11 の P1。docs/spec.md の 19.2）。
// 位置と当たりは public/data/hub.json（scenery・props・gates）と maps/hub_village.json（tools/gen-hub.py）が正本で、ここは描くだけ。
// 建物は、箱・切妻の屋根・円柱の簡単な立体（石は岩肌の絵、屋根は瓦の絵、ほかは頂点の色で塗る。仮の形）。
// 施設 4 つ（工房・商店・依頼板・装備箱）は hubScene.ts の、図を貼った建物。
// 動くもの: 沢の水面と小滝（terraces.ts）、水車、荷揚げの昇降台、物干しの布、煙突の煙、小滝のしぶき、鍛冶の火花（view が出す）。
// 音: 沢・炉・風の大きさ（狩人の位置からの距離と高さ）と、鍛冶の槌・水車のきしみ・遠い鐘（合成の仮の音。src/core/audio.ts）。
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DataTexture, DoubleSide, DynamicDrawUsage,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, NormalBlending, Points, Quaternion, RepeatWrapping, SRGBColorSpace, ShaderMaterial,
  UniformsLib, UniformsUtils, Vector3, type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRng } from '../core/seededRng';
import type { HubDef, HubSceneryDef, MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
import { WIND, loadEnvTexture, tileMaterial } from './envArt';
import { PROP_ART, PROP_ATLAS } from './propArt';
import { mergeRocks, placeBigRock, rockArtMaterial } from './rockArt';
import { animateTerraces, type WallSegment } from './terraces';
import { buildHubOutskirts } from './hubOutskirts';
import { buildHubResourceProps } from './hubResourceProps';
import { bindSurfaceImage, imageLambert, projectSurfaceUV, type ImageSurface } from './materialImages';

/** 頂点の色（絵の無い所） */
const C = {
  wood: 0x5d4632, woodLight: 0x80633f, woodPale: 0x9c7f58, plaster: 0xd4c8ab, dark: 0x2b241d, cloth: 0xbca77f, clothRed: 0x9c4f3c, clothBlue: 0x55697a,
  bronze: 0xa9874f, paper: 0xe7dcc0, crop: 0x5d7a37, cropLight: 0x7f9a46, soil: 0x5c4733, water: 0x3a5552, iron: 0x4b4845, sack: 0xb8a582, glow: 0xffd98a,
} as const;

type Mat = 'plain' | 'stone' | 'roof' | 'glow';
type PlainSurface='wood'|'cloth'|'bronze'|'soil'|'leaf'|'plaster'|'water';
const plainSurface=(color:number):PlainSurface=>color===C.bronze||color===C.iron?'bronze':color===C.cloth||color===C.clothRed||color===C.clothBlue||color===C.paper||color===C.sack?'cloth':color===C.crop||color===C.cropLight?'leaf':color===C.soil?'soil':color===C.water?'water':color===C.plaster?'plaster':'wood';
const plainImage=(k:PlainSurface):ImageSurface=>k==='soil'?'earth':k;
type P3 = readonly [number, number, number];

const tmpQ = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);
const tmpColor = new Color();

/** 面ごとの平らな uv（m ÷ tile）。上向きの面は (x, -z)、横向きは (横, y) */
function planarUv(g: BufferGeometry, tile: number): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (const [k, v] of [[0, a], [1, b], [2, c]] as const) {
      const [u, w] = ay >= ax && ay >= az ? [v.x, -v.z] : ax >= az ? [v.z, v.y] : [v.x, v.y];
      uv[(i + k) * 2] = u / tile;
      uv[(i + k) * 2 + 1] = w / tile;
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
}

/** 建物 1 つぶんの部品を、素材ごとに集める係。局所の座標（正面が +z、足もとが y = 0）で置き、向き yaw と位置 (x, y, z) で里へ置く */
class Kit {
  constructor(
    private out: Record<Mat, BufferGeometry[]>,
    private x: number,
    private y: number,
    private z: number,
    private yaw: number,
  ) {}

  /** 局所の点を里の座標へ */
  at(lx: number, ly: number, lz: number): Vector3 {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return new Vector3(this.x + lx * c + lz * s, this.y + ly, this.z - lx * s + lz * c);
  }

  private put(mat: Mat, g: BufferGeometry, color: number): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    // uv は、回す前の局所の座標で付ける（瓦の段が、棟に沿う）。建物の位置だけずらして、絵の並びを建物ごとに変える
    geo.translate(this.x, 0, this.z);
    planarUv(geo, mat === 'roof' ? 1.6 : 3);
    geo.translate(-this.x, 0, -this.z);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    geo.rotateY(this.yaw);
    geo.translate(this.x, this.y, this.z);
    tmpColor.set(color);
    const col = new Float32Array(geo.getAttribute('position').count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([tmpColor.r, tmpColor.g, tmpColor.b], i);
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if(mat==='plain')geo.userData.plainSurface=plainSurface(color);
    this.out[mat].push(geo);
  }

  /** 箱。中心 (x, y, z)、大きさ (sx, sy, sz)、局所の縦の軸での回転 ry */
  box(mat: Mat, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number = C.wood, ry = 0): void {
    const g = new BoxGeometry(sx, sy, sz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.put(mat, g, color);
  }

  /** 円柱（axis の向き）。r2 を渡すと、上（+ 側）の半径 */
  cyl(mat: Mat, x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, axis: 'x' | 'y' | 'z' = 'y', r2 = r): void {
    const g = new CylinderGeometry(r2, r, h, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.put(mat, g, color);
  }

  /** 錐（灯の帽子・作物）。seg 4 で四角錐 */
  cone(mat: Mat, x: number, y: number, z: number, r: number, h: number, color: number, seg = 4, ry = Math.PI / 4): void {
    const g = new ConeGeometry(r, h, seg);
    g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.put(mat, g, color);
  }

  /** 2 点の間に渡した角材（筋交い・縄・軸） */
  beam(mat: Mat, a: P3, b: P3, t: number, color: number): void {
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const g = new BoxGeometry(d.length(), t, t);
    tmpQ.setFromUnitVectors(X_AXIS, d.normalize());
    g.applyQuaternion(tmpQ);
    g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.put(mat, g, color);
  }

  /** 三角形 1 枚（両面） */
  tri(mat: Mat, a: P3, b: P3, c: P3, color: number): void {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
    g.computeVertexNormals();
    this.put(mat, g, color);
  }

  /** 四角 1 枚（両面）。a → b → c → d */
  quad(mat: Mat, a: P3, b: P3, c: P3, d: P3, color: number): void {
    this.tri(mat, a, b, c, color);
    this.tri(mat, a, c, d, color);
  }

  /**
   * 切妻の屋根: 棟は局所の x に沿う（幅 w、奥行 d、軒の高さ yE、棟の高さ yR、張り出し ov）。屋根の 2 枚と、妻（壁の色の三角）。
   * 屋根は板の厚み 0.12m（下から見上げても、紙のように見えない）
   */
  gable(cx: number, cz: number, w: number, d: number, yE: number, yR: number, ov: number, wall: number = C.plaster): void {
    const hw = w / 2 + ov, hd = d / 2 + ov;
    const drop = ((yR - yE) / (d / 2)) * ov;
    for (const s of [1, -1]) {
      const e = cz + s * hd, ye = yE - drop;
      this.quad('roof', [cx - hw, ye, e], [cx + hw, ye, e], [cx + hw, yR, cz], [cx - hw, yR, cz], C.wood);
      this.quad('plain', [cx - hw, ye - 0.12, e], [cx + hw, ye - 0.12, e], [cx + hw, yR - 0.12, cz], [cx - hw, yR - 0.12, cz], C.wood);
    }
    for (const s of [1, -1]) this.tri('plain', [cx + (s * w) / 2, yE, cz + d / 2], [cx + (s * w) / 2, yE, cz - d / 2], [cx + (s * w) / 2, yR - 0.1, cz], wall);
    // 棟木
    this.box('plain', cx, yR - 0.02, cz, w + ov * 2 + 0.1, 0.16, 0.18, C.wood);
  }

  /** 片流れの屋根（前が低い）。x0..x1、z0（後ろ、高さ yB）..z1（前、高さ yF） */
  leanTo(x0: number, x1: number, z0: number, z1: number, yB: number, yF: number): void {
    this.quad('roof', [x0, yF, z1], [x1, yF, z1], [x1, yB, z0], [x0, yB, z0], C.wood);
    this.quad('plain', [x0, yF - 0.1, z1], [x1, yF - 0.1, z1], [x1, yB - 0.1, z0], [x0, yB - 0.1, z0], C.wood);
  }

  /** 窓・戸（壁から少し出した暗い板）。face: 'f' 前 / 'b' 後 / 'l' 左 / 'r' 右。中心 (u, y) は面の上の位置 */
  hole(face: 'f' | 'b' | 'l' | 'r', hw: number, hd: number, u: number, y: number, w: number, h: number, frame = true): void {
    const t = 0.06;
    const [x, z, sx, sz] = face === 'f' ? [u, hd + t / 2, w, t] : face === 'b' ? [u, -hd - t / 2, w, t] : face === 'r' ? [hw + t / 2, u, t, w] : [-hw - t / 2, u, t, w];
    this.box('plain', x, y, z, sx, h, sz, C.dark);
    if (frame) {
      const [fx, fz] = face === 'f' || face === 'b' ? [sx + 0.16, sz + 0.04] : [sx + 0.04, sz + 0.16];
      this.box('plain', x, y - h / 2 - 0.05, z, fx, 0.1, fz, C.wood);
      this.box('plain', x, y + h / 2 + 0.05, z, fx, 0.1, fz, C.wood);
    }
  }
}

/** 煙・しぶきの出る所（里の座標）と種類 */
interface Emitter {
  x: number;
  y: number;
  z: number;
  kind: 'smoke' | 'mist';
  /** しぶきの幅（小滝の幅に散らす。向きは線の向き） */
  span?: { dx: number; dz: number };
  rate: number;
  acc: number;
}

/** 建物の形（kind ごと）。局所の座標で組む。煙突があれば、その先の位置（局所）を返す */
function buildKind(k: Kit, s: HubSceneryDef): P3[] {
  const smoke: P3[] = [];
  switch (s.kind) {
    case 'lamp': {
      k.cyl('plain', 0, 1.5, 0, 0.14, 3.0, C.wood, 6);
      k.box('plain', 0, 3.2, 0, 0.5, 0.5, 0.5, C.bronze);
      k.box('glow', 0, 3.2, 0, 0.36, 0.42, 0.36, C.glow);
      k.cone('plain', 0, 3.45, 0, 0.42, 0.35, C.wood);
      break;
    }
    case 'records': {
      for (const x of [-0.58, 0.58]) k.box('plain', x, 0.74, -0.04, 0.1, 1.48, 0.1, C.wood);
      k.box('plain', 0, 1.52, -0.02, 1.4, 0.08, 0.3, C.wood);
      k.box('plain', 0, 1.0, -0.06, 1.1, 0.84, 0.05, C.woodLight);
      break;
    }
    case 'shed': {
      // 6 本の柱、片流れの屋根（後ろが高い）、作業台・砥石・箱
      for (const x of [-2.8, 0, 2.8]) {
        k.box('plain', x, 1.75, -1.8, 0.18, 3.5, 0.18, C.wood);
        k.box('plain', x, 1.45, 1.8, 0.18, 2.9, 0.18, C.wood);
      }
      k.box('plain', 0, 3.45, -1.8, 6.0, 0.16, 0.2, C.wood);
      k.box('plain', 0, 2.85, 1.8, 6.0, 0.16, 0.2, C.wood);
      k.leanTo(-3.2, 3.2, -2.3, 2.3, 3.62, 2.86);
      k.box('plain', -0.9, 0.45, -1.0, 2.4, 0.9, 0.9, C.woodLight);
      k.box('stone', -0.9, 0.95, -1.0, 0.5, 0.1, 0.4, C.iron);
      k.cyl('stone', 1.7, 0.62, -0.7, 0.45, 0.2, 0xffffff, 12, 'x');
      for (const z of [-0.95, -0.45]) k.box('plain', 1.7, 0.4, z, 0.12, 0.8, 0.12, C.wood);
      k.box('plain', 2.4, 0.35, 0.9, 0.7, 0.7, 0.7, C.woodLight, 0.3);
      break;
    }
    case 'logs': {
      const rows: [number, number][] = [[0.17, -0.36], [0.17, 0], [0.17, 0.36], [0.47, -0.18], [0.47, 0.18], [0.77, 0]];
      for (const [y, z] of rows) k.cyl('plain', 0, y, z, 0.17, 2.2, C.woodPale, 7, 'x');
      for (const x of [-0.9, 0.9]) for (const z of [-0.62, 0.62]) k.box('plain', x, 0.45, z, 0.08, 0.9, 0.08, C.wood);
      break;
    }
    case 'crates': {
      k.box('plain', 0, 0.4, 0, 0.8, 0.8, 0.8, C.woodLight);
      k.box('plain', 0.1, 1.08, 0.05, 0.6, 0.56, 0.6, C.woodPale, 0.35);
      k.box('plain', 0.7, 0.3, 0.35, 0.6, 0.6, 0.6, C.woodLight, -0.25);
      for (const y of [0.15, 0.65]) k.box('plain', 0, y, 0, 0.84, 0.05, 0.84, C.wood);
      break;
    }
    case 'tank': {
      k.box('stone', 0, 0.35, 0, 1.6, 0.7, 0.9, 0xffffff);
      k.box('plain', 0, 0.64, 0, 1.36, 0.04, 0.66, C.water);
      break;
    }
    case 'anvil': {
      k.cyl('plain', 0, 0.3, 0, 0.32, 0.6, C.wood, 9);
      k.box('stone', 0, 0.7, 0, 0.62, 0.2, 0.28, C.iron);
      k.box('stone', 0.36, 0.72, 0, 0.18, 0.12, 0.18, C.iron);
      break;
    }
    case 'mill': {
      k.box('stone', 0, 0.6, 0, 4.2, 1.2, 3.8, 0xffffff);
      k.box('plain', 0, 2.3, 0, 4.0, 2.2, 3.6, C.woodLight);
      for (const x of [-2, 2]) for (const z of [-1.8, 1.8]) k.box('plain', x, 2.3, z, 0.18, 2.2, 0.18, C.wood);
      k.gable(0, 0, 4.0, 3.6, 3.4, 4.8, 0.4, C.woodLight);
      k.hole('f', 2.0, 1.8, 0.6, 2.25, 1.0, 1.8);
      k.hole('r', 2.0, 1.8, 0.2, 2.6, 0.7, 0.6);
      // 軸（壁から水車へ）
      k.cyl('plain', 0, 1.4, -3.3, 0.12, 3.1, C.iron, 8, 'z');
      break;
    }
    case 'wash': {
      k.box('stone', 0, 0.35, 0, 2.4, 0.7, 1.4, 0xffffff);
      k.box('plain', 0, 0.64, 0, 2.1, 0.04, 1.1, C.water);
      // 沢から引いた樋（後ろ = 沢の側）と、支える柱
      k.beam('plain', [0.6, 1.2, -2.3], [0.6, 0.85, -0.4], 0.26, C.wood);
      k.box('plain', 0.6, 0.55, -1.5, 0.12, 1.1, 0.12, C.wood);
      k.box('plain', -0.7, 0.75, 0.5, 0.5, 0.06, 0.4, C.cloth);
      break;
    }
    case 'storehouse': {
      k.box('stone', 0, 1.6, 0, 5.0, 3.2, 4.0, 0xffffff);
      k.gable(0, 0, 5.0, 4.0, 3.2, 4.7, 0.4, C.plaster);
      k.hole('f', 2.5, 2.0, 0, 1.15, 1.8, 2.2);
      k.box('plain', 0, 2.42, 2.06, 2.2, 0.18, 0.14, C.wood);
      for (const [x, z] of [[1.75, 2.45], [2.15, 2.6], [1.95, 2.3]] as const) k.cyl('plain', x, 0.3, z, 0.28, 0.6, C.sack, 8);
      break;
    }
    case 'lift': {
      // 崖（局所の +z）に沿った 2 本の柱（10.2m）、前の 2 本（7.4m）、上の梁と滑車。台は動く（別の形）
      for (const x of [-0.95, 0.95]) {
        k.box('plain', x, 5.1, 1.15, 0.24, 10.2, 0.24, C.wood);
        k.box('plain', x, 3.7, -0.75, 0.2, 7.4, 0.2, C.wood);
        for (const y of [2.4, 4.8, 7.2]) k.box('plain', x, y, 0.2, 0.12, 0.12, 1.9, C.wood);
        k.beam('plain', [x, 0.3, -0.75], [x, 7.0, 1.15], 0.1, C.wood);
      }
      k.box('plain', 0, 10.1, 1.15, 2.3, 0.22, 0.26, C.wood);
      k.box('plain', 0, 7.3, -0.75, 2.1, 0.18, 0.2, C.wood);
      k.cyl('plain', 0, 9.75, 0.6, 0.3, 0.16, C.iron, 10, 'x');
      k.box('plain', 0, 9.95, 0.85, 0.12, 0.3, 0.6, C.wood);
      break;
    }
    case 'inn': {
      // 石の土台、1 階は板壁、2 階は漆喰と梁。前に縁側（低い板の床と、片流れの屋根）。後ろの右に煙突
      k.box('stone', 0, 0.25, 0, 8.2, 0.5, 5.7, 0xffffff);
      k.box('plain', 0, 1.5, 0, 8.0, 2.0, 5.5, C.woodLight);
      k.box('plain', 0, 3.4, 0, 8.0, 1.8, 5.5, C.plaster);
      k.box('plain', 0, 2.5, 0, 8.12, 0.16, 5.62, C.wood);
      for (const x of [-4, 4]) for (const z of [-2.75, 2.75]) k.box('plain', x, 2.15, z, 0.2, 4.3, 0.2, C.wood);
      for (const x of [-1.35, 1.35]) k.box('plain', x, 3.4, 2.78, 0.14, 1.8, 0.08, C.wood);
      k.gable(0, 0, 8.0, 5.5, 4.3, 6.4, 0.55);
      k.hole('f', 4, 2.75, 0, 1.45, 1.1, 1.9);
      for (const x of [-2.6, 2.6]) k.hole('f', 4, 2.75, x, 1.55, 0.9, 0.7);
      for (const x of [-2.6, 0, 2.6]) k.hole('f', 4, 2.75, x, 3.4, 0.8, 0.7);
      for (const sd of ['l', 'r'] as const) k.hole(sd, 4, 2.75, 0, 3.4, 0.8, 0.7);
      k.box('plain', 0, 0.36, 3.45, 8.0, 0.12, 1.4, C.woodPale);
      for (const x of [-3.85, -1.3, 1.3, 3.85]) k.box('plain', x, 1.5, 4.05, 0.16, 2.3, 0.16, C.wood);
      k.leanTo(-4.2, 4.2, 2.75, 4.5, 3.0, 2.6);
      k.box('stone', 2.6, 5.7, -1.7, 0.7, 3.4, 0.7, 0xffffff);
      // 宿の看板（布）
      k.box('plain', -1.2, 2.25, 2.9, 0.9, 0.4, 0.04, C.clothRed);
      smoke.push([2.6, 7.5, -1.7]);
      break;
    }
    case 'firewood': {
      for (const x of [-1.1, 1.1]) for (const z of [-0.4, 0.4]) k.box('plain', x, 0.85, z, 0.12, 1.7, 0.12, C.wood);
      k.leanTo(-1.3, 1.3, -0.6, 0.6, 1.85, 1.6);
      for (let i = 0; i < 4; i++) k.box('plain', 0, 0.2 + i * 0.28, 0, 2.0, 0.26, 0.6, i % 2 ? C.woodPale : C.woodLight);
      break;
    }
    case 'house': {
      k.box('stone', 0, 0.2, 0, 5.7, 0.4, 4.7, 0xffffff);
      k.box('plain', 0, 1.65, 0, 5.5, 2.5, 4.5, C.plaster);
      for (const x of [-2.75, 2.75]) for (const z of [-2.25, 2.25]) k.box('plain', x, 1.65, z, 0.18, 2.5, 0.18, C.wood);
      k.box('plain', 0, 2.9, 0, 5.6, 0.14, 4.6, C.wood);
      k.gable(0, 0, 5.5, 4.5, 2.9, 4.5, 0.45);
      k.hole('f', 2.75, 2.25, 0, 1.3, 1.0, 1.8);
      for (const x of [-1.7, 1.7]) k.hole('f', 2.75, 2.25, x, 1.7, 0.7, 0.6);
      for (const sd of ['l', 'r'] as const) k.hole(sd, 2.75, 2.25, 0.3, 1.7, 0.7, 0.6);
      k.box('stone', -1.6, 3.9, -1.2, 0.6, 2.6, 0.6, 0xffffff);
      k.box('plain', 1.9, 0.3, 2.6, 0.5, 0.6, 0.5, C.woodLight, 0.4);
      smoke.push([-1.6, 5.3, -1.2]);
      break;
    }
    case 'field': {
      // 畝 5 本と、作物
      for (const z of [-1.2, -0.6, 0, 0.6, 1.2]) {
        k.box('plain', 0, 0.07, z, 8.6, 0.14, 0.34, C.soil);
        for (let x = -4.0; x <= 4.01; x += 0.5) k.cone('plain', x + (z * 0.3) % 0.25, 0.12, z, 0.13, 0.3, (Math.round(x * 2) + Math.round(z * 5)) % 2 ? C.crop : C.cropLight, 5, x);
      }
      for (const x of [-4.6, 4.6]) k.box('plain', x, 0.35, 0, 0.08, 0.7, 3.2, C.wood);
      break;
    }
    case 'laundry': {
      for (const x of [-2.2, 2.2]) k.box('plain', x, 1.1, 0, 0.12, 2.2, 0.12, C.wood);
      for (let i = 0; i < 6; i++) {
        const x0 = -2.2 + (4.4 * i) / 6, x1 = -2.2 + (4.4 * (i + 1)) / 6;
        const sag = (x: number): number => 0.12 * (1 - (x / 2.2) ** 2);
        k.beam('plain', [x0, 2.0 - sag(x0), 0], [x1, 2.0 - sag(x1), 0], 0.03, C.dark);
      }
      break;
    }
    case 'hall': {
      // 低い木造（10 × 7m）。前に深い庇（柱 4 本）。大きな戸
      k.box('stone', 0, 0.22, 0, 10.2, 0.45, 7.2, 0xffffff);
      k.box('plain', 0, 1.82, 0, 10.0, 2.75, 7.0, C.woodLight);
      for (const x of [-5, -2.5, 0, 2.5, 5]) for (const z of [-3.5, 3.5]) k.box('plain', x, 1.82, z, 0.2, 2.75, 0.2, C.wood);
      k.gable(0, 0, 10.0, 7.0, 3.2, 5.8, 0.5, C.woodLight);
      k.leanTo(-5.2, 5.2, 3.5, 5.8, 3.45, 2.95);
      for (const x of [-4.6, -1.5, 1.5, 4.6]) k.box('plain', x, 1.5, 5.3, 0.2, 3.0, 0.2, C.wood);
      k.box('plain', 0, 3.0, 5.3, 9.6, 0.18, 0.2, C.wood);
      k.hole('f', 5, 3.5, 0, 1.6, 2.2, 2.4);
      for (const x of [-3.5, 3.5]) k.hole('f', 5, 3.5, x, 1.9, 1.1, 0.7);
      for (const sd of ['l', 'r'] as const) for (const u of [-1.6, 1.6]) k.hole(sd, 5, 3.5, u, 1.9, 0.9, 0.7);
      // 庇の下の長椅子と、垂れ幕
      k.box('plain', -3, 0.25, 4.6, 2.4, 0.12, 0.5, C.woodPale);
      k.box('plain', 3, 0.25, 4.6, 2.4, 0.12, 0.5, C.woodPale);
      k.box('plain', 0, 3.45, 3.62, 1.2, 0.9, 0.05, C.clothBlue);
      break;
    }
    case 'survey': {
      for (const x of [-1.8, 1.8]) for (const z of [-1.3, 1.3]) k.box('plain', x, 1.2, z, 0.14, 2.4, 0.14, C.wood);
      // 布の屋根（低い切妻）
      for (const s2 of [1, -1]) k.quad('plain', [-2.1, 2.35, s2 * 1.6], [2.1, 2.35, s2 * 1.6], [2.1, 2.9, 0], [-2.1, 2.9, 0], C.cloth);
      k.box('plain', 0, 0.45, 0, 2.2, 0.9, 1.0, C.woodLight);
      k.box('plain', 0, 0.91, 0, 1.8, 0.02, 0.8, C.paper);
      k.box('plain', 0.3, 0.93, 0.1, 0.5, 0.02, 0.35, 0xc9b98f, 0.3);
      for (const x of [-0.7, -0.45]) k.cyl('plain', x, 0.98, -0.25, 0.05, 0.6, C.paper, 6, 'x');
      for (const z of [-1.0, 1.0]) k.box('plain', 0, 0.25, z * 1.0, 1.8, 0.1, 0.35, C.woodPale);
      break;
    }
    case 'watch': {
      k.box('stone', 0, 0.7, 0, 2.6, 1.4, 2.6, 0xffffff);
      for (const x of [-1, 1]) for (const z of [-1, 1]) k.beam('plain', [x * 1.0, 1.4, z * 1.0], [x * 0.55, 6.85, z * 0.55], 0.2, C.wood);
      for (const y of [3.0, 5.0]) {
        const r = 1.0 - ((y - 1.4) / 5.45) * 0.45;
        for (const [a, b] of [[[-r, -r], [r, -r]], [[r, -r], [r, r]], [[r, r], [-r, r]], [[-r, r], [-r, -r]]] as const) k.beam('plain', [a[0], y, a[1]], [b[0], y, b[1]], 0.1, C.wood);
      }
      k.box('plain', 0, 6.9, 0, 1.8, 0.15, 1.8, C.wood);
      for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) k.box('plain', x, 7.4, z, 0.1, 1.0, 0.1, C.wood);
      k.box('plain', 0, 7.75, 0, 0.95, 1.1, 0.95, C.bronze);
      k.box('glow', 0, 7.75, 0, 0.7, 0.85, 0.7, C.glow);
      k.cone('plain', 0, 8.3, 0, 1.15, 0.8, C.wood);
      break;
    }
  }
  return smoke;
}

/** 水車: 軸は x（里の座標。沢は z に沿って南へ流れる）。半径 r、幅 w。輪 2 つ・腕 8 本・羽根 16 枚 */
function wheelGeometry(r: number, w: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry): void => {
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  for (const x of [-w / 2, w / 2]) {
    // 輪: 16 本の短い角材（局所の y が外向き、z が輪に沿う向き。x の軸のまわりに回して並べる）
    for (let i = 0; i < 16; i++) {
      const g = new BoxGeometry(0.12, 0.16, 2 * r * Math.sin(Math.PI / 16) + 0.03);
      g.translate(0, r * Math.cos(Math.PI / 16), 0);
      g.rotateX(((i + 0.5) / 16) * Math.PI * 2);
      g.translate(x, 0, 0);
      add(g);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = new BoxGeometry(0.1, r, 0.1);
      g.translate(0, r / 2, 0);
      g.rotateX(a);
      g.translate(x, 0, 0);
      add(g);
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const g = new BoxGeometry(w + 0.1, 0.5, 0.06);
    g.translate(0, r - 0.15, 0);
    g.rotateX(a);
    add(g);
  }
  const hub = new CylinderGeometry(0.3, 0.3, w + 0.3, 10);
  hub.rotateZ(Math.PI / 2);
  add(hub);
  for (const p of parts) projectSurfaceUV(p,.8);
  return mergeGeometries(parts)!;
}

/** 瓦の絵（64 四方。4 段の瓦。段ごとに半分ずらす）。1 枚 = 1.6m */
function roofTexture(): DataTexture {
  const W = 64, H = 64;
  const data = new Uint8Array(W * H * 4);
  const rng = new SeededRng(4401);
  const shade: number[] = [];
  for (let i = 0; i < 32; i++) shade.push(0.82 + rng.next() * 0.3);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / 16), yy = y % 16;
    for (let x = 0; x < W; x++) {
      const xs = (x + (row % 2) * 8) % W;
      const col = Math.floor(xs / 16), xx = xs % 16;
      let v = shade[(row * 4 + col) % 32]!;
      if (yy >= 14) v *= 0.45;
      else if (xx === 0 || xx === 15) v *= 0.6;
      else v *= 0.9 + 0.1 * (yy / 14);
      const i = (y * W + x) * 4;
      data[i] = 118 * v;
      data[i + 1] = 100 * v;
      data[i + 2] = 86 * v;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, W, H);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 煙としぶきの粒（やわらかい丸。大きさが育ち、だんだん薄くなる）。霧も掛かる */
class Puffs {
  readonly points: Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private grow: Float32Array;
  private next = 0;
  readonly uniforms: { uScale: { value: number } };

  constructor(private count: number) {
    this.pos = new Float32Array(count * 3).fill(-9999);
    this.vel = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.grow = new Float32Array(count);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aColor', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('aSize', new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1).setUsage(DynamicDrawUsage));
    this.uniforms = { uScale: { value: 360 } };
    const mat = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, this.uniforms]),
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor; varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vColor = aColor; vAlpha = aAlpha;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float a = vAlpha * (1.0 - d) * (1.0 - d * 0.6);
          gl_FragColor = vec4(vColor, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: NormalBlending,
    });
    // ShaderMaterial は uniforms を写すので、写したものを持つ
    this.uniforms = mat.uniforms as unknown as { uScale: { value: number } };
    this.points = new Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(x: number, y: number, z: number, kind: 'smoke' | 'mist'): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    const smoke = kind === 'smoke';
    this.pos.set([x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3], i * 3);
    this.vel.set(smoke ? [(Math.random() - 0.5) * 0.15, 0.55 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15] : [(Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6], i * 3);
    const g = smoke ? 0.62 + Math.random() * 0.12 : 0.92;
    this.col.set(smoke ? [g, g * 0.98, g * 0.95] : [0.93, 0.97, 0.97], i * 3);
    this.life[i] = smoke ? 5 + Math.random() * 2.5 : 1.2 + Math.random() * 0.8;
    this.age[i] = 0;
    this.size[i] = smoke ? 0.7 : 0.5;
    this.grow[i] = smoke ? 0.55 : 0.9;
    this.alpha[i] = 0;
  }

  update(dt: number): void {
    // 風（草と同じ向き、北東へ）に、少しずつ流される
    const wx = 0.32, wz = 0.24;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i]! <= 0) continue;
      this.age[i]! += dt;
      const t = this.age[i]! / this.life[i]!;
      if (t >= 1) {
        this.life[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        this.alpha[i] = 0;
        continue;
      }
      const k = Math.min(1, t * 8);
      this.pos[i * 3]! += (this.vel[i * 3]! + wx * t) * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt * (1 - t * 0.5);
      this.pos[i * 3 + 2]! += (this.vel[i * 3 + 2]! + wz * t) * dt;
      this.size[i]! += this.grow[i]! * dt;
      this.alpha[i] = k * (1 - t) * 0.42;
    }
    const g = this.points.geometry;
    for (const n of ['position', 'aColor', 'aSize', 'aAlpha']) (g.getAttribute(n) as BufferAttribute).needsUpdate = true;
  }
}

/** 小物の絵の背丈（m）。仮の値 */
export const PROP_HEIGHT: Record<string, number> = {
  route_lamp_on: 2.75, route_lamp_off: 2.75, closed_route_sign: 1.9, supply_cart: 1.55, replaceable_parts: 0.75, record_board: 0.76,
};

/**
 * 小物の絵の板（1 回の描画）。どれもカメラの方を向く（縦の軸で回る。頂点の shader で向ける）。
 * fixed を渡した板は、向きを変えない（記録台の板）。板の中の位置（position）は (横, 縦)、根元は aCenter
 */
interface PropItem {
  art: string;
  x: number;
  y: number;
  z: number;
  /** 向きを変えない板（記録台）: 正面の向きと、床からの高さ */
  fixed?: { yaw: number; lift: number };
}

function buildProps(items: readonly PropItem[]): Mesh {
  const pos: number[] = [], uv: number[] = [], center: number[] = [], right: number[] = [], nor: number[] = [];
  for (const it of items) {
    const a = PROP_ART[it.art];
    if (!a) continue;
    const h = PROP_HEIGHT[it.art] ?? 1;
    const w = h * a.aspect;
    const x0 = -a.rootX * w, x1 = (1 - a.rootX) * w;
    const y0 = (it.fixed?.lift ?? 0) - 0.02, y1 = y0 + h;
    const [u0, v1, u1, v0] = [a.rect[0] / PROP_ATLAS.w, 1 - a.rect[1] / PROP_ATLAS.h, a.rect[2] / PROP_ATLAS.w, 1 - a.rect[3] / PROP_ATLAS.h];
    const quad = [[x0, y0, u0, v0], [x1, y0, u1, v0], [x1, y1, u1, v1], [x0, y0, u0, v0], [x1, y1, u1, v1], [x0, y1, u0, v1]];
    const rv = it.fixed ? [Math.cos(it.fixed.yaw), 0, -Math.sin(it.fixed.yaw)] : [0, 0, 0];
    for (const [px, py, pu, pv] of quad) {
      pos.push(px!, py!, 0);
      uv.push(pu!, pv!);
      center.push(it.x, it.y, it.z);
      right.push(...rv);
      nor.push(0, 1, 0);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('aCenter', new Float32BufferAttribute(center, 3));
  geo.setAttribute('aRight', new Float32BufferAttribute(right, 3));
  const mat = new MeshLambertMaterial({ alphaTest: 0.5, side: DoubleSide });
  mat.color.setScalar(1.15);
  mat.visible = false;
  mat.userData.uv = true;
  mat.userData.prop = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 aCenter;\nattribute vec3 aRight;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `vec3 rightW = aRight;
      if (dot(rightW, rightW) < 0.5) {
        rightW = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        rightW.y = 0.0;
        rightW = normalize(rightW + vec3(1e-5, 0.0, 0.0));
      }
      vec3 wpos = aCenter + rightW * transformed.x + vec3(0.0, transformed.y, 0.0);
      vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  mat.customProgramCacheKey = () => 'prop-billboard';
  loadEnvTexture(
    PROP_ATLAS.file,
    (t: Texture) => {
      t.anisotropy = 4;
    },
    (t: Texture) => {
      mat.map = t;
      mat.visible = true;
      mat.needsUpdate = true;
    },
    'assets/textures/props/',
  );
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  m.userData.props = items.length;
  m.renderOrder = 2;
  return m;
}

/** 物干しの布（風で揺れる。下ほど大きく） */
function buildLaundry(list: HubSceneryDef[], floorOf: (x: number, z: number) => number): Mesh | null {
  const pos: number[] = [], col: number[] = [], sway: number[] = [];
  const colors = [C.cloth, C.clothBlue, C.paper, C.clothRed];
  for (const s of list) {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const y = floorOf(s.x, s.z);
    [-1.45, -0.5, 0.45, 1.4].forEach((lx, i) => {
      const w = 0.78, top = 2.0 - 0.12 * (1 - (lx / 2.2) ** 2) - 0.02, h = 1.05 - (i % 2) * 0.2;
      const pts = [[lx - w / 2, top], [lx + w / 2, top], [lx + w / 2, top - h], [lx - w / 2, top], [lx + w / 2, top - h], [lx - w / 2, top - h]];
      tmpColor.set(colors[i % colors.length]!);
      for (const [px, py] of pts) {
        pos.push(s.x + px! * c, y + py!, s.z - px! * sn);
        col.push(tmpColor.r, tmpColor.g, tmpColor.b);
        sway.push((top - py!) / h);
      }
    });
  }
  if (pos.length === 0) return null;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aSway', new Float32BufferAttribute(sway, 1));
  geo.computeVertexNormals();
  projectSurfaceUV(geo,.45);
  const mat = imageLambert('cloth',{vertexColors:true,side:DoubleSide});
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = 'uniform float uWind;\nattribute float aSway;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float ph = position.x * 1.7 + position.z * 1.3;
      float g = 0.5 + 0.5 * sin(uWind * 0.5 - position.x * 0.07);
      transformed.x += aSway * aSway * (0.10 + 0.18 * g) * (0.6 + 0.4 * sin(uWind * 2.1 + ph));
      transformed.z += aSway * aSway * (0.08 + 0.14 * g) * (0.6 + 0.4 * cos(uWind * 1.7 + ph));`,
    );
  };
  mat.customProgramCacheKey = () => 'laundry-sway';
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  m.userData.laundry = true;
  return m;
}

/** 里の音の大きさ（0〜1）。沢・炉・風 */
export interface Ambience {
  water: number;
  forge: number;
  wind: number;
}

/** 1 フレームの出来事: 鳴らす音と、火花の出る所 */
export interface VillageFrame {
  ambience: Ambience;
  sounds: { id: string; k: number }[];
  sparks: { x: number; y: number; z: number }[];
}

/** 鍛冶が槌を打つ間（秒）。里の人の板（npcSprites.ts）も、同じ間で打つしぐさをする */
export const SMITH_PERIOD = 1.6;
/** 荷揚げの昇降台の 1 往復（秒）: 下で待つ 3、上る 6、上で待つ 3、下りる 6 */
const LIFT_CYCLE = 18;

export interface Village {
  group: Group;
  update(dt: number, time: number, listener: { x: number; y: number; z: number }, pixelScale: number): VillageFrame;
}

/**
 * 里の建物と暮らし。hub は施設と建物と小物の位置、map は段差（床の高さ）と外周。falls は小滝の擁壁（terraces.ts の userData.falls）。
 */
export function buildVillage(hub: HubDef, map: MapDef, falls: readonly WallSegment[] = []): Village {
  const group = new Group();
  group.name = 'village';
  const floorOf = (x: number, z: number): number => groundAt(map.platforms, x, z);
  const geo: Record<Mat, BufferGeometry[]> = { plain: [], stone: [], roof: [], glow: [] };
  const emitters: Emitter[] = [];
  const scenery = hub.scenery ?? [];
  for (const s of scenery) {
    const y = floorOf(s.x, s.z);
    const kit = new Kit(geo, s.x, y, s.z, s.yaw);
    // 箱型の主要家屋は hubCraft の専用立体に置換。煙の位置は旧版と同じ。
    const detailSmoke = s.kind==='inn'?[[2.6,7.5,-1.7]] as P3[]:s.kind==='house'?[[-1.6,5.3,-1.2]] as P3[]:s.kind==='hall'||s.kind==='storehouse'?[]:buildKind(kit,s);
    for (const [lx, ly, lz] of detailSmoke) {
      const p = kit.at(lx, ly, lz);
      emitters.push({ x: p.x, y: p.y, z: p.z, kind: 'smoke', rate: 2.2, acc: Math.random() });
    }
  }
  // 工房の煙突（hubScene.ts の工房の形の、右の奥の煙突の上）
  const ws = hub.facilities.find((f) => f.kind === 'workshop');
  if (ws) {
    const c = Math.cos(ws.building.yaw), s = Math.sin(ws.building.yaw);
    const [lx, lz] = [2.58, -2.55];
    emitters.push({ x: ws.building.x + lx * c + lz * s, y: floorOf(ws.building.x, ws.building.z) + 5.5, z: ws.building.z - lx * s + lz * c, kind: 'smoke', rate: 3.2, acc: 0 });
  }
  // 素材（頂点の色で塗るもの・石・瓦・灯の明かり）ごとに 1 つの形
  const stoneMat = tileMaterial('rock', 0xd9d2c4, { gain: 1.4, vertexColors: true });
  const plainMat = imageLambert('wood',{vertexColors:true});
  const roofMat = new MeshLambertMaterial({ map: roofTexture(), vertexColors: false, side: DoubleSide });
  roofMat.userData.uv = true;
  bindSurfaceImage(roofMat,'roof',{raw:true,gain:1.5,replaceFallback:true,bump:.06});
  const glowMat = new MeshBasicMaterial({ color: C.glow });
  const mats: Record<Mat, MeshLambertMaterial | MeshBasicMaterial> = { plain: plainMat, stone: stoneMat, roof: roofMat, glow: glowMat };
  for (const k of ['plain', 'stone', 'roof', 'glow'] as const) {
    if (geo[k].length === 0) continue;
    if(k==='plain'){
      // 分類済みの頂点色を保ち、木・布・金属などは別の画像を貼る。既存の子グループ名は維持。
      const plain=new Group();plain.userData.village='plain';
      for(const kind of ['wood','cloth','bronze','soil','leaf','plaster','water'] as const){
        const parts=geo.plain.filter(g=>g.userData.plainSurface===kind);if(!parts.length)continue;
        const material=kind==='wood'?plainMat:imageLambert(plainImage(kind),{vertexColors:true},{gain:kind==='water'?2.6:1.35});
        const mesh=new Mesh(mergeGeometries(parts)!,material);mesh.name='village-'+kind;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.noMerge=true;plain.add(mesh);
      }group.add(plain);continue;
    }
    const m = new Mesh(mergeGeometries(geo[k])!, mats[k]);
    m.castShadow = k !== 'glow';
    m.receiveShadow = true;
    m.userData.village = k;
    m.userData.noMerge = true;
    group.add(m);
  }
  // 水車（水車小屋の後ろ = 局所の -z の 4.8m 先。軸は里の x）。羽根の下の 0.45m が水に入る
  const mill = scenery.find((s) => s.kind === 'mill');
  let wheel: Mesh | null = null;
  if (mill) {
    const c = Math.cos(mill.yaw), s = Math.sin(mill.yaw);
    const wx = mill.x + -4.8 * s, wz = mill.z + -4.8 * c;
    const water = floorOf(wx, wz);
    wheel = new Mesh(wheelGeometry(2.3, 0.8), imageLambert('wood',{color:0x5a4430},{bump:.035}));
    wheel.position.set(wx, water + 2.3 - 0.45, wz);
    wheel.rotation.y = mill.yaw - Math.PI / 2;
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    wheel.userData.wheel = true;
    group.add(wheel);
  }
  // 荷揚げの昇降台（台・箱・縄。崖に沿って上り下りする）
  const lift = scenery.find((s) => s.kind === 'lift');
  let liftCar: Group | null = null, liftRope: Mesh | null = null;
  const liftFloor = lift ? floorOf(lift.x, lift.z) : 0;
  if (lift) {
    liftCar = new Group();
    const wood = imageLambert('wood',{color:0x7a5d40});
    const plat = new Mesh(new BoxGeometry(1.6, 0.12, 1.4), wood);
    const box1 = new Mesh(new BoxGeometry(0.7, 0.6, 0.6), imageLambert('wood',{color:0x8f7048}));
    box1.position.set(-0.3, 0.36, 0.1);
    const box2 = new Mesh(new BoxGeometry(0.55, 0.45, 0.5), imageLambert('wood',{color:0x9c7f58}));
    box2.position.set(0.4, 0.29, -0.15);
    box2.rotation.y = 0.4;
    liftCar.add(plat, box1, box2);
    liftCar.rotation.y = lift.yaw;
    liftCar.position.set(lift.x, liftFloor + 0.1, lift.z);
    for (const o of liftCar.children) o.castShadow = true;
    liftCar.userData.lift = true;
    group.add(liftCar);
    const rope = new BoxGeometry(0.04, 1, 0.04);
    rope.translate(0, -0.5, 0);
    liftRope = new Mesh(rope, imageLambert('cloth',{color:0x3a3026}));
    const c = Math.cos(lift.yaw), s = Math.sin(lift.yaw);
    liftRope.position.set(lift.x + 0.6 * s, liftFloor + 9.6, lift.z + 0.6 * c);
    group.add(liftRope);
  }
  // 物干しの布
  const laundry = buildLaundry(scenery.filter((s) => s.kind === 'laundry'), floorOf);
  if (laundry) group.add(laundry);
  // 小物の絵（灯・荷車・看板・部品）と、記録台の板
  const props: PropItem[] = (hub.props ?? []).map((p) => ({ art: p.art, x: p.x, y: floorOf(p.x, p.z), z: p.z }));
  for (const s of scenery.filter((q) => q.kind === 'records')) props.push({ art: 'record_board', x: s.x, y: floorOf(s.x, s.z), z: s.z, fixed: { yaw: s.yaw, lift: 0.62 } });
  group.add(buildProps(props));
  // 外周の出口の外: 山の斜面（草地）と、その上を下りていく道（土の色）。外周の外 45m まで、だんだん急に下りて霧へ消える
  const slopeMat = tileMaterial('grass', 0xffffff, { gain: 1.2, vertexColors: true });
  const slopes: BufferGeometry[] = [];
  const b = map.bounds;
  for (const g of hub.gates ?? []) {
    if (!g.trail) continue;
    const [ox, oz] = Math.abs(g.x - b.maxX) < 0.6 ? [1, 0] : Math.abs(g.x - b.minX) < 0.6 ? [-1, 0] : Math.abs(g.z - b.maxZ) < 0.6 ? [0, 1] : [0, -1];
    const y0 = floorOf(g.x - ox * 0.5, g.z - oz * 0.5);
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const ND = 15, NL = 16, D = 45, HL = 22;
    for (let i = 0; i <= ND; i++) {
      const d = (i / ND) ** 1.3 * D;
      const bend = 4 * Math.sin(d / 12);
      for (let j = 0; j <= NL; j++) {
        const l = -HL + (2 * HL * j) / NL;
        const y = y0 - 0.03 - 0.05 * d - 0.011 * d * d - 0.012 * Math.max(0, Math.abs(l) - 4) ** 1.5;
        const x = g.x + ox * (d - 0.2) - oz * l, z = g.z + oz * (d - 0.2) + ox * l;
        pos.push(x, y, z);
        uv.push(x / 6, -z / 6);
        const path = Math.max(0, 1 - Math.abs(l - bend) / 3.2);
        const fade = 1 - 0.3 * (i / ND);
        col.push(fade * (1 + 0.5 * path), fade * (1 + 0.18 * path), fade * (1 - 0.1 * path));
      }
    }
    for (let i = 0; i < ND; i++) {
      for (let j = 0; j < NL; j++) {
        const a = i * (NL + 1) + j, c = a + NL + 1;
        idx.push(a, a + 1, c, c, a + 1, c + 1);
      }
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    sg.setAttribute('color', new Float32BufferAttribute(col, 3));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    // 上を向くように（並べ方で裏返っていたら、三角形の向きを逆にする）
    if ((sg.getAttribute('normal') as BufferAttribute).getY(0) < 0) {
      const ix = sg.getIndex()!;
      for (let t = 0; t < ix.count; t += 3) {
        const v = ix.getX(t + 1);
        ix.setX(t + 1, ix.getX(t + 2));
        ix.setX(t + 2, v);
      }
      sg.computeVertexNormals();
    }
    slopes.push(sg);
  }
  if (slopes.length) {
    const m = new Mesh(mergeGeometries(slopes)!, slopeMat);
    m.receiveShadow = true;
    m.userData.noMerge = true;
    m.userData.trails = slopes.length;
    group.add(m);
  }
  // 沢の入口と出口（外周の崖の根元の、暗い水の口）
  const water = map.platforms.filter((p) => p.look === 'water');
  if (water.length) {
    const minX = Math.min(...water.map((p) => p.minX)), maxX = Math.max(...water.map((p) => p.maxX));
    const north = water.reduce((a, p) => (p.maxZ > a.maxZ ? p : a)), south = water.reduce((a, p) => (p.minZ < a.minZ ? p : a));
    const mouth = new MeshBasicMaterial({ color: 0x141a19 });
    for (const [p, z, dir] of [[north, north.maxZ - 0.1, Math.PI], [south, south.minZ + 0.1, 0]] as const) {
      const r = (maxX - minX) * 0.42;
      const g = new CircleGeometry(r, 14, 0, Math.PI);
      const m = new Mesh(g, mouth);
      m.position.set((minX + maxX) / 2, p.h - 0.05, z);
      m.rotation.y = dir;
      m.userData.noMerge = true;
      group.add(m);
    }
  }
  // 灯見の台の後ろの山（崖の図の岩を大きくして、外周の外に置く。根元は台の高さ）
  const rng = new SeededRng(9203);
  const top = Math.max(...map.platforms.map((p) => p.h));
  const back: { x: number; z: number; r: number; h: number }[] = [
    { x: -44, z: 71, r: 9, h: 19 }, { x: -28, z: 74, r: 11, h: 24 }, { x: -11, z: 70, r: 8.5, h: 16 }, { x: 4, z: 75, r: 12, h: 27 },
    { x: 19, z: 70, r: 9, h: 18 }, { x: 33, z: 73, r: 10, h: 21 }, { x: -54, z: 60, r: 8, h: 15 }, { x: 31, z: 56, r: 7, h: 12 },
  ];
  const placed = back.map((r) => ({ ...placeBigRock(rng, r, 1.0), y: top - 1.5 }));
  const mount = new Mesh(mergeRocks(placed), rockArtMaterial());
  mount.castShadow = false;
  mount.receiveShadow = true;
  mount.userData.noMerge = true;
  mount.userData.rockArt = placed.map((p) => p.id);
  group.add(mount);
  const outskirts = buildHubOutskirts(hub, map);
  group.add(outskirts.group, buildHubResourceProps(map));
  // 煙としぶき（小滝の下）
  const puffs = new Puffs(260);
  group.add(puffs.points);
  for (const f of falls) {
    const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
    emitters.push({ x: (f.ax + f.bx) / 2 + f.nx * 0.5, y: f.lo + 0.1, z: (f.az + f.bz) / 2 + f.nz * 0.5, kind: 'mist', rate: 4 + len, acc: 0, span: { dx: (f.bx - f.ax) * 0.45, dz: (f.bz - f.az) * 0.45 } });
  }
  // 音の出る所: 小滝の真ん中・炉（工房）・水車
  const fallPts = falls.map((f) => ({ x: (f.ax + f.bx) / 2, y: (f.lo + f.hi) / 2, z: (f.az + f.bz) / 2 }));
  const streamX = water.length ? (Math.min(...water.map((p) => p.minX)) + Math.max(...water.map((p) => p.maxX))) / 2 : 0;
  const streamZ = water.length ? [Math.min(...water.map((p) => p.minZ)), Math.max(...water.map((p) => p.maxZ))] : [0, 0];
  const anvil = scenery.find((s) => s.kind === 'anvil');
  const forgeAt = ws ? { x: ws.building.x, y: floorOf(ws.building.x, ws.building.z) + 1.5, z: ws.building.z } : null;
  const anvilTop = anvil ? { x: anvil.x, y: floorOf(anvil.x, anvil.z) + 0.85, z: anvil.z } : null;
  const wheelAt = wheel ? wheel.position.clone() : null;
  let lastStrike = -1, lastCreak = -1, lastBell = -1;
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

  return {
    group,
    update(dt, time, ear, pixelScale): VillageFrame {
      animateTerraces(time);
      outskirts.update(time);
      if (wheel) wheel.rotation.x = time * 0.55;
      if (liftCar && liftRope && lift) {
        const t = time % LIFT_CYCLE;
        const u = t < 3 ? 0 : t < 9 ? (t - 3) / 6 : t < 12 ? 1 : 1 - (t - 12) / 6;
        const e = u * u * (3 - 2 * u);
        const y = liftFloor + 0.1 + e * 7.0;
        liftCar.position.y = y;
        liftRope.scale.y = Math.max(0.1, liftFloor + 9.6 - (y + 0.7));
      }
      // 煙としぶき
      for (const e of emitters) {
        e.acc += dt * e.rate;
        while (e.acc >= 1) {
          e.acc -= 1;
          if (e.kind === 'mist' && e.span) {
            const k = Math.random() * 2 - 1;
            puffs.emit(e.x + e.span.dx * k, e.y, e.z + e.span.dz * k, 'mist');
          } else puffs.emit(e.x, e.y, e.z, e.kind);
        }
      }
      puffs.uniforms.uScale.value = pixelScale;
      puffs.update(dt);
      // 音の大きさ
      const dist = (p: { x: number; y: number; z: number }): number => Math.hypot(p.x - ear.x, (p.y - ear.y) * 0.8, p.z - ear.z);
      const dzs = Math.max(0, streamZ[0]! - ear.z, ear.z - streamZ[1]!);
      const streamD = Math.hypot(Math.max(0, Math.abs(ear.x - streamX) - 2), dzs);
      let waterLv = clamp01(1 - streamD / 42) * 0.55;
      for (const f of fallPts) waterLv = Math.max(waterLv, clamp01(1 - dist(f) / 50));
      const forgeLv = forgeAt ? clamp01(1 - dist(forgeAt) / 30) : 0;
      const windLv = 0.4 + 0.6 * clamp01((ear.y + 10) / 32);
      const sounds: VillageFrame['sounds'] = [];
      const sparks: VillageFrame['sparks'] = [];
      // 鍛冶の槌（ロクハが打つ）・水車のきしみ・灯見の台の遠い鐘
      const strike = Math.floor(time / SMITH_PERIOD);
      if (strike !== lastStrike) {
        if (lastStrike >= 0 && anvilTop) {
          const k = clamp01(1 - dist(anvilTop) / 38);
          if (k > 0.04) sounds.push({ id: 'forge_clank', k: 0.25 + 0.75 * k });
          if (dist(anvilTop) < 60) sparks.push(anvilTop);
        }
        lastStrike = strike;
      }
      const creak = Math.floor(time / 3.3);
      if (creak !== lastCreak) {
        if (lastCreak >= 0 && wheelAt) {
          const k = clamp01(1 - dist(wheelAt) / 30);
          if (k > 0.05) sounds.push({ id: 'wheel_creak', k: 0.3 + 0.7 * k });
        }
        lastCreak = creak;
      }
      const bell = Math.floor(time / 24);
      if (bell !== lastBell) {
        if (lastBell >= 0 && ear.y > top - 6) sounds.push({ id: 'bell_far', k: 0.6 });
        lastBell = bell;
      }
      return { ambience: { water: waterLv, forge: forgeLv, wind: windLv }, sounds, sparks };
    },
  };
}
