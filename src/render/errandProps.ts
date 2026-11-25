// 狩らない依頼（v0.27.0）の採取点と納品箱を描く。位置・採った状態は simulation（sim.errand）が正本で、ここは読むだけ。
// 採取点は、ChatGPT の追加原画（Pull Request #5）の採集草・採掘の露頭を切り抜いた板（いつもカメラを向く。npm run supplement:art）。
// まだ採っていない採取点の上に、小さな印（色だけに頼らず、高さと形でも分かる）。採った採取点は、草は刈った後の低い株、露頭は暗くする。
// 納品箱は、木の箱と旗。要る数がそろうと、箱の上にも印が出る。
import {
  BoxGeometry,
  BufferAttribute,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Vector3,
} from 'three';
import { assetUrl } from '../core/assets';
import type { GatherDef } from '../data/schemas';
import { errandReady, type ErrandState } from '../game/errand';
import { blobShadow } from './arena';
import { PROP_ART, type PropArt } from './npcArt';

const loader = new TextureLoader();
const GAIN = 1.15;

function propMaterial(art: PropArt): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ alphaTest: 0.5, side: DoubleSide });
  mat.color.setScalar(GAIN);
  // 絵が届くまでは描かない（板の四角が見えないように）
  mat.visible = false;
  mat.userData.prop = art.file;
  if (typeof document !== 'undefined') {
    loader.load(assetUrl(`assets/textures/props/${art.file}.webp`), (t) => {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      mat.map = t;
      mat.visible = true;
      mat.needsUpdate = true;
    });
  }
  return mat;
}

/** 板の形: 下の端が地面（少し下）、高さは art.height。法線は上と手前の間 */
function plane(art: PropArt): PlaneGeometry {
  const h = art.height / Math.max(0.5, 1 - art.foot - art.head);
  const w = h * art.aspect;
  const g = new PlaneGeometry(w, h);
  g.translate(0, h / 2 - art.foot * h - 0.02, 0);
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0.6, 0.8);
  n.needsUpdate = true;
  return g;
}

interface PropNode {
  id: string;
  areaId: string;
  root: Group;
  sprite: Mesh;
  marker: Mesh;
  kind: 'gather' | 'mine';
  used: boolean;
}

export interface ErrandProps {
  group: Group;
  nodes: PropNode[];
  depot: { root: Group; areaId: string; marker: Mesh };
  /** 採った採取点に使う、暗くした素材（種類ごと） */
  usedMats: Record<'gather' | 'mine', MeshLambertMaterial>;
}

/** 採取点と納品箱を作る（1 つの依頼で 1 度）。 */
export function buildErrandProps(def: GatherDef): ErrandProps {
  const group = new Group();
  group.name = 'errand';
  const herb = PROP_ART.herb, ore = PROP_ART.ore;
  const geo = { gather: plane(herb), mine: plane(ore) };
  const mats = { gather: propMaterial(herb), mine: propMaterial(ore) };
  // 採った後: 同じ絵を暗く（露頭）・草は低く刈った株にする（scale で縮める）
  const usedMats = { gather: mats.gather.clone(), mine: mats.mine.clone() };
  usedMats.gather.color.setScalar(GAIN * 0.55);
  usedMats.mine.color.setScalar(GAIN * 0.5);
  // 絵が届いたら、暗くした素材にも同じ絵を貼る
  for (const k of ['gather', 'mine'] as const) {
    const src = mats[k];
    const dst = usedMats[k];
    dst.visible = false;
    const sync = (): void => {
      if (src.map && !dst.map) {
        dst.map = src.map;
        dst.visible = true;
        dst.needsUpdate = true;
      }
    };
    dst.userData.sync = sync;
  }
  const markerGeo = new OctahedronGeometry(0.11, 0);
  const markerMat = new MeshBasicMaterial({ color: 0xffd27a });
  const depotMarkerMat = new MeshBasicMaterial({ color: 0x9fe08a });
  const nodes: PropNode[] = def.nodes.map((n) => {
    const root = new Group();
    root.position.set(n.x, 0, n.z);
    const sprite = new Mesh(geo[n.kind], mats[n.kind]);
    sprite.renderOrder = 2;
    sprite.userData.node = n.id;
    const marker = new Mesh(markerGeo, markerMat);
    marker.position.y = (n.kind === 'mine' ? ore.height : herb.height) + 0.45;
    const shadow = blobShadow(n.kind === 'mine' ? 0.75 : 0.45);
    shadow.position.y = 0.02;
    root.add(sprite, marker, shadow);
    root.visible = false;
    group.add(root);
    return { id: n.id, areaId: n.areaId, root, sprite, marker, kind: n.kind, used: false };
  });
  // 納品箱: 木の箱（蓋の色を変える）と、立てた竿の布（遠くからも見える）
  const d = def.depot;
  const depotRoot = new Group();
  depotRoot.position.set(d.x, 0, d.z);
  depotRoot.rotation.y = 0.35;
  const wood = new MeshLambertMaterial({ color: 0x8a6a44 });
  const woodDark = new MeshLambertMaterial({ color: 0x5f4a30 });
  const box = new Mesh(new BoxGeometry(1.0, 0.62, 0.72), wood);
  box.position.y = 0.31;
  box.castShadow = true;
  const lid = new Mesh(new BoxGeometry(1.06, 0.08, 0.78), woodDark);
  lid.position.y = 0.66;
  const pole = new Mesh(new CylinderGeometry(0.035, 0.045, 2.0, 6), woodDark);
  pole.position.set(0.62, 1.0, -0.3);
  const cloth = new Mesh(new PlaneGeometry(0.55, 0.38), new MeshLambertMaterial({ color: 0xc9a05a, side: DoubleSide }));
  cloth.position.set(0.9, 1.75, -0.3);
  const marker = new Mesh(markerGeo, depotMarkerMat);
  marker.position.y = 1.15;
  marker.scale.setScalar(1.3);
  const shadow = blobShadow(0.8);
  shadow.position.y = 0.02;
  depotRoot.add(box, lid, pole, cloth, marker, shadow);
  depotRoot.userData.depot = true;
  depotRoot.visible = false;
  group.add(depotRoot);
  return { group, nodes, depot: { root: depotRoot, areaId: d.areaId, marker }, usedMats };
}

/**
 * 毎フレーム: 居るエリアのものだけ見せ、採った採取点は暗く・低く、印は採っていない採取点（と、そろった時の納品箱）だけ。
 * 板はカメラの方へ向ける。印はゆっくり上下に揺れて回る（見た目だけ）。
 */
export function updateErrandProps(p: ErrandProps, e: ErrandState, areaId: string | null, active: boolean, cam: Vector3, time: number): void {
  for (const k of ['gather', 'mine'] as const) (p.usedMats[k].userData.sync as (() => void) | undefined)?.();
  const bob = Math.sin(time * 2.4) * 0.06;
  for (const n of p.nodes) {
    n.root.visible = n.areaId === areaId;
    if (!n.root.visible) continue;
    const used = e.used.includes(n.id);
    if (used !== n.used) {
      n.used = used;
      n.sprite.material = used ? p.usedMats[n.kind] : (n.sprite.material as MeshLambertMaterial);
      // 草は刈った後の低い株（高さを 3 割に）。露頭は形を残して暗くする
      if (n.kind === 'gather') n.sprite.scale.set(used ? 0.7 : 1, used ? 0.3 : 1, 1);
    }
    n.marker.visible = !used && active;
    n.marker.position.y = (n.kind === 'mine' ? PROP_ART.ore.height : PROP_ART.herb.height) + 0.45 + bob;
    n.marker.rotation.y = time * 1.6;
    n.sprite.rotation.y = Math.atan2(cam.x - n.root.position.x, cam.z - n.root.position.z);
  }
  const dp = p.depot;
  dp.root.visible = dp.areaId === areaId;
  dp.marker.visible = active && errandReady(e);
  dp.marker.position.y = 1.15 + bob;
  dp.marker.rotation.y = time * 1.6;
}
