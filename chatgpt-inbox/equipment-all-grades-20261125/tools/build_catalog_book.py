"""Render the complete, searchable 200-page equipment catalog from proposal JSON."""
from pathlib import Path
import argparse, base64, html, io, json, re, sys
from functools import lru_cache
from PIL import Image

P=Path(__file__).resolve().parents[1]
ROOT=P.parents[1]
DEFAULT_OUT=ROOT.parent/'outputs/equipment-all-20261125'
FONT='Noto Sans CJK JP'
RANK={1:'初級',2:'中級',3:'上級',4:'極級'}
FAM=['heavy_blade','guard_blade','war_maul','twin_blades','long_blade','long_lance','ring_bow']
FN=dict(zip(FAM,['断岳剣','護刃','大槌','双剣','太刀','長尖槍','環弓']))
SLOTS=['head','chest','arms','waist','legs'];SN=dict(zip(SLOTS,['頭','胴','腕','腰','脚']))
EL={'fire':'火','thunder':'雷','ice':'氷','water':'水','wind':'風','mist':'霧'}
ST={'poison':'毒','paralysis':'麻痺','sleep':'睡眠','stun':'気絶'}
PN={'raw':'無属性','precision':'高会心','single':'単属性','status':'状態異常','compound':'複合属性'}
AC={'heavy':'重装','medium':'中装','light':'軽装'}
METHOD={'monster':'狩猟素材','gather':'採集','mining':'採掘','insect':'虫取り'}
e=lambda x:html.escape(str(x))

CSS='''
@font-face{font-family:JP;src:local("Noto Sans CJK JP");font-weight:400}
@font-face{font-family:JP;src:local("Noto Sans CJK JP Bold");font-weight:700}
@page{size:A4;margin:13mm 15mm 15mm;@bottom-left{content:"VEILBOUND HUNTERS / 全装備図鑑 v2.0 / 2026.11.25";font-family:JP;font-size:7pt;color:#777b70}@bottom-right{content:counter(page);font-family:JP;font-size:9pt;color:#987d50}}
*{box-sizing:border-box}body{margin:0;color:#2b342f;font-family:JP,"Noto Sans CJK JP",sans-serif;font-size:9pt;line-height:1.42;background:#fff}
.page{height:267mm;break-after:page;padding:0;position:relative}.page:last-child{break-after:auto}
.brand{font-size:7pt;letter-spacing:1.7px;color:#6a776a;border-bottom:.25mm solid #aa9570;padding-bottom:2.3mm;margin-bottom:4mm}
.kicker{font-size:7.5pt;color:#9a7b45;letter-spacing:1.4px;margin:0 0 2mm;font-weight:700}
h1{font-size:23pt;line-height:1.25;margin:0 0 3mm}h2{font-size:15pt;line-height:1.3;margin:0 0 3mm}h3{font-size:10pt;color:#45604c;margin:3mm 0 1.5mm}
p{margin:1.5mm 0 2mm}b,strong{font-weight:700}.small{font-size:7.7pt}.tiny{font-size:6.8pt}.muted{color:#6f786c}.lead{font-size:11pt;line-height:1.65}.note{padding:2.5mm 3mm;background:#efeee6;border-left:.7mm solid #a58c61;font-size:8.1pt;margin:3mm 0}
table{border-collapse:collapse;width:100%;margin:1.5mm 0 3mm;table-layout:fixed;font-size:8pt;line-height:1.35}th{background:#dfe7da;color:#38503e;font-weight:700;text-align:left;border-top:.3mm solid #91a089;border-bottom:.25mm solid #91a089;padding:1.5mm 1.6mm}td{padding:1.4mm 1.6mm;vertical-align:top;border-bottom:.2mm solid #d7d5c7;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f7f4ec}thead{display:table-header-group}tr{break-inside:avoid}.center{text-align:center}.num{text-align:right;font-variant-numeric:tabular-nums}
.meta{font-size:8.2pt;color:#66715f;margin:2mm 0 3mm}.tags span{display:inline-block;background:#ece4d2;color:#7b613a;padding:.7mm 1.8mm;margin:0 1mm 1mm 0;font-size:7.5pt;border-radius:1mm}
.hero{width:100%;height:99mm;object-fit:contain;background:#f6f2e9;margin:1mm 0}.art{width:100%;height:83mm;object-fit:contain;background:#f6f2e9;margin:1mm 0}.caption{font-size:6.7pt;color:#74796e;margin:1mm 0 3mm}.missing{height:83mm;display:flex;align-items:center;justify-content:center;background:#f5f1e7;color:#a17f4b;border:1px dashed #c4ad84}
.cards{display:flex;gap:4mm;margin:6mm 0}.card{flex:1;background:#e8eddf;padding:5mm}.card strong{display:block;font-size:22pt;color:#3c5744}.card span{font-size:8pt}
.cover-title{font-size:32pt;margin:10mm 0 4mm}.cover-sub{font-size:16pt;color:#65755c}.cover-foot{position:absolute;bottom:6mm;left:0;font-size:8pt;color:#707568;max-width:175mm}
.toc{font-size:7.5pt;line-height:1.2}.toc th,.toc td{padding:.55mm 1.3mm}.toc a{color:#344f3d;text-decoration:none}
.parttable{font-size:7.7pt;margin:0 0 2mm}.parttable td{padding:1.15mm 1.5mm}.parttable td:first-child{width:11mm;font-weight:700;color:#49624d}
.evolution{font-size:7.4pt;line-height:1.3;margin:1mm 0}.evolution td{padding:1.1mm 1.5mm}.evolution td:first-child{width:13mm;font-weight:700}
.shape-table{font-size:7.1pt;line-height:1.3;margin:1mm 0}.shape-table td{padding:1.0mm 1.4mm}.shape-table td:first-child{width:18mm;font-weight:700;color:#49624d}
.stat-table{font-size:8.3pt;margin-bottom:3mm}.stat-table th,.stat-table td{text-align:center;padding:1.7mm 1.2mm}.stat-table td:first-child,.stat-table th:first-child{text-align:left;width:24mm;font-weight:700}.stat{font-size:8.7pt;font-weight:700}.substat{font-size:7.3pt;color:#5e7063}.unavailable{color:#a5aaa1}
.armorstats{font-size:8pt}.armorstats th,.armorstats td{padding:1.3mm 1.4mm;text-align:center}.armorstats th:first-child,.armorstats td:first-child{text-align:left;width:14mm}.armorstats th:last-child,.armorstats td:last-child{text-align:left;width:40mm}
.recipe{font-size:6.9pt;line-height:1.5}.recipe th,.recipe td{padding:1.4mm 1.3mm}.recipe th:nth-child(1){width:12mm}.recipe th:nth-child(2){width:52mm}.recipe th:nth-child(3){width:65mm}.recipe th:nth-child(4){width:51mm}.recipe .seq{font-size:7pt;color:#293b30;word-spacing:1mm}.recipe .fee{font-size:6.6pt;color:#7b765f;margin-top:1mm}.recipe .mats{font-size:6.9pt}
.dense-stats .stat-table th,.dense-stats .stat-table td{padding:.9mm 1.2mm}.dense-stats .armorstats th,.dense-stats .armorstats td{padding:.8mm 1.4mm}.dense-stats .recipe th,.dense-stats .recipe td{padding:.9mm 1.3mm}
.two{display:flex;gap:5mm}.two>div{flex:1}.source-list{font-size:7.4pt;line-height:1.5}.source-list p{margin:2mm 0}.source-list a{color:#49664e}.footnote{font-size:7.1pt;color:#727967;margin-top:3mm}
@media screen{body{background:#e5e3da;padding:15px}.page{width:210mm;height:297mm;margin:0 auto 20px;padding:13mm 15mm 15mm;background:#fff;box-shadow:0 2px 10px #0002}}
'''

@lru_cache(maxsize=None)
def uri(path):
    im=Image.open(path).convert('RGB');out=io.BytesIO();im.save(out,'JPEG',quality=91,subsampling=0,optimize=True)
    return 'data:image/jpeg;base64,'+base64.b64encode(out.getvalue()).decode()

def table(headers,rows,cls='',widths=None):
    heads=''.join('<th'+(f' style="width:{widths[i]}"' if widths else '')+'>'+h+'</th>' for i,h in enumerate(headers))
    return f'<table class="{cls}"><thead><tr>{heads}</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(x)+'</td>' for x in row)+'</tr>' for row in rows)+'</tbody></table>'

def page(title,body,kicker='',anchor=None,cover=False):
    return f'<section class="page"'+(f' id="{anchor}"' if anchor else '')+'><div class="brand">VEILBOUND HUNTERS <span style="float:right">EQUIPMENT CATALOG / v2.0</span></div>'+ (f'<p class="kicker">{e(kicker)}</p>' if kicker else '')+(f'<h1>{e(title)}</h1>' if title else '')+body+'</section>'

def short(text,limit=105):
    if len(text)<=limit:return text
    pieces=text.split('。');out=''
    for p in pieces:
        if len(out+p)>limit:break
        out+=p+'。'
    return out or text

def skill_name(doc,s,key,level=None):
    sk=s[key];name=doc['rules']['skills'][sk]['name'];param=s.get('skillParameters',{}).get(sk,{})
    if 'element' in param:name+='（'+EL[param['element']]+'）'
    if 'status' in param:name+='（'+ST[param['status']]+'）'
    return name+(f' Lv{level}' if level else '')

def stat(w):
    if not w:return '<span class="unavailable">未登場</span>'
    attr=' / '.join(EL[x] for x in w['elements'])+f' {w["elementValue"]:g}' if w['elements'] else ST[w['status']]+f' {w["statusPotency"]:g}' if w['status'] else '無属性'
    return f'<div class="stat">{w["attack"]} / {w["affinity"]}%</div><div class="substat">{e(attr)}</div>'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--draft',action='store_true');ap.add_argument('--output',type=Path,default=DEFAULT_OUT);ap.add_argument('--html-only',action='store_true');args=ap.parse_args()
    doc=json.loads((P/'data/all-equipment.json').read_text());series=doc['series'];out=args.output;out.mkdir(parents=True,exist_ok=True)
    missing=[s['artFile'] for s in series if not (P/s['artFile']).exists()]
    if missing and not args.draft:raise RuntimeError(f'{len(missing)} series art files not ready')
    wmap={(w['seriesId'],w['family'],w['rank']):w for w in doc['weaponCandidates']};amap={(a['seriesId'],a['slot'],a['rank']):a for a in doc['armorCandidates']};vmap={(v['seriesId'],v['rank']):v for v in doc['rankVariants']};rmap={r['resultId']:r for r in doc['recipes']};mmap={m['id']:m for m in doc['materials']}
    pages=[]
    cover=f'<p class="kicker">霧境の狩人 / 装備制作資料</p><div class="cover-title">全装備図鑑</div><div class="cover-sub">初級・中級・上級・極級</div><p class="lead">全86モンスターと、採集・採掘・虫取りの9系列。<br>素材の形から、狩りと探索の道具を組み立てる。</p>'
    cover+=f'<img class="hero" src="{uri(ROOT/"art-source/board/style_board_v2.png")}"><div class="cards"><div class="card"><strong>95</strong><span>装備系列</span></div><div class="card"><strong>250</strong><span>系列 × 級</span></div><div class="card"><strong>3,000</strong><span>武器・防具の性能候補</span></div></div>'
    cover+='<div class="note">設計・原画の提出版。既存装備の参照行を含む。新しい素材供給、採取、生産、技能、属性・状態異常の実装は別工程。原画は系列の初登場級を示し、高級の変化は各ページの形状仕様で定義する。</div><div class="cover-foot">基点: Kari v0.26.0 / 2026.11.25<br>7武器種・5防具部位。恒久IDと元の初登場級を保持。表紙は採用済みの世界観基準ボード。</div>'
    pages.append(page('',cover))
    rows=[]
    for r in range(1,5):
        c=doc['counts']['byRank'][str(r)];rows.append([RANK[r],f'T{r+1}',c['monsterSeries'],9,c['weapons'],c['armor']])
    body='<p class="lead">上級や極級で出会う種を、初級から作れる装備にはしない。各種の初登場級から、その上の級へ強化する。</p>'+table(['級','既存の段','モンスター','採取系列','武器','防具'],rows)
    body+='<h3>何を全件作ったか</h3><p>大型68種・幼体8種・巨大10種の全86種に、7武器の形状と5部位防具を設定。初級21・中級20・上級25・極級20の初登場を守り、計214系列級へ展開した。採取9系列を4級へ展開した36系列級を合わせ、250系列級となる。</p><p>武器1,750点、防具1,250点、生産・強化レシピ3,000件。既存ガルドロスの28武器・20防具・48レシピを含むため、すべて新規装備という意味ではない。</p><h3>級とT段階を混同しない</h3><p>T1は里の初期装備。現行ガルドロスは初級T2から極級T5へ対応する。星数は依頼の危険度であり、素材の級に変換しない。級の解放は現行の先行依頼達成を起点とし、存在しないプレイヤー級フィールドを追加済みとして扱わない。</p>'
    body+='<h3>幼体も装備系列へ</h3><p>今回の「全モンスター」に合わせ、幼体8種にも成人用装備を設計した。小さな板や膜を接合し、親と同じ巨大な器官を持たせない。高級個体・高級素材は新設計。扱いやすい探索寄りの性能にし、大型装備より低い攻撃・防御予算とする。</p><div class="note">採取装備の材料は討伐不要。級と狩場の解放は通常の進行に従う。現在の実装は風礫盆地を中心としており、将来狩場の素材を今すぐ採れるとは扱わない。</div>'
    pages.append(page('四つの級と、装備の範囲',body,'01 / SCOPE'))
    for part,(start,end) in enumerate([(0,48),(48,95)],1):
        rows=[]
        for i,s in enumerate(series[start:end],start):
            no=f'{s["no"]:03}' if s['category']=='monster' else f'G{s["no"]-86:02}'
            rows.append([no,f'<a href="#series-{s["no"]}">{e(s["name"])} / {e(s["seriesName"])}</a>',RANK[s['nativeRank']],METHOD[s['category']],str(11+i*2)])
        body='<p class="small">各系列は見開き2ページ。左に原画・5部位・7武器の形、右に級別性能・素材・正確な必要数を収録。</p>'+table(['No.','系列','初登場','素材の入手','ページ'],rows,'toc',['13mm','97mm','20mm','30mm','20mm'])
        pages.append(page(f'装備索引 {part} / 2',body,'02 / INDEX'))
    rows=[]
    for f in FAM:
        rows.append([FN[f]]+[str(next(w['attack'] for w in doc['weaponCandidates'] if w['sourceSpeciesId']=='monster.galdros' and w['family']==f and w['rank']==r)) for r in range(1,5)])
    body=table(['基準武器','初級A','中級A','上級A','極級A'],rows)
    body+=table(['性能型','攻撃力','会心','属性 / 基礎蓄積'],[['無属性','A','0%','なし'],['高会心','四捨五入(A × 0.94)','25%','なし'],['単属性','四捨五入(A × 0.92)','0%','属性E = 四捨五入(A × 0.28)'],['状態異常','四捨五入(A × 0.94)','0%','蓄積S = A × 0.10、小数1桁'],['複合属性','四捨五入(A × 0.88)','0%','同級の単属性E × 1.5、小数0.5を保持']])
    body+='<h3>手数だけで属性が伸びない計算</h3><p>属性と状態異常には、各ヒットの最終モーション係数を使う。溜め・勢い・弓の距離補正は一回だけ適用し、コンボ全体の値を一発ごとへ重ねない。会心は物理部分だけで、通常会心1.25倍。技能を含む正会心率は最大60%。</p><p class="note">物理肉質0.60・属性弱点0.30の仮条件では、丸め前の単属性型は無属性型の約1.06倍、複合型は約1.09倍。これは同じ総モーション係数での机上比較。実戦DPSや討伐時間の検証結果ではない。</p><h3>複合・幼体・採取装備</h3><p>複合は上級・極級のみ。2属性の部位係数の大きい方を使い、どちらも弱点指定でない相手では属性項のみ半減する。幼体は攻撃係数へ0.94、属性/状態係数へ0.85を追加。採取系列は各系列の明示した攻撃比率と会心を使い、発光や鉱石の色を属性攻撃に読み替えない。</p><p class="footnote">全武器の刃・打面・弓の既存仕様、攻撃判定、握り、モーションの時間はこの提案で変更しない。武器種ごとの形は索引後の全系列ページへ。</p>'
    pages.append(page('武器の性能予算',body,'03 / WEAPON RULES'))
    rows=[]
    for k,v in doc['rules']['skills'].items():rows.append([e(v['name']),'/'.join(str(x) for x in v['values'])+e(v['unit']),e(short(v['effect'],80))])
    body='<p class="small">1部位1点、5部位で5点。主技能は頭・腕・脚のLv3、副技能は胴・腰のLv2。各技能上限Lv3。混成装備を許し、一式専用ボーナスは置かない。</p>'+table(['技能','Lv1 / 2 / 3','効果'],rows,'small',['30mm','38mm','112mm'])
    body+='<h3>防御と耐性</h3><p class="small">基準一式防御は初級30・中級65・上級105・極級150。重装100%、中装95%、軽装90%。幼体と採取系列はさらに90%。合計を四捨五入し5部位へ配分、余りは胴→脚→頭→腕→腰。軽装へ移動・攻撃速度の隠れた強化は付けない。</p><p class="small">素材元の弱点は各部位−2、得意属性は＋3。技能後の合計を−30〜＋30へ制限し、受ける属性項だけへ適用する。耐性技能は技能IDと対象属性/状態の組で集計する。</p>'
    pages.append(page('防具と16の技能',body,'04 / ARMOR RULES'))
    body=table(['状態','基準の発症','効果','連続発症'],[['毒','初回100','最大HPの2%を15秒・10回へ分配','同じ毒の継続中は蓄積しない'],['麻痺','初回100','2.5秒','終了後も硬直の猶予を設ける'],['睡眠','初回100','8秒。起こす最初の物理命中だけ1.5倍','同tickの命中順を固定'],['気絶','頭部への許可された打撃のみ100','2.5秒','斬撃へ自動付与しない']])
    body+='<h3>蓄積は命中の性質に結び付ける</h3><p>基礎蓄積 × 最終モーション係数 × 状態部位係数 × 技能。固定小数1000単位で保持する。毒の剣でも盾打ちへ自動で毒を付けず、接触タグを持つ命中だけを対象にする。頭部はタグで判定し、部位配列の先頭を頭とみなさない。</p><p>毒・麻痺・睡眠は発症回数nに応じてceil(100 × 1.35^n)。気絶はceil(100 × 1.5^n)。蓄積が5秒入らなければ毎秒2ずつ減る。発症時の超過蓄積は破棄する。</p><h3>拘束が途切れなく続くことを防ぐ</h3><p>麻痺・睡眠・気絶は重複させない。硬直継続中と終了後180tickは別硬直のゲージを閾値の0.001手前へ制限する。猶予が終わっただけでは発症させず、次の有効命中を必要とする。毒は別枠。</p><h3>受傷計算の丸め順</h3><p>物理と耐性適用後の属性を足し、防御・級・既存経路の怒り倍率を掛けた小数を、ガード等の分岐へ渡す。分岐後に一度だけ切り捨てる。通常と防御崩れは最小1、ガード削りは0可、受け流し・受け返しは0。</p><div class="note">例：入力72.864、崩れ倍率0.7なら最終51。先に72へ丸めると50になり、既存の受傷挙動が変わる。怒り倍率を元々使わないhazard経路へ、新たに掛けない。</div><p class="footnote">敵への武器状態異常は追加設計。部位怯み・転倒との競合、全武器での実戦時間、iPhoneでの操作は実装後に確認する。</p>'
    pages.append(page('属性・状態異常と受傷',body,'05 / COMBAT INTEGRATION'))
    rows=[]
    for s in series[86:]:rows.append([e(s['seriesName']),METHOD[s['category']],f'{s["rawRatio"]*100:g}% / {s["affinity"]}%', '<br>'.join(f'{RANK[m["rank"]]}：{e(m["name"])}' for m in s['materialChain'])])
    body='<p class="lead">採集3・採掘3・虫取り3の9系列。全レシピの材料を、討伐以外の入手方法だけでそろえる。</p>'+table(['系列','入手','攻撃比 / 会心','級別の主素材'],rows,'small',['24mm','18mm','32mm','106mm'])
    body+='<h3>素材と見た目の意味を守る</h3><p class="small">天然の潮青鉱石はガルドロスの青銅晶脈とは別。氷縁硬石もキリサーヴの冷晶ではない。ホソアカリ樹脂は反射する保護材で、自発光しない。灯虫の光は小さな灯嚢の表現であり、雷・霧属性の攻撃にはしない。</p><p class="small">12種の虫素材と新しい高級採取素材は今回の新提案。採取装備の防御は同装甲区分の大型装備から10%低くし、探索技能と作りやすさを持たせる。</p>'
    pages.append(page('採集・採掘・虫取りの9系列',body,'06 / FIELD MATERIALS'))
    body='<h3>系列の入口と強化</h3><p>新系列は初登場級で直接生産し、その後は同じ系列・武器種・防具部位を一方向に強化する。強化は前の装備を消費。横派生を増やさず、既存ガルドロスの48レシピはそのまま保持する。</p>'
    body+=table(['項目','作成時の扱い'],[['新しい武器','主材4＋級差、支持材2＋上級補正、機能材1＋上級補正。大剣/槌/双剣/槍/盾/弓の必要量を形状に合わせて増す。'],['新しい防具','主材は頭2・胴4・腕3・腰3・脚4に級差を追加。支持材は胴脚2、他1。機能材は頭胴脚1、腕腰0。'],['級差','初級0、中級1、上級2、極級3。初登場が中級以降でも、その級の必要量を使う。'],['素材の重複','同じ素材が主材と支持材を兼ねる時は必要数を合算する。付属データでは重複行にしない。'],['お金','通常武器120/400/900/1800、防具80/250/550/1100。幼体85%、採取70%を四捨五入。既存ガルドロスは元の値。']])
    body+='<h3>この本のレシピ表の読み方</h3><p>各系列右ページの素材欄は①②③…の順に材料を示す。必要数の「5/2/1」はその順の個数。武器欄の7組は、断岳剣→護刃→大槌→双剣→太刀→長尖槍→環弓。防具欄の5組は、頭→胴→腕→腰→脚。0はその材料を使わない。</p><p>行に書いたお金は武器1点または防具1部位の費用。一式価格ではない。強化の時には前級の同装備も必要。新系列の初登場級では前装備を要求しない。</p><h3>採取を装備の所持で塞がない</h3><p>その級と狩場を解放していれば、貸与の基本道具でも素材を得られる。同級の虫装備を作るために同級虫装備が必要、という循環を作らない。採取技能は作業時間や既知の近い採取点を見つける補助に限定し、レア確定や抽選回数増加を付けない。</p><div class="note">材料の名前があることと、現在のゲームで入手できることは別。採取システム、各級の個体・採取点、加工、直接生産、ドロップ・報酬はClaudeへ渡す実装項目として明示する。</div>'
    pages.append(page('生産と必要素材',body,'07 / CRAFTING'))
    sources=json.loads((P/'references/sources.json').read_text())
    source_paths=['public/data/bestiary.json','public/data/ranks.json','public/data/weapons.json','public/data/armor.json','public/data/recipes.json','docs/elements.md','docs/source/chatgpt-quest-design-20261125/resources_v2.json']
    body='<h3>導入する順番</h3><p>1. 級・狩場・素材供給を結ぶ。2. 新系列の直接生産と線形強化を追加。3. 属性倍率と部位ごとの属性係数を同時に導入。4. 防具描画をガルドロス専用から汎用化。5. 技能・耐性・状態異常を追加。6. 保存と復元を検査し、戦闘と採取を実機で調整する。</p><p>現行保存schemaは4。既存IDと所持品を保持し、必要な移行はClaude側で版管理する。No.57の表示名はテムソギア、IDはmonster.tarhegna。No.71はセオルミド、IDはmonster.segranio。名前から恒久IDを作り直さない。</p><h3>確認の範囲</h3><p>全86元ID、95系列、250系列級、3,000装備・レシピ、級の下限、素材参照、非狩猟レシピ、技能予算、既存値保持と素材重複の統合を含む静的整合確認を実施。原画の武器群と防具部位を目視し、PDFのページ構成と文字・図版のはみ出しを確認する。</p><p>実戦DPS、討伐時間、採取の所要時間、衣装と共通リグの干渉、各級の独立設定図、3Dモデルは未確認・未制作。生成原画は採用済みの設定図を自動で上書きしない。</p><h3>根拠資料</h3><div class="source-list">'
    for path in source_paths:
        url=f'https://github.com/kamamon/Kari/blob/{doc["sourceCommit"]}/{path}';body+=f'<p><a href="{url}">{e(path)}</a></p>'
    body+='</div><p class="footnote">全ファイルの固定コミットURL・SHA256、生成プロンプト、画像の確認記録、正確な全項目は付属データに収録。この提案JSONをbestiary importerや現行装備ローダーへ直接渡さない。</p>'
    pages.append(page('実装への引き継ぎと出典',body,'08 / HANDOFF'))
    assert len(pages)==10
    for idx,s in enumerate(series):
        sid=s['id'];no=f'{s["no"]:03}' if s['category']=='monster' else f'G{s["no"]-86:02}'
        grade=f'{RANK[s["nativeRank"]]}から'+('極級まで' if s['nativeRank']<4 else '')
        profile=PN[s['weaponProfile']];attr=' / '.join(EL[x] for x in s['elements']) if s['elements'] else ST.get(s['status'],'')
        body=f'<div class="tags"><span>{e(grade)}</span><span>{AC[s["armorClass"]]}</span><span>{profile}{e(" / "+attr if attr else "")}</span><span>{METHOD[s["category"]]}</span></div><p class="small">{e(s["silhouette"])}</p>'
        path=P/s['artFile']
        body+=f'<img class="art" src="{uri(path)}">' if path.exists() else f'<div class="missing">原画制作中: {e(s["name"])}</div>'
        body+='<p class="caption">初登場級の系列比較原画。01断岳剣 / 02護刃 / 03大槌 / 04双剣 / 05太刀 / 06長尖槍 / 07環弓。正投影・同一縮尺・高級の別画像ではない。</p>'
        body+='<h3>5部位の外観</h3><table class="parttable">'+''.join(f'<tr><td>{SN[k]}</td><td>{e(s["armorParts"][k])}</td></tr>' for k in SLOTS)+'</table>'
        body+='<h3>7武器の形状要点</h3><table class="shape-table">'+''.join(f'<tr><td>{FN[k]}</td><td>{e(short(s["weapons"][k]["shape"],95))}</td></tr>' for k in FAM)+'</table>'
        body+='<h3>級による形状の変化</h3><table class="evolution">'
        for rank in range(s['nativeRank'],5):
            text='このページの原画・部位表の形を基準とする。' if rank==s['nativeRank'] else short(s['gradeAppearance'][str(rank)],105)
            body+=f'<tr><td>{RANK[rank]}</td><td>{e(text)}</td></tr>'
        body+='</table>'
        pages.append(page(f'{s["seriesName"]} / {s["name"]}',body,f'{no} / EQUIPMENT DESIGN',f'series-{s["no"]}'))
        body='<p class="small">各セルは <b>攻撃力 / 会心率</b>、下段は属性値または状態異常の基礎蓄積。未登場の級は生産対象にしない。</p>'
        body+=table(['武器']+[RANK[r] for r in range(1,5)],[[FN[f]]+[stat(wmap.get((sid,f,r))) for r in range(1,5)] for f in FAM],'stat-table')
        armorrows=[]
        for slot in SLOTS:
            vals=[str(amap[(sid,slot,r)]['defense']) if (sid,slot,r) in amap else '未登場' for r in range(1,5)]
            sk=skill_name(doc,s,'primarySkill' if slot in ['head','arms','legs'] else 'secondarySkill')
            armorrows.append([SN[slot]]+vals+[e(sk)+' 1点'])
        armorrows.append(['一式']+[str(vmap[(sid,r)]['setDefense']) if (sid,r) in vmap else '未登場' for r in range(1,5)]+['計5点'])
        body+='<h3>5部位の防御と技能</h3>'+table(['部位']+[RANK[r] for r in range(1,5)]+['各部位の技能'],armorrows,'armorstats')
        resist=vmap[(sid,s['nativeRank'])]['resistancePerPiece'];rt=' / '.join(f'{EL[k]} {v*5:+}' for k,v in resist.items() if v) or '全属性0'
        body+=f'<p class="small"><b>一式：</b>{e(skill_name(doc,s,"primarySkill",3))} ＋ {e(skill_name(doc,s,"secondarySkill",2))}<br><b>技能前の一式耐性：</b>{e(rt)}。耐性は受ける属性項だけへ適用。</p>'
        rrows=[];dense_recipe_layout=False
        for rank in range(s['nativeRank'],5):
            wr=[rmap[wmap[(sid,f,rank)]['id']] for f in FAM];ar=[rmap[amap[(sid,k,rank)]['id']] for k in SLOTS]
            mids=list(dict.fromkeys(i['materialId'] for rec in wr+ar for i in rec['ingredients']))
            def seq(recs):
                out=[]
                for rec in recs:
                    c={i['materialId']:i['count'] for i in rec['ingredients']};out.append('/'.join(str(c.get(mid,0)) for mid in mids))
                return '　'.join(out)
            # The legacy Galdros recipes have more than three materials. Compact
            # labels prevent the upper two rank rows from falling off the page.
            if len(mids) > 3:
                dense_recipe_layout=True
                names=' '.join(f'<span style="display:inline-block;white-space:nowrap;margin-right:1.5mm">{j+1}. {e(mmap[mid]["name"])}</span>' for j,mid in enumerate(mids))
            else:
                names='<br>'.join(f'{j+1}. {e(mmap[mid]["name"])}' for j,mid in enumerate(mids))
            wc=f'<div class="seq">{seq(wr)}</div><div class="fee">各武器 {wr[0]["money"]:,} / '+('直接生産' if wr[0]['fromId'] is None else '前装備を消費')+'</div>'
            ac=f'<div class="seq">{seq(ar)}</div><div class="fee">各部位 {ar[0]["money"]:,} / '+('直接生産' if ar[0]['fromId'] is None else '前装備を消費')+'</div>'
            rrows.append([RANK[rank],names,wc,ac])
        body+='<h3>全武器・全防具の必要素材</h3><p class="tiny muted">素材番号の順に個数を「/」で区切る。武器7組＝断岳剣→護刃→大槌→双剣→太刀→長尖槍→環弓。防具5組＝頭→胴→腕→腰→脚。0は不使用。金額は1点分。</p>'+table(['級','素材番号','武器7種の必要数','防具5部位の必要数'],rrows,'recipe')
        # Shared implementation and collection caveats are stated on pages 2, 8–10.
        # Repeating them here created footnote-only pages after dense rank-1 recipes.
        if dense_recipe_layout:body='<div class="dense-stats">'+body+'</div>'
        pages.append(page(f'{s["seriesName"]} / 級別性能・生産',body,f'{no} / STATS & CRAFTING'))
    assert len(pages)==200
    title='Kari 全装備図鑑 四級版 v2.0'
    source='<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>'+title+'</title><style>'+CSS+'</style></head><body>'+''.join(pages)+'</body></html>'
    suffix='_draft' if args.draft else ''
    html_path=out/f'Kari_All_Equipment_v2{suffix}.html';html_path.write_text(source)
    if args.html_only:print(json.dumps(dict(html=str(html_path),intendedPages=len(pages),missingArt=len(missing))));return
    try:from weasyprint import HTML
    except ImportError:
        sys.path.insert(0,str(ROOT.parent/'pdf-deps'));from weasyprint import HTML
    rendered=HTML(string=source,base_url=str(P)).render()
    pdf_path=out/f'Kari_All_Equipment_v2{suffix}.pdf';rendered.write_pdf(pdf_path)
    overlaps=[]
    for i,page_obj in enumerate(rendered.pages,1):
        body_limit=page_obj.height-15*96/25.4
        for box in page_obj._page_box.descendants():
            if type(box).__name__=='TextBox' and getattr(box,'element_tag',None) and getattr(box,'text','').strip() and box.position_y+box.height>body_limit+1:
                overlaps.append(dict(page=i,text=box.text[:70],bottom=round(box.position_y+box.height,1)))
    from pypdf import PdfReader
    reader=PdfReader(pdf_path);txt='\n'.join(p.extract_text() or '' for p in reader.pages)
    missing_names=[s['name'] for s in series if s['name'] not in txt]
    import fitz
    with fitz.open(pdf_path) as live_pdf:
        toc_links=[link for index in [2,3] for link in live_pdf[index].get_links()]
        toc_targets_correct=sorted(link.get('page',-1) for link in toc_links)==list(range(10,200,2))
        missing_recipe_ranks=[];recipe_rank_rows=0
        for index,s in enumerate(series):
            page_index=11+index*2
            text=live_pdf[page_index].get_text('text') if page_index<len(live_pdf) else ''
            tail=text.split('全武器・全防具の必要素材',1)[1] if '全武器・全防具の必要素材' in text else ''
            for rank in range(s['nativeRank'],5):
                if re.search(r'(?m)^'+RANK[rank]+r'$',tail):recipe_rank_rows+=1
                else:missing_recipe_ranks.append(dict(series=s['id'],rank=rank,page=page_index+1))
    report=dict(sourceCommit=doc['sourceCommit'],pdfPages=len(reader.pages),expectedPages=200,pageCountMatches=len(reader.pages)==200,missingNames=missing_names,
                missingArt=missing,footerOverlaps=overlaps,pdfBytes=pdf_path.stat().st_size,htmlBytes=html_path.stat().st_size,
                tocLinks=len(toc_links),tocTargetsCorrect=toc_targets_correct,recipeRankRows=recipe_rank_rows,missingRecipeRanks=missing_recipe_ranks,
                imageEncoding='Original pixel dimensions, JPEG quality91 4:4:4 for document embedding. Original PNG art retained.',draft=args.draft,
                visualReview='pending',generatedFiles=[str(pdf_path),str(html_path)])
    (P/'analysis'/f'book-validation{suffix}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (out/f'Kari_All_Equipment_v2{suffix}_text.txt').write_text(txt)
    print(json.dumps(report,ensure_ascii=False))
    if len(reader.pages)!=200 or not toc_targets_correct or overlaps or missing_names or missing_recipe_ranks:
        raise RuntimeError('Catalog layout or table-of-contents coverage failed; review before delivery')

if __name__=='__main__':main()
