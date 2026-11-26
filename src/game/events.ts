// simulation から描画・音・UI へ伝える出来事。simulation は「何が起きたか」だけを出し、演出は受け取った側が決める。
import type { V3 } from '../core/math';
import type { ElementId, StatusKind } from '../data/schemas';

export type SimEvent =
  | { type: 'action_start'; actor: string; actionId: string; instanceId: number }
  | { type: 'action_event'; actor: string; kind: 'sound' | 'trail_on' | 'trail_off' | 'vfx'; id: string; pos: V3 }
  | {
      type: 'hit';
      attacker: string;
      target: string;
      actionId: string;
      windowId: string;
      partId: string;
      partIndex: number;
      damage: number;
      crit: number;
      pos: V3;
      material: string;
      hitstop: number;
      chargeLevel: number;
      tick: number;
      /** 刃が通らず、弾かれた（ダメージは入る。振った側は少しの間よろける） */
      bounced: boolean;
      /** 武器の属性が乗った（v0.33.0。見た目用。複合は 1 つ目の属性） */
      element?: ElementId;
    }
  | { type: 'part_break'; target: string; partId: string; partIndex: number }
  | { type: 'part_sever'; target: string; partId: string; partIndex: number; pos: V3; yaw: number }
  | { type: 'monster_stagger'; target: string; kind: 'break' | 'flinch' | 'topple' | 'sever'; partIndex: number }
  | { type: 'monster_aware'; target: string }
  | { type: 'monster_rage'; target: string; on: boolean }
  | { type: 'hazard_warn'; id: number; x: number; z: number; radius: number; warnTicks: number }
  | { type: 'hazard_impact'; id: number; x: number; z: number; radius: number }
  | { type: 'hunt_end'; phase: 'success' | 'failed'; reason: 'slay' | 'capture' | 'time' | 'faints' | 'retire' | 'deliver' }
  /** 結果が閉じた（報酬が確定した）。これ以後は何も変わらない。 */
  | { type: 'hunt_close' }
  /** 道具を使い始めた / 効果が出た（ok が false なら効果なし。amount は回復量など）/ 使えなかった */
  | { type: 'item_use'; itemId: string; pos: V3 }
  | { type: 'item_effect'; itemId: string; kind: 'heal' | 'trap' | 'tranq' | 'whet' | 'mark'; ok: boolean; amount: number; pos: V3 }
  /** no_need: 研磨石を、刃が最大の時に使おうとした */
  | { type: 'item_fail'; reason: 'empty' | 'not_now' | 'no_need' }
  /** 刃の状態の段階が変わった（当てて下がった、または研いで戻った） */
  | { type: 'edge'; stage: string; value: number }
  | { type: 'trap_armed'; id: number; x: number; z: number }
  | { type: 'trap_trigger'; id: number; target: string; x: number; z: number; ticks: number }
  | { type: 'trap_end'; id: number }
  | { type: 'monster_captured'; target: string }
  /** 剥ぎ取り 1 回分。source は carve（本体）か severed:<部位 id> */
  | { type: 'carve'; itemId: string; source: string; pos: V3 }
  /** 狩らない依頼（v0.27.0）: 採取点から採った（total は、この出発で採った合計） */
  | { type: 'errand_gather'; nodeId: string; itemId: string; count: number; total: number; kind: 'gather' | 'mine'; pos: V3 }
  /** 狩らない依頼: 納品箱へ納めた（達成は、この tick の終わりに決まる） */
  | { type: 'errand_deliver'; pos: V3 }
  | { type: 'monster_dead'; target: string }
  /**
   * モンスターの状態異常（v0.33.0）: 付いた（on）・消えた。poison は体力が減っていく間、para / sleep / stun は動けない間。
   * sleep が命中で覚めた時は woke。pos は付いた時の頭の辺り（見た目用）
   */
  | { type: 'monster_ailment'; target: string; kind: StatusKind; on: boolean; woke?: boolean; pos?: V3 }
  /** 毒のダメージ（v0.33.0）。部位に当たらない（怯み・破壊・怒りには関わらない） */
  | { type: 'ailment_damage'; target: string; kind: StatusKind; damage: number; pos: V3 }
  | { type: 'monster_respawn'; target: string }
  /** フィールド: プレイヤーがエリアを移った / 大型が出口へ歩き出した・別のエリアに着いた・巣で眠った・起きた */
  | { type: 'area_change'; from: string; to: string }
  | { type: 'monster_leave'; target: string; from: string; to: string }
  | { type: 'monster_move'; target: string; areaId: string }
  | { type: 'monster_sleep'; target: string; areaId: string }
  | { type: 'monster_wake'; target: string; byHit: boolean }
  | { type: 'monster_lost'; target: string }
  /** 登攀（v0.44.0。#19 の H07）: start = 取り付いた / exit = 縁に手を掛けた / top = 上の段に立った / bottom = 下まで下りた / release = 手を離した・落とされた */
  | { type: 'climb'; phase: 'start' | 'exit' | 'top' | 'bottom' | 'release'; climbId: string; dir: 'up' | 'down' }
  /** 降下（v0.45.0）: 歩いて段の端から出た（from は出た時の足の高さ）/ 着地: 降りた高さ（m）と、着いた所 */
  | { type: 'drop'; from: number }
  | { type: 'land'; height: number; pos: V3 }
  /** 低い岩棚の乗り越え（v0.49.0）: start = 縁に手を掛け始めた / top = 段の上に立った / release = 途中で落とされた */
  | { type: 'vault'; phase: 'start' | 'top' | 'release'; vaultId: string }
  /** 離れる前の牽制（v0.43.0。#19 の M05）: 戦っている相手の前で、1 度だけ威嚇を見せた。この後、エリアを離れる */
  | { type: 'monster_feint'; target: string; actionId: string }
  /** 突進の制動（v0.41.0）: 走る間に前へ進めなくなり、減速へ進めた（tick は、その時の技の tick） */
  | { type: 'monster_brake'; target: string; tick: number }
  /** 群れ（幼体）: 狩人に気づいた・逃げ出した（騒ぎごとに、段階が上がった時だけ）/ 別のエリアへ移り終えた */
  | { type: 'herd_alarm'; herdId: number; target: string; flee: boolean; pos: V3 }
  | { type: 'herd_move'; herdId: number; from: string; to: string }
  | { type: 'player_hurt'; damage: number; reaction: 'flinch' | 'knockdown'; pos: V3 }
  /** 状態異常が付いた（on）・消えた。sleep / para / stun は動けない間、poison は体力が減っていく間 */
  | { type: 'status'; kind: StatusKind; on: boolean }
  | { type: 'guard'; damage: number; pos: V3 }
  | { type: 'parry'; kind: 'parry' | 'counter'; pos: V3 }
  /** 猛り（双剣。v0.54.0）に入った・解けた。reason: toggle = 固有ボタン / stamina = スタミナが尽きた / sheathe = 抜刀していない（納刀・登攀など）・力尽きた */
  | { type: 'demon'; on: boolean; reason: 'toggle' | 'stamina' | 'sheathe' }
  /** 気（太刀。v0.56.0）が満ちた・満ちていなくなった / 気が無くて気合い斬りを出せなかった */
  | { type: 'spirit'; full: boolean }
  | { type: 'spirit_empty' }
  | { type: 'shoot'; count: number; level: number; pos: V3 }
  | { type: 'guard_break'; damage: number; pos: V3 }
  | { type: 'evade'; pos: V3 }
  | { type: 'player_dead' }
  | { type: 'player_respawn' }
  | { type: 'charge_level'; level: number; pos: V3 }
  | { type: 'stamina_empty' };
