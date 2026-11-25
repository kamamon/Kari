import type { BestiaryDef } from './bestiary';
import type { StoryDef } from './story';
// データ定義の型。public/data/*.json はすべてこの形で書き、読み込み時に validators.ts で検証する。
// 「恒久ID」と「表示名」を分ける。名前を変えても id は変えない。

export const SCHEMA_VERSION = 1;

export type Triple = [number, number, number];
export type DamageType = 'cut' | 'blunt' | 'shot';

/** 狩人の状態異常（v0.17.0。docs/spec.md 22 章）。para = 麻痺、stun = 気絶。 */
export type StatusKind = 'poison' | 'para' | 'sleep' | 'stun';
export const STATUS_KINDS: readonly StatusKind[] = ['poison', 'para', 'sleep', 'stun'];
/** 属性（v0.33.0。docs/elements.md の決まり: 火・雷・氷・水・風・霧） */
export type ElementId = 'fire' | 'thunder' | 'ice' | 'water' | 'wind' | 'mist';
export const ELEMENT_IDS: readonly ElementId[] = ['fire', 'thunder', 'ice', 'water', 'wind', 'mist'];
/** 敵の攻撃が狩人へためる状態異常。power が閾値（player.json の status.threshold）に達すると発症する。 */
export interface StatusHit {
  kind: StatusKind;
  power: number;
}
/** 飛び道具・地面の判定の見た目（計算には関わらない）。省くと岩。 */
export type HazardLook = 'rock' | 'mud' | 'spark' | 'ice' | 'mist' | 'poison' | 'para' | 'ash';

export interface PhaseDef {
  id: string;
  from: number;
  to: number;
}

/** 攻撃判定の窓。区間は開始を含み、終了を含まない（1 tick = 1/60 秒）。 */
export interface HitWindowDef {
  id: string;
  from: number;
  to: number;
  shapeTrack: string;
  damageType: DamageType;
  damageCoefficient: number;
  /**
   * 当てる物（v0.33.0）。shield = 盾で打つ（護刃の盾打ち）。武器の属性・状態異常は、武器そのもので当てた時だけ乗る（盾には乗らない）。
   * 省くと武器。属性・状態異常の係数は、その命中の最後の係数（溜め・勢い・矢の距離を掛けた後）を使う（設計 #15。前の elementCoefficient は無くした）
   */
  contact?: 'shield';
  maxHitsPerTarget: number;
  hitstopTicks: number;
  /**
   * 同じ group の時間枠は、1 回の行動で同じ相手に 1 つだけ当たる（先に書いた方が優先）。
   * 「刃」と「柄」のように、1 本の武器を威力の違う 2 つの形で判定する時に使う（v0.5.0 の時点では使う技が無い。旋鎌で使っていた）。
   */
  group?: string;
  // ここから下は「敵 → プレイヤー」の攻撃で使う拡張
  baseDamage?: number;
  guardable?: boolean;
  guardCost?: number;
  reaction?: 'flinch' | 'knockdown';
  /** 当たった時にためる状態異常（防御した時はためない） */
  status?: StatusHit;
}

export interface CancelWindowDef {
  from: number;
  to: number;
  into: string[];
}

export interface ActionEventDef {
  tick: number;
  type: 'sound' | 'trail_on' | 'trail_off' | 'vfx';
  id: string;
}

/** 溜め。holdTick で動作を止め、ボタンを離すと続きへ進む。溜めない場合の時間は元の技と同じ。 */
export interface ChargeDef {
  holdTick: number;
  button: 'main' | 'sub';
  levelTicks: number[];
  maxHoldTicks: number;
  coefficientScale: number[];
  hitstopBonus: number[];
  /** 溜めている間に減るスタミナ（毎秒）。0 になると自動で放つ（環弓）。 */
  staminaPerSec?: number;
}

/** 矢を放つ。speed と coefficient は溜めの段階ごと（溜めの無い技は先頭の値）。 */
export interface ShootDef {
  tick: number;
  count: number;
  spreadDeg: number;
  speed: number[];
  coefficient: number[];
}

export interface ActionDef {
  schemaVersion: number;
  actionId: string;
  clip: string;
  tickRate: number;
  durationTicks: number;
  phases: PhaseDef[];
  /** dirDeg: 進む向き（体の正面からの角度。+90 = 左（+X）、-90 = 右、180 = 後ろ）。省くと正面（v0.17.0） */
  rootMotion: { mode: 'controller' | 'none'; curveId?: string; dirDeg?: number };
  turning?: { untilTick: number; maxDegreesPerSecond: number };
  hitWindows: HitWindowDef[];
  cancelWindows: CancelWindowDef[];
  events: ActionEventDef[];
  onFinish: string;
  // 本作の拡張（設計書の例に無い項目。docs/decisions.md D-004）
  weaponTrack?: string;
  staminaCost?: number;
  invulnerable?: { from: number; to: number }[];
  charge?: ChargeDef;
  hazards?: HazardDef[];
  // ---- 武器 5 系統のための拡張（docs/decisions.md D-052）----
  /** 行動の最中も、スティックで歩ける（環弓の引き絞り）。from/to を省くと行動の全体。 */
  freeMove?: { speed: number; turnDegPerSec: number; from?: number; to?: number };
  /** この区間は、行動の最中でも防御が有効（長尖槍の構え突き）。 */
  guardWindows?: { from: number; to: number }[];
  /** この区間に正面から攻撃を受けると、無傷で into の行動へ移る（長尖槍の受け返し）。 */
  counter?: { from: number; to: number; into: string };
  /** 勢い（双剣）: gain = 当てると 1 段階上がる / spendScale = 始めた時の段階をすべて使い、威力をその段階の倍率にする */
  momentum?: { gain?: boolean; spendScale?: number[] };
  shoot?: ShootDef[];
  /** この区間に、体ごと回る（度。+ が左回り）。v0.5.0 の時点では使う技が無い（旋鎌で使っていた）。武器の軌道は体に対して決まるので、判定も一緒に回る。 */
  spin?: { from: number; to: number; degrees: number };
  /** 左腕の盾の軌道（見た目用。盾打ちでは判定の形と同じ軌道を指す） */
  offhandTrack?: string;
}

/** 移動曲線。keys は [tick, 累積距離m]。controller がこの距離だけ進める。 */
export interface CurveDef {
  id: string;
  keys: [number, number][];
}

export interface TrackKey {
  t: number;
  grip: Triple;
  dir: Triple;
}

/**
 * 武器（や腕）の軌道。アクターのローカル座標で、握り位置 grip と向き dir を tick ごとに持つ。
 * 判定カプセルは grip + dir*from 〜 grip + dir*to、太さ radius。
 * 描画もこの軌道に武器を置くため、見える刃と判定が同じデータから動く。
 */
export interface ShapeTrackDef {
  id: string;
  radius: number;
  from: number;
  to: number;
  planeNormal?: Triple;
  keys: TrackKey[];
}

export interface GuardDef {
  startTicks: number;
  activeFromTick: number;
  endTicks: number;
  recoilTicks: number;
  breakTicks: number;
  arcDegrees: number;
  chipScale: number;
  breakDamageScale: number;
  turnDegPerSec: number;
  pose: { grip: Triple; dir: Triple; planeNormal: Triple };
  /** 防御が有効になってからこの tick 数の間に受けると「受け流し」: 削りもスタミナ消費も後退も無い（護刃）。 */
  parryTicks?: number;
  /** 受け止めた時に下がる距離 (m)。省くと 0.9。 */
  recoilDistance?: number;
}

export interface WeaponFamilyDef {
  id: string;
  name: string;
  twoHanded: boolean;
  drawnMoveSpeed: number;
  drawnTurnDegPerSec: number;
  ready: { grip: Triple; dir: Triple; planeNormal: Triple };
  blade: { from: number; to: number; radius: number };
  actions: {
    main: string;
    sub: string;
    drawAttack: string;
    draw: string;
    sheathe: string;
    /** 固有ボタンの技（防御の無い武器。双剣の連ね斬り、太刀の兜割り） */
    special?: string;
    /** 防御を構えている時の、主・副ボタンの技（長尖槍の構え突き・受け返し） */
    guardMain?: string;
    guardSub?: string;
    /** 回避の行動。省くと共通の転がる回避。 */
    dodge?: string;
  };
  cancelNames: Record<string, string>;
  /** cancelNames の技を、どのボタンで出すか。省いた名前は、actions.main / sub と同じ技ならそのボタン。 */
  cancelButtons?: Record<string, 'main' | 'sub' | 'special'>;
  guard: GuardDef | null;
  /** 抜刀したまま道具を使える（護刃） */
  itemsWhileDrawn?: boolean;
  /**
   * 刃の状態（15 章の次、16 章）。wearPerMotion: 当てるたびに、技の威力の係数 × この値だけ減る。
   * label は画面に出す名前（刃 / 打面）。省くと、この系統に刃の状態は無い（環弓）。
   */
  edge?: { wearPerMotion: number; label: string };
  /** 勢い（双剣）。段階ごとの威力の倍率と、行動の時間の倍率（1 より小さいと速い）。 */
  momentum?: { max: number; decayTicks: number; damageScale: number[]; speedScale: number[] };
  // ---- ここから下は見た目だけに使う ----
  /** 両手で持つ時、もう片方の手を握りから dir の向きへ何 m 離すか。省くと 0.2。 */
  otherHandAlong?: number;
  /** 軌道の握りを、どちらの手で持つか。省くと右。環弓は左手で弓を持ち、右手で弦を引く。 */
  primaryHand?: 'right' | 'left';
  /** 左手に持つもの（盾、または双剣のもう 1 本）と、構えていない時・防御の時の盾の位置（アクターのローカル座標） */
  offhand?: 'shield_small' | 'shield_great' | 'blade_left';
  offhandReady?: Triple;
  offhandGuard?: Triple;
  /** 納刀した武器を付ける場所。省くと背中。 */
  sheathSocket?: 'back' | 'hip';
  /** ボタンの表示名。special を省くと、固有ボタンを隠す。 */
  labels?: { main: string; sub: string; special?: string; dodge?: string };
  /** 拠点の武器選びに出す、ひとことの説明 */
  summary?: string;
}

export interface WeaponDef {
  id: string;
  family: string;
  name: string;
  attack: number;
  /**
   * 属性。type は 'none'・属性の id（単属性）・'compound'（複合。elements に 2 つ）。value は属性値（v0.33.0 から働く）。
   */
  element: { type: string; value: number; elements?: ElementId[] };
  /** 状態異常（v0.33.0）: 武器の接触の命中で、モンスターへためる。potency は基礎の蓄積（1 命中、技の係数 1 あたり） */
  status?: { kind: StatusKind; potency: number };
  affinity: number;
  sharpnessModifier: number;
  assetId: string;
  /** 最初から持っている武器（新しい保存データへ配る） */
  starter?: boolean;
  /** 系列（v0.32.0。ChatGPT の全装備四級版 #15 の series の id）と級（ranks の id）。級の開いていない物は作れない */
  series?: string;
  rankId?: string;
}

/** 刃の状態の 1 段階。値が min 以上（で、上の段階の min 未満）の時にこの段階になる。 */
export interface EdgeStageDef {
  id: string;
  name: string;
  min: number;
  /** ダメージ式の「刃補正」へ掛ける倍率 */
  damageScale: number;
  /** 当てた部位の物理部位係数がこれより小さいと、弾かれる */
  bounceBelow: number;
}

/** 刃の状態の決まり（全武器で共通）。段階は、鋭い順（min の大きい順）に並べる。最後の min は 0。 */
export interface EdgeRules {
  max: number;
  stages: EdgeStageDef[];
  /** 弾かれた時: 減り方の倍率、動けない時間、後ろへ下がる距離 */
  bounce: { wearScale: number; recoilTicks: number; pushback: number };
}

/**
 * 工房で作るもの。kind: upgrade は、持っている武器（fromWeaponId）を素材と通貨で別の武器に変える。
 * 元の武器は無くなる。必要な数の確認・減算・武器の入れ替えは、保存の 1 回の書き込みの中で行う（src/save/profile.ts）。
 */
export type RecipeDef = WeaponRecipeDef | ArmorRecipeDef | WeaponCraftDef | ArmorCraftDef;

/** 武器の強化: 持っている武器（fromWeaponId）を、素材と通貨で別の武器（resultWeaponId）に変える。 */
export interface WeaponRecipeDef {
  id: string;
  kind: 'upgrade';
  fromWeaponId: string;
  resultWeaponId: string;
  cost: { money: number; items: ItemStack[] };
}

/** 防具の強化: 持っている防具（fromArmorId）を、同じ部位の別の防具（resultArmorId）に変える。 */
export interface ArmorRecipeDef {
  id: string;
  kind: 'armor_upgrade';
  fromArmorId: string;
  resultArmorId: string;
  cost: { money: number; items: ItemStack[] };
}

/** 武器を作る（v0.32.0。ChatGPT の全装備四級版 #15 の直接生産）: 元の武器を使わず、素材と通貨で新しい武器（resultWeaponId）を持つ。 */
export interface WeaponCraftDef {
  id: string;
  kind: 'craft';
  resultWeaponId: string;
  cost: { money: number; items: ItemStack[] };
}

/** 防具を作る（v0.32.0）: 元の防具を使わず、新しい防具（resultArmorId）を持つ。 */
export interface ArmorCraftDef {
  id: string;
  kind: 'armor_craft';
  resultArmorId: string;
  cost: { money: number; items: ItemStack[] };
}

/** レシピの結果が武器か（強化・作るのどちらも） */
export const recipeIsWeapon = (r: RecipeDef): r is WeaponRecipeDef | WeaponCraftDef => r.kind === 'upgrade' || r.kind === 'craft';
/** レシピの元（作るレシピは null）と結果の ID（武器でも防具でも） */
export const recipeFrom = (r: RecipeDef): string | null => (r.kind === 'upgrade' ? r.fromWeaponId : r.kind === 'armor_upgrade' ? r.fromArmorId : null);
export const recipeResult = (r: RecipeDef): string => (recipeIsWeapon(r) ? r.resultWeaponId : r.resultArmorId);

/** 防具の部位（並び順は表示の順） */
export const ARMOR_SLOTS = ['head', 'chest', 'arms', 'waist', 'legs'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export interface ArmorDef {
  id: string;
  slot: ArmorSlot;
  name: string;
  /** 防御力。身に着けている 5 部位の合計で、受けるダメージが減る */
  defense: number;
  /** 最初から持っている防具（新しい保存データへ配る） */
  starter?: boolean;
  /** 見た目（素材台帳の id）。同じ式・同じ段の 5 部位は、同じ id を持つ。無ければ、着ても姿は変わらない（里の装束） */
  assetId?: string;
  /** 系列と級（v0.32.0。WeaponDef と同じ） */
  series?: string;
  rankId?: string;
  /** 属性の耐性（v0.33.0。1 部位の値。5 部位と技能を足して -30〜30） */
  resist?: Partial<Record<ElementId, number>>;
  /** 技能（v0.33.0。1 部位 1 点。element・status は、耐性の技能の対象） */
  skill?: ArmorSkill;
}

/** 防具の技能（v0.33.0。ChatGPT の全装備四級版 #15 の 16 技能。public/data/skills.json） */
export interface ArmorSkill {
  id: string;
  points: number;
  element?: ElementId;
  status?: StatusKind;
}

/** 技能の決まり（public/data/skills.json。npm run equipment:gen が設計の rules から作る） */
export interface SkillDef {
  id: string;
  name: string;
  /** Lv1〜3 の値 */
  values: [number, number, number];
  unit: string;
  effect: string;
}

/**
 * 属性と状態異常の決まり（public/data/elements.json。v0.33.0。docs/elements.md・ChatGPT の全装備四級版 #15 の rules）。
 * 部位の属性係数 = 部位の elementZone × （弱点 weak / 耐性 resist / ほか 1）。弱点と耐性はモンスターの登録簿の weak・resist。
 */
export interface ElementRules {
  elements: { id: ElementId; name: string }[];
  /** 部位の elementZone に掛ける倍率 */
  zone: { weak: number; resist: number };
  /** 複合: 2 つの属性のどちらも相手の弱点でない時の倍率 */
  compoundNonWeak: number;
  /** モンスターの攻撃のうち、属性の分（登録簿の elements が none でない種）。狩人の耐性で減る */
  monsterElementShare: number;
  /** 狩人の属性の耐性の範囲 */
  resistRange: [number, number];
  /** 会心率の上限（%） */
  critCap: number;
  /** 急所観察の、物理の部位係数の下限 */
  weakCritHitzone: number;
  /** モンスターの状態異常 */
  ailment: MonsterAilmentRules;
}

export interface MonsterAilmentRules {
  /** 初めの閾値と、発症するたびの伸び（毒・麻痺・睡眠 / 気絶） */
  threshold: number;
  growth: number;
  stunGrowth: number;
  /** 最後にためてから減り始めるまで（tick）と、1 秒あたりの減り */
  decayDelayTicks: number;
  decayPerSec: number;
  /** 動けない状態の長さ（tick） */
  para: { ticks: number };
  sleep: { ticks: number; wakeScale: number };
  stun: { ticks: number };
  /** 毒: 最大体力のこの割合（切り捨て）を、ticks の間に hits 回に分けて減らす */
  poison: { hpRatio: number; ticks: number; hits: number };
  /** 動けない状態の後、ほかの動けない状態のゲージを閾値の手前に抑える時間（tick） */
  lockGraceTicks: number;
  /** 打撃の命中が頭へ当たった時の気絶の蓄積（技の係数 1 あたり。Claude が決めた仮の値） */
  stunPerMotion: number;
}

/** 防具の決まり。受けるダメージ = 元のダメージ × base / (base + 防御力の合計) */
export interface ArmorRules {
  base: number;
  slotNames: Record<ArmorSlot, string>;
}

/**
 * 段階（依頼と、そこに出る個体の強さの区分）。order は 1 から続き番号。
 * monster は、モンスターの元の定義へ掛ける倍率（すべて 1 なら元のまま）:
 * hpScale = 体力と怒りの必要量 / partScale = 部位の耐久・怯み・切断の必要量 / attackScale = 与えるダメージ / cooldownScale = 技と技の間隔。
 */
export interface RankDef {
  id: string;
  order: number;
  name: string;
  monster: { hpScale: number; partScale: number; attackScale: number; cooldownScale: number };
}

/** 部位の当たり形状。b が無ければ球、あればカプセル。モンスターのローカル座標。 */
export interface HurtShapeDef {
  a: Triple;
  b?: Triple;
  r: number;
}

export interface MonsterPartDef {
  id: string;
  name: string;
  hitzone: Record<DamageType, number>;
  elementZone: number;
  breakDurability: number | null;
  material: 'rock' | 'hide' | 'shell';
  /** 頭（v0.33.0）。気絶は、打撃が頭の部位に当たった時だけたまる（部位の並びの先頭を頭と決めない） */
  head?: boolean;
  shapes: HurtShapeDef[];
  /** 破壊後の肉質（無ければ破壊前と同じ） */
  brokenHitzone?: Record<DamageType, number>;
  /** 怯みの蓄積。threshold に達すると怯み、次の threshold は growth だけ上がる（永久拘束を防ぐ）。topple なら転倒。 */
  flinch?: { threshold: number; growth: number; ticks: number; topple?: boolean };
  /** 切断。切断属性のダメージだけが蓄積する。切断後は当たり形状が shapesAfter に替わる。 */
  sever?: { threshold: number; staggerTicks: number; shapesAfter: HurtShapeDef[] };
}

export interface MonsterAiChoice {
  actionId: string;
  minDist: number;
  maxDist: number;
  maxAngleDeg: number;
  weight: number;
  /** 正面からの角度の下限（後方用の技など） */
  minAngleDeg?: number;
  /** プレイヤーがモンスターの左右どちらに居る時だけ使うか */
  side?: 'left' | 'right';
  /** この技だけの再使用待ち */
  cooldownTicks?: number;
  /** 正面にこの距離だけ空きが必要（壁際で突進しない） */
  clearAhead?: number;
  /** 指定の部位が切断済みなら、代わりにこの技を使う */
  ifSevered?: { partId: string; actionId: string };
}

/** 技が生む落下物など。出現位置は出た時点で固定し、予告の後に判定が出る。 */
export interface HazardDef {
  tick: number;
  count: number;
  spread: number;
  radius: number;
  warnTicks: number;
  activeTicks: number;
  baseDamage: number;
  reaction: 'flinch' | 'knockdown';
  /** 岩が打ち上がる場所（モンスターのローカル座標。尾の先・前脚の前など）。ここから弧を描いて落ちる。省くと真上から。 */
  origin?: Triple;
  /** 弧のいちばん高い所 (m) */
  peak?: number;
  /** around（省略時）= 狙った位置のまわりへ散らす / line = 打ち上げた場所から狙った位置へ、一列に並べる */
  pattern?: 'around' | 'line';
  /** 当たった時にためる状態異常 */
  status?: StatusHit;
  /** 見た目（岩・泥・雷・氷・霧・毒・痺液・灰）。省くと岩 */
  look?: HazardLook;
}

export interface MonsterDef {
  schemaVersion: number;
  id: string;
  name: string;
  rigFamily: string;
  assetId: string;
  hp: number;
  bodyRadius: number;
  turnDegPerSec: number;
  captureAllowed: boolean;
  /**
   * 属性の印（v0.33.0。登録簿の elements・weak・resist と同じ。docs/spec.md の 30 章）。
   * element: 技の属性（無属性は省く）。攻撃の elements.json の monsterElementShare が、この属性になる（ハンターの耐性で変わる）。
   * weak / resist: 部位の属性の係数（elementZone）を、弱点の属性は zone.weak 倍、耐性の属性は zone.resist 倍にする。
   */
  element?: ElementId;
  weak?: ElementId[];
  resist?: ElementId[];
  lootId: string | null;
  /** 段階ごとの素材の表（段階の id → loot の id）。書いていない段階は lootId を使う。 */
  lootByRank?: Record<string, string>;
  /**
   * 捕獲の条件（captureAllowed の時に使う）。体力が hp × hpRatio 以下で「弱った」状態になり、
   * その間に罠にかかっていて、鎮静玉が tranqNeeded 個たまっていると捕獲が成立する。
   * 鎮静玉の効き目は、最後に当ててから tranqDecayTicks で消える。
   */
  capture?: { hpRatio: number; tranqNeeded: number; tranqDecayTicks: number };
  respawnTicks: number | null;
  breakStaggerTicks: number;
  /** 歩く速さ (m/s)。無ければその場から動かない。 */
  moveSpeed?: number;
  /** プレイヤーが通り抜けられない円（体の前後方向 z にずらして並べる）。無ければ bodyRadius の円 1 つ。 */
  collision?: { z: number; r: number }[];
  /** 技を出していない間の間合い取り */
  approach?: { stopDist: number; faceDeg: number };
  /** 発見。気付くまでは動かない。 */
  discover?: { range: number; fovDeg: number; closeRange: number; actionId: string } | null;
  /** 怒り。受けたダメージが threshold に達すると durationTicks の間続く。 */
  rage?: { threshold: number; durationTicks: number; actionId: string; speedScale: number; damageScale: number; cooldownScale: number };
  parts: MonsterPartDef[];
  ai: {
    aggroRange: number;
    cooldownTicks: [number, number];
    choices: MonsterAiChoice[];
  };
  /** 幼体の親（成体のモンスターの id。v0.18.0）。同じエリアで子が攻撃されると、親が気づく */
  parentId?: string;
  /** 群れで暮らす（幼体。v0.18.0。src/game/herd.ts）。あると、ふだんは群れの動きをして、追い詰められた時と攻撃された時だけ技を出す */
  herd?: HerdDef;
  /**
   * 攻撃を受ける部位の追従（v0.25.0。読み込みの時に public/data/follow/ から付ける。JSON には書かない）。
   * 技の間（と眠っている間）、部位の形を、動きの中の位置へ動かす（src/game/follow.ts）
   */
  follow?: FollowTable;
}

/**
 * 部位の追従のデータ（public/data/follow/<種>.json。v0.25.0、ChatGPT の設計提案 #6）。npm run monsters:bake が、描画の動きから作る
 * （戦闘はこの表だけを読む。描画の骨を、戦闘の正本にしない）。
 * d は、部位の形の端 a・b の、形を作った時の位置からのずれ（cm の整数）を、step tick ごとに並べたもの（[ax, ay, az, bx, by, bz] の列）。
 * 鍵の tick は min(k × step, 技の長さ − 1)。動きが 5cm に満たない形は書かない（動かない）。
 */
export interface FollowShapeDef {
  part: string;
  /** 部位の shapes の何番目か */
  i: number;
  d: number[][];
}
export interface FollowSetDef {
  shapes: FollowShapeDef[];
}
export interface FollowDef {
  schemaVersion: number;
  monsterId: string;
  step: number;
  note?: string;
  /** 技の id → 動き */
  actions: Record<string, FollowSetDef>;
  /** 技以外の、決まった姿勢（sleep = 眠っている・捕獲された） */
  poses?: Record<string, FollowSetDef>;
}
/** 読み込んだ後の形: [部位の番号][形の番号] → ずれの列（cm。鍵ごとに 6 つ）か null */
export interface FollowTable {
  step: number;
  actions: Map<string, (Int16Array | null)[][]>;
  sleep: (Int16Array | null)[][] | null;
}

/**
 * 群れの決まり（種ごと。v0.18.0、docs/spec.md の 23 章）。距離は m、時間は tick。
 * 気づく → 顔を上げて見る（alert）→ 近づかれると逃げる（flee）。攻撃されると、fightChance で向き直って反撃する。
 */
export interface HerdDef {
  /** 1 つの群れの頭数（登録簿の pack） */
  size: [number, number];
  /** 群れの中で、隣と空ける間 */
  spacing: number;
  /** 狩人に気づいて、顔を上げる距離 / 逃げ出す距離 */
  alertRange: number;
  fleeRange: number;
  /** 逃げる速さ（moveSpeed に掛ける）と、走り続けられる時間（過ぎると、息を整えるまで止まる） */
  fleeSpeedScale: number;
  fleeTicks: number;
  /** 攻撃された時に、向き直って反撃する確率（0〜1）と、反撃を続ける時間 */
  fightChance: number;
  fightTicks: [number, number];
  /** 逃げる時に、ばらばらの向きへ散る（甲殻の幼体）。false なら、群れの真ん中へ寄りながら逃げる */
  scatter: boolean;
}

/** 狩場に住む群れ（v0.18.0）。areas の順に、ときどき移り住む。native でない群れは、親か自分が依頼の標的の時だけ出る */
export interface FieldHerdDef {
  monsterId: string;
  areas: string[];
  native: boolean;
}

export interface MapDef {
  schemaVersion: number;
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  stepUp: number;
  /** 一歩で下りられる高さ（v0.31.0。里の段の縁から落ちない）。無ければ、どこまでも下りられる */
  stepDown?: number;
  spawn: { x: number; z: number; yaw: number };
  camp: { x: number; z: number; r: number };
  monsterSpawn: { x: number; z: number; yaw: number };
  /** 当たりの円柱。h は上の端、y は下の端（無ければ 0。カメラだけが使う。v0.31.0） */
  rocks: { x: number; z: number; r: number; h: number; y?: number }[];
  /** 段差。h は上の面の高さ（v0.31.0 から 0 より低くてもよい: 里の下の段と階段）。look は描き方（PlatformLook。simulation は読まない） */
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number; look?: PlatformLook }[];
}

/**
 * 段差の描き方（simulation は読まない）。'yard' 踏み固めた土 / 'stone' 石段・踊り場 / 'grass' 草地（v0.35.0）/
 * 'water' 沢の水面（v0.35.0。歩いては入れない高さに置く）/ 'bridge' 吊り橋の板（下に擁壁を描かない）/ 'rock' 岩の床（歩いては行けない所）
 */
export type PlatformLook = 'yard' | 'stone' | 'grass' | 'water' | 'bridge' | 'rock';
export const PLATFORM_LOOKS: readonly PlatformLook[] = ['yard', 'stone', 'grass', 'water', 'bridge', 'rock'];

/** フィールドの出口。入ると、行き先のエリアの arrive へ移る。large が付いた出口は、大型モンスターも通る（arriveLarge へ出る）。 */
export interface FieldExit {
  to: string;
  x: number;
  z: number;
  r: number;
  arrive: { x: number; z: number; yaw: number };
  large?: boolean;
  arriveLarge?: { x: number; z: number; yaw: number };
}

/** フィールドのエリア。形（bounds・岩・段差）は MapDef と同じ決まり。座標は、フィールド全体で 1 つの空間。 */
export interface FieldAreaDef {
  id: string;
  /** 画面に出す番号（0 = 野営地） */
  no: number;
  name: string;
  kind: 'camp' | 'hunt' | 'path' | 'nest';
  /** 大型モンスターが入れる */
  large: boolean;
  /** 地図の上のマス（列、行。行は北が大きい） */
  grid: [number, number];
  /** 外周を囲む四角（shape の点の、いちばん外） */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /**
   * 歩ける範囲の外周（v0.20.0。自然な形。docs/spec.md の 18.4）。[x, z] の点の列（1.6m ほどおき）。
   * 当たり（src/game/world.ts）と、岩壁の形（src/render/arena.ts）の正本。
   */
  shape?: [number, number][];
  /** 道しるべ（v0.20.0）。外周に遮られて目当てが見えない時に、ここを伝って歩く（どの 2 点も、道でつながる） */
  nav?: [number, number][];
  /** エリアの中心（必ず歩ける所。大型が出てくる所・寝床・群れの目安） */
  center?: { x: number; z: number };
  /** エリアの広さの種類（v0.20.0）: narrow = 狭い谷・沢、wide = 広くて戦いやすい原、medium = その間 */
  size?: 'narrow' | 'medium' | 'wide';
  stepUp: number;
  rocks: { x: number; z: number; r: number; h: number }[];
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[];
  exits: FieldExit[];
}

/** 大型の移動と休息の決まり（src/game/roam.ts）。 */
export interface RoamRules {
  stayTicks: [number, number];
  /**
   * 次のエリアへ出ていく時の速さ（m/s。v0.20.0）。狩人が走っても追いつけない速さにする（狩人の走る速さ sprintSpeed の
   * 1.15 倍より速い。弱って巣へ向かう時は limpLeaveSpeed で、1.05 倍より速い）。出ていく間は、攻撃してこないので。
   * 向きを変える速さは、ふだんの leaveTurnScale 倍。
   */
  leaveSpeed: number;
  limpLeaveSpeed: number;
  leaveTurnScale: number;
  /** 巣の中で、寝床まで歩く速さ（moveSpeed に掛ける。気づいていない時だけ） */
  limpSpeedScale: number;
  limpHpRatio: number;
  sleepTicks: number;
  /** 眠っている間に 1 秒で戻る体力（最大体力に対する割合）と、戻る上限 */
  sleepHealPerSec: number;
  sleepHealCap: number;
  wakeStayTicks: number;
  /** 気づいていない間のぶらつき: 速さ（歩く速さに掛ける）、立ち止まる時間、エリアの縁から離す距離 */
  wanderSpeedScale: number;
  wanderIdleTicks: [number, number];
  wanderInset: number;
  /** 気づいた相手が別のエリアへ行ってから、見失うまでの時間 */
  loseSightTicks: number;
}

/**
 * フィールド = エリアに分かれた狩場（D-066）。野営地から出発し、出口でエリアを移る。大型は routes のとおりに巡り、弱ると nest で眠る。
 * legacyMapId / legacyAreaId: エリアに分ける前の狩場（MapDef）と、それにあたるエリア。形と位置が同じであること。
 */
export interface FieldDef {
  schemaVersion: number;
  id: string;
  name: string;
  legacyMapId: string;
  legacyAreaId: string;
  start: { areaId: string; x: number; z: number; yaw: number };
  camp: { x: number; z: number; r: number };
  /** フィールドで狩る時に、依頼の制限時間へ掛ける倍率（歩いて探す・標的が移動する、のぶん） */
  timeLimitScale: number;
  roam: RoamRules;
  routes: Record<string, { start: string; roam: string[]; nest: string }>;
  /** 群れ（幼体）の住みか（v0.18.0）。無ければ群れは居ない */
  herds?: FieldHerdDef[];
  areas: FieldAreaDef[];
}

/** 里の商店（public/data/shop.json）。goods = 売っている道具、sell = 素材の買い取り値。 */
export interface ShopDef {
  schemaVersion: number;
  /** 1 つの道具を持っておける数 */
  holdMax: number;
  goods: { itemId: string; price: number }[];
  sell: { itemId: string; price: number }[];
}

export type FacilityKind = 'quest' | 'workshop' | 'shop' | 'chest';

/** 拠点の施設。(x, z) から半径 r の中で主ボタンを押すと、kind の画面が開く。building は建物の位置と向き（見た目用）。 */
export interface FacilityDef {
  id: string;
  kind: FacilityKind;
  name: string;
  /** ボタンに出す言葉（「工房に入る」） */
  action: string;
  summary: string;
  x: number;
  z: number;
  r: number;
  building: { x: number; z: number; yaw: number };
}

/**
 * 里に立つ人（v0.23.0）。見た目は絵の板（art は src/render/npcArt.ts の名前）。当たりは、map の rocks に同じ位置の円を置く。
 * yaw は向いている方（正面）。名前の表示名は仮（物語の人物。docs/spec.md の 24 章）。
 */
export interface HubNpcDef {
  id: string;
  name: string;
  /** 施設の係（その施設の近くに立つ）。無ければ、ただ立っている人 */
  facility?: string;
  art: string;
  x: number;
  z: number;
  yaw: number;
}

/** 里の外周の出口（v0.35.0。見た目だけ。外周の崖に口を開ける）。marker は門柱、trail は外へ続く道 */
export interface HubGateDef {
  id: string;
  name: string;
  x: number;
  z: number;
  marker?: boolean;
  trail?: boolean;
}

/** 里の建物と飾り（v0.35.0。施設ではないもの）。当たりは maps の rocks（tools/gen-hub.py が kind ごとの形から作る） */
export type HubSceneryKind =
  | 'lamp' | 'records' | 'shed' | 'logs' | 'crates' | 'tank' | 'mill' | 'wash' | 'storehouse' | 'lift'
  | 'inn' | 'firewood' | 'house' | 'field' | 'laundry' | 'hall' | 'survey' | 'watch' | 'anvil';
export const HUB_SCENERY_KINDS: readonly HubSceneryKind[] = [
  'lamp', 'records', 'shed', 'logs', 'crates', 'tank', 'mill', 'wash', 'storehouse', 'lift', 'inn', 'firewood', 'house', 'field', 'laundry', 'hall', 'survey', 'watch', 'anvil',
];
export interface HubSceneryDef {
  id: string;
  kind: HubSceneryKind;
  name: string;
  x: number;
  z: number;
  /** 正面の向き（建物の正面は、局所の +z） */
  yaw: number;
}

/** 小物の絵の名前（v0.35.0。src/render/propArt.ts の名前と同じ。検査が両方を照らす） */
export const HUB_PROP_ARTS = ['route_lamp_on', 'route_lamp_off', 'supply_cart', 'replaceable_parts', 'closed_route_sign', 'record_board'] as const;

/** 里に立てる小物の絵（v0.35.0。ChatGPT の物語の原画 #13 の小物。カメラの方を向く板）。art は HUB_PROP_ARTS の名前 */
export interface HubPropDef {
  id: string;
  art: string;
  x: number;
  z: number;
}

/** 拠点（public/data/hub.json）。里を歩く場所（mapId）と、施設の並び。 */
export interface HubDef {
  schemaVersion: number;
  id: string;
  name: string;
  mapId: string;
  facilities: FacilityDef[];
  npcs?: HubNpcDef[];
  gates?: HubGateDef[];
  scenery?: HubSceneryDef[];
  props?: HubPropDef[];
}

/** プレイヤーの初期調整値（設計書 p.09）。本作独自の値で、実機の手触りを見て調整する。 */
export interface PlayerTuning {
  schemaVersion: number;
  maxHp: number;
  maxStamina: number;
  radius: number;
  height: number;
  walkSpeed: number;
  sprintSpeed: number;
  turnDegPerSec: number;
  sprintCostPerSec: number;
  sprintRestartStamina: number;
  staminaRegenPerSec: number;
  staminaRegenDelayTicks: number;
  inputBufferTicks: number;
  rollActionId: string;
  flinchTicks: number;
  knockdownTicks: number;
  knockdownInvulnTicks: number;
  respawnTicks: number;
  critMultiplier: number;
  gravity: number;
  /** 訓練場（依頼ではない時）に持たせる道具。省くと無し */
  trainingSupplies?: ItemStack[];
  /** 状態異常（v0.17.0）。省くと src/game/player.ts の既定値 */
  status?: StatusTuning;
}

/**
 * 状態異常の決まり。攻撃ごとの power をため、threshold で発症する（ためた値は 0 へ戻る）。ためた値は毎秒 decayPerSec ずつ減る。
 * poison: ticks の間、intervalTicks ごとに damage 減る（体力は 1 より下がらない）。para / sleep / stun: ticks の間、動けない。
 * 眠っている間に攻撃を受けると起きる（その攻撃の怯み・転倒になる）。
 */
export interface StatusTuning {
  threshold: number;
  decayPerSec: number;
  poison: { ticks: number; intervalTicks: number; damage: number };
  para: { ticks: number };
  sleep: { ticks: number };
  stun: { ticks: number };
}

/** 依頼。狩り（slay・hunt）と、狩らない依頼（gather。v0.27.0: 採集・採掘・現地の納品）。 */
export interface QuestDef {
  id: string;
  name: string;
  /**
   * slay: 討伐だけで達成（捕獲はできない）。hunt: 討伐でも捕獲でも達成。
   * gather（v0.27.0）: この出発で採った素材を、野営地の納品箱へ届けて達成（モンスターの標的は無い。倒しても達成にならない）。
   */
  kind: 'slay' | 'hunt' | 'gather';
  summary: string;
  mapId: string;
  /** 狩りの標的（slay・hunt では要る。gather には無い。ダミーの標的を置かない） */
  targetMonsterId?: string;
  /**
   * 群れの依頼（v0.18.0）: 種ごとに、討伐する頭数。全部そろうと達成（捕獲は無い。kind は slay）。
   * 無ければ、これまでどおり targetMonsterId を 1 体。あれば targetMonsterId は 1 つ目の種と同じにする。
   */
  targets?: QuestTarget[];
  /** 段階（ranks.json の id）。標的の強さと、出る素材が決まる。 */
  rankId: string;
  /** フィールド（エリアに分かれた狩場）。あれば、野営地から出発し、標的はエリアを移動する。mapId は、その中の「これまでの狩場」にあたるエリア */
  fieldId?: string;
  /** 受けるために、先に 1 回は達成しておく依頼（無ければ最初から受けられる）。 */
  requires?: string[];
  /** 標的の出る位置（slay・hunt では要る。gather には無い） */
  monsterSpawn?: { x: number; z: number; yaw: number };
  /** 狩らない依頼の中身（kind: gather の時だけ。v0.27.0、docs/spec.md の 27 章） */
  gather?: GatherDef;
  /** 制限時間（1 つの狩場 `?hunt=arena` の値。フィールドでは、狩場の timeLimitScale を掛ける。fieldTimeLimitTicks があれば、そちら） */
  timeLimitTicks: number;
  /**
   * フィールドで狩る時の制限時間（最終の値。v0.26.0、ChatGPT のクエスト設計 #9 の「明示した狩場の時間」）。
   * あれば、狩場の倍率を掛けずに、そのまま使う。無ければ timeLimitTicks × timeLimitScale（これまでどおり）。
   */
  fieldTimeLimitTicks?: number;
  maxFaints: number;
  /** 依頼の掲示（v0.26.0。public/data/quest_board.json。読み込みの時に付ける。JSON には書かない） */
  board?: QuestBoardEntry;
  /** この依頼でモンスターの攻撃・落石が与えるダメージの倍率（省略時 1）。 */
  monsterAttackScale?: number;
  /** 達成してから拠点へ戻るまでの時間（剥ぎ取りに使える時間）。省略時 3600。 */
  returnTicks?: number;
  /** 出発の時に支給する道具 */
  supplies?: ItemStack[];
  /** 達成した時の報酬（失敗・リタイアでは出ない） */
  rewards?: { money: number; items: ItemStack[] };
}

export interface QuestTarget {
  monsterId: string;
  count: number;
}

/** 依頼の標的（種ごとの頭数）。群れの依頼は targets、1 体の標的の依頼は [標的, 1]、狩らない依頼（gather）は空 */
export function questTargets(q: Pick<QuestDef, 'targets' | 'targetMonsterId'>): QuestTarget[] {
  if (q.targets) return q.targets;
  return q.targetMonsterId ? [{ monsterId: q.targetMonsterId, count: 1 }] : [];
}

/** 採取点（v0.27.0）。1 か所で 1 度だけ、yieldPerNode 個を確実に採れる（抽選しない）。採った状態は、エリアを出入りしても戻らない */
export interface GatherNodeDef {
  /** 依頼の中で重ならない id */
  id: string;
  /** gather: 採集（草・実。1.5 秒）/ mine: 採掘（鉱石。2.5 秒） */
  kind: 'gather' | 'mine';
  itemId: string;
  areaId: string;
  x: number;
  z: number;
}

/** 採集袋（v0.27.0）: 入る種類と、1 種類の数（この出発で採ったものだけを入れる袋。里の持ち物とは別） */
export const GATHER_BAG = { kinds: 8, perItem: 20 } as const;

/**
 * 狩らない依頼（採集・採掘・現地の納品。v0.27.0、ChatGPT のクエスト設計 #9 の G・M・D01）。
 * 数えるのは、この出発で採取点から採った品だけ（里の倉庫・支給品は数えない）。全部そろってから、野営地の納品箱で 1 度に渡す。
 */
export interface GatherDef {
  /** 納品に要る数（素材ごと） */
  needs: ItemStack[];
  /** 1 か所で採れる数 */
  yieldPerNode: number;
  nodes: GatherNodeDef[];
  /** 野営地の納品箱 */
  depot: { areaId: string; x: number; z: number };
  /** 大型・幼体を出すか。いまは 'none'（出さない）だけ */
  encounters: 'none';
}

/** 外見の色（v0.28.0。public/data/appearance.json）。hex は sRGB の基準色（設計の目安。照明の後の画面の色ではない） */
export interface AppearanceColor {
  id: string;
  label: string;
  hex: string;
  /** 選べるか（無ければ選べる） */
  ready?: boolean;
}

/** 外見の選択肢（髪型・顔・眉・全体の見本）。ready が false は、3D の形や絵が無いので選べない（準備中） */
export interface AppearanceChoice {
  id: string;
  label: string;
  ready: boolean;
}

/** ハンターの外見の選べるもの（public/data/appearance.json。v0.28.0、docs/spec.md の 28 章） */
export interface AppearanceCatalog {
  schemaVersion: number;
  note?: string;
  profiles: { legacy: string; custom: string };
  /** 体の絵の、肌と髪の印の所の A の平均の色（色を替える計算の元） */
  base: { skin: string; hair: string };
  skinColors: AppearanceColor[];
  /** 肌の赤み・黄みの範囲 */
  skinTone: { min: number; max: number };
  hairColors: AppearanceColor[];
  /** 体型の 8 軸（0〜100。50 が A の体つき） */
  bodyAxes: { id: string; label: string }[];
  bodyPresets: { id: string; label: string; axes: Record<string, number> }[];
  hairStyles: AppearanceChoice[];
  faces: AppearanceChoice[];
  brows: AppearanceChoice[];
  eyeColors: AppearanceColor[];
  presets: AppearanceChoice[];
}

/** 依頼の分類（v0.26.0）。main: 物語の主線 / free: 自由 / promotion: 段階を上げる確認 / challenge: 任意の挑戦 */
export type QuestLane = 'main' | 'free' | 'promotion' | 'challenge';
export const QUEST_LANES: readonly QuestLane[] = ['main', 'free', 'promotion', 'challenge'];
export const QUEST_LANE_NAMES: Record<QuestLane, string> = { main: '主線', free: '自由', promotion: '昇級確認', challenge: '挑戦' };

/**
 * 依頼の掲示（public/data/quest_board.json。v0.26.0、ChatGPT のクエスト設計 #9）。依頼ごとの、星・分類・依頼人・依頼人の話・目安の時間。
 * 生成した依頼（quests_creatures.json・quests_herds.json）も、文はここに書く（生成器を走らせ直しても消えない）。
 */
export interface QuestBoardEntry {
  questId: string;
  /** 難しさ 1〜8（適正な装備の狩人にとって。段階 rankId や個体の強さは、星から変えない） */
  stars: number;
  lane: QuestLane;
  client: string;
  /** 依頼人の話（受注の画面に出す） */
  text: string;
  /** 出発から達成までの目安（分）。[短い, 長い]。試遊の前の案で、制限時間とは別 */
  clearMinutes: [number, number];
}

export interface QuestBoardDef {
  schemaVersion: number;
  note?: string;
  /** はじめての人へのおすすめの順（表示だけ。依頼の受けられる条件は変えない） */
  recommend: { text: string; questIds: string[] };
  quests: QuestBoardEntry[];
}

/** 工房からの支給（public/data/support.json。v0.26.0）。物語の依頼を達成すると、1 つの保存で 1 度だけ受け取れる材料 */
export interface SupportPackDef {
  /** 受け取った記録（保存の claims）に残す ID。変えない */
  id: string;
  name: string;
  /** 強化の何段目に使う材料か（表示用） */
  tier: number;
  /** 受け取れる条件: どれも 1 回は達成している依頼 */
  requires: string[];
  items: ItemStack[];
  text: string;
}

export interface SupportDef {
  schemaVersion: number;
  note?: string;
  packs: SupportPackDef[];
}

/** 里の納品で渡す素材。keep は「渡した後も残す数」（それより少なくなるなら、渡せない） */
export interface DeliveryItem {
  itemId: string;
  count: number;
  keep: number;
}

/** 里の納品（public/data/deliveries.json。v0.26.0）。狩りに出ず、倉庫の素材を受付で渡す。1 つの保存で 1 度だけ */
export interface DeliveryDef {
  /** 受け取った記録（保存の claims）と、達成回数に使う ID。変えない */
  id: string;
  name: string;
  client: string;
  stars: number;
  text: string;
  /** 受けられる条件: どれも 1 回は達成している依頼 */
  requires: string[];
  items: DeliveryItem[];
  /** 渡した時の報酬（通貨） */
  money: number;
}

export interface DeliveriesDef {
  schemaVersion: number;
  note?: string;
  deliveries: DeliveryDef[];
}

export interface ItemStack {
  itemId: string;
  count: number;
}

/** 狩猟中に使う道具。use の行動の effectTick で効果が出て、その時に 1 個減る。 */
export interface ItemDef {
  id: string;
  name: string;
  /** whet: 研磨石。刃の状態を最大まで戻す。抜刀して、手に持った武器を研ぐ */
  kind: 'heal' | 'trap' | 'tranq' | 'whet';
  carryMax: number;
  useActionId: string;
  effectTick: number;
  summary: string;
  heal?: number;
  /** 仕掛けてから armTicks で作動可能になり、大型が radius 内に入ると holdTicks の間止める。lifeTicks で消える。 */
  trap?: { armTicks: number; radius: number; holdTicks: number; lifeTicks: number };
  /** 正面 ±halfAngleDeg、range 以内の大型に当たる */
  tranq?: { range: number; halfAngleDeg: number };
  /** 整備の道具（v0.33.0）。防具の技能「道具整備」で、使う時間が短くなる（研磨石） */
  maintenance?: boolean;
}

export interface MaterialDef {
  id: string;
  name: string;
  /** 数え方（v0.27.0。採集の素材の「枚」「個」など。無ければ「個」） */
  unit?: string;
}

export interface LootRoll {
  count: number;
  table: { itemId: string; weight: number }[];
}

/** モンスターから得る素材の表 */
export interface LootDef {
  id: string;
  /** 討伐後の剥ぎ取り（本体） */
  carve: LootRoll;
  /** 切り落とした部位からの剥ぎ取り（部位 id ごと） */
  severed?: Record<string, LootRoll>;
  /** 捕獲した時 */
  capture: LootRoll;
  /** 壊した部位ごとの追加 */
  breaks?: Record<string, LootRoll>;
}

export interface ContentIndex {
  schemaVersion: number;
  contentVersion: string;
  files: {
    actions: string[];
    tracks: string[];
    /** curves・quests・items・loot は、1 つか、並べた複数のファイル（v0.17.0。モンスターの生成器の出力を別のファイルに分けるため） */
    curves: string | string[];
    weapons: string;
    monsters: string[];
    maps: string[];
    fields: string[];
    quests: string | string[];
    items: string | string[];
    loot: string | string[];
    recipes: string;
    ranks: string;
    shop: string;
    hub: string;
    bestiary: string;
    armor: string;
    player: string;
    /** 物語（v0.23.0。src/data/story.ts） */
    story: string;
    /** 攻撃を受ける部位の追従（v0.25.0。npm run monsters:bake の出力） */
    follow?: string[];
    /** 依頼の掲示・工房からの支給・里の納品（v0.26.0） */
    board: string;
    /** ハンターの外見の選べるもの（v0.28.0） */
    appearance: string;
    /** 系列の装備（v0.32.0。武器・防具・作るレシピ。npm run equipment:gen の出力） */
    equipment?: string[];
    /** 属性と状態異常の決まり（v0.33.0） */
    elements: string;
    /** 防具の技能（v0.33.0。npm run equipment:gen の出力） */
    skills: string;
    support: string;
    deliveries: string;
  };
}

export interface Content {
  contentVersion: string;
  /** 属性と状態異常の決まり（v0.33.0） */
  elements: ElementRules;
  /** 防具の技能（v0.33.0） */
  skills: Map<string, SkillDef>;
  actions: Map<string, ActionDef>;
  curves: Map<string, CurveDef>;
  tracks: Map<string, ShapeTrackDef>;
  families: Map<string, WeaponFamilyDef>;
  weapons: Map<string, WeaponDef>;
  /** 刃の状態の決まり */
  edge: EdgeRules;
  monsters: Map<string, MonsterDef>;
  maps: Map<string, MapDef>;
  quests: Map<string, QuestDef>;
  items: Map<string, ItemDef>;
  materials: Map<string, MaterialDef>;
  loot: Map<string, LootDef>;
  recipes: Map<string, RecipeDef>;
  fields: Map<string, FieldDef>;
  shop: ShopDef;
  hub: HubDef;
  /** モンスターの登録簿（図鑑と、これからの登場の計画） */
  bestiary: BestiaryDef;
  /** 物語（v0.23.0。序章と第 1 章だけ遊べる） */
  story: StoryDef;
  /** 依頼の掲示（v0.26.0。依頼ごとの文は、各 QuestDef の board にも付ける） */
  board: QuestBoardDef;
  /** 工房からの支給（v0.26.0） */
  support: SupportDef;
  /** 里の納品（v0.26.0） */
  deliveries: Map<string, DeliveryDef>;
  /** ハンターの外見の選べるもの（v0.28.0） */
  appearance: AppearanceCatalog;
  ranks: Map<string, RankDef>;
  armor: Map<string, ArmorDef>;
  armorRules: ArmorRules;
  player: PlayerTuning;
}

/** onFinish に書ける状態。 */
export const FINISH_STATES = ['drawn_idle', 'sheathed_idle', 'keep'] as const;
