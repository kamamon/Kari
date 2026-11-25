#!/usr/bin/env python3
"""Build the illustrated summary HTML; --pdf also prints it with WeasyPrint.

Full narrative, scripts and technical contracts remain in the companion MD/JSON.
The script creates no artwork derivative files and does not modify source artwork.
PDF raster images are optimized to 180 dpi; text remains vector text.
"""
from pathlib import Path
import collections
import html
import json
import re
import sys

HERE = Path(__file__).resolve().parent
E = html.escape


def read_json(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def p(text, cls=""):
    return f'<p class="{cls}">{text}</p>'


def note(text):
    return f'<div class="note">{text}</div>'


def link(name, label=None):
    return f'<a href="{E(name)}">{E(label or name)}</a>'


def source(*names):
    return '<div class="source">詳細：' + ' / '.join(link(n) for n in names) + '</div>'


def image(src, caption, cls="scene"):
    return f'<figure class="{cls}"><img src="{E(src)}" alt="{E(caption)}"><figcaption>{E(caption)}</figcaption></figure>'


def table(headers, rows, cls=""):
    return '<table class="' + cls + '"><thead><tr>' + ''.join('<th>'+h+'</th>' for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>'+str(c)+'</td>' for c in row) + '</tr>' for row in rows) + '</tbody></table>'


def callout(title, text):
    return f'<div class="callout"><h3>{title}</h3><p>{text}</p></div>'


art = read_json('art_generation_manifest.json')
assets = read_json('asset_manifest_v2.json')
quests = read_json('quest_proposals_v2.json')
story = read_json('story_proposal_v2.json')
refs = read_json('references/reference_manifest.json')
q_by_code = {q['code']: q for q in quests['additionalQuestProposals']}
asset_rows = assets['assets']
counts = collections.Counter(a['status'] for a in asset_rows)
assert len(story['chapterOrder']) == 11
assert quests['plannedMandatoryHuntCount'] == 15
assert quests['additionalQuestCount'] == 7
assert counts['generated-concept'] == 4
assert counts['existing-reference'] == 17
assert counts['parallel-production-reference'] == 1
assert counts['planned-not-produced'] == 22
pages = []


def page(kicker, title, body, cls=""):
    pages.append((kicker, title, body, cls))


page('VEILBOUND HUNTERS / STORY & ART v2', '帰り道の灯',
     '<div class="subtitle">雷が帰る峰</div>'
     + image('art/event_thunder_first_sighting_v1.png', '鳴天竜オルゼリオンとの初目撃。物語用の新規原画案。', 'cover-scene')
     + p('巨大な翼を追う。その先にあるのは、<br>人と荷が帰ってくる、いつもの道。', 'lead')
     + '<div class="cover-meta">看板モンスター連動ストーリー・原画・制作設計<br>2026年11月26日 / kamamon/Kari</div>'
     + note('<strong>拡張提案・制作原画。ゲーム本体への組み込みは未実施。</strong><br>本冊子は22ページの要約統合版です。物語本文、台本全文、クエスト条件、検証仕様は同梱のMD/JSONを参照してください。'), 'cover')

page('01 / THIS EDITION', '何が加わるのか',
     p('既存の「帰り道の灯」に看板の存在を編み込み、セオルミドの戦いの後へ、オルゼリオンとの追加決戦を置きます。初仕事の補給と最後の帰還が、同じ暮らしの成果として響く構成です。')
     + '<div class="stats">' + ''.join(f'<div><b>{n}</b><span>{label}</span></div>' for n,label in [('11','章構成'),('15','本筋の狩猟'),('7','追加依頼案'),('4','新規原画')]) + '</div>'
     + table(['継承するもの','今回の追加'], [
         ['物語ID story.homeward_lights','副題「雷が帰る峰」と、序盤から終盤までの看板の関わり'],
         ['ch0〜ch9の恒久ID','ch8とch9の間に追加決戦章を挿入'],
         ['旧主線ST01〜ST14','看板の必須狩猟1件。任意依頼6件は本筋を止めない'],
         ['ミナギ・ロクハ・イサネ・セナキ','新しい人物を増やす代わりに、対立と責任を掘り下げる'],
         ['里、霧、晶脈、道を守る狩り','雷痕と古い記録を比べ、原因と危険を切り分ける']])
     + callout('実装済みの範囲', '参照基点v0.34.0では、序章ch0・第1章ch1・sc00〜sc03が実装済み。ch2以降の見出し、今回の決戦・依頼・画像を、遊べる完成品とは扱いません。')
     + source('story_bible_v2.md','source_audit_v2.md','story_proposal_v2.json'))

page('02 / FLAGSHIP', '鳴天竜オルゼリオン',
     image('references/orzelion_concept_reference_v1.png','同時制作中の看板原画を参照用に収録。今回の新規4点には数えません。','profile-scene')
     + table(['項目','継承する看板案'],[
         ['外形','嵐青の鱗、象牙の胸腹、金銅の二冠と翼稜。翼腕2本＋後脚2本の4肢。'],
         ['雷の経路','胸左右の蓄雷嚢 → 翼前縁の二条導電板 → 尾端の三枚槍。冠は硬い警告角。'],
         ['生息と初出','主生息地は鉛雲高地。原種は中級rank.2。雨裂断崖へ巡回し、錆星高原で鉱物を補給する案。'],
         ['物語での役割','休息・放電場所と点検路が重なる個体へ対処。天候を作る神や、異変すべての黒幕にはしない。']])
     + note('提案IDはmonster.orzelion。基準mainには未登録。最終決戦のrank.4は別個体の調整案であり、原種の初出を変更しません。正式な形・技・素材は看板担当の正本を優先します。')
     + source('references/orzelion_design_reference_v1.md','source_audit_v2.md'))

page('03 / CHAPTERS 0-4', '前半：見えたものと、原因',
     p('看板を追う運命を宣告せず、最初は里の一人の働き手として始めます。薬と布が届く喜びを先に置き、その後に空と地面の違和感をつなぎます。')
     + table(['章','場所・主な狩猟','物語で分かること'],[
         ['ch0<br>あなたの帰る場所','灯継ぎの里','依頼と帰還を記録する。主人公の名前・性別・故郷は固定しない。'],
         ['ch1<br>獣の道、人の道','風礫盆地<br>ガルドロス／セルヴァルク','荷が届く。湿りの帯と細い焼け筋を追加記録するが、原因は断定しない。'],
         ['ch2<br>戻らない水','根絡み湿原<br>ヌメラドン／ヴェリト','焼け筋のない場所でも水が変わる。一頭を狩れば土地全体が戻るという仮説を弱める。'],
         ['ch3<br>潮待ちの浜','硝砂海岸<br>オルグラス／ルミスカ','安全な荷下ろし路から看板を初目撃。海岸は生息地に変更しない。'],
         ['ch4<br>閉じられた分かれ道','灰鐘鉱山<br>ボルナケル／アシュレイア','古い作業記録は飛竜目撃より前の水位変化を示す。過去の判断を読み直す。']])
     + callout('中級の任意初対峙', 'ST08後にTQ07「雲より先に、翼が鳴る」を用意。中級の別個体で予告と冷却を学べます。未受注でも後半の本筋情報と装備準備に到達できます。')
     + source('story_bible_v2.md','quest_proposals_v2.json'))

page('04 / CHAPTERS 5-EPILOGUE', '後半：帰れる道から作戦を組む',
     table(['章','場所・主な狩猟','狩りが作る成果'],[
         ['ch5<br>氷に残る道','氷帆峡谷<br>キリサーヴ／ラズメル','観測と帰路を確保。高地の古い擦過痕・新しい擦過痕を比較する。'],
         ['ch6<br>灯を持つ獣','霧灯樹海<br>テンガロ／ヴェルガイト','痺液・灯・雷を分けて記録。胸、翼、尾の予告を学ぶ。'],
         ['ch7<br>灯を減らす夜','風礫盆地・里<br>グラセドン','燃料と荷を必要な道へ集約。短い分流区間の試行で局所的な改善を確かめる。'],
         ['ch8<br>二つの環、一本の道','重霧環谷<br>セオルミド','下部作業区間と帰路を確保。休息と準備を挟み、高地の点検へつなぐ。'],
         ['追加決戦章<br>雷が帰る峰','鉛雲高地「鳴天の背」<br>オルゼリオン','休息・放電場と点検路が重なる個体へ対処し、高地の通行運用を見直す。'],
         ['ch9<br>新しい通行記録','灯継ぎの里','遠回りの道から人と荷が帰る。霧と閉鎖区間を残し、点検と暮らしが続く。']])
     + note('章順はch0〜ch8 → 追加決戦章 → 既存ch9。旧終章IDを改番せず、セオルミドの恒久ID monster.segranioも保持します。谷と高地は補給・帰路でつなぎ、同じ水路の上下とは断定しません。')
     + source('story_bible_v2.md','story_proposal_v2.json'))

characters = [
 ('ミナギ','受付と記録','portrait_minagi_focus_v1.png','安心させるための断言から、まだ分からない範囲を示す責任へ。出発と帰還を数え続け、最後の「おかえり」を支える。'),
 ('ロクハ','工房の職人','portrait_rokuha_thinking_v1.png','元どおりの丈夫さから、次に直せる形へ。割れた面や交換周期を読み、普段使う装備の留め具を確かめる。'),
 ('イサネ','荷を運ぶ商い手','portrait_isane_relief_v1.png','薬・布・部材を待つ人の時間を数える。閉鎖に反対するだけで終わらず、急ぐ荷と待てる荷を分ける。'),
 ('セナキ','道の補修と見回り','portrait_senaki_reflective_v1.png','かつて里を守った判断を隠さず、今の状況へ更新する。近道を知る誇りから、引き返せる道を残す責任へ。')]
char_html = '<div class="character-grid">'
for name, role, fn, desc in characters:
    char_html += f'<article class="character"><img src="../../art-source/portraits/{fn}"><h3>{name}</h3><div class="role">{role}</div><p>{desc}</p></article>'
char_html += '</div>'
page('05 / PEOPLE', '里へ戻る道をつなぐ四人', char_html
     + note('人物の外見・役割は既存素材を継承。主人公は特別な血筋や固定の容姿を持たせず、見たことを持ち帰る狩人として成長します。四人の働きに同行戦闘AIを必須としません。')
     + source('story_bible_v2.md','dialogue_and_direction_v2.md'))

page('06 / NEW ART 01', '空を横切る、大きな翼',
     image('art/event_thunder_first_sighting_v1.png','新規原画1 / 初目撃。第3章の成功帰還後の記録としても提示できる。','large-scene')
     + p('荷を守る人々が見上げた先に、オルゼリオンの輪郭が現れる。安全な位置からの目撃であり、無理な戦闘開始や強制被弾は要求しません。', 'lead-small')
     + callout('演出で伝える順番','大きな翼の外形 → 胸と後脚の重さ → 首を上げる警告 → 胸起点の蓄電。怖さを派手な閃光だけに頼らず、後半で学べる身体の動きを先に置きます。')
     + p('高地の点検路は、補修部材などを定期輸送するために残る往路。谷の安全な帰路と両方が整うことで、臨時輸送から日常運用へ戻れます。沿岸からの見通しと距離は地理の追加案として照合します。')
     + source('art_generation_manifest.json','story_bible_v2.md'))

clues=[
 ['T01','湿りの帯と焼け筋','焼け筋のない場所と、先行する水位記録を比べる。'],
 ['T02','二冠・胸・翼の変化','追加決戦で、胸嚢の膨らみと二条の方向を読む。'],
 ['T03','古い閉鎖札','当時守れた通行を知り、終章で新しい確認日を追記する。'],
 ['T04','高さの違う擦過痕','休息場の変化を仮説にする。同じ個体の年齢や日時を断定しない。'],
 ['T05','麻痺・光・放電の記録','テンガロ、ヴェルガイト、看板の器官を区別する。'],
 ['T06','少なくなる灯と荷','下部の帰路を通し、必要な場所に集約した成果を見せる。'],
 ['T07','初仕事の荷車','終章でも人・荷・主人公の帰還を数え、生活の成果を回収する。']]
page('07 / EVIDENCE', '七つの伏線を、狩りへ返す',
     p('根本の変化は、晶脈を通る湧水の長期変動と、閉じた分流路・鉱物堆積による流れの偏り。飛竜の目撃は、その全原因を一頭へ結びつける証拠にはなりません。')
     + table(['番号','先に見せるもの','後から分かる意味'],clues)
     + note('<strong>必須情報は成功帰還後の報告で保証。</strong><br>任意調査、見逃しやすい一度きりのカット、低確率素材を、本筋理解の唯一の入口にしません。気づいた人は先回りでき、気づかなかった人にも作戦の理由が届きます。')
     + source('story_bible_v2.md','quest_proposals_v2.json'))

page('08 / NEW ART 02', '手で直せる、短い区間',
     image('art/ref_thunder_field_station_v1.png','新規原画2 / 観測所と補修作業場の美術参考。精密な機構図ではない。','large-scene')
     + table(['小物','物語上の意味'],[
         ['記録板・比較用の薄片盆','確定したことと仮説を並べる。文字は絵へ焼き込まず、UIで読みやすく表示。'],
         ['交換できる留め具・素焼き部材','一度直せば永遠に持つ装置ではなく、変化を見て交換できる暮らし。'],
         ['木の観測杭・区間別通行札','通れる範囲と見合わせる範囲を、形と向きでも区別する。'],
         ['手動の分流レバー','狩人が確保した時間に、作業班が短い区間から手入れする。']])
     + p('部品別の寸法・可動範囲・接合・3状態の差分は今後制作。架空世界の美術用器具であり、現実の電気安全や実作業の説明ではありません。')
     + source('art_and_production_plan_v2.md','asset_manifest_v2.json'))

page('09 / READABLE CREATURE', '覚えた姿が、決戦で役に立つ',
     '<div class="flow"><div><b>胸左右</b><span>蓄雷嚢が二度膨らむ</span></div><div><b>翼前縁</b><span>二条が内から外へ灯る</span></div><div><b>尾の三枚槍</b><span>向きと接地を読む</span></div></div>'
     + table(['局面','身体・画面・音','狩人が判断すること'],[
         ['警告','首を上げ、硬い二冠を高く見せる','相手の向きと間合い。冠を発電装置や可動蝶番にしない。'],
         ['蓄電','胸の二度の膨らみ、翼板の乾いた音','どちらへ放電が進むか。音を消しても身体で読める。'],
         ['放電','予告した向きの細い電光と地面の形','回避方向と安全な隙間。背景の雷を攻撃判定と混同させない。'],
         ['冷却','胸が下がり、翼がたわみ、呼吸が荒くなる','通常武器で近づく反撃機会。長時間滞空で近接を封じない。']])
     + callout('他の生き物の学びを壊さない','テンガロは無属性・痺液による化学性の麻痺。ヴェルガイトの環冠と灯節、セオルミドの二環、看板の雷は、それぞれ別の器官と予告として学びます。')
     + note('場面画の冠付近の火花は、生成時の初期指示の名残です。正式な電路・板数・尾槍の形は看板資料を優先。画像だけで骨格や通電の時間順を検証済みとはしません。')
     + source('references/orzelion_design_reference_v1.md','art_and_production_plan_v2.md','art_generation_manifest.json'))

page('10 / NIGHT OF FEWER LIGHTS', '灯を減らす夜に、人が働く',
     image('../../art-source/story/event_story_limited_lights_v1.png','既存原画の再使用候補 / 第7章「灯を減らす夜」。','medium-scene')
     + p('旧近道を再開すれば荷は早く届く。それでも四人は、迂回の負担を分けて安全な道を選びます。消灯は燃料と通行の集約であり、飛竜を眠らせる合図ではありません。閉じる道には横木と札を置きます。')
     + table(['担当','この夜に引き受ける仕事'],[
         ['ミナギ','通れる区間と、まだ確かめられていない所を示す。'],
         ['イサネ','薬と布、補修部材を待てる時間で分ける。'],
         ['ロクハ','短い区間用の交換部材を整える。'],
         ['セナキ','作業者の退避と、引き返せる道を確認する。']])
     + p('グラセドンへの対処後に小区間の試行を行い、時間を置いた報告で改善を確かめます。狩猟と補修を順につなぎ、どちらか一方だけで全部が解決したことにはしません。')
     + source('story_bible_v2.md','dialogue_and_direction_v2.md'))

page('11 / TWO DISTINCT CLIMAXES', '谷の帰路、その先の峰',
     p('セオルミドの戦いを残す理由は、既存IDを守ることだけではありません。先に帰路を確保してから次の作戦を組むことが、主人公と里の成長を形にします。', 'lead-small')
     + table(['段階','場所・対象','成果と次に残る仕事'],[
         ['第8章 / ST14','重霧環谷<br>双環獣セオルミド<br>monster.segranio','下部作業区間と帰路を確保。短い補修と確認を行い、人と荷を高地側へ回せる。'],
         ['準備と休息','里・工房・受付','装備を整え、出発前情報を読める。連続ボス戦を強制しない。'],
         ['追加決戦 / TQ04','鉛雲高地「鳴天の背」<br>鳴天竜オルゼリオン','休息・放電場と点検路が重なる個体に対処。作業班が区間の確認と通行運用を見直す。'],
         ['成功後','各担当の報告 → 里','狩猟成功を保存し、作業、時間経過後の観測、帰還へ進む。']])
     + callout('高地へ向かう必要性','谷は安全な帰路、高地は補修部材などの定期輸送に残る往路と点検路。両方を整えて臨時輸送から日常運用へ戻します。「鳴天の背」は鉛雲高地内の小区域で、谷と同じ水路の上下とは決めません。')
     + p('雷装備は選べる準備の一つ。未狩猟の看板素材、特定武器、特定部位の破壊を、本筋の受注や成功に必須としません。')
     + source('story_bible_v2.md','story_proposal_v2.json'))

page('12 / NEW ART 03', '雷が帰る峰',
     image('art/event_thunder_final_ridge_v1.png','新規原画3 / 鉛雲高地「鳴天の背」の決戦前。','large-scene')
     + p('怖さの正体を知ったうえで、自分の足で近づく。<br>身体の予告を読み、普段の武器と技で決着をつける。', 'lead-small')
     + table(['提案','設計の意図'],[
         ['極級・★8 / 制限45分','本筋15本目の単体狩猟。目安18〜25分は未試遊の提案。'],
         ['任意中級個体とは別','TQ07で討伐した相手の復活や急成長にしない。種の初出rank.2を保持。'],
         ['成功保存から作業へ','カットシーン閲覧や設備QTEを成功条件にせず、通常狩猟を基礎にする。']])
     + note('捕獲を採用する場合は罠・鎮静・報酬・収容説明・UI・検証まで一貫させます。未対応なら討伐表記へ統一し、同じ本筋の成果へ進めます。')
     + source('quest_proposals_v2.json','art_and_production_plan_v2.md'))

page('13 / NEW ART 04', '新しい通行記録',
     image('art/event_thunder_homecoming_v1.png','新規原画4 / 霧が残る朝。遠回りの道から荷車と人が帰る。','large-scene')
     + '<blockquote>「荷車も、作業の人たちも戻った。<br>あとは、あなたの帰還を書くだけ。」<br>「……おかえり。」</blockquote>'
     + p('古い札を消さず、確認日を書き足す。工房には交換用の部材が残り、商店は次の荷を分け始める。今回の成果を失わず、里の暮らしと狩人の仕事が続きます。')
     + p('討伐した同個体を空へ戻す映像は使いません。捕獲後も収容と区間確認を描き、霧が世界中から消える結末にはしません。')
     + source('story_bible_v2.md','dialogue_and_direction_v2.md'))

quest_rows=[]
purpose={'TQ01':'湿原の堆積片4個の採集納品','TQ02':'鈍色鉱片3個の採掘納品','TQ03':'里の在庫から補修部材を納品','TQ04':'看板との本筋決戦','TQ05':'クリア後の巡回採集','TQ06':'別個体の反復狩猟','TQ07':'中級の任意初対峙'}
for code in ['TQ01','TQ02','TQ07','TQ03','TQ04','TQ05','TQ06']:
    q=q_by_code[code]
    limit=q['time']['timeLimitMinutes']
    quest_rows.append([code+'<br>'+('必須' if q['mandatory'] else '任意'),E(q['title']),E(q['receptionGrade']['name'])+'<br>★'+str(q['stars']),str(limit)+'分' if limit else 'なし',purpose[code]])
page('14 / QUEST CATALOG', '追加依頼7件を、役割でつなぐ',
     p('本筋に増える狩猟はTQ04の1件だけ。採集・採掘・納品・中級初対峙・後日談・再狩猟を任意で用意します。級別受付と星別見出しには同じ依頼IDを渡します。')
     + table(['参照','依頼名','級・星','制限','役割'],quest_rows,'quest-table')
     + note('星・時間・供給数は未試遊の提案値。TQ05の★7は極級向け地形移動量を含む暫定表示で、敵との戦闘難度を示しません。TQ03は里での在庫納品のため狩猟時計を持ちません。')
     + p('本筋の必須情報は任意依頼を受けなくても届きます。採取数は確定供給でそろい、希少素材抽選や部位破壊を物語の進行条件にしません。通常戦闘の体力・倍率・詳細報酬は別の実戦調整へ渡します。')
     + source('quest_proposals_v2.json'))

dialogue_file=HERE/'dialogue_and_direction_v2.md'
if dialogue_file.exists():
    dialogue_text=dialogue_file.read_text(encoding='utf-8')
    scene_heads=re.findall(r'^##\s+([^\n]+)',dialogue_text,re.M)
else:
    dialogue_text=''
    scene_heads=[]
# Index order is the narrative order; final build verifies the source file exists.
scene_titles = re.findall(r'^##\s+\d+\.\s+場面(\d+)「([^」]+)」',dialogue_text,re.M)
assert len(scene_titles)==12, '台本正本12場面を揃えてから冊子を生成する'
scene_summaries=[
 '成果を先に示し、痕跡の解釈を急がない',
 '雷痕と水の変化の不一致を残す',
 '看板の姿と、原因の推測を分ける',
 '閉鎖が里を守った経緯を読み直す',
 '古い擦れと新しい擦れを比べる',
 '痺液による麻痺と、放電を区別する',
 '胸・翼・尾と冷却を順に読む',
 '通す道と運ぶ荷を四人で集約する',
 '局所的な改善と残る課題を分ける',
 '谷の成果と、高地へ向かう準備',
 '対象への対処から補修開始へ進む',
 '人と荷、主人公の帰還を数える']
scene_rows=[[E(no),E(title),summary] for (no,title),summary in zip(scene_titles,scene_summaries)]
page('15 / DIALOGUE & DIRECTION', '会話を、誰かの仕事へつなぐ',
     p('台本は12場面。ここでは役割を要約します。全文・話者・演出・表示条件は台本正本を参照し、会話を読んだこと自体を勝利や報酬の条件にしません。')
     + table(['順','場面の役割','伝える内容'],scene_rows,'dialogue-table')
     + note('場面11・12はTQ04の成功保存だけで解禁。補修と時間経過は演出順で、既読・現実の待機・追加の保存フラグを要求しません。スキップしても記録から読めます。')
     + source('dialogue_and_direction_v2.md','art_and_production_plan_v2.md'))

page('16 / ASSET INVENTORY', '作ったもの、使うもの',
     '<div class="stats">' + ''.join(f'<div><b>{n}</b><span>{label}</span></div>' for n,label in [('4','新規原画'),('17','既存参照'),('1','看板参照'),('22','今後制作')]) + '</div>'
     + table(['状態','内容','扱い'],[
         ['新規原画4','初目撃／決戦岩棚／観測所／帰還','PNG、1672×941、RGB、非透過。生成プロンプトとSHA256を記録。'],
         ['既存表情5','ミナギ集中・安堵／ロクハ思考／イサネ安堵／セナキ省察','名前・衣装・髪・顔の連続性を継承。新しい表情の生成を必須にしない。'],
         ['既存場面4','到着／初仕事の帰還／古い記録／灯を減らす夜','本筋の記憶をつなぐ再使用候補。現在の使用状態は個別に確認。'],
         ['既存小物6','記録板／道灯の点灯・消灯／荷車／閉鎖横木／交換部材','原本は上書きせず、正式モデルとUIへ接続する。'],
         ['既存環境2','旧分流口／補修後の分流口','2枚の機構は完全一致ではない。3D差分は同じ基礎モデルから作る。'],
         ['看板参照1','オルゼリオン全身原画','並行制作のスナップショット。新規4枚とは別枠。']])
     + p('合計44項目の台帳。将来素材22件を「生成済み」に数えません。原画があることと、3D・操作・セーブまで動くことは別の完成条件です。')
     + source('asset_manifest_v2.json','asset_manifest_v2.csv','art_generation_manifest.json'))

planned=[a for a in asset_rows if a['status']=='planned-not-produced']
for no, group in enumerate([planned[:11],planned[11:]],1):
    rows=[]
    for a in group:
        rows.append([E(a['priority']),E(a['name'])+'<br><span class="muted">'+E(a['owner'])+'</span>',E(a['acceptance'])])
    page(f'{16+no:02d} / NEXT ASSETS {no}/2','今後制作する素材 '+str(no)+'/2',
         p('担当と完成条件を揃え、原画からゲームで使えるものへ進めます。以下はいずれも今回の提出では未制作です。')
         + table(['優先','素材・担当','完成時に確認すること'],rows,'asset-table')
         + source('asset_manifest_v2.json','art_and_production_plan_v2.md'))

page('19 / PRODUCTION ORDER', '少しずつ、遊べる単位で入れる',
     callout('P0 / 条件とテキスト','物語の解禁条件、記録の保存、既存序章への短い痕跡の記録を準備。未来章の受注ボタンや、未解禁の名前・解決を先に出さない。')
     + callout('P1 / 地域と中級の看板','本来の地域とST03〜ST14を制作し、鉛雲高地の中級個体・地上戦・予告を成立させる。TQ07は任意で、後半の進行を止めない。')
     + callout('P2 / 鳴天の背と追加決戦','高地の戦闘岩棚、極級の別個体、TQ04、作業の帰還報告、終章を組み合わせる。翼幅・カメラ・床・反撃機会を実機で調整する。')
     + callout('P3 / 動きと音を深める','人物の記録・補修動作、専用カメラ、音とBGM、任意調査の操作を追加。静止画・台詞で成立する段階から、遊びの検証を重ねる。')
     + p('制作分担は、看板担当＝生物と戦闘の正本、物語担当＝台本と意味、フィールド担当＝地理と歩ける空間、実装担当＝保存・判定・公開。全員が同じID・器官・達成条件を参照します。')
     + note('出現ムービーや新しい機能の完成を待つために、既存の依頼や自由狩猟を再ロックしません。未準備の内容は計画として保持し、別の盆地依頼を新しい地域の成果へ読み替えません。')
     + source('art_and_production_plan_v2.md','implementation_handoff_v2.md'))

page('20 / IMPLEMENTATION CONTRACT', '取り込み時に外せない四つの点',
     table(['現在の注意点','必要な対応'],[
         ['前章のゲートが不足','未来章をplayable:trueにするだけでは順序とネタバレを防げない。成功保存済みの前提依頼、実行コンテンツ、場面一覧の表示を同じ条件で制御する。'],
         ['終章はstepsなし','現行validatorの制約に合う新しい終章の表現を設計する。ダミー狩猟・ゼロ秒依頼で成功を偽装しない。'],
         ['保存はschemaVersion 5','questClearsを本筋達成の正本にする。既存の達成・claims・装備・在庫を保ち、必要な新情報は移行仕様を決めて追加。'],
         ['成功保存が先','会話閲覧やムービー終了は成功条件ではない。精算と保存に失敗したら報酬・世界状態を二重確定せず、回復手順へ戻す。']])
     + callout('一度限りの決戦と、続く狩猟','TQ04は初成功保存後に閉じ、戦闘の反復は別個体TQ06へ。記録は台詞・場面の再閲覧であり再受注ではありません。旧結果の討伐／捕獲が不明なら共通文を使います。')
     + callout('依頼ごとに確認','採集・採掘は必要量の確定供給と一括納品、里納品は在庫と報酬を一度の保存、狩猟は採用した捕獲可否と表示・支給の一致を検証します。')
     + note('このJSON群はproposal専用スキーマ。public/data/story.jsonや実行クエスト定義へ、そのまま置換・直読みしないでください。')
     + source('implementation_handoff_v2.md','story_proposal_v2.json','quest_proposals_v2.json'))

source_doc_links=[
 ('story_bible_v2.md','物語本文：11章、人物弧、伏線、結末'),
 ('dialogue_and_direction_v2.md','台本：12場面、話者、演出、成功・再挑戦'),
 ('quest_proposals_v2.json','既存14主線との対応、追加7依頼の条件'),
 ('story_proposal_v2.json','章順・前提・看板・進行の機械可読契約'),
 ('art_and_production_plan_v2.md','美術・音・UI・制作順と完成条件'),
 ('asset_manifest_v2.json','素材44項目の状態と担当'),
 ('implementation_handoff_v2.md','取り込み手順、保存と検証の契約'),
 ('source_audit_v2.md','採用・実装・並行制作の出典区別')]
page('21 / REFERENCES & LIMITS', '本文と正本を、次の担当へ',
     p('本冊子は企画レビュー用の統合要約です。台本の全行、JSONの全条件、未実装依存と検証項目は、次の正本へ戻って確認できます。')
     + table(['同梱ファイル','役割'],[[link(n),t] for n,t in source_doc_links],'reference-table')
     + '<h3>固定した参照基点</h3>'
     + p('kamamon/Kari / v0.34.0<br><code>0925487b686473e1a4d7e45fdc63449ef3a7d2ec</code><br>'+link('https://github.com/kamamon/Kari/tree/0925487b686473e1a4d7e45fdc63449ef3a7d2ec','GitHubの基準コミット')+'。実装状態はpublic/dataとsrc、採用履歴はdocs/chatgpt-board.mdを優先。')
     + p('看板は並行制作中の文書・原画をスナップショット収録。取得元・SHA256は '+link('references/reference_manifest.json')+'、画像生成の入力と確認結果は '+link('art_generation_manifest.json')+' に記録。正式採用版が更新されたら差分を照合します。')
     + note('未確認：3D・骨格・技・捕獲の実動作、後半地域の地理と設備、15本の戦闘難易度、報酬経済、iPhoneでの読みやすさと性能。原画の目視確認を、ゲーム完成や実機合格とは扱いません。'))

assert len(pages)==22, len(pages)

CSS='''
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html { background: #d6d8d6; }
body { margin: 0; color: #283637; font-family: "Noto Sans CJK JP", sans-serif; font-size: 11.2pt; line-height: 1.6; }
.page { width: 210mm; height: 297mm; margin: 7mm auto; padding: 17mm 17mm 16mm; position: relative; background: #faf9f3; break-after: page; box-shadow: 0 1mm 4mm #0002; }
.page:last-child { break-after: auto; }
.page-content { height: 251mm; }
.kicker { font-size: 11pt; color: #9c7341; font-weight: 700; letter-spacing: .05em; border-top: 1.3mm solid #344e54; padding-top: 3mm; }
h1 { font-size: 24pt; line-height: 1.35; letter-spacing: .01em; color: #233d44; margin: 5mm 0 6mm; font-weight: 700; }
h3 { font-size: 13pt; margin: 0 0 2mm; line-height: 1.45; color: #29444b; }
p { margin: 0 0 4mm; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 4mm 0; font-size: 11pt; line-height: 1.5; }
th { text-align: left; background: #344e54; color: white; padding: 2.5mm 2.5mm; font-weight: 700; }
td { padding: 2.7mm 2.5mm; vertical-align: top; border-bottom: .3mm solid #d4d9d3; overflow-wrap: anywhere; }
tr:nth-child(even) td { background: #f0f1e9; }
th:first-child,td:first-child { width: 27%; }
table:has(th:nth-child(3)) th:first-child,table:has(th:nth-child(3)) td:first-child { width: 22%; }
.note { background: #e7eee9; border-left: 1mm solid #577c74; padding: 3.5mm 4mm; font-size: 11pt; margin: 4mm 0; }
.callout { border-left: .8mm solid #b18b54; padding: 0 0 0 4mm; margin: 5mm 0; }
.callout p { margin-bottom: 0; }
.source { font-size: 11pt; line-height: 1.5; color: #53696d; margin-top: 5mm; overflow-wrap: anywhere; }
a { color: #345b67; text-decoration: underline; text-underline-offset: .15em; }
code { font-family: "Noto Sans Mono", monospace; font-size: 11pt; overflow-wrap: anywhere; }
figure { padding: 0; margin: 5mm 0; }
figure img { width: 100%; height: auto; display: block; object-fit: contain; border: .3mm solid #d1d7d0; }
figcaption { color: #566768; font-size: 11pt; line-height: 1.5; margin-top: 2mm; }
.cover-scene { margin: 7mm -17mm 7mm; }
.cover-scene img { border: 0; }
.cover-scene figcaption { margin-left: 17mm; margin-right: 17mm; }
.cover h1 { font-size: 34pt; margin: 6mm 0 0; }
.subtitle { font-family: "Noto Serif CJK JP", serif; font-size: 23pt; line-height: 1.35; color: #9c7341; margin-top: 2mm; }
.lead { font-family: "Noto Serif CJK JP", serif; font-size: 17pt; line-height: 1.7; margin: 6mm 0; }
.lead-small { font-family: "Noto Serif CJK JP", serif; font-size: 14pt; line-height: 1.7; margin: 5mm 0; }
.cover-meta { font-size: 11.5pt; margin-top: 5mm; }
.stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 3mm; margin: 5mm 0; }
.stats div { background: #e8ece5; padding: 3mm; border-top: .9mm solid #b18b54; }
.stats b { display:block; font-size: 25pt; line-height: 1.3; color: #2c4e58; }
.stats span { display:block; font-size: 11pt; }
.character-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
.character { background: #eff0e9; padding: 4mm; }
.character img { float: left; width: 22mm; height: 31mm; object-fit: contain; margin: 0 3mm 2mm 0; }
.character h3 { margin-top: 2mm; }
.character .role { font-size: 11pt; color:#765a35; }
.character p { clear: both; margin: 2mm 0 0; font-size: 11.2pt; }
.flow { display: grid; grid-template-columns: repeat(3,1fr); gap: 3mm; margin: 7mm 0; }
.flow div { background: #e1e9e7; border-top: 1mm solid #5f8796; padding: 4mm 3mm; }
.flow b { font-size: 14pt; display: block; }
.flow span { font-size:11pt; display:block; }
blockquote { border-left: 1mm solid #b18b54; margin: 7mm 0 6mm; padding: 1mm 0 1mm 5mm; color: #284249; font-family: "Noto Serif CJK JP",serif; font-size: 16pt; line-height: 1.8; }
.quest-table th:nth-child(1),.quest-table td:nth-child(1) { width: 12% !important; }
.quest-table th:nth-child(2),.quest-table td:nth-child(2) { width: 28%; }
.quest-table th:nth-child(3),.quest-table td:nth-child(3) { width: 13%; }
.quest-table th:nth-child(4),.quest-table td:nth-child(4) { width: 12%; }
.quest-table th:nth-child(5),.quest-table td:nth-child(5) { width: 35%; }
.dialogue-table td { padding-top: 2mm; padding-bottom: 2mm; }
.dialogue-table th:first-child,.dialogue-table td:first-child { width: 8% !important; }
.dialogue-table th:nth-child(2),.dialogue-table td:nth-child(2) { width: 34%; }
.asset-table th:first-child,.asset-table td:first-child { width: 10% !important; }
.asset-table th:nth-child(2),.asset-table td:nth-child(2) { width: 37%; }
.asset-table td { padding-top: 2.3mm; padding-bottom: 2.3mm; }
.muted { color: #657571; }
.reference-table th:first-child,.reference-table td:first-child { width: 47% !important; }
.reference-table td { padding: 2mm; }
footer { position: absolute; bottom: 9mm; left:17mm; right:17mm; display:flex; justify-content:space-between; border-top:.3mm solid #bdc9c4; padding-top:2mm; font-size:11pt; color:#647570; }
@media print { html { background:white; } .page { margin:0; box-shadow:none; } a { text-decoration:none; } }
'''
out=['<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>帰り道の灯 - 雷が帰る峰 / 物語・原画・制作設計 v2</title><style>',CSS,'</style></head><body>']
for i,(kicker,title,body,cls) in enumerate(pages,1):
    out.append(f'<section class="page {cls}" data-page="{i}"><div class="page-content"><div class="kicker">{E(kicker)}</div><h1>{E(title)}</h1>{body}</div><footer><span>霧境の狩人 / 制作設計 v2 / 提案・未組込</span><span>{i:02d} / {len(pages):02d}</span></footer></section>')
out.append('</body></html>')
(HERE/'review_book.html').write_text('\n'.join(out),encoding='utf-8')
print(json.dumps({'pages':len(pages),'html':str(HERE/'review_book.html'),'dialogue_source_present':bool(dialogue_text),'dialogue_h2_count':len(scene_heads),'asset_counts':dict(counts)},ensure_ascii=False))
if '--pdf' in sys.argv:
    from weasyprint import HTML
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import TextStringObject, NameObject
    import io
    pdf_options = {'optimize_images': True, 'jpeg_quality': 88, 'dpi': 180}
    document = HTML(filename=str(HERE/'review_book.html')).render(**pdf_options)
    assert len(document.pages)==22, len(document.pages)
    reader=PdfReader(io.BytesIO(document.write_pdf(**pdf_options)))
    writer=PdfWriter()
    writer.clone_document_from_reader(reader)
    prefix=HERE.as_uri()+'/'
    for pdf_page in writer.pages:
        for ref in pdf_page.get('/Annots',[]):
            annot=ref.get_object()
            action=annot.get('/A')
            if action and action.get('/S')=='/URI':
                uri=str(action.get('/URI',''))
                if uri.startswith(prefix):
                    action[NameObject('/URI')]=TextStringObject(uri[len(prefix):])
    writer.add_metadata({'/Title':'帰り道の灯 - 雷が帰る峰 / 物語・原画・制作設計 v2','/Author':'Kari project / ChatGPT','/Subject':'11章・15主線狩猟・7追加依頼・新規原画4点の制作提案要約'})
    pdf=HERE/'Kari_Flagship_Story_Design_v2.pdf'
    with pdf.open('wb') as stream:
        writer.write(stream)
    print(json.dumps({'pdf':str(pdf),'pages':len(writer.pages),'bytes':pdf.stat().st_size},ensure_ascii=False))
