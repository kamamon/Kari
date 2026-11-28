// ハンターの動きの組（v0.57.0。D-150）。利用者の指示で、ハンターの動きを 2G の動きを手本に作り直している。いまの組（'2g'）と、
// 作り直す前の動きを残した保留の組（'v056' = v0.56.0 までの動き）を、設定の「ハンターの動き」で切り替える。
// - データ（技・軌道・移動曲線・武器の系統）は、読み込みの時に入れ替わる（src/data/validators.ts の assembleContent の motionSet）。
// - 描画の動き（weaponClipSpecs.ts の WEAPON_STANCES・WEAPON_MOTIONS、poses.ts の共通の動き CLIPS の common_* と納刀の歩き・走りの形 LOCO_STYLE。
//   v0.58.0 から。被弾の形 HURT_STYLE は v0.64.0 から。登攀の形と研磨の確かめ MOTION_STYLE は v0.69.0 から）は、ここで中身を入れ替える。どちらも起動の時に 1 度だけ。
// 保留の組の断岳剣は、キー姿勢の方式（poses.ts・heavyBodyMotion.ts）のまま。WEAPON_STANCES に断岳剣が無いので、view.ts がその方式で描く。
import { WEAPON_MOTIONS, WEAPON_STANCES, type WeaponStances } from './weaponClipSpecs';
import { CLIPS, HURT_STYLE, LOCO_STYLE, MOTION_STYLE, type Clip, type LocoStyle } from './poses';
import type { Motion } from './bodySolve';
import { EXTRA_FAMILIES } from '../game/extraWeapons';

/** いまの組の名前（public/data/content.json の motionSets.current と同じ） */
export const CURRENT_MOTION_SET = '2g';

/** 選べる組（設定の画面に並べる順） */
export const MOTION_SETS: readonly { id: string; name: string; note: string }[] = [
  { id: '2g', name: '2G の動き（作り直している途中）', note: '2G を手本に作り直している動き。作り直していない武器は、これまでの動き' },
  { id: 'v056', name: 'v0.56.0 までの動き（保留）', note: '作り直す前の動き。技の組み立ても v0.56.0 のまま' },
];

/** 組の名前として正しいか（知らない名前は、いまの組として扱う） */
export const motionSetOf = (id: string | null | undefined): string => (MOTION_SETS.some((s) => s.id === id) ? id! : CURRENT_MOTION_SET);

// いまの組の中身（入れ替えた後でも戻せるように、起動の時に写しておく）
const CURRENT = {
  stances: { ...WEAPON_STANCES },
  motions: { ...WEAPON_MOTIONS },
  clips: Object.fromEntries(Object.entries(CLIPS).filter(([k]) => k.startsWith('common_'))) as Record<string, Clip>,
  loco: { ...LOCO_STYLE } as LocoStyle,
};
let applied = CURRENT_MOTION_SET;

function replace<T>(target: Record<string, T>, from: Record<string, T>): void {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, from);
}

/** 描画の動きを、組 id の中身にする。保留の組は、選んだ時だけ読む（別のファイルに分かれる）。 */
export async function useMotionSet(id: string): Promise<void> {
  const want = motionSetOf(id);
  if (want === applied) return;
  let stances: Record<string, WeaponStances> = CURRENT.stances;
  let motions: Record<string, Motion> = CURRENT.motions;
  let clips: Record<string, Clip> = CURRENT.clips;
  let loco: LocoStyle = CURRENT.loco;
  if (want === 'v056') {
    const m = await import('./motionsets/v056');
    // 響笛・銃槍・軽弩・重弩（v0.80.0）には、作り直す前の動きが無い: 保留の組でも、いまの組の構えと動きを使う（保留の組のファイルは変えない）
    const added = (family: string): boolean => (EXTRA_FAMILIES as readonly string[]).includes(family);
    stances = { ...m.WEAPON_STANCES, ...Object.fromEntries(Object.entries(CURRENT.stances).filter(([family]) => added(family))) };
    motions = { ...m.WEAPON_MOTIONS, ...Object.fromEntries(Object.entries(CURRENT.motions).filter(([, mo]) => added(mo.family))) };
    // 共通追加アクションは保留の組に無い場合も現在の定義を使う。
    clips = { ...CURRENT.clips, ...m.COMMON_CLIPS };
    loco = m.LOCO_STYLE;
  }
  replace(WEAPON_STANCES, stances);
  replace(WEAPON_MOTIONS, motions);
  // 共通の動きは common_* だけを替える（断岳剣の hb_* は保留の組のためにそのまま残っている）
  for (const k of Object.keys(CLIPS)) if (k.startsWith('common_')) delete CLIPS[k];
  Object.assign(CLIPS, clips);
  Object.assign(LOCO_STYLE, loco);
  // 被弾の形（v0.64.0）: 保留の組は v0.63.0 までの形
  HURT_STYLE.style = want === 'v056' ? 'v056' : '2g';
  // 登攀の形と研磨の終わりの確かめ（v0.69.0）: 保留の組は v0.68.0 までの形
  MOTION_STYLE.style = want === 'v056' ? 'v056' : '2g';
  applied = want;
}

/** いま描画が使っている組 */
export const appliedMotionSet = (): string => applied;
