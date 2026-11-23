// HUD。3D は Canvas、文字と数値は HTML で描く。値が変わった時だけ DOM を触る。
// 敵の HP は通常は表示せず、検証表示を入れた時だけ出す。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import { phaseAt } from '../game/action';
import type { SimEvent } from '../game/events';
import { familyOf, isInvulnerable } from '../game/player';
import type { Simulation } from '../game/sim';
import type { InputHub } from '../input/hub';
import type { GameView } from '../render/view';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export interface FrameStats {
  fps: number;
  droppedTicks: number;
}

export class Hud {
  readonly root: HTMLElement;
  private hp: HTMLElement;
  private hpLag: HTMLElement;
  private st: HTMLElement;
  private stBar: HTMLElement;
  private pips: HTMLElement[] = [];
  private time: HTMLElement;
  private goal: HTMLElement;
  private faints: HTMLElement;
  private enemy: HTMLElement;
  private enemyBar: HTMLElement;
  private enemyParts: HTMLElement;
  private verifyBox: HTMLElement;
  private verifyBtn: HTMLButtonElement;
  private toasts: HTMLElement;
  private item: HTMLElement;
  private momentum: HTMLElement;
  private wrap: HTMLElement;
  private wrapText: HTMLElement;
  private dmgLayer: HTMLElement;
  private last: Record<string, string | number> = {};
  private lagHp = 1;
  verify = false;

  constructor(parent: HTMLElement, hub: InputHub) {
    this.root = el('div', '', parent);
    this.root.id = 'hud';
    const bars = el('div', 'hud-bars', this.root);
    const hpBar = el('div', 'bar bar-hp', bars);
    this.hpLag = el('i', 'lag', hpBar);
    this.hp = el('i', '', hpBar);
    this.stBar = el('div', 'bar bar-st', bars);
    this.st = el('i', '', this.stBar);
    const blade = el('div', 'hud-blade', bars);
    el('span', '', blade, '刃');
    el('i', '', el('div', 'gauge', blade));
    const charge = el('div', 'charge', blade);
    for (let i = 0; i < 3; i++) this.pips.push(el('b', '', charge));

    const tr = el('div', 'hud-top-right', this.root);
    const quest = el('div', 'hud-quest', tr);
    this.time = el('div', 'time', quest, '00:00');
    this.goal = el('div', 'goal', quest, '');
    this.faints = el('div', 'goal', quest, '');
    this.verifyBtn = el('button', 'hud-btn', tr, '検証');
    this.verifyBtn.addEventListener('click', () => hub.ui('verify'));
    const menuBtn = el('button', 'hud-btn', tr, '☰');
    menuBtn.setAttribute('aria-label', 'メニュー');
    menuBtn.addEventListener('click', () => hub.ui('menu'));

    this.enemy = el('div', 'enemy-hp', this.root);
    this.enemyBar = el('i', '', el('div', 'bar', this.enemy));
    this.enemyParts = el('div', 'parts', this.enemy);
    this.verifyBox = el('div', '', this.root);
    this.verifyBox.id = 'verify';
    this.toasts = el('div', '', this.root);
    this.toasts.id = 'toasts';
    // 選んでいる道具と、達成後の案内（剥ぎ取りの残りと帰還）
    this.item = el('div', 'hud-item', this.root);
    this.momentum = el('div', 'hud-momentum', this.root);
    this.momentum.hidden = true;
    this.wrap = el('div', 'hud-wrap', this.root);
    this.wrap.hidden = true;
    this.wrapText = el('span', '', this.wrap);
    const back = el('button', '', this.wrap, '帰還する');
    back.id = 'hud-return';
    back.addEventListener('click', () => hub.ui('return'));
    this.dmgLayer = el('div', '', this.root);
    this.setVerify(false);
  }

  setVerify(on: boolean): void {
    this.verify = on;
    this.verifyBtn.classList.toggle('on', on);
    this.enemy.hidden = !on;
    this.verifyBox.hidden = !on;
  }

  toast(text: string): void {
    const t = el('div', 'toast', this.toasts, text);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), 1700);
  }

  private set(key: string, value: string | number, apply: () => void): void {
    if (this.last[key] !== value) {
      this.last[key] = value;
      apply();
    }
  }

  onEvents(events: readonly SimEvent[], sim: Simulation, view: GameView): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (this.verify) {
            const s = view.project(e.pos);
            if (s.visible) {
              const part = sim.monsters[0]?.def.parts[e.partIndex];
              const d = el('div', part && part.hitzone.cut >= 0.6 ? 'dmg weak' : 'dmg', this.dmgLayer, String(e.damage));
              d.style.left = `${s.x}px`;
              d.style.top = `${s.y}px`;
              setTimeout(() => d.remove(), 820);
            }
          }
          break;
        case 'part_break': {
          const name = sim.monsters[0]?.def.parts[e.partIndex]?.name ?? e.partId;
          this.toast(`部位破壊: ${name}`);
          break;
        }
        case 'monster_dead':
          this.toast(sim.hunt ? '討伐した' : '標的を倒した（しばらくすると復帰）');
          break;
        case 'part_sever':
          this.toast('尾を切断');
          break;
        case 'monster_stagger':
          if (e.kind === 'topple') this.toast('転倒');
          break;
        case 'monster_aware':
          this.toast('気付かれた');
          break;
        case 'monster_rage':
          this.toast(e.on ? '怒り状態' : '怒りが収まった');
          break;
        case 'evade':
          this.toast('回避');
          break;
        case 'parry':
          this.toast(e.kind === 'counter' ? '受け返し' : '受け流し');
          break;
        case 'guard':
          this.toast('防御');
          break;
        case 'guard_break':
          this.toast('防御崩れ');
          break;
        case 'player_dead':
          this.toast('力尽きた… キャンプへ戻る');
          break;
        case 'stamina_empty':
          this.toast('スタミナ不足');
          break;
        case 'item_effect': {
          const name = sim.content.items.get(e.itemId)?.name ?? '';
          if (e.kind === 'heal') this.toast(`${name}: 体力 +${e.amount}`);
          else if (e.kind === 'trap') this.toast(e.ok ? `${name}を仕掛けた` : `${name}は置けなかった`);
          else this.toast(e.ok ? `${name}が当たった（${e.amount} 個目）` : `${name}は外れた`);
          break;
        }
        case 'item_fail':
          this.toast(e.reason === 'empty' ? '道具が残っていない' : 'いまは使えない');
          break;
        case 'trap_trigger':
          this.toast('罠にかかった！');
          break;
        case 'trap_end':
          this.toast('罠が消えた');
          break;
        case 'monster_captured':
          this.toast('捕獲した');
          break;
        case 'carve':
          this.toast(`${sim.content.materials.get(e.itemId)?.name ?? e.itemId} を手に入れた`);
          break;
        default:
          break;
      }
    }
  }

  update(sim: Simulation, view: GameView, stats: FrameStats, dt: number): void {
    const p = sim.player;
    const T = sim.content.player;
    const hp = p.hp / T.maxHp;
    this.lagHp = hp > this.lagHp ? hp : this.lagHp + (hp - this.lagHp) * Math.min(1, dt * 2.5);
    this.set('hp', Math.round(hp * 200), () => (this.hp.style.transform = `scaleX(${hp})`));
    this.set('lag', Math.round(this.lagHp * 200), () => (this.hpLag.style.transform = `scaleX(${this.lagHp})`));
    const st = p.stamina / T.maxStamina;
    this.set('st', Math.round(st * 200), () => (this.st.style.transform = `scaleX(${st})`));
    this.set('stlow', p.exhausted || p.stamina < 25 ? 1 : 0, () => this.stBar.classList.toggle('low', p.exhausted || p.stamina < 25));
    const lv = p.action?.chargeLevel ?? 0;
    this.set('charge', lv, () => this.pips.forEach((b, i) => b.classList.toggle('on', i < lv)));
    // 依頼中は残り時間、訓練は経過時間
    const h = sim.hunt;
    const sec = h ? Math.ceil(Math.max(0, h.quest.timeLimitTicks - h.ticks) / 60) : Math.floor(sim.tick / 60);
    this.set('time', sec, () => (this.time.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`));
    const goal = h ? `${h.quest.name}: ${sim.monsters[0]?.def.name ?? ''}の${h.quest.kind === 'hunt' ? '狩猟' : '討伐'}` : '訓練: 標的で動作を確かめる';
    this.set('goal', goal, () => (this.goal.textContent = goal));
    const faints = h ? `力尽き ${h.faints} / ${h.quest.maxFaints}` : '';
    this.set('faints', faints, () => (this.faints.textContent = faints));
    // 道具
    const stack = p.items[p.itemIndex];
    const itemText = stack ? `${sim.content.items.get(stack.itemId)?.name ?? ''} ×${stack.count}` : '';
    this.set('item', itemText, () => {
      this.item.textContent = itemText;
      this.item.hidden = itemText === '';
      // 勢い（旋鎌）: 段階を印で出す
      const M = familyOf(sim.player, sim.content).momentum;
      this.momentum.hidden = !M || !sim.player.drawn;
      if (M) this.momentum.textContent = `勢い ${'●'.repeat(sim.player.momentum)}${'○'.repeat(M.max - sim.player.momentum)}`;
    });
    // 達成後: 剥ぎ取りの残りと、帰還までの時間
    let wrap = '';
    if (h && h.phase === 'success' && !h.closed) {
      const left = Object.values(h.carves).reduce((a, b) => a + b, 0);
      const s2 = Math.ceil(h.returnTicks / 60);
      const head = h.reason === 'capture' ? '捕獲成功' : left > 0 ? `剥ぎ取り 残り ${left} 回${sim.carveTarget() ? '（攻撃ボタン）' : '（近づく）'}` : '剥ぎ取り完了';
      wrap = `${head}　帰還まで ${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, '0')}`;
    }
    this.set('wrap', wrap, () => {
      this.wrapText.textContent = wrap;
      this.wrap.hidden = wrap === '';
    });

    if (!this.verify) return;
    const m = sim.monsters[0];
    if (m) {
      const r = m.hp / m.def.hp;
      this.set('ehp', Math.round(r * 300), () => (this.enemyBar.style.transform = `scaleX(${r})`));
      const parts = m.def.parts
        .map((d, i) => {
          const st = m.parts[i]!;
          if (d.sever) return `${d.name} ${st.severed ? '切断' : `${Math.floor(st.severAcc)}/${d.sever.threshold}`}`;
          return d.breakDurability === null ? null : `${d.name} ${st.broken ? '破壊' : `${Math.ceil(st.durability)}/${d.breakDurability}`}`;
        })
        .filter(Boolean)
        .join('　');
      const text = `${m.def.name}  HP ${m.hp}/${m.def.hp}　${parts}`;
      this.set('eparts', text, () => (this.enemyParts.textContent = text));
    }
    const a = p.action;
    const info = view.stats();
    const lines = [
      `v${APP_VERSION} build ${BUILD_ID}  seed ${sim.options.seed}  tick ${sim.tick}`,
      `描画 ${stats.fps.toFixed(0)}fps / 計算 60Hz  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(1)}k  捨てtick ${stats.droppedTicks}`,
      `player ${p.mode}${p.drawn ? ' 抜刀' : ' 納刀'}  HP ${p.hp}  ST ${p.stamina.toFixed(1)}${isInvulnerable(p) ? '  無敵' : ''}`,
      a
        ? `  ${a.def.actionId}\n  tick ${a.tick}/${a.def.durationTicks} ${phaseAt(a.def, Math.min(a.tick, a.def.durationTicks - 1))?.id ?? ''}  hitstop ${a.hitstop}  溜め ${a.chargeTicks}(Lv${a.chargeLevel})`
        : p.guard
          ? `  guard ${p.guard.phase} ${p.guard.tick}`
          : p.hurt
            ? `  ${p.hurt.kind} ${p.hurt.tick}/${p.hurt.duration}`
            : '  -',
      `  先行入力 主${p.buffer.main} 副${p.buffer.sub} 避${p.buffer.dodge} 武${p.buffer.weapon} 道${p.buffer.item}`,
    ];
    if (m) {
      const ma = m.action;
      lines.push(`${m.aware ? '' : '未発見 '}${m.enraged ? `怒り ${m.enragedTicks} ` : ''}標的 ${m.dead ? '死亡' : m.staggerTicks > 0 ? `${m.staggerKind} ${m.staggerTicks}` : ma ? `${ma.def.actionId.split('.').pop()} t${ma.tick} ${phaseAt(ma.def, Math.min(ma.tick, ma.def.durationTicks - 1))?.id ?? ''}` : `待機 cd${m.cooldown}`}`);
    }
    for (const h of sim.recentHits.slice(-3)) lines.push(`命中 tick${h.tick} ${h.actionId.split('.').pop()}/${h.windowId} t${h.actionTick} ${h.partId} ${h.damage}`);
    lines.push(`累計 与ダメ ${sim.totalDamage} (${sim.hitCount}回)  被ダメ ${sim.damageTaken}`);
    if (h) lines.push(`依頼 ${h.phase}${h.reason ? `(${h.reason})` : ''} tick ${h.ticks}  落下物 ${sim.hazards.length}  罠 ${sim.traps.map((t) => t.state).join(',') || '-'}${m ? `  拘束 ${m.trapTicks} 鎮静 ${m.tranq}` : ''}`);
    if (view.missingClips.size > 0) lines.push(`欠落clip: ${[...view.missingClips].join(', ')}`);
    const text = lines.join('\n');
    this.set('verify', text, () => (this.verifyBox.textContent = text));
  }
}
