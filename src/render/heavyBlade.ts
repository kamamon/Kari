// 断岳剣（里鍛ちの断岳剣）の仮モデル（2 代目）。設定図（art-source/weapon/weapon_dangaku_{front,side}_v1.png）の
// 輪郭を測った寸法で形を組み、正面の図をそのまま両面へ貼る。コードで組んだ仮素材で、正式モデル（GLB）の差し替え口。
// 原点は握り位置、+Y が刃先、X が厚み、Z が刃幅（-Z が刃、+Z が峰）。単位 m。
// 当たり判定（握りから 0.30〜1.75m、半径 0.20m）は変えていない。刃は 0.33〜1.795m、幅 0.33m。
import { BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, SRGBColorSpace, TextureLoader } from 'three';
import { assetUrl } from '../core/assets';

const TEX = 'assets/textures/weapons/dangaku_v1.webp';

/** 設定図の切り出し範囲（px）と縮尺。tools/art/weapon_bake.py と同じ値にする。 */
const ART = { x0: 392, y0: 40, w: 300, h: 1332, cx: 542, bottom: 1359, mPerPx: 1.95 / 1304, yOffset: 0.155 };

export interface HeavyBladeModel {
  group: Group;
  /** 設定図から作った絵の読み込みが終わったか / 失敗したか */
  art: { loaded: boolean; failed: boolean };
  triangles: number;
}

type P3 = [number, number, number];
type UV = [number, number];

export function buildHeavyBlade(): HeavyBladeModel {
  const pos: number[] = [];
  const uv: number[] = [];
  /** 正面の図へまっすぐ写す（高さ y と刃幅方向 z から、絵の位置を決める） */
  const planar = (p: P3): UV => {
    const px = p[2] / ART.mPerPx + ART.cx;
    const py = ART.bottom - (p[1] + ART.yOffset) / ART.mPerPx;
    return [(px - ART.x0) / ART.w, 1 - (py - ART.y0) / ART.h];
  };
  const tri = (a: P3, b: P3, c: P3, ua = planar(a), ub = planar(b), uc = planar(c)): void => {
    pos.push(...a, ...b, ...c);
    uv.push(...ua, ...ub, ...uc);
  };
  const quad = (a: P3, b: P3, c: P3, d: P3, u?: [UV, UV, UV, UV]): void => {
    tri(a, b, c, u?.[0], u?.[1], u?.[2]);
    tri(a, c, d, u?.[0], u?.[2], u?.[3]);
  };
  const boxAt = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    const v = (x: number, y: number, z: number): P3 => [x, y, z];
    quad(v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), v(x0, y0, z0)); // -X（設定図の正面）
    quad(v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)); // +X
    quad(v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0)); // 上
    quad(v(x0, y0, z1), v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1)); // 下
    quad(v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)); // -Z
    quad(v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), v(x0, y0, z1)); // +Z
  };
  /**
   * 回した形（握り・柄頭など）。profile は [高さ, 半径, 設定図での半幅]。
   * 絵は、正面から見えている幅を前半周へ引き伸ばして貼り、後ろ半周はその鏡写しにする（巻き革の模様が横でつぶれない）。
   */
  const lathe = (profile: [number, number, number][], seg = 12): void => {
    const point = (k: number, i: number): [P3, UV] => {
      const [y, r, rArt] = profile[k]!;
      const phi = -Math.PI + (2 * Math.PI * i) / seg; // 0 が設定図の正面（-X）
      const fold = Math.abs(phi) <= Math.PI / 2 ? phi : Math.sign(phi) * (Math.PI - Math.abs(phi));
      const p: P3 = [-r * Math.cos(phi), y, r * Math.sin(phi)];
      return [p, planar([0, y, rArt * 0.92 * (fold / (Math.PI / 2))])];
    };
    for (let k = 0; k < profile.length - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const [a, ua] = point(k, i), [b, ub] = point(k, i + 1), [c, uc] = point(k + 1, i + 1), [d, ud] = point(k + 1, i);
        quad(a, b, c, d, [ua, ub, uc, ud]);
      }
    }
    // 両端のふた
    for (const k of [0, profile.length - 1]) {
      const [y, , rArt] = profile[k]!;
      const centre: P3 = [0, y, 0];
      for (let i = 0; i < seg; i++) {
        const [a] = point(k, i), [b] = point(k, i + 1);
        const flat = planar([0, y, rArt * 0.3]);
        tri(centre, a, b, flat, flat, flat);
      }
    }
  };

  // ---- 刃: 片刃。峰（+Z）が厚く、刃（-Z）へ向かって薄くなる。刃先は、刃の側が高い斜めの切り落とし。----
  const T = 0.022; // 厚みの半分（設定図の真横: 約 4.4cm）
  const TS = 0.015; // 峰の端の厚みの半分
  const Y0 = 0.331; // 鍔の上面
  const A: [number, number] = [Y0, -0.166], B: [number, number] = [1.795, -0.155], C: [number, number] = [1.559, 0.163], D: [number, number] = [Y0, 0.163];
  const a: [number, number] = [Y0, -0.13], b: [number, number] = [1.747, -0.13], c: [number, number] = [1.538, 0.151], d: [number, number] = [Y0, 0.151];
  const at = (q: [number, number], x: number): P3 => [x, q[0], q[1]];
  for (const s of [-1, 1]) {
    quad(at(a, s * T), at(b, s * T), at(c, s * T), at(d, s * T)); // 平らな面
    quad(at(A, 0), at(B, 0), at(b, s * T), at(a, s * T)); // 研いだ刃
    quad(at(B, 0), at(C, s * TS), at(c, s * T), at(b, s * T)); // 刃先の斜めの面
    quad(at(C, s * TS), at(D, s * TS), at(d, s * T), at(c, s * T)); // 峰の面取り
  }
  quad(at(C, TS), at(C, -TS), at(D, -TS), at(D, TS)); // 峰
  tri(at(B, 0), at(C, -TS), at(C, TS)); // 刃先の斜めの端

  // ---- 留め金（鍔から刃へ伸びる板。両面）、鍔、口金、握り、柄頭 ----
  boxAt(-T - 0.006, T + 0.006, Y0, 0.435, -0.037, 0.037);
  boxAt(-0.034, 0.034, 0.28, Y0, -0.199, 0.202);
  lathe([[0.234, 0.04, 0.04], [0.279, 0.05, 0.052]]);
  lathe([[-0.091, 0.036, 0.04], [0.234, 0.036, 0.04]]);
  lathe([[-0.155, 0.03, 0.03], [-0.143, 0.048, 0.05], [-0.097, 0.048, 0.05], [-0.091, 0.042, 0.044]]);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); // 頂点を共有していないので、面ごとの向きになる（鍛えた板の角が立つ）

  // 絵が届くまでは、鉄の色 1 色
  const flat = new DataTexture(new Uint8Array([122, 118, 108, 255]), 1, 1);
  flat.colorSpace = SRGBColorSpace;
  flat.needsUpdate = true;
  const material = new MeshLambertMaterial({ map: flat, side: DoubleSide });
  const art = { loaded: false, failed: false };
  new TextureLoader().load(
    assetUrl(TEX),
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
  mesh.name = 'heavy_blade_body';
  mesh.castShadow = true;
  const group = new Group();
  group.name = 'model.weapon.heavy_blade.001';
  group.add(mesh);
  return { group, art, triangles: pos.length / 9 };
}
