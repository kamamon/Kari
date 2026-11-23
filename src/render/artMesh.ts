// 設定図をそのまま表面へ貼る、武器の仮モデル用の部品。
// 形は設定図の輪郭を測った寸法でコードから組み、絵は設定図を切り出したもの（tools/art/weapon_bake.py）を貼る。
// 絵の切り出し範囲と縮尺は weaponSheets.ts（生成物）にあり、焼く道具と同じ値を使う。
import { BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Mesh, MeshLambertMaterial, SRGBColorSpace, TextureLoader } from 'three';
import { assetUrl } from '../core/assets';

/** 設定図 1 枚ぶんの、切り出し範囲（px）・原点・縮尺。 */
export interface ArtSheet {
  tex: string;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** モデルの横 0 にあたる px */
  cx: number;
  /** モデルの高さ 0 にあたる px */
  py0: number;
  mPerPx: number;
  /** 絵が届くまでの 1 色（sRGB 0〜255） */
  flat: readonly [number, number, number];
}

export type P3 = [number, number, number];
export type UV = [number, number];
export interface ArtStatus {
  loaded: boolean;
  failed: boolean;
}

/**
 * 図の横方向を、モデルのどの軸に当てるか。
 * 'zy': 横 = Z（剣・鎌。-Z が刃の側）/ 'xy': 横 = X（盾の表）/ 'xy-back': 横 = -X（盾の裏。後ろから見た図）
 */
export type SheetAxis = 'zy' | 'xy' | 'xy-back';

export class ArtMesh {
  private readonly pos: number[] = [];
  private readonly uv: number[] = [];

  constructor(
    readonly sheet: ArtSheet,
    private readonly axis: SheetAxis = 'zy',
  ) {}

  /** 図へまっすぐ写す（遠近なし）。 */
  planar(p: P3): UV {
    const s = this.sheet;
    const across = this.axis === 'zy' ? p[2] : this.axis === 'xy' ? p[0] : -p[0];
    const px = across / s.mPerPx + s.cx;
    const py = s.py0 - p[1] / s.mPerPx;
    return [(px - s.x0) / s.w, 1 - (py - s.y0) / s.h];
  }

  tri(a: P3, b: P3, c: P3, ua = this.planar(a), ub = this.planar(b), uc = this.planar(c)): void {
    this.pos.push(...a, ...b, ...c);
    this.uv.push(...ua, ...ub, ...uc);
  }

  quad(a: P3, b: P3, c: P3, d: P3, u?: [UV, UV, UV, UV]): void {
    this.tri(a, b, c, u?.[0], u?.[1], u?.[2]);
    this.tri(a, c, d, u?.[0], u?.[2], u?.[3]);
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
    const v = (x: number, y: number, z: number): P3 => [x, y, z];
    this.quad(v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(x0, y0, z0));
    this.quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1));
    this.quad(v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0));
    this.quad(v(x0, y0, z1), v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1));
    this.quad(v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0));
    this.quad(v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(x0, y0, z1));
  }

  /**
   * Y 軸のまわりに回した形（握り・柄・柄頭）。profile は [高さ, 半径, 設定図での半幅]。'zy' の図で使う。
   * 絵は、正面から見えている幅を前半周へ引き伸ばして貼り、後ろ半周はその鏡写しにする（巻き革の模様が横でつぶれない）。
   */
  lathe(profile: readonly (readonly [number, number, number])[], seg = 12): void {
    const point = (k: number, i: number): [P3, UV] => {
      const [y, r, rArt] = profile[k]!;
      const phi = -Math.PI + (2 * Math.PI * i) / seg; // 0 が設定図の正面（-X）
      const fold = Math.abs(phi) <= Math.PI / 2 ? phi : Math.sign(phi) * (Math.PI - Math.abs(phi));
      const p: P3 = [-r * Math.cos(phi), y, r * Math.sin(phi)];
      return [p, this.planar([0, y, rArt * 0.92 * (fold / (Math.PI / 2))])];
    };
    for (let k = 0; k < profile.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const [a, ua] = point(k, i), [b, ub] = point(k, i + 1), [c, uc] = point(k + 1, i + 1), [d, ud] = point(k + 1, i);
        this.quad(a, b, c, d, [ua, ub, uc, ud]);
      }
    }
    for (const k of [0, profile.length - 1]) {
      const [y, , rArt] = profile[k]!;
      const flat = this.planar([0, y, rArt * 0.3]);
      for (let i = 0; i < seg; i++) this.tri([0, y, 0], point(k, i)[0], point(k, i + 1)[0], flat, flat, flat);
    }
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** 組んだ面から Mesh を作る。絵は後から読み込み、届くまでは 1 色。 */
  build(name: string, status: ArtStatus[]): Mesh {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    geo.computeVertexNormals(); // 頂点を共有していないので、面ごとの向きになる（鍛えた板の角が立つ）
    const flat = new DataTexture(new Uint8Array([...this.sheet.flat, 255]), 1, 1);
    flat.colorSpace = SRGBColorSpace;
    flat.needsUpdate = true;
    const material = new MeshLambertMaterial({ map: flat, side: DoubleSide });
    const art: ArtStatus = { loaded: false, failed: false };
    status.push(art);
    new TextureLoader().load(
      assetUrl(this.sheet.tex),
      (t) => {
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 4;
        material.map = t;
        material.needsUpdate = true;
        flat.dispose();
        art.loaded = true;
      },
      undefined,
      () => (art.failed = true),
    );
    const mesh = new Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    return mesh;
  }
}

/** 片刃の剣（断岳剣・護刃の剣）の寸法。原点は握り、+Y が刃先、-Z が刃、+Z が峰。 */
export interface SwordDims {
  /** 刃の根元（鍔の上面）の高さ */
  y0: number;
  /** 刃先（刃の側の、いちばん高い点） */
  tip: readonly [number, number];
  /** 斜めの切り落としが、峰に届く高さ */
  spineTopY: number;
  zEdge: number;
  zSpine: number;
  /** 厚みの半分 / 峰の端の厚みの半分 */
  T: number;
  TS: number;
  /** 面取りの幅: 研いだ刃 / 刃先の斜めの面 / 峰 */
  bevelEdge: number;
  bevelSlant: number;
  bevelSpine: number;
  /** 鍔から刃へ伸びる留め金（両面） */
  langet: { y1: number; halfW: number; proud: number };
  guard: { y0: number; z0: number; z1: number; halfT: number };
  /** 口金・握り・柄頭（回した形） */
  turned: readonly (readonly (readonly [number, number, number])[])[];
}

export function addSingleEdgeSword(m: ArtMesh, d: SwordDims): void {
  type YZ = [number, number];
  const A: YZ = [d.y0, d.zEdge], B: YZ = [d.tip[0], d.tip[1]], C: YZ = [d.spineTopY, d.zSpine], D: YZ = [d.y0, d.zSpine];
  // 斜めの切り落としの線を内側へずらし、平らな面の角（b, c）を求める
  const len = Math.hypot(C[0] - B[0], C[1] - B[1]);
  const dir: YZ = [(C[0] - B[0]) / len, (C[1] - B[1]) / len];
  const inward: YZ = [-dir[1], dir[0]];
  const o: YZ = [B[0] + inward[0] * d.bevelSlant, B[1] + inward[1] * d.bevelSlant];
  const onSlant = (z: number): YZ => [o[0] + (dir[0] * (z - o[1])) / dir[1], z];
  const a: YZ = [d.y0, d.zEdge + d.bevelEdge], b = onSlant(d.zEdge + d.bevelEdge), c = onSlant(d.zSpine - d.bevelSpine), dd: YZ = [d.y0, d.zSpine - d.bevelSpine];
  const at = (q: YZ, x: number): P3 => [x, q[0], q[1]];
  for (const s of [-1, 1]) {
    m.quad(at(a, s * d.T), at(b, s * d.T), at(c, s * d.T), at(dd, s * d.T)); // 平らな面
    m.quad(at(A, 0), at(B, 0), at(b, s * d.T), at(a, s * d.T)); // 研いだ刃
    m.quad(at(B, 0), at(C, s * d.TS), at(c, s * d.T), at(b, s * d.T)); // 刃先の斜めの面
    m.quad(at(C, s * d.TS), at(D, s * d.TS), at(dd, s * d.T), at(c, s * d.T)); // 峰の面取り
  }
  m.quad(at(C, d.TS), at(C, -d.TS), at(D, -d.TS), at(D, d.TS)); // 峰
  m.tri(at(B, 0), at(C, -d.TS), at(C, d.TS)); // 刃先の斜めの端
  m.box(-d.T - d.langet.proud, d.T + d.langet.proud, d.y0, d.langet.y1, -d.langet.halfW, d.langet.halfW);
  m.box(-d.guard.halfT, d.guard.halfT, d.guard.y0, d.y0, d.guard.z0, d.guard.z1);
  for (const profile of d.turned) m.lathe(profile);
}
