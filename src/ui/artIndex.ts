// tools/supplement-art.py の出力（npm run supplement:art）。手で編集しない。

/** 素材・道具の id → アイコン（public/assets/icons/<名前>.webp。256 四方） */
export const ITEM_ICONS: Readonly<Record<string, string>> = {
  'item.heal_tonic': 'icon_item_heal_v1',
  'item.bind_trap': 'icon_item_bind_trap_v1',
  'item.calm_orb': 'icon_item_calm_orb_v1',
  'item.whetstone': 'icon_item_whetstone_v1',
  'mat.galdros.shell_shard': 'icon_mat_galdros_shell_v1',
  'mat.galdros.hard_bone': 'icon_mat_bone_v1',
  'mat.galdros.bronze_vein': 'icon_mat_vein_v1',
  'mat.galdros.foreleg_plate': 'icon_mat_foreplate_v1',
  'mat.galdros.veined_shell': 'icon_mat_galdros_veined_shell_v1',
  'mat.galdros.tail_crystal': 'icon_mat_tail_v1',
  'mat.galdros.crystal_shell': 'icon_mat_galdros_crystal_shell_v1',
  'mat.galdros.bronze_lump': 'icon_mat_galdros_bronze_lump_v1',
  'mat.galdros.radiant_shell': 'icon_mat_galdros_radiant_shell_v1',
  'mat.galdros.pulse_core': 'icon_mat_core_v1',
};

/** 会話の顔（public/assets/portraits/<名前>.webp。256 四方の切り抜き） */
export const PORTRAITS: Readonly<Record<string, string>> = {
  minagi: 'portrait_minagi_v1',
  smith: 'portrait_smith_v1',
  merchant: 'portrait_merchant_v1',
};

/** 狩場の名前（登録簿の fields）→ 景色の原画（public/assets/fields/<名前>.webp。640 × 427） */
export const FIELD_ART: Readonly<Record<string, string>> = {
  '風礫盆地': 'field_01_overview_v1',
  '根絡み湿原': 'field_02_overview_v1',
  '硝砂海岸': 'field_03_overview_v1',
  '灰鐘鉱山': 'field_04_overview_v1',
  '氷帆峡谷': 'field_05_overview_v1',
  '霧灯樹海': 'field_06_overview_v1',
  '燠脈台地': 'field_07_overview_v1',
  '雨裂断崖': 'field_08_overview_v1',
  '銅苔段丘': 'field_09_overview_v1',
  '枯響河床': 'field_10_overview_v1',
  '鉛雲高地': 'field_11_overview_v1',
  '沈根沢地': 'field_12_overview_v1',
  '玻璃裂原': 'field_13_overview_v1',
  '灰繭窪地': 'field_14_overview_v1',
  '冷銅洞庭': 'field_15_overview_v1',
  '響礫回廊': 'field_16_overview_v1',
  '重霧環谷': 'field_17_overview_v1',
  '伏熱石原': 'field_18_overview_v1',
  '錆星高原': 'field_19_overview_v1',
  '深帷樹洞': 'field_20_overview_v1',
};
