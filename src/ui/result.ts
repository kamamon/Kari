// 依頼の結果。simulation が確定した結果を表示するだけで、ここでは何も加算しない。
import type { Simulation } from '../game/sim';

export interface ResultHost {
  toBase(): void;
  retry(): void;
}

const REASON: Record<string, string> = {
  slay: '討伐に成功しました。',
  time: '制限時間を過ぎました。',
  faints: '力尽きた回数が上限に達しました。',
  retire: 'リタイアしました。',
};

export class ResultScreen {
  readonly root: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;

  constructor(parent: HTMLElement, host: ResultHost) {
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
    card.append(this.title, this.body, row);
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

  show(sim: Simulation): void {
    const h = sim.hunt!;
    const m = sim.monsters[0];
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
      ['依頼', h.quest.name],
      ['結果', REASON[h.reason ?? ''] ?? ''],
      ['かかった時間', `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`],
      ['力尽きた回数', `${h.faints} / ${h.quest.maxFaints}`],
      ['部位', parts.length ? parts.join('、') : 'なし'],
      ['与えたダメージ', `${sim.totalDamage}（${sim.hitCount} 回命中）`],
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
    const note = document.createElement('p');
    note.className = 'base-note';
    note.textContent = '素材の剥ぎ取りと報酬は、次の段階で追加します（いまは結果の表示だけです）。';
    this.body.append(table, note);
    this.root.hidden = false;
  }
}
