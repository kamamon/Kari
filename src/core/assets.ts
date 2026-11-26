// 素材とデータの読み込み。URL は必ず Vite の BASE_URL から作る（ルート固定の /assets/ を書かない）。
import type { Content } from '../data/schemas';
import { assembleContent, type LoadOptions } from '../data/validators';

declare const __BUILD_ID__: string;
declare const __APP_VERSION__: string;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

export class LoadError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`読み込みに失敗: ${path} (${detail})`);
    this.path = path;
  }
}

/** JSON を取得する。失敗時は少し待って再試行し、それでも駄目なら LoadError を投げる。 */
export async function fetchJson(path: string, retries = 2): Promise<unknown> {
  let last = 'unknown';
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(assetUrl(path), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (i < retries) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw new LoadError(path, last);
}

/** ゲームのデータを読む。opts.motionSet: ハンターの動きの組（v0.57.0。無ければ、いまの組） */
export function loadContent(opts: LoadOptions = {}): Promise<Content> {
  return assembleContent((p) => fetchJson(`data/${p}`), opts);
}
