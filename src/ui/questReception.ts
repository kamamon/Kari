// 級ごとの受付・星ごとの一覧と、小さな標的画像。表示だけを扱い、解禁条件と保存は変えない。
import { assetUrl } from '../core/assets';
import { questTargets, type Content, type DeliveryDef, type QuestDef } from '../data/schemas';
import { shortName } from './targets';

export type ReceptionEntry =
  | { kind: 'quest'; id: string; rankId: string; stars: number | null; quest: QuestDef }
  | { kind: 'delivery'; id: string; rankId: string; stars: number | null; delivery: DeliveryDef };

export interface ReceptionStarGroup {
  /** 掲示が欠けた場合も仕事を消さず、null を末尾の「星未設定」へ出す。 */
  stars: number | null;
  entries: ReceptionEntry[];
}

export type QuestActivity = 'hunt' | 'slay' | 'gather' | 'mining' | 'field_delivery' | 'tour';

export const QUEST_ACTIVITY_LABELS: Readonly<Record<QuestActivity, string>> = {
  hunt: '狩猟', slay: '討伐', gather: '採集', mining: '採掘', field_delivery: '現地納品', tour: '採取ツアー',
};

const validStars = (value: number | undefined): number | null =>
  value !== undefined && Number.isInteger(value) && value >= 1 && value <= 8 ? value : null;

/** 既存の里納品は初級。将来 rankId を持った納品は、指定された受付へ置く。 */
export const deliveryReceptionRank = (delivery: DeliveryDef & { rankId?: string }): string =>
  delivery.rankId ?? 'rank.1';

/**
 * 受付の級は rankId、グループの星は掲示から取る。星から級を推定しない。
 * ロック済み・達成済みの依頼も返すので、呼び出し側で条件や達成表示を付ける。
 * ?hunt=arena では従来どおり採取依頼を除く。里納品には出発が無いため残す。
 * 入力 Map や配列は変更しない。同じ星の中では元データの順を保つ。
 */
export function receptionGroups(
  content: Pick<Content, 'quests' | 'deliveries' | 'board'>,
  rankId: string,
  fieldHunts = true,
): ReceptionStarGroup[] {
  const boardById = new Map(content.board.quests.map((board) => [board.questId, board]));
  const groups = new Map<number | null, ReceptionEntry[]>();
  const add = (entry: ReceptionEntry): void => {
    const list = groups.get(entry.stars);
    if (list) list.push(entry);
    else groups.set(entry.stars, [entry]);
  };
  for (const quest of content.quests.values()) {
    if (quest.rankId !== rankId || (!fieldHunts && quest.kind === 'gather')) continue;
    const stars = validStars(quest.board?.stars ?? boardById.get(quest.id)?.stars);
    add({ kind: 'quest', id: quest.id, rankId: quest.rankId, stars, quest });
  }
  for (const delivery of content.deliveries.values()) {
    const receptionRank = deliveryReceptionRank(delivery);
    if (receptionRank !== rankId) continue;
    add({ kind: 'delivery', id: delivery.id, rankId: receptionRank, stars: validStars(delivery.stars), delivery });
  }
  return [...groups].sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([stars, entries]) => ({ stars, entries }));
}

/** ファイル名やIDの接頭辞に依存せず、採取点と必要素材から種類を決める。 */
export function questActivity(quest: QuestDef): QuestActivity {
  if (quest.kind !== 'gather') return quest.kind;
  const gather = quest.gather;
  if(gather?.fieldGathering)return 'tour';
  if (!gather || gather.nodes.length === 0 || gather.needs.length !== 1) return 'field_delivery';
  if (gather.nodes.every((node) => node.kind === 'mine')) return 'mining';
  if (gather.nodes.every((node) => node.kind === 'gather')) return 'gather';
  return 'field_delivery';
}

type MonsterContent = Pick<Content, 'bestiary' | 'monsters'>;

/** 図鑑と同じ既存原画の小画像。親の絵へ置き換えず、指定した種の art だけを見る。 */
export function monsterQuestImageUrl(content: Pick<Content, 'bestiary'>, monsterId: string): string | null {
  const art = content.bestiary.species.find((species) => species.id === monsterId)?.art;
  const file = art?.split('/').pop();
  if (!file || !/\.(?:png|webp)$/i.test(file)) return null;
  return assetUrl(`assets/bestiary/${file.replace(/\.png$/i, '.webp')}`);
}

/** 画像や登録簿が無い時も、実装済みの名前、最後は恒久IDを表示する。 */
const monsterName = (content: MonsterContent, monsterId: string): string =>
  content.bestiary.species.find((species) => species.id === monsterId)?.name
  ?? (content.monsters.get(monsterId) ? shortName(content.monsters.get(monsterId)!.name) : monsterId);

function categoryIcon(label: string, glyph: string, kind: string): HTMLSpanElement {
  const root = document.createElement('span');
  root.className = 'quest-mini-icons quest-category-icons';
  root.dataset.activity = kind;
  const picture = document.createElement('span');
  picture.className = 'quest-mini-picture quest-category-glyph';
  picture.setAttribute('aria-hidden', 'true');
  picture.textContent = glyph;
  const text = document.createElement('span');
  text.className = 'quest-mini-label';
  text.textContent = label;
  root.append(picture, text);
  return root;
}

/**
 * 小画像と名前・頭数。画像は飾りなので alt は空。文字と頭数は読み込み成否にかかわらず残る。
 * 複数種はそれぞれの絵と個体数を出し、「合計5頭」などにまとめない。
 * 色・大きさ・object-fit: contain はCSSの quest-mini-* に任せる。
 */
export function questIconStrip(content: MonsterContent, quest: QuestDef): HTMLSpanElement {
  const activity = questActivity(quest);
  if (activity === 'tour') return categoryIcon('採取ツアー', '🌿', activity);
  if (activity === 'gather') return categoryIcon('採集', '🌿', activity);
  if (activity === 'mining') return categoryIcon('採掘', '⛏', activity);
  if (activity === 'field_delivery') return categoryIcon('現地納品', '📦', activity);

  const root = document.createElement('span');
  root.className = 'quest-mini-icons';
  root.dataset.activity = activity;
  const targets = questTargets(quest);
  for (const target of targets) {
    const name = monsterName(content, target.monsterId);
    const tile = document.createElement('span');
    tile.className = 'quest-mini-target';
    tile.dataset.monster = target.monsterId;
    tile.dataset.count = String(target.count);

    const picture = document.createElement('span');
    picture.className = 'quest-mini-picture';
    picture.setAttribute('aria-hidden', 'true');
    const fallback = document.createElement('span');
    fallback.className = 'quest-mini-fallback';
    fallback.textContent = name;
    picture.appendChild(fallback);
    const url = monsterQuestImageUrl(content, target.monsterId);
    if (url) {
      const img = document.createElement('img');
      img.className = 'quest-mini-image';
      img.alt = '';
      img.width = 56;
      img.height = 48;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.dataset.monster = target.monsterId;
      img.addEventListener('error', () => {
        img.remove();
        fallback.hidden = false;
        tile.classList.add('image-missing');
      }, { once: true });
      fallback.hidden = true;
      img.src = url;
      picture.appendChild(img);
    } else tile.classList.add('image-missing');

    const label = document.createElement('span');
    label.className = 'quest-mini-label';
    label.textContent = `${name} ×${target.count}`;
    tile.append(picture, label);
    root.appendChild(tile);
  }
  // 不正な標的データを別種の絵で隠さない。ロード時の検査とは別に、UIも空白にしない。
  if (targets.length === 0) {
    const missing = document.createElement('span');
    missing.className = 'quest-mini-label';
    missing.textContent = '標的未設定';
    root.appendChild(missing);
  }
  return root;
}

/** 里の倉庫から渡す仕事。モンスターの狩猟と混同しないよう別の文を出す。 */
export function deliveryIconStrip(): HTMLSpanElement {
  return categoryIcon('里で納品', '📦', 'warehouse');
}
