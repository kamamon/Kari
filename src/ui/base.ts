// 拠点（仮）。訓練場と依頼 1 件を選び、持ち帰った素材を確かめるだけの画面。
// 里を歩く・受付・工房・道具箱は M3 で作る。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import type { Content } from '../data/schemas';
import { canFullscreen, fullscreenHint, toggleFullscreen } from './fullscreen';

export interface BaseHost {
  startTraining(): void;
  startHunt(questId: string): void;
  /** いま装備している武器の id と、持ち替え */
  weaponId: string;
  setWeapon(id: string): void;
}

export class BaseScreen {
  readonly root: HTMLElement;
  private inv: HTMLElement;
  private weaponButtons = new Map<string, HTMLButtonElement>();
  private weaponNote: HTMLElement;

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

    // 武器選び（保存はまだ無い。工房で作る流れは M3）
    const wl = document.createElement('p');
    wl.className = 'base-weapon-label';
    wl.textContent = '武器';
    const row = document.createElement('div');
    row.className = 'base-weapons';
    for (const w of content.weapons.values()) {
      const b = document.createElement('button');
      b.className = 'base-weapon';
      b.dataset.weapon = w.id;
      b.textContent = content.families.get(w.family)?.name ?? w.name;
      b.addEventListener('click', () => {
        host.setWeapon(w.id);
        this.showWeapon(content, host.weaponId);
      });
      this.weaponButtons.set(w.id, b);
      row.appendChild(b);
    }
    this.weaponNote = document.createElement('p');
    this.weaponNote.className = 'base-weapon-note';
    card.append(wl, row, this.weaponNote);
    this.showWeapon(content, host.weaponId);

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
      const goal = q.kind === 'hunt' ? '狩猟（討伐か捕獲）' : '討伐';
      const lines = [q.summary, `目標: ${target}の${goal}　制限 ${Math.round(q.timeLimitTicks / 3600)} 分　力尽き ${q.maxFaints} 回で失敗`];
      if (q.supplies?.length) lines.push(`支給品: ${q.supplies.map((s) => `${content.items.get(s.itemId)?.name ?? s.itemId} ×${s.count}`).join('　')}`);
      if (q.rewards) lines.push(`報酬: ${q.rewards.money} 通貨 + 素材`);
      choice(`依頼「${q.name}」`, lines, () => host.startHunt(q.id));
    }
    choice('訓練場', ['動かない標的で、操作と技を確かめる。'], () => host.startTraining());

    // 持ち物（保存はまだ無い）
    this.inv = document.createElement('p');
    this.inv.className = 'base-inv';
    card.appendChild(this.inv);

    const note = document.createElement('p');
    note.className = 'base-note';
    note.textContent = `v${APP_VERSION} (${BUILD_ID}) ／ 見た目・動き・音は仮素材。持ち物の保存・工房・里を歩く画面は、これから追加します（いまはページを閉じると持ち物が消えます）。`;
    card.appendChild(note);
    // 画面を広く使う方法: 全画面にできる端末はボタン、iPhone は「ホーム画面に追加」の案内
    if (canFullscreen() && window.matchMedia('(pointer: coarse)').matches) {
      const fs = document.createElement('button');
      fs.className = 'base-fs';
      fs.textContent = '全画面にする';
      fs.addEventListener('click', () => void toggleFullscreen().then((on) => (fs.textContent = on ? '全画面をやめる' : '全画面にする')));
      card.appendChild(fs);
    } else {
      const hint = fullscreenHint();
      if (hint) {
        const p = document.createElement('p');
        p.className = 'base-hint';
        p.textContent = hint;
        card.appendChild(p);
      }
    }
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

  private showWeapon(content: Content, id: string): void {
    for (const [wid, b] of this.weaponButtons) b.classList.toggle('on', wid === id);
    const w = content.weapons.get(id);
    const fam = w ? content.families.get(w.family) : undefined;
    this.weaponNote.textContent = w && fam ? `${w.name}: ${fam.summary ?? ''}` : '';
  }

  /** 持ち物の表示を更新する */
  refresh(inventory: readonly string[]): void {
    this.inv.textContent = `持ち物: ${inventory.join('　')}`;
  }
}
