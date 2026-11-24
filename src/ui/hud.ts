// HUD。3D は Canvas、文字と数値は HTML で描く。値が変わった時だけ DOM を触る。
// 敵の HP は通常は表示せず、検証表示を入れた時だけ出す。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import type { FrameSummary } from '../core/frameMeter';
import type { FacilityDef } from '../data/schemas';
import { phaseAt } from '../game/action';
import { edgeStage } from '../game/combat';
import { areaLabel, areaOf } from '../game/field';
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
  /** 描画の間隔の集計（直近の約 15 秒） */
  frames: FrameSummary;
}

const AILMENT_NAMES: Record<string, string> = { poison: '毒', para: '麻痺', sleep: '睡眠', stun: '気絶' };

export class Hud {
  readonly root: HTMLElement;
  private hp: HTMLElement;
  private hpLag: HTMLElement;
  private st: HTMLElement;
  private stBar: HTMLElement;
  private pips: HTMLElement[] = [];
  private edgeBox!: HTMLElement;
  private edgeLabel!: HTMLElement;
  private edgeFill!: HTMLElement;
  private edgeStageEl!: HTMLElement;
  private time: HTMLElement;
  private goal: HTMLElement;
  private faints: HTMLElement;
  /** フィールド: いま居るエリアと標的の居るエリア（文字）、小さな地図、出口の案内、エリアを移った時の名前 */
  private where: HTMLElement;
  private map: HTMLElement;
  private mapCells = new Map<string, HTMLElement>();
  private exitHint: HTMLElement;
  private banner: HTMLElement;
  /** 里: 前に立っている施設へ入るボタンと、施設の一覧を開くボタン */
  private facilityBtn: HTMLButtonElement;
  private facilityName: HTMLElement;
  private facilitySub: HTMLElement;
  private listBtn: HTMLButtonElement;
  private inHub = false;
  private enemy: HTMLElement;
  private enemyBar: HTMLElement;
  private enemyParts: HTMLElement;
  private verifyBox: HTMLElement;
  private verifyBtn: HTMLButtonElement;
  private toasts: HTMLElement;
  /** ロックオンの照準（v0.16.0） */
  private lockMark: HTMLElement;
  private ailments: HTMLElement;
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
    // 状態異常（v0.17.0）: 付いている間だけ、名前の札を出す
    this.ailments = el('div', 'hud-ailments', bars);
    this.ailments.id = 'hud-ailments';
    const blade = el('div', 'hud-blade', bars);
    // 刃の状態: 名前（刃 / 打面 / 穂先）、残りの棒、段階の名前。刃の状態の無い武器（環弓）では棒を隠す
    this.edgeBox = el('div', 'edge', blade);
    this.edgeLabel = el('span', '', this.edgeBox, '刃');
    this.edgeFill = el('i', '', el('div', 'gauge', this.edgeBox));
    this.edgeStageEl = el('span', 'stage', this.edgeBox, '');
    const charge = el('div', 'charge', blade);
    for (let i = 0; i < 3; i++) this.pips.push(el('b', '', charge));

    const tr = el('div', 'hud-top-right', this.root);
    const quest = el('div', 'hud-quest', tr);
    this.time = el('div', 'time', quest, '00:00');
    this.goal = el('div', 'goal', quest, '');
    this.faints = el('div', 'goal', quest, '');
    this.where = el('div', 'goal where', quest, '');
    this.map = el('div', 'hud-map', quest);
    this.map.hidden = true;
    this.verifyBtn = el('button', 'hud-btn', tr, '検証');
    this.verifyBtn.addEventListener('click', () => hub.ui('verify'));
    const menuBtn = el('button', 'hud-btn', tr, '☰');
    menuBtn.setAttribute('aria-label', 'メニュー');
    menuBtn.addEventListener('click', () => hub.ui('menu'));
    // 里: 施設の一覧（検証・メニューの後ろに置く。ボタンの並びの番号を変えないため）
    this.listBtn = el('button', 'hud-btn', tr, '一覧');
    this.listBtn.id = 'hud-hub-list';
    this.listBtn.hidden = true;
    this.listBtn.addEventListener('click', () => hub.ui('hubList'));

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
    this.exitHint = el('div', 'hud-exit', this.root);
    this.exitHint.hidden = true;
    this.lockMark = el('div', 'hud-lock', this.root);
    this.lockMark.id = 'hud-lock';
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', c, this.lockMark);
    this.lockMark.hidden = true;
    this.facilityBtn = el('button', 'hud-facility', this.root);
    this.facilityBtn.id = 'hud-facility';
    this.facilityBtn.hidden = true;
    this.facilityName = el('b', '', this.facilityBtn);
    this.facilitySub = el('span', '', this.facilityBtn);
    this.facilityBtn.addEventListener('click', () => hub.ui('interact'));
    this.banner = el('div', 'hud-area-banner', this.root);
    this.banner.hidden = true;
    this.dmgLayer = el('div', '', this.root);
    this.setVerify(false);
  }

  setVerify(on: boolean): void {
    this.verify = on;
    this.verifyBtn.classList.toggle('on', on);
    this.enemy.hidden = !on;
    this.verifyBox.hidden = !on;
  }

  /** ロックオンの照準を、画面のこの位置（CSS px）へ出す。null なら隠す。 */
  setLock(p: { x: number; y: number } | null): void {
    if (!p) {
      if (!this.lockMark.hidden) this.lockMark.hidden = true;
      return;
    }
    this.lockMark.hidden = false;
    this.lockMark.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  toast(text: string): void {
    const t = el('div', 'toast', this.toasts, text);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.remove(), 1700);
  }

  /** 里: 前に立っている施設（無ければ null）と、里に居るかどうか。施設があれば、入るボタンを出す。 */
  setFacility(f: FacilityDef | null, inHub: boolean): void {
    this.inHub = inHub;
    this.set('hublist', inHub ? 1 : 0, () => (this.listBtn.hidden = !inHub));
    this.set('facility', f ? f.id : '', () => {
      this.facilityBtn.hidden = !f;
      if (f) {
        this.facilityName.textContent = f.action;
        this.facilitySub.textContent = f.summary;
      }
    });
  }

  /** フィールドの小さな地図を作り直す（マス目に、エリアの番号と、つながりの線）。 */
  private buildMap(sim: Simulation): void {
    this.map.textContent = '';
    this.mapCells.clear();
    const field = sim.field;
    this.map.hidden = !field;
    if (!field) return;
    const CW = 27, CH = 19, BW = 20, BH = 14;
    const cols = Math.max(...field.areas.map((a) => a.grid[0])) + 1;
    const rows = Math.max(...field.areas.map((a) => a.grid[1])) + 1;
    this.map.style.width = `${(cols - 1) * CW + BW}px`;
    this.map.style.height = `${(rows - 1) * CH + BH}px`;
    const at = (g: [number, number]): { x: number; y: number } => ({ x: g[0] * CW, y: (rows - 1 - g[1]) * CH });
    for (const a of field.areas) {
      const p = at(a.grid);
      for (const e of a.exits) {
        const to = areaOf(field, e.to);
        if (!to || to.id < a.id) continue;
        const q = at(to.grid);
        const line = el('i', e.large ? 'link' : 'link thin', this.map);
        const x0 = Math.min(p.x, q.x) + BW / 2, y0 = Math.min(p.y, q.y) + BH / 2;
        line.style.left = `${x0}px`;
        line.style.top = `${y0}px`;
        line.style.width = `${Math.max(1, Math.abs(p.x - q.x))}px`;
        line.style.height = `${Math.max(1, Math.abs(p.y - q.y))}px`;
      }
    }
    for (const a of field.areas) {
      const p = at(a.grid);
      const cell = el('b', `cell ${a.kind}`, this.map, a.kind === 'camp' ? '営' : String(a.no));
      cell.style.left = `${p.x}px`;
      cell.style.top = `${p.y}px`;
      this.mapCells.set(a.id, cell);
    }
  }

  /** エリアを移った時: 画面を一瞬暗くして、エリアの番号と名前を出す。 */
  private showArea(sim: Simulation): void {
    const a = sim.area();
    if (!a) return;
    this.banner.textContent = '';
    el('span', '', this.banner, a.kind === 'camp' ? sim.field!.name : areaLabel(a));
    el('b', '', this.banner, a.name);
    this.banner.hidden = false;
    // 同じ動きを、もう一度最初から
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
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
          if (e.bounced) this.toast('弾かれた');
          break;
        case 'edge': {
          // 刃の状態の段階が下がった時だけ知らせる（研いで戻った時は「研ぎ上がった」が出る）
          const stages = sim.content.edge.stages;
          const i = stages.findIndex((s) => s.id === e.stage);
          const label = familyOf(sim.player, sim.content).edge?.label ?? '刃';
          if (i === stages.length - 1 && i > 0) this.toast(`${label}が鈍った: 弾かれやすい（研磨石で戻せる）`);
          else if (i > 0) this.toast(`${label}が鈍ってきた`);
          break;
        }
        case 'part_break': {
          const name = sim.monsters[0]?.def.parts[e.partIndex]?.name ?? e.partId;
          this.toast(`部位破壊: ${name}`);
          break;
        }
        case 'monster_dead':
          this.toast(sim.hunt ? '討伐した' : '標的を倒した（しばらくすると復帰）');
          break;
        case 'area_change':
          this.showArea(sim);
          break;
        case 'monster_leave':
          // 目の前で歩き出した時だけ知らせる
          if (e.from === sim.areaId) this.toast('標的が移動を始めた');
          break;
        case 'monster_move': {
          const a = sim.field && areaOf(sim.field, e.areaId);
          if (a) this.toast(e.areaId === sim.areaId ? '標的が現れた' : `標的が${areaLabel(a)}へ移った`);
          break;
        }
        case 'monster_sleep':
          this.toast('標的が巣で眠った');
          break;
        case 'monster_wake':
          if (e.byHit) this.toast('標的が目を覚ました');
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
          else if (e.kind === 'whet') this.toast(`${name}: 研ぎ上がった`);
          else if (e.kind === 'trap') this.toast(e.ok ? `${name}を仕掛けた` : `${name}は置けなかった`);
          else this.toast(e.ok ? `${name}が当たった（${e.amount} 個目）` : `${name}は外れた`);
          break;
        }
        case 'item_fail':
          this.toast(e.reason === 'empty' ? '道具が残っていない' : e.reason === 'no_need' ? 'まだ研がなくてよい' : 'いまは使えない');
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
    const disabled = p.mode === 'hurt' && p.hurt && (p.hurt.kind === 'para' || p.hurt.kind === 'sleep' || p.hurt.kind === 'stun') ? p.hurt.kind : '';
    const tags = [p.ailment.poisonTicks > 0 ? 'poison' : '', disabled].filter(Boolean).join(' ');
    this.set('ailments', tags, () => {
      this.ailments.textContent = '';
      for (const k of tags ? tags.split(' ') : []) {
        const b = el('b', `ail ail-${k}`, this.ailments, AILMENT_NAMES[k] ?? k);
        b.dataset.kind = k;
      }
    });
    const lv = p.action?.chargeLevel ?? 0;
    this.set('charge', lv, () => this.pips.forEach((b, i) => b.classList.toggle('on', i < lv)));
    // 刃の状態
    const famEdge = familyOf(p, sim.content).edge;
    const E = sim.content.edge;
    this.set('edgeon', famEdge ? famEdge.label : '', () => {
      this.edgeBox.hidden = !famEdge;
      if (famEdge) this.edgeLabel.textContent = famEdge.label;
    });
    if (famEdge) {
      const stage = edgeStage(E, p.edge);
      const fill = p.edge / E.max;
      this.set('edge', Math.round(fill * 200), () => (this.edgeFill.style.transform = `scaleX(${fill})`));
      this.set('edgestage', stage.id, () => {
        this.edgeBox.dataset.stage = stage.id;
        this.edgeStageEl.textContent = stage.name;
      });
    }
    // 依頼中は残り時間、訓練は経過時間
    const h = sim.hunt;
    const sec = h ? Math.ceil(Math.max(0, h.timeLimitTicks - h.ticks) / 60) : this.inHub ? -1 : Math.floor(sim.tick / 60);
    this.set('time', sec, () => (this.time.textContent = sec < 0 ? '' : `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`));
    const goal = this.inHub ? sim.content.hub.name : h ? `【${sim.rank?.name ?? ''}】${h.quest.name}: ${sim.monsters[0]?.def.name ?? ''}の${h.quest.kind === 'hunt' ? '狩猟' : '討伐'}` : '訓練: 標的で動作を確かめる';
    this.set('goal', goal, () => (this.goal.textContent = goal));
    const faints = h ? `力尽き ${h.faints} / ${h.quest.maxFaints}` : '';
    this.set('faints', faints, () => (this.faints.textContent = faints));
    // フィールド: いま居るエリア、標的の居るエリア、地図、近くの出口
    const field = sim.field;
    this.set('field', field ? field.id : '', () => this.buildMap(sim));
    const here = sim.area();
    const tm = sim.monsters[0];
    const ta = tm ? sim.monsterArea(tm) : null;
    const tState = !tm || tm.dead ? 'dead' : tm.asleep ? 'sleep' : tm.roam?.state === 'leave' ? 'leave' : '';
    const where = field && here ? `${areaLabel(here)}${here.kind === 'camp' ? '' : ` ${here.name}`}${ta && tState !== 'dead' ? `　標的: ${areaLabel(ta)}${tState === 'sleep' ? '（眠り）' : tState === 'leave' ? '（移動中）' : ''}` : ''}` : '';
    this.set('where', where, () => {
      this.where.textContent = where;
      this.where.hidden = where === '';
    });
    this.set('mapmark', field ? `${sim.areaId}|${ta && tState !== 'dead' ? ta.id : ''}|${tState}` : '', () => {
      for (const [id, cell] of this.mapCells) {
        cell.classList.toggle('here', id === sim.areaId);
        cell.classList.toggle('target', !!ta && tState !== 'dead' && id === ta.id);
        cell.classList.toggle('asleep', !!ta && id === ta.id && tState === 'sleep');
      }
    });
    let exitText = '';
    if (field && here && p.mode !== 'dead') {
      // 近くて、そちらを向いている出口だけ（着いた直後に、背中側の出口を案内しない）
      let best = 10;
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      for (const e of here.exits) {
        const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
        const to = areaOf(field, e.to);
        if (d < best && to && (d < 0.5 || ((e.x - p.pos.x) * fx + (e.z - p.pos.z) * fz) / d > 0.3)) {
          best = d;
          exitText = `この先: ${areaLabel(to)}${to.kind === 'camp' ? '' : `（${to.name}）`}`;
        }
      }
    }
    this.set('exit', exitText, () => {
      this.exitHint.textContent = exitText;
      this.exitHint.hidden = exitText === '';
    });
    // 道具
    const stack = p.items[p.itemIndex];
    const itemText = stack ? `${sim.content.items.get(stack.itemId)?.name ?? ''} ×${stack.count}` : '';
    this.set('item', itemText, () => {
      this.item.textContent = itemText;
      this.item.hidden = itemText === '';
      // 勢い（双剣）: 段階を印で出す
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
      `間隔 平均 ${stats.frames.avgMs.toFixed(1)}ms  p95 ${stats.frames.p95Ms.toFixed(1)}ms  最大 ${stats.frames.maxMs.toFixed(0)}ms  100ms超 ${stats.frames.longFrames}回`,
      `player ${p.mode}${p.drawn ? ' 抜刀' : ' 納刀'}  HP ${p.hp}  ST ${p.stamina.toFixed(1)}  刃 ${p.edge.toFixed(1)}（${edgeStage(sim.content.edge, p.edge).name}）${isInvulnerable(p) ? '  無敵' : ''}`,
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
