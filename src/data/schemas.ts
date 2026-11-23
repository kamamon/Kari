// データ定義の型。public/data/*.json はすべてこの形で書き、読み込み時に validators.ts で検証する。
// 「恒久ID」と「表示名」を分ける。名前を変えても id は変えない。

export const SCHEMA_VERSION = 1;

export type Triple = [number, number, number];
export type DamageType = 'cut' | 'blunt' | 'shot';

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
  elementCoefficient?: number;
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
  rootMotion: { mode: 'controller' | 'none'; curveId?: string };
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
  element: { type: string; value: number };
  affinity: number;
  sharpnessModifier: number;
  assetId: string;
  /** 最初から持っている武器（新しい保存データへ配る） */
  starter?: boolean;
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
export type RecipeDef = WeaponRecipeDef | ArmorRecipeDef;

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

/** レシピの元と結果の ID（武器でも防具でも） */
export const recipeFrom = (r: RecipeDef): string => (r.kind === 'upgrade' ? r.fromWeaponId : r.fromArmorId);
export const recipeResult = (r: RecipeDef): string => (r.kind === 'upgrade' ? r.resultWeaponId : r.resultArmorId);

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
}

export interface MapDef {
  schemaVersion: number;
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  stepUp: number;
  spawn: { x: number; z: number; yaw: number };
  camp: { x: number; z: number; r: number };
  monsterSpawn: { x: number; z: number; yaw: number };
  rocks: { x: number; z: number; r: number; h: number }[];
  platforms: { minX: number; maxX: number; minZ: number; maxZ: number; h: number }[];
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
}

/** 依頼。M2 前半は大型 1 体の討伐だけ。 */
export interface QuestDef {
  id: string;
  name: string;
  /** slay: 討伐だけで達成（捕獲はできない）。hunt: 討伐でも捕獲でも達成。 */
  kind: 'slay' | 'hunt';
  summary: string;
  mapId: string;
  targetMonsterId: string;
  /** 段階（ranks.json の id）。標的の強さと、出る素材が決まる。 */
  rankId: string;
  /** 受けるために、先に 1 回は達成しておく依頼（無ければ最初から受けられる）。 */
  requires?: string[];
  monsterSpawn: { x: number; z: number; yaw: number };
  timeLimitTicks: number;
  maxFaints: number;
  /** この依頼でモンスターの攻撃・落石が与えるダメージの倍率（省略時 1）。 */
  monsterAttackScale?: number;
  /** 達成してから拠点へ戻るまでの時間（剥ぎ取りに使える時間）。省略時 3600。 */
  returnTicks?: number;
  /** 出発の時に支給する道具 */
  supplies?: ItemStack[];
  /** 達成した時の報酬（失敗・リタイアでは出ない） */
  rewards?: { money: number; items: ItemStack[] };
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
}

export interface MaterialDef {
  id: string;
  name: string;
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
    curves: string;
    weapons: string;
    monsters: string[];
    maps: string[];
    quests: string;
    items: string;
    loot: string;
    recipes: string;
    ranks: string;
    armor: string;
    player: string;
  };
}

export interface Content {
  contentVersion: string;
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
  ranks: Map<string, RankDef>;
  armor: Map<string, ArmorDef>;
  armorRules: ArmorRules;
  player: PlayerTuning;
}

/** onFinish に書ける状態。 */
export const FINISH_STATES = ['drawn_idle', 'sheathed_idle', 'keep'] as const;
