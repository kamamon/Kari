// 拠点（仮）。武器を選び、依頼か訓練場へ出る。持ち物を確かめ、工房で強化し、データを書き出す / 取り込む。
// 里を歩く・受付・道具箱は、これから作る。
//
// 持ち物・装備の表示は、保存の管理役（SaveManager）が持つ「書き込みが完了した内容」だけを映す。
// 強化・取り込みなどの結果は、書き込みが完了してから表示する（押した時点では「保存しています…」）。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import type { Content, RecipeDef } from '../data/schemas';
import { checkCraft, parseImport, unknownIds, usableWeapons } from '../save/profile';
import type { SaveManager, SaveResult } from '../save/saveManager';
import { canFullscreen, fullscreenHint, toggleFullscreen } from './fullscreen';

export interface BaseHost {
  startTraining(): void;
  startHunt(questId: string): void;
  /** いま持たせている武器の id と、持ち替え（保存が完了してから替わる） */
  weaponId: string;
  setWeapon(id: string): Promise<SaveResult>;
  readonly save: SaveManager;
  /** 強化などで装備が変わったかもしれない時に、後ろに見えているハンターを作り直す */
  saveChanged(): void;
  /** 保存できていない報酬の数と、保存のやり直し */
  unsavedRewards(): number;
  retryUnsaved(): Promise<SaveResult>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const when = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const BACKUP_REASON: Record<string, string> = {
  session: '前回までの内容',
  import: '取り込む前の内容',
  restore: '控えから戻す前の内容',
  migrate: '古い形のデータ',
  reset: '読めなかったデータ',
};

export class BaseScreen {
  readonly root: HTMLElement;
  private banners: HTMLElement;
  private weaponRow: HTMLElement;
  private weaponNote: HTMLElement;
  private inv: HTMLElement;
  private forge: HTMLDetailsElement;
  private forgeBody: HTMLElement;
  private data: HTMLDetailsElement;
  private dataBody: HTMLElement;
  /** 画面の下に出す、直前の操作の結果 */
  private message: HTMLElement;
  private busy = false;
  /** 強化の確認を出しているレシピ */
  private confirming: string | null = null;
  /** 取り込む前の確認に出している内容 */
  private pendingImport: string | null = null;

  constructor(
    parent: HTMLElement,
    private content: Content,
    private host: BaseHost,
  ) {
    const root = el('div');
    root.id = 'base';
    root.hidden = true;
    const card = el('div', 'base-card');
    card.append(el('h2', undefined, '灯継ぎの里'));
    this.banners = el('div', 'base-banners');
    card.append(this.banners, el('p', 'base-lead', '行き先を選んでください。'));

    card.append(el('p', 'base-weapon-label', '武器'));
    this.weaponRow = el('div', 'base-weapons');
    this.weaponNote = el('p', 'base-weapon-note');
    card.append(this.weaponRow, this.weaponNote);

    const choice = (title: string, lines: string[], onClick: () => void): void => {
      const b = el('button', 'base-choice');
      b.appendChild(el('b', undefined, title));
      for (const line of lines) b.appendChild(el('span', undefined, line));
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

    this.inv = el('div', 'base-inv');
    card.appendChild(this.inv);

    this.forge = el('details', 'base-section');
    this.forge.id = 'base-forge';
    this.forge.appendChild(el('summary', undefined, '工房'));
    this.forgeBody = el('div');
    this.forge.appendChild(this.forgeBody);
    card.appendChild(this.forge);

    this.data = el('details', 'base-section');
    this.data.id = 'base-data';
    this.data.appendChild(el('summary', undefined, 'データ（書き出し・取り込み）'));
    this.dataBody = el('div');
    this.data.appendChild(this.dataBody);
    this.data.addEventListener('toggle', () => {
      if (this.data.open) this.renderData();
    });
    card.appendChild(this.data);

    this.message = el('p', 'base-message');
    this.message.setAttribute('role', 'status');
    card.appendChild(this.message);

    card.appendChild(el('p', 'base-note', `v${APP_VERSION} (${BUILD_ID}) ／ 見た目・動き・音は仮素材。里を歩く画面・道具の補充・防具は、これから追加します。`));
    // 画面を広く使う方法: 全画面にできる端末はボタン、iPhone は「ホーム画面に追加」の案内
    if (canFullscreen() && window.matchMedia('(pointer: coarse)').matches) {
      const fs = el('button', 'base-fs', '全画面にする');
      fs.addEventListener('click', () => void toggleFullscreen().then((on) => (fs.textContent = on ? '全画面をやめる' : '全画面にする')));
      card.appendChild(fs);
    } else {
      const hint = fullscreenHint();
      if (hint) card.appendChild(el('p', 'base-hint', hint));
    }
    root.appendChild(card);
    parent.appendChild(root);
    this.root = root;
    host.save.onChange(() => {
      if (this.open) this.refresh();
    });
    this.refresh();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (open) this.refresh();
  }

  private say(text: string, bad = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('bad', bad);
  }

  /** 保存を伴う操作。終わるまで、ほかの操作を受け付けない。結果は書き込みが完了してから表示する。 */
  private async run(label: string, op: () => Promise<SaveResult>, done: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.root.classList.add('busy');
    this.say(`${label}…`);
    let r: SaveResult;
    try {
      r = await op();
    } catch (e) {
      r = { ok: false, reason: 'failed', message: `保存できませんでした（${e instanceof Error ? e.message : String(e)}）。` };
    }
    this.busy = false;
    this.root.classList.remove('busy');
    this.say(r.ok ? done : `${r.message}${r.errors?.length ? `（${r.errors.slice(0, 3).join('、')}）` : ''}`, !r.ok);
    this.refresh();
    return r.ok;
  }

  /** 表示を、いまの保存データに合わせる */
  refresh(): void {
    const save = this.host.save;
    const doc = save.doc;
    const c = this.content;

    // 知らせ
    this.banners.textContent = '';
    if (save.notice) this.banners.appendChild(el('p', 'base-banner', save.notice));
    const unsaved = this.host.unsavedRewards();
    if (unsaved > 0) {
      const p = el('p', 'base-banner bad', `保存できていない報酬が ${unsaved} 回分あります。ページを閉じると無くなります。`);
      const b = el('button', undefined, '保存する');
      b.addEventListener('click', () => void this.run('保存しています', () => this.host.retryUnsaved(), '報酬を保存しました。'));
      p.appendChild(b);
      this.banners.appendChild(p);
    }

    if ([...c.recipes.values()].some((r) => checkCraft(doc, r).ok)) this.banners.appendChild(el('p', 'base-banner', '強化できる武器があります（下の「工房」）。'));

    // 武器（持っていて、この版で使えるもの）
    this.weaponRow.textContent = '';
    const current = this.host.weaponId;
    for (const id of usableWeapons(doc, c)) {
      const w = c.weapons.get(id)!;
      const b = el('button', 'base-weapon', c.families.get(w.family)?.name ?? w.name);
      b.dataset.weapon = id;
      b.classList.toggle('on', id === current);
      b.addEventListener('click', () => {
        if (id === this.host.weaponId) return;
        void this.run('持ち替えています', () => this.host.setWeapon(id), '');
      });
      this.weaponRow.appendChild(b);
    }
    const w = c.weapons.get(current);
    const fam = w ? c.families.get(w.family) : undefined;
    this.weaponNote.textContent = w && fam ? `${w.name}（攻撃力 ${w.attack}）: ${fam.summary ?? ''}` : '';

    // 持ち物
    this.inv.textContent = '';
    const known = Object.entries(doc.items).filter(([id, n]) => n > 0 && c.materials.has(id));
    const items = known.map(([id, n]) => `${c.materials.get(id)!.name} ×${n}`);
    this.inv.appendChild(el('p', undefined, `持ち物: 通貨 ${doc.money}　${items.length ? items.join('　') : '素材はまだ無い'}`));
    const unk = unknownIds(doc, c);
    if (unk.items.length + unk.weapons.length > 0) {
      this.inv.appendChild(el('p', 'base-unknown', `この版では使えないもの（消さずに持っています）: ${[...unk.items.map((id) => `${id} ×${doc.items[id]}`), ...unk.weapons].join('　')}`));
    }
    const state = save.mode === 'persistent' ? (doc.revision > 0 ? `この端末に保存済み（${when(doc.updatedAt)}）` : 'まだ保存するものがありません') : '保存されません（ページを閉じると最初に戻ります）';
    this.inv.appendChild(el('p', 'base-save-state', state));

    this.renderForge();
    if (this.data.open) this.renderData();
  }

  private renderForge(): void {
    const c = this.content;
    const doc = this.host.save.doc;
    this.forgeBody.textContent = '';
    let ready = 0;
    let shown = 0;
    // 並べる順: いま装備している武器 → 強化できるもの → まだのもの → 強化済み
    const equipped = this.host.weaponId;
    const rank = (r: RecipeDef): number => {
      const chk = checkCraft(doc, r);
      if (r.fromWeaponId === equipped || r.resultWeaponId === equipped) return 0;
      return chk.ok ? 1 : chk.ownsResult ? 3 : 2;
    };
    const recipes = [...c.recipes.values()].sort((x, y) => rank(x) - rank(y));
    for (const r of recipes) {
      const from = c.weapons.get(r.fromWeaponId)!;
      const to = c.weapons.get(r.resultWeaponId)!;
      const chk = checkCraft(doc, r);
      if (!chk.ownsBase && !chk.ownsResult) continue;
      shown++;
      const box = el('div', 'forge-recipe');
      box.dataset.recipe = r.id;
      box.appendChild(el('b', undefined, `${from.name} → ${to.name}`));
      box.appendChild(el('span', 'forge-stat', `攻撃力 ${from.attack} → ${to.attack}`));
      if (chk.ownsResult) {
        box.appendChild(el('p', 'forge-done', '強化済みです。'));
        this.forgeBody.appendChild(box);
        continue;
      }
      const ul = el('ul', 'forge-cost');
      for (const i of chk.items) {
        const li = el('li', i.have >= i.need ? undefined : 'short', `${c.materials.get(i.itemId)?.name ?? i.itemId} ${i.have} / ${i.need}`);
        ul.appendChild(li);
      }
      ul.appendChild(el('li', chk.money.have >= chk.money.need ? undefined : 'short', `通貨 ${chk.money.have} / ${chk.money.need}`));
      box.appendChild(ul);
      if (chk.ok) ready++;
      if (this.confirming === r.id && chk.ok) {
        const p = el('p', 'forge-confirm', `素材と通貨を使って、${from.name}を${to.name}に変えます。元には戻せません。`);
        const yes = el('button', 'go', '強化する');
        yes.addEventListener('click', () => {
          this.confirming = null;
          void this.run('強化しています', () => this.host.save.craft(r.id), `${to.name}に強化しました。`).then((ok) => {
            if (ok) this.host.saveChanged();
          });
        });
        const no = el('button', undefined, 'やめる');
        no.addEventListener('click', () => {
          this.confirming = null;
          this.refresh();
        });
        p.append(yes, no);
        box.appendChild(p);
      } else {
        const b = el('button', 'go', chk.ok ? '強化する' : '素材か通貨が足りません');
        b.disabled = !chk.ok;
        b.addEventListener('click', () => {
          this.confirming = r.id;
          this.refresh();
        });
        box.appendChild(b);
      }
      this.forgeBody.appendChild(box);
    }
    if (shown === 0) this.forgeBody.appendChild(el('p', 'base-note', 'いま強化できる武器はありません。'));
    this.forge.querySelector('summary')!.textContent = ready > 0 ? `工房（強化できます: ${ready}）` : '工房';
  }

  private renderData(): void {
    const save = this.host.save;
    const body = this.dataBody;
    body.textContent = '';
    const lines =
      save.mode === 'persistent'
        ? ['持ち物・装備・進行は、この端末のブラウザの中に保存しています。', `ブラウザのデータを消したり、長く使わないでいると、端末の側で消されることがあります${save.persisted ? '（このブラウザは「消されにくい保存」を認めています）' : ''}。大事な時は、書き出して手元に残してください。`]
        : save.mode === 'memory'
          ? ['この端末では保存できません。ページを閉じると最初に戻ります。書き出しておくと、保存できる端末で取り込めます。']
          : ['この端末にあるデータを読めないため、今回の内容は保存されません。「書き出す」と、読めなかったデータがそのまま出ます。'];
    for (const l of lines) body.appendChild(el('p', 'base-note', l));

    const row = el('div', 'data-actions');
    const exp = el('button', undefined, 'ファイルに書き出す');
    exp.addEventListener('click', () => {
      try {
        const text = save.exportText();
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `veilbound-hunters-save-r${save.doc.revision}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        this.say('書き出しました（ファイルの保存先は、ブラウザのダウンロード先です）。');
      } catch (e) {
        this.say(`書き出せませんでした（${e instanceof Error ? e.message : String(e)}）。「コピーする」を試してください。`, true);
      }
    });
    const copy = el('button', undefined, 'コピーする');
    copy.addEventListener('click', () => {
      const text = save.exportText();
      void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('clipboard'))).then(
        () => this.say('コピーしました。メモなどへ貼り付けて残してください。'),
        () => {
          // コピーできない時は、選べる形で出す
          area.value = text;
          this.say('コピーできませんでした。下の欄に出したので、長押しで選んでコピーしてください。', true);
        },
      );
    });
    row.append(exp, copy);
    body.appendChild(row);

    body.appendChild(el('p', 'base-weapon-label', '取り込む（書き出したファイルを選ぶか、内容を貼り付ける）'));
    const file = el('input');
    file.type = 'file';
    file.accept = '.json,application/json,text/plain';
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then(
        (t) => this.previewImport(t),
        () => this.say('ファイルを読めませんでした。', true),
      );
    });
    const area = el('textarea', 'data-paste');
    area.rows = 3;
    area.placeholder = 'ここへ貼り付け';
    const paste = el('button', undefined, '貼り付けた内容を確かめる');
    paste.addEventListener('click', () => this.previewImport(area.value));
    body.append(file, area, paste);

    if (this.pendingImport !== null) {
      const r = parseImport(this.pendingImport);
      if (r.kind === 'ok') {
        const text = this.pendingImport;
        const d = r.doc;
        const p = el('p', 'forge-confirm', `取り込む内容: 通貨 ${d.money}、素材 ${Object.values(d.items).reduce((a, b) => a + b, 0)} 個、武器 ${d.weapons.length}、保存 ${when(d.updatedAt)}。いまの持ち物と装備を、これに入れ替えます（いまの内容は控えに残ります）。`);
        const yes = el('button', 'go', '入れ替える');
        yes.addEventListener('click', () => {
          this.pendingImport = null;
          void this.run('取り込んでいます', () => save.importText(text), '取り込みました。').then((ok) => {
            if (ok) this.host.saveChanged();
          });
        });
        const no = el('button', undefined, 'やめる');
        no.addEventListener('click', () => {
          this.pendingImport = null;
          this.renderData();
        });
        p.append(yes, no);
        body.appendChild(p);
      }
    }

    if (save.mode === 'readonly') {
      const p = el('p', 'forge-confirm', '読めなかったデータを控えへ移して、いまの内容で保存を始めることもできます（読めなかったデータは消しません）。');
      const b = el('button', undefined, '控えへ移して、保存を始める');
      b.addEventListener('click', () => void this.run('保存しています', () => save.resetUnreadable(), '保存を始めました。'));
      p.appendChild(b);
      body.appendChild(p);
    }

    const list = el('div', 'data-backups');
    body.appendChild(list);
    void save.backups().then((bs) => {
      list.textContent = '';
      if (bs.length === 0) return;
      list.appendChild(el('p', 'base-weapon-label', '控え（新しい順）'));
      for (const b of bs) {
        const r = parseImport(JSON.stringify(b.doc));
        const row2 = el('p', 'data-backup');
        const info = r.kind === 'ok' ? `通貨 ${r.doc.money}、素材 ${Object.values(r.doc.items).reduce((a, x) => a + x, 0)} 個` : 'この版では読めません';
        row2.appendChild(el('span', undefined, `${when(b.savedAt)}　${BACKUP_REASON[b.reason] ?? b.reason}（${info}）`));
        if (r.kind === 'ok' && save.mode !== 'readonly') {
          const btn = el('button', undefined, 'これに戻す');
          btn.addEventListener('click', () => {
            void this.run('戻しています', () => save.restoreBackup(b.id), '控えの内容に戻しました。').then((ok) => {
              if (ok) this.host.saveChanged();
            });
          });
          row2.appendChild(btn);
        }
        list.appendChild(row2);
      }
    });
  }

  private previewImport(text: string): void {
    const r = parseImport(text);
    if (r.kind === 'ok') {
      this.pendingImport = text;
      this.say('内容を確かめました。下の「入れ替える」で取り込みます。');
    } else {
      this.pendingImport = null;
      this.say(r.kind === 'newer' ? '新しい版で書き出したデータです。この版では取り込めません。' : `取り込めません（${r.errors.slice(0, 3).join('、')}）。`, true);
    }
    this.renderData();
  }
}
