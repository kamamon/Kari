// 拠点（仮）。武器を選び、依頼か訓練場へ出る。持ち物を確かめ、工房で強化し、データを書き出す / 取り込む。
// 里を歩く・受付・道具箱は、これから作る。
//
// 持ち物・装備の表示は、保存の管理役（SaveManager）が持つ「書き込みが完了した内容」だけを映す。
// 強化・取り込みなどの結果は、書き込みが完了してから表示する（押した時点では「保存しています…」）。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import { recipeFrom, type Content, type RecipeDef } from '../data/schemas';
import { materialRanks } from '../data/validators';
import { fieldOf, questTimeLimitTicks } from '../game/field';
import { checkCraft, defenseOf, parseImport, questUnlocked, unknownIds, usableWeapons, wornArmor } from '../save/profile';
import type { SaveManager, SaveResult } from '../save/saveManager';
import { canFullscreen, fullscreenHint, toggleFullscreen } from './fullscreen';

export interface BaseHost {
  startTraining(): void;
  startHunt(questId: string): void;
  /** 依頼を、フィールド（エリアに分かれた狩場）で始めるか */
  readonly fieldHunts: boolean;
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
  private armorNote: HTMLElement;
  private questBox: HTMLElement;
  /** 素材ごとの、手に入るいちばん下の段階（工房で「どこから出るか」を添えるため） */
  private matRank: Map<string, number>;
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

    this.armorNote = el('p', 'base-armor-note');
    card.appendChild(this.armorNote);
    this.matRank = materialRanks(content);

    // 依頼（段階の順）と訓練場。受けられるかどうかは進行で変わるので、中身は refresh で作る
    this.questBox = el('div', 'base-quests');
    card.appendChild(this.questBox);

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

    card.appendChild(el('p', 'base-note', `v${APP_VERSION} (${BUILD_ID}) ／ 見た目・動き・音は仮素材。防具の見た目・里を歩く画面・道具の補充は、これから追加します。`));
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

    if ([...c.recipes.values()].some((r) => checkCraft(doc, r).ok)) this.banners.appendChild(el('p', 'base-banner', '強化できる装備があります（下の「工房」）。'));

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
    const worn = wornArmor(doc, c);
    this.armorNote.textContent = `防具: 防御力 ${defenseOf(doc, c)}（${worn.map((x) => x.name).join('・') || 'なし'}）`;

    this.renderQuests();

    // 持ち物
    this.inv.textContent = '';
    const known = Object.entries(doc.items).filter(([id, n]) => n > 0 && c.materials.has(id));
    const items = known.map(([id, n]) => `${c.materials.get(id)!.name} ×${n}`);
    this.inv.appendChild(el('p', undefined, `持ち物: 通貨 ${doc.money}　${items.length ? items.join('　') : '素材はまだ無い'}`));
    const unk = unknownIds(doc, c);
    if (unk.items.length + unk.weapons.length + unk.armor.length > 0) {
      this.inv.appendChild(el('p', 'base-unknown', `この版では使えないもの（消さずに持っています）: ${[...unk.items.map((id) => `${id} ×${doc.items[id]}`), ...unk.weapons, ...unk.armor].join('　')}`));
    }
    const state = save.mode === 'persistent' ? (doc.revision > 0 ? `この端末に保存済み（${when(doc.updatedAt)}）` : 'まだ保存するものがありません') : '保存されません（ページを閉じると最初に戻ります）';
    this.inv.appendChild(el('p', 'base-save-state', state));

    this.renderForge();
    if (this.data.open) this.renderData();
  }

  /** 依頼の並び（段階の順）と訓練場。まだ受けられない依頼は、押せない 1 行にする。 */
  private renderQuests(): void {
    const c = this.content;
    const doc = this.host.save.doc;
    this.questBox.textContent = '';
    const choice = (title: string, lines: string[], onClick: (() => void) | null): HTMLButtonElement => {
      const b = el('button', 'base-choice');
      b.appendChild(el('b', undefined, title));
      for (const line of lines) b.appendChild(el('span', undefined, line));
      if (onClick) b.addEventListener('click', onClick);
      else b.disabled = true;
      this.questBox.appendChild(b);
      return b;
    };
    const order = (rankId: string): number => c.ranks.get(rankId)?.order ?? 0;
    const quests = [...c.quests.values()].sort((x, y) => order(x.rankId) - order(y.rankId));
    for (const q of quests) {
      const rank = c.ranks.get(q.rankId)?.name ?? '';
      const clears = doc.progress.questClears[q.id] ?? 0;
      const title = `【${rank}】依頼「${q.name}」${clears > 0 ? `　達成 ${clears} 回` : ''}`;
      let b: HTMLButtonElement;
      if (!questUnlocked(doc, q)) {
        const need = (q.requires ?? []).filter((id) => !(doc.progress.questClears[id] ?? 0)).map((id) => `「${c.quests.get(id)?.name ?? id}」`);
        b = choice(title, [`${need.join('と')}を達成すると受けられます。`], null);
        b.classList.add('locked');
      } else {
        const target = c.monsters.get(q.targetMonsterId)?.name ?? '';
        const goal = q.kind === 'hunt' ? '狩猟（討伐か捕獲）' : '討伐';
        const field = this.host.fieldHunts ? fieldOf(c, q) : null;
        const lines = [q.summary, `目標: ${target}の${goal}　制限 ${Math.round(questTimeLimitTicks(c, q, this.host.fieldHunts) / 3600)} 分　力尽き ${q.maxFaints} 回で失敗`];
        if (field) lines.push(`狩場: ${field.name}（野営地から出発。エリア ${field.areas.filter((a) => a.kind !== 'camp').length} か所。標的はエリアを移動する）`);
        if (q.supplies?.length) lines.push(`支給品: ${q.supplies.map((s) => `${c.items.get(s.itemId)?.name ?? s.itemId} ×${s.count}`).join('　')}`);
        if (q.rewards) lines.push(`報酬: ${q.rewards.money} 通貨 + 素材`);
        b = choice(title, lines, () => this.host.startHunt(q.id));
      }
      b.dataset.quest = q.id;
      b.dataset.rank = q.rankId;
    }
    choice('訓練場', ['動かない標的で、操作と技を確かめる。'], () => this.host.startTraining());
  }

  /**
   * 工房。持っている武器と防具それぞれの「次の強化」を 1 つずつ出す（強化は入れ替えなので、進める先は 1 つ）。
   * 並べる順: いま装備している武器 → 強化できるもの → まだ足りないもの。最後の段まで進んだものは 1 行にまとめる。
   */
  private renderForge(): void {
    const c = this.content;
    const doc = this.host.save.doc;
    this.forgeBody.textContent = '';
    let ready = 0;
    const equipped = this.host.weaponId;
    const rankName = (itemId: string): string => {
      const order = this.matRank.get(itemId) ?? 1;
      const r = order > 1 ? [...c.ranks.values()].find((x) => x.order === order) : undefined;
      return r ? `（${r.name}から）` : '';
    };
    const nameOf = (id: string): string => c.weapons.get(id)?.name ?? c.armor.get(id)?.name ?? id;
    const statOf = (id: string): string => (c.weapons.has(id) ? `攻撃力 ${c.weapons.get(id)!.attack}` : `防御力 ${c.armor.get(id)?.defense ?? 0}`);
    const section = (title: string, kind: RecipeDef['kind'], ownedIds: string[]): void => {
      this.forgeBody.appendChild(el('p', 'forge-head', title));
      const next = [...c.recipes.values()].filter((r) => r.kind === kind && checkCraft(doc, r).ownsBase);
      const sortKey = (r: RecipeDef): number => (recipeFrom(r) === equipped ? 0 : checkCraft(doc, r).ok ? 1 : 2);
      next.sort((x, y) => sortKey(x) - sortKey(y));
      for (const r of next) {
        const chk = checkCraft(doc, r);
        if (chk.ownsResult) continue;
        const from = r.kind === 'upgrade' ? r.fromWeaponId : r.fromArmorId;
        const to = r.kind === 'upgrade' ? r.resultWeaponId : r.resultArmorId;
        const box = el('div', 'forge-recipe');
        box.dataset.recipe = r.id;
        box.appendChild(el('b', undefined, `${nameOf(from)} → ${nameOf(to)}`));
        box.appendChild(el('span', 'forge-stat', `${statOf(from)} → ${statOf(to).replace(/^\S+ /, '')}`));
        const ul = el('ul', 'forge-cost');
        for (const i of chk.items) {
          const short = i.have < i.need;
          ul.appendChild(el('li', short ? 'short' : undefined, `${c.materials.get(i.itemId)?.name ?? i.itemId} ${i.have} / ${i.need}${short ? rankName(i.itemId) : ''}`));
        }
        ul.appendChild(el('li', chk.money.have >= chk.money.need ? undefined : 'short', `通貨 ${chk.money.have} / ${chk.money.need}`));
        box.appendChild(ul);
        if (chk.ok) ready++;
        if (this.confirming === r.id && chk.ok) {
          const p = el('p', 'forge-confirm', `素材と通貨を使って、${nameOf(from)}を${nameOf(to)}に変えます。元には戻せません。`);
          const yes = el('button', 'go', '強化する');
          yes.addEventListener('click', () => {
            this.confirming = null;
            void this.run('強化しています', () => this.host.save.craft(r.id), `${nameOf(to)}に強化しました。`).then((ok) => {
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
      // 最後の段まで進んだもの（進める先のレシピが無い）
      const sources = new Set([...c.recipes.values()].map(recipeFrom));
      const done = ownedIds.filter((id) => (c.weapons.has(id) || c.armor.has(id)) && !sources.has(id));
      if (done.length > 0) this.forgeBody.appendChild(el('p', 'forge-done', `最後の段まで強化済み: ${done.map((id) => `${nameOf(id)}（${statOf(id)}）`).join('　')}`));
    };
    section('武器', 'upgrade', doc.weapons);
    section('防具', 'armor_upgrade', doc.armor);
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
