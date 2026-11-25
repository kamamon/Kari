// 物語「帰り道の灯」の画面（v0.23.0）: 会話の窓（StoryDialog）と、依頼板の物語の欄（renderStoryPanel）。
// 会話は、安全な場所（里・拠点）でだけ開く。読み返しても、報酬・進み方・選んだ返事は変わらない（何も保存しない）。
import type { Content } from '../data/schemas';
import { lineFace, lineText, storyView, type StoryLine, type StoryOutcome, type StoryScene } from '../data/story';
import { fieldArtUrl, portraitUrl, storyArtUrl } from './icons';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export interface StoryPlay {
  sceneId: string;
  outcome?: StoryOutcome;
}

/** 会話の窓。場面を順に読む。「次へ」で 1 つずつ進み、「閉じる」でいつでも閉じられる */
export class StoryDialog {
  readonly root: HTMLElement;
  private head: HTMLElement;
  private face: HTMLImageElement;
  private faceBox: HTMLElement;
  private who: HTMLElement;
  private text: HTMLElement;
  private buttons: HTMLElement;
  private queue: StoryPlay[] = [];
  private scene: StoryScene | null = null;
  private outcome: StoryOutcome = 'any';
  private index = 0;
  private onDone: (() => void) | null = null;

  constructor(parent: HTMLElement, private content: Content) {
    const root = el('div');
    root.id = 'story';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const box = el('div', 'story-box');
    this.head = el('p', 'story-head');
    this.faceBox = el('div', 'story-face');
    this.face = document.createElement('img');
    this.face.alt = '';
    this.faceBox.appendChild(this.face);
    const body = el('div', 'story-body');
    this.who = el('p', 'story-who');
    this.text = el('p', 'story-text');
    this.text.setAttribute('aria-live', 'polite');
    this.buttons = el('div', 'story-buttons');
    body.append(this.who, this.text, this.buttons);
    const close = el('button', 'story-close', '閉じる');
    close.addEventListener('click', () => this.close());
    box.append(this.head, this.faceBox, body, close);
    root.appendChild(box);
    parent.appendChild(root);
    this.root = root;
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'Enter' || e.key === ' ') {
        const first = this.buttons.querySelector('button');
        if (first) (first as HTMLButtonElement).click();
      } else return;
      e.preventDefault();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** 場面を順に読む。読み終えた（閉じた）時に onDone */
  play(list: readonly StoryPlay[], onDone?: () => void): void {
    this.queue = list.filter((p) => this.content.story.scenes.some((s) => s.id === p.sceneId));
    if (this.queue.length === 0) return;
    this.onDone = onDone ?? null;
    this.root.hidden = false;
    this.nextScene();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.queue = [];
    this.scene = null;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private nextScene(): void {
    const p = this.queue.shift();
    if (!p) {
      this.close();
      return;
    }
    this.scene = this.content.story.scenes.find((s) => s.id === p.sceneId)!;
    this.outcome = p.outcome ?? 'any';
    this.index = 0;
    this.root.dataset.scene = this.scene.id;
    // 場面の絵（v0.29.0）: 窓の後ろに出す。無い場面は、後ろのゲームの画面のまま
    const art = this.scene.art ? storyArtUrl(this.scene.art) : null;
    this.root.classList.toggle('has-art', !!art);
    // CSS の変数の中の相対の URL は、CSS のファイルの場所から解かれる（BASE_URL が ./ の時に assets/assets/ になる）ので、文書の場所から絶対の URL にしておく
    this.root.style.setProperty('--story-art', art ? `url("${new URL(art, document.baseURI).href}")` : 'none');
    this.root.dataset.art = this.scene.art ?? '';
    this.show();
  }

  private show(): void {
    const s = this.scene!;
    this.head.textContent = `${s.title}　—　${s.place}`;
    this.buttons.textContent = '';
    if (this.index >= s.lines.length) {
      // 場面の終わり: まとめの 1 行
      this.who.textContent = '記録';
      this.text.textContent = s.summary;
      this.root.dataset.face = '';
      this.setFace(null);
      const more = this.queue.length > 0;
      this.addButton(more ? '次の話へ' : '閉じる', () => (more ? this.nextScene() : this.close()));
      return;
    }
    const line: StoryLine = s.lines[this.index]!;
    if (line.choices?.length) {
      this.who.textContent = 'あなた';
      this.text.textContent = '';
      this.root.dataset.face = '';
      this.setFace(null);
      for (const c of line.choices) this.addButton(c, () => this.advance(), 'story-choice');
      return;
    }
    const sp = line.who ? this.content.story.speakers[line.who] : undefined;
    this.who.textContent = sp ? `${sp.name}（${sp.role}）` : '';
    this.text.textContent = lineText(line, this.outcome);
    const face = lineFace(sp, line);
    this.root.dataset.face = face ?? '';
    this.setFace(face ? portraitUrl(face) : null, sp?.name);
    this.addButton('次へ', () => this.advance());
  }

  private advance(): void {
    this.index++;
    this.show();
  }

  private setFace(url: string | null, name = ''): void {
    this.faceBox.classList.toggle('none', !url);
    this.faceBox.dataset.initial = url ? '' : name.slice(0, 1);
    if (url) {
      if (this.face.getAttribute('src') !== url) this.face.src = url;
      this.face.hidden = false;
    } else this.face.hidden = true;
  }

  private addButton(label: string, onClick: () => void, cls = 'story-next'): void {
    const b = el('button', cls, label);
    b.addEventListener('click', onClick);
    this.buttons.appendChild(b);
  }
}

const STATUS: Record<string, string> = { done: '済み', current: '進めている', open: '読める', unplayable: 'まだ遊べません' };

export interface StoryPanelHost {
  openStory(sceneIds: string[]): void;
  startHunt(questId: string): void;
  questUnlocked(questId: string): boolean;
}

/** 依頼板の「物語」の欄: いまの章と、次の狩り、読み返せる記録、章の一覧 */
export function renderStoryPanel(box: HTMLElement, content: Content, clears: Readonly<Record<string, number>>, host: StoryPanelHost): void {
  const story = content.story;
  const view = storyView(story, clears);
  box.textContent = '';
  box.appendChild(el('h3', 'story-title', `物語「${story.title}」`));
  const playable = story.chapters.filter((c) => c.playable).length;
  box.appendChild(el('p', 'story-note', `遊べるのは、${story.chapters.filter((c) => c.playable).map((c) => c.title.replace(/「.*$/, '')).join('と')}まで（${playable} / ${story.chapters.length}）。ほかの章は、狩場と依頼ができてから入ります。`));
  if (view.next) {
    const { chapter, step } = view.next;
    const nx = el('div', 'story-next-hunt');
    nx.dataset.step = step.id;
    nx.append(el('b', undefined, `${chapter.title}`), el('span', 'story-goal', `目的: ${chapter.goal}`), el('span', 'story-step', `次の狩り: ${step.label}`), el('span', 'story-brief', step.brief));
    const bs = el('div', 'story-actions');
    if (step.briefScene) {
      const talk = el('button', 'story-talk', '話を聞く');
      talk.addEventListener('click', () => host.openStory([step.briefScene!]));
      bs.appendChild(talk);
    }
    const go = el('button', 'story-go', 'この依頼へ');
    go.dataset.quest = step.questId;
    go.disabled = !host.questUnlocked(step.questId);
    go.addEventListener('click', () => host.startHunt(step.questId));
    bs.appendChild(go);
    nx.appendChild(bs);
    box.appendChild(nx);
  } else box.appendChild(el('p', 'story-unplayable', story.common.unplayable));

  // 読み返せる記録（帰還記録）
  const rec = el('details', 'story-records');
  rec.appendChild(el('summary', undefined, `帰還記録を読む（${view.readable.length}）`));
  const list = el('div', 'story-record-list');
  for (const id of view.readable) {
    const s = story.scenes.find((x) => x.id === id)!;
    const b = el('button', 'story-record');
    b.dataset.scene = id;
    b.append(el('b', undefined, s.title), el('span', undefined, s.summary));
    b.addEventListener('click', () => host.openStory([id]));
    list.appendChild(b);
  }
  rec.appendChild(list);
  box.appendChild(rec);

  // 章の一覧（序章・8 章・終章）。景色の原画は、開いた時に読む
  const chs = el('details', 'story-chapters');
  chs.appendChild(el('summary', undefined, `章の一覧（${story.chapters.length}）`));
  const cards = el('div', 'story-chapter-list');
  chs.addEventListener('toggle', () => {
    if (!chs.open || cards.childElementCount > 0) return;
    for (const ch of view.chapters) {
      const card = el('div', `story-chapter ${ch.status}`);
      card.dataset.chapter = ch.def.id;
      const art = ch.def.field ? fieldArtUrl(ch.def.field) : null;
      if (art) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = art;
        img.loading = 'lazy';
        card.appendChild(img);
      }
      const t = el('div', 'story-chapter-text');
      t.append(el('b', undefined, ch.def.title), el('span', 'state', STATUS[ch.status] ?? ''), el('span', undefined, `${ch.def.place}${ch.def.targets.length ? `　標的: ${ch.def.targets.join('・')}` : ''}`), el('span', undefined, `目的: ${ch.def.goal}`));
      if (ch.steps.length) t.appendChild(el('span', 'story-steps', ch.steps.map((s) => `${s.done ? '✓' : '・'} ${s.def.label}`).join('　')));
      card.appendChild(t);
      cards.appendChild(card);
    }
  });
  chs.appendChild(cards);
  box.appendChild(chs);
}
