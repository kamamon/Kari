// 道具と素材のアイコン（ChatGPT の追加原画。v0.23.0）。絵が無い素材（ガルドロス以外の素材など）は、何も出さない。
// 絵は飾り（alt は空）。文字は、これまでどおり横に出すので、読み上げと検査は文字で行う。
import { assetUrl } from '../core/assets';
import { FIELD_ART, ITEM_ICONS, PORTRAITS, STORY_ART } from './artIndex';

const SPINEGALE_ICONS: Record<string,string> = {
  "weapon.heavy_blade.spinegale.r1": "spinegale/weapons/low_heavy_blade.webp",
  "weapon.guard_blade.spinegale.r1": "spinegale/weapons/low_guard_blade.webp",
  "weapon.twin_blades.spinegale.r1": "spinegale/weapons/low_twin_blades.webp",
  "weapon.long_blade.spinegale.r1": "spinegale/weapons/low_long_blade.webp",
  "weapon.war_maul.spinegale.r1": "spinegale/weapons/low_war_maul.webp",
  "weapon.long_lance.spinegale.r1": "spinegale/weapons/low_long_lance.webp",
  "weapon.ring_bow.spinegale.r1": "spinegale/weapons/low_ring_bow.webp",
  "weapon.heavy_blade.spinegale.r2": "spinegale/weapons/mid_heavy_blade.webp",
  "weapon.guard_blade.spinegale.r2": "spinegale/weapons/mid_guard_blade.webp",
  "weapon.twin_blades.spinegale.r2": "spinegale/weapons/mid_twin_blades.webp",
  "weapon.long_blade.spinegale.r2": "spinegale/weapons/mid_long_blade.webp",
  "weapon.war_maul.spinegale.r2": "spinegale/weapons/mid_war_maul.webp",
  "weapon.long_lance.spinegale.r2": "spinegale/weapons/mid_long_lance.webp",
  "weapon.ring_bow.spinegale.r2": "spinegale/weapons/mid_ring_bow.webp",
  "weapon.heavy_blade.spinegale.r3": "spinegale/weapons/high_heavy_blade.webp",
  "weapon.guard_blade.spinegale.r3": "spinegale/weapons/high_guard_blade.webp",
  "weapon.twin_blades.spinegale.r3": "spinegale/weapons/high_twin_blades.webp",
  "weapon.long_blade.spinegale.r3": "spinegale/weapons/high_long_blade.webp",
  "weapon.war_maul.spinegale.r3": "spinegale/weapons/high_war_maul.webp",
  "weapon.long_lance.spinegale.r3": "spinegale/weapons/high_long_lance.webp",
  "weapon.ring_bow.spinegale.r3": "spinegale/weapons/high_ring_bow.webp",
  "armor.head.spinegale.r1": "spinegale/armor/low_head.webp",
  "armor.chest.spinegale.r1": "spinegale/armor/low_chest.webp",
  "armor.arms.spinegale.r1": "spinegale/armor/low_arms.webp",
  "armor.waist.spinegale.r1": "spinegale/armor/low_waist.webp",
  "armor.legs.spinegale.r1": "spinegale/armor/low_legs.webp",
  "armor.head.spinegale.r2": "spinegale/armor/mid_head.webp",
  "armor.chest.spinegale.r2": "spinegale/armor/mid_chest.webp",
  "armor.arms.spinegale.r2": "spinegale/armor/mid_arms.webp",
  "armor.waist.spinegale.r2": "spinegale/armor/mid_waist.webp",
  "armor.legs.spinegale.r2": "spinegale/armor/mid_legs.webp",
  "armor.head.spinegale.r3": "spinegale/armor/high_head.webp",
  "armor.chest.spinegale.r3": "spinegale/armor/high_chest.webp",
  "armor.arms.spinegale.r3": "spinegale/armor/high_arms.webp",
  "armor.waist.spinegale.r3": "spinegale/armor/high_waist.webp",
  "armor.legs.spinegale.r3": "spinegale/armor/high_legs.webp",
  "mat.spinegale.scale.r1": "spinegale/materials/low_scale.webp",
  "mat.spinegale.claw.r1": "spinegale/materials/low_claw.webp",
  "mat.spinegale.spine.r1": "spinegale/materials/low_spine.webp",
  "mat.spinegale.dewlap.r1": "spinegale/materials/low_dewlap.webp",
  "mat.spinegale.tail_fan.r1": "spinegale/materials/low_tail_fan.webp",
  "mat.spinegale.tendon.r1": "spinegale/materials/low_tendon.webp",
  "mat.spinegale.scale.r2": "spinegale/materials/mid_scale.webp",
  "mat.spinegale.claw.r2": "spinegale/materials/mid_claw.webp",
  "mat.spinegale.spine.r2": "spinegale/materials/mid_spine.webp",
  "mat.spinegale.dewlap.r2": "spinegale/materials/mid_dewlap.webp",
  "mat.spinegale.tail_fan.r2": "spinegale/materials/mid_tail_fan.webp",
  "mat.spinegale.tendon.r2": "spinegale/materials/mid_tendon.webp",
  "mat.spinegale.crest_bone.r2": "spinegale/materials/mid_crest_bone.webp",
  "mat.spinegale.scale.r3": "spinegale/materials/high_scale.webp",
  "mat.spinegale.claw.r3": "spinegale/materials/high_claw.webp",
  "mat.spinegale.spine.r3": "spinegale/materials/high_spine.webp",
  "mat.spinegale.dewlap.r3": "spinegale/materials/high_dewlap.webp",
  "mat.spinegale.tail_fan.r3": "spinegale/materials/high_tail_fan.webp",
  "mat.spinegale.tendon.r3": "spinegale/materials/high_tendon.webp",
  "mat.spinegale.crest_bone.r3": "spinegale/materials/high_crest_bone.webp",
  "mat.spinegale.sprint_core.r3": "spinegale/materials/high_sprint_core.webp",
  "weapon.hunting_horn.spinegale.r1": "spinegale/weapons/low_hunting_horn.webp",
  "weapon.gunlance.spinegale.r1": "spinegale/weapons/low_gunlance.webp",
  "weapon.light_bowgun.spinegale.r1": "spinegale/weapons/low_light_bowgun.webp",
  "weapon.heavy_bowgun.spinegale.r1": "spinegale/weapons/low_heavy_bowgun.webp",
  "weapon.hunting_horn.spinegale.r2": "spinegale/weapons/mid_hunting_horn.webp",
  "weapon.gunlance.spinegale.r2": "spinegale/weapons/mid_gunlance.webp",
  "weapon.light_bowgun.spinegale.r2": "spinegale/weapons/mid_light_bowgun.webp",
  "weapon.heavy_bowgun.spinegale.r2": "spinegale/weapons/mid_heavy_bowgun.webp",
  "weapon.hunting_horn.spinegale.r3": "spinegale/weapons/high_hunting_horn.webp",
  "weapon.gunlance.spinegale.r3": "spinegale/weapons/high_gunlance.webp",
  "weapon.light_bowgun.spinegale.r3": "spinegale/weapons/high_light_bowgun.webp",
  "weapon.heavy_bowgun.spinegale.r3": "spinegale/weapons/high_heavy_bowgun.webp"
};

export function iconUrl(id: string): string | null {
  if (SPINEGALE_ICONS[id]) return assetUrl('assets/icons/'+SPINEGALE_ICONS[id]);
  const f = ITEM_ICONS[id];
  return f ? assetUrl(`assets/icons/${f}.webp`) : null;
}

/** 文字の前に置くアイコン。絵が無ければ null */
export function iconEl(id: string, cls = 'ico'): HTMLImageElement | null {
  const u = iconUrl(id);
  if (!u) return null;
  const img = document.createElement('img');
  img.className = cls;
  img.src = u;
  img.alt = '';
  img.decoding = 'async';
  img.dataset.icon = id;
  return img;
}

/** アイコン（あれば）と文字を、1 つの要素にまとめる */
export function withIcon<T extends HTMLElement>(e: T, id: string, text: string): T {
  const img = iconEl(id);
  if (img) e.appendChild(img);
  e.appendChild(document.createTextNode(text));
  return e;
}

/** 会話の顔（ミナギ・ロクハ・イサネ・セナキと、その表情。v0.29.0）。無ければ null */
export function portraitUrl(who: string): string | null {
  const f = PORTRAITS[who];
  return f ? assetUrl(`assets/portraits/${f}.webp`) : null;
}

/** 物語の場面の絵（v0.29.0）。無ければ null */
/** 章の一覧の小さな絵（public/assets/story/thumb/<名前>.webp。480 × 270。v0.39.0） */
export function storyThumbUrl(name: string): string | null {
  return STORY_ART.includes(name) ? assetUrl(`assets/story/thumb/${name}.webp`) : null;
}

export function storyArtUrl(name: string): string | null {
  return STORY_ART.includes(name) ? assetUrl(`assets/story/${name}.webp`) : null;
}

/** 狩場の景色の原画（登録簿の狩場の名前から）。無ければ null */
export function fieldArtUrl(name: string): string | null {
  const f = FIELD_ART[name];
  return f ? assetUrl(`assets/fields/${f}.webp`) : null;
}
