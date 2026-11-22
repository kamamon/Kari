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
    }
  | { type: 'part_break'; target: string; partId: string; partIndex: number }
  | { type: 'part_sever'; target: string; partId: string; partIndex: number; pos: V3; yaw: number }
  | { type: 'monster_stagger'; target: string; kind: 'break' | 'flinch' | 'topple' | 'sever'; partIndex: number }
  | { type: 'monster_aware'; target: string }
  | { type: 'monster_rage'; target: string; on: boolean }
  | { type: 'hazard_warn'; id: number; x: number; z: number; radius: number; warnTicks: number }
  | { type: 'hazard_impact'; id: number; x: number; z: number; radius: number }
  | { type: 'hunt_end'; phase: 'success' | 'failed'; reason: 'slay' | 'time' | 'faints' | 'retire' }
  | { type: 'monster_dead'; target: string }
  | { type: 'monster_respawn'; target: string }
  | { type: 'player_hurt'; damage: number; reaction: 'flinch' | 'knockdown'; pos: V3 }
  | { type: 'guard'; damage: number; pos: V3 }
  | { type: 'guard_break'; damage: number; pos: V3 }
  | { type: 'evade'; pos: V3 }
  | { type: 'player_dead' }
  | { type: 'player_respawn' }
  | { type: 'charge_level'; level: number; pos: V3 }
  | { type: 'stamina_empty' };
