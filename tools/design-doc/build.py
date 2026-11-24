# 制作計画・実装指示書 第 2 版（v2.0）の HTML を作る。使い方: python3 tools/design-doc/build.py <出力する HTML>
# その後、tools/design-doc/pdf.mjs で PDF にする。数値は public/data から読む（文書とゲームの数値を食い違わせない）。
import base64, io, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from monsters import DRAW

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def data(name): return json.load(open(os.path.join(ROOT, 'public', 'data', name), encoding='utf8'))
ranks, weapons, armor, quests, content = data('ranks.json')['ranks'], data('weapons.json'), data('armor.json'), data('quests.json')['quests'], data('content.json')
VERSION = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf8'))['version']

# モンスターの正本は、登録簿（public/data/bestiary.json、docs/spec.md の 20 章）。この資料の表と図鑑は、そこから作る
bestiary = data('bestiary.json')
FRAME = {f['id']: f for f in bestiary['frames']}
ELEM = {'none': '無属性', 'fire': '火', 'thunder': '雷', 'ice': '氷', 'water': '水', 'wind': '風', 'mist': '霧'}
STATUS = {'poison': '毒', 'paralysis': '麻痺', 'sleep': '睡眠', 'stun': '気絶'}
# 下描き（tools/design-doc/monsters.py）は、登録簿より前の綴りの名前で持っている
SKETCH = {'selvark': 'servalk', 'lumisca': 'lumiska', 'tengaro': 'tengalo', 'verito': 'velito', 'razmer': 'razmel', 'kirisave': 'kirisarv'}
def _elem(s):
    if s.get('elementNote'): return s['elementNote']
    return '・'.join([ELEM[e] for e in s['elements']] + [STATUS[x] for x in s['statuses']])
MONSTERS = [dict(id=s['id'].split('.')[1], title=s['title'], name=s['name'], frame=FRAME[s['frame']]['name'], field=s['habitat'], state=s.get('stateNote') or s['state'],
                 look=s['look'], act='、'.join(s['moves']), elem=_elem(s), gear=s['gear'], armor=s.get('armorLook', '—'), art=s.get('art'), no=s['no'])
            for s in sorted(bestiary['species'], key=lambda s: s['no']) if s['class'] != 'juvenile']

def table(head, rows, cls=''):
    h = ''.join(f'<th>{c}</th>' for c in head)
    b = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<table class="{cls}"><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'
def ul(items): return '<ul>' + ''.join(f'<li>{i}</li>' for i in items) + '</ul>'
def chapter(no, part, title, lead, body): return f'<section class="chapter"><div class="part">{part}</div><h2><span>{no:02d}</span>{title}</h2><p class="lead">{lead}</p>{body}</section>'
def note(text): return f'<p class="note">{text}</p>'

def galdros_img():
    from PIL import Image
    im = Image.open(os.path.join(ROOT, 'art-source', 'monster', 'galdros', 'galdros_right_v1.png')).convert('RGB')
    im.thumbnail((900, 900))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=82)
    return '<img alt="ガルドロスの設定図（右側面）" src="data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode() + '">'

# ---------- 表の材料 ----------
fam_name = {f['id']: f['name'] for f in weapons['families']}
TIERS = ['里鍛ち', '岩殻', '脈殻', '晶殻', '輝殻']
weapon_rows = []
for f in weapons['families']:
    ws = sorted([w for w in weapons['weapons'] if w['family'] == f['id']], key=lambda w: w['id'])
    weapon_rows.append([f['name'], f.get('summary', '')[:34] + ('…' if len(f.get('summary', '')) > 34 else ''), ' / '.join(str(w['attack']) for w in ws)])
rank_rows = []
for r in ranks:
    q = next(q for q in quests if q['rankId'] == r['id'])
    m = r['monster']
    rank_rows.append([r['name'], f"×{m['hpScale']}（{round(1800 * m['hpScale'])}）", f"×{m['attackScale']}", f"×{m['cooldownScale']}", f"「{q['name']}」 {q['rewards']['money']} 通貨"])
RANK_MATS = ['岩殻片・硬骨・青銅晶脈・前脚甲', '脈岩殻・尾端晶', '晶岩殻・青銅晶塊', '輝岩殻・脈動晶芯']

# フィールド（エリアに分かれた狩場）と、里の商店
field, shop, items_doc, hub = data('fields/basin.json'), data('shop.json'), data('items.json'), data('hub.json')
KIND = {'camp': '野営地', 'path': '通り道', 'hunt': '狩場', 'nest': '巣'}
area_by = {a['id']: a for a in field['areas']}
route = field['routes']['monster.galdros']
area_rows = [[str(a['no']), a['name'], KIND[a['kind']], f"{round(a['bounds']['maxX'] - a['bounds']['minX'])}×{round(a['bounds']['maxZ'] - a['bounds']['minZ'])}m",
              '入る' if a['large'] else '—', '・'.join('野営地' if area_by[e['to']]['kind'] == 'camp' else str(area_by[e['to']]['no']) for e in a['exits'])] for a in field['areas']]
def field_map():
    cols = max(a['grid'][0] for a in field['areas']) + 1
    rows = max(a['grid'][1] for a in field['areas']) + 1
    CW, RH, BW, BH = 150, 70, 118, 44
    W, H = (cols - 1) * CW + BW + 24, (rows - 1) * RH + BH + 24
    at = lambda a: (12 + a['grid'][0] * CW, 12 + (rows - 1 - a['grid'][1]) * RH)
    out = [f'<svg viewBox="0 0 {W} {H}" style="width:100%;max-width:{W}px;display:block;margin:6px auto 4px" xmlns="http://www.w3.org/2000/svg">']
    for a in field['areas']:
        x0, y0 = at(a)
        for e in a['exits']:
            b = area_by[e['to']]
            if b['no'] < a['no']: continue
            x1, y1 = at(b)
            dash = '' if e.get('large') else ' stroke-dasharray="5 4"'
            out.append(f'<line x1="{x0 + BW / 2}" y1="{y0 + BH / 2}" x2="{x1 + BW / 2}" y2="{y1 + BH / 2}" stroke="#6b6f66" stroke-width="{3 if e.get("large") else 1.6}"{dash}/>')
    fill = {'camp': '#efe9d6', 'path': '#f4f2ea', 'hunt': '#dfe6d6', 'nest': '#ecdcb6'}
    for a in field['areas']:
        x, y = at(a)
        order = route['roam'].index(a['id']) + 1 if a['id'] in route['roam'] else 0
        out.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{BH}" rx="5" fill="{fill[a["kind"]]}" stroke="#4d5a4c" stroke-width="{2.2 if a["large"] else 1}"/>')
        label = a['name'] if a['kind'] == 'camp' else f"{a['no']} {a['name']}"
        out.append(f'<text x="{x + BW / 2}" y="{y + 19}" text-anchor="middle" font-size="13" font-weight="700" fill="#22271f">{label}</text>')
        sub = KIND[a['kind']] + (f'・巡る順 {order}' if order else '') + ('・眠る' if a['id'] == route['nest'] else '')
        out.append(f'<text x="{x + BW / 2}" y="{y + 35}" text-anchor="middle" font-size="10" fill="#555b50">{sub}</text>')
    out.append('</svg>')
    return ''.join(out)
item_name = {i['id']: i['name'] for i in items_doc['items']}
item_carry = {i['id']: i['carryMax'] for i in items_doc['items']}
shop_rows = [[item_name[g['itemId']], f"{g['price']} 通貨", f"{item_carry[g['itemId']]} 個"] for g in shop['goods']]
R = field['roam']
for row, mats in zip(rank_rows, RANK_MATS): row.append(mats)
defs = sorted({a['defense'] for a in armor['armor']})
base = armor['defense']['base']
armor_rows = [[TIERS[i], d, d * 5, f"×{base / (base + d * 5):.2f}"] for i, d in enumerate(defs)]

# ---------- 図鑑 ----------
def concept_img(m):
    from PIL import Image
    im = Image.open(os.path.join(ROOT, 'art-source', 'monster', 'concepts', m['art'])).convert('RGB')
    im.thumbnail((760, 760))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=78)
    return f'<img alt="{m["title"]} {m["name"]} の原画" src="data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode() + '">'

def card(i, m):
    sketch = SKETCH.get(m['id'], m['id'])
    if m['id'] == 'galdros': art, cap = galdros_img(), '採用済みの設定図（ChatGPT、依頼 2）'
    elif m['art']: art, cap = concept_img(m), 'ChatGPT の原画（2026-11-24 受領。採用待ち。4 方向の設定図と、ゲームの中の体は、まだ無い）'
    elif sketch in DRAW: art, cap = DRAW[sketch](), 'Claude の下描き（設定図ではない。絵の依頼の出発点）'
    else: art, cap = '', '絵は、まだ無い'
    rows = [('骨格 / 狩場', f"{m['frame']} / {m['field']}"), ('外見の核', m['look']), ('行動の核', m['act']), ('属性', m['elem']), ('素材と装備', m['gear']), ('防具へ写す個性', m['armor']), ('状態', m['state'])]
    t = ''.join(f'<tr><th>{k}</th><td>{v}</td></tr>' for k, v in rows)
    return f'<div class="card"><div class="art">{art}<div class="cap">{cap}</div></div><div class="info"><h3><span class="no">{i:02d}</span><small>{m["title"]}</small> {m["name"]}</h3><table class="kv">{t}</table></div></div>'

monster_index = table(['', '名前', '骨格', '狩場', '属性', '状態'], [[f'{i:02d}', f"{m['title']} {m['name']}", m['frame'], m['field'], m['elem'].split('。')[0], m['state'].split('。')[0].split('（')[0]] for i, m in enumerate(MONSTERS, 1)], 'tight')

CH = []
CH.append(chapter(1, 'A / この版について', 'この版について', '第 1 版（v1.0、2026-11-22）から 2 日で決まったこと・作ったものを反映した、作り直しの版。',
    ul(['<b>第 1 版との関係</b>: 第 1 版は「これから作る」ための設計だった。この版は、<b>いま動いているもの</b>（3 章）と、<b>利用者が決めたこと</b>（4〜9 章）を正本にして、計画と指示文を書き直した。',
        '<b>変わっていない章は、書き写していない。</b> 画像・3D・モーション・音の作り方（第 1 版 18〜24 章）、ブラウザとデータの決まり（25〜29 章）などは、第 1 版をそのまま使う。対応は 15 章の表。',
        '<b>数値はすべて机上の初期値。</b> 人が遊んで確かめたものは無い。表の数値は、ゲームのデータ（<code>public/data/*.json</code>）から読んで載せている。',
        '<b>「候補」「案」と書いたものは、まだ決まっていない。</b> 14 章にまとめた。',
        '<b>絵</b>: 大型 13 種の絵を入れた。ガルドロスは採用済みの設定図。ほかの 12 種は、ChatGPT の原画（2026-11-24 受領。<b>採用待ち</b>）で、4 方向の設定図と、ゲームの中の体は、まだ無い。',
        '<b>モンスターは、登録簿から</b>: 8 章の表と図鑑は、ゲームの登録簿（<code>public/data/bestiary.json</code>）から作っている。これから ChatGPT が考える種（中級 20・上級 25・極級 20）も、同じ登録簿へ足す。'])
    + table(['第 1 版から変わったこと', '第 1 版', 'この版'], [
        ['段階', '初級 → 上級 → 極級（3 つ）', '初級 → 中級 → 上級 → 極級（4 つ）'],
        ['武器', '5 系統から始め、11 系統へ', '7 系統（断岳剣・護刃・大槌・双剣・太刀・長尖槍・環弓）。旋鎌はやめた。横には増やさない'],
        ['強化', '生産・強化・派生', '5 段の 1 本道（里鍛ち → 岩殻 → 脈殻 → 晶殻 → 輝殻）。上の段は、上の段階の個体の素材'],
        ['防具', '5 部位、スキル、装飾品', '5 部位 × 5 段。防御力で受けるダメージが減る。モンスターごとの個性を形に写す'],
        ['属性', '属性値と状態異常 4 つ', '属性 6 つ・状態異常 4 つ・複合属性・無属性の系列（方針は決定、実装はまだ）'],
        ['大型', '12 種', '13 種（火の持ち主を 1 種足す）'],
    ])))

CH.append(chapter(2, 'A / この版について', 'ChatGPT と Claude の分担', '絵は ChatGPT、動くものは Claude。受け渡しは利用者が行う。',
    table(['担当', 'すること', '受け渡し'], [
        ['利用者', '方針を決める。遊んで感想を言う。ChatGPT と Claude の間で、依頼文と画像を運ぶ', 'iPhone から。返事は短くてよい'],
        ['ChatGPT', '設定図（モンスター、人物、武器、防具、狩場）。段ごとの違い。色と質感', 'Claude が書いた依頼文（<code>docs/chatgpt-request-*.txt</code>）を受け取り、画像と説明を返す'],
        ['Claude', 'コード、データ、3D の組み立て、動き、確認（自動テストと操作検査）、公開、文書。絵の依頼文を書く。届いた絵を、依頼の条件と照合する', '届いた画像は <code>art-source/</code> へ登録し、素材台帳に書く'],
    ]) + note('決まり: 他作品の映像・画像・数値を見て写さない（D-037）。設定図は「採用」と言われるまで仮。採用の前でも、板の枚数や位置のような「決まり」の部分は先に形にしてよい（D-063）。')))

CH.append(chapter(3, 'B / いまの姿', f'いま動いているもの（v{VERSION}）', '公開: https://kamamon.github.io/Kari/ ／ リポジトリ: kamamon/Kari ／ PC と、横向きの iPhone・iPad の Safari。',
    table(['できること', '中身', '仮のもの・未確認'], [
        ['拠点', '<b>灯継ぎの里を歩く</b>。施設は 4 つ: 依頼板・工房（強化）・<b>商店</b>（道具を買う、素材を売る）・装備箱（持ち替え、データの書き出し・取り込み・控え）。「一覧」からは歩かずに開ける', '建物は箱と柱の仮の形。人（受付・店主）は居ない'],
        ['狩場', '<b>フィールド: 風礫盆地 = 野営地 + 10 エリア</b>。野営地から出発し、出口でエリアを移る。右上に、現在地・標的の居るエリア・小さな地図', '狩場は 20 を目標にして、いまは 1 つ。エリアは四角い区画で、切り替えは一瞬'],
        ['狩猟', '岩殻獣ガルドロス 1 種。技 23 種、怒り、部位破壊、尾の切断、捕獲、剥ぎ取り、報酬、帰還。<b>エリアを巡り、弱ると巣で眠る</b>', '標的の居場所は、いつも地図に出る（探す遊びは無い）'],
        ['道具', '依頼の支給品に、商店で買った自分の道具を足して持っていく（道具ごとに、持ち出せる数まで）。使ったぶんだけ減る', '値段と持ち出せる数は机上の値'],
        ['段階', '初級・中級・上級・極級。上ほど体力・攻撃・攻めの間隔が上がる。前の段階の達成で解禁', '見た目の違いは、晶脈の光の強さだけ'],
        ['武器', '7 系統 × 5 段 = 35 本。刃の状態（鋭い・鈍りかけ・鈍い）と研磨石、弾かれ', '大槌・双剣・太刀は絵が無い。強化後の形は色違いの板'],
        ['防具', '5 部位 × 5 段 = 25 個。着ると、部位ごとに岩の板が付く。兜は、鉢を帯で締めた中世の兜の作り。段が上がると、板に晶脈の筋が走り、左側に晶が育つ（色違いではない）', '単色の板（図を貼っていない）。段ごとの図は正面の 1 枚だけ'],
        ['保存', '端末の中（IndexedDB）。報酬と強化は 1 回の書き込みで確定。古い版のデータは直して引き継ぎ、元は控えへ', '端末をまたぐ保存は無い'],
    ]) + ul([f'確認: 自動テスト 324 件、ブラウザでの操作検査 161 項目が通る（v{VERSION}）。',
             '<b>実機（iPhone）で確かめたのは、報酬と持ち替えの保存・書き出しまで。</b> 重さ（描画の間隔）、手応え、上の段階の難しさは、まだ誰も確かめていない。',
             '無いもの: 残り 19 の狩場、小型モンスター、採取と採掘、NPC、属性、スキル、協力プレイ。'])))

CH.append(chapter(4, 'C / 遊びの骨格', '遊びの輪と、段階', '強い個体を倒すと、その個体の素材が手に入り、武器と防具が 1 段上がる。それで次の段階へ行ける。',
    '<div class="loop"><span>依頼を受ける</span><i>→</i><span>狩る（討伐か捕獲）</span><i>→</i><span>素材と通貨</span><i>→</i><span>工房で強化</span><i>→</i><span>上の段階の依頼</span></div>'
    + table(['段階', '体力', '与えるダメージ', '技の間隔', '依頼と報酬', 'その段階から出る素材'], rank_rows)
    + ul(['段階の名前は、第 1 版の 3 つに「中級」を足した。恒久の ID は <code>rank.1</code>〜<code>rank.4</code> で、表示名は変えられる。',
          '強い個体は、同じモンスターの定義へ倍率を掛けて作る（体力、部位の耐久・怯み・切断の必要量、与えるダメージ、技と技の間隔）。初級は倍率 1 で、元の定義そのもの。',
          'その段階の素材は、本体の剥ぎ取りと報酬にも入れる（尾を切れない武器でも進める）。上の段階の素材が、下の依頼に混ざることは無い。',
          '<b>まだ無いもの</b>: 上の段階だけの新しい技や組み合わせ（第 1 版「上位は新しい行動や組合せも追加」）。いまは数値だけが違う。'])
    + '<h4>拠点「灯継ぎの里」と商店</h4>'
    + table(['施設', 'できること'], [[f['name'], f['summary']] for f in hub['facilities']], 'narrow')
    + table(['商店の道具', '値段', '狩りへ持ち出せる数'], shop_rows, 'narrow')
    + ul(['里を歩き、施設の前で主ボタン（または出てくるボタン）を押すと、その施設の画面が開く。右上の「一覧」からは、歩かずに開ける。',
          '<b>道具</b>: 買った道具は、依頼の支給品に足して持っていく（支給品と合わせて、持ち出せる数まで）。支給品から先に使い、自分の道具は、使ったぶんだけ減る（達成しても、失敗しても）。',
          f"<b>素材を売る</b>: 初級の素材 {min(g['price'] for g in shop['sell'])} 通貨 〜 極級の素材 {max(g['price'] for g in shop['sell'])} 通貨。売った素材は戻らない。",
          '買う・売るは、強化や報酬と同じく、通貨と持ち物を 1 回の書き込みで変える。値段はすべて机上の値。'])))

CH.append(chapter(5, 'C / 遊びの骨格', '武器 7 系統と、強化の 5 段', '系統は横に増やさない。縦に 5 段、育てる。',
    table(['系統', '特徴', f"攻撃力（{' / '.join(TIERS)}）"], weapon_rows)
    + ul(['1 段ごとに、攻撃力が 1.15 倍。属性・会心・技・当たり判定は、段では変わらない。',
          '2 段目（岩殻）は初級、3 段目（脈殻）は中級、4 段目（晶殻）は上級、5 段目（輝殻）は極級の個体の素材が要る。段は飛ばせない。費用は 120 / 400 / 900 / 1800 通貨。',
          'ガルドロスの武器は「攻撃力が高い無属性」の系列。属性を持つモンスターが入ったら、その素材の武器が属性を持つ（7 章）。',
          '刃の状態: 当てるほど減り、鈍ると威力が落ちて弾かれやすくなる。研磨石で戻す。環弓には無い。',
          '見た目は、元の形に板を足した仮（岩 → 暗い岩 → 琥珀色の晶 → 光る晶）。設定図があるのは断岳剣・護刃・長尖槍・環弓の 1 段目だけ。'])))

CH.append(chapter(6, 'C / 遊びの骨格', '防具と、モンスターごとの個性', '防具を見れば、どのモンスターの素材かが分かること。色だけを変えた同じ形にしない。',
    table(['段', '1 部位の防御力', '5 部位の合計', '受けるダメージ'], armor_rows, 'narrow')
    + ul([f'頭・胴・腕・腰・脚の 5 部位。<b>受けるダメージ = 元 × {base} / ({base} + 防御力の合計)</b>。',
          '1 つ下の段で揃えた防具を着て上の段階へ行くと、初級を里の装束で受けるのと、ほぼ同じ痛さになるように決めてある。',
          '着ると、部位ごとに姿が変わる（頭だけ岩殻、もできる）。胴の防具を着ている間は、里の外套を描かない。'])
    + '<h4>モンスターから防具へ写す 5 つ（すべての防具の決まり）</h4>'
    + table(['写すもの', '意味', 'ガルドロスの場合'], [
        ['輪郭の癖', '体つきを、肩・腰・兜の輪郭にする', '低く厚い。上へ尖らせない'],
        ['素材と色', '体を覆うものと、その色', '灰褐色の岩板。縁は青銅色〜琥珀色の晶脈'],
        ['固有の器官', 'そのモンスターにしか無い部分を 1 つ、目立つ所へ', '尾の先の晶の塊 → 腰の真後ろ。頭頂の平たい岩 → 兜のてっぺん'],
        ['偏り', '左右や前後の崩し方', '左が大きい（肩は左が大 1 枚、右が中 + 小。籠手・腰・頬当ても）'],
        ['性質のヒント', '属性と、苦手・得意が見た目から想像できる', '縁取りが足もとまでつながる（雷に強い）。継ぎ目は樹脂で固めた革（火に弱い）'],
    ]) + note('どの防具でも変えないもの: ハンターの体型と姿勢、5 部位の境目、留め方（青銅色の鋲と革の帯）。別のモンスターの防具と混ぜて着るため。動くための決まり: 顔・指・ひじの内側・手首・ひざを覆わない。肩は外へ 12cm・上へ 8cm まで。背中の中央は平ら（武器を背負う）。')))

CH.append(chapter(7, 'C / 遊びの骨格', '属性・状態異常・複合属性', '方針は決まった。実装は、属性を持つ 2 体目のモンスターと一緒に入れる。',
    table(['種類', '名前', '決まり'], [
        ['属性（6 つ）', '火・雷・氷・水・風・霧', 'ダメージ = 属性値 × 技の属性倍率 × 部位の属性係数（式は第 1 版のまま）。モンスターごとに、弱点と耐性の印を付ける'],
        ['状態異常（4 つ）', '毒・麻痺・睡眠・気絶', '第 1 版のとおり（ためる値、持続、耐性の上がり方、解除の条件）'],
        ['無属性の武器', '攻撃力が高い系列 / 会心率が高い系列', '属性が付かない代わりに、どちらかが高い。ガルドロスの武器は攻撃力の系列'],
        ['複合属性', '2 つの属性の組（例: 火 + 雷 = 灼雷、氷 + 風 = 凍嵐、霧 + 氷 = 霧氷。名前は案）', '属性値は単属性の 1.5 倍。係数は 2 つのうち高い方。<b>どちらも相手の弱点でなければ半分</b>。上級・極級のモンスターと、その武器だけ'],
    ]) + ul(['<b>ガルドロスは無属性。弱点は火、雷に強い。防具も同じ</b>（火に弱く、雷に強い）。',
             '火の持ち主は、第 1 版の 12 種とは別に、<b>新しく 1 種を足す</b>（8 章の 13 番）。',
             '属性ごとの持ち主は、8 章の表の「候補」。入れないと決めたもの: 音・光・晶・灰・糸（役目が重なる。後から足せる）。',
             'いまのデータとの差: 部位の属性係数が 1 つの数（どの属性にも同じ）、武器の属性は「なし」だけ、防具に耐性が無い、状態異常の仕組みが無い。']))) 

PLAN = bestiary['plan']
def _count(rank, pred): return sum(1 for s in bestiary['species'] if s['rank'] == rank and pred(s))
plan_rows = [[r['name'], PLAN.get(r['id'], 0), _count(r['id'], lambda s: s['class'] != 'juvenile'), _count(r['id'], lambda s: s['state'] == 'implemented'), what]
             for r, what in zip(sorted(ranks, key=lambda r: r['order']), ['いまの大型 13 種（原種）', '超大型・亜種など 約 20', '希少種・2 体が同時に出る狩りなど 約 25', 'さらに強い種 約 20'])]
frame_rows = [[f['name'], f['note'], '<b>ある</b>（ガルドロス）' if f['built'] else 'まだ無い'] for f in bestiary['frames']]
CH.append(chapter(8, 'D / モンスター', 'モンスターの登録簿と、大型 13 種', f'モンスターは ChatGPT が考え、登録簿（図鑑）へ足していく。{len(bestiary["frames"])} つの骨格を使い回し、個体ごとの器官で見分ける。',
    '<h4>段階ごとの数（利用者の指示。D-071）</h4>'
    + table(['段階', 'その段階から新しく出る数', '登録ずみ', '遊べる', '中身'], plan_rows, 'narrow')
    + ul(['<b>登録簿</b>: <code>public/data/bestiary.json</code>。1 種ごとに、分類（大型・超大型・幼体）、変種（原種・亜種・希少種）、段階、骨格、全長、狩場、属性、弱点、外見の核、器官、技の核、部位、素材、<b>生態 8 項目</b>（食べ物・行動・縄張り・一日と季節・巣・ほかの生き物との関係・幼体・痕跡）を持つ。ゲームの中の「モンスター図鑑」（依頼の欄）に、そのまま出る。',
          '<b>ChatGPT の案の入れ方</b>: 依頼 9（<code>docs/chatgpt-request-9.txt</code>）の形の JSON を返してもらい、<code>npm run bestiary:import -- ＜ファイル＞</code> で足す。決まり（名前の重なり、段階と変種の組、属性、全長、生態の 8 項目など）に合わないものは、<b>1 つも入れずに</b>、合わない所を全部並べて止まる。',
          '<b>亜種・希少種・幼体は、もとの種を指す</b>（同じ骨格）。亜種は中級から、希少種は上級から。幼体は、もとの種の 0.7 倍より小さく、群れの数（2〜8 体）を持つ。',
          '<b>まだ遊べないもの</b>: 登録簿は計画で、遊べるのはガルドロスだけ。<b>2 体が同時に出る狩り、幼体を何体も狩る依頼、超大型との戦いは、仕組みがまだ無い</b>（登録簿に、組と群れの数を書けるだけ）。'])
    + '<h4>骨格</h4>' + table(['骨格', 'どんな体・動き', '体と動きの土台'], frame_rows, 'tight')
    + '<h4>大型 13 種（初級から出る）</h4>' + monster_index
    + note('属性の「候補」は、Claude が第 1 版の言葉から割り当てた案で、利用者はまだ決めていない。決まっているのは、ガルドロスの性質と、「火の持ち主を 1 種足す」ことだけ。捕獲は 10 種に対応し、終盤の 2 種は捕獲不可（第 1 版の初期案）。各大型の素材は 6 種を標準の枠とし、段階ごとに 2 種ずつ増える（4 章）。生態は、依頼 9 で ChatGPT に書いてもらう（まだ無い）。')
    + ''.join(card(i, m) for i, m in enumerate(MONSTERS, 1))))

CH.append(chapter(9, 'D / モンスター', '世界と狩場、小型', '霧と晶脈の辺境を、灯継ぎの里から少しずつ開く。<b>狩場は約 20、1 つの狩場にエリアが約 10</b>（利用者の指示。第 1 版 14 章の「6 フィールド・エリア 3〜5」を置き換える。D-066）。',
    '<h4>1 つ目の狩場: 風礫盆地（野営地 + 10 エリア）</h4>' + field_map()
    + note('太い枠と太い線 = 大型が入るエリアと、通れる出口。破線 = 人だけが通る道。ガルドロスは「巡る順」のとおりに回り、弱るとエリア 10 で眠る。')
    + table(['番号', '名前', '種類', '大きさ', '大型', 'つながる先'], area_rows, 'tight')
    + ul([f"<b>エリアの移動</b>: 出口（壁の切れ目と門柱）へ入ると、次のエリアへ移る。依頼は野営地から出発し、力尽きると野営地へ戻る。制限時間は {field['timeLimitScale']} 倍（30 分）。",
          f"<b>大型の移動</b>: 1 つのエリアに {R['stayTicks'][0] // 60}〜{R['stayTicks'][1] // 60} 秒。技の途中でなければ、次のエリアへ歩いて出る（その間は技を出さない）。気づいていない間は、エリアの中をぶらつく。別のエリアに居る相手には気づかない。",
          f"<b>休息</b>: 体力が {round(R['limpHpRatio'] * 100)}% 以下になると巣へ向かい、寝床で {R['sleepTicks'] // 60} 秒眠って、{round(R['sleepHealCap'] * 100)}% まで戻す。攻撃されると起きる。",
          '作り: エリアを 1 つの座標の中に 240m おきに離して置く。描くのは居るエリアだけ。大型は、誰も見ていないエリアでも同じ計算で歩く。データは <code>public/data/fields/</code>、作るのは <code>npm run field:gen</code>。'])
    + '<h4>狩場の候補（第 1 版の 6 つ。残りの 14 は未定）</h4>'
    + table(['狩場', '地形と戦いの個性', '主な大型'], [
        ['風礫盆地', '灰緑の草と岩原。見通しがよく、最初の練習に向く', 'ガルドロス / セルヴァルク'], ['根絡み湿原', '浅い沼、網目の根、乾いた小島。足場を選ぶ', 'ヌメラドン / ヴェリト'],
        ['硝砂海岸', '白砂、硝子の層、低い海食洞。壁際の位置取り', 'オルグラス / ルミスカ'], ['灰鐘鉱山', '採掘路と広い坑口。狭い所から誘い出す', 'ボルナケル / アシュレイア'],
        ['氷帆峡谷', '断崖、薄い氷の板、滑った跡。長い攻撃の線を読む', 'キリサーヴ / ラズメル'], ['霧灯樹海', '環の形の大樹、点々とした光。予告を見失わない', 'テンガロ / ヴェルガイト'],
    ]) + ul(['いまあるのは、風礫盆地だけ（エリアの形は、四角い区画に岩と低い段を置いた仮のもの。高低差・水・狭い道は無い）。', '火の獣（13 番）の狩場は未定。', '小型 6 種（コロハネ、スナコブ、ネリガニ、ハリソイ、ヒバツムリ、トバリムシ）は未着手。最初は前の 2 種。',
             '世界の決まり: 大地を巡る晶脈が、獣の体に独特な器官を育てる。<b>晶脈の育った個体ほど強い</b>（段階と素材の名前は、ここから付けている）。基本の色は、灰緑・青銅・生成り。'])))

CH.append(chapter(10, 'E / 制作計画', '開発段階のいま', '第 1 版 31 章の段階に、いまの位置を書き込んだ。',
    table(['段階', '作るもの', 'いま'], [
        ['M0 基盤', 'リポジトリ、横画面、移動、カメラ、地形、音の開始', '<b>済</b>'], ['M1 戦闘', '断岳剣、標的、回避、防御、被弾、判定の表示', '<b>済</b>'],
        ['M2 狩猟', 'ガルドロス、討伐と捕獲、素材、帰還', '<b>済</b>（技は 23 種）'],
        ['M3 MVP', '護刃、小型 2、工房、5 依頼、保存、仮素材の置き換え', '<b>一部</b>: 保存、工房、依頼 4 件、武器 7 系統、<b>里を歩く拠点と商店</b>、<b>景色の絵（空と遠景・地面・岩・草・里の建物）</b>。<b>残り</b>: 小型 2、採取、NPC、仮素材の置き換え'],
        ['M4 素材の品質', '正式モデル、骨、動作、音、UI、性能', '未着手（ハンターとガルドロスは、設定図から組んだ仮モデル）'],
        ['M5 拡張', '大型 13 種、<b>約 20 の狩場（各 約 10 エリア）</b>、装備、段階 4 つ、80 依頼', '<b>先取りして入れた</b>: 段階 4 つ、武器と防具の 5 段、<b>フィールドの仕組みと 1 つ目の狩場</b>。大型は未着手'],
        ['M6 ソロ完成', '同行、生活施設、図鑑、全難度の調整', '<b>先取りして入れた</b>: 図鑑（登録簿の表示）。ほかは未着手'], ['M7 協力完成', '別サーバー、2 人 → 4 人、同期、復帰', '未着手'],
    ]) + note('見積もり方は第 1 版のまま: 段階ごとに「遊べる成果物」を決め、動く版をタグで残す。大型は「骨格の代表 + 個体差 + 技 + 報酬」で積む。数日で大作が完成する予定は置かない。')))

CH.append(chapter(11, 'E / 制作計画', 'これからの順番（案）', '利用者が順番を決める。指定が無ければ、上から。',
    table(['', 'すること', '終わりの条件', '要るもの'], [
        ['1', '<b>遊んで数値を直す</b>: フィールド（追いかける長さ、眠りの戻り方、30 分の制限）、商店の値段、段階の倍率、防具、素材の出方、費用', '利用者が、里で買い物をして、初級と中級を 1 回ずつ狩り、長さ・痛さ・素材と通貨の集まり方の感想を返す', '利用者の感想。実機の計測（後回しでよい）'],
        ['2', '<b>モンスターの案を受け取る</b>: 13 種の生態と幼体（9A）、中級 20（9B）、上級 25（9C）、極級 20（9D）を、登録簿へ足す', '図鑑に、段階ごとの数がそろい、どの種にも生態が書いてある', 'ChatGPT: 依頼 9（JSON 4 つ。A → D の順）。景色の絵（依頼 8）は v0.13.0 で貼った'],
        ['3', '<b>属性の土台</b>: 属性ごとの係数と耐性、弱点の印、状態異常の枠。ガルドロスに「弱点は火・雷に強い」', '属性つきの武器を 1 本仮に置き、弱点・耐性・無属性で与えるダメージが変わることをテストで確かめる', 'なし（データとコード）'],
        ['4', '<b>2 体目の大型</b>: セルヴァルク（同じ狩場・風）か、火の獣（属性の手応えが大きい）', '設定図 → 骨格 → 技 → 素材 → 武器と防具（5 段）まで、ガルドロスと同じ深さ', 'ChatGPT: 設定図 4 方向。利用者: どちらにするか'],
        ['5', '<b>狩場を増やす</b>: 2 つ目の狩場（2 体目の大型と一緒に）。エリアに高低差・水・狭い道。足跡などの痕跡', '2 つの狩場で、地形と戦い方が違うと分かる', 'ChatGPT: 狩場の環境原画。利用者: 残りの狩場の名前と並び'],
        ['5b', '<b>M3 の残り</b>: 採取と採掘、小型 2 種、依頼を増やす、里の人（受付・店主・鍛冶）', '素材 → 強化 → 再挑戦が、狩り以外の手段も使って回る', 'ChatGPT: 小型と里の絵'],
        ['6', '<b>M4 素材の品質</b>: 正式モデル、動き、音、UI、実機の性能', '実機で 30 分、判定と見た目のずれ・欠落が無い', 'Blender の工程（第 1 版 18〜21 章）'],
        ['7', 'M5 の残り → M6 → M7', '第 1 版 31 章のとおり', ''],
    ], 'tight') + ul(['武器の系統と技は、横に増やさない（D-056）。増やすのは、モンスター・段・狩場。', '1 回に進めるのは 1 つ。小さく作り、同じ範囲を確かめ、動く版を公開する。'])))

CH.append(chapter(12, 'F / 実装指示', 'Claude へ: 守る決まり', 'リポジトリの CLAUDE.md と docs/ が正本。ここは、その要約と、第 1 版から増えた決まり。',
    table(['分野', '決まり'], [
        ['作業の前', '<code>docs/spec.md</code>・<code>animation-contract.md</code>・<code>asset-manifest.json</code>・<code>handoff.md</code> を読む。採用済みの仕様を変える時は、理由と影響を <code>decisions.md</code> へ'],
        ['作り', 'TypeScript + Vite + Three.js。入力・simulation・描画・データ・保存・UI を分ける。戦闘は 60Hz の固定の刻み。<code>src/game/</code> は画面・Three.js・時刻に触れない。描画は simulation を読むだけ'],
        ['データ', '恒久の ID と表示名を分ける。数値は <code>public/data/*.json</code> に置き、読み込み時に検査する。攻撃は startup・active・recovery・cancel・hitWindow をデータで持つ'],
        ['段階', '強い個体は <code>scaleMonsterDef</code>（元の定義 × 段階の倍率）。初級は元のまま。素材の表は <code>lootByRank</code>。上の段階の依頼は <code>requires</code> で解禁'],
        ['装備', '武器も防具も、強化は入れ替え（1 本道）。見た目は <code>assetId</code> で素材台帳とつなぐ。防具の形は、依頼文の「動くための決まり」をテストにする'],
        ['保存', 'ゲーム固有の DB 名、schemaVersion、revision。報酬と強化は 1 回の書き込みで確定。成功の表示は書き込みの完了後。旧版や知らない ID のデータを黙って消さない。構造を変える時は、1 段ずつ直す処理を足し、実機のデータの見本で確かめる'],
        ['確認', 'typecheck・test・build・assets:validate・smoke（本番ビルドをブラウザで操作）。走らせていないものは「未検証」と書く。仮素材・未実装・欠落を、完成として扱わない'],
        ['公開', 'main へ push → Actions が配信元を更新。README と handoff を更新する'],
        ['利用者への返事', 'iPhone で読む。答えを先に、短く。仮のもの・確かめていないものを、必ず分けて書く'],
    ])))

CH.append(chapter(13, 'F / 実装指示', 'Claude へ: モンスターを 1 体足す手順', 'ガルドロスで通した道を、同じ順で通す。',
    table(['', 'すること', '置き場所'], [
        ['1', '設定図（4 方向）を受け取り、依頼の条件と照合して登録する', '<code>art-source/monster/&lt;名前&gt;/</code>、素材台帳'],
        ['2', '骨格を決める（登録簿の 7 つの骨格のどれか。関節・接地・体長の違いを書く）。登録簿の state を進める（planned → art → implemented）', '<code>public/data/bestiary.json</code>、<code>docs/animation-contract.md</code>'],
        ['3', '定義: 体力、部位（肉質・耐久・怯み・切断）、怒り、捕獲、<b>属性ごとの係数と、弱点・耐性の印</b>', '<code>public/data/monsters/&lt;名前&gt;.json</code>'],
        ['4', '技: 予告 → 攻撃 → 隙。当たりの形と時間をデータで。まず 6〜8 種、最終的に 20〜50 種（D-053）', '<code>public/data/actions/</code>'],
        ['5', '見た目: 設定図の輪郭を測って形を作り、図を貼る。動きは技のデータと同じ時間で', '<code>src/render/</code>'],
        ['6', '素材: 標準 6 種 + 段階ごとに 2 種。段階ごとの抽選の表', '<code>items.json</code>・<code>loot.json</code>'],
        ['7', '依頼: 段階ごとに 1 件から。解禁の条件', '<code>quests.json</code>'],
        ['8', '武器と防具: 7 系統 × 段、5 部位 × 段。属性か、無属性の系列か。防具は「個性の 5 つ」を形に', '<code>weapons.json</code>・<code>armor.json</code>・<code>recipes.json</code>'],
        ['9', 'テスト（決定論、技ごとの当たり、素材の出どころ、強化の鎖）と、ブラウザでの操作検査', '<code>tests/</code>・<code>tools/smoke.mjs</code>'],
        ['10', '文書（spec・decisions・handoff・tests・README）、版上げ、公開、配信元の確認', '<code>docs/</code>'],
    ], 'tight') + note('受け入れの条件: 1 つの依頼を、受注から帰還まで途切れずに通せる。同じ入力なら同じ結果になる。初級から極級まで、素材が正しい段階から出る。保存したデータを読み込み直しても同じ。')))

TEMPLATE = '''ChatGPT への依頼：＜モンスターの名前＞の設定図（4 方向）
霧境の狩人 - VEILBOUND HUNTERS

添付: 採用したアート基準ボード / 岩殻獣ガルドロスの設定図（大きさと描き方の基準）/ この資料の下描き（参考。写さなくてよい）

1. 何を作るか
  ＜称号＞ ＜名前＞。骨格は＜四足重獣 など＞。狩場は＜名前＞。
  外見の核：＜1 行＞　行動の核：＜1 行＞

2. このモンスターの個性（見ればこの 1 種だと分かること）
  輪郭の癖　：＜低く厚い / 細く軽い など＞
  素材と色　：＜体を覆うもの。主な色を 3 つ＞
  固有の器官：＜この 1 種にしか無い部分を 1 つ＞
  偏り　　　：＜左右・前後の崩し方＞
  性質　　　：＜属性。苦手なもの、強いもの＞ … 文字や記号を使わず、見た目で想像できるように

3. 出す画像（各 1 枚に 1 方向。背景は薄い無地。文字・枠・寸法線・影は入れない）
  正面 / 背面 / 左真横 / 右真横。4 枚とも同じ姿勢・同じ縮尺・同じ接地線。
  左右で形が違う所は、反転で代用しない。壊れる部位（＜頭・背・尾 など＞）が分かるように。

4. 守ること
  既存のゲーム・アニメ・映画の生き物を写さない。
  ガルドロスと並べた時に、輪郭だけで別の生き物だと分かること。
  晶脈が育つほど強い世界：器官は「晶脈が育てたもの」として描く。

5. 言葉でも教えてください
  主な色を 5 つ / 入れられなかったもの / 「この 1 種だと分かる点」を 3 つ'''

CH.append(chapter(14, 'F / 実装指示', 'ChatGPT へ: 絵の依頼の決まりと雛形', '依頼文は Claude が書く。下は、モンスターの設定図を頼む時の雛形。',
    ul(['絵は、<b>設定図</b>（形を決めるための図）として頼む。1 枚に 1 方向、同じ縮尺、無地の背景。3D は、図の輪郭を測って作る。',
        '防具は、着た完成形の 4 方向を先に。採用の後に、5 部位の分解図と、段ごとの違い（第 1 版 COPY 13、依頼 7）。',
        '段の違い（岩殻 → 脈殻 → 晶殻 → 輝殻）は、色だけでなく形で。晶脈が育つ。',
        '届いた絵は、Claude が依頼の条件と照合し、違う所を利用者へ伝える。採用は利用者が決める。'])
    + f'<pre class="copy">{TEMPLATE}</pre>'))

CH.append(chapter(15, 'G / 残り', 'まだ決まっていないこと', '利用者に決めてもらうこと。上ほど、次の作業に効く。',
    table(['決めること', 'いまの案', '効く所'], [
        ['2 体目の大型をどれにするか', 'セルヴァルク（同じ狩場・風）か、火の獣', '11 章の 4'],
        ['残り 19 の狩場の名前と並び', '第 1 版の 5 つ（根絡み湿原・硝砂海岸・灰鐘鉱山・氷帆峡谷・霧灯樹海）+ 14 は未定', '9 章、11 章の 5'],
        ['商店の値段と、持ち出せる数', '6 章の表（机上の値）', '遊んだ感想で直す'],
        ['火の獣の名前と姿', '熾炉獣エンバルグ（黒い殻、胸の炉、背の排気口）。弱点は水、氷に強い', '8 章の 13 番、絵の依頼'],
        ['属性ごとの持ち主', '8 章の表の「候補」', 'モンスターの設定図、武器の系列'],
        ['複合属性の名前', '灼雷・凍嵐・霧氷', '上級・極級の武器'],
        ['段階と防具の数値', '4 章・6 章の表（机上の値）', '遊んだ感想で直す'],
        ['大型 12 種の原画を採用するか', 'ChatGPT の原画（2026-11-24 受領）は「採用待ち」。採用した種から、4 方向の設定図を頼む', '8 章の図鑑、11 章の 4'],
        ['2 体が同時に出る狩り・幼体の依頼・超大型', '登録簿に、組と群れの数を書けるだけ。仕組みは、まだ無い（幼体の依頼は、利用者: 後で作る）', '8 章、11 章の 4 より後'],
        ['景色の絵の直し', '貼った（v0.13.0、D-072）。外周の岩壁は箱のまま、里の建物の当たりは円のまま。遊んだ感想で直す', '9 章'],
        ['採取と採掘、実機の計測', '利用者: 後でよい', '11 章の 1・5'],
    ]) + '<h4>第 1 版との対応</h4>' + table(['第 1 版の章', 'この版では'], [
        ['01〜03 方針・使い方・分担', '生きている。分担は 2 章に要約'], ['04〜05 遊びの分解・規模', '生きている。段階は 3 つ → 4 つ（4 章）'],
        ['06〜09 操作・カメラ・戦闘・ダメージ', '実装済み（正本は docs/spec.md）。属性は 7 章で更新'], ['10〜12 ガルドロス・AI・依頼の流れ', '実装済み'],
        ['13 村・装備・長期進行', '4〜6 章で更新'], ['14 世界と 6 フィールド', '<b>約 20 の狩場 × 約 10 エリアへ</b>（9 章）'], ['15 大型 12 種', '13 種へ（8 章）'],
        ['16〜17 人物・素材・台帳', '生きている。武器は 7 系統へ（5 章）'], ['18〜24 画像・3D・モーション・音', '<b>そのまま使う</b>'],
        ['25〜29 ブラウザ・データ・Safari・保存・公開', '実装済み（正本は CLAUDE.md と docs/spec.md）'], ['30 協力', '未着手'],
        ['31〜32 開発段階・受入試験', '10〜11 章で更新'], ['33〜45 指示文', '12〜14 章で更新。第 1 版の指示文は、出発点として残す'], ['46〜48 参考資料', 'そのまま'],
    ], 'tight')))

CSS = '''
@page { size: A4; margin: 15mm 14mm 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", sans-serif; font-size: 9.2pt; line-height: 1.62; color: #23282a; margin: 0; }
.cover { height: 262mm; display: flex; flex-direction: column; justify-content: center; padding: 0 6mm; break-after: page; }
.cover .tag { font-size: 9pt; letter-spacing: .18em; color: #8a6a2f; }
.cover h1 { font-size: 34pt; line-height: 1.25; margin: 6mm 0 2mm; color: #1f2a26; }
.cover .sub { font-size: 15pt; color: #46514b; margin: 0 0 8mm; }
.cover .bar { width: 46mm; height: 2.2mm; background: #b08a4e; margin-bottom: 8mm; }
.cover p { margin: 1.2mm 0; color: #46514b; }
.cover .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 10mm 0 8mm; }
.cover .strip svg { width: 100%; display: block; border-radius: 1.5mm; }
.chapter { break-before: page; }
.part { font-size: 7.6pt; letter-spacing: .14em; color: #8a6a2f; border-bottom: .3mm solid #cdbf9f; padding-bottom: 1mm; }
h2 { font-size: 17pt; margin: 3mm 0 1mm; color: #1f2a26; }
h2 span { color: #b08a4e; margin-right: 3mm; font-size: 13pt; }
h3 { font-size: 11.5pt; margin: 0 0 1.5mm; color: #1f2a26; }
h3 small { font-size: 8.4pt; color: #6b756f; font-weight: 500; margin-right: 1mm; }
h3 .no { color: #b08a4e; margin-right: 2mm; font-size: 9.5pt; }
h4 { font-size: 10pt; margin: 4mm 0 1mm; color: #1f2a26; }
.lead { font-size: 10pt; color: #46514b; margin: 0 0 3mm; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; font-size: 8.4pt; line-height: 1.5; }
th, td { border: .2mm solid #cfd3cc; padding: 1.1mm 1.6mm; text-align: left; vertical-align: top; }
thead th { background: #2f3b36; color: #f1efe6; font-weight: 600; }
table.tight td, table.tight th { padding: .8mm 1.3mm; font-size: 8pt; }
table.narrow { width: 62%; }
tbody tr:nth-child(even) td { background: #f5f6f2; }
ul { margin: 1.5mm 0 2.5mm; padding-left: 5mm; }
li { margin: .7mm 0; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 7.8pt; background: #eef0ea; padding: 0 .8mm; border-radius: .6mm; }
.note { font-size: 8.2pt; color: #55605a; border-left: 1mm solid #b08a4e; padding: .8mm 0 .8mm 2.5mm; margin: 2mm 0; }
.loop { display: flex; align-items: center; gap: 1.5mm; margin: 2mm 0 3mm; flex-wrap: wrap; }
.loop span { background: #2f3b36; color: #f1efe6; padding: 1.4mm 3mm; border-radius: 1.2mm; font-size: 8.8pt; }
.loop i { color: #b08a4e; font-style: normal; font-weight: 700; }
.card { display: grid; grid-template-columns: 43% 1fr; gap: 4mm; break-inside: avoid; margin: 3.5mm 0; padding-top: 3mm; border-top: .3mm solid #cdbf9f; }
.card .art svg, .card .art img { width: 100%; display: block; border-radius: 1.5mm; background: #eef0ea; }
.card .cap { font-size: 6.8pt; color: #7a837d; margin-top: .8mm; }
table.kv { margin: 0; font-size: 8pt; }
table.kv th { width: 23mm; background: #eceee7; color: #2f3b36; font-weight: 600; white-space: nowrap; }
pre.copy { font-family: "Noto Sans CJK JP", sans-serif; font-size: 7.9pt; line-height: 1.55; background: #f3f1e8; border: .25mm solid #cdbf9f; border-radius: 1.2mm; padding: 3mm 4mm; white-space: pre-wrap; margin: 2mm 0; }
'''
strip = ''.join(DRAW[k]() for k in ('servalk', 'lumiska', 'kirisarv', 'embarg'))
cover = f'''<div class="cover"><div class="tag">PROJECT DESIGN / 02 — CONCEPT / SPECIFICATION / PLAN / PROMPTS</div>
<h1>霧境の狩人</h1><div class="sub">オリジナル狩猟アクション　制作計画・実装指示書　第 2 版</div><div class="bar"></div>
<p>ChatGPT × Claude ／ GitHub Pages × HTML ／ 横画面・三人称 3D</p><p>仮題：VEILBOUND HUNTERS</p>
<div class="strip">{strip}</div>
<p>2026 年 11 月 24 日 | Version 2.0 | ゲームの版 v{VERSION}</p>
<p>第 1 版（v1.0、11 月 22 日）からの作り直し。いま動いているものと、決まったことを正本にした。</p>
<p>数値はすべて机上の初期値。「候補」「案」は未決定。大型の絵は、ガルドロスを除き、ChatGPT の原画（採用待ち）。</p></div>'''
html = f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>霧境の狩人 制作計画・実装指示書 第 2 版</title><style>{CSS}</style></head><body>{cover}{"".join(CH)}</body></html>'
open(sys.argv[1], 'w', encoding='utf8').write(html)
# 絵を 1 体ずつのファイルにも書き出す（絵の依頼に添える）
if len(sys.argv) > 2:
    os.makedirs(sys.argv[2], exist_ok=True)
    for k, f in DRAW.items(): open(os.path.join(sys.argv[2], f'{k}.svg'), 'w', encoding='utf8').write(f())
print(len(html), 'bytes,', len(CH), 'chapters')
