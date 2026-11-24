// 拠点（仮）。武器を選び、依頼か訓練場へ出る。持ち物を確かめ、工房で強化し、データを書き出す / 取り込む。
// 里を歩く・受付・道具箱は、これから作る。
//
// 持ち物・装備の表示は、保存の管理役（SaveManager）が持つ「書き込みが完了した内容」だけを映す。
// 強化・取り込みなどの結果は、書き込みが完了してから表示する（押した時点では「保存しています…」）。
import { APP_VERSION, BUILD_ID, assetUrl } from '../core/assets';
import { ARMOR_SLOTS, recipeFrom, type ArmorSlot, type Content, type RecipeDef } from '../data/schemas';
import { materialRanks } from '../data/validators';
import { fieldOf, questTimeLimitTicks } from '../game/field';
import { defenseScale } from '../game/rank';
import { CLASS_NAMES, ECOLOGY_KEYS, ECOLOGY_NAMES, ELEMENT_NAMES, STATE_NAMES, STATUS_NAMES, VARIANT_NAMES, bestiaryCounts } from '../data/bestiary';
import type { FacilityKind } from '../data/schemas';
import { checkBuy, checkCraft, defenseOf, ownedArmor, parseImport, questUnlocked, unknownIds, usableWeapons, wornArmor } from '../save/profile';
import type { SaveManager, SaveResult } from '../save/saveManager';
import { canFullscreen, fullscreenHint, toggleFullscreen } from './fullscreen';

export interface BaseHost {
  startTraining(): void;
  startHunt(questId: string): void;
  /** 依頼を、フィールド（エリアに分かれた狩場）で始めるか */
  readonly fieldHunts: boolean;
  /** 里を歩く拠点か（歩く拠点では、施設ごとに画面を開き、「里へ戻る」で閉じる） */
  readonly hubWalk: boolean;
  closeFacility(): void;
  /** 商店: 道具を買う / 素材を売る（保存が完了してから変わる） */
  buy(itemId: string, count: number): Promise<SaveResult>;
  sell(itemId: string, count: number): Promise<SaveResult>;
  /** いま持たせている武器の id と、持ち替え（保存が完了してから替わる） */
  weaponId: string;
  setWeapon(id: string): Promise<SaveResult>;
  /** 防具を、部位ごとに替える・外す（null で外す。保存が完了してから替わる） */
  setArmor(slot: ArmorSlot, id: string | null): Promise<SaveResult>;
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

/** 拠点の画面に出す範囲。all = すべて（一覧）。ほかは、施設 1 つぶん */
export type BaseSection = 'all' | FacilityKind;

export class BaseScreen {
  readonly root: HTMLElement;
  section: BaseSection = 'all';
  private title: HTMLElement;
  private lead: HTMLElement;
  private shop: HTMLDetailsElement;
  private shopBody: HTMLElement;
  private bestiary: HTMLDetailsElement;
  private closeBtn: HTMLButtonElement;
  private banners: HTMLElement;
  private weaponRow: HTMLElement;
  private weaponNote: HTMLElement;
  private armorNote: HTMLElement;
  private armorBox: HTMLElement;
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
    this.title = el('h2', undefined, content.hub.name);
    card.append(this.title);
    this.banners = el('div', 'base-banners');
    this.lead = el('p', 'base-lead', '行き先を選んでください。');
    card.append(this.banners, this.lead);
    // 施設ごとの画面では、その施設のものだけを出す（data-sec と、root の data-section を CSS で突き合わせる）
    const sec = <T extends HTMLElement>(e: T, s: FacilityKind): T => {
      e.dataset.sec = s;
      return e;
    };

    this.weaponRow = sec(el('div', 'base-weapons'), 'chest');
    this.weaponNote = sec(el('p', 'base-weapon-note'), 'chest');
    card.append(sec(el('p', 'base-weapon-label', '武器（持ち替え）'), 'chest'), this.weaponRow, this.weaponNote);

    // 防具: 部位ごとに、持っているものから選ぶ・外す（v0.14.0）
    this.armorBox = sec(el('div', 'base-armor'), 'chest');
    this.armorNote = sec(el('p', 'base-armor-note'), 'chest');
    card.append(sec(el('p', 'base-weapon-label', '防具（部位ごとに、着る・外す）'), 'chest'), this.armorBox, this.armorNote);
    this.matRank = materialRanks(content);

    // 依頼（段階の順）と訓練場。受けられるかどうかは進行で変わるので、中身は refresh で作る
    this.questBox = sec(el('div', 'base-quests'), 'quest');
    card.appendChild(this.questBox);

    // 持ち物は、装備箱・工房・商店のどれでも見える
    this.inv = el('div', 'base-inv');
    this.inv.dataset.sec = 'chest workshop shop';
    card.appendChild(this.inv);

    // モンスター図鑑（依頼板で見る。登録簿 bestiary.json を、段階ごとに並べる）。開いた時に 1 度だけ組む
    this.bestiary = sec(el('details', 'base-section'), 'quest');
    this.bestiary.id = 'base-bestiary';
    const juveniles = content.bestiary.species.filter((x) => x.class === 'juvenile').length;
    this.bestiary.appendChild(el('summary', undefined, `モンスター図鑑（${content.bestiary.species.length - juveniles} 種${juveniles ? `・幼体 ${juveniles} 種` : ''}）`));
    this.bestiary.addEventListener('toggle', () => {
      if (this.bestiary.open && this.bestiary.childElementCount === 1) this.bestiary.appendChild(this.renderBestiary());
    });
    card.appendChild(this.bestiary);

    this.shop = sec(el('details', 'base-section'), 'shop');
    this.shop.id = 'base-shop';
    this.shop.appendChild(el('summary', undefined, '商店'));
    this.shopBody = el('div');
    this.shop.appendChild(this.shopBody);
    card.appendChild(this.shop);

    this.forge = sec(el('details', 'base-section'), 'workshop');
    this.forge.id = 'base-forge';
    this.forge.appendChild(el('summary', undefined, '工房'));
    this.forgeBody = el('div');
    this.forge.appendChild(this.forgeBody);
    card.appendChild(this.forge);

    this.data = sec(el('details', 'base-section'), 'chest');
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

    // 歩く拠点: 画面を閉じて、里へ戻る
    this.closeBtn = el('button', 'base-close', '里へ戻る');
    this.closeBtn.addEventListener('click', () => host.closeFacility());
    this.closeBtn.hidden = !host.hubWalk;
    card.appendChild(this.closeBtn);

    card.appendChild(el('p', 'base-note', `v${APP_VERSION} (${BUILD_ID}) ／ 見た目・動き・音は仮素材。里の建物は仮の形です。`));
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

  /** 開く / 閉じる。section で、出す範囲を決める（施設の画面では、その施設の欄を開いた状態にする）。 */
  setOpen(open: boolean, section: BaseSection = 'all'): void {
    const fresh = this.root.hidden || section !== this.section;
    this.root.hidden = !open;
    if (!open) return;
    this.section = section;
    this.root.dataset.section = section;
    const f = this.content.hub.facilities.find((x) => x.kind === section);
    this.title.textContent = f ? f.name : this.content.hub.name;
    this.lead.textContent = f ? `${f.summary}。` : '行き先を選んでください。';
    if (section === 'workshop') this.forge.open = true;
    if (section === 'shop') this.shop.open = true;
    // 開き直した時だけ、前の操作の結果を消す（強化の直後に作り直す時は、残す）
    if (fresh) this.say('');
    this.refresh();
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
    // 防具（部位ごと）。いま着ているものに印。「外す」を選ぶと、その部位は里の装束の姿に戻る
    const worn = wornArmor(doc, c);
    const owned = ownedArmor(doc, c);
    this.armorBox.textContent = '';
    for (const slot of ARMOR_SLOTS) {
      const on = worn.find((a) => a.slot === slot) ?? null;
      const row = el('div', 'base-armor-row');
      row.dataset.slot = slot;
      row.dataset.worn = on?.id ?? '';
      row.appendChild(el('span', 'slot', c.armorRules.slotNames[slot]));
      const picks = el('div', 'base-armor-picks');
      const pick = (label: string, sub: string, id: string | null, active: boolean): void => {
        const b = el('button', 'base-armor-pick');
        b.append(el('b', undefined, label), el('small', undefined, sub));
        b.dataset.armor = id ?? '';
        b.classList.toggle('on', active);
        b.addEventListener('click', () => {
          if (active) return;
          void this.run(id === null ? '外しています' : '着替えています', () => this.host.setArmor(slot, id), '');
        });
        picks.appendChild(b);
      };
      for (const a of owned[slot]) pick(a.name, `防御 ${a.defense}`, a.id, on?.id === a.id);
      pick('外す', '防御 0', null, on === null);
      row.appendChild(picks);
      this.armorBox.appendChild(row);
    }
    const defense = defenseOf(doc, c);
    this.armorNote.textContent = `防御力の合計 ${defense}（受けるダメージ ×${defenseScale(c, defense).toFixed(2)}）`;

    this.renderQuests();

    // 持ち物
    this.inv.textContent = '';
    const known = Object.entries(doc.items).filter(([id, n]) => n > 0 && c.materials.has(id));
    const items = known.map(([id, n]) => `${c.materials.get(id)!.name} ×${n}`);
    this.inv.appendChild(el('p', undefined, `持ち物: 通貨 ${doc.money}　${items.length ? items.join('　') : '素材はまだ無い'}`));
    // 道具（商店で買ったもの。狩りへ、持ち出せる数まで持っていく）
    const tools = [...c.items.values()].filter((it) => (doc.items[it.id] ?? 0) > 0).map((it) => `${it.name} ×${doc.items[it.id]}`);
    if (tools.length) this.inv.appendChild(el('p', 'base-tools', `道具: ${tools.join('　')}`));
    const unk = unknownIds(doc, c);
    if (unk.items.length + unk.weapons.length + unk.armor.length > 0) {
      this.inv.appendChild(el('p', 'base-unknown', `この版では使えないもの（消さずに持っています）: ${[...unk.items.map((id) => `${id} ×${doc.items[id]}`), ...unk.weapons, ...unk.armor].join('　')}`));
    }
    const state = save.mode === 'persistent' ? (doc.revision > 0 ? `この端末に保存済み（${when(doc.updatedAt)}）` : 'まだ保存するものがありません') : '保存されません（ページを閉じると最初に戻ります）';
    this.inv.appendChild(el('p', 'base-save-state', state));

    this.renderShop();
    this.renderForge();
    if (this.data.open) this.renderData();
  }

  /**
   * モンスター図鑑。登録簿（public/data/bestiary.json）を、はじめて登場する段階ごとに並べる。
   * 遊べるのは「実装済み」の種だけ。ほかは、これから作る計画（原画あり / 案）。
   */
  private renderBestiary(): HTMLElement {
    const c = this.content;
    const b = c.bestiary;
    const box = el('div', 'bestiary');
    const ranks = [...c.ranks.values()].sort((x, y) => x.order - y.order);
    const frameName = new Map(b.frames.map((f) => [f.id, f.name]));
    const byId = new Map(b.species.map((s) => [s.id, s]));
    box.appendChild(el('p', 'bestiary-note', '遊べるのは「実装済み」の種だけです。ほかは、これから作る計画です（数は、その段階から新しく登場する種）。属性・弱点・狩場は、どれも案です。'));
    for (const count of bestiaryCounts(b, ranks.map((r) => r.id))) {
      const rank = c.ranks.get(count.rank)!;
      const head = el('h4', undefined, `${rank.name}から　${count.have} / ${count.plan} 種${count.juveniles ? `　幼体 ${count.juveniles}` : ''}`);
      head.dataset.rank = rank.id;
      box.appendChild(head);
      const here = b.species.filter((s) => s.rank === rank.id);
      if (here.length === 0) box.appendChild(el('p', 'bestiary-note', 'まだ登録がありません。'));
      for (const s of here) {
        const d = el('details', `bestiary-item ${s.state}`);
        d.dataset.species = s.id;
        const kind = `${CLASS_NAMES[s.class]}${s.variant !== 'base' ? `・${VARIANT_NAMES[s.variant]}` : ''}`;
        const elem = [...s.elements.map((e) => ELEMENT_NAMES[e]), ...s.statuses.map((x) => STATUS_NAMES[x])].join('・');
        const sum = el('summary');
        sum.append(el('span', 'no', String(s.no).padStart(2, '0')), el('b', undefined, `${s.title} ${s.name}`), el('span', 'tags', `${kind}／${frameName.get(s.frame) ?? s.frame}／${s.habitat}／${elem}`), el('span', 'state', STATE_NAMES[s.state]));
        d.appendChild(sum);
        // 中身は、開いた時に 1 度だけ組む（種が多いので、最初から全部は作らない）
        const art = s.art;
        d.addEventListener('toggle', () => {
          if (!d.open || d.querySelector('dl')) return;
          const nameOf = (id: string): string => (byId.has(id) ? `${byId.get(id)!.title} ${byId.get(id)!.name}` : id);
          const rows: [string, string][] = [['外見の核', s.look]];
          if (s.organ) rows.push(['器官', s.organ]);
          rows.push(['技', s.moves.join('、')]);
          rows.push(['全長', `${s.size} m`]);
          if (s.baseId) rows.push(['もとの種', nameOf(s.baseId)]);
          if (s.pack) rows.push(['群れ', `${s.pack[0]}〜${s.pack[1]} 体`]);
          if (s.pairs?.length) rows.push(['一緒に出る相手', s.pairs.map(nameOf).join('、')]);
          if (s.weak.length || s.resist.length) rows.push(['弱点 / 強い', `${s.weak.map((e) => ELEMENT_NAMES[e]).join('・') || '—'} / ${s.resist.map((e) => ELEMENT_NAMES[e]).join('・') || '—'}`]);
          if (s.parts.length) rows.push(['壊せる部位', s.parts.join('、')]);
          if (s.materials.length) rows.push(['素材', s.materials.join('、')]);
          if (s.ecology) for (const k of ECOLOGY_KEYS) rows.push([ECOLOGY_NAMES[k], s.ecology[k]]);
          else rows.push(['生態', 'まだ書かれていません。']);
          const dl = el('dl');
          for (const [k, v] of rows) dl.append(el('dt', undefined, k), el('dd', undefined, v));
          // 原画（設定画）。ゲームの中の体がまだ無い種は、そう書く
          if (art) {
            const fig = el('figure', 'bestiary-art');
            const img = document.createElement('img');
            img.alt = `${s.title} ${s.name} の原画`;
            img.src = assetUrl(`assets/bestiary/${art.replace(/\.png$/, '.webp')}`);
            fig.append(img, el('figcaption', undefined, s.state === 'implemented' ? '原画（設定画）。ゲームの中の体は、この絵から作った仮の形です。' : '原画（設定画）。ゲームの中の体と動きは、まだありません。'));
            d.appendChild(fig);
          } else if (s.state === 'planned') d.appendChild(el('p', 'bestiary-note', '案だけです（絵も、ゲームの中の体も、まだありません）。'));
          d.appendChild(dl);
        });
        box.appendChild(d);
      }
    }
    // 狩場の案（種の「狩場」に出てくる名前の一覧。歩けるのは、fieldId が付いたものだけ）
    const fields = b.fields ?? [];
    const walkable = fields.filter((f) => f.fieldId).length;
    const fh = el('h4', undefined, `狩場の案　${fields.length}（歩けるのは ${walkable}）`);
    fh.dataset.fields = String(fields.length);
    box.appendChild(fh);
    for (const f of fields) {
      const d = el('details', `bestiary-item bestiary-field ${f.fieldId ? 'implemented' : 'planned'}`);
      d.dataset.field = f.name;
      const here = b.species.filter((x) => x.habitat === f.name);
      const sum = el('summary');
      sum.append(el('b', undefined, f.name), el('span', 'tags', f.terrain), el('span', 'state', f.fieldId ? '歩ける' : '案'));
      d.appendChild(sum);
      const dl = el('dl');
      if (f.mood) dl.append(el('dt', undefined, '天気・光・音'), el('dd', undefined, f.mood));
      dl.append(el('dt', undefined, 'ここに出る種'), el('dd', undefined, here.map((x) => `${x.title} ${x.name}`).join('、') || '—'));
      d.appendChild(dl);
      box.appendChild(d);
    }
    return box;
  }

  /**
   * 商店。道具を買う（通貨 → 道具）、素材を売る（素材 → 通貨）。どちらも、保存が完了してから表示が変わる。
   * 買った道具は、狩りへ出る時に、支給品に足して持っていく（合わせて「持ち出せる数」まで）。使ったぶんだけ減る。
   */
  private renderShop(): void {
    const c = this.content;
    const doc = this.host.save.doc;
    const shop = c.shop;
    this.shopBody.textContent = '';
    this.shopBody.appendChild(el('p', 'shop-money', `通貨 ${doc.money}`));
    this.shopBody.appendChild(el('p', 'shop-note', '買った道具は、依頼の支給品に足して持っていきます（道具ごとに、持ち出せる数まで）。支給品から先に使い、自分の道具は、使ったぶんだけ減ります。'));
    const row = (name: string, sub: string, buttons: HTMLButtonElement[]): HTMLElement => {
      const r = el('div', 'shop-row');
      const t = el('div', 'shop-text');
      t.append(el('b', undefined, name), el('span', undefined, sub));
      const bs = el('div', 'shop-buttons');
      bs.append(...buttons);
      r.append(t, bs);
      return r;
    };
    this.shopBody.appendChild(el('h4', undefined, '買う'));
    for (const g of shop.goods) {
      const it = c.items.get(g.itemId)!;
      const have = doc.items[g.itemId] ?? 0;
      const buttons = [1, 5].map((n) => {
        const b = el('button', 'shop-buy', `買う ×${n}`);
        b.dataset.item = g.itemId;
        b.dataset.count = String(n);
        b.disabled = !checkBuy(doc, shop, g.itemId, n).ok;
        b.addEventListener('click', () => void this.run('買っています', () => this.host.buy(g.itemId, n), `${it.name}を ${n} 個買いました。`));
        return b;
      });
      const r = row(`${it.name}　${g.price} 通貨`, `${it.summary ?? ''}　持っている数 ${have}（狩りへ持ち出せるのは ${it.carryMax} 個まで）`, buttons);
      r.dataset.item = g.itemId;
      this.shopBody.appendChild(r);
    }
    this.shopBody.appendChild(el('h4', undefined, '売る'));
    const owned = shop.sell.filter((g) => (doc.items[g.itemId] ?? 0) > 0);
    if (owned.length === 0) this.shopBody.appendChild(el('p', 'shop-note', '売れる素材を持っていません。'));
    for (const g of owned) {
      const name = c.materials.get(g.itemId)?.name ?? g.itemId;
      const have = doc.items[g.itemId] ?? 0;
      const buttons = [1, 5].map((n) => {
        const b = el('button', 'shop-sell', `売る ×${n}`);
        b.dataset.item = g.itemId;
        b.dataset.count = String(n);
        b.disabled = have < n;
        b.addEventListener('click', () => void this.run('売っています', () => this.host.sell(g.itemId, n), `${name}を ${n} 個売りました（+${g.price * n} 通貨）。`));
        return b;
      });
      const r = row(`${name}　${g.price} 通貨`, `持っている数 ${have}`, buttons);
      r.dataset.item = g.itemId;
      this.shopBody.appendChild(r);
    }
    this.shopBody.appendChild(el('p', 'shop-note', '売った素材は戻りません。強化に使う素材は、工房で数を確かめてから。'));
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
