// 保存の管理役。いまの保存データ（メモリの写し）を持ち、変える時は必ず置き場所への 1 回の書き込みを通す。
// メモリの写しは、書き込みが完了してから入れ替える（書けていないものを「持っている」と見せない）。
//
// 別のタブが先に書いていた時（revision が合わない時）は、こちらの古い内容で上書きしない。
// - 報酬の受け取りは、新しい内容を読み直して、その上へ足す（同じ依頼は 1 度だけなので安全）。
// - 強化・装備・取り込みは、新しい内容を読み直すところまでで止め、利用者にやり直してもらう。
import type { ArmorSlot, Content } from '../data/schemas';
import {
  RuleError,
  SLOT_ID,
  cloneSave,
  buy,
  craft,
  equip,
  equipArmor,
  exportText,
  grantStarters,
  newSave,
  parseImport,
  readSave,
  sell,
  settleRun,
  type ReadResult,
  type RunRewards,
  type SaveDoc,
  type SaveStamp,
} from './profile';
import { MemoryBackend, type SaveBackend, type StoredBackup } from './saveDb';

/**
 * persistent: 端末に保存
 * memory: 保存できない（ページを閉じると消える）
 * readonly: 置いてあるデータを読めないので、そのデータには触れない。今回の変更はメモリの上だけで持つ（ページを閉じると消える）
 */
export type SaveMode = 'persistent' | 'memory' | 'readonly';

/** 別のタブが先に書いていた。latest は置き場所にある新しい内容。 */
export class ConflictError extends Error {
  constructor(readonly latest: SaveDoc) {
    super('ほかのタブで内容が変わっていました');
    this.name = 'ConflictError';
  }
}

/** 置いてあるデータが、この版では読めない（新しい版のもの、または壊れている）。上書きしない。 */
export class UnreadableError extends Error {
  constructor(readonly detail: ReadResult) {
    super(detail.kind === 'newer' ? '新しい版の保存データです' : '保存データを読めません');
    this.name = 'UnreadableError';
  }
}

export interface SaveEnv {
  /** 現在時刻（ISO 8601）。保存の時刻として記録するだけ */
  now: () => string;
  appVersion: string;
  /** 「消されにくい保存」をブラウザへ頼む（対応している時だけ）。結果は表示に使うだけ */
  requestPersist?: () => Promise<boolean>;
}

export type SaveResult = { ok: true } | { ok: false; reason: 'conflict' | 'rule' | 'failed' | 'invalid'; message: string; errors?: string[] };

type Mutate = (doc: SaveDoc) => SaveDoc | null;

export class SaveManager {
  /** いまの保存データ（書き込みが完了した内容）。直接は書き換えない */
  doc: SaveDoc;
  mode: SaveMode;
  /** 起動時に利用者へ伝えること（保存できない、読めない、古い版から直した、など）。無ければ null */
  notice: string | null = null;
  /** 読めなかった時の、置いてあったデータそのもの（書き出して控えられるように持っておく） */
  unreadable: unknown | null = null;
  /** ブラウザが「消されにくい保存」を認めたか（未確認は null） */
  persisted: boolean | null = null;
  private listeners: (() => void)[] = [];
  private sessionBackupDone = false;
  private persistAsked = false;
  /** 書き込みは 1 つずつ順番に行う（同じタブの中で、自分の書き込み同士がぶつからないように） */
  private queue: Promise<unknown> = Promise.resolve();

  /** 書き込み先。readonly の間は、端末の置き場所ではなくメモリ（読めないデータに触れないため） */
  private backend: SaveBackend;

  private constructor(
    private content: Content,
    /** 端末の置き場所（保存できない端末ではメモリ） */
    private real: SaveBackend,
    private env: SaveEnv,
    doc: SaveDoc,
    mode: SaveMode,
  ) {
    this.doc = doc;
    this.mode = mode;
    this.backend = mode === 'readonly' ? new MemoryBackend() : real;
  }

  private stamp(): SaveStamp {
    return { now: this.env.now(), appVersion: this.env.appVersion, contentVersion: this.content.contentVersion };
  }

  /**
   * 開く。backend が null（IndexedDB が使えない）なら、メモリだけで動かす。
   * 置いてあるデータが読めない時は、何も書かずに、新しいデータで遊べる状態にする（readonly）。
   */
  static async open(content: Content, backend: SaveBackend | null, env: SaveEnv): Promise<SaveManager> {
    const stamp: SaveStamp = { now: env.now(), appVersion: env.appVersion, contentVersion: content.contentVersion };
    const fresh = (): SaveDoc => {
      const d = newSave(content, stamp);
      return grantStarters(d, content) ?? d;
    };
    if (!backend) {
      const m = new SaveManager(content, new MemoryBackend(), env, fresh(), 'memory');
      m.notice = 'この端末（またはブラウザの設定）では、データを保存できません。ページを閉じると、持ち物と装備は最初に戻ります。';
      return m;
    }
    let raw: unknown | null;
    try {
      raw = await backend.read(SLOT_ID);
    } catch {
      const m = new SaveManager(content, new MemoryBackend(), env, fresh(), 'memory');
      m.notice = '保存データを読めませんでした。今回は保存なしで動かします（ページを閉じると、持ち物と装備は最初に戻ります）。';
      return m;
    }
    if (raw === null) return new SaveManager(content, backend, env, fresh(), backend.persistent ? 'persistent' : 'memory');
    const r = readSave(raw);
    if (r.kind !== 'ok') {
      const m = new SaveManager(content, backend, env, fresh(), 'readonly');
      m.unreadable = raw;
      m.notice =
        r.kind === 'newer'
          ? 'この端末には、新しい版で保存したデータがあります。この版では読めないので、そのデータには触れません。今回の持ち物と装備は保存されません（ページを読み込み直して新しい版にすると、元のデータで遊べます）。'
          : `保存データを読めませんでした（${r.errors.slice(0, 2).join('、')}）。そのデータには触れません。今回の持ち物と装備は保存されません。`;
      return m;
    }
    const m = new SaveManager(content, backend, env, r.doc, backend.persistent ? 'persistent' : 'memory');
    // 古い版から直した時と、最初から持つ武器が増えた時は、直した内容を書き込む（元は控えへ）
    const granted = grantStarters(r.doc, content);
    if (r.migratedFrom !== null || granted) {
      const res = await m.commit(() => granted ?? cloneSave(r.doc), { backupReason: r.migratedFrom !== null ? 'migrate' : undefined, rawBase: raw, expected: r.doc.revision });
      if (!res.ok) {
        // 書けなくても遊べるように、直した内容をメモリに持つ
        m.doc = granted ?? r.doc;
        m.notice = 'データの更新を保存できませんでした。遊ぶことはできますが、次の保存に失敗するかもしれません。';
      } else if (r.migratedFrom !== null) m.notice = '保存データを新しい形へ直しました（元のデータは控えに残してあります）。';
    }
    return m;
  }

  onChange(l: () => void): void {
    this.listeners.push(l);
  }

  private setDoc(doc: SaveDoc): void {
    this.doc = doc;
    for (const l of this.listeners) l();
  }

  /** 前の書き込みが終わってから実行する。 */
  private inOrder<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * 1 回の書き込み。置き場所にある内容を読み、こちらが見ていた revision と同じ時だけ、mutate の結果を書く。
   * mutate が null を返したら、書かずに成功とする（変える所が無い）。
   */
  private commit(mutate: Mutate, opt: { backupReason?: string; rawBase?: unknown; expected?: number } = {}): Promise<SaveResult> {
    return this.inOrder(() => this.commitNow(mutate, opt));
  }

  private async commitNow(mutate: Mutate, opt: { backupReason?: string; rawBase?: unknown; expected?: number }): Promise<SaveResult> {
    const expected = opt.expected ?? this.doc.revision;
    const memory = this.doc;
    const stamp = this.stamp();
    const wantSessionBackup = !this.sessionBackupDone;
    try {
      const written = await this.backend.transact<SaveDoc | null>(SLOT_ID, (cur) => {
        let base: SaveDoc;
        if (cur === null) {
          // 置き場所が空。最初の書き込みか、ブラウザにデータを消された後。メモリの写しを土台にして書き直す
          base = cloneSave(memory);
        } else {
          const r = readSave(cur);
          if (r.kind !== 'ok') throw new UnreadableError(r);
          base = r.doc;
          if (base.revision !== expected) throw new ConflictError(base);
        }
        const starters = grantStarters(base, this.content);
        const next = mutate(starters ?? base);
        if (next === null && !starters && cur !== null) return { result: null };
        const out = cloneSave(next ?? starters ?? base);
        out.slotId = SLOT_ID;
        out.revision = base.revision + 1;
        out.updatedAt = stamp.now;
        out.appVersion = stamp.appVersion;
        out.contentVersion = stamp.contentVersion;
        const reason = opt.backupReason ?? (wantSessionBackup && cur !== null ? 'session' : undefined);
        return { write: out, backup: reason && cur !== null ? { reason, savedAt: stamp.now, doc: opt.rawBase ?? cur } : undefined, result: out };
      });
      if (written) {
        this.sessionBackupDone = true;
        this.setDoc(written);
        this.askPersist();
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof ConflictError) {
        // 新しい内容を読み直す（こちらの古い内容では上書きしない）
        const granted = grantStarters(e.latest, this.content);
        this.setDoc(granted ?? e.latest);
        return { ok: false, reason: 'conflict', message: 'ほかのタブで内容が変わっていたので、読み込み直しました。もう一度お試しください。' };
      }
      if (e instanceof RuleError) return { ok: false, reason: 'rule', message: e.message };
      if (e instanceof UnreadableError) return { ok: false, reason: 'failed', message: `${e.message}。保存していません。` };
      return { ok: false, reason: 'failed', message: `保存できませんでした（${e instanceof Error ? e.message : String(e)}）。` };
    }
  }

  private askPersist(): void {
    if (this.persistAsked || this.mode !== 'persistent' || !this.env.requestPersist) return;
    this.persistAsked = true;
    void this.env.requestPersist().then(
      (ok) => {
        this.persisted = ok;
        for (const l of this.listeners) l();
      },
      () => (this.persisted = false),
    );
  }

  /**
   * 依頼の報酬を確定する。同じ runId は 1 度だけ。
   * 別のタブが先に書いていたら、新しい内容の上へ足し直す。
   */
  async settle(r: RunRewards): Promise<SaveResult> {
    let last: SaveResult = { ok: false, reason: 'failed', message: '保存できませんでした。' };
    for (let i = 0; i < 3; i++) {
      last = await this.commit((doc) => settleRun(doc, r));
      if (last.ok || last.reason !== 'conflict') return last;
    }
    return last;
  }

  /** この runId の報酬を、もう確定してあるか（メモリの写しで見る） */
  isSettled(runId: string): boolean {
    return this.doc.settledRuns.includes(runId);
  }

  craft(recipeId: string): Promise<SaveResult> {
    const recipe = this.content.recipes.get(recipeId);
    if (!recipe) return Promise.resolve({ ok: false, reason: 'rule', message: 'その強化はありません。' });
    return this.commit((doc) => craft(doc, recipe));
  }

  /** 商店で道具を買う / 素材を売る（通貨と持ち物を、1 回の書き込みで変える） */
  buy(itemId: string, count: number): Promise<SaveResult> {
    return this.commit((doc) => buy(doc, this.content.shop, itemId, count));
  }

  sell(itemId: string, count: number): Promise<SaveResult> {
    return this.commit((doc) => sell(doc, this.content.shop, itemId, count));
  }

  equip(weaponId: string): Promise<SaveResult> {
    return this.commit((doc) => equip(doc, weaponId));
  }

  /** 防具を、部位ごとに替える・外す（armorId が null なら外す） */
  equipArmor(slot: ArmorSlot, armorId: string | null): Promise<SaveResult> {
    return this.commit((doc) => equipArmor(doc, this.content, slot, armorId));
  }

  /** 書き出し用のテキスト（いまの保存データ）。読めないデータがある時は、それをそのまま出す。 */
  exportText(): string {
    if (this.mode === 'readonly' && this.unreadable !== null) return JSON.stringify(this.unreadable, null, 2);
    return exportText(this.doc, this.env.now());
  }

  /** 書き出したテキストを取り込む。検証してから、いまのデータを控えへ入れ、入れ替える。 */
  async importText(text: string): Promise<SaveResult> {
    const r = parseImport(text);
    if (r.kind === 'newer') return { ok: false, reason: 'invalid', message: '新しい版で書き出したデータです。この版では取り込めません。' };
    if (r.kind === 'invalid') return { ok: false, reason: 'invalid', message: '取り込めませんでした。', errors: r.errors };
    return this.replaceWith(r.doc, 'import');
  }

  backups(): Promise<StoredBackup[]> {
    return this.real.backups(SLOT_ID).catch(() => []);
  }

  /** 控えの内容へ戻す。いまのデータは控えへ入る。 */
  async restoreBackup(id: number): Promise<SaveResult> {
    const b = (await this.backups()).find((x) => x.id === id);
    if (!b) return { ok: false, reason: 'invalid', message: 'その控えはもうありません。' };
    const r = readSave(b.doc);
    if (r.kind !== 'ok') return { ok: false, reason: 'invalid', message: 'その控えは、この版では読めません。' };
    return this.replaceWith(r.doc, 'restore');
  }

  private replaceWith(doc: SaveDoc, reason: 'import' | 'restore'): Promise<SaveResult> {
    // 古い版で書き出したデータには、後から増えた「最初から持つ武器・防具」が無い。入れ替える時に配っておく
    const ready = grantStarters(doc, this.content) ?? doc;
    return this.commit(() => cloneSave(ready), { backupReason: reason });
  }

  /**
   * 読めないデータを控えへ移して、新しいデータで保存を始める（利用者が選んだ時だけ）。
   * 読めないデータは消さず、控えに残る。
   */
  resetUnreadable(): Promise<SaveResult> {
    return this.inOrder(() => this.resetNow());
  }

  private async resetNow(): Promise<SaveResult> {
    if (this.mode !== 'readonly') return { ok: false, reason: 'rule', message: '読めないデータはありません。' };
    const stamp = this.stamp();
    const memory = this.doc;
    try {
      const written = await this.real.transact<SaveDoc>(SLOT_ID, (cur) => {
        const out = cloneSave(memory);
        out.slotId = SLOT_ID;
        out.revision = memory.revision + 1;
        out.updatedAt = stamp.now;
        return { write: out, backup: cur !== null ? { reason: 'reset', savedAt: stamp.now, doc: cur } : undefined, result: out };
      });
      this.backend = this.real;
      this.mode = this.real.persistent ? 'persistent' : 'memory';
      this.unreadable = null;
      this.notice = null;
      this.sessionBackupDone = true;
      this.setDoc(written);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'failed', message: `保存できませんでした（${e instanceof Error ? e.message : String(e)}）。` };
    }
  }
}
