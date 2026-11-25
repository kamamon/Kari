// ゲーム全体のつなぎ役。入力 → 60Hz 固定 simulation → 描画 / 音 / HUD の順に 1 フレームを回す。
// 行き先は 拠点（選択画面）/ 訓練場 / 依頼 の 3 つ。依頼の成否は simulation が決め、ここは表示するだけ。
import { AudioSystem } from './core/audio';
import { FixedClock } from './core/clock';
import { FrameMeter, describeFrames, type FrameSummary } from './core/frameMeter';
import { yawOf } from './core/math';
import type { ArmorSlot, Content, FacilityDef } from './data/schemas';
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
import { scenesUnlocked, type StoryOutcome } from './data/story';

const DEFAULT_SEED = 20261122;
const MAX_RECORD = 60 * 60 * 16;
/** 依頼が終わってから結果を出すまでの間（倒れる動きを見せる） */
/** 結果が閉じてから結果画面を出すまでの間 */
const RESULT_DELAY_TICKS = { success: 50, failed: 90 };

/** 状態異常が付いた時の知らせ */
const STATUS_TOAST: Record<string, string> = { poison: '毒を受けた', para: '体が痺れて動けない', sleep: '眠ってしまった', stun: '気を失った' };

export class App implements MenuHost, BaseHost, ResultHost {
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
  private editBar: HTMLElement;
  private rotate: HTMLElement;
  private recorded: InputFrame[] = [];
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
    this.touch = new TouchControls(this.hub, store, ui);
    this.menu = new Menu(ui, store, this);
    this.result = new ResultScreen(ui, this);
    this.base = new BaseScreen(ui, content, this);
    this.story = new StoryDialog(ui, content);

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
      if (this.base.open || this.result.open || this.story.open) return;
      if (a === 'menu') this.menu.open ? this.closeMenu() : this.openMenu();
      else if (a === 'verify') store.set({ verify: !store.value.verify });
      else if (a === 'camReset' && !this.paused) this.resetCamera();
      else if (a === 'lockOn' && !this.paused) this.toggleLock();
      else if (a === 'return' && !this.paused) this.returnNow();
      else if (a === 'interact' && !this.paused && this.place === 'hub' && this.nearFacility) this.openFacility(this.nearFacility.kind);
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

  private options(questId: string | null, hub = false): SimOptions {
    return {
      seed: DEFAULT_SEED,
      mapId: hub ? this.content.hub.mapId : 'map.basin.training',
      weaponId: this.weaponId,
      monsterId: hub ? null : 'monster.training_dummy',
      monsterAttacks: hub ? false : this.store.value.dummyAttacks,
      questId,
      // 依頼へは、持っている道具を、持ち出せる数まで持っていく
      pouch: questId ? pouchOf(this.save.doc, this.content) : [],
      armorIds: wornArmor(this.save.doc, this.content).map((a) => a.id),
      field: this.fieldHunts,
    };
  }

  /**
   * 拠点の持ち物（保存データの写し）。検査用に、以前と同じ形で読めるようにしてある。
   * 中身を変えるのは保存の管理役だけで、書き込みが完了してから増える。
   */
  get inventory(): { money: number; items: Map<string, number> } {
    return { money: this.save.doc.money, items: new Map(Object.entries(this.save.doc.items)) };
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
    const spent = this.sim.spentOwn();
    if (!success && spent.length === 0) return;
    const rewards: RunRewards = success
      ? { runId: this.runId, questId: h.quest.id, money: h.rewards!.money, items: h.rewards!.items.map((s) => ({ ...s })), spent }
      : { runId: this.runId, questId: h.quest.id, money: 0, items: [], spent, cleared: false };
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
    const ids = scenesUnlocked(this.content.story, before, this.save.doc.progress.questClears);
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
    this.runId = questId ? makeRunId() : '';
    this.sim = new Simulation(this.content, this.options(questId, hub));
    this.view?.dispose();
    this.view = new GameView(this.canvas, this.content, this.sim, this.store.value);
    this.view.onSound = (id, k) => void this.audio.play(id, k);
    this.recorded = [];
    this.recordOverflow = false;
    this.clock.reset();
  }

  /** 拠点・結果の画面を出す / 消す。出ている間は操作ボタンを隠して一時停止する。 */
  private setOverlay(which: 'base' | 'result' | null, section: BaseSection = 'all'): void {
    this.base.setOpen(which === 'base', section);
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
    if (this.place === 'hub') return;
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
      this.createSession(null, true);
      const p = this.sim.player;
      p.pos = { ...at.pos };
      p.prevPos = { ...at.pos };
      p.yaw = at.yaw;
      p.prevYaw = at.yaw;
      this.view.cam.snap(at.yaw);
      this.setOverlay('base', section);
      return;
    }
    this.createSession(null);
    this.setOverlay('base');
  }

  // ---- 里（歩く拠点）----
  /** 施設の画面を開く（all = すべての欄の一覧）。開いている間は、一時停止する。 */
  openFacility(section: BaseSection): void {
    this.setOverlay('base', section);
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
    this.createSession(questId);
    this.setOverlay(null);
    this.audio.play('ui');
  }

  /** 拠点へ戻る。歩く拠点では里に立ち、一覧の拠点では画面を開く。 */
  toBase(): void {
    if (this.hubWalk) {
      this.createSession(null, true);
      this.setOverlay(null);
      this.showPendingStory();
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
    if (this.place === 'hub') return { hunt: false, done: false, title: this.content.hub.name, lines: ['施設の前に立つと、入るボタンが出ます。右上の「一覧」からは、歩かずに開けます。'] };
    if (!h) return { hunt: false, done: false, title: '訓練場', lines: ['動かない標的で、操作と技を確かめる場所です。'] };
    const left = Math.ceil(Math.max(0, h.timeLimitTicks - h.ticks) / 60);
    return {
      hunt: true,
      done: h.phase === 'success',
      title: `【${this.sim.rank?.name ?? ''}】${h.quest.name}`,
      lines: [h.quest.summary, `残り ${Math.floor(left / 60)} 分 ${left % 60} 秒　力尽き ${h.faints} / ${h.quest.maxFaints}`],
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
    const paused = this.menu.open || this.base.open || this.result.open || this.story.open || this.touch.editing || this.portrait.matches || document.hidden;
    if (paused !== this.paused) {
      this.paused = paused;
      this.releaseInputs();
    }
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
      const n = this.clock.advance(dt);
      for (let i = 0; i < n; i++) {
        const input = this.hub.sample(this.view.cam.yaw);
        if (this.place === 'hub') {
          // 里: 歩く・走る・回避だけ。主ボタンは「施設へ入る」
          if (input.pressed & Btn.Main) interact = true;
          const keep = Btn.Dodge | Btn.Sprint;
          input.held &= keep;
          input.pressed &= keep;
          input.released &= keep;
        }
        if (this.recorded.length < MAX_RECORD) this.recorded.push(input);
        else this.recordOverflow = true;
        this.sim.step(input);
      }
      if (this.place === 'hub') {
        const p = this.sim.player.pos;
        let near: FacilityDef | null = null;
        let best = Infinity;
        for (const f of this.content.hub.facilities) {
          const d = Math.hypot(f.x - p.x, f.z - p.z);
          if (d <= f.r && d < best) {
            best = d;
            near = f;
          }
        }
        this.nearFacility = near;
        if (interact && near) this.openFacility(near.kind);
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
      const labels = familyOf(pl, this.content).labels;
      this.touch.setHidden(['special'], inHub || !labels?.special);
      // 里では、武器を使うボタンを出さない
      this.touch.setHidden(['weapon', 'sub'], inHub);
      this.touch.setLabels({
        weapon: pl.drawn ? '納刀' : '抜刀',
        main: inHub ? (this.nearFacility ? '入る' : '—') : this.sim.carveTarget() ? '剥ぎ取り' : labels?.main ?? '斬る',
        sub: labels?.sub ?? '薙ぐ',
        special: labels?.special ?? '',
        dodge: (pl.drawn && labels?.dodge) || '回避',
        item: stack ? `${this.content.items.get(stack.itemId)?.name ?? ''}\n×${stack.count}` : '道具',
      });
      this.touch.setIcon('item', stack ? iconUrl(stack.itemId) : null);
      this.touch.root.classList.toggle('item-empty', !!stack && stack.count === 0);
      const h = this.sim.hunt;
      if (h?.closed) {
        this.settleRewards();
        if (this.sim.tick - (h.phase === 'failed' ? h.endTick : h.closeTick) >= RESULT_DELAY_TICKS[h.phase === 'failed' ? 'failed' : 'success']) this.setOverlay('result');
      }
    }
    this.view.update(this.sim, alpha, paused ? 0 : dt, paused ? { x: 0, y: 0 } : this.hub.consumeLook(), this.store.value.verify);
    // ロックオン: 照準と、ボタンの印。標的が見えなくなって外れた時は、知らせる
    if (this.view.lockLost) {
      this.view.lockLost = false;
      this.hud.toast('ロックオンが外れた');
    }
    const lockAt = this.view.lockPoint ? this.view.project(this.view.lockPoint) : null;
    this.hud.setLock(lockAt && lockAt.visible ? lockAt : null);
    this.touch.setLatched('lock', this.view.lockOn);
    this.touch.setHidden(['lock'], this.place === 'hub');
    this.view.render();
    this.hud.setFacility(this.place === 'hub' && !paused ? this.nearFacility : null, this.place === 'hub');
    this.hud.update(this.sim, this.view, { fps: this.fps, droppedTicks: this.clock.droppedTicks, frames: this.meterSummary }, dt);
  };

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
        case 'item_effect':
          if (e.kind === 'heal') play('item_heal');
          // 研ぎ上がり（専用の音はまだ無く、溜めの段階の音を流用）
          else if (e.kind === 'whet') play('charge_2');
          else if (e.kind === 'tranq' && e.ok) play('tranq_hit');
          else if (!e.ok && e.kind === 'trap') play('item_fail');
          break;
        case 'item_fail':
          play('item_fail');
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
