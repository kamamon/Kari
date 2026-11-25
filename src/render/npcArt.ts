// tools/supplement-art.py の出力（npm run supplement:art）。手で編集しない。

/** 里に立てる人の板の絵（public/assets/textures/npc/<file>.webp）。aspect = 幅 / 高さ、foot・head = 絵の下・上の端から、足の裏・頭の上までの割合 */
export interface NpcSide { file: string; aspect: number; foot: number; head: number }
/** height は背丈（m。仮の値）。back が無い人は、いつも正面を向ける */
export interface NpcArt { height: number; front: NpcSide; back?: NpcSide }

export const NPC_ART: Readonly<Record<string, NpcArt>> = {"minagi": {"height": 1.64, "front": {"file": "npc_minagi_front_v1", "aspect": 0.2953, "foot": 0.0021, "head": 0.0029}}, "smith": {"height": 1.78, "front": {"file": "npc_smith_front_v1", "aspect": 0.4156, "foot": 0.0022, "head": 0.0029}, "back": {"file": "npc_smith_back_v1", "aspect": 0.4203, "foot": 0.0022, "head": 0.0029}}, "merchant": {"height": 1.66, "front": {"file": "npc_merchant_front_v1", "aspect": 0.3641, "foot": 0.0021, "head": 0.0028}, "back": {"file": "npc_merchant_back_v1", "aspect": 0.3781, "foot": 0.0021, "head": 0.0028}}};
