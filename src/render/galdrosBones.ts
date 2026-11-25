// ガルドロスの骨の名前の表（v0.30.0。ChatGPT のモンスターの解剖 #12 の M1「骨と部位の対応」）。
//
// 骨の番号（Skeleton の並び = 皮と岩板の重みの番号）は、v0.29.0 までと同じ 0〜52。
// 番号を直接書かず、足し算（「脚の先頭 + 4 × i」など）もしない。どの参照も、この表の名前 → 番号を通る。
// 名前は #12 の設計の 79 ノードの名前（docs/source/chatgpt-monster-anatomy-20261125/galdros_rig_blueprint_recovered_v3.json）。
// 設計の残り 26 ノード（肩甲・前腕と下腿のねじれ・趾・右の胸郭・眼・舌の先）は、まだ骨にしない（M2。名前を足しただけでは完成にしない）。
// socket（武器や効果を付ける点）は、いまのガルドロスには無い（#12 でも 12 の socket の定義は復旧できていない。正式モデル化の入口で決める）。
//
// 描画の側だけのデータ（simulation は読まない）。
import { Bone, Quaternion, Vector3 } from 'three';

/** 皮・岩板を曲げる骨（deform）か、ほかの骨を動かすだけの骨（control）。 */
export type GaldrosBoneKind = 'deform' | 'control';

export interface GaldrosBoneDef {
  /** 変えない名前（設計のノード名）。表示名ではない */
  readonly name: string;
  /** 親の骨の名前（根は null） */
  readonly parent: string | null;
  readonly kind: GaldrosBoneKind;
  /** 設計では、まだ骨の無いノード（追加案）が親の時の、その名前。いまは parent に付いている */
  readonly designParent?: string;
  /** 役目 */
  readonly role: string;
}

const tail = (n: number): GaldrosBoneDef => ({
  name: `tail_0${n}`, parent: n === 1 ? 'pelvis' : `tail_0${n - 1}`, kind: 'deform',
  role: n === 5 ? '尾の 5 節目（切断面。ここから先が切り落とされる）' : `尾の ${n} 節目`,
});
const fore = (s: 'l' | 'r'): GaldrosBoneDef[] => [
  { name: `fore_upper_${s}`, parent: 'chest', designParent: `scapula_${s}`, kind: 'deform', role: `前脚の上腕（${s === 'l' ? '左' : '右'}）` },
  { name: `fore_lower_${s}`, parent: `fore_upper_${s}`, kind: 'deform', role: '前脚の前腕（ひじから）' },
  { name: `wrist_${s}`, parent: `fore_lower_${s}`, kind: 'deform', role: '前脚の手首（足のかかと側とけづめ）' },
  { name: `palm_${s}`, parent: `wrist_${s}`, kind: 'deform', role: '前脚の掌（足の前半分と 4 本の爪。踏み切りで反る）' },
];
const hind = (s: 'l' | 'r'): GaldrosBoneDef[] => [
  { name: `hind_upper_${s}`, parent: 'pelvis', kind: 'deform', role: `後脚のもも（${s === 'l' ? '左' : '右'}）` },
  { name: `hind_lower_${s}`, parent: `hind_upper_${s}`, kind: 'deform', role: '後脚の下腿（ひざから）' },
  { name: `hock_${s}`, parent: `hind_lower_${s}`, kind: 'deform', role: '後脚の足首（足のかかと側とけづめ）' },
  { name: `metatarsus_${s}`, parent: `hock_${s}`, kind: 'deform', role: '後脚の足の前半分と 4 本の爪' },
];
const plate = (name: string, parent: string, role: string): GaldrosBoneDef => ({ name, parent, kind: 'deform', role: `岩板: ${role}` });

/** 骨の表。並びは骨の番号（0〜52）。v0.29.0 までの番号と同じ。 */
export const GALDROS_BONES: readonly GaldrosBoneDef[] = [
  { name: 'root', parent: null, kind: 'control', role: '体の根（地面の高さ。皮には付かない）' },
  { name: 'body', parent: 'root', kind: 'deform', role: '胴の中心（体全体の上下・傾き）' },
  { name: 'lumbar', parent: 'body', kind: 'deform', role: '背骨の腰の側' },
  { name: 'pelvis', parent: 'lumbar', kind: 'deform', role: '骨盤（後脚と尾の付け根）' },
  { name: 'thorax', parent: 'body', kind: 'deform', role: '背骨の胸の側' },
  { name: 'chest', parent: 'thorax', kind: 'deform', role: '胸（前脚と首の付け根）' },
  { name: 'ribs_l', parent: 'body', kind: 'deform', role: '胸郭（呼吸でふくらむ脇腹と腹。いまは左右とも。右の ribs_r は M2）' },
  { name: 'neck_01', parent: 'chest', kind: 'deform', role: '首の付け根' },
  { name: 'neck_02', parent: 'neck_01', kind: 'deform', role: '首の先' },
  { name: 'head', parent: 'neck_02', kind: 'deform', role: '頭（上あご・角・目）' },
  { name: 'jaw', parent: 'head', kind: 'deform', role: '下あご' },
  { name: 'tongue_01', parent: 'jaw', kind: 'deform', role: '舌' },
  { name: 'lid_l', parent: 'head', kind: 'deform', role: '上まぶた（左）' },
  { name: 'lid_r', parent: 'head', kind: 'deform', role: '上まぶた（右）' },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(tail),
  ...fore('l'), ...fore('r'), ...hind('l'), ...hind('r'),
  plate('plate_back_01_l', 'thorax', '背殻の前の列（左）'),
  plate('plate_back_01_r', 'thorax', '背殻の前の列（右）'),
  plate('plate_back_02_l', 'body', '背殻の中の列（左）'),
  plate('plate_back_02_r', 'body', '背殻の中の列（右）'),
  plate('plate_back_03_l', 'lumbar', '背殻の後ろの列（左）'),
  plate('plate_back_03_r', 'lumbar', '背殻の後ろの列（右）'),
  plate('plate_head_l', 'head', '頭（左）'),
  plate('plate_head_r', 'head', '頭（右）'),
  plate('plate_shoulder_l', 'chest', '肩（左。大きな一枚）'),
  plate('plate_shoulder_r_main', 'chest', '肩（右の中）'),
  plate('plate_shoulder_r_small', 'chest', '肩（右の小）'),
  plate('plate_hip_l', 'pelvis', '腰（左）'),
  plate('plate_hip_r', 'pelvis', '腰（右）'),
  plate('plate_forearm_l', 'fore_lower_l', '前脚の外側の甲（左）'),
  plate('plate_forearm_r', 'fore_lower_r', '前脚の外側の甲（右）'),
];

/** 名前 → 骨の番号 */
export const GALDROS_BONE_INDEX: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(GALDROS_BONES.map((b, i) => [b.name, i])));

/** 名前から骨の番号を引く。表に無い名前は誤り（黙って 0 にしない）。 */
export function galdrosBone(name: string): number {
  const i = GALDROS_BONE_INDEX[name];
  if (i === undefined) throw new Error(`ガルドロスの骨の表に無い名前: ${name}`);
  return i;
}

/** 尾の 8 節（付け根から先へ） */
export const GALDROS_TAIL: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => galdrosBone(`tail_0${n}`));
/** 脚 4 本（前左・前右・後左・後右。左が +X）の、付け根 / 関節 / 足首 / 足の前半分 */
export const GALDROS_LEGS: readonly { upper: number; lower: number; foot: number; toe: number }[] = [
  ['fore_upper_l', 'fore_lower_l', 'wrist_l', 'palm_l'],
  ['fore_upper_r', 'fore_lower_r', 'wrist_r', 'palm_r'],
  ['hind_upper_l', 'hind_lower_l', 'hock_l', 'metatarsus_l'],
  ['hind_upper_r', 'hind_lower_r', 'hock_r', 'metatarsus_r'],
].map(([u, l, f, t]) => ({ upper: galdrosBone(u!), lower: galdrosBone(l!), foot: galdrosBone(f!), toe: galdrosBone(t!) }));
/** 岩板 15 枚。並びは、形を作る順（背殻 3 列 × 左右・頭 2・肩 3・腰 2・前脚 2） */
export const GALDROS_PLATES: readonly number[] = [
  'plate_back_01_l', 'plate_back_01_r', 'plate_back_02_l', 'plate_back_02_r', 'plate_back_03_l', 'plate_back_03_r',
  'plate_head_l', 'plate_head_r', 'plate_shoulder_l', 'plate_shoulder_r_main', 'plate_shoulder_r_small', 'plate_hip_l', 'plate_hip_r',
  'plate_forearm_l', 'plate_forearm_r',
].map(galdrosBone);
/** 上まぶた（左・右） */
export const GALDROS_LIDS: readonly number[] = [galdrosBone('lid_l'), galdrosBone('lid_r')];

/** 設計の 79 ノードのうち、まだ骨にしていない 26（M2 で、関節の軸・可動域・重み・補正と一緒に足す） */
export const GALDROS_PLANNED_NODES: readonly string[] = [
  'scapula_l', 'scapula_r', 'ribs_r', 'tongue_02', 'eye_l', 'eye_r',
  'fore_lower_twist_l', 'digit_01_l', 'digit_02_l', 'digit_03_l', 'digit_04_l', 'digit_05_l',
  'fore_lower_twist_r', 'digit_01_r', 'digit_02_r', 'digit_03_r', 'digit_04_r', 'digit_05_r',
  'hind_lower_twist_l', 'toes_inner_l', 'toes_middle_l', 'toes_outer_l',
  'hind_lower_twist_r', 'toes_inner_r', 'toes_middle_r', 'toes_outer_r',
];

export interface BoneRest {
  /** 骨の名前（Bone.name に付ける） */
  name: string;
  /** 親の骨の番号（根は -1）。子より後ろの番号でもよい */
  parent: number;
  /** 体（actor）の空間での基準の位置 */
  pos: Vector3;
  /** 体の空間での基準の向き（無ければ回っていない） */
  quat?: Quaternion;
}

/**
 * 骨の木を 2 段で組む: 先に全部の骨を作り、その後で親へつなぐ（親が子より後ろの番号でもよい）。
 * つなぐ時は、親の基準の変換の逆で、子の基準の変換を親の中の値へ直す（体の空間での基準の姿勢は、親を付け替えても変わらない）。
 * 根（parent = -1）は、体の空間の位置のまま。返す並びは rests と同じ（Skeleton の番号）。
 */
export function buildBoneTree(rests: readonly BoneRest[]): Bone[] {
  // つなぐ前に確かめる: 親がある・自分を親にしない・親をたどって輪にならない（輪は、どの根にもつながらない）
  rests.forEach((r, i) => {
    if (r.parent >= rests.length || (r.parent < 0 && r.parent !== -1)) throw new Error(`骨 ${r.name} の親 ${r.parent} が無い`);
    if (r.parent === i) throw new Error(`骨 ${r.name} が自分を親にしている`);
    let at = i;
    for (let n = 0; n <= rests.length; n++) {
      at = rests[at]!.parent;
      if (at < 0) return;
    }
    throw new Error(`骨 ${r.name} の親をたどると輪になる`);
  });
  // 1 段目: 全部の骨を作る
  const bones = rests.map((r) => {
    const b = new Bone();
    b.name = r.name;
    return b;
  });
  // 2 段目: 親へつなぐ
  const inv = new Quaternion();
  rests.forEach((r, i) => {
    const b = bones[i]!;
    if (r.parent < 0) {
      b.position.copy(r.pos);
      if (r.quat) b.quaternion.copy(r.quat);
      return;
    }
    const p = rests[r.parent]!;
    // 子の位置 = 親の向きの逆 ×（子の位置 − 親の位置）。向きが無ければ、ただの差（v0.29.0 までと同じ値）
    b.position.copy(r.pos).sub(p.pos);
    if (p.quat) {
      inv.copy(p.quat).invert();
      b.position.applyQuaternion(inv);
      b.quaternion.copy(inv).multiply(r.quat ?? new Quaternion());
    } else if (r.quat) b.quaternion.copy(r.quat);
    bones[r.parent]!.add(b);
  });
  return bones;
}
