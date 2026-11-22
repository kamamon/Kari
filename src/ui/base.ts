// 拠点（仮）。M2 前半は、訓練場と依頼 1 件を選ぶだけの画面。
// 里を歩く・受付・工房・道具箱は M3 で作る。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import type { Content } from '../data/schemas';

export interface BaseHost {
  startTraining(): void;
  startHunt(questId: string): void;
}

export class BaseScreen {
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, content: Content, host: BaseHost) {
    const root = document.createElement('div');
    root.id = 'base';
    root.hidden = true;
    const card = document.createElement('div');
    card.className = 'base-card';
    const h = document.createElement('h2');
    h.textContent = '灯継ぎの里';
    const lead = document.createElement('p');
    lead.className = 'base-lead';
    lead.textContent = '行き先を選んでください。';
    card.append(h, lead);

    const choice = (title: string, lines: string[], onClick: () => void): void => {
      const b = document.createElement('button');
      b.className = 'base-choice';
      const t = document.createElement('b');
      t.textContent = title;
      b.appendChild(t);
      for (const line of lines) {
        const s = document.createElement('span');
        s.textContent = line;
        b.appendChild(s);
      }
      b.addEventListener('click', onClick);
      card.appendChild(b);
    };
    for (const q of content.quests.values()) {
      const target = content.monsters.get(q.targetMonsterId)?.name ?? '';
      choice(`依頼「${q.name}」`, [q.summary, `目標: ${target}の討伐　制限 ${Math.round(q.timeLimitTicks / 3600)} 分　力尽き ${q.maxFaints} 回で失敗`], () => host.startHunt(q.id));
    }
    choice('訓練場', ['動かない標的で、操作と技を確かめる。'], () => host.startTraining());

    const note = document.createElement('p');
    note.className = 'base-note';
    note.textContent = `v${APP_VERSION} (${BUILD_ID}) ／ 見た目・動き・音は仮素材。回復の道具・素材の剥ぎ取り・捕獲・工房・セーブは、これから追加します。`;
    card.appendChild(note);
    root.appendChild(card);
    parent.appendChild(root);
    this.root = root;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
  }
}
