// 依頼の標的の言い方（v0.18.0）。群れの依頼の「コルドピル 3 頭」など。表示だけで、計算には使わない。
import type { Content, QuestDef } from '../data/schemas';

/** 数え方。v0.75.0 で、体の作りごとの数え方（鳥は羽、虫と甲殻は体）を持っていた生成の種を外したので、どれも「頭」 */
export const counterOf = (_monsterId: string): string => '頭';

/** 「岩殻獣の幼体 コルドピル」→「コルドピル」 */
export const shortName = (name: string): string => name.split(' ').pop() ?? name;

/** 依頼の目標の言い方。群れの依頼は「コルドピル 2 頭とパルセイト 3 頭の討伐」、1 体の標的は「（名前）の狩猟（討伐か捕獲）」 */
export function questGoal(c: Content, q: QuestDef, short = false): string {
  // 狩らない依頼（v0.27.0）: 「ヒラナギの葉 6 枚を集めて、野営地の納品箱へ」
  if(q.gather?.fieldGathering)return '自由採集・野営地から帰還';
  if (q.gather) return `${q.gather.needs.map((s) => `${c.materials.get(s.itemId)?.name ?? s.itemId} ${s.count} ${c.materials.get(s.itemId)?.unit ?? '個'}`).join('と')}を${q.gather.nodes.every((n) => n.kind === 'mine') ? '採掘' : q.gather.nodes.every((n) => n.kind === 'gather') ? '採集' : '集め'}して、${short ? '納品' : '野営地の納品箱へ届ける（この出発で採ったものだけ）'}`;
  if (q.targets) return `${q.targets.map((t) => `${shortName(c.monsters.get(t.monsterId)?.name ?? t.monsterId)} ${t.count} ${counterOf(t.monsterId)}`).join('と')}の討伐`;
  const name = (q.targetMonsterId && c.monsters.get(q.targetMonsterId)?.name) || '';
  return `${name}の${q.kind === 'hunt' ? (short ? '狩猟' : '狩猟（討伐か捕獲）') : '討伐'}`;
}
