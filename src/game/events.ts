// simulation から描画・音・UI へ伝える出来事。simulation は「何が起きたか」だけを出し、演出は受け取った側が決める。
import type { V3 } from '../core/math';

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
    }
  | { type: 'part_break'; target: string; partId: string; partIndex: number }
  | { type: 'part_sever'; target: string; partId: string; partIndex: number; pos: V3; yaw: number }
  | { type: 'monster_stagger'; target: string; kind: 'break' | 'flinch' | 'topple' | 'sever'; partIndex: number }
  | { type: 'monster_aware'; target: string }
  | { type: 'monster_rage'; target: string; on: boolean }
  | { type: 'hazard_warn'; id: number; x: number; z: number; radius: number; warnTicks: number }
  | { type: 'hazard_impact'; id: number; x: number; z: number; radius: number }
  | { type: 'hunt_end'; phase: 'success' | 'failed'; reason: 'slay' | 'capture' | 'time' | 'faints' | 'retire' }
  /** 結果が閉じた（報酬が確定した）。これ以後は何も変わらない。 */
  | { type: 'hunt_close' }
  /** 道具を使い始めた / 効果が出た（ok が false なら効果なし。amount は回復量など）/ 使えなかった */
  | { type: 'item_use'; itemId: string; pos: V3 }
  | { type: 'item_effect'; itemId: string; kind: 'heal' | 'trap' | 'tranq' | 'whet'; ok: boolean; amount: number; pos: V3 }
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
  | { type: 'monster_dead'; target: string }
  | { type: 'monster_respawn'; target: string }
  /** フィールド: プレイヤーがエリアを移った / 大型が出口へ歩き出した・別のエリアに着いた・巣で眠った・起きた */
  | { type: 'area_change'; from: string; to: string }
  | { type: 'monster_leave'; target: string; from: string; to: string }
  | { type: 'monster_move'; target: string; areaId: string }
  | { type: 'monster_sleep'; target: string; areaId: string }
  | { type: 'monster_wake'; target: string; byHit: boolean }
  | { type: 'monster_lost'; target: string }
  | { type: 'player_hurt'; damage: number; reaction: 'flinch' | 'knockdown'; pos: V3 }
  | { type: 'guard'; damage: number; pos: V3 }
  | { type: 'parry'; kind: 'parry' | 'counter'; pos: V3 }
  | { type: 'momentum'; level: number }
  | { type: 'shoot'; count: number; level: number; pos: V3 }
  | { type: 'guard_break'; damage: number; pos: V3 }
  | { type: 'evade'; pos: V3 }
  | { type: 'player_dead' }
  | { type: 'player_respawn' }
  | { type: 'charge_level'; level: number; pos: V3 }
  | { type: 'stamina_empty' };
