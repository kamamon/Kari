// フィールド（エリアに分かれた狩場）の、計算だけの補助（v0.11.0、docs/spec.md 18 章）。
import type { Content, FieldAreaDef, FieldDef, QuestDef } from '../data/schemas';

/** 依頼のフィールド（無ければ null）。 */
export function fieldOf(content: Content, quest: QuestDef): FieldDef | null {
  return (quest.fieldId !== undefined && content.fields.get(quest.fieldId)) || null;
}

/**
 * 依頼の制限時間。フィールドで狩る時は、歩いて探す時間と、標的が移動する・眠る時間のぶん、長くする（timeLimitScale）。
 * 依頼にフィールドの時間（fieldTimeLimitTicks。v0.26.0）があれば、倍率を掛けずに、そのまま使う。
 * useField: フィールドで狩るか（1 つの狩場で狩る時は、依頼の値のまま）。受注の画面と simulation は、どちらもこれを使う。
 */
export function questTimeLimitTicks(content: Pick<Content, 'fields'>, quest: QuestDef, useField: boolean): number {
  const field = useField ? fieldOf(content as Content, quest) : null;
  if (field && quest.fieldTimeLimitTicks !== undefined) return quest.fieldTimeLimitTicks;
  return Math.round(quest.timeLimitTicks * (field?.timeLimitScale ?? 1));
}

export function areaOf(field: FieldDef, areaId: string): FieldAreaDef | null {
  return field.areas.find((a) => a.id === areaId) ?? null;
}

/** 画面に出すエリアの呼び名（「エリア 3」。野営地は名前のまま）。 */
export function areaLabel(area: FieldAreaDef): string {
  return area.kind === 'camp' ? area.name : `エリア ${area.no}`;
}
