// 依頼の結果。simulation が確定した結果（成否・素材・報酬）を表示するだけで、ここでは何も決めない。
// 持ち物への加算は App が依頼 1 回につき一度だけ行う（結果画面を何度開いても増えない）。
import type { Simulation } from '../game/sim';
import { counterOf, shortName } from './targets';
import { withIcon } from './icons';
import { starLabel } from '../data/questBoard';
import { errandProgress } from '../game/errand';

export interface ResultHost {
  toBase(): void;
  retry(): void;
  /** 保存できなかった報酬を、もう一度保存する */
  retryUnsaved(): Promise<unknown>;
}

/** 報酬の保存の状態。持ち物へ入ったと言えるのは saved になってから */
export interface RewardSaveState {
  state: 'none' | 'saving' | 'saved' | 'failed';
  text: string;
}

const REASON: Record<string, string> = {
  slay: '討伐に成功しました。',
  deliver: '納品しました。',
  capture: '捕獲に成功しました。',
  time: '制限時間を過ぎました。',
  faints: '力尽きた回数が上限に達しました。',
  retire: 'リタイアしました。',
};

export class ResultScreen {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private saveLine: HTMLElement;

  constructor(
    parent: HTMLElement,
    private host: ResultHost,
  ) {
    const root = document.createElement('div');
    root.id = 'result';
    root.hidden = true;
    const card = document.createElement('div');
    card.className = 'base-card';
    this.title = document.createElement('h2');
    this.body = document.createElement('div');
    this.body.className = 'result-body';
    const row = document.createElement('div');
    row.className = 'result-actions';
    const again = document.createElement('button');
    again.className = 'sub';
    again.textContent = 'もう一度';
    again.addEventListener('click', () => host.retry());
    const back = document.createElement('button');
    back.textContent = '拠点へ戻る';
    back.addEventListener('click', () => host.toBase());
    row.append(again, back);
    this.saveLine = document.createElement('p');
    this.saveLine.className = 'result-save';
    this.saveLine.setAttribute('role', 'status');
    card.append(this.title, this.body, this.saveLine, row);
    root.appendChild(card);
    parent.appendChild(root);
    this.root = root;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** 報酬の保存の状態を出す（保存が完了・失敗した時にも呼ばれる） */
  setSaveState(s: RewardSaveState): void {
    this.saveLine.textContent = s.text;
    this.saveLine.dataset.state = s.state;
    this.saveLine.hidden = s.state === 'none';
    if (s.state === 'failed') {
      const b = document.createElement('button');
      b.textContent = 'もう一度保存する';
      b.addEventListener('click', () => {
        b.disabled = true;
        void this.host.retryUnsaved();
      });
      this.saveLine.appendChild(b);
    }
  }

  show(sim: Simulation, save: RewardSaveState): void {
    this.setSaveState(save);
    const h = sim.hunt!;
    const m = sim.main;
    this.root.classList.toggle('failed', h.phase === 'failed');
    this.title.textContent = h.phase === 'success' ? '依頼達成' : '依頼失敗';
    const sec = Math.floor(h.ticks / 60);
    const parts: string[] = [];
    if (m) {
      m.def.parts.forEach((d, i) => {
        if (m.parts[i]!.severed) parts.push(`${d.name}を切断`);
        else if (m.parts[i]!.broken) parts.push(`${d.name}を破壊`);
      });
    }
    const rows: [string, string][] = [
      ['依頼', `${starLabel(h.quest)}${sim.rank ? `【${sim.rank.name}】` : ''}${h.quest.name}`],
      ['結果', REASON[h.reason ?? ''] ?? ''],
      ['かかった時間', `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`],
      ['力尽きた回数', `${h.faints} / ${h.quest.maxFaints}`],
      ...(sim.errand
        ? [['採ったもの', errandProgress(sim.errand).map((p) => `${sim.content.materials.get(p.itemId)?.name ?? p.itemId} ${p.have}（要る数 ${p.need}）`).join('　')] as [string, string]]
        : sim.pack
          ? [['討伐', sim.targets.map((t) => `${shortName(sim.content.monsters.get(t.monsterId)?.name ?? '')} ${sim.slain(t.monsterId)} ${counterOf(t.monsterId)}（目標 ${t.count}）`).join('　')] as [string, string]]
          : [['部位', parts.length ? parts.join('、') : 'なし'] as [string, string]]),
      ...(sim.errand ? [] : [['与えたダメージ', `${sim.totalDamage}（${sim.hitCount} 回命中）`] as [string, string]]),
    ];
    this.body.textContent = '';
    const table = document.createElement('table');
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = k;
      const td = document.createElement('td');
      td.textContent = v;
      tr.append(th, td);
      table.appendChild(tr);
    }
    this.body.append(table);
    const rw = h.rewards;
    if (h.phase === 'success' && rw) {
      const SOURCE: Record<string, string> = { carve: '剥ぎ取り', capture: '捕獲', quest: '依頼の報酬', gather: '納品の余り（持ち帰り）' };
      const label = (src: string): string => {
        if (SOURCE[src]) return SOURCE[src]!;
        const [kind, partId] = src.split(':');
        // 倒した幼体の剥ぎ取り（carve:<種の id>）
        if (kind === 'carve') return `${shortName(sim.content.monsters.get(partId ?? '')?.name ?? partId ?? '')}の剥ぎ取り`;
        const part = m?.def.parts.find((d) => d.id === partId)?.name ?? partId ?? '';
        return kind === 'break' ? `${part}の破壊` : `${part}の剥ぎ取り`;
      };
      const box = document.createElement('div');
      box.className = 'result-loot';
      const head = document.createElement('h3');
      head.textContent = `報酬　${rw.money} 通貨　素材 ${h.loot.length} 個`;
      const ul = document.createElement('ul');
      // 同じ素材・同じ入手元をまとめて表示する
      const rows2 = new Map<string, number>();
      for (const g of h.loot) rows2.set(`${g.itemId}|${g.source}`, (rows2.get(`${g.itemId}|${g.source}`) ?? 0) + 1);
      for (const [key, n] of rows2) {
        const [itemId, src] = key.split('|');
        const li = document.createElement('li');
        withIcon(li, itemId!, `${sim.content.materials.get(itemId!)?.name ?? itemId} ×${n}`);
        const sp = document.createElement('span');
        sp.textContent = label(src!);
        li.appendChild(sp);
        ul.appendChild(li);
      }
      box.append(head, ul);
      this.body.append(box);
    } else if (h.phase === 'failed') {
      const note = document.createElement('p');
      note.className = 'base-note';
      note.textContent = '失敗・リタイアでは、報酬と素材は出ません。';
      this.body.append(note);
    }
    this.root.hidden = false;
  }
}
