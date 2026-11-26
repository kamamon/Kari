// 全体の地図（v0.51.0。#19 の F04「地理的な輪郭・番号・自分の向きを表示」。docs/spec.md の 32.16）。
// エリアごとに本当の外周の形を、どのエリアも同じ縮尺で、地図のマス（grid）の真ん中へ置く（04 の 1 章「地図は実世界の形を表す独立した著者配置へ」。
// エリアどうしの本当の座標は 240m おきに離れているので、間は詰めて描く）。出口どうしを線で結び（大型も通る道は太く）、番号・自分の矢じり・
// 追跡で分かっている標的だけを出す（見えている・印は、いまの位置。最後に見た所は「?」。眠りなどの中身は、見えている時だけ）。
// 向き: 北（+Z）が上、+X が左（上から見た向き。D-133。居るエリアの地図と同じ）。データと simulation の状態を読むだけ。

import type { FieldAreaDef, FieldDef } from '../data/schemas';

const NS = 'http://www.w3.org/2000/svg';
/** 1 マスの広さ（m）。いちばん大きいエリア（約 122m）が、隣と重ならずに入る */
export const FIELD_MAP_CELL = 140;

export interface FieldMapArea {
  id: string;
  no: number;
  kind: FieldAreaDef['kind'];
  label: string;
  /** 外周（地図の px） */
  outline: [number, number][];
  /** 番号を置く所（エリアの中心） */
  center: [number, number];
  /** 出口（地図の px）と行き先 */
  exits: { to: string; x: number; y: number }[];
}

export interface FieldMapLayout {
  width: number;
  height: number;
  /** 1m が何 px か */
  scale: number;
  areas: FieldMapArea[];
  /** 出口どうしを結ぶ線（エリアの組ごとに 1 本）。large = 大型も通る */
  links: { a: string; b: string; large: boolean; x0: number; y0: number; x1: number; y1: number }[];
  /** 世界の (x, z) を、そのエリアの地図の上の px へ */
  toMap(areaId: string, x: number, z: number): [number, number];
}

const outlineOf = (a: FieldAreaDef): [number, number][] =>
  a.shape?.length ? a.shape : [[a.bounds.minX, a.bounds.minZ], [a.bounds.maxX, a.bounds.minZ], [a.bounds.maxX, a.bounds.maxZ], [a.bounds.minX, a.bounds.maxZ]];

/** 地図の配置（DOM を使わない。tests/field-map.test.ts が確かめる）。w × h（px）に、縦横比を保って収める */
export function fieldMapLayout(field: FieldDef, w: number, h: number, pad = 10): FieldMapLayout {
  const C = FIELD_MAP_CELL;
  const cols = Math.max(...field.areas.map((a) => a.grid[0])) + 1;
  const rows = Math.max(...field.areas.map((a) => a.grid[1])) + 1;
  const s = Math.min((w - pad * 2) / (cols * C), (h - pad * 2) / (rows * C));
  const width = cols * C * s + pad * 2, height = rows * C * s + pad * 2;
  const frames = new Map<string, { cx: number; cy: number; bx: number; bz: number }>();
  for (const a of field.areas) {
    const b = a.bounds;
    // マスの真ん中（+X が左なので、列の大きい方を左に。北が上なので、行の大きい方を上に）
    frames.set(a.id, { cx: pad + ((cols - 1 - a.grid[0]) * C + C / 2) * s, cy: pad + ((rows - 1 - a.grid[1]) * C + C / 2) * s, bx: (b.minX + b.maxX) / 2, bz: (b.minZ + b.maxZ) / 2 });
  }
  const toMap = (areaId: string, x: number, z: number): [number, number] => {
    const f = frames.get(areaId);
    if (!f) return [-100, -100];
    return [f.cx - (x - f.bx) * s, f.cy - (z - f.bz) * s];
  };
  const areas: FieldMapArea[] = field.areas.map((a) => {
    const c = a.center ?? { x: (a.bounds.minX + a.bounds.maxX) / 2, z: (a.bounds.minZ + a.bounds.maxZ) / 2 };
    return {
      id: a.id,
      no: a.no,
      kind: a.kind,
      label: a.kind === 'camp' ? '営' : String(a.no),
      outline: outlineOf(a).map(([x, z]) => toMap(a.id, x, z)),
      center: toMap(a.id, c.x, c.z),
      exits: a.exits.map((e) => {
        const [x, y] = toMap(a.id, e.x, e.z);
        return { to: e.to, x, y };
      }),
    };
  });
  const links: FieldMapLayout['links'] = [];
  const done = new Set<string>();
  for (const a of field.areas) {
    for (const e of a.exits) {
      const key = [a.id, e.to].sort().join('|');
      if (done.has(key)) continue;
      const to = field.areas.find((x) => x.id === e.to);
      const back = to?.exits.find((x) => x.to === a.id);
      if (!to || !back) continue;
      done.add(key);
      const [x0, y0] = toMap(a.id, e.x, e.z), [x1, y1] = toMap(to.id, back.x, back.z);
      links.push({ a: a.id, b: to.id, large: !!(e.large && back.large), x0, y0, x1, y1 });
    }
  }
  return { width, height, scale: s, areas, links, toMap };
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, parent: Element, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** 地図に出す、いまの様子（HUD が、追跡の決まりで求めた値だけを渡す） */
export interface FieldMapState {
  hereId: string;
  me: { x: number; z: number; yaw: number };
  /** 目当てのエリア（標的の居る所・採取点の残る所など） */
  targetAreas: ReadonlySet<string>;
  /** 標的の追跡: '' = ふつう / 'sleep'・'leave' = 見えていて眠り・移動中 / 'marked' = 印 / 'last_seen' / 'unknown' / 'dead' */
  tState: string;
  /** 最後に見た所（? を付ける） */
  seenId: string | null;
  /** 位置が分かっている標的（見えている・印の時だけ） */
  target: { areaId: string; x: number; z: number } | null;
}

/**
 * 全体の地図の重ね（右上の地図を押す・M キーで開き、もう一度で閉じる）。開いていても狩りは止まらず、操作もそのまま効く
 * （重ねは指を受けない。2G でも地図を出したまま動ける）
 */
export class FieldMapOverlay {
  readonly root: HTMLDivElement;
  private readonly box: SVGSVGElement;
  private layer: SVGGElement;
  private readonly me: SVGPathElement;
  private readonly target: SVGCircleElement;
  private layout: FieldMapLayout | null = null;
  private fieldKey = '';
  private areaEls = new Map<string, { path: SVGPathElement; label: SVGTextElement }>();
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'field-map';
    this.root.hidden = true;
    parent.appendChild(this.root);
    const title = document.createElement('div');
    title.className = 'field-map-title';
    this.root.appendChild(title);
    this.box = svg('svg', this.root, { class: 'field-map-svg', 'aria-label': '全体の地図' });
    this.layer = svg('g', this.box);
    this.target = svg('circle', this.box, { class: 'tgt', r: 5, cx: -20, cy: -20 });
    this.me = svg('path', this.box, { class: 'me', d: 'M0,-8 L5.5,6 L0,3.4 L-5.5,6 Z' });
    const note = document.createElement('div');
    note.className = 'field-map-note';
    note.textContent = '太い線: 大型も通る道　細い線: 人だけ　? = 最後に見た所　（右上の地図をもう一度押すか M で閉じる）';
    this.root.appendChild(note);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  toggle(field: FieldDef | null): void {
    if (this.open || !field) {
      this.close();
      return;
    }
    this.build(field);
    this.root.hidden = false;
  }

  /** 画面の広さに合わせて作り直す（フィールドが変わった時・開く時） */
  private build(field: FieldDef): void {
    const w = Math.max(240, Math.min(window.innerWidth * 0.92, 980));
    const h = Math.max(160, Math.min(window.innerHeight * 0.78, 640));
    const key = `${field.id}:${Math.round(w)}x${Math.round(h)}`;
    (this.root.querySelector('.field-map-title') as HTMLElement).textContent = field.name;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.last = '';
    const L = fieldMapLayout(field, w, h);
    this.layout = L;
    this.box.setAttribute('width', L.width.toFixed(0));
    this.box.setAttribute('height', L.height.toFixed(0));
    this.box.setAttribute('viewBox', `0 0 ${L.width.toFixed(1)} ${L.height.toFixed(1)}`);
    this.layer.textContent = '';
    this.areaEls.clear();
    const f1 = (v: number): string => v.toFixed(1);
    for (const k of L.links) svg('line', this.layer, { class: k.large ? 'link' : 'link thin', x1: f1(k.x0), y1: f1(k.y0), x2: f1(k.x1), y2: f1(k.y1) });
    for (const a of L.areas) {
      const path = svg('path', this.layer, { class: `area ${a.kind}`, d: `M${a.outline.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L')}Z` });
      path.dataset.area = a.id;
      for (const e of a.exits) svg('circle', this.layer, { class: 'exit', cx: f1(e.x), cy: f1(e.y), r: 2.6 });
    }
    for (const a of L.areas) {
      const label = svg('text', this.layer, { class: 'label', x: f1(a.center[0]), y: f1(a.center[1] + 5) });
      label.textContent = a.label;
      label.dataset.area = a.id;
      this.areaEls.set(a.id, { path: this.layer.querySelector(`path[data-area="${a.id}"]`) as SVGPathElement, label });
    }
  }

  /** 開いている間、毎フレーム: 自分・標的・エリアの印 */
  update(field: FieldDef | null, st: FieldMapState): void {
    if (!this.open || !field) return;
    this.build(field);
    const L = this.layout;
    if (!L) return;
    const marks = `${st.hereId}|${[...st.targetAreas].join(',')}|${st.tState}|${st.seenId ?? ''}`;
    if (marks !== this.last) {
      this.last = marks;
      for (const [id, el] of this.areaEls) {
        for (const e of [el.path, el.label]) {
          e.classList.toggle('here', id === st.hereId);
          e.classList.toggle('target', st.targetAreas.has(id));
          e.classList.toggle('marked', st.targetAreas.has(id) && st.tState === 'marked');
          e.classList.toggle('asleep', st.targetAreas.has(id) && st.tState === 'sleep');
          e.classList.toggle('seen', id === st.seenId);
        }
        el.label.textContent = (field.areas.find((a) => a.id === id)?.kind === 'camp' ? '営' : String(field.areas.find((a) => a.id === id)?.no ?? '')) + (id === st.seenId ? '?' : '');
      }
    }
    const [mx, my] = L.toMap(st.hereId, st.me.x, st.me.z);
    const rot = ((((-st.me.yaw * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
    this.me.setAttribute('transform', `translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${Math.round(rot)})`);
    if (st.target) {
      const [tx, ty] = L.toMap(st.target.areaId, st.target.x, st.target.z);
      this.target.setAttribute('cx', tx.toFixed(1));
      this.target.setAttribute('cy', ty.toFixed(1));
      this.target.style.display = '';
      this.target.classList.toggle('marked', st.tState === 'marked');
    } else this.target.style.display = 'none';
  }
}
