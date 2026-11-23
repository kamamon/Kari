// 拡大（ダブルタップ・ピンチ）を止める。
// CSS の touch-action だけでは iPhone の Safari で拡大されることがあったので、イベント側でも既定の動作を止める。
// 入力は Pointer Events で受けているため、touch イベントを止めても操作には影響しない。

const TAP_MS = 350;
const TAP_MOVE = 12;
const DOUBLE_MS = 450;

const active = { passive: false } as const;
const stop = (e: Event): void => {
  if (e.cancelable) e.preventDefault();
};

/** 操作領域（canvas とタッチ層）: 拡大・スクロール・長押しメニューをすべて止める */
export function guardSurface(el: HTMLElement): void {
  for (const type of ['touchstart', 'touchmove', 'touchend'] as const) el.addEventListener(type, stop, active);
}

/** ページ全体: ピンチと、ボタンや余白の連続タップでの拡大を止める。起動時に 1 回だけ呼ぶ。 */
export function installGestureGuard(): void {
  // Safari 独自のピンチ
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, stop, active);
  document.addEventListener('dblclick', stop, active);

  // ボタンや余白を続けて叩いた時。2 回目の既定の動作（拡大）を止め、ボタンなら自前で押す（preventDefault は click も止めるため）。
  let start = { x: 0, y: 0, t: 0 };
  let lastTap = -1e9;
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.changedTouches[0];
      if (t) start = { x: t.clientX, y: t.clientY, t: performance.now() };
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      const now = performance.now();
      const isTap = !!t && now - start.t < TAP_MS && Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_MOVE;
      if (!isTap) return;
      const quick = now - lastTap < DOUBLE_MS;
      lastTap = now;
      if (!quick || !e.cancelable || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest('input, select, textarea, a, [contenteditable]')) return;
      e.preventDefault();
      // 折りたたみの見出し（summary）も、ボタンと同じく自前で押す（止めたままだと開閉できない）
      const button = target.closest<HTMLElement>('button, summary');
      if (button && !(button instanceof HTMLButtonElement && button.disabled)) {
        swallow = { el: button, until: now + 500 };
        button.click();
      }
    },
    active,
  );
  // 上で自前で押した直後に、ブラウザ側の click も届いた場合は二重に押さない
  let swallow: { el: Element; until: number } | null = null;
  document.addEventListener(
    'click',
    (e) => {
      if (!swallow || !e.isTrusted || performance.now() > swallow.until) return;
      if (e.target instanceof Element && e.target.closest('button, summary') === swallow.el) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );

  // それでも拡大された時は、viewport の指定を入れ直して等倍へ戻す（拡大したまま戻せなくなるのを防ぐ）
  const vv = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (vv && meta) {
    const base = meta.content;
    let flip = false;
    let timer = 0;
    vv.addEventListener('resize', () => {
      if (vv.scale <= 1.02 || timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (vv.scale <= 1.02) return;
        flip = !flip;
        meta.content = flip ? `${base}, minimum-scale=1` : base;
      }, 250);
    });
  }
}
