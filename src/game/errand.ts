// 狩らない依頼（採集・採掘・現地の納品。v0.27.0、docs/spec.md の 27 章、ChatGPT のクエスト設計 #9 の G・M・D01）。
// 計算だけ（DOM・Three.js・時刻に触れない）。採った状態と採集袋は、この出発の間だけ持つ（里の持ち物とは別）。
import { GATHER_BAG, type GatherDef, type GatherNodeDef } from '../data/schemas';

/** 採る・納める行動（public/data/actions/player_common.json）。品が入るのは recovery の始まり */
export const GATHER_ACTION = 'player.common.gather';
export const MINE_ACTION = 'player.common.mine';
export const DELIVER_ACTION = 'player.common.deliver';
/** 採取点・納品箱に届く距離（m。プレイヤーの中心から、点の中心まで） */
export const NODE_REACH = 1.7;
export const DEPOT_REACH = 2.1;
/** 採掘の採取点と納品箱は、通り抜けられない（半径 m） */
export const MINE_NODE_RADIUS = 0.6;
export const DEPOT_RADIUS = 0.6;

export interface ErrandState {
  def: GatherDef;
  /** 採った採取点の id（採った順）。エリアを出入りしても戻らない */
  used: string[];
  /** 採集袋: この出発で採った数（素材ごと）。里の倉庫・支給品は入らない */
  bag: Record<string, number>;
  /** 納める行動が、品の入る tick まで進んだ（達成は、この tick の終わりに、失敗の条件と合わせて決める） */
  delivered: boolean;
}

/** いまできること（攻撃ボタンで始める） */
export type ErrandTarget = { kind: 'node'; nodeId: string; actionId: string } | { kind: 'deliver'; actionId: string };

export function createErrand(def: GatherDef): ErrandState {
  return { def, used: [], bag: {}, delivered: false };
}

/** 要る数と、いま袋にある数（素材ごと。要る素材の並び） */
export function errandProgress(e: ErrandState): { itemId: string; have: number; need: number }[] {
  return e.def.needs.map((s) => ({ itemId: s.itemId, have: e.bag[s.itemId] ?? 0, need: s.count }));
}

/** 要る数が、全部そろっているか */
export function errandReady(e: ErrandState): boolean {
  return errandProgress(e).every((p) => p.have >= p.need);
}

/** その採取点の品が、採集袋に入るか（種類の数と、1 種類の数の上限）。入らない時は、採取点を使わない */
export function bagHasRoom(e: ErrandState, n: GatherNodeDef): boolean {
  const have = e.bag[n.itemId] ?? 0;
  if (have === 0 && Object.keys(e.bag).length >= GATHER_BAG.kinds) return false;
  return have + e.def.yieldPerNode <= GATHER_BAG.perItem;
}

/** まだ採っていない採取点（そのエリアの） */
export function openNodes(e: ErrandState, areaId: string | null): GatherNodeDef[] {
  return e.def.nodes.filter((n) => (areaId === null || n.areaId === areaId) && !e.used.includes(n.id));
}

/** 納品で使う数を引いた、余り（成功した時に持ち帰る） */
export function errandSurplus(e: ErrandState): { itemId: string; count: number }[] {
  const out: { itemId: string; count: number }[] = [];
  for (const [itemId, have] of Object.entries(e.bag)) {
    const need = e.def.needs.find((s) => s.itemId === itemId)?.count ?? 0;
    if (have - need > 0) out.push({ itemId, count: have - need });
  }
  return out;
}

/** 採る行動の id（採集 1.5 秒 / 採掘 2.5 秒） */
export const nodeAction = (n: GatherNodeDef): string => (n.kind === 'mine' ? MINE_ACTION : GATHER_ACTION);
