// 効果音。M1 は音声ファイルを持たず、Web Audio で合成した「仮の音」を鳴らす（asset-manifest に仮素材として記録）。
// ブラウザの自動再生制限のため、開始ボタンの操作から初期化する。復帰に失敗した時は設定の「音声を再開」を使う。
import type { Settings } from '../save/settings';
import { HubSoundtrack, type HubSample } from './hubSoundtrack';

type Bus = 'se' | 'bgm' | 'env';

/** play() が鳴らせる音の id。技データの events と asset-manifest の仮素材一覧は、テストでこの一覧と照合する。 */
export const SOUND_IDS = [
  'hb_swing_01', 'hb_swing_02', 'hb_draw_01', 'hb_sheathe_01', 'roll_01', 'hit_rock', 'hit_shell', 'hit_hide', 'part_break', 'guard', 'guard_break',
  'hurt', 'evade', 'charge_1', 'charge_2', 'charge_3', 'dummy_warn_01', 'dummy_swing_01', 'ground_slam', 'monster_dead', 'no_stamina', 'ui',
  'galdros_roar', 'galdros_warn', 'galdros_swing', 'galdros_scrape', 'galdros_charge', 'galdros_rumble', 'galdros_step', 'rock_impact', 'part_sever', 'monster_topple',
  'hunt_clear', 'hunt_fail',
  // 大型 11 種（v0.17.0）。どれも合成音の仮素材
  'beast_cry', 'bird_screech', 'insect_buzz', 'hiss', 'gust', 'splash', 'bell_boom', 'zap', 'ice_crack', 'mist_pop', 'shell_clack', 'status_on',
  'item_drink', 'item_heal', 'item_fail', 'trap_set', 'trap_armed', 'trap_trigger', 'orb_throw', 'tranq_hit', 'capture', 'carve', 'carve_get',
  // 里の暮らし（v0.35.0）: 鍛冶の槌・水車のきしみ・灯見の台の遠い鐘
  'forge_clank', 'wheel_creak', 'bell_far',
] as const;

/** 里の音の大きさ（v0.35.0。0〜1）: 沢・炉・風。環境音の音量（設定の「環境音」）の中で、ゆっくり変える */
export interface AmbienceLevels {
  water: number;
  forge: number;
  wind: number;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private hubSoundtrack:HubSoundtrack|null=null;
  private hubMusicWant={active:false,watch:false};
  setHubMusic(active:boolean,watch=false):void{this.hubMusicWant={active,watch};this.hubSoundtrack?.set(active,watch);}
  playHubSample(id:HubSample,k=1):void{this.hubSoundtrack?.play(id,k);}
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private noise!: AudioBuffer;
  private settings: Settings;
  /** 里の音（v0.35.0）: 沢・炉・風の、大きさの節 */
  private amb: Record<keyof AmbienceLevels, GainNode> | null = null;
  private ambWant: AmbienceLevels = { water: 0, forge: 0, wind: 1 };

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** ユーザー操作のハンドラ内から呼ぶこと。 */
  async start(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.buses = { se: ctx.createGain(), bgm: ctx.createGain(), env: ctx.createGain() };
      for (const b of Object.values(this.buses)) b.connect(this.master);
      this.hubSoundtrack=new HubSoundtrack(ctx,this.buses.bgm,this.buses.env,this.buses.se);
      this.hubSoundtrack.set(this.hubMusicWant.active,this.hubMusicWant.watch);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let s = 22222;
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        data[i] = (s / 2147483648 - 1) * 0.9;
      }
      this.applySettings(this.settings);
      this.startWind();
      this.startAmbience();
    }
    await this.resume();
  }

  /** 沢（明るい雑音を、ゆっくり揺らす）と炉（低い雑音）の、鳴り続ける音。大きさは setAmbience で変える */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const loop = (lo: number, hi: number, wobble: number, rate: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.93;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = lo;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = hi;
      const shake = ctx.createGain();
      shake.gain.value = 1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = wobble;
      lfo.connect(depth).connect(shake.gain);
      const level = ctx.createGain();
      level.gain.value = 0;
      src.connect(hp).connect(lp).connect(shake).connect(level).connect(this.buses.env);
      src.start(0, Math.random());
      lfo.start();
      return level;
    };
    const water = loop(380, 2600, 0.25, 0.7);
    const forge = loop(40, 280, 0.35, 0.33);
    this.amb = { water, forge, wind: this.windLevel! };
    this.setAmbience(this.ambWant);
  }

  /** 里の音の大きさ（0〜1）。急に変わらないよう、0.4 秒ほどで近づける */
  setAmbience(a: AmbienceLevels): void {
    this.ambWant = { ...a };
    if (!this.ctx || !this.amb) return;
    const t = this.ctx.currentTime;
    this.amb.water.gain.setTargetAtTime(0.1 * Math.min(1, Math.max(0, a.water)), t, 0.4);
    this.amb.forge.gain.setTargetAtTime(0.09 * Math.min(1, Math.max(0, a.forge)), t, 0.4);
    this.amb.wind.gain.setTargetAtTime(Math.min(1.6, Math.max(0, a.wind)), t, 0.6);
  }

  private windLevel: GainNode | null = null;

  async resume(): Promise<boolean> {
    if (!this.ctx) return false;
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch {
      return false;
    }
    return this.ctx.state === 'running';
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    this.master.gain.value = s.mute ? 0 : s.volMaster;
    this.buses.se.gain.value = s.volSe;
    this.buses.bgm.gain.value = s.volBgm;
    this.buses.env.gain.value = s.volEnv;
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain).connect(g.gain);
    // 風の大きさ（v0.35.0。里の高い段ほど強い。setAmbience）
    this.windLevel = ctx.createGain();
    this.windLevel.gain.value = 1;
    src.connect(lp).connect(g).connect(this.windLevel).connect(this.buses.env);
    src.start();
    lfo.start();
  }

  private noiseBurst(dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses.se);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses.se);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** id は技データの events や simulation の出来事から渡される。未定義の id は鳴らさず false を返す。 */
  play(id: string, intensity = 1): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const k = Math.min(1.6, intensity);
    switch (id) {
      case 'hb_swing_01':
        this.noiseBurst(0.32, 'bandpass', 260, 1300, 0.5 * k, 0.9);
        break;
      case 'hb_swing_02':
        this.noiseBurst(0.3, 'bandpass', 380, 1500, 0.42 * k, 0.9);
        break;
      case 'hb_draw_01':
        this.noiseBurst(0.22, 'highpass', 2200, 5200, 0.16);
        this.tone('triangle', 1400, 2100, 0.2, 0.05, 0.04);
        break;
      case 'hb_sheathe_01':
        this.noiseBurst(0.12, 'lowpass', 900, 300, 0.3);
        this.tone('sine', 150, 90, 0.12, 0.25);
        break;
      case 'roll_01':
        this.noiseBurst(0.28, 'lowpass', 1200, 300, 0.22);
        break;
      case 'hit_rock':
        this.noiseBurst(0.14, 'bandpass', 1800, 500, 0.7 * k, 0.7);
        this.tone('sine', 150, 55, 0.2, 0.6 * k);
        break;
      case 'hit_shell':
        this.noiseBurst(0.1, 'highpass', 1500, 900, 0.4 * k);
        this.tone('triangle', 980, 620, 0.16, 0.22 * k);
        this.tone('sine', 170, 70, 0.18, 0.45 * k);
        break;
      case 'hit_hide':
        this.noiseBurst(0.16, 'lowpass', 900, 200, 0.75 * k);
        this.tone('sine', 120, 50, 0.22, 0.55 * k);
        break;
      case 'part_break':
        this.noiseBurst(0.5, 'bandpass', 2400, 300, 0.7, 0.6);
        this.tone('triangle', 520, 130, 0.4, 0.25);
        break;
      case 'guard':
        this.tone('square', 520, 480, 0.18, 0.12);
        this.tone('square', 790, 700, 0.22, 0.1);
        this.noiseBurst(0.1, 'highpass', 3000, 1500, 0.3);
        break;
      case 'guard_break':
        this.tone('square', 300, 140, 0.3, 0.16);
        this.tone('sine', 140, 50, 0.35, 0.6);
        this.noiseBurst(0.25, 'bandpass', 1500, 300, 0.5);
        break;
      case 'hurt':
        this.tone('sine', 210, 60, 0.3, 0.6);
        this.noiseBurst(0.2, 'lowpass', 1400, 200, 0.5);
        break;
      case 'evade':
        this.tone('sine', 880, 1500, 0.12, 0.08);
        break;
      case 'charge_1':
      case 'charge_2':
      case 'charge_3': {
        const n = Number(id.slice(-1));
        this.tone('triangle', 420 * n, 620 * n, 0.16, 0.14);
        break;
      }
      case 'dummy_warn_01':
        this.tone('sawtooth', 74, 58, 0.6, 0.22);
        this.tone('sawtooth', 111, 86, 0.6, 0.12);
        break;
      case 'dummy_swing_01':
        this.noiseBurst(0.35, 'bandpass', 140, 600, 0.6, 0.8);
        break;
      case 'ground_slam':
        this.tone('sine', 110, 32, 0.5, 1.0);
        this.noiseBurst(0.45, 'lowpass', 700, 90, 0.9);
        break;
      case 'monster_dead':
        this.tone('sawtooth', 120, 40, 0.9, 0.25);
        this.noiseBurst(0.7, 'lowpass', 600, 80, 0.6, 1, 0.3);
        break;
      case 'galdros_roar':
        this.tone('sawtooth', 96, 52, 1.1, 0.34);
        this.tone('sawtooth', 143, 70, 1.0, 0.2);
        this.noiseBurst(1.0, 'bandpass', 420, 160, 0.5, 1.4);
        break;
      case 'galdros_warn':
        this.tone('sawtooth', 62, 50, 0.55, 0.24);
        this.noiseBurst(0.4, 'lowpass', 300, 120, 0.3);
        break;
      case 'galdros_swing':
        this.noiseBurst(0.4, 'bandpass', 120, 520, 0.7, 0.8);
        break;
      case 'galdros_scrape':
        this.noiseBurst(0.3, 'bandpass', 900, 300, 0.35, 1.2);
        break;
      case 'galdros_charge':
        this.tone('sawtooth', 70, 110, 0.5, 0.25);
        this.noiseBurst(1.2, 'lowpass', 500, 160, 0.7);
        break;
      case 'galdros_rumble':
        this.tone('sine', 48, 40, 0.9, 0.6);
        this.noiseBurst(0.9, 'lowpass', 260, 90, 0.5);
        break;
      case 'galdros_step':
        // 重い足音: 低い鈍い音と、砂利を踏む短い雑音
        this.tone('sine', 74, 38, 0.16, 0.5 * k);
        this.noiseBurst(0.12, 'lowpass', 420, 120, 0.3 * k);
        break;
      case 'rock_impact':
        this.tone('sine', 120, 36, 0.4, 0.8 * k);
        this.noiseBurst(0.35, 'bandpass', 1400, 200, 0.7 * k, 0.6);
        break;
      case 'part_sever':
        this.noiseBurst(0.3, 'highpass', 1800, 700, 0.5);
        this.tone('triangle', 700, 180, 0.5, 0.3);
        this.tone('sine', 140, 50, 0.4, 0.6);
        break;
      case 'monster_topple':
        this.tone('sine', 90, 30, 0.6, 0.9);
        this.noiseBurst(0.6, 'lowpass', 500, 90, 0.8);
        break;
      // ---- 大型 11 種（v0.17.0。合成音の仮素材）----
      case 'beast_cry':
        this.tone('sawtooth', 240, 150, 0.8, 0.22);
        this.tone('sawtooth', 330, 210, 0.7, 0.12);
        this.noiseBurst(0.7, 'bandpass', 900, 300, 0.35, 1.2);
        break;
      case 'bird_screech':
        this.tone('sawtooth', 980, 640, 0.55, 0.14);
        this.tone('square', 1460, 900, 0.4, 0.05);
        this.noiseBurst(0.5, 'highpass', 2600, 1200, 0.25);
        break;
      case 'insect_buzz':
        this.tone('sawtooth', 150, 132, 0.9, 0.18);
        this.tone('square', 302, 270, 0.9, 0.06);
        this.noiseBurst(0.8, 'bandpass', 900, 500, 0.25, 2);
        break;
      case 'hiss':
        this.noiseBurst(0.75, 'highpass', 3400, 2000, 0.4, 0.8);
        this.tone('sawtooth', 90, 70, 0.6, 0.12);
        break;
      case 'gust':
        this.noiseBurst(0.7, 'bandpass', 300, 1400, 0.6, 0.6);
        break;
      case 'splash':
        this.noiseBurst(0.45, 'lowpass', 1100, 220, 0.6 * k);
        this.tone('sine', 220, 80, 0.3, 0.35 * k);
        break;
      case 'bell_boom':
        this.tone('sine', 82, 58, 1.2, 0.55);
        this.tone('triangle', 164, 120, 1.0, 0.18);
        this.tone('sine', 246, 230, 0.9, 0.08);
        break;
      case 'zap':
        this.tone('square', 1400, 180, 0.22, 0.12);
        this.noiseBurst(0.25, 'highpass', 3000, 1800, 0.45);
        break;
      case 'ice_crack':
        this.noiseBurst(0.3, 'highpass', 4200, 2600, 0.45, 0.6);
        this.tone('triangle', 1700, 800, 0.25, 0.12);
        break;
      case 'mist_pop':
        this.tone('sine', 320, 120, 0.4, 0.3);
        this.noiseBurst(0.35, 'bandpass', 700, 400, 0.3);
        break;
      case 'shell_clack':
        this.noiseBurst(0.12, 'bandpass', 2600, 800, 0.55, 0.5);
        this.tone('square', 640, 420, 0.1, 0.1);
        break;
      case 'status_on':
        this.tone('triangle', 620, 300, 0.4, 0.14);
        this.tone('triangle', 465, 220, 0.5, 0.1, 0.12);
        break;
      case 'hunt_clear':
        this.tone('triangle', 523, 523, 0.18, 0.16);
        this.tone('triangle', 659, 659, 0.18, 0.16, 0.16);
        this.tone('triangle', 784, 784, 0.5, 0.18, 0.32);
        break;
      case 'hunt_fail':
        this.tone('triangle', 392, 370, 0.3, 0.14);
        this.tone('triangle', 294, 262, 0.7, 0.16, 0.28);
        break;
      case 'no_stamina':
        this.tone('square', 180, 150, 0.09, 0.08);
        break;
      // ---- 道具・捕獲・剥ぎ取り（M2 後半。すべて合成音の仮素材）----
      case 'item_drink':
        this.tone('sine', 420, 300, 0.09, 0.12);
        this.tone('sine', 380, 270, 0.09, 0.12, 0.16);
        break;
      case 'item_heal':
        this.tone('triangle', 660, 880, 0.22, 0.14);
        this.tone('triangle', 990, 1320, 0.3, 0.1, 0.12);
        break;
      case 'item_fail':
        this.tone('square', 200, 160, 0.08, 0.07);
        break;
      case 'trap_set':
        this.noiseBurst(0.12, 'bandpass', 1200, 400, 0.35);
        this.tone('square', 240, 200, 0.08, 0.1, 0.08);
        break;
      case 'trap_armed':
        this.tone('triangle', 880, 1100, 0.1, 0.12);
        break;
      case 'trap_trigger':
        this.noiseBurst(0.35, 'bandpass', 2600, 500, 0.6, 0.5);
        this.tone('sawtooth', 300, 90, 0.35, 0.18);
        break;
      case 'orb_throw':
        this.noiseBurst(0.14, 'highpass', 900, 2600, 0.25);
        break;
      case 'tranq_hit':
        this.noiseBurst(0.3, 'lowpass', 1400, 300, 0.4);
        this.tone('sine', 520, 260, 0.4, 0.12);
        break;
      case 'capture':
        this.tone('triangle', 392, 392, 0.2, 0.15);
        this.tone('triangle', 523, 523, 0.2, 0.15, 0.18);
        this.tone('triangle', 659, 784, 0.6, 0.17, 0.36);
        break;
      case 'carve':
        this.noiseBurst(0.16, 'bandpass', 1900, 600, 0.4);
        break;
      case 'carve_get':
        this.tone('triangle', 784, 1047, 0.16, 0.13);
        break;
      case 'ui':
        this.tone('triangle', 660, 880, 0.07, 0.1);
        break;
      // ---- 里の暮らし（v0.35.0。合成音の仮素材）----
      case 'forge_clank':
        this.tone('triangle', 1760, 1690, 0.16, 0.11 * k);
        this.tone('sine', 3520, 3400, 0.28, 0.035 * k);
        this.noiseBurst(0.05, 'highpass', 3000, 5000, 0.18 * k);
        break;
      case 'wheel_creak':
        this.noiseBurst(0.38, 'bandpass', 520, 380, 0.14 * k, 7);
        this.tone('sawtooth', 150, 128, 0.3, 0.018 * k, 0.05);
        break;
      case 'bell_far':
        this.tone('sine', 587, 585, 2.6, 0.07 * k);
        this.tone('sine', 1180, 1176, 1.6, 0.025 * k);
        this.tone('sine', 1460, 1455, 1.0, 0.012 * k);
        break;
      default:
        return false;
    }
    return true;
  }
}
