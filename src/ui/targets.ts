// 依頼の標的の言い方（v0.18.0）。群れの依頼の「コルドピル 3 頭」など。表示だけで、計算には使わない。
import type { Content, QuestDef } from '../data/schemas';
import { CREATURE_PLANS } from '../render/creaturePlans';

/** 数え方（鳥は羽、虫と甲殻は体、ほかは頭） */
const COUNTER: Record<string, string> = { quad: '頭', biped: '羽', crab: '体', bug: '体', arch: '体', serpent: '頭' };

export const counterOf = (monsterId: string): string => COUNTER[CREATURE_PLANS[monsterId]?.frame ?? 'quad'] ?? '頭';

/** 「岩殻獣の幼体 コルドピル」→「コルドピル」 */
export const shortName = (name: string): string => name.split(' ').pop() ?? name;

/** 依頼の目標の言い方。群れの依頼は「コルドピル 2 頭とパルセイト 3 頭の討伐」、1 体の標的は「（名前）の狩猟（討伐か捕獲）」 */
export function questGoal(c: Content, q: QuestDef, short = false): string {
  if (q.targets) return `${q.targets.map((t) => `${shortName(c.monsters.get(t.monsterId)?.name ?? t.monsterId)} ${t.count} ${counterOf(t.monsterId)}`).join('と')}の討伐`;
  const name = c.monsters.get(q.targetMonsterId)?.name ?? '';
  return `${name}の${q.kind === 'hunt' ? (short ? '狩猟' : '狩猟（討伐か捕獲）') : '討伐'}`;
}
