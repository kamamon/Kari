// フィールド（エリアに分かれた狩場）の、計算だけの補助（v0.11.0、docs/spec.md 18 章）。
import type { Content, FieldAreaDef, FieldDef, QuestDef } from '../data/schemas';

/** 依頼のフィールド（無ければ null）。 */
export function fieldOf(content: Content, quest: QuestDef): FieldDef | null {
  return (quest.fieldId !== undefined && content.fields.get(quest.fieldId)) || null;
}

/**
 * 依頼の制限時間。フィールドで狩る時は、歩いて探す時間と、標的が移動する・眠る時間のぶん、長くする（timeLimitScale）。
 * useField: フィールドで狩るか（1 つの狩場で狩る時は、依頼の値のまま）。
 */
export function questTimeLimitTicks(content: Content, quest: QuestDef, useField: boolean): number {
  const field = useField ? fieldOf(content, quest) : null;
  return Math.round(quest.timeLimitTicks * (field?.timeLimitScale ?? 1));
}

export function areaOf(field: FieldDef, areaId: string): FieldAreaDef | null {
  return field.areas.find((a) => a.id === areaId) ?? null;
}

/** 画面に出すエリアの呼び名（「エリア 3」。野営地は名前のまま）。 */
export function areaLabel(area: FieldAreaDef): string {
  return area.kind === 'camp' ? area.name : `エリア ${area.no}`;
}
