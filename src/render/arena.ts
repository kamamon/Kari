// 戦闘区画の仮の見た目。地形の形と寸法はマップデータ（public/data/maps と public/data/fields）が正本で、ここはそれを描くだけ。
// 灰緑の草と岩、青銅色の鉱脈、霧。正式な環境素材が来たら差し替える。
// フィールドでは、エリアごとに 1 つの Group を作る（setupSky で空と光を 1 回だけ用意し、buildAreaGroup をエリアの数だけ呼ぶ）。
import {
  BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, Scene, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRng } from '../core/seededRng';
import type { MapDef } from '../data/schemas';

export const FOG_COLOR = 0xaebcab;

let groundCanvas: HTMLCanvasElement | null = null;

function groundTexture(): CanvasTexture {
  if (groundCanvas) {
    const t = new CanvasTexture(groundCanvas);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = SRGBColorSpace;
    return t;
  }
  const c = document.createElement('canvas');
  groundCanvas = c;
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7f8f72';
  g.fillRect(0, 0, 256, 256);
  const rng = new SeededRng(4242);
  // 草むらの濃淡と小石。移動した時に地面が流れて見えるよう、細かな模様を入れる。
  for (let i = 0; i < 900; i++) {
    const x = rng.next() * 256;
    const y = rng.next() * 256;
    const r = 2 + rng.next() * 9;
    const tone = rng.next();
    g.fillStyle = tone < 0.45 ? 'rgba(98,116,88,0.35)' : tone < 0.8 ? 'rgba(146,160,126,0.3)' : 'rgba(120,118,104,0.35)';
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rng.next() * 0.6), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rng.next() < 0.5 ? 'rgba(60,72,58,0.5)' : 'rgba(190,186,160,0.45)';
    g.fillRect(rng.next() * 256, rng.next() * 256, 1.5, 1.5 + rng.next() * 3);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface Arena {
  group: Group;
  sun: DirectionalLight;
}

/** 1 つのエリアの見た目に要るもの（形は MapDef / FieldAreaDef と同じ）。 */
export interface AreaLook {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  rocks: { x: number; z: number; r: number; h: number }[];
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[];
  /** 天幕を置く場所（無ければ置かない） */
  camp?: { x: number; z: number; r: number } | null;
  /** 外周の岩壁を開ける場所。marker が付いたものは、出口の目印（門柱と踏み跡）も置く */
  gates?: { x: number; z: number; marker?: boolean }[];
  /** 種類。path は地面が乾いた色、nest は晶の柱が立つ */
  kind?: 'camp' | 'hunt' | 'path' | 'nest';
  /** 草や岩壁の散らし方の種（エリアごとに変える） */
  seed?: number;
}

/** これまでの狩場（エリアが 1 つ）: 空と光を用意して、狩場を描く。 */
export function buildArena(scene: Scene, map: MapDef, shadows: boolean): Arena {
  const sun = setupSky(scene, shadows);
  // キャンプ側の出入口だけ開ける（見た目のみ。衝突は外周で止まる）
  const group = buildAreaGroup({ bounds: map.bounds, rocks: map.rocks, platforms: map.platforms, camp: map.camp, gates: [{ x: map.camp.x, z: map.bounds.minZ }] });
  scene.add(group);
  return { group, sun };
}

/** 空の色・霧・光。シーンに 1 回だけ。 */
export function setupSky(scene: Scene, shadows: boolean): DirectionalLight {
  scene.background = new Color(FOG_COLOR);
  scene.fog = new Fog(FOG_COLOR, 38, 150);

  const hemi = new HemisphereLight(0xe6efe2, 0x56624f, 1.15);
  const sun = new DirectionalLight(0xfff0d2, 1.9);
  sun.position.set(-28, 46, -22);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    cam.left = -16;
    cam.right = 16;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 1;
    cam.far = 120;
    sun.shadow.bias = -0.0008;
  }
  scene.add(hemi, sun, sun.target);
  return sun;
}

const GROUND_TINT = { camp: 0xffffff, hunt: 0xffffff, path: 0xe9dcc6, nest: 0xd6e0e2 } as const;

/** エリア 1 つぶんの地形（地面・岩・段差・外周の岩壁・遠くの山・草）。シーンへは呼んだ側が足す。 */
export function buildAreaGroup(map: AreaLook): Group {
  const group = new Group();
  const rng = new SeededRng(map.seed ?? 9001);
  const b = map.bounds;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const gates = map.gates ?? [];

  const tex = groundTexture();
  tex.repeat.set((w + 60) / 6, (d + 60) / 6);
  const ground = new Mesh(new PlaneGeometry(w + 60, d + 60), new MeshLambertMaterial({ map: tex, color: GROUND_TINT[map.kind ?? 'hunt'] }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  group.add(ground);

  const rockMat = new MeshLambertMaterial({ color: 0x8b8d82, flatShading: true });
  const rockDark = new MeshLambertMaterial({ color: 0x6e7268, flatShading: true });
  const bronze = new MeshLambertMaterial({ color: 0xb08d57, emissive: 0x2a1d08, flatShading: true });
  const stepMat = new MeshLambertMaterial({ color: 0x9b9c8c, flatShading: true });
  const stepTop = new MeshLambertMaterial({ color: 0x8d9a7c, flatShading: true });

  // 岩（円柱として衝突する。見た目は半径に合わせた多面体）
  for (const r of map.rocks) {
    const m = new Mesh(new IcosahedronGeometry(1, 1), rng.next() < 0.5 ? rockMat : rockDark);
    m.scale.set(r.r * 1.04, r.h * 0.62, r.r * 1.04);
    m.position.set(r.x, r.h * 0.45, r.z);
    m.rotation.y = rng.next() * 6.28;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    const cap = new Mesh(new IcosahedronGeometry(1, 0), rockMat);
    cap.scale.set(r.r * 0.6, r.h * 0.35, r.r * 0.6);
    cap.position.set(r.x + (rng.next() - 0.5) * r.r * 0.5, r.h * 0.8, r.z + (rng.next() - 0.5) * r.r * 0.5);
    cap.rotation.set(rng.next(), rng.next() * 6, rng.next());
    cap.castShadow = true;
    group.add(cap);
    if (rng.next() < 0.6) {
      const vein = new Mesh(new BoxGeometry(0.12, r.h * 0.7, 0.3), bronze);
      const a = rng.next() * 6.28;
      vein.position.set(r.x + Math.cos(a) * r.r * 0.93, r.h * 0.4, r.z + Math.sin(a) * r.r * 0.93);
      vein.rotation.set(0.3, -a, 0.2);
      group.add(vein);
    }
  }

  // 段差
  for (const p of map.platforms) {
    const box = new Mesh(new BoxGeometry(p.maxX - p.minX, p.h, p.maxZ - p.minZ), [stepMat, stepMat, stepTop, stepMat, stepMat, stepMat]);
    box.position.set((p.minX + p.maxX) / 2, p.h / 2, (p.minZ + p.maxZ) / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
  }

  // 外周の岩壁
  const wall = (x: number, z: number, sx: number, sz: number): void => {
    const h = 4 + rng.next() * 4.5;
    const m = new Mesh(new BoxGeometry(sx, h, sz), rng.next() < 0.5 ? rockMat : rockDark);
    m.position.set(x, h / 2 - 0.3, z);
    m.rotation.set((rng.next() - 0.5) * 0.12, (rng.next() - 0.5) * 0.25, (rng.next() - 0.5) * 0.12);
    group.add(m);
  };
  // 出入口の所だけ、壁を開ける（見た目のみ。衝突は外周で止まり、出口は simulation が扱う）
  const open = (x: number, z: number, alongX: boolean): boolean => gates.some((g) => (alongX ? Math.abs(g.z - z) < 5 && Math.abs(g.x - x) < 4 : Math.abs(g.x - x) < 5 && Math.abs(g.z - z) < 4));
  const seg = 5;
  for (let x = b.minX; x < b.maxX; x += seg) {
    if (!open(x + seg / 2, b.minZ, true)) wall(x + seg / 2, b.minZ - 2.2, seg + 1.2, 4.5);
    if (!open(x + seg / 2, b.maxZ, true)) wall(x + seg / 2, b.maxZ + 2.2, seg + 1.2, 4.5);
  }
  for (let z = b.minZ; z < b.maxZ; z += seg) {
    if (!open(b.minX, z + seg / 2, false)) wall(b.minX - 2.2, z + seg / 2, 4.5, seg + 1.2);
    if (!open(b.maxX, z + seg / 2, false)) wall(b.maxX + 2.2, z + seg / 2, 4.5, seg + 1.2);
  }

  // 出口の目印: 踏み跡（明るい地面）と、両脇の門柱。柱の頭は青銅色
  const trail = new MeshLambertMaterial({ color: 0xa79f84 });
  for (const g of gates) {
    if (!g.marker) continue;
    // 外向き（エリアの中心から出口へ）
    const ox = Math.abs(g.x - b.minX) < 5 ? -1 : Math.abs(g.x - b.maxX) < 5 ? 1 : 0;
    const oz = ox !== 0 ? 0 : g.z < cz ? -1 : 1;
    const path = new Mesh(new PlaneGeometry(ox !== 0 ? 16 : 5.4, ox !== 0 ? 5.4 : 16), trail);
    path.rotation.x = -Math.PI / 2;
    path.position.set(g.x + ox * 2, 0.015, g.z + oz * 2);
    path.receiveShadow = true;
    group.add(path);
    for (const s of [-1, 1]) {
      const px = g.x + ox * 2.3 + (ox !== 0 ? 0 : s * 3.1), pz = g.z + oz * 2.3 + (ox !== 0 ? s * 3.1 : 0);
      const post = new Mesh(new CylinderGeometry(0.42, 0.6, 3.4, 6), rockDark);
      post.position.set(px, 1.7, pz);
      post.castShadow = true;
      const cap = new Mesh(new ConeGeometry(0.5, 0.7, 6), bronze);
      cap.position.set(px, 3.75, pz);
      group.add(post, cap);
    }
  }

  // 遠景の山
  const far = new MeshBasicMaterial({ color: 0x93a595, fog: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng.next() * 0.2;
    const r = 105 + rng.next() * 25;
    const h = 22 + rng.next() * 30;
    const m = new Mesh(new ConeGeometry(18 + rng.next() * 16, h, 5), far);
    m.position.set(cx + Math.cos(a) * r, h / 2 - 2, cz + Math.sin(a) * r);
    m.rotation.y = rng.next() * 6;
    group.add(m);
  }

  // 巣: 壁ぎわに、晶の柱が立つ
  if (map.kind === 'nest') {
    const crystal = new MeshLambertMaterial({ color: 0xc9a86a, emissive: 0x5a3c12, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const side = i % 4;
      const t = rng.next();
      const x = side < 2 ? b.minX + t * w : side === 2 ? b.minX + 0.6 + rng.next() * 2.2 : b.maxX - 0.6 - rng.next() * 2.2;
      const z = side === 0 ? b.minZ + 0.6 + rng.next() * 2.2 : side === 1 ? b.maxZ - 0.6 - rng.next() * 2.2 : b.minZ + t * d;
      if (gates.some((g) => Math.hypot(g.x - x, g.z - z) < 7)) continue;
      const h = 1.4 + rng.next() * 3.2;
      const c = new Mesh(new ConeGeometry(0.28 + rng.next() * 0.3, h, 5), crystal);
      c.position.set(x, h / 2 - 0.1, z);
      c.rotation.set((rng.next() - 0.5) * 0.5, rng.next() * 6, (rng.next() - 0.5) * 0.5);
      group.add(c);
    }
  }

  // キャンプ: 天幕と灯
  if (map.camp) addCamp(group, map.camp, rockDark);

  // 草と小石（1 回の描画にまとめる）
  const blocked = (x: number, z: number): boolean => map.rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.r + 0.3) || map.platforms.some((p) => x > p.minX - 0.3 && x < p.maxX + 0.3 && z > p.minZ - 0.3 && z < p.maxZ + 0.3);
  const tuftGeo = new ConeGeometry(0.09, 0.3, 4);
  tuftGeo.translate(0, 0.15, 0);
  const tufts = new InstancedMesh(tuftGeo, new MeshLambertMaterial({ color: 0x6f8562, flatShading: true }), 1400);
  const stones = new InstancedMesh(new IcosahedronGeometry(0.16, 0), rockMat, 220);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const place = (mesh: InstancedMesh, count: number, minS: number, maxS: number, tilt: number): void => {
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < count * 6) {
      const x = b.minX + rng.next() * w;
      const z = b.minZ + rng.next() * d;
      if (blocked(x, z)) continue;
      const s = minS + rng.next() * (maxS - minS);
      q.setFromAxisAngle(up, rng.next() * 6.28);
      if (tilt) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (rng.next() - 0.5) * tilt));
      m4.compose(new Vector3(x, 0, z), q, new Vector3(s, s * (0.6 + rng.next() * 0.7), s));
      mesh.setMatrixAt(n++, m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(tufts, 1400, 0.5, 1.15, 0.6);
  place(stones, 220, 0.4, 1.3, 2);
  group.add(tufts, stones);

  mergeStatic(group);
  return group;
}

function addCamp(group: Group, at: { x: number; z: number; r: number }, rockDark: MeshLambertMaterial): void {
  const camp = new Group();
  camp.position.set(at.x, 0, at.z);

  const tent = new Mesh(new ConeGeometry(2.1, 2.6, 4), new MeshLambertMaterial({ color: 0xd4c9a8, flatShading: true }));
  tent.position.set(-3.2, 1.3, -0.4);
  tent.rotation.y = Math.PI / 4;
  tent.castShadow = true;
  const post = new Mesh(new CylinderGeometry(0.06, 0.08, 2.2, 6), rockDark);
  post.position.set(2.4, 1.1, 0.2);
  const lamp = new Mesh(new IcosahedronGeometry(0.2, 0), new MeshBasicMaterial({ color: 0xffd98a }));
  lamp.position.set(2.4, 2.3, 0.2);
  const mat = new Mesh(new CircleGeometry(at.r, 20), new MeshLambertMaterial({ color: 0x8c8468 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.02;
  camp.add(tent, post, lamp, mat);
  group.add(camp);
}

/**
 * 動かない地形を、同じ素材ごとに 1 つのメッシュへまとめる（描画回数を減らす）。
 * 素材を 1 つだけ持つ通常のメッシュが対象。地面・段差（複数素材）・InstancedMesh はそのまま残す。
 */
function mergeStatic(group: Group): void {
  group.updateMatrixWorld(true);
  const buckets = new Map<MeshLambertMaterial | MeshBasicMaterial, Mesh[]>();
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    const mat = m.material as MeshLambertMaterial | MeshBasicMaterial;
    if ((mat as MeshLambertMaterial).map || mat.transparent) return;
    const list = buckets.get(mat) ?? [];
    list.push(m);
    buckets.set(mat, list);
  });
  for (const [mat, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geos = meshes.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      // 属性を position / normal だけに揃える（形状ごとに uv の有無が違うとまとめられない）
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const g of geos) g.dispose();
    group.add(mesh);
  }
}

/** 足元の丸い影（影描画を切っている端末でも接地が分かるように）。 */
export function blobShadow(radius: number): Object3D {
  const m = new Mesh(new CircleGeometry(radius, 16), new MeshBasicMaterial({ color: 0x1a211c, transparent: true, opacity: 0.32, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
