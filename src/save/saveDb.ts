// 保存データの置き場所。IndexedDB（本番）と、メモリ（保存できない端末・テスト）の 2 つ。
// どちらも「1 回の書き込み = 現在のデータを読む → 決める → 書く」を、途中に何も挟まずに行う。
// IndexedDB では 1 つの readwrite transaction の中で行い、complete してから「書けた」と返す。
//
// DB の名前はゲーム固有にする（同じドメインの別の作品・開発版と混ざらないように）。

export const DB_NAME = 'veilbound-hunters:prod:save';
const DB_VERSION = 1;
const SLOTS = 'slots';
const BACKUPS = 'backups';
/** 控え（書き換える前のデータ）を残す数。古いものから消す */
export const KEEP_BACKUPS = 5;

export interface BackupMeta {
  /** なぜ控えたか: session（起動後の最初の書き込みの前）/ import（取り込みの前）/ restore（控えから戻す前）/ migrate（古い版から直す前）/ reset（壊れたデータの退避） */
  reason: string;
  savedAt: string;
}

export interface StoredBackup extends BackupMeta {
  id: number;
  slotId: string;
  doc: unknown;
}

/** 1 回の書き込みで行うこと。write が無ければ何も書かない。 */
export interface TxPlan<T> {
  write?: unknown;
  /** 同じ書き込みの中で、控えへ入れるもの（ふつうは書き換える前のデータ） */
  backup?: BackupMeta & { doc: unknown };
  result: T;
}

export interface SaveBackend {
  /** ページを閉じても残るか */
  readonly persistent: boolean;
  read(slotId: string): Promise<unknown | null>;
  /**
   * 1 回の書き込み。apply は、現在のデータ（無ければ null）を受け取って、何を書くかを返す。
   * apply の中で待ち合わせはできない（同期で決める）。例外を投げると、何も書かずに取り消す。
   * 書き込みが完了してから解決する。
   */
  transact<T>(slotId: string, apply: (current: unknown | null) => TxPlan<T>): Promise<T>;
  /** 控えの一覧（新しい順） */
  backups(slotId: string): Promise<StoredBackup[]>;
  close(): void;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** メモリの上だけの置き場所。ページを閉じると消える。テストでは「別のタブ」を、同じ置き場所を共有する 2 つの管理役で表す。 */
export class MemoryBackend implements SaveBackend {
  readonly persistent = false;
  private slots = new Map<string, unknown>();
  private log: StoredBackup[] = [];
  private nextId = 1;
  /** テスト用: 次の書き込みを、この理由で失敗させる（容量不足などの代わり） */
  failNext: Error | null = null;
  /** テスト用: 書き込んだ回数 */
  writes = 0;

  read(slotId: string): Promise<unknown | null> {
    return Promise.resolve(this.slots.has(slotId) ? clone(this.slots.get(slotId)) : null);
  }

  transact<T>(slotId: string, apply: (current: unknown | null) => TxPlan<T>): Promise<T> {
    try {
      const plan = apply(this.slots.has(slotId) ? clone(this.slots.get(slotId)) : null);
      if (plan.write !== undefined || plan.backup) {
        if (this.failNext) {
          const e = this.failNext;
          this.failNext = null;
          throw e;
        }
      }
      if (plan.backup) {
        this.log.push({ id: this.nextId++, slotId, reason: plan.backup.reason, savedAt: plan.backup.savedAt, doc: clone(plan.backup.doc) });
        const mine = this.log.filter((b) => b.slotId === slotId);
        for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_BACKUPS))) this.log.splice(this.log.indexOf(old), 1);
      }
      if (plan.write !== undefined) {
        this.slots.set(slotId, clone(plan.write));
        this.writes++;
      }
      return Promise.resolve(plan.result);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  backups(slotId: string): Promise<StoredBackup[]> {
    return Promise.resolve(clone(this.log.filter((b) => b.slotId === slotId).reverse()));
  }

  close(): void {
    // 何もしない
  }

  /** テスト用: 置いてあるデータを直接入れる（古い版・壊れたデータ・新しい版の再現） */
  seed(slotId: string, raw: unknown): void {
    this.slots.set(slotId, clone(raw));
  }

  /** テスト用: 置いてあるデータをそのまま見る */
  peek(slotId: string): unknown | null {
    return this.slots.has(slotId) ? clone(this.slots.get(slotId)) : null;
  }
}

/** IndexedDB の置き場所。 */
export class IdbBackend implements SaveBackend {
  readonly persistent = true;

  private constructor(private db: IDBDatabase) {
    // 別のタブが DB の構造を新しくしようとしたら、こちらは閉じて道を空ける（以後の書き込みは失敗として知らせる）
    db.onversionchange = () => db.close();
  }

  /** 開く。使えない端末・設定では失敗する（呼ぶ側でメモリの置き場所へ切り替える）。 */
  static open(factory: IDBFactory, timeoutMs = 4000): Promise<IdbBackend> {
    return new Promise<IdbBackend>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      // 開く要求に返事が来ないブラウザがある（プライベートブラウズなど）。待ち続けない
      const timer = setTimeout(() => finish(() => reject(new Error('保存の場所を開けませんでした（時間切れ）'))), timeoutMs);
      let req: IDBOpenDBRequest;
      try {
        req = factory.open(DB_NAME, DB_VERSION);
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SLOTS)) db.createObjectStore(SLOTS, { keyPath: 'slotId' });
        if (!db.objectStoreNames.contains(BACKUPS)) {
          const b = db.createObjectStore(BACKUPS, { keyPath: 'id', autoIncrement: true });
          b.createIndex('slotId', 'slotId');
        }
      };
      req.onsuccess = () => {
        if (done) {
          req.result.close();
          return;
        }
        finish(() => resolve(new IdbBackend(req.result)));
      };
      req.onerror = () => finish(() => reject(req.error ?? new Error('保存の場所を開けませんでした')));
      req.onblocked = () => finish(() => reject(new Error('保存の場所を開けませんでした（ほかのタブが使用中）')));
    });
  }

  read(slotId: string): Promise<unknown | null> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(SLOTS, 'readonly');
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const req = tx.objectStore(SLOTS).get(slotId);
      let value: unknown = null;
      req.onsuccess = () => (value = req.result === undefined ? null : (req.result as unknown));
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error ?? new Error('保存データを読めませんでした'));
    });
  }

  transact<T>(slotId: string, apply: (current: unknown | null) => TxPlan<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction([SLOTS, BACKUPS], 'readwrite');
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const slots = tx.objectStore(SLOTS);
      const backups = tx.objectStore(BACKUPS);
      let result: T | undefined;
      let decided = false;
      let failure: unknown = null;
      const get = slots.get(slotId);
      get.onsuccess = () => {
        try {
          const plan = apply(get.result === undefined ? null : (get.result as unknown));
          result = plan.result;
          decided = true;
          if (plan.backup) {
            backups.add({ slotId, reason: plan.backup.reason, savedAt: plan.backup.savedAt, doc: plan.backup.doc });
            // 古い控えを、同じ書き込みの中で消す（index は ID の小さい順 = 古い順に返る）
            const keys = backups.index('slotId').getAllKeys(IDBKeyRange.only(slotId));
            keys.onsuccess = () => {
              const all = keys.result;
              for (const k of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) backups.delete(k);
            };
          }
          if (plan.write !== undefined) slots.put(plan.write);
        } catch (e) {
          failure = e;
          try {
            tx.abort();
          } catch {
            // すでに取り消されている
          }
        }
      };
      // 「書けた」と言えるのは、transaction が complete してから
      tx.oncomplete = () => {
        if (decided) resolve(result as T);
        else reject(new Error('保存の途中で止まりました'));
      };
      tx.onabort = () => {
        const e = failure ?? tx.error ?? new Error('保存が取り消されました');
        reject(e instanceof Error ? e : new Error(String(e)));
      };
    });
  }

  backups(slotId: string): Promise<StoredBackup[]> {
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(BACKUPS, 'readonly');
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const req = tx.objectStore(BACKUPS).index('slotId').getAll(IDBKeyRange.only(slotId));
      let out: StoredBackup[] = [];
      req.onsuccess = () => (out = (req.result as StoredBackup[]).slice().reverse());
      tx.oncomplete = () => resolve(out);
      tx.onabort = () => reject(tx.error ?? new Error('控えを読めませんでした'));
    });
  }

  close(): void {
    this.db.close();
  }
}
