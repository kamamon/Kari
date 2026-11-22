// 全画面の扱い。
// iPhone の Safari には、ページを全画面にする仕組み（Fullscreen API）が無い。URL の欄を消すには「ホーム画面に追加」したアイコンから開く。
// iPad・Android・PC は Fullscreen API を使える。

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** ホーム画面のアイコンから開いている（ブラウザの枠が無い）か */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || ['standalone', 'fullscreen'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches);
}

export function canFullscreen(): boolean {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<boolean> {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  try {
    if (isFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else d.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen?.();
  } catch {
    /* 拒否された時は何もしない */
  }
  return isFullscreen();
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** ブラウザのタブで開いていて、ページ側から全画面にできない端末（iPhone の Safari など）か */
export function inBrowserTabWithoutFullscreen(): boolean {
  return !isStandalone() && !canFullscreen() && window.matchMedia('(pointer: coarse)').matches;
}

/** 画面を広く使うための案内。必要が無い時は null。 */
export function fullscreenHint(): string | null {
  if (!inBrowserTabWithoutFullscreen()) return null;
  return isIOS()
    ? '上の URL やタブの欄を消すには: ① Safari の共有ボタン（□に↑）→ ②「ホーム画面に追加」→ ③ ホーム画面にできたアイコンから開く。Safari のタブで開いている間は、ページの側からは消せません。'
    : '上の URL の欄を消すには: ブラウザのメニュー →「ホーム画面に追加」。ホーム画面にできたアイコンから開いてください。';
}

/**
 * タブのまま遊ぶ人向け: ページ全体を少しだけ縦に動かせるようにする。
 * Safari は、ページを下へ送ると上の欄を小さくたたむ。ゲームの画面は固定してあるので、動くのは欄だけ。
 * （操作領域は指の既定の動作を止めているので、遊んでいる間にページが動くことは無い）
 */
export function enableSwipeToShrinkBars(): boolean {
  if (!inBrowserTabWithoutFullscreen()) return false;
  document.documentElement.classList.add('swipe-bars');
  return true;
}
