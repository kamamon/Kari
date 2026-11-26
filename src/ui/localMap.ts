// 居るエリアの地図（v0.42.0。#19 の F04。docs/spec.md の 32.7）。
// エリアの外周・岩・段・出口（行き先の番号）・自分の位置と向き・見えている標的を、上から見た向きで描く。
// 向き: 北（+Z）が上。上から見ているので、+X は左（前を上にした時、地図の右 = 画面の右。入力の「右 = (-cos, sin)」と同じ）。
// データと simulation の状態を読むだけで、値を書き戻さない。

import type { FieldAreaDef, FieldDef } from '../data/schemas';

const NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, parent: Element, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** 世界の (x, z) → 地図の (px, py)。上から見た向き（+Z が上、+X が左） */
export interface MapFrame {
  toMap(x: number, z: number): [number, number];
  /** 向き（yaw）→ 地図の上で回す角度（度。時計回りが正）。前 = (sin yaw, cos yaw) */
  rotation(yaw: number): number;
}

/** エリアを w × h（px）に、縦横比を保って収める。余白は pad */
export function areaFrame(area: FieldAreaDef, w: number, h: number, pad = 6): MapFrame {
  const b = area.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const s = Math.min((w - pad * 2) / Math.max(1, b.maxX - b.minX), (h - pad * 2) / Math.max(1, b.maxZ - b.minZ));
  return {
    toMap: (x, z) => [w / 2 - (x - cx) * s, h / 2 - (z - cz) * s],
    // -180〜180 に収める（向きの値は 1 周を超えることがある）
    rotation: (yaw) => ((((-yaw * 180) / Math.PI + 180) % 360) + 360) % 360 - 180,
  };
}

export class LocalMap {
  readonly root: SVGSVGElement;
  private layer: SVGGElement;
  private resources: SVGGElement;
  private lastResources='';
  private me: SVGPathElement;
  private target: SVGCircleElement;
  private frame: MapFrame | null = null;
  private areaId = '';
  private lastMe = '';
  private lastTarget = '';

  constructor(parent: HTMLElement, readonly width = 92, readonly height = 66) {
    this.root = svg('svg', parent, { class: 'hud-local', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
    this.layer = svg('g', this.root);
    this.resources=svg('g',this.root);
    this.target = svg('circle', this.root, { class: 'tgt', r: 3.4, cx: -10, cy: -10 });
    this.target.style.display = 'none';
    // 自分: 先の尖った矢じり（上を向いた形を、向きに合わせて回す）
    this.me = svg('path', this.root, { class: 'me', d: 'M0,-5.2 L3.6,4 L0,2.2 L-3.6,4 Z' });
  }

  /** エリアが変わった時に描き直す（無ければ空） */
  setArea(field: FieldDef | null, area: FieldAreaDef | null): void {
    const id = area ? `${field?.id}:${area.id}` : '';
    if (id === this.areaId) return;
    this.areaId = id;
    this.layer.textContent = '';
    this.resources.textContent='';this.lastResources='';
    this.lastMe = '';
    this.lastTarget = '';
    this.target.style.display = 'none';
    this.frame = area ? areaFrame(area, this.width, this.height) : null;
    if (!field || !area || !this.frame) return;
    const f = this.frame;
    const pts = area.shape?.length ? area.shape : [[area.bounds.minX, area.bounds.minZ], [area.bounds.maxX, area.bounds.minZ], [area.bounds.maxX, area.bounds.maxZ], [area.bounds.minX, area.bounds.maxZ]] as [number, number][];
    svg('path', this.layer, { class: 'outline', d: `M${pts.map(([x, z]) => f.toMap(x, z).map((v) => v.toFixed(1)).join(',')).join('L')}Z` });
    for (const p of area.platforms) {
      const [x0, y0] = f.toMap(p.maxX, p.maxZ);
      const [x1, y1] = f.toMap(p.minX, p.minZ);
      svg('rect', this.layer, { class: 'plat', x: x0.toFixed(1), y: y0.toFixed(1), width: (x1 - x0).toFixed(1), height: (y1 - y0).toFixed(1) });
    }
    const s = Math.abs(f.toMap(1, 0)[0] - f.toMap(0, 0)[0]);
    for (const r of area.rocks) {
      const [x, y] = f.toMap(r.x, r.z);
      svg('circle', this.layer, { class: 'rock', cx: x.toFixed(1), cy: y.toFixed(1), r: Math.max(1.2, r.r * s).toFixed(1) });
    }
    // 出口: 行き先の番号（野営地は「営」）を、中心から外へ少し出した所に
    const [mx, my] = f.toMap(area.center?.x ?? (area.bounds.minX + area.bounds.maxX) / 2, area.center?.z ?? (area.bounds.minZ + area.bounds.maxZ) / 2);
    for (const e of area.exits) {
      const to = field.areas.find((a) => a.id === e.to);
      const [x, y] = f.toMap(e.x, e.z);
      const d = Math.hypot(x - mx, y - my) || 1;
      svg('circle', this.layer, { class: 'exit', cx: x.toFixed(1), cy: y.toFixed(1), r: Math.max(2, e.r * s).toFixed(1) });
      const lx = Math.min(this.width - 5, Math.max(5, x + ((x - mx) / d) * 6));
      const ly = Math.min(this.height - 2, Math.max(8, y + ((y - my) / d) * 6 + 3));
      const t = svg('text', this.layer, { class: 'exit-label', x: lx.toFixed(1), y: ly.toFixed(1) });
      t.textContent = to ? (to.kind === 'camp' ? '営' : String(to.no)) : '?';
      t.dataset.to = e.to;
    }
  }

  /** 毎フレーム: 自分の位置と向き、見えている標的（同じエリアに居る時だけ。null なら隠す） */
  setGatherNodes(nodes:readonly {id:string;x:number;z:number;kind:string;left:number}[]):void{
 const f=this.frame,key=nodes.map(n=>n.id+':'+n.left).join('|');if(key===this.lastResources)return;this.lastResources=key;this.resources.textContent='';if(!f)return;
 const colors:Record<string,string>={mine:'#6cc4ff',bone:'#e8d5ad',plant:'#8edc77',insect:'#f3cd64',fish:'#6ce7df'},labels:Record<string,string>={mine:'鉱',bone:'骨',plant:'草',insect:'虫',fish:'魚'};
 for(const n of nodes){const [x,z]=f.toMap(n.x,n.z),g=svg('g',this.resources,{opacity:n.left?1:.42});svg('circle',g,{cx:x,cy:z,r:2.9,fill:'#17212a',stroke:colors[n.kind]??'#fff','stroke-width':.65});const t=svg('text',g,{x,y:z+1.5,fill:colors[n.kind]??'#fff','text-anchor':'middle','font-size':4.4,'font-weight':700});t.textContent=labels[n.kind]??'?';}
 }
  update(x: number, z: number, yaw: number, target: { x: number; z: number } | null): void {
    const f = this.frame;
    if (!f) return;
    const [px, py] = f.toMap(x, z);
    const me = `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${Math.round(f.rotation(yaw))})`;
    if (me !== this.lastMe) {
      this.lastMe = me;
      this.me.setAttribute('transform', me);
    }
    const t = target ? f.toMap(target.x, target.z).map((v) => v.toFixed(1)).join(',') : '';
    if (t !== this.lastTarget) {
      this.lastTarget = t;
      this.target.style.display = t ? '' : 'none';
      if (target) {
        const [tx, ty] = t.split(',');
        this.target.setAttribute('cx', tx!);
        this.target.setAttribute('cy', ty!);
      }
    }
  }
}
