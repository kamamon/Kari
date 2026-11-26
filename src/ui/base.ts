// 拠点（仮）。武器を選び、依頼か訓練場へ出る。持ち物を確かめ、工房で強化し、データを書き出す / 取り込む。
// 受付は級ごとの実施設とつなぎ、星ごとの短い一覧から詳細へ進む。
//
// 持ち物・装備の表示は、保存の管理役（SaveManager）が持つ「書き込みが完了した内容」だけを映す。
// 強化・取り込みなどの結果は、書き込みが完了してから表示する（押した時点では「保存しています…」）。
import { APP_VERSION, BUILD_ID, assetUrl } from '../core/assets';
import { ARMOR_SLOTS, QUEST_LANE_NAMES, recipeFrom, recipeResult, type ArmorSlot, type Content, type DeliveryDef, type RecipeDef } from '../data/schemas';
import { minutesText, starRow } from '../data/questBoard';
import { materialRanks } from '../data/validators';
import { fieldOf, questTimeLimitTicks } from '../game/field';
import { defenseScale } from '../game/rank';
import { CLASS_NAMES, ECOLOGY_KEYS, ECOLOGY_NAMES, ELEMENT_NAMES, STATE_NAMES, STATUS_NAMES, VARIANT_NAMES, bestiaryCounts } from '../data/bestiary';
import type { FacilityKind } from '../data/schemas';
import { checkBuy, checkCraft, craftRankOpen, checkDelivery, defenseOf, ownedArmor, parseImport, questUnlocked, supportState, unknownIds, usableWeapons, wornArmor } from '../save/profile';
import type { SaveManager, SaveResult } from '../save/saveManager';
import { canFullscreen, fullscreenHint, toggleFullscreen } from './fullscreen';
import { questGoal } from './targets';
import { fieldArtUrl, withIcon } from './icons';
import { renderStoryPanel } from './story';
import { receptionGroups, questActivity, QUEST_ACTIVITY_LABELS, questIconStrip, deliveryIconStrip, deliveryReceptionRank, type ReceptionEntry } from './questReception';
import { DRAFT_KIND_NAMES, changedKinds, describeKind, draftOf, editableAppearance, emptyDraft } from '../data/appearance';
import { computeGear } from '../game/gear';
import { armorStat, gearSummary, weaponShortName, weaponStat } from './gearText';

import { HubLifePanel, type HubLifeHost } from './hubLife';
import { lifeOf, prepText, type HubTab } from '../data/hubLife';

function lifePreviewLink(id:string):HTMLAnchorElement{
 const a=el('a','life-button','3Dで試着'),q=new URLSearchParams({bones:'0',shapes:'0',stance:'idle',yaw:'0.5'});
 q.set(id.startsWith('armor.')?'previewArmor':'previewWeapon',id);
 a.href=assetUrl('viewer.html')+'?'+q.toString();a.target='_blank';a.rel='noopener';return a;
}
export interface BaseHost extends HubLifeHost {
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
  /** 物語の場面を読む（v0.23.0。会話の窓を開く。何も保存しない） */
  openStory(sceneIds: string[]): void;
  /** 見た目を変える画面を開く（v0.28.0。装備箱から。費用なし） */
  openLooks(): void;
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
export type BaseSection = 'all' | 'life' | FacilityKind;

/** 図鑑の絵の説明。adopted = 採用した設定図（ガルドロス）。ほかは ChatGPT の原画案（真横 1 方向。採用は利用者が決める） */
export function artCaption(state: string, cls: string, adopted: boolean): string {
  if (adopted) return '設定図（採用済み。左の側面）。ゲームの中の体は、この図から作った仮の形です。';
  const head = '原画案（ChatGPT。採用待ち・真横 1 方向）。';
  if (state !== 'implemented') return head + 'ゲームの中の体と動きは、まだありません。';
  return head + (cls === 'juvenile' ? 'ゲームの中の体は、まだ親の原画から作った仮の形です。' : 'ゲームの中の体は、この絵から作った仮の形です。');
}

interface ReceptionBookmark {
  selected: string | null;
  listScroll: number;
  detailScroll: number;
}

interface ReceptionViewState extends ReceptionBookmark {
  stage: 'stars' | 'list';
  stars: number | null;
  history: Map<number | null, ReceptionBookmark>;
}

function newReceptionView(stars: number | null): ReceptionViewState {
  return { stage: 'stars', stars, selected: null, listScroll: 0, detailScroll: 0, history: new Map() };
}

/** 星を替える時は、元の星の選択とスクロールを覚えておく。 */
function selectReceptionStar(state: ReceptionViewState, stars: number | null): void {
  if (state.stars !== stars) {
    state.history.set(state.stars, { selected: state.selected, listScroll: state.listScroll, detailScroll: state.detailScroll });
    const previous = state.history.get(stars);
    state.stars = stars;
    state.selected = previous?.selected ?? null;
    state.listScroll = previous?.listScroll ?? 0;
    state.detailScroll = previous?.detailScroll ?? 0;
  }
  state.stage = 'list';
}

export class BaseScreen {
  readonly root: HTMLElement;
  section: BaseSection = 'all';
  /** 実際に開いている施設。Appの画面復帰でもこのIDを引き継ぐ。 */
  facilityId: string | null = null;
  private receptionStates = new Map<string, ReceptionViewState>();
  private questScroller: HTMLElement | null = null;
  private questScrollContext: { key: string } | null = null;
  private questDetailScroller: HTMLElement | null = null;
  private huntConfirmId: string | null = null;
  private receptionPadActive = false;
  private receptionPadPrevious = 0;
  private receptionNotice = '';
  private storyFold: HTMLDetailsElement;
  private questExtras: HTMLElement;
  private trainingBtn: HTMLButtonElement;
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
  /** 身に着けている装備の技能と耐性（v0.33.0） */
  private gearNote: HTMLElement;
  private armorBox: HTMLElement;
  /** 見た目の欄の説明（いまの外見の種類） */
  private looksNote!: HTMLElement;
  private questBox: HTMLElement;
  /** 物語の欄（依頼板。v0.23.0） */
  private storyBox: HTMLElement;
  /** 素材ごとの、手に入るいちばん下の段階（工房で「どこから出るか」を添えるため） */
  private matRank: Map<string, number>;
  private inv: HTMLElement;
  private forge: HTMLDetailsElement;
  private forgeBody: HTMLElement;
  private data: HTMLDetailsElement;
  private dataBody: HTMLElement;
  /** 画面の下に出す、直前の操作の結果 */
  private message: HTMLElement;
  private lifePanel: HubLifePanel;
  private lifeButton: HTMLButtonElement;
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
    const header = el('header', 'base-heading');
    const headingText = el('div', 'base-heading-text');
    this.title = el('h2', undefined, content.hub.name);
    this.banners = el('div', 'base-banners');
    this.lead = el('p', 'base-lead', '行き先を選んでください。');
    headingText.append(this.title, this.lead);
    header.appendChild(headingText);
    card.append(header, this.banners);
    this.lifeButton = el('button', 'base-close life-entry', '里の暮らし・施設地図');
    this.lifeButton.addEventListener('click', () => { if (!this.busy) this.showLife('map'); });
    card.appendChild(this.lifeButton);
    this.lifePanel=new HubLifePanel(content,host);
    card.appendChild(this.lifePanel.root);
    // 施設ごとの画面では、その施設のものだけを出す（data-sec と、root の data-section を CSS で突き合わせる）
    const sec = <T extends HTMLElement>(e: T, s: FacilityKind): T => {
      e.dataset.sec = s;
      return e;
    };

    this.weaponRow = sec(el('div', 'base-weapons'), 'chest');
    this.weaponNote = sec(el('p', 'base-weapon-note'), 'chest');
    card.append(sec(el('p', 'base-weapon-label', '武器（持ち替え）'), 'chest'), this.weaponRow, this.weaponNote);

    // 見た目（v0.28.0）: 体型・肌・髪の色を変える画面を開く。費用なし・いつでも
    const looks = sec(el('div', 'base-looks'), 'chest');
    const looksBtn = el('button', 'base-looks-open', '見た目を変える');
    looksBtn.addEventListener('click', () => host.openLooks());
    this.looksNote = el('span', 'base-looks-note');
    looks.append(looksBtn, this.looksNote);
    card.appendChild(looks);

    // 防具: 部位ごとに、持っているものから選ぶ・外す（v0.14.0）
    this.armorBox = sec(el('div', 'base-armor'), 'chest');
    this.armorNote = sec(el('p', 'base-armor-note'), 'chest');
    this.gearNote = sec(el('p', 'base-gear-note'), 'chest');
    card.append(sec(el('p', 'base-weapon-label', '防具（部位ごとに、着る・外す）'), 'chest'), this.armorBox, this.armorNote, this.gearNote);
    this.matRank = materialRanks(content);

    // 一覧を先に見せ、物語・図鑑・訓練は小さな導線へまとめる。
    this.questBox = sec(el('div', 'base-quests'), 'quest');
    card.appendChild(this.questBox);
    this.questExtras = sec(el('div', 'reception-extras'), 'quest');
    this.storyFold = el('details', 'reception-story-fold');
    this.storyFold.appendChild(el('summary', undefined, '物語・帰還記録'));
    this.storyBox = el('div', 'base-story');
    this.storyFold.appendChild(this.storyBox);
    this.questExtras.appendChild(this.storyFold);
    card.appendChild(this.questExtras);

    // 持ち物は、装備箱・工房・商店のどれでも見える
    this.inv = el('div', 'base-inv');
    this.inv.dataset.sec = 'chest workshop shop';
    card.appendChild(this.inv);

    // モンスター図鑑（依頼板で見る。登録簿 bestiary.json を、段階ごとに並べる）。開いた時に 1 度だけ組む
    this.bestiary = sec(el('details', 'base-section'), 'quest');
    this.bestiary.id = 'base-bestiary';
    this.bestiary.appendChild(el('summary', undefined, `図鑑 ${content.bestiary.species.length}種`));
    this.storyFold.addEventListener('toggle', () => {
      if (this.storyFold.open) this.bestiary.open = false;
      if (!this.storyFold.open && !this.bestiary.open) this.restoreReceptionScroll();
    });
    this.bestiary.addEventListener('toggle', () => {
      if (this.bestiary.open) this.storyFold.open = false;
      if (this.bestiary.open && this.bestiary.childElementCount === 1) this.bestiary.appendChild(this.renderBestiary());
      if (!this.storyFold.open && !this.bestiary.open) this.restoreReceptionScroll();
    });
    this.questExtras.appendChild(this.bestiary);
    this.trainingBtn = el('button', 'reception-training', '訓練場');
    this.trainingBtn.type = 'button';
    this.trainingBtn.addEventListener('click', () => { if (!this.busy) this.host.startTraining(); });
    this.questExtras.appendChild(this.trainingBtn);

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
    this.closeBtn.addEventListener('click', () => {
      if (host.hubWalk) host.closeFacility();
      else this.setOpen(true, 'all');
    });
    this.closeBtn.hidden = !host.hubWalk;
    header.appendChild(this.closeBtn);

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
    // 戦闘用の矢印・Escより先に、受付の階層と行を操作する。
    root.addEventListener('keydown', (e) => {
      if (this.section !== 'quest' || !this.receptionRank() || !this.open || this.busy) return;
      const inQuests = this.questBox.contains(document.activeElement);
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this.backReception();
      } else if (inQuests && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        if (this.huntConfirmId !== null || this.confirming !== null) return;
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && focused.closest('.reception-classic-detail')) return;
        e.preventDefault();
        e.stopPropagation();
        this.moveReceptionSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    host.save.onChange(() => {
      if (this.open) this.refresh();
    });
    this.refresh();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 実施設IDも引き継いで開く。閉じても受付ごとの閲覧位置は残す。 */
  setOpen(open: boolean, section: BaseSection = 'all', facilityId?: string): void {
    this.rememberReceptionScroll();
    this.questScroller = null;
    this.questDetailScroller = null;
    this.questScrollContext = null;
    const wasHidden = this.root.hidden;
    this.root.hidden = !open;
    if (!open) {
      this.huntConfirmId = null;
      this.confirming = null;
      return;
    }
    const f = facilityId
      ? this.content.hub.facilities.find((x) => x.id === facilityId && x.kind === section)
      : section === 'quest' ? undefined : this.content.hub.facilities.find((x) => x.kind === section);
    const fresh = section !== this.section || (f?.id ?? null) !== this.facilityId;
    this.section = section;
    this.facilityId = f?.id ?? null;
    this.root.dataset.section = section;
    this.root.dataset.facility = this.facilityId ?? '';
    this.title.textContent = f ? f.name : section === 'quest' ? '依頼の受付案内' : section==='life'?'灯継ぎの里・暮らし':this.content.hub.name;
    this.lifePanel.root.hidden=section!=='life';
    this.lifeButton.hidden=section==='life';
    this.lead.textContent = f?.kind === 'quest' ? '星を選び、依頼の内容を確認してください。' : f ? `${f.summary}。` : '行き先を選んでください。';
    this.closeBtn.hidden = !this.host.hubWalk && section === 'all';
    this.closeBtn.textContent = this.host.hubWalk ? '里へ戻る' : '拠点の一覧へ';
    if (section === 'workshop') this.forge.open = true;
    if (section === 'shop') this.shop.open = true;
    if (fresh || wasHidden) {
      this.say('');
      this.receptionNotice = '';
      this.confirming = null;
      this.huntConfirmId = null;
      this.storyFold.open = false;
      this.bestiary.open = false;
      // 受付へ入り直す時は星の選択から。前回の星・行の記憶は残す。
      const previous = this.facilityId ? this.receptionStates.get(this.facilityId) : undefined;
      if (section === 'quest' && previous) previous.stage = 'stars';
    }
    this.refresh();
    if ((fresh || wasHidden) && section === 'quest' && this.receptionRank()) {
      this.questBox.querySelector<HTMLButtonElement>('.reception-star[aria-pressed="true"], .reception-star')?.focus({ preventScroll: true });
    }
  }

  showLife(tab:HubTab):void { this.setOpen(true,'life');this.lifePanel.open(tab); }

  /** 直前の操作の結果を、画面の下に出す（ほかの画面から戻った時） */
  notify(text: string, bad = false): void {
    this.say(text, bad);
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
    if(this.section==='life'){this.lifePanel.refresh();return;}

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

    if (this.section !== 'quest' && [...c.recipes.values()].some((r) => checkCraft(doc, r, craftRankOpen(doc, c, r)).ok)) this.banners.appendChild(el('p', 'base-banner', '強化できる装備があります（下の「工房」）。'));

    // 武器（持っていて、この版で使えるもの）
    this.weaponRow.textContent = '';
    const current = this.host.weaponId;
    for (const id of usableWeapons(doc, c)) {
      const w = c.weapons.get(id)!;
      // 武器種の名前と、系列の短い名前（同じ武器種を、作った物と並べても見分けられるように。v0.33.0）
      const b = el('button', 'base-weapon', c.families.get(w.family)?.name ?? w.name);
      b.appendChild(el('small', undefined, weaponShortName(c, w)));
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
    this.weaponNote.textContent = w && fam ? `${w.name}（${weaponStat(c, w)}）: ${fam.summary ?? ''}` : '';
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
      for (const a of owned[slot]) pick(a.name, armorStat(c, a), a.id, on?.id === a.id);
      pick('外す', '防御 0', null, on === null);
      row.appendChild(picks);
      this.armorBox.appendChild(row);
    }
    // 見た目（v0.28.0）: いまの外見の種類
    const ap = doc.appearance;
    const look = draftOf(ap);
    const kinds = changedKinds(emptyDraft(), look);
    this.looksNote.textContent = !editableAppearance(ap)
      ? 'この版では編集できない、新しい版の見た目です（そのまま残します）。'
      : kinds.length
        ? `いまの見た目: ${kinds.map((k) => `${DRAFT_KIND_NAMES[k]} ${describeKind(k, look, c.appearance)}`).join('・')}`
        : 'いまは基準ハンター A の姿。体型・肌・髪の色を、費用なしで、いつでも変えられます。';
    const defense = defenseOf(doc, c);
    this.armorNote.textContent = `防御力の合計 ${defense}（受けるダメージ ×${defenseScale(c, defense).toFixed(2)}）`;
    // 技能と耐性（v0.33.0）: 身に着けている防具の点から（1 部位 1 点、Lv 3 まで）
    const gear = w ? computeGear(c, w, worn.map((a) => a.id)) : null;
    const sum = gear ? gearSummary(c, gear) : { skills: '', resist: '' };
    this.gearNote.textContent = '';
    this.gearNote.append(el('span', 'skills', `技能: ${sum.skills || 'なし'}`), el('span', 'resist', `耐性: ${sum.resist || 'なし'}`));

    this.renderQuests();
    if (!this.storyFold.hidden) {
      renderStoryPanel(this.storyBox, c, doc.progress.questClears, {
        openStory: (ids) => this.host.openStory(ids),
        startHunt: (id) => this.openStoryQuest(id),
        questUnlocked: (id) => {
          const q = c.quests.get(id);
          return !!q && questUnlocked(doc, q);
        },
      });
      for (const pack of c.support.packs) {
        if (supportState(doc, pack) !== 'ready') continue;
        const p = el('p', 'story-support', `${pack.name}を受け取れます（工房で。1 度だけ）。`);
        p.dataset.pack = pack.id;
        this.storyBox.appendChild(p);
      }
    }

    // 持ち物
    this.inv.textContent = '';
    const known = Object.entries(doc.items).filter(([id, n]) => n > 0 && c.materials.has(id));
    // 名前の前にアイコン（v0.23.0。絵のある素材だけ）。文字はこれまでと同じ
    const invLine = (cls: string | undefined, head: string, list: [string, string][], none: string): HTMLElement => {
      const p = el('p', cls, head);
      if (list.length === 0) p.append(none);
      list.forEach(([id, text], i) => {
        if (i > 0) p.append('　');
        p.appendChild(withIcon(el('span', 'inv-item'), id, text));
      });
      return p;
    };
    this.inv.appendChild(invLine(undefined, `持ち物: 通貨 ${doc.money}　`, known.map(([id, n]) => [id, `${c.materials.get(id)!.name}${c.materials.get(id)!.rarity?' [RARE '+c.materials.get(id)!.rarity+']':''} ×${n}`]), '素材はまだ無い'));
    // 道具（商店で買ったもの。狩りへ、持ち出せる数まで持っていく）
    const tools: [string, string][] = [...c.items.values()].filter((it) => (doc.items[it.id] ?? 0) > 0).map((it) => [it.id, `${it.name} ×${doc.items[it.id]}`]);
    if (tools.length) this.inv.appendChild(invLine('base-tools', '道具: ', tools, ''));
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
          const rows: [string, string][] = [];
          if (s.stateNote) rows.push(['いまの状態', s.stateNote]);
          rows.push(['外見の核', s.look]);
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
          // 絵: ガルドロスは採用した設定図。ほかは ChatGPT の原画案（真横 1 方向。採用待ち）。ゲームの中の体がまだ無い種は、そう書く
          if (art) {
            const fig = el('figure', 'bestiary-art');
            const img = document.createElement('img');
            img.alt = `${s.title} ${s.name} の原画`;
            img.src = assetUrl(`assets/bestiary/${art.split('/').pop()!.replace(/\.png$/, '.webp')}`);
            fig.append(img, el('figcaption', undefined, artCaption(s.state, s.class, art.includes('/'))));
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
      // 景色の原画（v0.23.0。ChatGPT の追加原画。地形を作る前の絵で、ゲームの中の形ではない）。開いた時に読む
      const art = fieldArtUrl(f.name);
      if (art) {
        d.addEventListener('toggle', () => {
          if (!d.open || d.querySelector('figure')) return;
          const fig = el('figure', 'bestiary-art bestiary-field-art');
          const img = document.createElement('img');
          img.alt = `${f.name} の景色の原画`;
          img.src = art;
          fig.append(img, el('figcaption', undefined, f.fieldId ? '景色の原画。ゲームの中の地形は、この絵とは別に作ったものです。' : '景色の原画。この狩場は、まだ歩けません。'));
          d.insertBefore(fig, dl);
        });
      }
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
    const row = (name: string, sub: string, buttons: HTMLButtonElement[], iconId = ''): HTMLElement => {
      const r = el('div', 'shop-row');
      const t = el('div', 'shop-text');
      t.append(withIcon(el('b'), iconId, name), el('span', undefined, sub));
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
      const r = row(`${it.name}　${g.price} 通貨`, `${it.summary ?? ''}　持っている数 ${have}（狩りへ持ち出せるのは ${it.carryMax} 個まで）`, buttons, g.itemId);
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
      const r = row(`${name}　${g.price} 通貨`, `持っている数 ${have}`, buttons, g.itemId);
      r.dataset.item = g.itemId;
      this.shopBody.appendChild(r);
    }
    this.shopBody.appendChild(el('p', 'shop-note', '売った素材は戻りません。強化に使う素材は、工房で数を確かめてから。'));
  }

  /** いま開いている実施設から級を取る。星から級は計算しない。 */
  private receptionRank(): string | null {
    const desks = this.content.hub.facilities.filter((f) => f.kind === 'quest');
    const desk = desks.find((f) => f.id === this.facilityId);
    if (!desk) return null;
    return desk.questRankId ?? null;
  }

  private rememberReceptionScroll(): void {
    if (!this.questScrollContext) return;
    const state = this.receptionStates.get(this.questScrollContext.key);
    if (!state) return;
    if (this.questScroller && this.questScroller.getClientRects().length) state.listScroll = this.questScroller.scrollTop;
    if (this.questDetailScroller && this.questDetailScroller.getClientRects().length) state.detailScroll = this.questDetailScroller.scrollTop;
  }

  /** 図鑑を閉じた時も、見えないペインから 0 を読まず、両方の位置を戻す。 */
  private restoreReceptionScroll(): void {
    if (!this.questScrollContext) return;
    const state = this.receptionStates.get(this.questScrollContext.key);
    if (!state) return;
    if (this.questScroller && this.questScroller.getClientRects().length) this.questScroller.scrollTop = state.listScroll;
    if (this.questDetailScroller && this.questDetailScroller.getClientRects().length) this.questDetailScroller.scrollTop = state.detailScroll;
  }

  private receptionView(): ReceptionViewState | undefined {
    return this.facilityId ? this.receptionStates.get(this.facilityId) : undefined;
  }

  private backReception(): void {
    if (this.busy) return;
    if (this.storyFold.open || this.bestiary.open) {
      this.storyFold.open = false;
      this.bestiary.open = false;
      this.restoreReceptionScroll();
      return;
    }
    if (this.huntConfirmId !== null || this.confirming !== null) {
      const state = this.receptionView();
      const hunt = this.huntConfirmId;
      this.huntConfirmId = null;
      this.confirming = null;
      this.renderQuests(hunt ? 'depart-' + hunt : 'delivery-open');
      return;
    }
    const state = this.receptionView();
    if (state?.stage === 'list') {
      this.rememberReceptionScroll();
      state.stage = 'stars';
      this.renderQuests('star-' + state.stars, false);
    } else if (this.host.hubWalk) {
      this.host.closeFacility();
    } else {
      this.setOpen(true, 'all');
    }
  }

  private moveReceptionSelection(delta: number): void {
    if (this.storyFold.open || this.bestiary.open || this.busy || this.huntConfirmId !== null || this.confirming !== null) return;
    const state = this.receptionView();
    if (!state) return;
    const selector = state.stage === 'stars' ? '.reception-star' : '.reception-row';
    const buttons = [...this.questBox.querySelectorAll<HTMLButtonElement>(selector)];
    if (!buttons.length) return;
    const selected = buttons.findIndex((b) => b === document.activeElement);
    const marked = buttons.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    const index = selected >= 0 ? selected : marked;
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, index < 0 ? 0 : index + delta))]!;
    if (state.stage === 'list') {
      next.click(); // 依頼書を更新するだけ。出発は別の操作。
    } else {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  /** standard mapping のパッドを受付の表示中だけ読む。開いた時の押しっぱなしは無視する。 */
  updateReceptionPad(active: boolean): void {
    if (!active || this.section !== 'quest' || !this.receptionRank() || !navigator.getGamepads || this.busy || this.storyFold.open || this.bestiary.open) {
      this.receptionPadActive = false;
      this.receptionPadPrevious = 0;
      return;
    }
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard');
    if (!pad) { this.receptionPadActive = false; this.receptionPadPrevious = 0; return; }
    const mask = ((pad.buttons[12]?.pressed || (pad.axes[1] ?? 0) < -0.55) ? 1 : 0)
      | ((pad.buttons[13]?.pressed || (pad.axes[1] ?? 0) > 0.55) ? 2 : 0)
      | ((pad.buttons[0]?.pressed ?? false) ? 4 : 0)
      | ((pad.buttons[1]?.pressed ?? false) ? 8 : 0);
    const edge = this.receptionPadActive ? mask & ~this.receptionPadPrevious : 0;
    this.receptionPadActive = true;
    this.receptionPadPrevious = mask;
    if (edge & 8) { this.backReception(); return; }
    if (edge & 1) this.moveReceptionSelection(-1);
    else if (edge & 2) this.moveReceptionSelection(1);
    else if (edge & 4) {
      const state = this.receptionView();
      const focused = document.activeElement;
      let button: HTMLButtonElement | null = null;
      if (state?.stage === 'stars') {
        button = focused instanceof HTMLButtonElement && focused.matches('.reception-star') ? focused : this.questBox.querySelector('.reception-star[aria-pressed="true"]');
      } else {
        button = this.questBox.querySelector<HTMLButtonElement>('.reception-confirm-go, .base-delivery .forge-confirm button.go, .reception-depart:not([disabled]), .base-delivery button.go:not([disabled])');
        // 確認中の最初の受注ボタンは非表示。確認の決定だけを使う。
      }
      if (button && !button.disabled) button.click();
    }
  }

  /**
   * 依頼（か里の納品）の詳細を開く（v0.38.0。物語の「この依頼へ」と、検査から使う）。即出発はしない。
   * 歩く里では、いま開いている受付の依頼だけ開き、ほかの受付の依頼なら、行き先の受付を知らせる。一覧の拠点（?hub=menu）では、その受付を開く。
   */
  showQuest(id: string): void {
    this.openStoryQuest(id);
  }

  /** 物語の入口も、即出発ではなく該当の受付・星・詳細へつなぐ。 */
  private openStoryQuest(id: string): void {
    const q = this.content.quests.get(id);
    const dv = q ? undefined : this.content.deliveries.get(id);
    if (!q && !dv) return;
    const rank = q ? q.rankId : deliveryReceptionRank(dv!);
    const name = q ? q.name : dv!.name;
    const desk = this.content.hub.facilities.find((f) => f.kind === 'quest' && f.questRankId === rank);
    if (!desk) { this.say('この依頼の受付が見つかりません。', true); return; }
    if (this.host.hubWalk && (this.section !== 'quest' || this.facilityId !== desk.id)) {
      this.receptionNotice = `「${name}」は「${desk.name}」で受けられます。里へ戻って、その受付へ向かってください。`;
      this.renderQuests();
      this.questBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (!this.host.hubWalk && this.facilityId !== desk.id) this.setOpen(true, 'quest', desk.id);
    const groups = receptionGroups(this.content, rank, this.host.fieldHunts);
    const group = groups.find((g) => g.entries.some((e) => e.id === id));
    if (!group) { this.say('この遊び方では、この依頼へ出発できません。', true); return; }
    this.rememberReceptionScroll();
    const state = this.receptionStates.get(desk.id) ?? newReceptionView(group.stars);
    selectReceptionStar(state, group.stars);
    if (state.selected !== id) state.detailScroll = 0;
    state.selected = id;
    this.huntConfirmId = null;
    this.confirming = null;
    this.receptionStates.set(desk.id, state);
    this.storyFold.open = false;
    this.bestiary.open = false;
    this.renderQuests('row-' + id, false);
  }

  /** 級の受付 → 星 → 短い一覧 → 詳細。依頼の解禁・報酬・保存は既存の判定を使う。 */
  private renderQuests(focusKey?: string, remember = true): void {
    const c = this.content;
    const doc = this.host.save.doc;
    if (remember) this.rememberReceptionScroll();
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.receptionFocus : undefined;
    this.questBox.textContent = '';
    this.questScroller = null;
    this.questDetailScroller = null;
    this.questScrollContext = null;
    const rankId = this.section === 'quest' ? this.receptionRank() : null;
    const firstRank = [...c.ranks.values()].sort((a, b) => a.order - b.order)[0]?.id;
    this.storyFold.hidden = this.section === 'quest' && rankId !== firstRank;
    this.trainingBtn.hidden = this.section === 'quest' && rankId !== firstRank;
    this.root.dataset.reception = rankId ? 'counter' : 'directory';
    this.root.dataset.receptionStage = '';

    if (this.receptionNotice) this.questBox.appendChild(el('p', 'reception-notice', this.receptionNotice));
    if (!rankId || !this.facilityId) {
      this.questBox.appendChild(el('h3', 'reception-directory-title', '級ごとの受付'));
      this.questBox.appendChild(el('p', 'reception-directory-note', this.host.hubWalk ? '里にある、それぞれの受付で依頼を選べます。看板に級の名前が付いています。' : '受付を選ぶと、その級の依頼を星ごとに確認できます。'));
      const desks = el('div', 'reception-directory');
      for (const f of c.hub.facilities.filter((x) => x.kind === 'quest')) {
        const id = f.questRankId;
        if (!id) continue;
        const groups = receptionGroups(c, id, this.host.fieldHunts);
        const count = groups.reduce((n, g) => n + g.entries.length, 0);
        const b = this.host.hubWalk ? el('article', 'reception-desk') : el('button', 'reception-desk');
        b.dataset.reception = f.id;
        b.append(el('b', undefined, f.name), el('span', undefined, groups.map((g) => `${g.stars === null ? '星未設定' : `★${g.stars}`} ${g.entries.length}件`).join(' ／ ')), el('small', undefined, `${count}件・${f.summary}`));
        if (b instanceof HTMLButtonElement) {
          b.type = 'button';
          b.addEventListener('click', () => this.setOpen(true, 'quest', f.id));
        }
        desks.appendChild(b);
      }
      this.questBox.appendChild(desks);
      return;
    }

    const groups = receptionGroups(c, rankId, this.host.fieldHunts);
    const key = this.facilityId;
    let state = this.receptionStates.get(key);
    if (!state) {
      const ready = groups.find((g) => g.entries.some((e) => e.kind === 'quest' ? questUnlocked(doc, e.quest) && !(doc.progress.questClears[e.id] ?? 0) : checkDelivery(doc, e.delivery).ok));
      state = newReceptionView((ready ?? groups[0])?.stars ?? null);
      this.receptionStates.set(key, state);
    }
    const current = state;
    if (!groups.some((g) => g.stars === current.stars)) {
      current.stars = groups[0]?.stars ?? null;
      current.selected = null;
      current.stage = 'stars';
    }
    const group = groups.find((g) => g.stars === current.stars);
    if (current.selected && !group?.entries.some((e) => e.id === current.selected)) current.selected = null;
    this.root.dataset.receptionStage = current.stage;
    const panel = el('div', 'reception-classic');
    const left = el('section', 'reception-classic-menu');
    const right = el('section', 'reception-classic-paper');
    const levelLabel = (stars: number | null): string => stars === null ? '星未設定' : '★'.repeat(stars) + '  ' + stars;
    if (current.stage === 'stars') {
      left.appendChild(el('h3', 'reception-classic-heading', '難易度を選ぶ'));
      const levels = el('div', 'reception-scroll reception-levels');
      levels.setAttribute('role', 'group');
      levels.setAttribute('aria-label', '星ごとの依頼');
      for (const g of groups) {
        const label = levelLabel(g.stars);
        const b = el('button', 'reception-star reception-level');
        b.type = 'button';
        b.dataset.stars = String(g.stars);
        b.dataset.receptionFocus = 'star-' + g.stars;
        b.setAttribute('aria-pressed', String(g.stars === current.stars));
        b.setAttribute('aria-label', (g.stars === null ? '星未設定' : '星' + g.stars) + '、' + g.entries.length + '件');
        b.append(el('b', undefined, label), el('span', undefined, g.entries.length + '件  ›'));
        b.addEventListener('click', () => {
          if (this.busy) return;
          selectReceptionStar(current, g.stars);
          this.huntConfirmId = null;
          this.confirming = null;
          this.receptionNotice = '';
          this.renderQuests(current.selected ? 'row-' + current.selected : undefined, false);
          if (!this.questBox.contains(document.activeElement)) this.questBox.querySelector<HTMLButtonElement>('.reception-row[aria-pressed="true"]')?.focus({ preventScroll: true });
        });
        levels.appendChild(b);
      }
      if (!groups.length) levels.appendChild(el('p', 'reception-empty', 'この受付に依頼はありません。'));
      left.appendChild(levels);
      right.appendChild(el('div', 'reception-classic-intro', '依頼帳'));
      right.appendChild(el('p', 'reception-classic-guide', '左の星を選び、依頼を確認してください。'));
      if (rankId === firstRank && c.board.recommend.text) right.appendChild(el('p', 'quest-recommend', c.board.recommend.text));
      right.appendChild(el('p', 'reception-classic-tip', '上下で選択・決定　／　戻るで前の画面'));
    } else {
      const header = el('div', 'reception-classic-listhead');
      const back = el('button', 'reception-back', '‹ 星を選ぶ');
      back.type = 'button';
      back.dataset.receptionFocus = 'detail-back';
      back.addEventListener('click', () => this.backReception());
      header.append(back, el('h3', 'reception-classic-heading', levelLabel(current.stars)));
      left.appendChild(header);
      const count = el('p', 'reception-count', (group?.entries.length ?? 0) + '件の依頼');
      count.setAttribute('role', 'status');
      left.appendChild(count);
      const list = el('div', 'reception-scroll reception-list');
      this.questScroller = list;
      this.questScrollContext = { key };
      list.addEventListener('scroll', () => this.rememberReceptionScroll(), { passive: true });
      // 最初に星を開いた時は受注可能な依頼を表示。選択済みのIDはそのまま。
      if (!current.selected) {
        current.selected = (group?.entries.find((e) => e.kind === 'quest' ? questUnlocked(doc, e.quest) : checkDelivery(doc, e.delivery).ok) ?? group?.entries[0])?.id ?? null;
      }
      for (const entry of group?.entries ?? []) {
        const q = entry.kind === 'quest' ? entry.quest : null;
        const d = entry.kind === 'delivery' ? entry.delivery : null;
        const locked = q ? !questUnlocked(doc, q) : checkDelivery(doc, d!).state === 'locked';
        const done = q ? (doc.progress.questClears[q.id] ?? 0) > 0 : checkDelivery(doc, d!).state === 'claimed';
        const b = el('button', 'reception-row' + (locked ? ' locked' : ''));
        b.type = 'button';
        b.dataset.quest = entry.id;
        b.dataset.rank = rankId;
        b.dataset.stars = String(entry.stars);
        b.dataset.receptionFocus = 'row-' + entry.id;
        b.setAttribute('aria-pressed', String(entry.id === current.selected));
        const title = q?.name ?? d!.name;
        b.setAttribute('aria-label', title + '、' + (q ? questGoal(c, q, true) : '里の素材納品') + '、' + (locked ? '未解放、条件を見る' : done ? '達成済み、詳細を見る' : '詳細を見る'));
        b.appendChild(q ? questIconStrip(c, q) : deliveryIconStrip());
        const rowText = el('span', 'reception-row-text');
        rowText.appendChild(el('b', 'reception-row-name', title));
        const kind = q ? QUEST_ACTIVITY_LABELS[questActivity(q)] : '里納品';
        const lane = q?.board && q.board.lane !== 'free' ? QUEST_LANE_NAMES[q.board.lane] : '';
        rowText.appendChild(el('span', 'reception-row-meta', kind + (lane ? ' ／ ' + lane : '')));
        b.appendChild(rowText);
        b.appendChild(el('span', 'reception-row-state' + (done ? ' done' : ''), locked ? '未解放' : done ? '済' : d && !checkDelivery(doc, d).ok ? '素材不足' : '›'));
        b.addEventListener('click', () => {
          if (this.busy) return;
          this.rememberReceptionScroll();
          if (current.selected !== entry.id) {
            current.selected = entry.id;
            current.detailScroll = 0;
            this.confirming = null;
            this.huntConfirmId = null;
            this.receptionNotice = '';
            this.renderQuests('row-' + entry.id, false);
          } else {
            b.focus({ preventScroll: true });
          }
        });
        list.appendChild(b);
      }
      if (!group?.entries.length) list.appendChild(el('p', 'reception-empty', 'この受付の依頼は、まだありません。'));
      left.appendChild(list);
      const detail = el('div', 'reception-scroll reception-detail reception-classic-detail');
      this.questDetailScroller = detail;
      detail.addEventListener('scroll', () => this.rememberReceptionScroll(), { passive: true });
      const picked = group?.entries.find((e) => e.id === current.selected);
      const actions = el('div', 'reception-classic-actions');
      if (picked) this.renderReceptionDetail(detail, picked, actions);
      else detail.appendChild(el('p', 'reception-classic-guide', '依頼を選んでください。'));
      right.appendChild(detail);
      if (actions.childElementCount) right.appendChild(actions);
    }
    panel.append(left, right);
    this.questBox.appendChild(panel);
    this.restoreReceptionScroll();
    const focus = focusKey ?? oldFocus;
    if (focus) {
      const match = [...this.questBox.querySelectorAll<HTMLButtonElement>('[data-reception-focus]')].find((b) => b.dataset.receptionFocus === focus);
      if (match && !match.disabled) {
        match.focus({ preventScroll: true });
        if (match.matches('.reception-row')) match.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  private renderReceptionDetail(pane: HTMLElement, entry: ReceptionEntry, actions: HTMLElement): void {
    const c = this.content;
    const doc = this.host.save.doc;
    const title = entry.kind === 'quest' ? entry.quest.name : entry.delivery.name;
    pane.appendChild(el('p', 'reception-paper-kicker', '狩人組合　依頼書'));
    pane.appendChild(el('h3', 'reception-detail-title', title));
    pane.appendChild(entry.kind === 'quest' ? questIconStrip(c, entry.quest) : deliveryIconStrip());
    if (entry.kind === 'delivery') { this.renderDeliveryDetail(pane, entry.delivery); return; }
    const q = entry.quest;
    const field = this.host.fieldHunts ? fieldOf(c, q) : null;
    const limit = minutesText(questTimeLimitTicks(c, q, this.host.fieldHunts));
    const facts = el('dl', 'reception-facts');
    const fact = (label: string, value: string): void => { facts.append(el('dt', undefined, label), el('dd', undefined, value)); };
    fact('目標', questGoal(c, q));
    fact('難度', `${entry.stars === null ? '星未設定' : starRow(entry.stars)} ／ ${c.ranks.get(q.rankId)?.name ?? q.rankId}`);
    fact('制限時間', `${limit} ／ 力尽き ${q.maxFaints}回で失敗`);
    if (q.board) fact('クリアの目安', `${q.board.clearMinutes[0]}〜${q.board.clearMinutes[1]}分`);
    if (field) fact('狩場', field.name);
    if (q.rewards) fact('報酬', `${q.rewards.money} 通貨 ＋ ${q.gather ? '納品で余った素材' : '素材'}`);
    if (q.supplies?.length) fact('支給品', q.supplies.map((s) => `${c.items.get(s.itemId)?.name ?? s.itemId} ×${s.count}`).join('、'));
    pane.appendChild(facts);
    if (q.gather && field) {
      const areas = [...new Set(q.gather.nodes.map((n) => n.areaId))].map((id) => field.areas.find((a) => a.id === id)).filter((a) => !!a).map((a) => a.kind === 'camp' ? a.name : `エリア${a.no} ${a.name}`);
      pane.appendChild(el('p', 'reception-detail-note', `採取点: ${areas.join('・')}。この出発で採った品を野営地の納品箱へ。大型・幼体は出ません。`));
    }
    pane.appendChild(el('p', 'reception-summary', q.summary));
    if (q.board) {
      pane.appendChild(el('h4', 'reception-client', `依頼人: ${q.board.client}`));
      pane.appendChild(el('p', 'reception-letter', q.board.text));
    }
    const unlocked = questUnlocked(doc, q);
    if (!unlocked) {
      const need = (q.requires ?? []).filter((id) => !(doc.progress.questClears[id] ?? 0)).map((id) => `「${c.quests.get(id)?.name ?? id}」`);
      pane.appendChild(el('p', 'reception-locked-note', `${need.join('と')}を達成すると受けられます。`));
    }
    pane.appendChild(el('p','reception-detail-note','出発準備：'+prepText(lifeOf(doc).prep)+'｜装備 '+(c.weapons.get(doc.equippedWeaponId)?.name??'現在の武器')));
    const canDepart = (): boolean => !this.busy && this.receptionRank() === q.rankId && this.receptionView()?.selected === q.id && questUnlocked(this.host.save.doc, q);
    if (unlocked && this.huntConfirmId === q.id) {
      actions.appendChild(el('p', 'reception-confirm-question', 'この依頼を受注しますか？'));
      const yes = el('button', 'reception-confirm-go', '出発する');
      yes.type = 'button';
      yes.dataset.quest = q.id;
      yes.dataset.receptionFocus = 'confirm-' + q.id;
      yes.disabled = this.busy;
      yes.addEventListener('click', () => {
        if (this.huntConfirmId !== q.id || !canDepart()) return;
        this.rememberReceptionScroll();
        this.huntConfirmId = null;
        this.host.startHunt(q.id);
      });
      const no = el('button', 'reception-confirm-no', 'やめる');
      no.type = 'button';
      no.addEventListener('click', () => {
        this.huntConfirmId = null;
        this.renderQuests('depart-' + q.id);
      });
      actions.append(no, yes);
    } else {
      if (this.huntConfirmId === q.id) this.huntConfirmId = null;
      const go = el('button', 'reception-depart', unlocked ? '受注する' : '解放条件を満たしていません');
      go.type = 'button';
      go.dataset.quest = q.id;
      go.dataset.receptionFocus = 'depart-' + q.id;
      go.disabled = !unlocked || this.busy;
      go.addEventListener('click', () => {
        if (!canDepart()) return;
        this.huntConfirmId = q.id;
        this.renderQuests('confirm-' + q.id);
      });
      actions.appendChild(go);
    }
  }

  /** 里の納品は詳細から確認する。保存処理は従来どおり在庫と残す数を再検査する。 */
  private renderDeliveryDetail(pane: HTMLElement, d: DeliveryDef): void {
    const c = this.content;
    const doc = this.host.save.doc;
    const chk = checkDelivery(doc, d);
    const name = (id: string): string => c.materials.get(id)?.name ?? id;
    const box = el('div', `base-delivery ${chk.state}`);
    box.dataset.delivery = d.id;
    box.dataset.state = chk.state;
    box.appendChild(el('b', undefined, `★${d.stars}　里の納品${chk.state === 'claimed' ? '・納品済み' : ''}`));
    box.appendChild(el('span', undefined, `報酬 ${d.money} 通貨・一度限り・制限なし・出発なし`));
    const ul = el('ul', 'forge-cost');
    for (const i of chk.items) {
      const text = chk.state === 'claimed'
        ? `${name(i.itemId)} ${i.need} 個を納品済み（いまの所持 ${i.have} 個）`
        : `${name(i.itemId)} ${i.need} 個を渡す（所持 ${i.have} 個。${i.after < i.keep ? `残す分を含めて、あと ${i.keep - i.after} 個要る` : `納品の後 ${i.after} 個`}。${i.keep} 個は残す）`;
      ul.appendChild(withIcon(el('li', chk.state === 'short' && i.after < i.keep ? 'short' : undefined), i.itemId, text));
    }
    box.appendChild(ul);
    box.append(el('h4', 'reception-client', `依頼人: ${d.client}`), el('p', 'reception-letter', d.text));
    if (chk.state === 'locked') {
      const need = d.requires.filter((id) => !(doc.progress.questClears[id] ?? 0)).map((id) => `「${c.quests.get(id)?.name ?? id}」`);
      box.appendChild(el('p', 'reception-locked-note', `${need.join('と')}を達成すると受けられます。`));
    } else if (chk.state === 'ready' && this.confirming === d.id) {
      const p = el('p', 'forge-confirm', `${chk.items.map((i) => `${name(i.itemId)} ${i.need} 個（残り ${i.after} 個）`).join('、')}を渡して、${d.money} 通貨を受け取ります。元には戻せません。`);
      const yes = el('button', 'go', 'この内容で納品する');
      yes.type = 'button';
      yes.disabled = this.busy;
      yes.dataset.receptionFocus = 'delivery-confirm';
      yes.addEventListener('click', () => {
        if (this.busy || this.receptionRank() !== deliveryReceptionRank(d)) return;
        this.confirming = null;
        void this.run('渡しています', () => this.host.save.deliver(d.id), `「${d.name}」を納品しました（+${d.money} 通貨）。`);
      });
      const no = el('button', undefined, 'やめる');
      no.type = 'button';
      no.dataset.receptionFocus = 'delivery-cancel';
      no.addEventListener('click', () => { this.confirming = null; this.renderQuests('delivery-open'); });
      p.append(yes, no);
      box.appendChild(p);
    } else if (chk.state !== 'claimed') {
      const b = el('button', 'go', chk.ok ? '納品する数を確認' : '素材が足りません（残す数を含めて）');
      b.type = 'button';
      b.dataset.receptionFocus = 'delivery-open';
      b.disabled = !chk.ok || this.busy;
      b.addEventListener('click', () => { this.confirming = d.id; this.renderQuests('delivery-confirm'); });
      box.appendChild(b);
    }
    pane.appendChild(box);
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
    let packs = 0;
    // 工房からの支給（v0.26.0）: 物語の依頼の後に、1 度だけ受け取れる材料。受け取るだけ（装備は替わらない）
    for (const pack of c.support.packs) {
      const st = supportState(doc, pack);
      const box = el('div', `forge-support ${st}`);
      box.dataset.pack = pack.id;
      box.dataset.state = st;
      box.appendChild(el('b', undefined, `${pack.name}${st === 'claimed' ? '　受け取り済み' : ''}`));
      box.appendChild(el('span', 'forge-support-text', pack.text));
      const ul = el('ul', 'forge-cost');
      for (const s of pack.items) ul.appendChild(withIcon(el('li'), s.itemId, `${c.materials.get(s.itemId)?.name ?? s.itemId} ×${s.count}`));
      box.appendChild(ul);
      if (st === 'locked') {
        const need = pack.requires.filter((id) => !(doc.progress.questClears[id] ?? 0)).map((id) => `「${c.quests.get(id)?.name ?? id}」`);
        box.appendChild(el('p', 'base-note', `${need.join('と')}を達成すると受け取れます。`));
      } else if (st === 'ready') {
        const b = el('button', 'go', '受け取る');
        b.addEventListener('click', () => void this.run('受け取っています', () => this.host.save.claimSupport(pack.id), `${pack.name}を受け取りました。`));
        box.appendChild(b);
        packs++;
      }
      this.forgeBody.appendChild(box);
    }
    const equipped = this.host.weaponId;
    const rankName = (itemId: string): string => {
      const order = this.matRank.get(itemId) ?? 1;
      const r = order > 1 ? [...c.ranks.values()].find((x) => x.order === order) : undefined;
      return r ? `（${r.name}から）` : '';
    };
    const nameOf = (id: string): string => c.weapons.get(id)?.name ?? c.armor.get(id)?.name ?? id;
    // 強化の前後の性能（武器は属性・状態異常・会心も。v0.34.0）
    const statOf = (id: string): string => (c.weapons.has(id) ? weaponStat(c, c.weapons.get(id)!) : `防御力 ${c.armor.get(id)?.defense ?? 0}`);
    const section = (title: string, kind: RecipeDef['kind'], ownedIds: string[]): void => {
      this.forgeBody.appendChild(el('p', 'forge-head', title));
      const next = [...c.recipes.values()].filter((r) => r.kind === kind && checkCraft(doc, r).ownsBase);
      // 系列の装備の強化（v0.34.0）は、結果の級が開くまでできない（ガルドロスの段の道は、いつも開いている）
      const chkOf = (r: RecipeDef) => checkCraft(doc, r, craftRankOpen(doc, c, r));
      const sortKey = (r: RecipeDef): number => (recipeFrom(r) === equipped ? 0 : chkOf(r).ok ? 1 : 2);
      next.sort((x, y) => sortKey(x) - sortKey(y));
      for (const r of next) {
        const chk = chkOf(r);
        if (chk.ownsResult) continue;
        const from = recipeFrom(r)!;
        const to = recipeResult(r);
        const box = el('div', 'forge-recipe');
        box.dataset.recipe = r.id;
        box.appendChild(el('b', undefined, `${nameOf(from)} → ${nameOf(to)}`));
        box.appendChild(el('span', 'forge-stat', `${statOf(from)} → ${statOf(to).replace(/^\S+ /, '')}`));
        box.appendChild(lifePreviewLink(to));
        const ul = el('ul', 'forge-cost');
        for (const i of chk.items) {
          const short = i.have < i.need;
          ul.appendChild(withIcon(el('li', short ? 'short' : undefined), i.itemId, `${c.materials.get(i.itemId)?.name ?? i.itemId} ${i.have} / ${i.need}${short ? rankName(i.itemId) : ''}`));
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
          const b = el('button', 'go', !chk.rankOpen ? 'まだ強化できない級です' : chk.ok ? '強化する' : '素材か通貨が足りません');
          b.disabled = !chk.ok;
          b.addEventListener('click', () => {
            this.confirming = r.id;
            this.refresh();
          });
          box.appendChild(b);
        }
        this.forgeBody.appendChild(box);
      }
      // 最後の段まで進んだもの（強化で作られ、進める先のレシピが無い。作った初級の装備は、次の級がまだ無いので数えない）
      const sources = new Set([...c.recipes.values()].map(recipeFrom));
      const upgraded = new Set([...c.recipes.values()].filter((r) => r.kind === 'upgrade' || r.kind === 'armor_upgrade').map(recipeResult));
      const done = ownedIds.filter((id) => (c.weapons.has(id) || c.armor.has(id)) && !sources.has(id) && upgraded.has(id));
      if (done.length > 0) this.forgeBody.appendChild(el('p', 'forge-done', `最後の段まで強化済み: ${done.map((id) => `${nameOf(id)}（${statOf(id)}）`).join('　')}`));
    };
    section('武器', 'upgrade', doc.weapons);
    section('防具', 'armor_upgrade', doc.armor);
    const made = this.renderMake(nameOf);
    const notes = [ready > 0 ? `強化できます: ${ready}` : '', made > 0 ? `作れます: ${made}` : '', packs > 0 ? '支給を受け取れます' : ''].filter(Boolean);
    this.forge.querySelector('summary')!.textContent = notes.length ? `工房（${notes.join('・')}）` : '工房';
  }

  /**
   * 作る（v0.32.0。ChatGPT の全装備四級版 #15 の直接生産）: 系列ごとにたたんだ欄。作れる数を返す。
   * 級の開いていない物は「まだ作れない級」、持っている物は「持っています」。作った物は装備箱で持ち替える（装備は替えない）。
   */
  private renderMake(nameOf: (id: string) => string): number {
    const c = this.content;
    const doc = this.host.save.doc;
    const crafts = [...c.recipes.values()].filter((r) => r.kind === 'craft' || r.kind === 'armor_craft');
    if (crafts.length === 0) return 0;
    const seriesOf = (r: RecipeDef): string => (r.kind === 'craft' ? c.weapons.get(r.resultWeaponId)?.series : r.kind === 'armor_craft' ? c.armor.get(r.resultArmorId)?.series : undefined) ?? '';
    const groups = new Map<string, RecipeDef[]>();
    for (const r of crafts) groups.set(seriesOf(r), [...(groups.get(seriesOf(r)) ?? []), r]);
    const wrap = el('details', 'forge-make');
    wrap.appendChild(el('summary', 'forge-head', '作る（新しい系列の装備）'));
    wrap.appendChild(el('p', 'base-note', '素材と通貨で、新しい武器・防具を作ります（持っている装備は減りません）。作った物は装備箱で持ち替えます。採取装備は鉱石・骨に応じた仮の外見になります。'));
    let ready = 0;
    for (const [series, list] of groups) {
      const species = c.monsters.get(`monster.${series.split('.')[1] ?? ''}`)?.name ?? '';
      const label = nameOf(recipeResult(list[0]!)).split('の')[0] ?? series;
      const box = el('details', 'forge-series');
      box.dataset.series = series;
      const head = el('summary');
      box.appendChild(head);
      let can = 0, have = 0;
      for (const r of list) {
        const rankOpen = craftRankOpen(doc, c, r);
        const chk = checkCraft(doc, r, rankOpen);
        const to = recipeResult(r);
        const w = c.weapons.get(to), a = c.armor.get(to);
        const row = el('div', 'forge-recipe');
        row.dataset.recipe = r.id;
        row.appendChild(el('b', undefined, nameOf(to)));
        row.appendChild(el('span', 'forge-stat', w ? weaponStat(c, w) : a ? armorStat(c, a, '防御力') : ''));
        row.appendChild(lifePreviewLink(to));
        if (chk.ownsResult) {
          have++;
          row.classList.add('owned');
          row.appendChild(el('span', 'forge-owned', '持っています'));
          box.appendChild(row);
          continue;
        }
        const ul = el('ul', 'forge-cost');
        for (const i of chk.items) ul.appendChild(withIcon(el('li', i.have < i.need ? 'short' : undefined), i.itemId, `${c.materials.get(i.itemId)?.name ?? i.itemId} ${i.have} / ${i.need}`));
        ul.appendChild(el('li', chk.money.have >= chk.money.need ? undefined : 'short', `通貨 ${chk.money.have} / ${chk.money.need}`));
        row.appendChild(ul);
        if (chk.ok) can++;
        if (this.confirming === r.id && chk.ok) {
          box.open = true;
          wrap.open = true;
          const p = el('p', 'forge-confirm', `素材と通貨を使って、${nameOf(to)}を作ります。元には戻せません。`);
          const yes = el('button', 'go', '作る');
          yes.addEventListener('click', () => {
            this.confirming = null;
            void this.run('作っています', () => this.host.save.craft(r.id), `${nameOf(to)}を作りました。装備箱で持ち替えられます。`).then((ok) => {
              if (ok) this.host.saveChanged();
            });
          });
          const no = el('button', undefined, 'やめる');
          no.addEventListener('click', () => {
            this.confirming = null;
            this.refresh();
          });
          p.append(yes, no);
          row.appendChild(p);
        } else {
          const b = el('button', 'go', !chk.rankOpen ? 'まだ作れない級です' : chk.ok ? '作る' : '素材か通貨が足りません');
          b.disabled = !chk.ok;
          b.addEventListener('click', () => {
            this.confirming = r.id;
            this.refresh();
          });
          row.appendChild(b);
        }
        box.appendChild(row);
      }
      head.textContent = `${label}（${species}の素材）　${list.length} 点${can > 0 ? `・作れる ${can}` : ''}${have > 0 ? `・持っている ${have}` : ''}`;
      ready += can;
      wrap.appendChild(box);
    }
    this.forgeBody.appendChild(wrap);
    return ready;
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

