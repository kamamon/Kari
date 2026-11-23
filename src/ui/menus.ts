// メニュー（設定 / 操作表 / 検証）。設定画面は通常のスクロールを保つ（touch-action を殺さない）。
import { APP_VERSION, BUILD_ID } from '../core/assets';
import type { Settings, SettingsStore } from '../save/settings';
import { canFullscreen, fullscreenHint, isFullscreen, isStandalone, toggleFullscreen } from './fullscreen';

export interface MenuHost {
  closeMenu(): void;
  startLayoutEdit(): void;
  restartTraining(): void;
  resumeAudio(): Promise<boolean>;
  runDeterminismCheck(): string;
  /** 報告に付ける行（装備・設定・描画の計測） */
  reportLines(): string[];
  resetMeter(): void;
  audioState(): string;
  /** いまの行き先（訓練か依頼か）と、その説明 */
  sessionInfo(): { hunt: boolean; done: boolean; title: string; lines: string[] };
  /** 訓練なら拠点へ戻る。依頼ならリタイアする。 */
  leave(): void;
}

type Tab = 'quest' | 'settings' | 'controls' | 'verify';

const CONTROLS_HTML = `
<h3>操作表</h3>
<table>
<tr><th>行動</th><th>タッチ</th><th>PC</th><th>ゲームパッド</th></tr>
<tr><td>移動 / 疾走</td><td>左スティック / 疾走</td><td>WASD / Shift</td><td>左スティック / LB</td></tr>
<tr><td>視点 / 正面復帰</td><td>空いた所をドラッグ / 正面</td><td>中ボタンドラッグ・矢印 / F</td><td>右スティック / 押込み</td></tr>
<tr><td>主攻撃 / 副攻撃</td><td>斬る / 薙ぐ</td><td>左クリック / 右クリック</td><td>X(□) / Y(△)</td></tr>
<tr><td>回避 / 防御</td><td>回避 / 防御</td><td>Space / Ctrl または C</td><td>A(×) / RB</td></tr>
<tr><td>抜刀・納刀</td><td>抜刀</td><td>R</td><td>B(○)</td></tr>
<tr><td>メニュー / 検証表示</td><td>☰ / 検証</td><td>Esc / F3</td><td>Start / -</td></tr>
</table>
<h3>断岳剣</h3>
<table>
<tr><th>技</th><th>出し方</th><th>特徴</th></tr>
<tr><td>抜刀斬り</td><td>納刀中に 主攻撃</td><td>踏み込みながら抜いて斬る</td></tr>
<tr><td>縦斬り</td><td>抜刀中に 主攻撃</td><td>予備動作が長く重い。終わり際だけ回避へ繋がる</td></tr>
<tr><td>溜め斬り</td><td>主攻撃を押し続けて離す</td><td>3 段階。溜めるほど威力が上がる</td></tr>
<tr><td>横薙ぎ</td><td>抜刀中に 副攻撃</td><td>広く払う。後半から縦斬り・回避へ繋がる</td></tr>
<tr><td>防御</td><td>抜刀中に 防御を押し続ける</td><td>正面だけ。スタミナを消費し、少し削られる</td></tr>
<tr><td>回避</td><td>回避（スティックで方向）</td><td>スタミナ 25。出始めの短い間だけ無敵</td></tr>
</table>
<h3>岩殻獣ガルドロス</h3>
<table>
<tr><th>技</th><th>予備動作</th><th>対処</th></tr>
<tr><td>前脚叩き</td><td>片方の前脚を持ち上げ、体を後ろへ引く</td><td>横へ動く。着地の後は頭を狙える</td></tr>
<tr><td>直線突進</td><td>頭を下げ、前脚で地面を掻く</td><td>横へ避ける。走り出したら向きを変えない</td></tr>
<tr><td>半円尾払い</td><td>後ろに居ると、尾を右へ引いてから払う</td><td>前脚側へ回る。尾を切ると届く距離が縮む</td></tr>
<tr><td>鉱殻崩落</td><td>背を震わせ、落ちる場所に輪が出る</td><td>輪の外へ出る。落ちる場所は変わらない</td></tr>
</table>
<p><small>頭と背殻は壊せます。尾は斬って切断できます。脚を攻め続けると転倒します。ダメージが溜まると怒り、攻撃の間隔が詰まります。</small></p>
<p><small>ゲームパッドは実機で未検証です。捕獲・剥ぎ取り・道具・砥ぎは、これから追加します。</small></p>`;

export class Menu {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private tab: Tab = 'quest';
  private tabs = new Map<Tab, HTMLButtonElement>();
  open = false;

  constructor(
    parent: HTMLElement,
    private store: SettingsStore,
    private host: MenuHost,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.hidden = true;
    const card = document.createElement('div');
    card.className = 'menu-card';
    const head = document.createElement('div');
    head.className = 'menu-head';
    for (const [id, label] of [['quest', '依頼'], ['settings', '設定'], ['controls', '操作'], ['verify', '検証']] as [Tab, string][]) {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = label;
      b.addEventListener('click', () => this.show(id));
      head.appendChild(b);
      this.tabs.set(id, b);
    }
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '戻る';
    close.addEventListener('click', () => host.closeMenu());
    head.appendChild(close);
    this.body = document.createElement('div');
    this.body.className = 'menu-body';
    card.append(head, this.body);
    this.root.appendChild(card);
    parent.appendChild(this.root);
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
    if (open) this.show(this.tab);
  }

  private show(tab: Tab): void {
    this.tab = tab;
    for (const [id, b] of this.tabs) b.classList.toggle('on', id === tab);
    this.body.textContent = '';
    this.body.scrollTop = 0;
    if (tab === 'quest') this.renderQuest();
    else if (tab === 'settings') this.renderSettings();
    else if (tab === 'controls') this.body.innerHTML = CONTROLS_HTML;
    else this.renderVerify();
  }

  private row(label: string, hint: string, control: HTMLElement): void {
    const r = document.createElement('div');
    r.className = 'row';
    const l = document.createElement('label');
    l.textContent = label;
    if (hint) {
      const s = document.createElement('small');
      s.textContent = hint;
      l.appendChild(s);
    }
    r.append(l, control);
    this.body.appendChild(r);
  }

  private heading(text: string): void {
    const h = document.createElement('h3');
    h.textContent = text;
    this.body.appendChild(h);
  }

  private range<K extends keyof Settings>(key: K, min: number, max: number, step: number): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = String(this.store.value[key]);
    i.addEventListener('input', () => this.store.set({ [key]: Number(i.value) } as Partial<Settings>));
    return i;
  }

  private check<K extends keyof Settings>(key: K, after?: () => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = Boolean(this.store.value[key]);
    i.addEventListener('change', () => {
      this.store.set({ [key]: i.checked } as Partial<Settings>);
      after?.();
    });
    return i;
  }

  private select<K extends keyof Settings>(key: K, options: [string, string][], numeric = false): HTMLSelectElement {
    const s = document.createElement('select');
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      s.appendChild(o);
    }
    s.value = String(this.store.value[key]);
    s.addEventListener('change', () => this.store.set({ [key]: numeric ? Number(s.value) : s.value } as Partial<Settings>));
    return s;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  private renderQuest(): void {
    const info = this.host.sessionInfo();
    this.heading(info.hunt ? '受注中の依頼' : 'いまの場所');
    const t = document.createElement('p');
    t.style.cssText = 'font-size:1.05rem;font-weight:700;margin:6px 0';
    t.textContent = info.title;
    this.body.appendChild(t);
    for (const line of info.lines) {
      const p = document.createElement('p');
      p.style.cssText = 'margin:2px 0;color:var(--ink-dim);font-size:0.86rem';
      p.textContent = line;
      this.body.appendChild(p);
    }
    // 達成した後は、リタイアではなく帰還（剥ぎ取りを切り上げて結果へ進む）
    if (info.hunt && info.done) this.row('帰還', '剥ぎ取りを切り上げて、結果へ進みます。達成は変わりません。', this.button('帰還する', () => this.host.leave()));
    else
      this.row(
        info.hunt ? 'リタイア' : '拠点へ戻る',
        info.hunt ? '依頼を諦めて拠点へ戻ります。失敗として終わり、報酬と素材は出ません。' : '依頼を選ぶ画面へ戻ります。',
        this.button(info.hunt ? 'リタイアする' : '戻る', () => this.host.leave()),
      );
  }

  private renderSettings(): void {
    this.heading('視点');
    this.row('視点の感度', '', this.range('camSensitivity', 0.4, 2, 0.05));
    this.row('左右を反転', '', this.check('invertX'));
    this.row('上下を反転', '', this.check('invertY'));
    this.row('対象への向き直り補助', '「正面」を押すと標的の方向へ視点を向ける', this.check('targetAssist'));
    this.row('画面の揺れ', '', this.select('shake', [['off', '無'], ['weak', '弱'], ['mid', '中']]));
    this.heading('タッチ操作');
    this.row('左利き配置', 'スティックを右、ボタンを左へ', this.check('leftHanded'));
    this.row('ボタンの大きさ', '', this.range('buttonScale', 0.8, 1.4, 0.05));
    this.row('ボタンの濃さ', '', this.range('buttonOpacity', 0.3, 1, 0.05));
    this.row('疾走の方法', '外周押込みは誤発動しやすい場合に「ボタン」へ', this.select('sprintMode', [['button', '疾走ボタン（押すと切替）'], ['outer', 'スティックを外周まで倒す']]));
    this.row('ボタンの位置', 'ドラッグで 1 つずつ動かせます', this.button('配置を編集', () => this.host.startLayoutEdit()));
    this.heading('描画');
    if (canFullscreen()) {
      const fs = this.button(isFullscreen() ? '全画面をやめる' : '全画面にする', () => void toggleFullscreen().then((on) => (fs.textContent = on ? '全画面をやめる' : '全画面にする')));
      this.row('全画面', 'ブラウザの枠を隠して画面を広く使う', fs);
    } else if (isStandalone()) {
      this.row('全画面', 'ホーム画面のアイコンから開いています', document.createElement('span'));
    } else {
      this.row('全画面', fullscreenHint() ?? 'このブラウザでは全画面にできません', document.createElement('span'));
    }
    this.row('描画の上限', '計算は常に 60Hz', this.select('fpsCap', [['60', '60fps'], ['30', '30fps（発熱を抑える）']], true));
    this.row('内部解像度', '3D だけを粗くする。文字は鮮明なまま', this.range('renderScale', 0.65, 1, 0.05));
    this.row('影', '切り替えは次回の起動から', this.check('shadows'));
    this.heading('音');
    this.row('全体', '', this.range('volMaster', 0, 1, 0.05));
    this.row('効果音', '', this.range('volSe', 0, 1, 0.05));
    this.row('BGM', 'まだ曲はありません', this.range('volBgm', 0, 1, 0.05));
    this.row('環境音', '', this.range('volEnv', 0, 1, 0.05));
    this.row('ミュート', '', this.check('mute'));
    const state = document.createElement('small');
    const resume = this.button('音声を再開', () => {
      void this.host.resumeAudio().then((ok) => (state.textContent = ok ? ' 再開しました' : ' 再開できませんでした'));
    });
    const wrap = document.createElement('span');
    wrap.append(resume, state);
    this.row('音が出ない時', `現在の状態: ${this.host.audioState()}`, wrap);
  }

  private renderVerify(): void {
    this.heading('検証');
    this.row('検証表示', '行動 tick・攻撃判定・部位判定・標的の HP・ダメージ値を重ねる', this.check('verify'));
    if (!this.host.sessionInfo().hunt) {
      this.row('標的の攻撃', '切り替えると訓練をやり直します', this.check('dummyAttacks', () => this.host.restartTraining()));
      this.row('訓練をやり直す', '位置・HP・乱数を最初の状態へ戻す', this.button('やり直す', () => {
        this.host.restartTraining();
        this.host.closeMenu();
      }));
    }
    const out = document.createElement('pre');
    out.textContent = '「確認する」を押すと、出発してから記録した入力を描画 60fps と 30fps の両方で再生し、\n同じ tick の結果（命中・HP・状態・スタミナ）が一致するかを比べます。';
    this.row('30 / 60fps の一致', '', this.button('確認する', () => (out.textContent = this.host.runDeterminismCheck())));
    this.body.appendChild(out);
    this.heading('報告用の情報（不具合・重さ）');
    this.row('重さの計測', '狩場で 1 分ほど動かしてからここを開くと、下の「描画の間隔」に結果が出ます', this.button('計測をやり直す', () => {
      this.host.resetMeter();
      this.host.closeMenu();
    }));
    const info = document.createElement('pre');
    const report = [
      `ビルド・コミット：v${APP_VERSION} (${BUILD_ID})`,
      `機種 / OS / ブラウザ：${navigator.userAgent}`,
      `画面：${window.innerWidth}×${window.innerHeight} DPR ${window.devicePixelRatio}`,
      `クエスト：${this.host.sessionInfo().title}`,
      ...this.host.reportLines(),
      '操作手順：1 → 2 → 3',
      '期待した結果 / 実際の結果：',
      '再現頻度 / 録画 / コンソールログ：',
      '直前の変更：',
    ].join('\n');
    info.textContent = report;
    this.body.appendChild(info);
    const copied = document.createElement('small');
    const copy = this.button('コピー', () => {
      void navigator.clipboard?.writeText(report).then(
        () => (copied.textContent = ' コピーしました'),
        () => (copied.textContent = ' コピーできませんでした（長押しで選択してください）'),
      );
    });
    const wrap = document.createElement('span');
    wrap.append(copy, copied);
    this.row('報告テンプレート', '', wrap);
  }
}
