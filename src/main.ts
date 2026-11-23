// 入口。機能検出 → データ読み込み → 「はじめる」で音声を初期化してゲーム開始。
// 読み込みに失敗しても黒画面で止めず、理由と再試行ボタンを出す。
import './ui/style.css';
import { App } from './app';
import { APP_VERSION, BUILD_ID, loadContent } from './core/assets';
import { AudioSystem } from './core/audio';
import type { Content } from './data/schemas';
import { guardSurface, installGestureGuard } from './input/gestureGuard';
import { IdbBackend, type SaveBackend } from './save/saveDb';
import { SaveManager } from './save/saveManager';
import { SettingsStore } from './save/settings';
import { enableSwipeToShrinkBars, fullscreenHint } from './ui/fullscreen';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const status = $('boot-status');
  const startBtn = $<HTMLButtonElement>('boot-start');
  const retryBtn = $<HTMLButtonElement>('boot-retry');
  const hint = fullscreenHint();
  const swipe = enableSwipeToShrinkBars();
  $('boot-note').textContent = `v${APP_VERSION} (${BUILD_ID}) ／ 仮モデル・仮の音で動作を確かめる段階です${hint ? `\n${hint}` : ''}${swipe ? '\nタブのまま遊ぶ場合: この画面を上へなぞると、上の欄が小さくなることがあります。' : ''}`;
  startBtn.hidden = true;
  retryBtn.hidden = true;

  if (!hasWebGL2()) {
    status.textContent = 'この端末・ブラウザでは 3D 表示（WebGL2）が使えません。\niPhone / iPad は iOS 15 以降の Safari、PC は最新の Chrome・Edge・Safari・Firefox でお試しください。';
    return;
  }

  status.textContent = '読み込み中…';
  let content: Content;
  try {
    content = await loadContent();
  } catch (e) {
    console.error(e);
    status.textContent = `読み込みに失敗しました。\n${e instanceof Error ? e.message.split('\n').slice(0, 4).join('\n') : String(e)}`;
    retryBtn.hidden = false;
    retryBtn.onclick = () => void boot();
    return;
  }

  // 里の持ち物・装備・進行の保存を開く。使えない端末では、保存なしで動かす（知らせは拠点の画面に出る）
  status.textContent = '保存データを読んでいます…';
  let backend: SaveBackend | null = null;
  try {
    if (typeof indexedDB !== 'undefined') backend = await IdbBackend.open(indexedDB);
  } catch (e) {
    console.warn('保存の場所を開けませんでした', e);
  }
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const save = await SaveManager.open(content, backend, {
    now: () => new Date().toISOString(),
    appVersion: APP_VERSION,
    requestPersist: storage && typeof storage.persist === 'function' ? () => storage.persist() : undefined,
  });

  const store = new SettingsStore();
  const audio = new AudioSystem(store.value);
  status.textContent = '横向きで遊びます。音が出ます。';
  startBtn.hidden = false;
  startBtn.onclick = () => {
    startBtn.disabled = true;
    // 音声はこのボタン操作の中で開始する（自動再生制限のため）
    void audio.start();
    try {
      const canvas = $<HTMLCanvasElement>('game');
      const app = new App(canvas, $('ui'), content, store, audio, save);
      guardSurface(canvas);
      const touchLayer = document.getElementById('touch');
      if (touchLayer) guardSurface(touchLayer);
      $('boot').hidden = true;
      app.start();
      (window as unknown as { __vh?: unknown }).__vh = app;
    } catch (e) {
      console.error(e);
      startBtn.disabled = false;
      startBtn.hidden = true;
      status.textContent = `起動に失敗しました。\n${e instanceof Error ? e.message : String(e)}`;
      retryBtn.hidden = false;
      retryBtn.onclick = () => location.reload();
    }
  };
}

installGestureGuard();
void boot();
