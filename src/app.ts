// ゲーム全体のつなぎ役。入力 → 60Hz 固定 simulation → 描画 / 音 / HUD の順に 1 フレームを回す。
// 行き先は 拠点（選択画面）/ 訓練場 / 依頼 の 3 つ。依頼の成否は simulation が決め、ここは表示するだけ。
import { AudioSystem } from './core/audio';
import { FixedClock } from './core/clock';
import { FrameMeter, describeFrames, type FrameSummary } from './core/frameMeter';
import { DEG, clamp, yawOf } from './core/math';
import { aimDir, aimEye, aimTarget } from './game/aim';
import type { ArmorSlot, Content, FacilityDef } from './data/schemas';
import { starLabel } from './data/questBoard';
import { FIELD_GATHER_LABEL } from './data/fieldGathering';
import { isCarriedLoot, pouchStacks } from './save/classicBox';
import { Btn, type InputFrame } from './game/inputFrame';
import { firstMismatch, runReplay } from './game/replay';
import { familyOf } from './game/player';
import { Simulation, type SimOptions } from './game/sim';
import { GamepadInput } from './input/gamepad';
import { InputHub } from './input/hub';
import { KeyboardMouse } from './input/keyboard';
import { TouchControls } from './input/touch';
import { CREATURE_PLANS } from './render/creaturePlans';
import { envArtStatus } from './render/envArt';
import { GameView } from './render/view';
import { armorTierOf } from './render/hunterArmor';
import { defenseOf, playWeaponId, pouchOf, questUnlocked, wornArmor, type RunRewards } from './save/profile';
import type { SaveManager, SaveResult } from './save/saveManager';
import type { SettingsStore } from './save/settings';
import { BaseScreen, type BaseHost, type BaseSection } from './ui/base';
import { Hud } from './ui/hud';
import { Menu, type MenuHost } from './ui/menus';
import { counterOf, shortName } from './ui/targets';
import { ResultScreen, type ResultHost } from './ui/result';
import { iconUrl } from './ui/icons';
import { StoryDialog, type StoryPlay } from './ui/story';
import { nearestFacility } from './game/hub';
import { HUB_FISH_BITE, HUB_RESOURCE_POINTS, nearbyResource, resourceStatus, resourceReward, resourceCycle, type HubResourcePoint } from './game/hubResources';
import { destinations, serviceNear, chosenPouch, villageLevel, type HubService, type HubDestination } from './game/hubLife';
import { lifeOf, hasPrep, prepText, type HubTab, type HuntPrep } from './data/hubLife';
import { hubThreat, newHubReports } from './data/hubNarrative';
import { scenesUnlocked, type StoryOutcome } from './data/story';
import { AppearanceEditor, type LooksHost } from './ui/appearanceEditor';
import { resolveAppearance, type ResolvedAppearance } from './data/appearance';

const DEFAULT_SEED = 20261122;
const MAX_RECORD = 60 * 60 * 16;
/** 手で狙う（v0.61.0）: 狙い始めの上下（少し上）と、スティックを倒し切った時に狙いが回る速さ（ラジアン/秒。左右・上下） */
const AIM_START_PITCH = 0.06;
const AIM_STICK_YAW = 1.5;
const AIM_STICK_PITCH = 0.9;
/** 依頼が終わってから結果を出すまでの間（倒れる動きを見せる） */
/** 結果が閉じてから結果画面を出すまでの間 */
const RESULT_DELAY_TICKS = { success: 50, failed: 90 };

/** 状態異常が付いた時の知らせ */
const STATUS_TOAST: Record<string, string> = { poison: '毒を受けた', para: '体が痺れて動けない', sleep: '眠ってしまった', stun: '気を失った' };

export class App implements MenuHost, BaseHost, ResultHost, LooksHost {
  private sim!: Simulation;
  private view!: GameView;
  private clock = new FixedClock(6);
  private hub = new InputHub();
  private keyboard: KeyboardMouse;
  private gamepad: GamepadInput;
  private touch: TouchControls;
  private hud: Hud;
  private menu: Menu;
  private base: BaseScreen;
  private result: ResultScreen;
  /** 物語の会話の窓（v0.23.0） */
  private story: StoryDialog;
  /** 見た目を変える画面（v0.28.0）と、開いた時のカメラの向き（下見は、この側から狩人を見る）・戻る施設の画面 */
  private looks: AppearanceEditor;
  private looksYaw = 0;
  private looksFrom: BaseSection = 'chest';
  private looksFacilityId: string | undefined;
  /** 狩人に渡した外見の元（保存の外見か下見）と、渡した描画（作り直したら、もう 1 度渡す） */
  private lookSrc: unknown = null;
  private lookView: GameView | null = null;
  private editBar: HTMLElement;
  private rotate: HTMLElement;
  private recorded: InputFrame[] = [];
  private readonly supplyUI=document.createElement('details');
  private supplyKey='';private pendingSupply:string|undefined;
  private recordOverflow = false;
  private questId: string | null = null;
  private lastTs = 0;
  private lastRender = 0;
  private fps = 60;
  /** 描画の間隔の記録（実機の重さの報告用）。止まっていた間と、その直後の 1 フレームは入れない。 */
  private meter = new FrameMeter();
  private meterSummary: FrameSummary = this.meter.summary();
  private meterSkip = true;
  private meterAge = 0;
  private paused = false;
  private warned = new Set<string>();
  private portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
    private content: Content,
    private store: SettingsStore,
    private audio: AudioSystem,
    /** 里の持ち物・装備・進行の保存 */
    readonly save: SaveManager,
  ) {
    this.keyboard = new KeyboardMouse(this.hub, canvas);
    this.gamepad = new GamepadInput(this.hub);
    this.hud = new Hud(ui, this.hub);
    this.supplyUI.className='classic-supply';this.supplyUI.hidden=true;ui.appendChild(this.supplyUI);
    this.touch = new TouchControls(this.hub, store, ui);
    this.menu = new Menu(ui, store, this);
    this.result = new ResultScreen(ui, this);
    this.base = new BaseScreen(ui, content, this);
    this.story = new StoryDialog(ui, content);
    this.looks = new AppearanceEditor(ui, content, this);

    this.editBar = document.createElement('div');
    this.editBar.className = 'edit-bar';
    this.editBar.hidden = true;
    const label = document.createElement('span');
    label.textContent = 'ボタンをドラッグして配置';
    const reset = document.createElement('button');
    reset.className = 'sub';
    reset.textContent = '初期化';
    reset.addEventListener('click', () => store.set({ layout: {} }));
    const done = document.createElement('button');
    done.textContent = '完了';
    done.addEventListener('click', () => this.endLayoutEdit());
    this.editBar.append(label, reset, done);
    ui.appendChild(this.editBar);

    this.rotate = document.createElement('div');
    this.rotate.id = 'rotate';
    this.rotate.className = 'armed';
    this.rotate.innerHTML = '<div><span class="icon">📱</span><p><b>横向きにしてください</b><br>このゲームは横画面で遊びます。<br>縦持ちの間は一時停止します。</p></div>';
    ui.appendChild(this.rotate);

    if (this.hubWalk) {
      this.createSession(null, true);
      this.setOverlay(null);
    } else {
      this.createSession(null);
      this.setOverlay('base');
    }
    this.hud.setVerify(store.value.verify);

    this.hub.onUi((a) => {
      if (this.base.open || this.result.open || this.story.open || this.looks.open) return;
      if (a === 'menu') this.menu.open ? this.closeMenu() : this.openMenu();
      else if (a === 'verify') store.set({ verify: !store.value.verify });
      else if (a === 'camReset' && !this.paused) this.resetCamera();
      else if (a === 'lockOn' && !this.paused) this.toggleLock();
      else if (a === 'map' && !this.paused) {if(this.place==='hub')this.openLife('map');else this.hud.fieldMap.toggle(this.place === 'hunt' ? this.sim.field : null);}
      else if (a === 'return' && !this.paused) this.returnNow();
      else if (a === 'interact' && !this.paused && this.place === 'hub') this.interactHub();
      else if (a === 'hubList' && !this.paused && this.place === 'hub') this.openFacility('all');
    });
    store.onChange((s) => {
      this.audio.applySettings(s);
      this.view.applySettings(s);
      this.hud.setVerify(s.verify);
    });

    const onResize = (): void => this.view.resize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => {
      this.releaseInputs();
      setTimeout(onResize, 250);
    });
    this.portrait.addEventListener('change', () => this.releaseInputs());
    document.addEventListener('visibilitychange', () => {
      // 非表示になったら入力を解除する。復帰時は蓄積時間を捨てる（数秒分を一度に進めない）。
      this.releaseInputs();
      if (!document.hidden) void this.audio.resume();
    });
    window.addEventListener('pagehide', () => this.releaseInputs());
  }

  /**
   * 依頼を、フィールド（エリアに分かれた狩場）で始めるか。ふだんは true。
   * アドレスに ?hunt=arena を付けると、エリアに分ける前の 1 つの狩場で始まる（検査と、見比べ用）。
   */
  readonly fieldHunts = new URLSearchParams(location.search).get('hunt') !== 'arena';

  /**
   * 拠点を、里を歩く形にするか。ふだんは true。
   * アドレスに ?hub=menu を付けると、これまでの一覧の画面（起動してすぐ、すべての欄が出る）になる（検査と、見比べ用）。
   */
  readonly hubWalk = new URLSearchParams(location.search).get('hub') !== 'menu';
  /** いま居る場所: hub = 里を歩いている / training = 訓練場 / hunt = 依頼 */
  place: 'hub' | 'training' | 'hunt' = 'training';
  /** 里で、いま前に立っている施設（無ければ null） */
  nearFacility: FacilityDef | null = null;
  private nearResource: HubResourcePoint | null = null;
  private nearService: HubService | null = null;
  private visitPending=new Set<string>();
  private departing=false;
  private huntPrep: HuntPrep | undefined;
  private lifeRevision=-1;
  private gatheringVisual:{kind:HubResourcePoint['kind'];until:number}|null=null;
  private resourceBusy = false;
  private fishing: { from: number; to: number; token: string } | null = null;
  /**
   * 手で狙う（v0.61.0。環弓。#19 の H05。docs/spec.md の 32.27）: 狙っている間の狙いの向き（入力の側の状態）。抜刀して固有ボタンを押している間。
   * 視点の操作とスティックで動かし、毎 tick の入力に入れて simulation へ渡す（simulation が矢の向きを決める）
   */
  aim: { yaw: number; pitch: number } | null = null;
  /**
   * タッチでは、固有ボタン（狙う）は押すたびに切り替える（押し続けながら射るのは、同じ親指では難しい）。入っている間は、入力に固有を押した印を足す。
   * キーボード・パッドは押している間だけ（2G の R と同じ）
   */
  private aimLatch = false;

  /** 狙うかどうかを決め、スティックで狙いを動かす（描画フレームごと。tick を進める前） */
  private updateAim(dt: number): void {
    const pl = this.sim.player;
    const fam = familyOf(pl, this.content);
    const A = fam.aim;
    const held = this.hub.isHeld(Btn.Special);
    const touch = this.hub.lastDevice === 'touch';
    if (this.hub.takePressed() & Btn.Special && touch && A) this.aimLatch = !this.aimLatch;
    if (!touch) this.aimLatch = false;
    const can = !!A && this.place !== 'hub' && pl.drawn && (touch ? this.aimLatch : held)
      && (pl.mode === 'free' || (pl.mode === 'action' && pl.action?.def.actionId === fam.actions.main));
    if (can && !this.aim) this.aim = { yaw: pl.yaw, pitch: AIM_START_PITCH };
    else if (!can && this.aim) {
      // 狙い終わったら、視点を狙っていた向きの背後へ。回避・近接・納刀などで狙えなくなったら、タッチの切り替えも戻す
      this.view.cam.snap(this.aim.yaw);
      this.aim = null;
      this.aimLatch = false;
    }
    if (this.aim && A) {
      const ax = this.hub.axis();
      this.aim.yaw -= ax.x * AIM_STICK_YAW * dt;
      this.aim.pitch = clamp(this.aim.pitch + ax.y * AIM_STICK_PITCH * dt, A.pitchMinDeg * DEG, A.pitchMaxDeg * DEG);
    }
  }

  private options(questId: string | null, hub = false): SimOptions {
    return {
      seed: DEFAULT_SEED,
      mapId: hub ? this.content.hub.mapId : 'map.basin.training',
      weaponId: this.weaponId,
      monsterId: hub ? null : 'monster.training_dummy',
      monsterAttacks: hub ? false : this.store.value.dummyAttacks,
      questId,
      // 依頼へは、持っている道具を、持ち出せる数まで持っていく
      pouch: questId ? chosenPouch(this.save.doc, this.content) : [],
      classicBox: !!questId&&this.fieldHunts,
      ...(questId&&this.huntPrep?{hubPrep:this.huntPrep}:{}),
      armorIds: wornArmor(this.save.doc, this.content).map((a) => a.id),
      field: this.fieldHunts,
      // 操作補助: 弓の狙いの補助（v0.61.0）。狩りを始めた時の設定（途中で変えると、次の狩りから）
      aimAssist: this.store.value.bowAimAssist,
    };
  }

  /**
   * 拠点の持ち物（保存データの写し）。検査用に、以前と同じ形で読めるようにしてある。
   * 中身を変えるのは保存の管理役だけで、書き込みが完了してから増える。
   */
  get inventory(): { money: number; items: Map<string, number> } {
    const items=new Map(Object.entries(this.save.doc.items));
    for(const x of pouchStacks(this.save.doc))items.set(x.itemId,(items.get(x.itemId)??0)+x.count);
    return { money: this.save.doc.money, items };
  }

  /** いまの依頼の識別子。出発のたびに新しくなる。報酬は、この識別子につき 1 度だけ持ち物へ入る（保存データに記録する） */
  private runId = '';
  /** いまの依頼の報酬の保存の状態（結果の画面に出す） */
  private settleState: { runId: string; state: 'saving' | 'saved' | 'failed'; message: string; spentOnly?: boolean } | null = null;
  /** 保存に失敗して、まだ持ち物へ入っていない報酬 */
  private unsaved: RunRewards[] = [];

  /**
   * 依頼が終わった時に、結果を保存へ送る。同じ依頼では 1 度だけ送る（保存の側でも runId で 1 度だけにしている）。
   * 達成: 報酬を入れ、使った自分の道具を減らす。失敗・途中で帰る（leaving）: 使った自分の道具だけを減らす（使っていなければ、何も送らない）。
   */
  private settleRewards(leaving = false): void {
    const h = this.sim?.hunt;
    if (!h || this.runId === '' || this.settleState?.runId === this.runId) return;
    const success = h.closed && h.phase === 'success' && !!h.rewards;
    // 達成した後、剥ぎ取りの途中で帰る場合は、報酬がまだ決まっていない（ここでは送らない）
    if (!success && (h.phase === 'success' || !(h.phase === 'failed' || leaving))) return;
    const spent = (h.reason==='retire'||(leaving&&h.phase==='active'))?[]:this.sim.spentOwn();
    if (!success && spent.length === 0) return;
    const carried=new Map<string,number>(),boxed=new Map<string,number>();
    if(success&&this.sim.options.classicBox)for(const x of h.loot){const dest=isCarriedLoot(x.source)?carried:boxed;dest.set(x.itemId,(dest.get(x.itemId)??0)+1);}
    const stacks=(m:Map<string,number>)=>[...m].map(([itemId,count])=>({itemId,count}));
    const rewards: RunRewards = success
      ? { runId: this.runId, questId: h.quest.id, money: h.rewards!.money, items: this.sim.options.classicBox?stacks(boxed):h.rewards!.items.map((s) => ({ ...s })), carried:stacks(carried), spent, pouchSpent:true,pouchSnapshot:this.sim.options.pouch }
      : { runId: this.runId, questId: h.quest.id, money: 0, items: [], spent, cleared: false,pouchSpent:true,pouchSnapshot:this.sim.options.pouch };
    this.settleState = { runId: this.runId, state: 'saving', message: '', spentOnly: !success };
    if (success) this.runOutcome.set(this.runId, h.reason === 'capture' ? 'capture' : 'slay');
    void this.saveRewards(rewards);
  }

  private async saveRewards(r: RunRewards): Promise<SaveResult> {
    const before = { ...this.save.doc.progress.questClears };
    const res = await this.save.settle(r);
    // 物語（v0.23.0）: 保存が完了してから、新しく読めるようになった帰還の報告を、拠点へ戻った時に 1 回だけ開く
    if (res.ok) this.afterSettleStory(before, this.runOutcome.get(r.runId) ?? 'any');
    if (res.ok) this.unsaved = this.unsaved.filter((u) => u.runId !== r.runId);
    else if (!this.unsaved.some((u) => u.runId === r.runId)) this.unsaved.push(r);
    if (this.settleState?.runId === r.runId) {
      this.settleState = { ...this.settleState, state: res.ok ? 'saved' : 'failed', message: res.ok ? '' : res.message };
      this.result.setSaveState(this.rewardSaveState());
    }
    return res;
  }

  /** 結果の画面に出す、報酬の保存の状態 */
  rewardSaveState(): { state: 'none' | 'saving' | 'saved' | 'failed'; text: string } {
    const st = this.settleState;
    if (!st || st.runId !== this.runId) return { state: 'none', text: '' };
    // 失敗した依頼: 使った自分の道具を減らすだけ
    if (st.spentOnly) return st.state === 'saving' ? { state: 'saving', text: '使った道具を記録しています…' } : st.state === 'failed' ? { state: 'failed', text: `${st.message} 使った道具は、まだ持ち物から減っていません。` } : { state: 'saved', text: '使った自分の道具を、持ち物から減らしました。' };
    if (st.state === 'saving') return { state: 'saving', text: '報酬を保存しています…' };
    if (st.state === 'failed') return { state: 'failed', text: `${st.message} 報酬は、まだ持ち物に入っていません。` };
    return {
      state: 'saved',
      text: this.save.mode === 'persistent' ? '素材と通貨を持ち物に入れて、保存しました。' : '素材と通貨を持ち物に入れました。この端末では保存されないので、ページを閉じると無くなります。',
    };
  }

  unsavedRewards(): number {
    return this.unsaved.length;
  }

  /** 依頼の結果（討伐か捕獲か）。帰還の報告の言葉を選ぶため */
  private runOutcome = new Map<string, StoryOutcome>();
  /** 拠点へ戻った時に開く、帰還の報告 */
  private pendingStory: StoryPlay[] = [];

  /**
   * 保存の前後の達成回数を比べて、新しく読めるようになった場面を、開く順に積む（同じ runId の保存し直しでは増えない）。
   * 里を歩く拠点にいれば、すぐ開く。依頼の途中なら、拠点へ戻った時に開く。一覧の拠点（?hub=menu。検査と見比べ用）では開かない（依頼板の記録から読める）。
   */
  afterSettleStory(before: Readonly<Record<string, number>>, outcome: StoryOutcome = 'any'): void {
    const ids = [...scenesUnlocked(this.content.story, before, this.save.doc.progress.questClears),...newHubReports(this.content,before,this.save.doc.progress.questClears)];
    if (ids.length === 0 || !this.hubWalk) return;
    this.pendingStory.push(...ids.map((sceneId) => ({ sceneId, outcome })));
    if (this.place === 'hub') this.showPendingStory();
  }

  private showPendingStory(): void {
    if (this.pendingStory.length === 0 || this.story.open) return;
    const list = this.pendingStory;
    this.pendingStory = [];
    this.openStoryPlays(list);
  }

  /** 物語の場面を読む（依頼板の欄から。何も保存しない） */
  openStory(sceneIds: string[]): void {
    this.openStoryPlays(sceneIds.map((sceneId) => ({ sceneId })));
  }

  private openStoryPlays(list: StoryPlay[]): void {
    // 会話の間は、操作のボタンと HUD を隠す（拠点の画面が開いていれば、その上に重ねる）
    const playing = !this.base.open && !this.result.open;
    if (playing) {
      this.touch.root.hidden = true;
      this.hud.root.hidden = true;
    }
    this.releaseInputs();
    this.story.play(list, () => {
      if (!this.base.open && !this.result.open && !this.menu.open) {
        this.touch.root.hidden = false;
        this.hud.root.hidden = false;
      }
      this.releaseInputs();
    });
  }

  /** 保存できていない報酬を、もう一度保存する */
  async retryUnsaved(): Promise<SaveResult> {
    let last: SaveResult = { ok: true };
    for (const r of [...this.unsaved]) {
      const res = await this.saveRewards(r);
      if (!res.ok) last = res;
    }
    return last;
  }

  /** 達成後に、剥ぎ取りを切り上げて帰る（入力として simulation へ渡す） */
  private returnNow(): void {
    const h = this.sim.hunt;
    if (h && h.phase === 'success' && !h.closed) this.hub.pulse(Btn.Retire);
  }

  private createSession(questId: string | null, hub = false): void {
    // 依頼の途中で別の場所へ移る時は、使った自分の道具を先に精算する
    this.settleRewards(true);
    this.questId = questId;
    this.place = questId ? 'hunt' : hub ? 'hub' : 'training';
    this.nearFacility = null;
    this.nearResource = null;
    this.nearService = null;
    this.lifeRevision=-1;
    this.gatheringVisual=null;
    this.fishing = null;
    this.runId = questId ? makeRunId() : '';
    this.pendingSupply=undefined;this.supplyKey='';this.supplyUI.open=false;
    this.sim = new Simulation(this.content, this.options(questId, hub));
    this.view?.dispose();
    this.view = new GameView(this.canvas, this.content, this.sim, this.store.value);
    this.view.onSound = (id, k) => void this.audio.play(id, k);
    this.view.onAmbience = (a) => this.audio.setAmbience(a);
    this.view.onHubSample=(id,k)=>this.audio.playHubSample(id,k);
    this.audio.setHubMusic(this.place==='hub',hubThreat(this.content,this.save.doc.progress.questClears)===2);
    this.recorded = [];
    this.recordOverflow = false;
    this.clock.reset();
  }

  /** 拠点・結果の画面を出す / 消す。出ている間は操作ボタンを隠して一時停止する。 */
  private setOverlay(which: 'base' | 'result' | null, section: BaseSection = 'all', facilityId?: string): void {
    this.base.setOpen(which === 'base', section, facilityId);
    if (which === 'result') this.result.show(this.sim, this.rewardSaveState());
    else this.result.hide();
    const playing = which === null;
    this.keyboard.enabled = playing;
    this.gamepad.enabled = playing;
    this.touch.enabled = playing;
    this.touch.root.hidden = !playing;
    this.hud.root.hidden = !playing;
    this.releaseInputs();
  }

  private releaseInputs(): void {
    this.touch.releaseAll();
    this.keyboard.release();
    this.hub.releaseAll();
    this.clock.reset();
    this.lastTs = 0;
  }

  /** ロックオンを入・切する（v0.16.0）。里では使わない。ロックできる相手が居なければ、知らせるだけ。 */
  toggleLock(): void {
    // 操作補助（v0.40.0）: 設定でロックオンのボタンを出している時だけ（標準は手で視点を回す）
    if (this.place === 'hub' || !this.store.value.lockOnButton) return;
    if (this.view.lockOn) {
      this.view.lockOn = false;
      this.hud.toast('ロックオンを外した');
      return;
    }
    if (!this.view.lockTargetPoint(this.sim)) {
      this.hud.toast('ロックオンできる相手がいない');
      return;
    }
    this.view.lockOn = true;
  }

  private resetCamera(): void {
    const p = this.sim.player;
    // 標的（群れの依頼では、いちばん近い標的）の方へ。同じエリアに居ない時は、背中側へ
    const m = this.view.lockTarget(this.sim);
    if (this.store.value.targetAssist && m) this.view.cam.resetBehind(yawOf(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
    else this.view.cam.resetBehind(p.yaw);
  }

  // ---- BaseHost / ResultHost ----
  /** いま持たせている武器（保存データの装備。この版で使えない武器なら、持っている中の最初の武器） */
  get weaponId(): string {
    return playWeaponId(this.save.doc, this.content);
  }

  /** 武器を持ち替える。保存が完了してから替わる。 */
  async setWeapon(id: string): Promise<SaveResult> {
    const r = await this.save.equip(id);
    if (r.ok) this.audio.play('ui');
    this.saveChanged();
    return r;
  }

  /** 防具を、部位ごとに替える・外す（null で外す）。保存が完了してから替わる。 */
  async setArmor(slot: ArmorSlot, id: string | null): Promise<SaveResult> {
    const r = await this.save.equipArmor(slot, id);
    if (r.ok) this.audio.play('ui');
    this.saveChanged();
    return r;
  }

  /** 保存データが変わった後（持ち替え・強化・取り込み・別のタブの内容の読み直し）: 拠点の後ろに見えているハンターを、いまの装備で作り直す */
  saveChanged(): void {
    const worn = wornArmor(this.save.doc, this.content).map((a) => a.id).join();
    if (!this.base.open || (this.sim.player.weaponId === this.weaponId && this.sim.armorIds.join() === worn)) return;
    if (this.place === 'hub') {
      // 里: 立っている場所と、開いている施設の画面は、そのまま
      const old = this.sim.player;
      const at = { pos: { ...old.pos }, yaw: old.yaw };
      const section = this.base.section;
      const facilityId = this.base.facilityId ?? undefined;
      this.createSession(null, true);
      const p = this.sim.player;
      p.pos = { ...at.pos };
      p.prevPos = { ...at.pos };
      p.yaw = at.yaw;
      p.prevYaw = at.yaw;
      this.view.cam.snap(at.yaw);
      this.setOverlay('base', section, facilityId);
      return;
    }
    this.createSession(null);
    this.setOverlay('base');
  }

  // ---- 見た目（v0.28.0）----
  /** 狩人の外見を描く側へ渡す（下見か保存した外見。元が変わった時と、描画を作り直した時だけ） */
  private syncLook(preview: ResolvedAppearance | null): void {
    const src = preview ?? this.save.doc.appearance;
    if (src === this.lookSrc && this.view === this.lookView) return;
    this.lookSrc = src;
    this.lookView = this.view;
    this.view.hunter.setLook(preview ?? resolveAppearance(this.save.doc.appearance, this.content.appearance), this.content.appearance.base);
  }

  /** 装備箱の「見た目を変える」: 施設の画面を隠して、見た目を変える画面を開く（費用なし。狩りの途中には出さない） */
  openLooks(): void {
    if (this.place === 'hunt' || this.looks.open) return;
    this.looksFrom = this.base.section;
    this.looksFacilityId = this.base.facilityId ?? undefined;
    this.looksYaw = this.view.cam.yaw;
    this.base.setOpen(false);
    this.looks.openEditor();
    this.audio.play('ui');
  }

  /** 見た目を変える画面を閉じた: 元の施設の画面へ戻る */
  looksClosed(saved: boolean): void {
    this.lookSrc = null;
    this.base.setOpen(true, this.looksFrom, this.looksFacilityId);
    if (saved) {
      this.base.notify('見た目を保存しました。');
      this.audio.play('ui');
    }
  }

  /** 兜をかぶっているか（見た目を変える画面の「兜で確認」） */
  wearsHelmet(): boolean {
    return wornArmor(this.save.doc, this.content).some((a) => a.slot === 'head' && armorTierOf(a.assetId) >= 2);
  }

  // ---- 里（歩く拠点）----
  private resourcePrompt(): Pick<FacilityDef,'id'|'action'|'summary'> | null {
    const p=this.nearResource;if(!p)return this.nearService?{id:'service.'+this.nearService.id,action:this.nearService.name+'を利用',summary:this.nearService.detail}:null;
    const s=resourceStatus(this.save.doc,this.content,p);
    if(this.resourceBusy)return {id:'resource.'+p.id,action:'保存中',summary:p.name};
    if(p.id==='fish'&&this.fishing){
      const bite=this.sim.tick>=this.fishing.from&&this.sim.tick<this.fishing.to;
      return {id:'resource.fish',action:bite?'食いついた！ 引き上げる':'浮きを見守る',summary:bite?'今すぐ主ボタン':'食いつくまで待つ'};
    }
    const actions={sow:'種をまく',harvest:'収穫する',gather:p.kind==='fish'?'釣りを始める':p.kind==='mine'?'採掘する':p.kind==='insect'?'虫を捕る':'骨を採る',wait:'生育中',empty:'採取済み',unavailable:'利用不可'};
    return {id:'resource.'+p.id,action:actions[s.action],summary:p.name+'｜'+s.summary};
  }

  private interactHub(): void {
    if(this.place!=='hub'||this.paused||this.resourceBusy||(this.gatheringVisual&&this.sim.tick<this.gatheringVisual.until))return;
    const f=nearestFacility(this.content.hub.facilities,this.sim.world,this.sim.player.pos);
    if(f){this.fishing=null;this.visit('facility.'+f.id);this.openFacility(f.kind,f.id);return;}
    const p=nearbyResource(this.sim.world,this.sim.player.pos);if(!p){const s=serviceNear(this.sim.world,this.sim.player.pos);if(s){this.visit('service.'+s.id);this.openLife(s.tab);if(s.zone)this.base.openEstate(s.zone);}return;}
    const s=resourceStatus(this.save.doc,this.content,p);
    this.visit('resource.'+p.id);
    if(s.action==='wait'||s.action==='empty'||s.action==='unavailable'){this.hud.toast(s.summary);return;}
    if(p.id==='fish'){
      if(!this.fishing){
        this.fishing={from:this.sim.tick+HUB_FISH_BITE.from,to:this.sim.tick+HUB_FISH_BITE.to,token:s.token};
        this.hud.toast('釣り糸を垂らした。食いつくまで待とう');return;
      }
      const attempt=this.fishing;this.fishing=null;
      if(this.sim.tick<attempt.from||this.sim.tick>=attempt.to||attempt.token!==s.token){
        this.hud.toast('逃げられた。もう一度釣ろう');return;
      }
    }
    const reward=resourceReward(this.save.doc,this.content,p);
    this.gatheringVisual={kind:p.kind,until:this.sim.tick+52};
    this.resourceBusy=true;
    void this.save.useHubResource(p.id,s.token).then(r=>{
      if(!r.ok){this.hud.toast(r.message);return;}
      const message=s.action==='sow'?'種をまいた。依頼を達成して戻ろう':reward?(this.content.materials.get(reward.itemId)?.name??reward.itemId)+' ×'+reward.count+' を入手':'採集した';
      this.hud.toast(message+(this.save.mode==='persistent'?'（保存済み）':'（この端末では保存なし）'));
      this.audio.play('ui');
    }).catch(()=>this.hud.toast('採集の保存に失敗しました')).finally(()=>{this.resourceBusy=false;});
  }

  private visit(id:string):void{
    if(lifeOf(this.save.doc).visited.includes(id)||this.visitPending.has(id))return;
    this.visitPending.add(id);
    void this.save.hubLife({kind:'visit',id}).finally(()=>this.visitPending.delete(id));
  }
  openLife(tab:HubTab):void{
    if(this.place!=='hub')return;
    this.fishing=null;this.setOverlay('base','life');this.base.showLife(tab);this.audio.play('ui');
  }
  lifeDestinations():HubDestination[]{
    if(this.place==='hub')return destinations(this.content,this.sim.world);
    // メニュー拠点でも施設一覧は見られるが移動はできない。
    return [];
  }
  playEstateSound(id:import('./core/hubSoundtrack').HubSample,k=1):void{this.audio.playHubSample(id,k);}
  lifePosition():{x:number;y:number;z:number}|null{return this.place==='hub'?{...this.sim.player.pos}:null;}
  lifeTravel(id:string):void{
    if(this.place!=='hub'||!lifeOf(this.save.doc).visited.includes(id)||this.resourceBusy)return;
    const f=destinations(this.content,this.sim.world).find(x=>x.id===id);if(!f)return;
    const map=this.sim.world.map,r=this.content.player.radius,y=this.sim.world.groundHeight(f.x,f.z);
    if(Math.abs(y-f.floor)>0.1||map.rocks.some(q=>Math.hypot(q.x-f.x,q.z-f.z)<q.r+r))return;
    for(let i=0;i<8;i++){const a=i*Math.PI/4;if(Math.abs(this.sim.world.groundHeight(f.x+Math.sin(a)*(r+.15),f.z+Math.cos(a)*(r+.15))-y)>0.35)return;}
    const p=this.sim.player;p.pos={x:f.x,y,z:f.z};p.prevPos={...p.pos};p.vel.vy=0;
    this.nearResource=null;this.nearFacility=null;this.nearService=null;this.fishing=null;
    this.view.snapHubHeight(y);this.setOverlay(null);this.hud.toast(f.name+'へ移動しました');
  }

  /** 施設の画面を開く（all = すべての欄の一覧）。開いている間は、一時停止する。 */
  openFacility(section: BaseSection, facilityId?: string): void {
    this.setOverlay('base', section, facilityId);
    this.audio.play('ui');
  }

  /** 施設の画面を閉じて、里へ戻る（歩く拠点の時だけ）。 */
  closeFacility(): void {
    if (!this.hubWalk || this.place !== 'hub') return;
    this.setOverlay(null);
    this.audio.play('ui');
  }

  buy(itemId: string, count: number): Promise<SaveResult> {
    return this.save.buy(itemId, count);
  }

  sell(itemId: string, count: number): Promise<SaveResult> {
    return this.save.sell(itemId, count);
  }

  startTraining(): void {
    this.createSession(null);
    this.setOverlay(null);
    this.audio.play('ui');
  }

  /** 依頼へ出発する。まだ受けられない依頼（下の段階を達成していない）は、何もしない。 */
  startHunt(questId: string): void {
    const quest = this.content.quests.get(questId);
    if (!quest || !questUnlocked(this.save.doc, quest)) return;
    // 狩らない依頼（v0.27.0）は、フィールドでだけ遊べる（1 つの狩場 ?hunt=arena では始めない）
    if (quest.kind === 'gather' && !this.fieldHunts) return;
    if(this.departing)return;
    if(this.unsaved.length||this.settleState?.state==='saving'){this.base.notify('未保存の報酬を先に保存してください。',true);return;}
    const prep={...lifeOf(this.save.doc).prep};
    const start=()=>{this.huntPrep=prep;this.createSession(questId);this.huntPrep=undefined;this.setOverlay(null);this.audio.play('ui');};
    if(!hasPrep(prep)){start();return;}
    this.departing=true;
    void this.save.hubLife({kind:'consumePrep'},this.save.doc.revision).then(r=>{if(r.ok)start();else this.base.notify(r.message,true);}).catch(()=>this.base.notify('出発準備の保存に失敗しました',true)).finally(()=>{this.departing=false;});
  }

  /** 拠点へ戻る。歩く拠点では里に立ち、一覧の拠点では画面を開く。 */
  toBase(): void {
    if(this.place==='training'&&this.sim.hitCount>0)void this.save.hubLife({kind:'training',weapon:this.sim.player.weaponId,hits:this.sim.hitCount,damage:Math.round(this.sim.totalDamage)});
    if (this.hubWalk) {
      this.createSession(null, true);
      this.setOverlay(null);
      this.showPendingStory();
      const ready=HUB_RESOURCE_POINTS.filter(p=>['gather','harvest'].includes(resourceStatus(this.save.doc,this.content,p).action)).length;
      if(ready)this.hud.toast('帰還：回収できる採集場 '+ready+'か所｜地図で確認');
      return;
    }
    this.createSession(null);
    this.setOverlay('base');
  }

  retry(): void {
    if (this.questId) this.startHunt(this.questId);
    else this.startTraining();
  }

  // ---- MenuHost ----
  openMenu(): void {
    this.endLayoutEdit();
    this.releaseInputs();
    this.menu.setOpen(true);
    this.keyboard.enabled = false;
    this.gamepad.enabled = false;
    this.touch.enabled = false;
    this.touch.root.hidden = true;
    this.audio.play('ui');
  }

  closeMenu(): void {
    this.menu.setOpen(false);
    this.keyboard.enabled = true;
    this.gamepad.enabled = true;
    this.touch.enabled = true;
    this.touch.root.hidden = false;
    this.releaseInputs();
  }

  startLayoutEdit(): void {
    this.closeMenu();
    this.touch.setEditing(true);
    this.editBar.hidden = false;
  }

  private endLayoutEdit(): void {
    if (!this.touch.editing) return;
    this.touch.setEditing(false);
    this.editBar.hidden = true;
  }

  restartTraining(): void {
    if (this.place !== 'training') return;
    this.createSession(null);
    this.hud.toast('訓練をやり直しました');
  }

  sessionInfo(): { hunt: boolean; done: boolean; title: string; lines: string[] } {
    const h = this.sim.hunt;
    if (this.place === 'hub') return { hunt: false, done: false, title: this.content.hub.name, lines: ['施設や採集場の前で主ボタン。農場・鉱脈・釣り場・虫取り・骨採取は依頼達成で補充・生育します。'] };
    if (!h) return { hunt: false, done: false, title: '訓練場', lines: ['動かない標的で、操作と技を確かめる場所です。'] };
    const left = Math.ceil(Math.max(0, h.timeLimitTicks - h.ticks) / 60);
    return {
      hunt: true,
      done: h.phase === 'success',
      title: `${starLabel(h.quest)}【${this.sim.rank?.name ?? ''}】${h.quest.name}`,
      // 依頼人の話（v0.26.0）: 狩りの途中でも、ヒントを読み返せるように
      lines: [h.quest.summary, `残り ${Math.floor(left / 60)} 分 ${left % 60} 秒　力尽き ${h.faints} / ${h.quest.maxFaints}`, ...(h.quest.board ? [`依頼人（${h.quest.board.client}）: ${h.quest.board.text}`] : [])],
    };
  }

  leave(): void {
    this.closeMenu();
    const h = this.sim.hunt;
    if (h && !h.closed) {
      // リタイア（達成後は帰還）は入力として simulation へ渡す（記録した入力の再生でも同じ tick に終わる）
      this.hub.pulse(Btn.Retire);
    } else this.toBase();
  }

  resumeAudio(): Promise<boolean> {
    return this.audio.resume();
  }

  /** 不具合や重さの報告に付ける行（装備・設定・描画の計測）。 */
  reportLines(): string[] {
    const v = this.store.value;
    const info = this.view.stats();
    return [
      `装備：${this.weaponId} / 防御力 ${defenseOf(this.save.doc, this.content)}${this.sim.rank ? ` / 依頼の段階 ${this.sim.rank.name}` : ''}`,
      `保存：${this.save.mode === 'persistent' ? '端末に保存' : this.save.mode === 'memory' ? '保存なし' : '読めないデータあり（保存なし）'}（revision ${this.save.doc.revision}）`,
      `設定：描画の上限 ${v.fpsCap}fps / 内部解像度 ${v.renderScale.toFixed(2)} / 影 ${v.shadows ? 'あり' : 'なし'}`,
      describeFrames(this.meter.summary()),
      `描画量：draw calls ${info.calls} / 三角形 ${info.triangles}（メニューを開く直前の 1 フレーム）　捨てた tick ${this.clock.droppedTicks}`,
      '※ 間隔は画面の更新と更新の間の時間で、GPU の処理時間そのものではありません。',
    ];
  }

  /** 計測をやり直す（設定を変えた後や、場面を変えて測りたい時）。 */
  resetMeter(): void {
    this.meter.reset();
    this.meterSummary = this.meter.summary();
    this.meterSkip = true;
  }

  /** 景色の絵（依頼 8）を、いくつ頼んで、いくつ読めたか（検査用）。 */
  envArt(): { loaded: number; asked: number; failed: number } {
    return envArtStatus();
  }

  audioState(): string {
    return this.audio.state;
  }

  /** 記録した入力を 60fps と 30fps で再生し、tick ごとの結果を比べる。 */
  runDeterminismCheck(): string {
    if (this.recorded.length === 0) return 'まだ入力の記録がありません。少し動かしてから確認してください。';
    const opts = this.sim.options;
    const a = runReplay(this.content, opts, this.recorded, () => 1 / 60);
    const b = runReplay(this.content, opts, this.recorded, () => 1 / 30);
    const mismatch = firstMismatch(a, b);
    const lines = [
      `記録 ${this.recorded.length} tick（${(this.recorded.length / 60).toFixed(1)} 秒）  seed ${opts.seed}`,
      `60fps 再生: 描画 ${a.renderFrames} フレーム / 命中 ${a.hitCount} 回 / 与ダメ ${a.totalDamage} / 被ダメ ${a.damageTaken} / HP ${a.playerHp}`,
      `30fps 再生: 描画 ${b.renderFrames} フレーム / 命中 ${b.hitCount} 回 / 与ダメ ${b.totalDamage} / 被ダメ ${b.damageTaken} / HP ${b.playerHp}`,
      mismatch < 0 ? '結果: 一致（全 tick の状態が同じ）' : `結果: 不一致（tick ${mismatch} で食い違い）`,
    ];
    if (this.recordOverflow) lines.push('※ 記録が上限（16 分）を超えたため、いまの画面との照合は省略しました。');
    else lines.push(a.finalHash === this.sim.hash() ? 'いまの画面の状態とも一致' : '※ いまの画面の状態とは不一致（報告してください）');
    return lines.join('\n');
  }

  // ---- メインループ ----
  start(): void {
    requestAnimationFrame(this.frame);
  }

  private frame = (ts: number): void => {
    requestAnimationFrame(this.frame);
    const cap = this.store.value.fpsCap;
    if (cap === 30 && ts - this.lastRender < 1000 / 30 - 3) return;
    this.lastRender = ts;
    const paused = this.departing || this.menu.open || this.base.open || this.result.open || this.story.open || this.looks.open || this.touch.editing || this.portrait.matches || document.hidden;
    if (paused !== this.paused) {
      this.paused = paused;
      this.releaseInputs();
    }
    this.base.updateReceptionPad(this.base.open && !this.menu.open && !this.result.open && !this.story.open && !this.looks.open && !this.touch.editing && !this.portrait.matches && !document.hidden);
    if (this.lastTs === 0) this.lastTs = ts;
    const rawMs = ts - this.lastTs;
    const dt = Math.min(0.25, rawMs / 1000);
    this.lastTs = ts;
    if (paused) this.meterSkip = true;
    else if (this.meterSkip) this.meterSkip = false;
    else this.meter.push(rawMs);
    if (++this.meterAge >= 30) {
      this.meterAge = 0;
      this.meterSummary = this.meter.summary();
    }
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;

    let alpha = 1;
    let interact = false;
    if (!paused) {
      this.gamepad.update(dt);
      this.keyboard.update(dt);
      this.updateAim(dt);
      const n = this.clock.advance(dt);
      for (let i = 0; i < n; i++) {
        const input = this.hub.sample(this.view.cam.yaw, this.aim ?? undefined, this.aimLatch ? Btn.Special : 0);
        if (this.place === 'hub') {
          // 里: 歩く・走る・回避だけ。主ボタンは「施設へ入る」
          if (input.pressed & Btn.Main) interact = true;
          const working=this.gatheringVisual&&this.sim.tick<this.gatheringVisual.until;
          if(working){input.moveX=0;input.moveZ=0;}
          const keep = working?0:Btn.Dodge | Btn.Sprint;
          input.held &= keep;
          input.pressed &= keep;
          input.released &= keep;
        }
        if(this.pendingSupply!==undefined){input.supplyId=this.pendingSupply;this.pendingSupply=undefined;}
        if (this.recorded.length < MAX_RECORD) this.recorded.push(input);
        else this.recordOverflow = true;
        this.sim.step(input);
      }
      if (this.place === 'hub') {
        // 施設の前で、同じ段にいる時だけ（v0.31.0。src/game/hub.ts）
        const near = nearestFacility(this.content.hub.facilities, this.sim.world, this.sim.player.pos);
        this.nearFacility = near;
        this.nearResource=near?null:nearbyResource(this.sim.world,this.sim.player.pos);
        this.nearService=near||this.nearResource?null:serviceNear(this.sim.world,this.sim.player.pos);
        if(this.fishing&&(this.nearResource?.id!=='fish'||this.sim.tick>=this.fishing.to)){
          this.fishing=null;this.hud.toast('釣りを中止した。もう一度釣れる');
        }
        if (interact) this.interactHub();
      }
      alpha = this.clock.alpha;
      const events = this.sim.drainEvents();
      if (events.length > 0) {
        this.view.handleEvents(events, this.sim);
        this.hud.onEvents(events, this.sim, this.view);
        this.playSounds(events);
      }
      const pl = this.sim.player;
      const stack = pl.items[pl.itemIndex];
      const inHub = this.place === 'hub';
      this.touch.setHidden(['item', 'itemprev', 'itemnext'], inHub || pl.items.length === 0);
      const fam = familyOf(pl, this.content);
      // 猛り（双剣。v0.54.0）の間は、固有ボタン（解く）と同時押し（連ね斬り）の表示名が替わる
      const labels = pl.demon && fam.labels && fam.demon?.labels ? { ...fam.labels, ...fam.demon.labels } : fam.labels;
      this.touch.setHidden(['special'], inHub || !labels?.special);
      // 里では、武器を使うボタンを出さない。複合入力のボタン（v0.40.0）は、複合の技を持つ武器だけ
      this.touch.setHidden(['weapon', 'sub'], inHub);
      this.touch.setHidden(['combo'], inHub || !fam.actions.combo);
      // 道具（v0.40.0。2G）: 抜刀中に押すと納刀する（護刃は、防御を構えている間だけ、そのまま使える）
      const sheathesFirst = pl.drawn && !(fam.itemsWhileGuarding && pl.mode === 'guard');
      this.touch.setLabels({
        weapon: pl.drawn ? '納刀' : '抜刀',
        main: inHub ? (this.nearFacility ? '入る' : this.resourcePrompt()?.action ?? '—') : this.sim.carveTarget() ? '剥ぎ取り' : errandLabel(this.sim) ?? labels?.main ?? '斬る',
        sub: labels?.sub ?? '薙ぐ',
        special: this.aim && this.aimLatch ? '狙い中' : labels?.special ?? '',
        combo: labels?.combo ?? '',
        dodge: (pl.drawn && labels?.dodge) || '回避',
        item: stack ? `${this.content.items.get(stack.itemId)?.name ?? ''}\n${sheathesFirst ? '納刀' : `×${stack.count}`}` : '道具',
      });
      this.touch.setIcon('item', stack ? iconUrl(stack.itemId) : null);
      this.touch.root.classList.toggle('item-empty', !!stack && stack.count === 0);
      const h = this.sim.hunt;
      if (h?.closed) {
        this.settleRewards();
        if (this.sim.tick - (h.phase === 'failed' ? h.endTick : h.closeTick) >= RESULT_DELAY_TICKS[h.phase === 'failed' ? 'failed' : 'success']) this.setOverlay('result');
      }
    }
    // 外見（v0.28.0）: 見た目を変える画面の下見（カメラを狩人の前へ）か、保存した外見
    const pv = this.looks.preview(this.canvas.getBoundingClientRect());
    this.view.portrait = pv ? { baseYaw: this.looksYaw, spin: pv.spin, focus: pv.focus, zoom: pv.zoom, pane: pv.pane, clothes: pv.clothes } : null;
    this.syncLook(pv?.look ?? null);
    if(this.place==='hub'){
      if(this.lifeRevision!==this.save.doc.revision){this.lifeRevision=this.save.doc.revision;this.audio.setHubMusic(true,hubThreat(this.content,this.save.doc.progress.questClears)===2);this.view.setHubLife(lifeOf(this.save.doc),resourceCycle(this.save.doc,this.content),villageLevel(this.save.doc,this.content),hubThreat(this.content,this.save.doc.progress.questClears));}
      this.view.hubGather=this.fishing?'fish':this.gatheringVisual&&this.sim.tick<this.gatheringVisual.until?this.gatheringVisual.kind:null;
    }
    let look = paused ? { x: 0, y: 0 } : this.hub.consumeLook();
    // 手で狙う（v0.61.0）: 狙っている間は、視点の操作で狙いを動かす（感度・反転の設定はそのまま。下へなぞると下を狙う）
    const aimDef = familyOf(this.sim.player, this.content).aim;
    if (this.aim && aimDef) {
      const st = this.store.value;
      this.aim.yaw -= (st.invertX ? -look.x : look.x) * st.camSensitivity;
      this.aim.pitch = clamp(this.aim.pitch - (st.invertY ? -look.y : look.y) * st.camSensitivity, aimDef.pitchMinDeg * DEG, aimDef.pitchMaxDeg * DEG);
      look = { x: 0, y: 0 };
    }
    this.view.aim = this.aim ? { ...this.aim } : null;
    this.view.update(this.sim, alpha, paused ? 0 : dt, look, this.store.value.verify);
    // 照準: 狙いの線が最初に当たる所（モンスターなら明るく、適正距離 6〜12m なら金色）。simulation が矢を飛ばす所と同じ
    if (this.aim) {
      const pl = this.sim.player;
      const t = aimTarget(this.sim.monsters, this.sim.world, aimEye(pl.pos, this.aim.yaw), aimDir(this.aim.yaw, this.aim.pitch));
      this.hud.setAim({ kind: t.kind, dist: t.dist });
    } else this.hud.setAim(null);
    // ロックオン: 照準と、ボタンの印。標的が見えなくなって外れた時は、知らせる
    if (this.view.lockLost) {
      this.view.lockLost = false;
      this.hud.toast('ロックオンが外れた');
    }
    const lockAt = this.view.lockPoint ? this.view.project(this.view.lockPoint) : null;
    this.hud.setLock(lockAt && lockAt.visible ? lockAt : null);
    // ロックオンのボタンを設定で消したら、ロックオンも外す（v0.40.0）
    if (this.view.lockOn && !this.store.value.lockOnButton) this.view.lockOn = false;
    this.touch.setLatched('lock', this.view.lockOn);
    this.touch.setHidden(['lock'], this.place === 'hub' || !this.store.value.lockOnButton);
    if(!this.base.estateActive)this.view.render();
    this.hud.setFacility(this.place === 'hub' && !paused ? (this.nearFacility ?? this.resourcePrompt()) : null, this.place === 'hub');
    this.renderSupply(!paused&&this.place==='hunt');
    this.hud.update(this.sim, this.view, { fps: this.fps, droppedTicks: this.clock.droppedTicks, frames: this.meterSummary }, dt);
  };

  private renderSupply(active:boolean):void{
    const choices=active?this.sim.supplyChoices():[];this.supplyUI.hidden=choices.length===0;
    if(!choices.length){this.supplyUI.open=false;this.supplyKey='';return;}
    const key=JSON.stringify(choices);if(key===this.supplyKey)return;this.supplyKey=key;
    const summary=document.createElement('summary');summary.textContent='支給品ボックス';this.supplyUI.replaceChildren(summary);
    for(const x of choices){const b=document.createElement('button');b.type='button';b.textContent=(this.content.items.get(x.itemId)?.name??x.itemId)+' ×'+x.count+'　受取 '+Math.min(x.count,x.room);b.disabled=x.room<=0;b.onclick=()=>{if(!this.paused&&!this.pendingSupply)this.pendingSupply=x.itemId;};this.supplyUI.appendChild(b);}
  }

  private playSounds(events: ReturnType<Simulation['drainEvents']>): void {
    const play = (id: string, k = 1): void => {
      if (!this.audio.play(id, k) && this.audio.state === 'running' && !this.warned.has(id)) {
        this.warned.add(id);
        console.warn(`[audio] 未定義の音 id: ${id}`);
      }
    };
    // 群れの幼体の音は小さく（v0.18.0）
    const small = (id: string): number => (this.sim.monsters.find((m) => m.id === id)?.herd ? 0.55 : 1);
    for (const e of events) {
      switch (e.type) {
        case 'area_change':
          play('ui');
          break;
        case 'action_event':
          if (e.kind === 'sound') play(e.id, small(e.actor));
          else if (e.kind === 'vfx' && e.id === 'ground_slam') play('ground_slam', small(e.actor));
          break;
        case 'herd_alarm': {
          // 群れが気づいた・逃げ出した: 体つきに合った短い鳴き声
          const frame = CREATURE_PLANS[this.sim.herds.find((g) => g.id === e.herdId)?.monsterId ?? '']?.frame;
          play(HERD_CRY[frame ?? 'quad'] ?? 'beast_cry', e.flee ? 0.4 : 0.25);
          break;
        }
        case 'hit':
          // 空振りは振り音だけ。命中した時にだけ、部位の材質に応じた命中音を鳴らす。
          play(`hit_${e.material}`, 1 + e.chargeLevel * 0.2);
          // 弾かれた時は、金属が跳ね返る音を足す（専用の音はまだ無く、防御の音を流用）
          if (e.bounced) play('guard');
          break;
        case 'part_break':
          play('part_break');
          break;
        case 'part_sever':
          play('part_sever');
          break;
        case 'monster_stagger':
          if (e.kind === 'topple') play('monster_topple');
          break;
        case 'hazard_impact':
          play('rock_impact');
          break;
        case 'hunt_end':
          play(e.phase === 'success' ? 'hunt_clear' : 'hunt_fail');
          break;
        case 'guard':
          play('guard');
          break;
        case 'parry':
          play('guard');
          break;
        case 'guard_break':
          play('guard_break');
          break;
        case 'player_hurt':
          play('hurt');
          break;
        case 'monster_ailment':
          // モンスターの状態異常（v0.33.0）: 付いた時に音（知らせは HUD）
          if (e.on) play('status_on', small(e.target));
          break;
        case 'status':
          // 状態異常（v0.17.0）: 付いた時に音と知らせ。消えた時は、知らせだけ（毒）
          if (e.on) {
            play('status_on');
            this.hud.toast(STATUS_TOAST[e.kind]);
          } else if (e.kind === 'poison') this.hud.toast('毒が抜けた');
          break;
        case 'evade':
          play('evade');
          break;
        case 'charge_level':
          play(`charge_${e.level}`);
          break;
        case 'monster_dead': {
          const m = this.sim.monsters.find((x) => x.id === e.target);
          play('monster_dead', m?.herd ? 0.5 : 1);
          // 群れの依頼: 標的を倒したら、残りの数を知らせる
          const t = m && this.sim.pack && this.sim.hunt?.phase === 'active' ? this.sim.targets.find((x) => x.monsterId === m.def.id) : undefined;
          if (m && t) {
            const left = Math.max(0, t.count - this.sim.slain(t.monsterId));
            const name = shortName(m.def.name);
            const unit = counterOf(m.def.id);
            this.hud.toast(left > 0 ? `${name}を討伐（あと ${left} ${unit}）` : `${name}を ${t.count} ${unit}討伐`);
          }
          break;
        }
        case 'stamina_empty':
          play('no_stamina');
          break;
        case 'spirit':
          // 気（太刀）: 満ちた時に溜めの音
          if (e.full) play('charge_2');
          break;
        case 'spirit_empty':
          play('no_stamina');
          this.hud.toast('気が無い（斬ってためる）');
          break;
        case 'coating':
          // ビン（環弓。v0.60.0）: 付けた時は溜めの音、使い切った時は知らせの音
          if (e.on) play('charge_1');
          else if (e.reason === 'out') play('no_stamina');
          break;
        case 'coating_empty':
          play('no_stamina');
          break;
        case 'demon':
          // 猛り（双剣）: 入った時は溜めの音、スタミナが尽きて解けた時は知らせ
          if (e.on) play('charge_2');
          else if (e.reason === 'stamina') {
            play('no_stamina');
            this.hud.toast('スタミナが尽きて、猛りが解けた');
          }
          break;
        case 'item_effect':
          if (e.kind === 'heal') play('item_heal');
          // 研ぎ上がり（専用の音はまだ無く、溜めの段階の音を流用）
          else if (e.kind === 'whet') play('charge_2');
          else if (e.kind === 'tranq' && e.ok) play('tranq_hit');
          // 標識玉が当たった（専用の音はまだ無く、鎮静玉の音を流用。v0.42.0）
          else if (e.kind === 'mark' && e.ok) play('tranq_hit');
          else if (!e.ok && e.kind === 'trap') play('item_fail');
          break;
        case 'item_fail':
          play('item_fail');
          break;
        // 降りて着いた（v0.45.0）: 専用の音はまだ無く、高い所からなら岩の当たる音を流用（仮）
        case 'land':
          if (e.height >= 2.5) play('rock_impact');
          break;
        case 'trap_armed':
          play('trap_armed');
          break;
        case 'trap_trigger':
          play('trap_trigger');
          break;
        case 'monster_captured':
          play('capture');
          break;
        case 'carve':
          play('carve_get');
          break;
        default:
          break;
      }
    }
  }
}

/** 群れが騒いだ時の鳴き声（体つきごと。専用の声はまだ無く、成体の声を小さく流用） */
const HERD_CRY: Record<string, string> = { quad: 'beast_cry', biped: 'bird_screech', crab: 'shell_clack', bug: 'insect_buzz', arch: 'hiss', serpent: 'hiss' };

/** 依頼 1 回ごとの識別子。戦闘の計算には使わない（報酬を 1 度だけ確定するための目印）。 */
function makeRunId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `run-${c.randomUUID()}`;
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 狩らない依頼（v0.27.0）: 攻撃ボタンの名前（採集・採掘・納品）。できることが無ければ null */
function errandLabel(sim: Simulation): string | null {
  const op=sim.player.errandOp;if(op?.target.kind==='field_node'&&op.target.source==='fish'&&sim.player.mode==='action')return '引く';
  const t = sim.errandTarget();if(!t)return null;
  if(t.kind==='deliver')return sim.errand?.def.fieldGathering?'帰還':'納品';
  if(t.kind==='field_node')return FIELD_GATHER_LABEL[t.source];
  return sim.errand?.def.nodes.find((n) => n.id === t.nodeId)?.kind === 'mine' ? '採掘' : '採集';
}

