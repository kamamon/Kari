// 拠点「灯継ぎの里」の仮の見た目（v0.12.0）。施設の位置と当たりは public/data/hub.json と maps/hub_village.json が正本で、ここは描くだけ。
// 建物はどれも、箱と柱と屋根を組んだ仮の形（設定図は無い）。正式な絵が来たら差し替える。
import {
  BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, RingGeometry,
} from 'three';
import type { FacilityDef, HubDef, MapDef } from '../data/schemas';
import { buildAreaGroup, mergeStatic } from './arena';

const M = {
  stone: new MeshLambertMaterial({ color: 0x8b8d82, flatShading: true }),
  stoneDark: new MeshLambertMaterial({ color: 0x5f645b, flatShading: true }),
  wood: new MeshLambertMaterial({ color: 0x7a5a3c, flatShading: true }),
  woodDark: new MeshLambertMaterial({ color: 0x4f3a28, flatShading: true }),
  roof: new MeshLambertMaterial({ color: 0x4d5a4c, flatShading: true }),
  cloth: new MeshLambertMaterial({ color: 0xd4c9a8, flatShading: true, side: DoubleSide }),
  clothRed: new MeshLambertMaterial({ color: 0x9c4a36, flatShading: true, side: DoubleSide }),
  bronze: new MeshLambertMaterial({ color: 0xb08d57, emissive: 0x2a1d08, flatShading: true }),
  iron: new MeshLambertMaterial({ color: 0x3c4140, flatShading: true }),
  ember: new MeshBasicMaterial({ color: 0xff9a4a }),
  lamp: new MeshBasicMaterial({ color: 0xffd98a }),
  paper: new MeshLambertMaterial({ color: 0xe9e2c8, side: DoubleSide }),
  plaza: new MeshLambertMaterial({ color: 0xa79f84 }),
  ring: new MeshBasicMaterial({ color: 0xd9b46a, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide }),
};

function box(g: Group, mat: MeshLambertMaterial | MeshBasicMaterial, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function post(g: Group, mat: MeshLambertMaterial, r: number, h: number, x: number, z: number): void {
  const m = new Mesh(new CylinderGeometry(r, r * 1.15, h, 6), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  g.add(m);
}

/** 切妻の屋根（幅 w・奥行 d・高さ h。棟は x 方向）。 */
function gable(g: Group, mat: MeshLambertMaterial, w: number, d: number, h: number, y: number, z = 0): void {
  const slope = Math.hypot(d / 2, h);
  for (const s of [-1, 1]) {
    const p = new Mesh(new BoxGeometry(w, 0.18, slope + 0.3), mat);
    p.position.set(0, y + h / 2, z + (s * d) / 4);
    p.rotation.x = s * Math.atan2(h, d / 2);
    p.castShadow = true;
    g.add(p);
  }
}

/** 工房: 石の小屋、煙突（火の色）、前に金床と炉。 */
function workshop(): Group {
  const g = new Group();
  box(g, M.stone, 6.2, 3.0, 4.6, 0, 1.5, -0.6);
  gable(g, M.roof, 6.8, 5.4, 1.5, 3.0, -0.6);
  box(g, M.stoneDark, 1.1, 5.4, 1.1, 2.0, 2.7, -1.6);
  const fire = new Mesh(new IcosahedronGeometry(0.34, 0), M.ember);
  fire.position.set(2.0, 5.5, -1.6);
  g.add(fire);
  // 入口（暗い口）と、青銅色の看板（槌の形）
  box(g, M.iron, 1.6, 2.2, 0.12, -1.2, 1.1, 1.72);
  box(g, M.bronze, 0.16, 0.9, 0.12, 1.3, 2.3, 1.76);
  box(g, M.bronze, 0.7, 0.34, 0.14, 1.3, 2.75, 1.76);
  // 炉と金床
  box(g, M.stoneDark, 1.3, 1.0, 1.1, 2.3, 0.5, 2.9);
  const glow = new Mesh(new BoxGeometry(0.8, 0.18, 0.7), M.ember);
  glow.position.set(2.3, 1.02, 2.9);
  g.add(glow);
  box(g, M.woodDark, 0.5, 0.6, 0.5, 0.2, 0.3, 3.0);
  box(g, M.iron, 0.9, 0.24, 0.34, 0.2, 0.72, 3.0);
  return g;
}

/** 商店: 木の屋台。縞の日よけ、台、樽と木箱。 */
function shop(): Group {
  const g = new Group();
  box(g, M.wood, 5.6, 2.6, 3.4, 0, 1.3, -1.2);
  gable(g, M.roof, 6.2, 4.2, 1.1, 2.6, -1.2);
  // 台と、前へ張り出した日よけ（生成りと赤の縞）
  box(g, M.woodDark, 4.6, 1.0, 0.9, 0, 0.5, 1.2);
  for (const x of [-2.5, 2.5]) post(g, M.woodDark, 0.09, 2.5, x, 2.3);
  for (let i = 0; i < 6; i++) {
    const strip = new Mesh(new PlaneGeometry(0.92, 2.5), i % 2 ? M.clothRed : M.cloth);
    strip.position.set(-2.3 + i * 0.92, 2.72, 1.3);
    strip.rotation.x = -Math.PI / 2 + 0.2;
    g.add(strip);
  }
  // 品物: 瓶（回復液の色）と石、樽、木箱
  for (let i = 0; i < 4; i++) {
    const b = new Mesh(new CylinderGeometry(0.1, 0.13, 0.34, 6), new MeshLambertMaterial({ color: i % 2 ? 0x6fae8a : 0x9fb4dc, flatShading: true }));
    b.position.set(-1.5 + i * 0.5, 1.17, 1.2);
    g.add(b);
  }
  box(g, M.stoneDark, 0.4, 0.16, 0.28, 1.4, 1.08, 1.2, 0.3);
  const barrel = new Mesh(new CylinderGeometry(0.5, 0.5, 1.1, 8), M.wood);
  barrel.position.set(3.4, 0.55, 0.9);
  barrel.castShadow = true;
  g.add(barrel);
  box(g, M.woodDark, 0.9, 0.9, 0.9, -3.3, 0.45, 1.0, 0.2);
  box(g, M.wood, 0.7, 0.7, 0.7, -3.2, 1.25, 1.0, -0.3);
  return g;
}

/** 依頼板: 2 本の柱に板、小さな屋根、貼り紙。 */
function board(): Group {
  const g = new Group();
  for (const x of [-1.3, 1.3]) post(g, M.woodDark, 0.12, 2.9, x, 0);
  box(g, M.wood, 2.9, 1.6, 0.14, 0, 1.75, 0);
  gable(g, M.roof, 3.4, 1.4, 0.4, 2.85, 0);
  const notes: [number, number, number][] = [[-0.85, 2.05, 0.1], [-0.1, 1.6, -0.12], [0.75, 2.0, 0.06], [0.5, 1.35, -0.05], [-0.7, 1.35, 0.14]];
  for (const [x, y, r] of notes) {
    const n = new Mesh(new PlaneGeometry(0.52, 0.62), M.paper);
    n.position.set(x, y, 0.09);
    n.rotation.z = r;
    g.add(n);
  }
  box(g, M.bronze, 0.5, 0.12, 0.05, 0, 2.48, 0.1);
  return g;
}

/** 装備箱: 天幕の下の、大きな箱と武器立て。 */
function chest(): Group {
  const g = new Group();
  const tent = new Mesh(new ConeGeometry(2.6, 2.6, 4, 1, true), M.cloth);
  tent.position.set(0, 2.9, -0.3);
  tent.rotation.y = Math.PI / 4;
  tent.castShadow = true;
  g.add(tent);
  for (const [x, z] of [[-1.8, -2.1], [1.8, -2.1], [-1.8, 1.5], [1.8, 1.5]] as const) post(g, M.woodDark, 0.08, 1.7, x, z);
  box(g, M.wood, 1.9, 0.9, 1.1, 0, 0.45, 0.2);
  box(g, M.woodDark, 2.0, 0.26, 1.2, 0, 1.03, 0.2);
  box(g, M.bronze, 0.22, 0.3, 0.08, 0, 0.82, 0.78);
  // 武器立て（棒が 3 本）
  box(g, M.woodDark, 1.6, 0.1, 0.1, 0, 1.2, -1.5);
  for (const x of [-0.5, 0, 0.5]) box(g, M.iron, 0.07, 1.7, 0.07, x, 0.85, -1.45).rotation.x = -0.16;
  return g;
}

const BUILDERS: Record<FacilityDef['kind'], () => Group> = { workshop, shop, quest: board, chest };

/**
 * 里の地形と建物。施設の前（立つ場所）には、青銅色の輪を置く。
 * 外周の岩壁・草・遠くの山は、狩場と同じ作り（buildAreaGroup）。
 */
export function buildHubGroup(hub: HubDef, map: MapDef): Group {
  // 建物の当たり（rocks）は、岩としては描かない
  const g = buildAreaGroup({ bounds: map.bounds, rocks: map.rocks, platforms: map.platforms, drawRocks: false, kind: 'camp', seed: 7001, gates: [{ x: 0, z: map.bounds.minZ + 2, marker: true }] });
  // 広場（踏み固めた地面）
  const plaza = new Mesh(new CircleGeometry(9.5, 28), M.plaza);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.012, 1);
  plaza.receiveShadow = true;
  g.add(plaza);
  for (const f of hub.facilities) {
    const b = BUILDERS[f.kind]();
    b.position.set(f.building.x, 0, f.building.z);
    b.rotation.y = f.building.yaw;
    g.add(b);
    const ring = new Mesh(new RingGeometry(f.r * 0.5 - 0.09, f.r * 0.5, 28), M.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(f.x, 0.03, f.z);
    ring.renderOrder = 1;
    g.add(ring);
  }
  // 広場の灯（当たりは、施設の建物の次の rocks）
  const lampAt = map.rocks[hub.facilities.length];
  if (lampAt) {
    post(g, M.woodDark, 0.13, 3.0, lampAt.x, lampAt.z);
    const lamp = new Mesh(new IcosahedronGeometry(0.3, 0), M.lamp);
    lamp.position.set(lampAt.x, 3.2, lampAt.z);
    g.add(lamp);
  }
  // 同じ素材の部品を 1 つにまとめる（描画回数を減らす）
  mergeStatic(g);
  return g;
}
