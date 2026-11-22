// ゲーム全体のつなぎ役。入力 → 60Hz 固定 simulation → 描画 / 音 / HUD の順に 1 フレームを回す。
// 行き先は 拠点（選択画面）/ 訓練場 / 依頼 の 3 つ。依頼の成否は simulation が決め、ここは表示するだけ。
import { AudioSystem } from './core/audio';
import { FixedClock } from './core/clock';
import { yawOf } from './core/math';
import type { Content } from './data/schemas';
import { Btn, type InputFrame } from './game/inputFrame';
import { firstMismatch, runReplay } from './game/replay';
import { Simulation, type SimOptions } from './game/sim';
import { GamepadInput } from './input/gamepad';
import { InputHub } from './input/hub';
import { KeyboardMouse } from './input/keyboard';
import { TouchControls } from './input/touch';
import { GameView } from './render/view';
import type { SettingsStore } from './save/settings';
import { BaseScreen, type BaseHost } from './ui/base';
import { Hud } from './ui/hud';
import { Menu, type MenuHost } from './ui/menus';
import { ResultScreen, type ResultHost } from './ui/result';

const DEFAULT_SEED = 20261122;
const MAX_RECORD = 60 * 60 * 16;
/** 依頼が終わってから結果を出すまでの間（倒れる動きを見せる） */
const RESULT_DELAY_TICKS = { success: 200, failed: 90 };

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
  private editBar: HTMLElement;
  private rotate: HTMLElement;
  private recorded: InputFrame[] = [];
  private recordOverflow = false;
  private questId: string | null = null;
  private lastTs = 0;
  private lastRender = 0;
  private fps = 60;
  private paused = false;
  private warned = new Set<string>();
  private portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
    private content: Content,
    private store: SettingsStore,
    private audio: AudioSystem,
  ) {
    this.keyboard = new KeyboardMouse(this.hub, canvas);
    this.gamepad = new GamepadInput(this.hub);
    this.hud = new Hud(ui, this.hub);
    this.touch = new TouchControls(this.hub, store, ui);
    this.menu = new Menu(ui, store, this);
    this.result = new ResultScreen(ui, this);
    this.base = new BaseScreen(ui, content, this);

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

    this.createSession(null);
    this.hud.setVerify(store.value.verify);
    this.setOverlay('base');

    this.hub.onUi((a) => {
      if (this.base.open || this.result.open) return;
      if (a === 'menu') this.menu.open ? this.closeMenu() : this.openMenu();
      else if (a === 'verify') store.set({ verify: !store.value.verify });
      else if (a === 'camReset' && !this.paused) this.resetCamera();
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

  private options(questId: string | null): SimOptions {
    return {
      seed: DEFAULT_SEED,
      mapId: 'map.basin.training',
      weaponId: 'weapon.heavy_blade.001',
      monsterId: 'monster.training_dummy',
      monsterAttacks: this.store.value.dummyAttacks,
      questId,
    };
  }

  private createSession(questId: string | null): void {
    this.questId = questId;
    this.sim = new Simulation(this.content, this.options(questId));
    this.view?.dispose();
    this.view = new GameView(this.canvas, this.content, this.sim, this.store.value);
    this.view.onSound = (id, k) => void this.audio.play(id, k);
    this.recorded = [];
    this.recordOverflow = false;
    this.clock.reset();
  }

  /** 拠点・結果の画面を出す / 消す。出ている間は操作ボタンを隠して一時停止する。 */
  private setOverlay(which: 'base' | 'result' | null): void {
    this.base.setOpen(which === 'base');
    if (which === 'result') this.result.show(this.sim);
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

  private resetCamera(): void {
    const p = this.sim.player;
    const m = this.sim.monsters[0];
    if (this.store.value.targetAssist && m && !m.dead) this.view.cam.resetBehind(yawOf(m.pos.x - p.pos.x, m.pos.z - p.pos.z));
    else this.view.cam.resetBehind(p.yaw);
  }

  // ---- BaseHost / ResultHost ----
  startTraining(): void {
    this.createSession(null);
    this.setOverlay(null);
    this.audio.play('ui');
  }

  startHunt(questId: string): void {
    this.createSession(questId);
    this.setOverlay(null);
    this.audio.play('ui');
  }

  toBase(): void {
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
    this.createSession(null);
    this.hud.toast('訓練をやり直しました');
  }

  sessionInfo(): { hunt: boolean; title: string; lines: string[] } {
    const h = this.sim.hunt;
    if (!h) return { hunt: false, title: '訓練場', lines: ['動かない標的で、操作と技を確かめる場所です。'] };
    const left = Math.ceil(Math.max(0, h.quest.timeLimitTicks - h.ticks) / 60);
    return {
      hunt: true,
      title: h.quest.name,
      lines: [h.quest.summary, `残り ${Math.floor(left / 60)} 分 ${left % 60} 秒　力尽き ${h.faints} / ${h.quest.maxFaints}`],
    };
  }

  leave(): void {
    this.closeMenu();
    if (this.sim.hunt?.phase === 'active') {
      // リタイアは入力として simulation へ渡す（記録した入力の再生でも同じ tick に終わる）
      this.hub.pulse(Btn.Retire);
    } else this.toBase();
  }

  resumeAudio(): Promise<boolean> {
    return this.audio.resume();
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
    const paused = this.menu.open || this.base.open || this.result.open || this.touch.editing || this.portrait.matches || document.hidden;
    if (paused !== this.paused) {
      this.paused = paused;
      this.releaseInputs();
    }
    if (this.lastTs === 0) this.lastTs = ts;
    const dt = Math.min(0.25, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;

    let alpha = 1;
    if (!paused) {
      this.gamepad.update(dt);
      this.keyboard.update(dt);
      const n = this.clock.advance(dt);
      for (let i = 0; i < n; i++) {
        const input = this.hub.sample(this.view.cam.yaw);
        if (this.recorded.length < MAX_RECORD) this.recorded.push(input);
        else this.recordOverflow = true;
        this.sim.step(input);
      }
      alpha = this.clock.alpha;
      const events = this.sim.drainEvents();
      if (events.length > 0) {
        this.view.handleEvents(events, this.sim);
        this.hud.onEvents(events, this.sim, this.view);
        this.playSounds(events);
      }
      this.touch.setLabels({ weapon: this.sim.player.drawn ? '納刀' : '抜刀' });
      const h = this.sim.hunt;
      if (h && h.phase !== 'active' && this.sim.tick - h.endTick >= RESULT_DELAY_TICKS[h.phase]) this.setOverlay('result');
    }
    this.view.update(this.sim, alpha, paused ? 0 : dt, paused ? { x: 0, y: 0 } : this.hub.consumeLook(), this.store.value.verify);
    this.view.render();
    this.hud.update(this.sim, this.view, { fps: this.fps, droppedTicks: this.clock.droppedTicks }, dt);
  };

  private playSounds(events: ReturnType<Simulation['drainEvents']>): void {
    const play = (id: string, k = 1): void => {
      if (!this.audio.play(id, k) && this.audio.state === 'running' && !this.warned.has(id)) {
        this.warned.add(id);
        console.warn(`[audio] 未定義の音 id: ${id}`);
      }
    };
    for (const e of events) {
      switch (e.type) {
        case 'action_event':
          if (e.kind === 'sound') play(e.id);
          else if (e.kind === 'vfx' && e.id === 'ground_slam') play('ground_slam');
          break;
        case 'hit':
          // 空振りは振り音だけ。命中した時にだけ、部位の材質に応じた命中音を鳴らす。
          play(`hit_${e.material}`, 1 + e.chargeLevel * 0.2);
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
        case 'guard_break':
          play('guard_break');
          break;
        case 'player_hurt':
          play('hurt');
          break;
        case 'evade':
          play('evade');
          break;
        case 'charge_level':
          play(`charge_${e.level}`);
          break;
        case 'monster_dead':
          play('monster_dead');
          break;
        case 'stamina_empty':
          play('no_stamina');
          break;
        default:
          break;
      }
    }
  }
}
