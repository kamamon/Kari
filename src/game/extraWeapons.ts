/**
 * 響笛・銃槍・軽弩・重弩の、狩りの間だけの状態（v0.80.0。ChatGPT の #39 の案を、いまの本体へ合わせて取り込んだ。D-180。docs/spec.md の 33 章）。
 * 演奏の音と旋律の効き目、砲弾と大砲撃の冷却、弾の種類・装填・予備。時計と乱数を使わない（tick と入力だけで決まる）。保存しない（出発のたびに満ちる）。
 * 数（効き目・弾数・時間）は Kari の仮の値（原作の値は測っていない）
 */
import type { ActionRun } from './action';

export const EXTRA_FAMILIES = ['hunting_horn', 'gunlance', 'light_bowgun', 'heavy_bowgun'] as const;
export type ExtraFamily = (typeof EXTRA_FAMILIES)[number];

/** 弾の種類（軽弩・重弩）。0 = 通常弾（1 発）、1 = 貫通弾（3 回まで当たる）、2 = 散弾（3 つに分かれる） */
export const AMMO_NAMES = ['通常弾', '貫通弾', '散弾'] as const;
/** 1 度に込められる数（種類ごと）と、出発の時に持っている数（込めた分を含む） */
const AMMO_CAPACITY: Record<'light_bowgun' | 'heavy_bowgun', readonly number[]> = { light_bowgun: [6, 3, 4], heavy_bowgun: [5, 4, 3] };
const AMMO_STOCK: Record<'light_bowgun' | 'heavy_bowgun', readonly number[]> = { light_bowgun: [60, 30, 24], heavy_bowgun: [48, 30, 20] };
/** 銃槍の砲弾の数と、大砲撃の後の冷却（tick） */
export const SHELL_CAPACITY = 3;
export const BIG_SHELL_COOLDOWN_TICKS = 60 * 75;
/** 響笛の旋律: 音 3 つの並びと効き目。効き目の長さ（tick）と大きさ */
export const HORN_SONGS: Record<string, 'attack' | 'stamina'> = { '123': 'attack', '111': 'attack', '231': 'stamina' };
export const HORN_BUFF_TICKS = 60 * 60;
export const HORN_ATTACK_SCALE = 1.12;
export const HORN_STAMINA_REGEN_SCALE = 1.3;
/** 重弩の据え構え: 次の 1 発の力の倍率と、構えている間の歩く速さの倍率。演奏の間の歩く速さの倍率 */
export const BRACE_SHOT_SCALE = 1.12;
export const BRACE_MOVE_SCALE = 0.55;
export const RECITAL_MOVE_SCALE = 0.8;

export interface ExtraWeaponState {
  family: ExtraFamily;
  /** 込めてある数（銃槍の砲弾、軽弩・重弩の弾） */
  loaded: number;
  /** 選んでいる弾の種類と、込めてある弾の種類（選び直したら、装填するまで射てない） */
  ammo: number;
  loadedKind: number;
  /** 予備の弾（種類ごと。込めた分は含まない） */
  reserve: number[];
  /** 大砲撃の冷却の残り（tick） */
  cooldown: number;
  /** 演奏の構えに入っているか、鳴らした音（新しい 3 つまで） */
  recital: boolean;
  notes: number[];
  /** 旋律の効き目の残り（tick）と種類 */
  buff: number;
  buffKind: 'attack' | 'stamina' | 'none';
  /** 据え構え（重弩）。次の 1 発で解ける */
  brace: boolean;
}

export function makeExtraWeapon(id: string): ExtraWeaponState | null {
  if (!(EXTRA_FAMILIES as readonly string[]).includes(id)) return null;
  const family = id as ExtraFamily;
  const s: ExtraWeaponState = { family, loaded: 0, ammo: 0, loadedKind: 0, reserve: [0, 0, 0], cooldown: 0, recital: false, notes: [], buff: 0, buffKind: 'none', brace: false };
  s.loaded = capacity(s);
  if (family === 'light_bowgun' || family === 'heavy_bowgun') s.reserve = AMMO_STOCK[family].map((n, i) => (i === 0 ? n - s.loaded : n));
  return s;
}

export const isBowgun = (s: ExtraWeaponState | null | undefined): boolean => !!s && (s.family === 'light_bowgun' || s.family === 'heavy_bowgun');

/** いま選んでいる種類を、1 度に込められる数 */
export function capacity(s: ExtraWeaponState): number {
  if (s.family === 'gunlance') return SHELL_CAPACITY;
  if (s.family === 'light_bowgun' || s.family === 'heavy_bowgun') return AMMO_CAPACITY[s.family][s.ammo] ?? AMMO_CAPACITY[s.family][0]!;
  return 0;
}

const prefix = (s: ExtraWeaponState): string => `player.${s.family}.`;

/**
 * いまの状態で実際に出る行動: 演奏の構えの間は、主・副・同時押しが音 1・2・3、固有が構えを解く。砲弾が空なら砲撃は装填、
 * 冷却中の大砲撃は構え直し。弾が空・選んだ種類と違うなら射撃は装填、通常弾でなければ速射は 1 発
 */
export function resolveExtra(s: ExtraWeaponState | null | undefined, id: string): string {
  if (!s || !id.startsWith(prefix(s))) return id;
  const key = id.slice(prefix(s).length);
  const to = (n: string): string => prefix(s) + n;
  if (s.family === 'hunting_horn' && s.recital) {
    const map: Record<string, string> = { swing_left: 'play_note1', swing_right: 'play_note1', poke: 'play_note2', slam: 'play_note3', recital_enter: 'recital_exit' };
    if (map[key]) return to(map[key]!);
  }
  if (s.family === 'gunlance') {
    if (key === 'shell' && s.loaded === 0) return to('reload');
    if (key === 'wyvern_fire' && s.cooldown > 0) return to('guard');
  }
  if (isBowgun(s) && (key === 'fire' || key === 'rapid_fire')) {
    if (s.loaded === 0 || s.loadedKind !== s.ammo) return to('reload');
    if (key === 'rapid_fire' && s.ammo !== 0) return to('fire');
  }
  return id;
}

/** 弾の種類を選び直す（込めてある弾は、装填の時に予備へ戻る） */
export function changeAmmo(s: ExtraWeaponState, delta: number): void {
  if (!isBowgun(s)) return;
  s.ammo = (s.ammo + delta + AMMO_NAMES.length) % AMMO_NAMES.length;
}

/** 毎 tick: 冷却と効き目を進める。納刀・被弾・登攀で、演奏の構えと据え構えを解く。力尽きたら効き目も消える */
export function tickExtra(s: ExtraWeaponState, drawn: boolean, mode: string): void {
  if (s.cooldown > 0) s.cooldown--;
  if (s.buff > 0 && --s.buff === 0) s.buffKind = 'none';
  if (!drawn || mode === 'hurt' || mode === 'dead' || mode === 'climb' || mode === 'vault') {
    s.recital = false;
    s.notes = [];
    s.brace = false;
  }
  if (mode === 'dead') {
    s.buff = 0;
    s.buffKind = 'none';
  }
}

/** 砲撃か（武器の刃・属性・会心を使わない、決まった力の命中） */
export function shellAction(id: string): boolean {
  return id === 'player.gunlance.shell' || id === 'player.gunlance.wyvern_fire';
}

/**
 * 行動の決まる tick（当たりの区間の始め。無ければ後隙の始め）に、1 度だけ状態を変える。途中で止められた装填・音は、数えない。
 * 弾が無い・冷却中で出せなかった時は run.extraAllowed = false（その行動の射撃・命中・音を出さない）
 */
export function extraEvent(s: ExtraWeaponState | null | undefined, run: ActionRun, t: number): void {
  if (!s || !run.def.actionId.startsWith(prefix(s))) return;
  const key = run.def.actionId.slice(prefix(s).length);
  if (key === 'sheathe' && t === 0) {
    s.recital = false;
    s.notes = [];
    s.brace = false;
  }
  if (key === 'draw' || key === 'sheathe') return;
  const at = run.def.phases.find((p) => p.id === 'active')?.from ?? run.def.phases.find((p) => p.id === 'recovery')?.from;
  if (t !== at || run.extraDone) return;
  run.extraDone = true;
  run.extraAllowed = true;
  if (s.family === 'hunting_horn') {
    if (key === 'recital_enter') {
      s.recital = true;
      s.notes = [];
    } else if (key === 'recital_exit') {
      s.recital = false;
      s.notes = [];
    } else if (key.startsWith('play_note')) {
      if (!s.recital) {
        run.extraAllowed = false;
        return;
      }
      s.notes.push(Number(key.slice(-1)));
      if (s.notes.length > 3) s.notes.shift();
      const song = HORN_SONGS[s.notes.join('')];
      if (song) {
        s.buff = HORN_BUFF_TICKS;
        s.buffKind = song;
        s.notes = [];
      }
    }
    return;
  }
  if (s.family === 'gunlance') {
    if (key === 'shell') {
      run.extraAllowed = s.loaded > 0;
      if (run.extraAllowed) s.loaded--;
    } else if (key === 'wyvern_fire') {
      run.extraAllowed = s.cooldown === 0;
      if (run.extraAllowed) s.cooldown = BIG_SHELL_COOLDOWN_TICKS;
    } else if (key === 'reload') s.loaded = capacity(s);
    return;
  }
  if (key === 'charge_stance') s.brace = true;
  else if (key === 'reload') {
    // 選び直していたら、込めてあった弾を予備へ戻してから込める（弾は増えも減りもしない）
    if (s.loadedKind !== s.ammo) {
      s.reserve[s.loadedKind] = (s.reserve[s.loadedKind] ?? 0) + s.loaded;
      s.loaded = 0;
      s.loadedKind = s.ammo;
    }
    const take = Math.max(0, Math.min(capacity(s) - s.loaded, s.reserve[s.ammo] ?? 0));
    s.loaded += take;
    s.reserve[s.ammo] = (s.reserve[s.ammo] ?? 0) - take;
  } else if (key === 'fire' || key === 'rapid_fire') {
    // 速射は 3 つ射って、弾は 1 つ
    run.extraAllowed = s.loaded > 0 && s.loadedKind === s.ammo;
    if (run.extraAllowed) {
      s.loaded--;
      run.extraAmmo = s.ammo;
      run.extraScale = s.brace ? BRACE_SHOT_SCALE : 1;
      s.brace = false;
    }
  }
}

/** HUD に出す 1 行 */
export function extraText(s: ExtraWeaponState): string {
  if (s.family === 'hunting_horn') {
    const buff = s.buff > 0 ? ` / ${s.buffKind === 'stamina' ? '持久' : '攻撃'} ${Math.ceil(s.buff / 60)}秒` : '';
    return (s.recital ? `演奏 ${s.notes.join('・') || '―'}` : '演奏待ち') + buff;
  }
  if (s.family === 'gunlance') return `砲弾 ${s.loaded}/${capacity(s)} / ${s.cooldown ? `冷却 ${Math.ceil(s.cooldown / 60)}秒` : '大砲撃可'}`;
  return `${AMMO_NAMES[s.ammo]} ${s.loadedKind === s.ammo ? s.loaded : 0}/${capacity(s)} / 予備 ${s.reserve[s.ammo] ?? 0}${s.brace ? ' / 据え構え' : ''}`;
}
