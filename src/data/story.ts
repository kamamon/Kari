// 物語「帰り道の灯」（ChatGPT のストーリー設計 v1。Pull Request #7。v0.23.0 で、序章と第 1 章（S0）だけを入れた）。
// データは public/data/story.json。決まりは docs/spec.md の 24 章。
// 進み方は、保存データの「依頼の達成回数」（progress.questClears）から決める（保存の形は変えない。S0 の決まり）。
// ここは計算だけ（画面と保存には触れない）。

/** 話す人。portrait は会話の顔（src/ui/artIndex.ts の PORTRAITS の名前）。無ければ、名前だけ。faces は表情 → 顔の名前（v0.29.0） */
export interface StorySpeaker {
  name: string;
  role: string;
  portrait?: string;
  faces?: Record<string, string>;
}

/** 台詞 1 つ。variants は、帰還の報告で、討伐か捕獲かで変える言葉（any = どちらか分からない時。読み返す時もこれ） */
export interface StoryLine {
  who?: string;
  text?: string;
  variants?: { slay: string; capture: string; any: string };
  /** 主人公の返事（どれを選んでも、話は同じに続く。選んだものは保存しない） */
  choices?: string[];
  /** 表情（話す人の faces の名前。無ければ平静の顔。v0.29.0） */
  face?: string;
}

export interface StoryScene {
  id: string;
  title: string;
  /** 場所と時（画面の上に小さく出す） */
  place: string;
  lines: StoryLine[];
  /** 読み終えた後に出す、まとめの 1 行（記録の一覧にも出す） */
  summary: string;
  /** 会話の窓の後ろに出す場面の絵（src/ui/artIndex.ts の STORY_ART の名前。v0.29.0） */
  art?: string;
}

/** 章の中の 1 つの狩り（いまある依頼を使う。S0） */
export interface StoryStep {
  id: string;
  questId: string;
  label: string;
  /** 出発の前に読む場面（無ければ brief の文だけ） */
  briefScene?: string;
  brief: string;
  /** 初めて達成した帰還の後に読む場面 */
  reportScene?: string;
}

export interface StoryChapter {
  id: string;
  no: number;
  title: string;
  place: string;
  /** 狩場の名前（登録簿の fields。景色の原画を出すため） */
  field?: string;
  goal: string;
  /** 本筋の標的（表示名。まだ遊べない章の予告にも使う） */
  targets: string[];
  /** 遊べる章か（狩場・標的・依頼がそろった章だけ true。まだの章は、章の区切りと目的だけを見せる） */
  playable: boolean;
  /** 章の始めに読む場面 */
  openScene?: string;
  steps?: StoryStep[];
  /** すべての狩りを達成した後に読む、章の報告 */
  reportScene?: string;
}

export interface StoryDef {
  schemaVersion: number;
  id: string;
  title: string;
  note: string;
  speakers: Record<string, StorySpeaker>;
  chapters: StoryChapter[];
  scenes: StoryScene[];
  /** 決まった短い文: 遊べる所をすべて済ませて、まだ遊べない章へ来た時 */
  common: { unplayable: string };
}

export type StoryOutcome = 'slay' | 'capture' | 'any';

/** 台詞の言葉（討伐・捕獲で変える所は、outcome で選ぶ） */
export function lineText(line: StoryLine, outcome: StoryOutcome = 'any'): string {
  if (line.variants) return line.variants[outcome] ?? line.variants.any;
  return line.text ?? '';
}

type Clears = Readonly<Record<string, number>>;
const cleared = (clears: Clears, questId: string): boolean => (clears[questId] ?? 0) > 0;

export interface StepView {
  def: StoryStep;
  done: boolean;
}

export interface ChapterView {
  def: StoryChapter;
  /** done = 本筋の狩りをすべて達成 / current = いま進めている / open = 読むだけの章（序章） / unplayable = まだ遊べない */
  status: 'done' | 'current' | 'open' | 'unplayable';
  steps: StepView[];
}

export interface StoryView {
  chapters: ChapterView[];
  /** 次にすすめる狩り（無ければ、遊べる所はすべて済み） */
  next: { chapter: StoryChapter; step: StoryStep } | null;
  /** いま読める場面（物語の順） */
  readable: string[];
}

/** 章ごとの、場面が読めるようになる条件（場面の id → 条件）。開く場面は、いつでも読める */
function unlockRules(story: StoryDef): Map<string, (c: Clears) => boolean> {
  const rules = new Map<string, (c: Clears) => boolean>();
  for (const ch of story.chapters) {
    if (!ch.playable) continue;
    if (ch.openScene) rules.set(ch.openScene, () => true);
    for (const st of ch.steps ?? []) {
      if (st.briefScene && !rules.has(st.briefScene)) rules.set(st.briefScene, () => true);
      if (st.reportScene) rules.set(st.reportScene, (c) => cleared(c, st.questId));
    }
    if (ch.reportScene) {
      const ids = (ch.steps ?? []).map((s) => s.questId);
      rules.set(ch.reportScene, (c) => ids.length > 0 && ids.every((q) => cleared(c, q)));
    }
  }
  return rules;
}

/** いまの物語の様子（保存データの達成回数から） */
export function storyView(story: StoryDef, clears: Clears): StoryView {
  const chapters: ChapterView[] = story.chapters.map((def) => {
    const steps = (def.steps ?? []).map((s) => ({ def: s, done: cleared(clears, s.questId) }));
    const status = !def.playable ? 'unplayable' : steps.length === 0 ? 'open' : steps.every((s) => s.done) ? 'done' : 'current';
    return { def, status, steps };
  });
  let next: StoryView['next'] = null;
  for (const ch of chapters) {
    if (ch.status !== 'current') continue;
    const st = ch.steps.find((s) => !s.done);
    if (st) {
      next = { chapter: ch.def, step: st.def };
      break;
    }
  }
  const rules = unlockRules(story);
  const order = story.scenes.map((s) => s.id);
  const readable = order.filter((id) => rules.get(id)?.(clears) ?? false);
  return { chapters, next, readable };
}

/**
 * 依頼の結果を保存した前後で、新しく読めるようになった場面（帰還の後に、1 回だけ自動で開く）。
 * 達成回数が 0 → 1 になった時だけ。同じ結果を何度保存し直しても（runId で 1 度だけ）、増えない。
 */
export function scenesUnlocked(story: StoryDef, before: Clears, after: Clears): string[] {
  const rules = unlockRules(story);
  return story.scenes.map((s) => s.id).filter((id) => {
    const r = rules.get(id);
    return !!r && !r(before) && r(after);
  });
}

/** 台詞の顔の名前（表情があれば、その顔。無ければ平静の顔。顔の無い人は undefined） */
export function lineFace(sp: StorySpeaker | undefined, line: StoryLine): string | undefined {
  if (!sp) return undefined;
  return (line.face && sp.faces?.[line.face]) || sp.portrait;
}

/** データの決まり。questIds は、いまある依頼。portraits は、顔の絵のある名前。art は、場面の絵のある名前 */
export function validateStory(story: StoryDef, questIds: ReadonlySet<string>, portraits?: ReadonlySet<string>, art?: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const scenes = new Map(story.scenes.map((s) => [s.id, s]));
  if (scenes.size !== story.scenes.length) errors.push('scene の id が重複');
  for (const [k, sp] of Object.entries(story.speakers)) {
    if (!sp.name) errors.push(`speaker ${k}: name が無い`);
    if (sp.portrait && portraits && !portraits.has(sp.portrait)) errors.push(`speaker ${k}: 顔の絵 ${sp.portrait} が無い`);
    for (const [face, name] of Object.entries(sp.faces ?? {})) {
      if (!sp.portrait) errors.push(`speaker ${k}: 平静の顔が無いのに、表情 ${face} がある`);
      if (portraits && !portraits.has(name)) errors.push(`speaker ${k}: 表情 ${face} の顔の絵 ${name} が無い`);
    }
  }
  for (const s of story.scenes) {
    if (!s.title || !s.place || !s.summary) errors.push(`scene ${s.id}: title / place / summary が無い`);
    if (s.lines.length === 0) errors.push(`scene ${s.id}: 台詞が無い`);
    if (s.art !== undefined && art && !art.has(s.art)) errors.push(`scene ${s.id}: 場面の絵 ${s.art} が無い`);
    for (const l of s.lines) {
      if (l.who && !story.speakers[l.who]) errors.push(`scene ${s.id}: 話す人 ${l.who} が無い`);
      if (!l.text && !l.variants && !l.choices?.length) errors.push(`scene ${s.id}: 中身の無い台詞`);
      if (l.variants && !(l.variants.slay && l.variants.capture && l.variants.any)) errors.push(`scene ${s.id}: 討伐・捕獲・共通の言葉がそろっていない`);
      if (!l.who && !l.choices?.length) errors.push(`scene ${s.id}: 話す人の無い台詞`);
      if (l.face !== undefined && !(l.who && story.speakers[l.who]?.faces?.[l.face])) errors.push(`scene ${s.id}: 表情 ${l.face} が、話す人 ${l.who ?? '（無し）'} に無い`);
    }
  }
  const used = new Set<string>();
  const ref = (where: string, id: string | undefined): void => {
    if (id === undefined) return;
    if (!scenes.has(id)) errors.push(`${where}: 場面 ${id} が無い`);
    used.add(id);
  };
  const ids = new Set<string>();
  for (const ch of story.chapters) {
    const w = `chapter ${ch.id}`;
    if (ids.has(ch.id)) errors.push(`${w}: id が重複`);
    ids.add(ch.id);
    if (!ch.title || !ch.place || !ch.goal) errors.push(`${w}: title / place / goal が無い`);
    ref(w, ch.openScene);
    ref(w, ch.reportScene);
    for (const st of ch.steps ?? []) {
      // 遊べる章の狩りは、いまある依頼だけ（まだ無い依頼を、遊べるように見せない）
      if (!questIds.has(st.questId)) errors.push(`${w} step ${st.id}: 依頼 ${st.questId} が無い`);
      if (!st.brief) errors.push(`${w} step ${st.id}: brief が無い`);
      ref(`${w} step ${st.id}`, st.briefScene);
      ref(`${w} step ${st.id}`, st.reportScene);
    }
    if (!ch.playable && (ch.steps?.length || ch.openScene || ch.reportScene)) errors.push(`${w}: まだ遊べない章に、狩りや場面がある`);
    if (ch.playable && ch.no > 0 && !(ch.steps?.length)) errors.push(`${w}: 遊べる章に狩りが無い`);
  }
  for (const s of story.scenes) if (!used.has(s.id)) errors.push(`scene ${s.id}: どの章からも使われていない`);
  if (!story.common?.unplayable) errors.push('common.unplayable が無い');
  return errors;
}
