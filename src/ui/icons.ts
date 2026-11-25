// 道具と素材のアイコン（ChatGPT の追加原画。v0.23.0）。絵が無い素材（ガルドロス以外の素材など）は、何も出さない。
// 絵は飾り（alt は空）。文字は、これまでどおり横に出すので、読み上げと検査は文字で行う。
import { assetUrl } from '../core/assets';
import { ITEM_ICONS, PORTRAITS, FIELD_ART } from './artIndex';

export function iconUrl(id: string): string | null {
  const f = ITEM_ICONS[id];
  return f ? assetUrl(`assets/icons/${f}.webp`) : null;
}

/** 文字の前に置くアイコン。絵が無ければ null */
export function iconEl(id: string, cls = 'ico'): HTMLImageElement | null {
  const u = iconUrl(id);
  if (!u) return null;
  const img = document.createElement('img');
  img.className = cls;
  img.src = u;
  img.alt = '';
  img.decoding = 'async';
  img.dataset.icon = id;
  return img;
}

/** アイコン（あれば）と文字を、1 つの要素にまとめる */
export function withIcon<T extends HTMLElement>(e: T, id: string, text: string): T {
  const img = iconEl(id);
  if (img) e.appendChild(img);
  e.appendChild(document.createTextNode(text));
  return e;
}

/** 会話の顔（ミナギ・ロクハ・イサネ）。無ければ null */
export function portraitUrl(who: string): string | null {
  const f = PORTRAITS[who];
  return f ? assetUrl(`assets/portraits/${f}.webp`) : null;
}

/** 狩場の景色の原画（登録簿の狩場の名前から）。無ければ null */
export function fieldArtUrl(name: string): string | null {
  const f = FIELD_ART[name];
  return f ? assetUrl(`assets/fields/${f}.webp`) : null;
}
