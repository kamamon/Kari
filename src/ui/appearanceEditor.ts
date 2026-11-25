// 見た目を変える画面（v0.28.0。ChatGPT のキャラメイク設計 #10、docs/spec.md の 28 章）。装備箱の「見た目を変える」から開く。
//
// 下書き（編集中）と、保存した外見（確定）を分ける。「この見た目に決定」で保存が完了するまで、保存データは変えない。
// 下見は、後ろに見えているゲームの画面の狩人を、下書きの外見で描く（app が毎フレーム preview() を読む）。閉じれば、保存した外見に戻る。
// この版で選べるのは 体型（見本 4 種 + 8 軸）・肌（12 色 + 赤み・黄み）・髪の色（12 色）。
// 髪型・顔・眉・目の色・全体の見本 P02〜P06・お気に入り・外見レシピ・途中の編集の一時保管は「準備中」（画面に出して、押せない）。
import {
  DRAFT_KIND_NAMES,
  DraftHistory,
  RANDOM_RANGE,
  changedKinds,
  describeKind,
  draftChanges,
  draftOf,
  editableAppearance,
  emptyDraft,
  randomDraft,
  resolveAppearance,
  resolveDraft,
  validateDraft,
  type AppearanceDraft,
  type DraftKind,
  type RandomLocks,
  type ResolvedAppearance,
} from '../data/appearance';
import type { AppearanceColor, Content } from '../data/schemas';
import type { SaveManager, SaveResult } from '../save/saveManager';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clone = (d: AppearanceDraft): AppearanceDraft => JSON.parse(JSON.stringify(d)) as AppearanceDraft;
const same = (a: AppearanceDraft, b: AppearanceDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

type Tab = 'preset' | 'body' | 'skin' | 'hair' | 'face' | 'store';
const TABS: [Tab, string][] = [
  ['preset', '見本'],
  ['body', '体型'],
  ['skin', '肌'],
  ['hair', '髪'],
  ['face', '顔'],
  ['store', '保存'],
];
type Clothes = 'worn' | 'base' | 'helmet';
const CLOTHES: Record<Clothes, string> = { worn: 'いまの装備', base: '初期服（里の装束）', helmet: '兜で確認' };
const CLOTHES_SHORT: Record<Clothes, string> = { worn: '装備', base: '初期服', helmet: '兜' };

export interface LooksHost {
  readonly save: SaveManager;
  /** 閉じた（saved: 決定して保存できた）。装備箱へ戻る */
  looksClosed(saved: boolean): void;
  /** 兜をかぶっているか（いないと「兜で確認」は参考の兜） */
  wearsHelmet(): boolean;
}

/** app が毎フレーム読む、下見の中身 */
export interface LooksPreview {
  look: ResolvedAppearance;
  spin: number;
  focus: 'body' | 'face';
  zoom: number;
  clothes: Clothes;
  /** 狩人を真ん中に置く画面の範囲（画面に対する割合） */
  pane: { cx: number; cy: number; w: number; h: number };
}

export class AppearanceEditor {
  readonly root: HTMLElement;
  private stage: HTMLElement;
  private viewBtns: HTMLElement;
  private tabsEl: HTMLElement;
  private body: HTMLElement;
  private status: HTMLElement;
  private bar: HTMLElement;
  private modal: HTMLElement;
  private tab: Tab = 'body';
  private visited = new Set<Tab>();
  /** 編集を開いた時の外見（比較と「編集開始値へ」と、決定で当てる種類を決める元） */
  private start: AppearanceDraft = emptyDraft();
  private draft: AppearanceDraft = emptyDraft();
  private history = new DraftHistory(50);
  private locks: RandomLocks = { body: false, skin: false, hairColor: false };
  private comparing = false;
  /** この版で編集できる外見か（新しい版のデータは、見るだけ） */
  private editable = true;
  /** 保存した外見のうち、この版で描けず A で代わりに描いている所 */
  private fallback: string[] = [];
  private look: ResolvedAppearance;
  private spin = 0;
  private focus: 'body' | 'face' = 'body';
  private zoom = 1;
  private clothes: Clothes = 'worn';
  /** スライダーを動かし始める前の下書き（離した時に 1 操作として積む。途切れたら、これへ戻す） */
  private dragFrom: AppearanceDraft | null = null;
  private saving = false;
  /** 数の欄の、入れ直してほしい知らせ（軸の id → 文） */
  private fieldError = new Map<string, string>();

  constructor(
    parent: HTMLElement,
    private content: Content,
    private host: LooksHost,
  ) {
    const root = el('div');
    root.id = 'looks';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '見た目を変える');

    // 左（縦向きでは上）: 下見。なぞると狩人が回る。二本指で寄る・引く
    this.stage = el('div', 'looks-stage');
    this.stage.setAttribute('aria-label', '下見（左右になぞると回ります）');
    this.viewBtns = el('div', 'looks-view');
    this.stage.appendChild(this.viewBtns);
    this.bindStage();

    // 右（縦向きでは下）: 種類の札と、選ぶ欄
    const side = el('div', 'looks-side');
    const head = el('div', 'looks-head');
    head.append(el('h2', undefined, '見た目を変える'), el('p', 'looks-note', '決定するまで、ゲームの姿は変わりません。費用はかかりません。持ち物・装備・進行は、そのままです。'));
    this.tabsEl = el('div', 'looks-tabs');
    this.tabsEl.setAttribute('role', 'tablist');
    this.body = el('div', 'looks-body');
    this.status = el('p', 'looks-status');
    this.status.setAttribute('role', 'status');
    side.append(head, this.tabsEl, this.body, this.status);

    // 下: 履歴・ランダム・戻す・キャンセル・確認へ
    this.bar = el('div', 'looks-bar');
    this.modal = el('div', 'looks-modal');
    this.modal.hidden = true;
    root.append(this.stage, side, this.bar, this.modal);
    parent.appendChild(root);
    this.root = root;
    this.look = resolveDraft(emptyDraft(), content.appearance);

    window.addEventListener('keydown', (e) => this.onKey(e));
    // 画面の回転・割り込みでスライダーの操作が途切れたら、動かし始める前の値へ戻す
    const interrupt = (): void => {
      if (this.open) this.cancelDrag();
    };
    window.addEventListener('blur', interrupt);
    document.addEventListener('visibilitychange', interrupt);
    window.addEventListener('orientationchange', interrupt);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 開く: 保存した外見を読み、下書きを作る。履歴・比較・固定は初めから */
  openEditor(): void {
    const saved = this.host.save.doc.appearance;
    this.editable = editableAppearance(saved);
    this.fallback = resolveAppearance(saved, this.content.appearance).fallback;
    this.start = draftOf(saved);
    this.draft = clone(this.start);
    this.history.clear();
    this.comparing = false;
    this.dragFrom = null;
    this.saving = false;
    this.fieldError.clear();
    this.spin = 0;
    this.zoom = 1;
    this.focus = 'body';
    this.clothes = 'worn';
    this.tab = 'body';
    this.visited = new Set(['body']);
    this.modal.hidden = true;
    this.root.hidden = false;
    document.body.classList.add('looks-open');
    this.say('');
    this.changed();
    (this.tabsEl.querySelector('button.on') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  /** 下見（開いていなければ null）。canvas は、ゲームの画面の位置 */
  preview(canvas: DOMRect): LooksPreview | null {
    if (!this.open) return null;
    const st = this.stage.getBoundingClientRect();
    const btns = this.viewBtns.getBoundingClientRect();
    // 狩人を置くのは、下見の欄のうち、下の操作のボタンより上
    const r = { left: st.left, width: st.width, top: st.top, height: Math.max(40, Math.min(st.height, btns.top - st.top - 4)) };
    const W = Math.max(1, canvas.width), H = Math.max(1, canvas.height);
    return {
      look: this.look,
      spin: this.spin,
      focus: this.focus,
      zoom: this.zoom,
      clothes: this.clothes,
      pane: { cx: (r.left + r.width / 2 - canvas.left) / W, cy: (r.top + r.height / 2 - canvas.top) / H, w: r.width / W, h: r.height / H },
    };
  }

  // ---- 下書きの操作 ----

  /** 1 操作（元に戻す 1 回で戻る単位）。変わらなければ積まない */
  private op(change: (d: AppearanceDraft) => void): void {
    if (this.saving) return;
    const before = clone(this.draft);
    change(this.draft);
    if (same(before, this.draft)) return;
    this.history.push(before);
    this.say('');
    this.changed();
  }

  /** 体型が A（null）の時に軸を動かすと、標準（全軸 50 = A の体つき）から始める */
  private ensureBody(d: AppearanceDraft): NonNullable<AppearanceDraft['body']> {
    if (!d.body) {
      const std = this.content.appearance.bodyPresets.find((p) => this.content.appearance.bodyAxes.every((ax) => p.axes[ax.id] === 50)) ?? this.content.appearance.bodyPresets[0]!;
      d.body = { presetId: std.id, axes: Object.fromEntries(this.content.appearance.bodyAxes.map((ax) => [ax.id, 50])) };
    }
    return d.body;
  }

  private undo(): void {
    if (this.saving) return;
    const d = this.history.undo(this.draft);
    if (!d) return;
    this.draft = d;
    this.say('1 つ戻しました。');
    this.changed();
  }

  private redo(): void {
    if (this.saving) return;
    const d = this.history.redo(this.draft);
    if (!d) return;
    this.draft = d;
    this.say('やり直しました。');
    this.changed();
  }

  private random(): void {
    let next = randomDraft(this.draft, this.locks, this.content.appearance, Math.random);
    if (!next) {
      this.say('固定されていない項目がありません。', true);
      return;
    }
    // いまと同じものが出たら、選び直す（押したのに何も変わらない、を避ける）
    for (let i = 0; i < 8 && same(next, this.draft); i++) next = randomDraft(this.draft, this.locks, this.content.appearance, Math.random)!;
    const picked = next;
    this.op((d) => Object.assign(d, picked));
    this.say('ランダムに選びました（固定した項目はそのまま）。');
  }

  private cancelDrag(): void {
    if (!this.dragFrom) return;
    this.draft = this.dragFrom;
    this.dragFrom = null;
    this.changed();
  }

  /** 下書きが変わった: 下見と画面を作り直す */
  private changed(): void {
    this.look = resolveDraft(this.comparing ? this.start : this.draft, this.content.appearance);
    this.render();
  }

  /** 動かしている途中（スライダー）: 下見だけを替える（画面は作り直さない。作り直すと、つまんでいるつまみが消える） */
  private moved(): void {
    this.look = resolveDraft(this.comparing ? this.start : this.draft, this.content.appearance);
    this.renderBar();
  }

  private say(text: string, bad = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('bad', bad);
  }

  // ---- 画面 ----

  private render(): void {
    this.renderTabs();
    this.renderView();
    this.renderBody();
    this.renderBar();
  }

  private renderTabs(): void {
    this.tabsEl.textContent = '';
    for (const [id, label] of TABS) {
      const b = el('button', id === this.tab ? 'on' : undefined, label);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === this.tab));
      b.dataset.tab = id;
      b.addEventListener('click', () => this.setTab(id));
      this.tabsEl.appendChild(b);
    }
  }

  private setTab(t: Tab): void {
    this.cancelDrag();
    this.tab = t;
    // 髪・顔へ初めて入った時は顔へ寄り、体型では全身。手で変えた角度と距離は、その後は勝手に戻さない
    if (!this.visited.has(t)) {
      this.visited.add(t);
      if (t === 'hair' || t === 'face') this.focus = 'face';
      else if (t === 'body') this.focus = 'body';
    }
    this.render();
    this.body.scrollTop = 0;
  }

  /** 下見の操作（回す・寄る・比較・服）。外見の履歴には入れない */
  private renderView(): void {
    this.viewBtns.textContent = '';
    const btn = (label: string, title: string, on: boolean, act: () => void, key: string): void => {
      const b = el('button', on ? 'on' : undefined, label);
      b.dataset.view = key;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        act();
        this.renderView();
      });
      this.viewBtns.appendChild(b);
    };
    // 正面と後ろ、全身と顔は、押すたびに入れ替わる（同じ位置へ、いつでも戻せる）
    const front = Math.abs(this.spin) < 0.01;
    btn(front ? '後ろ' : '正面', front ? '後ろから見る' : '正面から見る', false, () => (this.spin = front ? Math.PI : 0), 'turn');
    btn(this.focus === 'body' ? '顔' : '全身', this.focus === 'body' ? '顔へ寄る' : '全身を見る', false, () => {
      this.focus = this.focus === 'body' ? 'face' : 'body';
      this.zoom = 1;
    }, 'focus');
    btn('寄る', '寄る', false, () => (this.zoom = Math.max(0.6, this.zoom / 1.15)), 'in');
    btn('引く', '引く', false, () => (this.zoom = Math.min(1.6, this.zoom * 1.15)), 'out');
    btn(this.comparing ? '開始時' : '比較', this.comparing ? '比較: 編集開始時の見た目を表示中（押すと現在へ）' : '比較: 編集開始時の見た目を見る', this.comparing, () => {
      this.comparing = !this.comparing;
      this.look = resolveDraft(this.comparing ? this.start : this.draft, this.content.appearance);
      this.renderBar();
    }, 'compare');
    const order: Clothes[] = ['worn', 'base', 'helmet'];
    const helmet = this.host.wearsHelmet() ? '兜で確認' : '兜で確認（参考の兜）';
    btn(`服: ${CLOTHES_SHORT[this.clothes]}`, `服: ${this.clothes === 'helmet' ? helmet : CLOTHES[this.clothes]}（押すと切り替え）`, this.clothes !== 'worn', () => (this.clothes = order[(order.indexOf(this.clothes) + 1) % order.length]!), 'clothes');
  }

  private renderBody(): void {
    this.body.textContent = '';
    if (!this.editable) this.body.appendChild(el('p', 'looks-warn', 'この見た目は、新しい版のデータです。この版では編集に適用できません（見るだけです。保存されている内容は、そのまま残します）。'));
    if (this.fallback.length) this.body.appendChild(el('p', 'looks-warn', `保存されている見た目に、この版で描けない所があります（${this.fallback.join('・')}）。A の姿で代わりに描いています。保存されている値は、そのまま残します。`));
    if (this.tab === 'preset') this.renderPresets();
    else if (this.tab === 'body') this.renderBodyTab();
    else if (this.tab === 'skin') this.renderSkin();
    else if (this.tab === 'hair') this.renderHair();
    else if (this.tab === 'face') this.renderFace();
    else this.renderStore();
  }

  private section(title: string, sub?: string): HTMLElement {
    const s = el('section', 'looks-sec');
    s.appendChild(el('h3', undefined, title));
    if (sub) s.appendChild(el('p', 'looks-sub', sub));
    this.body.appendChild(s);
    return s;
  }

  /** 選ぶボタン（選んでいる時は ✓ と名前。色だけで示さない） */
  private choice(parent: HTMLElement, label: string, id: string, on: boolean, ready: boolean, act: () => void, color?: string): HTMLButtonElement {
    const b = el('button', 'looks-choice');
    b.classList.toggle('on', on);
    b.dataset.choice = id;
    b.setAttribute('aria-pressed', String(on));
    if (color) {
      const chip = el('span', 'chip');
      chip.style.background = color;
      b.appendChild(chip);
    }
    const t = el('span', 'txt');
    t.append(el('b', undefined, `${on ? '✓ ' : ''}${label}`), el('small', undefined, ready ? id : `${id}・準備中`));
    b.appendChild(t);
    if (!ready) b.disabled = true;
    else b.addEventListener('click', act);
    parent.appendChild(b);
    return b;
  }

  private lockBox(parent: HTMLElement, key: keyof RandomLocks, label: string): void {
    const l = el('label', 'looks-lock');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.locks[key];
    cb.dataset.lock = key;
    cb.addEventListener('change', () => {
      this.locks[key] = cb.checked;
    });
    l.append(cb, ` ランダムで変えない（${label}を固定）`);
    parent.appendChild(l);
  }

  /** 種類を、見本 P01（基準ハンター A）の初期値へ。いまの見本は P01 だけなので、A のその種類 */
  private resetKind(parent: HTMLElement, kind: DraftKind): void {
    const b = el('button', 'looks-reset', `${DRAFT_KIND_NAMES[kind]}を初期値へ（見本 P01 = A の${DRAFT_KIND_NAMES[kind]}）`);
    b.dataset.reset = kind;
    b.disabled = this.draft[kind] === null;
    b.addEventListener('click', () => this.op((d) => {
      if (kind === 'body') d.body = null;
      else if (kind === 'skin') d.skin = null;
      else d.hairColorId = null;
    }));
    parent.appendChild(b);
  }

  private renderPresets(): void {
    const c = this.content.appearance;
    const s = this.section('全体の見本', '見本を当てると、体型・肌・髪・顔をまとめて替えます。いま選べるのは P01（基準ハンター A）だけです。ほかの見本は、髪型と顔の 3D の形を作ってから選べます。');
    const row = el('div', 'looks-choices wide');
    for (const p of c.presets) {
      this.choice(row, p.label, p.id, p.id === 'P01' && changedKinds(emptyDraft(), this.draft).length === 0, p.ready, () => this.confirmWhole('P01', emptyDraft()));
    }
    s.appendChild(row);
    s.appendChild(el('p', 'looks-sub', '女性的・男性的・中性的は見本の説明で、ほかの項目を制限しません。どの見た目でも、能力は変わりません。'));
    s.appendChild(el('p', 'looks-sub', `「ランダム」は、固定していない体型・肌・髪の色を選び直します（${LOOKS_RANDOM_NOTE}。この版で見て確かめた範囲）。`));
  }

  private renderBodyTab(): void {
    const c = this.content.appearance;
    const d = this.draft;
    const s = this.section('体型', '身長・骨の長さ・武器の持ち方は変わりません（体の皮と防具の形だけ）。');
    const row = el('div', 'looks-choices');
    this.choice(row, 'A の体つき', 'A', d.body === null, true, () => this.op((x) => (x.body = null)));
    for (const p of c.bodyPresets) {
      this.choice(row, p.label, p.id, d.body?.presetId === p.id, true, () => this.op((x) => (x.body = { presetId: p.id, axes: { ...p.axes } })));
    }
    s.appendChild(row);
    if (d.body) {
      const p = c.bodyPresets.find((x) => x.id === d.body!.presetId);
      if (p && c.bodyAxes.some((ax) => d.body!.axes[ax.id] !== p.axes[ax.id])) s.appendChild(el('p', 'looks-sub', `いまの形: ${describeKind('body', d, c)}`));
    }
    const axes = el('div', 'looks-sliders');
    for (const ax of c.bodyAxes) {
      this.slider(axes, ax.id, ax.label, 0, 100, d.body?.axes[ax.id] ?? 50, (x, v) => {
        this.ensureBody(x).axes[ax.id] = v;
      });
    }
    s.appendChild(axes);
    s.appendChild(el('p', 'looks-sub', '数は 0〜100（50 が A の体つき）。身長や cm ではありません。'));
    this.lockBox(s, 'body', '体型');
    this.resetKind(s, 'body');
  }

  /**
   * スライダー（名前・− ・つまみ・＋・数の欄）。つまんで離すまでが 1 操作。数の欄は、決めた時に 1 操作（範囲外は、その場で知らせて元の値を残す）。
   * set は、下書きへ値を入れる。
   */
  private slider(parent: HTMLElement, id: string, label: string, min: number, max: number, value: number, set: (d: AppearanceDraft, v: number) => void, disabled = false): void {
    const row = el('div', 'looks-slider');
    row.dataset.axis = id;
    const name = el('span', 'name', label);
    const minus = el('button', 'step', '−');
    minus.setAttribute('aria-label', `${label}を 1 下げる`);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = '1';
    range.value = String(value);
    range.setAttribute('aria-label', label);
    const plus = el('button', 'step', '＋');
    plus.setAttribute('aria-label', `${label}を 1 上げる`);
    const num = document.createElement('input');
    num.type = 'number';
    num.inputMode = 'numeric';
    num.min = String(min);
    num.max = String(max);
    num.step = '1';
    num.value = String(value);
    num.setAttribute('aria-label', `${label}の数`);
    for (const e of [minus, range, plus, num]) (e as HTMLButtonElement | HTMLInputElement).disabled = disabled || this.saving;
    const clamp = (v: number): number => Math.max(min, Math.min(max, Math.round(v)));
    minus.addEventListener('click', () => {
      this.fieldError.delete(id);
      this.op((d) => set(d, clamp(Number(range.value) - 1)));
    });
    plus.addEventListener('click', () => {
      this.fieldError.delete(id);
      this.op((d) => set(d, clamp(Number(range.value) + 1)));
    });
    range.addEventListener('input', () => {
      this.fieldError.delete(id);
      if (!this.dragFrom) this.dragFrom = clone(this.draft);
      const v = clamp(Number(range.value));
      set(this.draft, v);
      num.value = String(v);
      this.moved();
    });
    range.addEventListener('change', () => {
      const from = this.dragFrom;
      this.dragFrom = null;
      if (from && !same(from, this.draft)) {
        this.history.push(from);
        this.say('');
      }
      this.changed();
    });
    range.addEventListener('pointercancel', () => this.cancelDrag());
    num.addEventListener('change', () => {
      const raw = num.value.trim();
      const v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < min || v > max) {
        this.fieldError.set(id, `${min}〜${max}で入力してください`);
        this.render();
        return;
      }
      this.fieldError.delete(id);
      this.op((d) => set(d, v));
      this.render();
    });
    row.append(name, minus, range, plus, num);
    parent.appendChild(row);
    const err = this.fieldError.get(id);
    if (err) parent.appendChild(el('p', 'looks-field-error', err));
  }

  private swatches(parent: HTMLElement, list: AppearanceColor[], current: string | null, pick: (id: string) => void): void {
    const row = el('div', 'looks-choices colors');
    for (const col of list) this.choice(row, col.label, col.id, current === col.id, col.ready !== false, () => pick(col.id), col.hex);
    parent.appendChild(row);
  }

  private renderSkin(): void {
    const c = this.content.appearance;
    const d = this.draft;
    const s = this.section('肌の色', '顔・首・手・耳の肌だけが替わります（服・革・目は替わりません）。色の見本は目安で、光の当たり方で見え方が変わります。');
    const a = el('div', 'looks-choices colors');
    this.choice(a, 'A の肌', 'A', d.skin === null, true, () => this.op((x) => (x.skin = null)), c.base.skin);
    s.appendChild(a);
    this.swatches(s, c.skinColors, d.skin?.colorId ?? null, (id) => this.op((x) => {
      x.skin = { colorId: id, redness: x.skin?.redness ?? 0, yellowness: x.skin?.yellowness ?? 0 };
    }));
    const tones = el('div', 'looks-sliders');
    for (const [key, label] of [['redness', '赤み'], ['yellowness', '黄み']] as const) {
      this.slider(tones, key, label, c.skinTone.min, c.skinTone.max, d.skin?.[key] ?? 0, (x, v) => {
        if (x.skin) x.skin[key] = v;
      }, d.skin === null);
    }
    s.appendChild(tones);
    if (!d.skin) s.appendChild(el('p', 'looks-sub', '色を選ぶと、赤み・黄みを調整できます（−100〜100）。'));
    this.lockBox(s, 'skin', '肌');
    this.resetKind(s, 'skin');
  }

  private renderHair(): void {
    const c = this.content.appearance;
    const d = this.draft;
    const st = this.section('髪型', 'いまは A の短髪だけです。ほかの髪型は、3D の形を作ってから選べます。');
    const styles = el('div', 'looks-choices');
    for (const h of c.hairStyles) this.choice(styles, h.label, h.id, h.id === 'H01', h.ready, () => {});
    st.appendChild(styles);
    const s = this.section('髪の色', '髪型はそのままで、色だけが替わります。眉は、まだ A のままです。');
    const a = el('div', 'looks-choices colors');
    this.choice(a, 'A の髪の色', 'A', d.hairColorId === null, true, () => this.op((x) => (x.hairColorId = null)), c.base.hair);
    s.appendChild(a);
    this.swatches(s, c.hairColors, d.hairColorId, (id) => this.op((x) => (x.hairColorId = id)));
    this.lockBox(s, 'hairColor', '髪の色');
    this.resetKind(s, 'hairColorId');
  }

  private renderFace(): void {
    const c = this.content.appearance;
    const f = this.section('顔', 'いまは A の顔だけです。ほかの顔の形と、5 つの調整（顎幅・頬の厚み・鼻の幅・口元・目の間隔）は、3D の形を作ってから選べます。');
    const faces = el('div', 'looks-choices');
    for (const x of c.faces) this.choice(faces, x.label, x.id, x.id === 'F01', x.ready, () => {});
    f.appendChild(faces);
    const b = this.section('眉');
    const brows = el('div', 'looks-choices');
    for (const x of c.brows) this.choice(brows, x.label, x.id, x.id === 'R01', x.ready, () => {});
    b.appendChild(brows);
    const e = this.section('目の色');
    this.swatches(e, c.eyeColors, 'E01', () => {});
  }

  private renderStore(): void {
    const s = this.section('保存', 'どれも準備中です。');
    const list = el('ul', 'looks-todo');
    for (const t of ['お気に入りの見た目（6 枠。端末の別の場所へ）', '外見レシピの書き出し・読み込み（見た目だけの JSON）', '途中の編集の一時保管と、続きから']) list.appendChild(el('li', undefined, `${t}: 準備中`));
    s.appendChild(list);
  }

  private renderBar(): void {
    this.bar.textContent = '';
    const btn = (label: string, act: () => void, key: string, opt: { disabled?: boolean; cls?: string } = {}): HTMLButtonElement => {
      const b = el('button', opt.cls, label);
      b.dataset.act = key;
      b.disabled = !!opt.disabled || this.saving;
      b.addEventListener('click', act);
      this.bar.appendChild(b);
      return b;
    };
    btn(`元に戻す${this.history.undoCount ? `（${this.history.undoCount}）` : ''}`, () => this.undo(), 'undo', { disabled: this.history.undoCount === 0 });
    btn('やり直す', () => this.redo(), 'redo', { disabled: this.history.redoCount === 0 });
    btn('ランダム', () => this.random(), 'random');
    btn('編集開始値へ', () => this.confirmWhole('start', this.start), 'start', { disabled: same(this.draft, this.start) });
    btn('A全体へ', () => this.confirmWhole('A', emptyDraft()), 'legacy', { disabled: changedKinds(emptyDraft(), this.draft).length === 0 });
    const gap = el('span', 'gap');
    this.bar.appendChild(gap);
    btn('キャンセル', () => this.cancel(), 'cancel');
    btn('確認へ', () => this.confirm(), 'confirm', { cls: 'go' });
  }

  // ---- 確かめる窓 ----

  private showModal(title: string, lines: (string | HTMLElement)[], buttons: [string, () => void, string?][], focus = 0): void {
    this.modal.textContent = '';
    const box = el('div', 'looks-modal-box');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.appendChild(el('h3', undefined, title));
    for (const l of lines) box.appendChild(typeof l === 'string' ? el('p', undefined, l) : l);
    const row = el('div', 'looks-modal-buttons');
    const made: HTMLButtonElement[] = [];
    for (const [label, act, cls] of buttons) {
      const b = el('button', cls, label);
      b.addEventListener('click', act);
      row.appendChild(b);
      made.push(b);
    }
    box.appendChild(row);
    this.modal.appendChild(box);
    this.modal.hidden = false;
    made[focus]?.focus({ preventScroll: true });
  }

  private closeModal(): void {
    this.modal.hidden = true;
    this.modal.textContent = '';
  }

  private changeList(from: AppearanceDraft, to: AppearanceDraft): HTMLElement {
    const ul = el('ul', 'looks-changes');
    for (const ch of draftChanges(from, to, this.content.appearance)) ul.appendChild(el('li', undefined, `${ch.label}：${ch.before} → ${ch.after}`));
    return ul;
  }

  /** 全体を戻す（編集開始値へ / A全体へ / 見本 P01）。変わる所を見せてから、下書きへ当てる（1 操作。元に戻すで戻せる） */
  private confirmWhole(kind: 'start' | 'A' | 'P01', to: AppearanceDraft): void {
    this.cancelDrag();
    if (same(this.draft, to)) return;
    const title = kind === 'start' ? '編集開始値へ戻します' : kind === 'A' ? 'A の姿へ戻します' : '見本 P01（基準ハンター A）を当てます';
    this.showModal(title, ['次の所が替わります（下書きだけ。保存はまだしません。「元に戻す」で戻せます）。', this.changeList(this.draft, to)], [
      ['当てる', () => {
        this.closeModal();
        this.op((d) => Object.assign(d, clone(to)));
      }, 'go'],
      ['やめる', () => this.closeModal()],
    ], 1);
  }

  private cancel(): void {
    this.cancelDrag();
    if (this.saving) return;
    if (same(this.draft, this.start)) {
      this.close(false);
      return;
    }
    this.showModal('編集した見た目を破棄しますか？', ['保存した見た目は、そのままです。'], [
      ['編集を続ける', () => this.closeModal(), 'go'],
      ['破棄して戻る', () => {
        this.closeModal();
        this.close(false);
      }],
    ], 0);
  }

  private confirm(): void {
    this.cancelDrag();
    const c = this.content.appearance;
    if (same(this.draft, this.start)) {
      this.showModal('変更がありません', ['保存した見た目のままです。'], [
        ['閉じる', () => {
          this.closeModal();
          this.close(false);
        }],
        ['編集へ戻る', () => this.closeModal(), 'go'],
      ], 1);
      return;
    }
    const errors = [...(this.editable ? [] : ['この見た目は、この版では編集に適用できません（新しい版のデータです）']), ...validateDraft(this.draft, c)];
    const lines: (string | HTMLElement)[] = [this.changeList(this.start, this.draft), '費用はかかりません。持ち物・装備・進行は、そのままです。'];
    if (errors.length) {
      const ul = el('ul', 'looks-errors');
      for (const e of errors) ul.appendChild(el('li', undefined, e));
      lines.push('決定できません:', ul);
    }
    const buttons: [string, () => void, string?][] = [];
    if (!errors.length) buttons.push(['この見た目に決定', () => void this.decide(), 'go']);
    buttons.push(['編集へ戻る', () => this.closeModal()]);
    this.showModal('確認', lines, buttons, 0);
  }

  /** 決定: 保存が完了してから閉じる（連打は受け付けない）。失敗しても、下書きは残す */
  private async decide(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.showModal('保存しています…', ['この見た目を保存しています。'], []);
    this.renderBar();
    let r: SaveResult;
    try {
      r = await this.host.save.setAppearance(this.start, this.draft);
    } catch (e) {
      r = { ok: false, reason: 'failed', message: `保存できませんでした（${e instanceof Error ? e.message : String(e)}）。` };
    }
    this.saving = false;
    if (r.ok) {
      this.closeModal();
      this.close(true);
      return;
    }
    this.renderBar();
    if (r.reason === 'conflict') {
      this.showConflict();
      return;
    }
    this.showModal('保存できませんでした', ['保存できませんでした。編集内容は残っています。', r.message], [
      ['もう一度保存', () => void this.decide(), 'go'],
      ['編集へ戻る', () => this.closeModal()],
    ], 0);
  }

  /**
   * 別の画面（タブ）で保存が進んでいた: 最新の内容は読み直してある。この画面で変えた種類だけを最新へ当てる（ほかの種類の、別の画面での変更は残る）。
   * 同じ種類が別の画面でも変わっていれば、どちらの値を使うかを選ぶ。
   */
  private showConflict(): void {
    const c = this.content.appearance;
    const latest = this.host.save.doc.appearance;
    const mine = changedKinds(this.start, this.draft);
    const latestDraft = draftOf(latest);
    const theirs = editableAppearance(latest) ? changedKinds(this.start, latestDraft) : (['body', 'skin', 'hairColorId'] as DraftKind[]);
    const both = mine.filter((k) => theirs.includes(k));
    const lines: (string | HTMLElement)[] = ['別の画面で保存内容が更新されました。最新の状態を確認してください。'];
    if (!editableAppearance(latest)) {
      lines.push('最新の見た目は、新しい版のデータです。この版では、上書きしません。');
      this.editable = false;
      this.showModal('保存できませんでした', lines, [['編集へ戻る', () => this.closeModal(), 'go']], 0);
      return;
    }
    if (!both.length) {
      lines.push(`この画面で変えた所（${mine.map((k) => DRAFT_KIND_NAMES[k]).join('・')}）だけを、最新の内容へ当てます。ほかの所の、別の画面での変更は残ります。`);
      this.showModal('別の画面で更新されました', lines, [
        ['もう一度決定', () => this.confirm(), 'go'],
        ['編集へ戻る', () => this.closeModal()],
      ], 0);
      return;
    }
    const ul = el('ul', 'looks-changes');
    for (const k of both) ul.appendChild(el('li', undefined, `${DRAFT_KIND_NAMES[k]}：最新 ${describeKind(k, latestDraft, c)} ／ 編集中 ${describeKind(k, this.draft, c)}`));
    lines.push('同じ所が、別の画面でも変わっていました。', ul);
    this.showModal('別の画面で更新されました', lines, [
      ['最新の値を使う', () => {
        this.op((d) => {
          for (const k of both) (d as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(latestDraft[k]));
        });
        this.confirm();
      }],
      ['編集中の値を使う', () => this.confirm(), 'go'],
      ['編集へ戻る', () => this.closeModal()],
    ], 1);
  }

  private close(saved: boolean): void {
    this.cancelDrag();
    this.closeModal();
    this.root.hidden = true;
    document.body.classList.remove('looks-open');
    this.host.looksClosed(saved);
  }

  // ---- 入力 ----

  private onKey(e: KeyboardEvent): void {
    if (!this.open) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type === 'number';
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!this.modal.hidden) {
        if (!this.saving) this.closeModal();
      } else this.cancel();
      return;
    }
    if (!this.modal.hidden || typing || !mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      this.redo();
    }
  }

  /** 下見をなぞると回る。二本指で寄る・引く */
  private bindStage(): void {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.target !== this.stage) return;
      this.stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    this.stage.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        this.spin += (e.clientX - p.x) * 0.012;
        this.spin = Math.atan2(Math.sin(this.spin), Math.cos(this.spin));
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && dist > 0) this.zoom = Math.max(0.6, Math.min(1.6, (this.zoom * pinch) / dist));
        pinch = dist;
      }
    });
    const up = (e: PointerEvent): void => {
      if (!pts.delete(e.pointerId)) return;
      pinch = 0;
      if (pts.size === 0) this.renderView();
    };
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', up);
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.6, Math.min(1.6, this.zoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
    }, { passive: false });
  }
}

/** ランダムの範囲（画面の説明） */
const LOOKS_RANDOM_NOTE = `体型は見本 4 種 ±${RANDOM_RANGE.axisJitter}（${RANDOM_RANGE.axisMin}〜${RANDOM_RANGE.axisMax}）、肌の赤み・黄みは ±${RANDOM_RANGE.tone}`;
