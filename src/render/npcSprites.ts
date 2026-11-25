// 里に立つ人（v0.23.0）。ChatGPT の追加原画（鍛冶・商店の正面と背面）と、受付ミナギの設定図を、切り抜いた板に貼って立てる。
// 板はいつもカメラの方を向き（縦の軸で回る）、カメラが人の後ろ側に回ると背面の絵に替える（背面の絵が無い人は、正面のまま）。
// 位置と向きと当たりは public/data/hub.json の npcs と maps/hub_village.json の rocks が正本で、ここは描くだけ。
import { BufferAttribute, DoubleSide, Group, Mesh, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, type Vector3 } from 'three';
import { assetUrl } from '../core/assets';
import type { HubNpcDef } from '../data/schemas';
import { groundAt } from '../game/world';
import { blobShadow } from './arena';
import { NPC_ART, type NpcSide } from './npcArt';

/** 絵の明るさ（光の式で暗くなるぶんを持ち上げる。建物は 1.3） */
const NPC_GAIN = 1.2;

const loader = new TextureLoader();
const mats = new Map<string, MeshLambertMaterial>();

function sideMaterial(side: NpcSide): MeshLambertMaterial {
  let m = mats.get(side.file);
  if (m) return m;
  const mat = new MeshLambertMaterial({ alphaTest: 0.5, side: DoubleSide });
  mat.color.setScalar(NPC_GAIN);
  // 絵が届くまでは描かない（板の四角が見えないように）
  mat.visible = false;
  mat.userData.uv = true;
  mat.userData.npc = side.file;
  if (typeof document !== 'undefined') {
    loader.load(assetUrl(`assets/textures/npc/${side.file}.webp`), (t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      mat.map = t;
      mat.visible = true;
      mat.needsUpdate = true;
    });
  }
  mats.set(side.file, mat);
  return mat;
}

/** 板の形: 足の裏が y = 0、頭の上が背丈。法線は、上と手前の間（光の当たり方を、向きで大きく変えない） */
function plane(height: number, side: NpcSide): PlaneGeometry {
  const h = height / Math.max(0.5, 1 - side.foot - side.head);
  const w = h * side.aspect;
  const g = new PlaneGeometry(w, h);
  g.translate(0, h / 2 - side.foot * h - 0.015, 0);
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.6, 0.8);
  n.needsUpdate = true;
  return g;
}

interface NpcSprite {
  def: HubNpcDef;
  mesh: Mesh;
  front: { geo: PlaneGeometry; mat: MeshLambertMaterial };
  back: { geo: PlaneGeometry; mat: MeshLambertMaterial } | null;
  showingBack: boolean;
}

/** 里の人の板と、足もとの影。group.userData.npcs に、向きを替えるための情報を持たせる */
export function buildNpcSprites(npcs: readonly HubNpcDef[], platforms: Parameters<typeof groundAt>[0] = []): Group {
  const g = new Group();
  g.name = 'npcs';
  const list: NpcSprite[] = [];
  for (const def of npcs) {
    const art = NPC_ART[def.art];
    if (!art) continue;
    const front = { geo: plane(art.height, art.front), mat: sideMaterial(art.front) };
    const back = art.back ? { geo: plane(art.height, art.back), mat: sideMaterial(art.back) } : null;
    const mesh = new Mesh(front.geo, front.mat);
    // 足の裏は、立つ場所の床の高さ（v0.31.0。工房のロクハは下の段）
    const floor = groundAt(platforms, def.x, def.z);
    mesh.position.set(def.x, floor, def.z);
    mesh.rotation.y = def.yaw;
    mesh.userData.npc = def.id;
    mesh.renderOrder = 2;
    const shadow = blobShadow(0.42);
    shadow.position.set(def.x, floor + 0.02, def.z);
    g.add(mesh, shadow);
    list.push({ def, mesh, front, back, showingBack: false });
  }
  g.userData.npcs = list;
  return g;
}

/** 毎フレーム: 板をカメラの方へ向け、カメラが後ろ側なら背面の絵に替える（境目で揺れないよう、少し余裕を持たせる） */
export function updateNpcSprites(g: Group, camera: Vector3): void {
  const list = g.userData.npcs as NpcSprite[] | undefined;
  if (!list) return;
  for (const s of list) {
    const dx = camera.x - s.def.x, dz = camera.z - s.def.z;
    const len = Math.hypot(dx, dz) || 1;
    s.mesh.rotation.y = Math.atan2(dx, dz);
    if (!s.back) continue;
    const facing = (Math.sin(s.def.yaw) * dx + Math.cos(s.def.yaw) * dz) / len;
    const back = s.showingBack ? facing < 0.1 : facing < -0.1;
    if (back !== s.showingBack) {
      s.showingBack = back;
      const side = back ? s.back : s.front;
      s.mesh.geometry = side.geo;
      s.mesh.material = side.mat;
    }
  }
}
