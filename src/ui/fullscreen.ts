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

/** 画面を広く使うための案内。必要が無い時は null。 */
export function fullscreenHint(): string | null {
  if (isStandalone() || canFullscreen()) return null;
  if (!window.matchMedia('(pointer: coarse)').matches) return null;
  return isIOS()
    ? '画面を広く使うには: Safari の共有 →「ホーム画面に追加」。ホーム画面にできたアイコンから開くと、URL の欄が出ません。'
    : '画面を広く使うには: ブラウザのメニュー →「ホーム画面に追加」。ホーム画面にできたアイコンから開くと、URL の欄が出ません。';
}
