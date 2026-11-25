"""Build the Japanese design PDF from the reviewed delivery sources and measured tables."""
from pathlib import Path
import json, html, re
from markdown_it import MarkdownIt
from weasyprint import HTML

HERE=Path(__file__).resolve().parent
md=MarkdownIt('commonmark',{'html':True}).enable('table')
esc=html.escape

def text_file(path):
    p=HERE/path
    return p.read_text(encoding='utf-8') if p.exists() else ''

def render_md(path, omit_title=False):
    value=text_file(path)
    if omit_title:value=re.sub(r'^# [^\n]+\n+', '', value, count=1)
    return md.render(value)

def fmt(v):
    n=round(float(v)*100,3)
    return str(int(n)) if float(n).is_integer() else str(n)

def values(r,old=False):
    k='oldCoefficient' if old else 'newCoefficient'
    if r['hitWindows']:
        val=' + '.join(fmt(x[k]) for x in r['hitWindows'])
        c=r.get('oldCharge' if old else 'charge')
        if c:
            base=sum(x[k]*x.get('maxHitsPerTarget',1) for x in r['hitWindows'])
            return ' / '.join(fmt(base*x) for x in c['coefficientScale'])+'<br><small>無溜め / 溜め1 / 2 / 3</small>'
        return val
    sh=r['oldShoot' if old else 'shoot'][0]
    return ' / '.join(fmt(v) for v in sh['coefficient'])+((' × '+str(sh['count'])) if sh['count']>1 else '')

def move_tables(rows):
    sections=[]
    for fam in ['heavy_blade','guard_blade','long_lance','war_maul','twin_blades','long_blade','ring_bow']:
        rs=[r for r in rows if r['family']==fam]
        s='<section class="family"><h3>'+rs[0]['familyName']+'</h3><table class="moves"><colgroup><col style="width:31%"><col style="width:22%"><col style="width:27%"><col style="width:20%"></colgroup><thead><tr><th>技 / ID</th><th>旧MV</th><th>提案MV</th><th>発生 / 全長</th></tr></thead>'
        for r in rs:
            s+=f'<tbody><tr><td>{esc(r["name"])}<br><small>{esc(r["actionId"].split(".")[-1])}</small></td><td>{values(r,True)}</td><td><strong>{values(r)}</strong></td><td>{r["firstImpactTick"]} / {r["durationTicks"]}<br><small>tick</small></td></tr>'
            s+=f'<tr class="rationale"><td colspan="4">{esc(r["rationale"])}</td></tr></tbody>'
        s+='</table></section>'
        sections.append(s)
    return ''.join(sections)

def skeleton_svg():
    # Schematic proportions follow current REST; extra bones are a future rig proposal.
    points={'pelvis':(235,255),'spine':(235,228),'chest':(235,182),'neck':(235,112),'head':(235,77),
            'upperArmL':(300,147),'forearmL':(339,225),'handL':(370,302),
            'upperArmR':(170,147),'forearmR':(131,225),'handR':(100,302),
            'thighL':(268,266),'shinL':(283,380),'footL':(293,489),
            'thighR':(202,266),'shinR':(187,380),'footR':(177,489)}
    edges=[('pelvis','spine'),('spine','chest'),('chest','neck'),('neck','head')]
    for side in ['L','R']:edges += [('chest','upperArm'+side),('upperArm'+side,'forearm'+side),('forearm'+side,'hand'+side),('pelvis','thigh'+side),('thigh'+side,'shin'+side),('shin'+side,'foot'+side)]
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="650" height="540" viewBox="0 0 650 540"><rect width="650" height="540" fill="#f3f6f4"/><line x1="65" y1="510" x2="410" y2="510" stroke="#a0b5a9"/>']
    for a,b in edges:
        p,q=points[a],points[b];svg.append(f'<line x1="{p[0]}" y1="{p[1]}" x2="{q[0]}" y2="{q[1]}" stroke="#236a61" stroke-width="10" stroke-linecap="round"/>')
    for p in points.values():svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="7" fill="#e4f9ef" stroke="#236a61" stroke-width="2"/>')
    additions=[(272,137),(198,137),(319,186),(151,186),(354,263),(116,263),(312,502),(158,502)]
    for x,y in additions:svg.append(f'<circle cx="{x}" cy="{y}" r="7" fill="#e2a84a" stroke="#875d25" stroke-width="2"/>')
    labels=[(430,80,'既存: 17 関節','#236a61'),(430,114,'追加案: +8 骨','#875d25'),(430,150,'鎖骨 ×2','#43594e'),(430,180,'腕のねじり ×4','#43594e'),(430,210,'つま先 ×2','#43594e'),(430,275,'第1段階: 25 骨','#173f35'),(430,310,'脚のねじりまで: 29','#43594e'),(430,340,'手指まで: 59','#43594e'),(430,370,'布も含める: 最大63','#43594e')]
    for x,y,t,c in labels:svg.append(f'<text x="{x}" y="{y}" font-size="17" fill="{c}" font-family="Noto Sans CJK JP">{t}</text>')
    svg.append('<text x="430" y="450" font-size="13" fill="#596c61" font-family="Noto Sans CJK JP">root・4 socket は別枠</text><text x="430" y="474" font-size="13" fill="#596c61" font-family="Noto Sans CJK JP">図は配置の説明図</text></svg>')
    return ''.join(svg)

def timeline_svg():
    s=['<svg xmlns="http://www.w3.org/2000/svg" width="680" height="162" viewBox="0 0 680 162">']
    for a,b,col,label in [(0,22,'#d6a551','準備'),(22,30,'#c86250','判定'),(30,72,'#719c88','後隙')]:
        x=30+a*8;w=(b-a)*8
        s.append(f'<rect x="{x}" y="36" width="{w}" height="42" fill="{col}"/><text x="{x+w/2}" y="62" text-anchor="middle" font-size="16" fill="white" font-family="Noto Sans CJK JP">{label}</text>')
    for t in [0,18,22,30,58,72]:
        x=30+t*8;s.append(f'<line x1="{x}" y1="80" x2="{x}" y2="87" stroke="#274d40"/><text x="{x}" y="106" text-anchor="middle" font-size="12" font-family="Noto Sans CJK JP">{t}</text>')
    s.append('<text x="30" y="24" font-size="15" font-family="Noto Sans CJK JP">断岳剣・縦斬りの基本72 tick（1 tick = 1/60秒）</text><text x="30" y="134" font-size="13" font-family="Noto Sans CJK JP">18 tick で溜め保持 / 58 tick から回避可能</text><text x="30" y="155" font-size="13" font-family="Noto Sans CJK JP">最大溜め命中: 72 + 保持90 + ヒットストップ10 = 172 tick</text></svg>')
    return ''.join(s)

def main():
    data=json.loads((HERE/'analysis/balance-motion-values.json').read_text())
    validation=json.loads((HERE/'qa/validation-summary.json').read_text()) if (HERE/'qa/validation-summary.json').exists() else {}
    css='''
    @page {size:A4; margin:17mm 16mm 18mm; @bottom-left {content:"KARI / HUNTER MOTION & COMBAT"; font:8pt "Noto Sans CJK JP";color:#66796e} @bottom-right {content:counter(page);font:9pt "Noto Sans CJK JP";color:#345646} }
    @page:first { @bottom-left {content:""} @bottom-right {content:""} }
    body{font-family:"Noto Sans CJK JP",sans-serif;font-size:9.7pt;line-height:1.65;color:#20372c;margin:0}
    p{margin:0 0 3.1mm} h1{font-size:22pt;color:#174c3f;margin:10mm 0 4mm;line-height:1.4;break-after:avoid}
    h2{font-size:15pt;border-bottom:1.5px solid #aec4b7;padding-bottom:2mm;margin:7mm 0 3mm;break-after:avoid} h3{font-size:11.7pt;margin:5mm 0 2mm;color:#245c4a;break-after:avoid}
    h4{font-size:10pt;margin:4mm 0 2mm;break-after:avoid} li{margin-bottom:1.4mm} ul,ol{padding-left:6mm;margin-top:2mm}
    table{width:100%;border-collapse:collapse;font-size:8.2pt;line-height:1.5;margin:3mm 0 5mm;table-layout:fixed}
    thead{display:table-header-group} th{background:#e8f0eb;color:#214d3b;text-align:left;border-bottom:1px solid #739c87;padding:2.1mm} td{border-bottom:1px solid #d5e1d9;padding:2mm;vertical-align:top;overflow-wrap:anywhere}
    tr{break-inside:avoid} a{color:#2b6a60;text-decoration:none;overflow-wrap:anywhere} code{font-family:"Noto Sans Mono CJK JP",monospace;font-size:8pt;background:#eff3f0;overflow-wrap:anywhere}
    pre{white-space:pre-wrap;font-size:8pt;background:#f1f5f2;padding:3mm} img{max-width:100%;height:auto} figure{margin:4mm 0;break-inside:avoid} figcaption{font-size:8pt;color:#5c7165;line-height:1.5;margin-top:2mm}
    .cover{height:244mm;box-sizing:border-box;padding-top:20mm;page-break-after:always}.eyebrow{font-size:11pt;letter-spacing:2px;color:#7e956d}.cover h1{font-size:31pt;line-height:1.45;margin:16mm 0 9mm}.subtitle{font-size:15pt;color:#476652;line-height:1.8}.stamp{margin-top:13mm;padding:5mm;border-left:4px solid #cd9e56;background:#f4f5ed;font-size:10pt}.metric{display:inline-block;width:30%;padding-top:8mm;font-size:25pt;color:#17634d}.metric small{display:block;font-size:9pt;color:#566c60}.cover-note{margin-top:15mm;font-size:9pt}.chapter{break-before:page}.callout{padding:4mm;background:#edf4ed;border-left:3px solid #6b957b;margin:4mm 0}.warning{padding:4mm;background:#fbf3e7;border-left:3px solid #d4a264}
    .moves small{font-size:7.4pt;color:#68796e}.moves strong{color:#17634d}.moves tbody{break-inside:avoid}.rationale td{font-size:7.7pt;color:#597163;padding-top:0;background:#fafcf9}.compact{font-size:8.5pt}.family h3{margin-top:7mm}.status td:first-child{width:24%}.sources{font-size:8pt} svg{max-width:100%;height:auto}
    .toc{break-after:page;padding-top:15mm}.toc ul{list-style:none;padding:0;margin-top:12mm}.toc li{border-bottom:1px solid #d5e1d9;padding:4mm 0;font-size:12pt}.toc a{color:#214d3b;display:block}.toc a::after{content:target-counter(attr(href),page);float:right}.toc .callout{margin-top:15mm;font-size:10pt}
    '''
    cover=f'''<div class="cover"><div class="eyebrow">VEILBOUND HUNTERS / DESIGN & IMPLEMENTATION</div><h1>ハンターモーション<br>骨格・モデル・攻撃力設計</h1><p class="subtitle">足で支え、腰から動かし、<br>狙って当てた一撃に報いる。</p><div class="metric">7<small>武器系統</small></div><div class="metric">33<small>攻撃モーション</small></div><div class="metric">17 → 25<small>現行関節 → 第1拡張案</small></div><div class="stamp">差し替えコード・攻撃力データ・実コード比較試験を同梱<br>本番未反映 / 正式GLBは設計段階 / 実機の操作感は未確認</div><div class="cover-note">2026年11月25日（日本時間）<br>確認基点: Kari v0.20.0 / 1d8e084d0d16fe77c376570f9542dd3c54fb5332<br>対象: kamamon/Kari<br>数値は本作向けの初期調整案。既存作品のモーション値は転用していない。</div></div>'''
    intro='<section id="overview">'+render_md('REPORT_INTRO.md')+'</section>'
    toc='<nav class="toc"><h1>目次</h1><ul>'+''.join(f'<li><a href="#{anchor}">{label}</a></li>' for anchor,label in [('overview','今回の設計と差し替え内容'),('comparison','骨格と実装の比較図'),('rig-design','骨格・モデル・7武器の動作設計'),('balance','攻撃力と難易度の設計'),('all-values','全33モーションの新旧MV'),('runtime-report','実コードによる攻撃時間・火力比較'),('handoff','差し替え・検証・Claudeへの引き継ぎ')])+'</ul><div class="callout">最終統合検証: 442テスト・型検査・ビルド成功。<br>公開反映と実機の見た目・操作感の確認は、この提出には含まない。</div><p>本文中の「現行」は確認基点のソース、「提案」は今回用意した差し替え値・制作方針を指す。数値試験、形状図、実戦の仮説を区別して読む。</p></nav>'
    figures=''
    for f,caption in [('seven-weapons.png','現行の7武器。ソースから骨の行列とスキニングを計算して描いた形状図。テクスチャ・WebGL・実機の映像確認ではない。'),('heavy-comparison.png','断岳剣・横薙ぎの同じ時刻の比較。既存の武器軌道を保持し、骨盤の回転・沈み込み・踏み替えへ分散する。'),('gait-comparison.png','異なる4時刻の歩行サンプル。現行の検査用solveStateは同じ位相を繰り返していたため、時間から位相を求めるよう修正した。')]:
        if (HERE/'figures'/f).exists():figures+=f'<figure><img src="figures/{f}"><figcaption>{caption}</figcaption></figure>'
    body=cover+toc+intro+'<section class="chapter" id="comparison"><h1>骨格と実装の比較</h1>'+figures+'<h2>骨格の拡張は段階的に</h2>'+skeleton_svg()+'<p>橙色は次のモデル制作で追加する骨の案。今回の差し替え実装は既存の17関節を使う。指・布まで含む完成モデルを納品したという意味ではない。</p></section>'
    body+='<section class="chapter" id="rig-design">'+render_md('analysis/rig-design.md')+'</section>'
    body+='<section class="chapter" id="balance"><h1>攻撃力と難易度</h1>'+render_md('analysis/balance-design.md',True)+'<h2>攻撃時間と高威力の関係</h2>'+timeline_svg()+'<div class="callout">モーション値（MV）100 = 基礎攻撃力に掛ける係数1.0。MVがそのまま画面に出るダメージになるわけではない。部位・刃・会心・属性・依頼補正を反映し、各ヒットで切り捨てる。</div><h2 id="all-values">全33モーションの置き換え値</h2><p>「+」は別ヒットの合計、「×3」は矢3本がすべて当たった場合。全長は無溜めの基本長で、保持時間・ヒットストップは含めない。発生は実際の判定開始、または矢の発射tick。</p>'+move_tables(data['rows'])+'</section>'
    body+='<section class="chapter" id="runtime-report">'+render_md('analysis/balance-runtime-report.md')+'</section>'
    body+='<section class="chapter" id="handoff"><h1>差し替え・検証・引き継ぎ</h1>'+render_md('README.md',True)+'</section>'
    doc='<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Kari ハンターモーション・攻撃力設計</title><style>'+css+'</style></head><body>'+body+'</body></html>'
    (HERE/'Kari_Hunter_Motion_Combat_Design.html').write_text(doc,encoding='utf-8')
    HTML(string=doc,base_url=str(HERE)).write_pdf(HERE/'Kari_Hunter_Motion_Combat_Design.pdf')
    print(json.dumps({'pdf':str(HERE/'Kari_Hunter_Motion_Combat_Design.pdf'),'moves':len(data['rows'])},ensure_ascii=False))

if __name__=='__main__':main()
