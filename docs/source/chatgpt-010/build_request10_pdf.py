#!/usr/bin/env python3
"""Build a review PDF for Kari request 10. Never edits the source PNGs.

Run from any directory; inputs and output resolve beside this script.
Dependencies: PyMuPDF, Pillow, fontTools; Noto Sans CJK JP regular/bold.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json

import fitz
from PIL import Image
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
W, H, M = 841.89, 595.276, 40
COL = {k: tuple(int(v[i:i+2], 16)/255 for i in (0, 2, 4)) for k, v in {
    'paper': 'F6F3EB', 'ink': '29362F', 'soft': '627068',
    'line': 'D6D7CC', 'bronze': '8F7650', 'dark': '34483C'
}.items()}
DESCRIPTIONS = {
    'R-01': '小石が4〜6個。どれも半分以上が埋まった姿。',
    'R-02': '地面とほぼ同じ高さの平たい上面と、表面のひび。',
    'R-03': '3つの割れた面と、はっきりした角。',
    'R-04': '丸い石の上半分を覆う苔。',
    'R-05': '風化によって角が取れた、低く丸みのある岩。',
    'R-06': '3〜4つの割れた面。新しい割れ面は少し明るい。',
    'R-07': '平らな岩盤。ひびと、水たまりが乾いたしみ。',
    'R-08': '少し傾いた横方向の地層が3〜5本。',
    'R-09': '2つの岩の間に約15cmの割れ目。',
    'R-10': '板状の岩が約30度傾いて突き出る姿。',
    'R-11': '上部の苔と、2〜3株の草。',
    'R-12': '光らない青銅色〜琥珀色の晶脈が1〜2本。',
    'R-13': '地中の大きな岩の頭だけが露出した、どっしりした姿。',
    'R-14': '縦に深い割れ目が1本。向こう側は透けない。',
    'R-15': '高さ2.8mと2.0mの2つの大岩。',
    'R-16': '少し傾いて細長く立つ岩。根元は地中に入る。',
    'R-17': '2段の浅い段差を持つ、低い岩盤の露頭。',
    'R-18': '角ばった大岩と、少し明るい新しい割れ面。',
    'R-19': '後ろ側、平面図の上側に苔が多い大岩。',
    'R-20': '2〜3か所に、光らない晶の塊が突き出る大岩。',
    'C-01': '横の段が4〜6本。段の上に小石。',
    'C-02': '深い地層の段と、暗い段の下側。',
    'C-03': '約15度傾いた地層。',
    'C-04': '2〜3段の低い地層。',
    'C-05': '幅0.6〜1.2mを目安とする縦の柱。',
    'C-06': '欠けた柱と、根元に残る柱の破片。',
    'C-07': '風で丸く削られ、根元が少しえぐれた面。',
    'C-08': '深くえぐれた根元と、ひさし状に張り出す上部。',
    'C-09': '雨筋、黒いしみ、3〜4本の縦の溝。',
    'C-10': '中央に幅約1.5mの深い割れ目。奥は暗く、透かさない。',
    'C-11': '段の上に苔と草。部分的に垂れる苔。',
    'C-12': '土と石の斜面の上に茂る草。',
    'C-13': '斜めに走る、光らない青銅色〜琥珀色の晶脈。',
    'C-14': '3〜4か所に突き出る、光らない晶の塊。',
    'C-15': '欠けた上端と、根元にたまる岩くず。',
    'C-16': '中央の1か所が塔のように高くなる輪郭。',
    'C-17': '2〜3段の棚と、その上の小石や草。',
    'C-18': '約45度の岩の斜面。上の面が見える姿。',
    'C-19': '右へ低くなる出口左側。右端6mを透明にする指定。',
    'C-20': '左へ低くなる出口右側。左端6mを透明にする指定。',
    'T-01': '細かな割れ目・くぼみ・地衣類の点を散らした灰褐色の岩。',
    'T-02': '厚さ5〜20cmを目安とする、重なった細い横筋。',
    'T-03': '暗い岩に細い青銅色の筋が点在する材質。',
    'T-04': '灰褐色の岩のくぼみに、苔がたまる材質。',
}


def fmt(value, digits=2):
    if value is None:
        return '—'
    return f'{value:.{digits}f}'.rstrip('0').rstrip('.')


def pair(values, suffix=''):
    return ' / '.join(fmt(v) for v in values) + suffix


def get_assets(require_complete=True):
    assets = []
    for file, key, group, label in [
        ('rocks_generation.json', 'records', 'rocks', '埋まった岩・三面図'),
        ('cliffs_generation.json', 'records', 'cliffs', '崖・正面図'),
        ('tiles_generation.json', 'tiles', 'tiles', '岩肌・反復用の材質案'),
    ]:
        rows = json.loads((ROOT/file).read_text())[key]
        for row in sorted(rows, key=lambda r: r['id']):
            r = dict(row)
            r.update(group=group, label=label, metadata=file)
            r['filename'] = r.get('filename') or r.get('file')
            r['path'] = ROOT/r['filename']
            if not r['path'].is_file() or not r.get('measurement'):
                if require_complete:
                    raise ValueError(f"Image or measurement missing: {r['id']}")
                continue
            actual_hash = hashlib.sha256(r['path'].read_bytes()).hexdigest()
            expected_hash = r.get('sha256') or r['measurement'].get('sha256')
            if expected_hash and expected_hash != actual_hash:
                raise ValueError(f"Image/measurement SHA mismatch: {r['id']}")
            r['source_sha256'] = actual_hash
            assets.append(r)
    if require_complete:
        expected = {f'{prefix}-{n:02d}' for prefix, count in [('R',20),('C',20),('T',4)] for n in range(1,count+1)}
        if len(assets) != 44 or {a['id'] for a in assets} != expected:
            raise ValueError(f'Expected all 44 IDs; got {len(assets)}')
    if len({a['path'] for a in assets}) != len(assets):
        raise ValueError('Duplicate image path')
    for n, a in enumerate(assets, 1):
        a.update(number=n, page=n+5)
    return assets


def subset_font(path, corpus):
    font = TTFont(path, fontNumber=0)
    sub = subset.Subsetter(options=subset.Options(retain_gids=True))
    sub.populate(text=corpus)
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


class Book:
    def __init__(self, assets):
        self.assets = assets
        self.doc = fitz.open()
        self.images, self.mapping, self.links = {}, [], []
        corpus = Path(__file__).read_text()+json.dumps(assets, ensure_ascii=False, default=str)+''.join(chr(i) for i in range(32,127))
        self.reg = subset_font('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', corpus)
        self.bold = subset_font('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', corpus)
        self.fonts = {'R': fitz.Font(fontbuffer=self.reg), 'B': fitz.Font(fontbuffer=self.bold)}

    def page(self, section):
        p = self.doc.new_page(width=W, height=H)
        p.draw_rect(p.rect, color=None, fill=COL['paper'])
        p.insert_font(fontname='JP', fontbuffer=self.reg)
        p.insert_font(fontname='JPB', fontbuffer=self.bold)
        self.line(p, M, 561, W-M, 561)
        self.txt(p, 'VEILBOUND HUNTERS / REQUEST 10', M, 572, 7.5, color='soft')
        self.txt(p, section, 345, 572, 7.5, color='soft')
        self.txt(p, f'{p.number+1:02d}', W-M-18, 570, 9, color='bronze')
        return p

    def txt(self, p, text, x, y, size=10.5, bold=False, color='ink'):
        width = self.fonts['B' if bold else 'R'].text_length(text, fontsize=size)
        if x+width > W-M+1:
            raise ValueError(f'Text overflow: {text}')
        p.insert_text((x,y+size), text, fontname='JPB' if bold else 'JP', fontsize=size, color=COL[color])

    def block(self, p, text, x, y, width, size=10, leading=17, bold=False, color='ink', max_h=None):
        font = self.fonts['B' if bold else 'R']
        lines = []
        for para in text.split('\n'):
            line = ''
            for c in para:
                if line and font.text_length(line+c, fontsize=size) > width:
                    if c in '、。，．）】」』！？':
                        lines.append(line[:-1]); line = line[-1]+c
                    else:
                        lines.append(line); line = c
                else:
                    line += c
            lines.append(line)
        if max_h is not None and len(lines)*leading > max_h:
            raise ValueError(f'Text block overflow: {text}')
        for i, line in enumerate(lines):
            self.txt(p, line, x, y+i*leading, size, bold, color)
        return y+len(lines)*leading

    def line(self, p, x1, y1, x2, y2, color='line'):
        p.draw_line((x1,y1),(x2,y2), color=COL[color], width=.6)

    def heading(self, p, kicker, title):
        self.txt(p, kicker, M, 36, 8.5, color='bronze')
        self.txt(p, title, M, 58, 24, bold=True)
        self.line(p, M, 105, W-M, 105)

    def image(self, p, path, rect):
        path = Path(path)
        if path not in self.images:
            with Image.open(path) as im:
                im.load()
                original_size = im.size
                if im.mode == 'RGBA' or 'transparency' in im.info:
                    rgba = im.convert('RGBA')
                    rgb = Image.new('RGB', im.size, (246,243,235))
                    rgb.paste(rgba, mask=rgba.getchannel('A'))
                else:
                    rgb = im.convert('RGB')
                rgb.thumbnail((2048,2048), Image.Resampling.LANCZOS)
                data = io.BytesIO()
                rgb.save(data, format='JPEG', quality=88, optimize=True, subsampling=0)
            self.images[path] = {'bytes':data.getvalue(), 'original_size':original_size, 'xref':None,
                                 'jpeg_sha256':hashlib.sha256(data.getvalue()).hexdigest()}
        ent = self.images[path]
        ent['xref'] = p.insert_image(rect, stream=ent['bytes'], xref=ent['xref'] or 0, keep_proportion=True)
        return ent['xref']


def make_cover(b):
    p = b.page('岩と崖の設定資料 / 2026.11.25')
    b.txt(p, 'ORIGINAL GAME / ENVIRONMENT PRODUCTION STUDIES', M, 36, 8.7, color='bronze')
    b.txt(p, '霧境の狩人', M, 65, 29, bold=True)
    b.txt(p, 'VEILBOUND HUNTERS', M, 108, 13.5, bold=True)
    b.txt(p, '岩と崖の設定資料', 455, 65, 24, bold=True)
    b.txt(p, '正式依頼10 / 44点の原画', 455, 107, 12, color='soft')
    hero = next(a for a in b.assets if a['id']=='C-01')
    b.image(p, hero['path'], fitz.Rect(M,151,W-M,438))
    b.line(p,M,453,W-M,453,'bronze')
    for x, count, label in [(M,'20','埋まった岩・三面図'),(300,'20','崖・正面図'),(560,'4','岩肌・材質案')]:
        b.txt(p,count,x,468,26,bold=True)
        b.txt(p,label,x+50,481,11,color='soft')
    b.txt(p,'生成原画と測定結果を収録。採用・輪郭調整・3D地形化は、引き継ぎ後に確認します。',M,531,10,color='soft')


def make_guide(b):
    p=b.page('読み方と測定'); b.heading(p,'READING GUIDE','図を見る前に')
    cols = [
        ('R  岩の三面図','左から正面・右側面・真上の図です。\n根元が地中へ入る輪郭を目指しています。\n\n設計上は1マスが、S＝2m、M＝4m、L＝8m。3つの図を同じ縮尺で読む指定です。'),
        ('C  崖の正面図','歩ける側から見る、幅24mの崖です。\n同じ端高の図を自然な外周へつなぎます。\n\nC-19・C-20は出口の左右。片側6mを空ける指定です。任意の奥行き図20枚は未制作です。'),
        ('T  岩肌の材質案','1枚を3mとして、細かな模様を反復して重ねるための色図です。\n\n4枚とも反復境界の修正が必要です。生成した原本を保持し、継ぎ目の合格とは扱っていません。'),
    ]
    for i,(title,body) in enumerate(cols):
        x=M+i*260
        b.txt(p,title,x,137,14,bold=True)
        b.block(p,body,x,171,232,size=10.4,leading=19,max_h=194)
    b.line(p,M,388,W-M,388)
    b.txt(p,'設計指定と画像からの測定を分けています',M,411,13,bold=True)
    b.block(p,'各個別ページの「設計指定」は依頼文の値、「原本・測定」は生成PNGを測った値です。岩と崖は alpha ≥ 128 を本体として輪郭を測り、薄い透明画素は別途記録しています。岩の地面位置は512px基準へ換算した値です。PDFの表示寸法からは測らないでください。',M,443,W-2*M,size=10.5,leading=18,max_h=76)
    b.txt(p,'数値の詳細：各 *_generation.json、patterns.json、validation.json、README.md',M,531,9,color='soft')


def make_index(b, group, title, description):
    assets=[a for a in b.assets if a['group']==group]
    p=b.page('収録一覧'); b.heading(p,'CONTENTS / CLICK TO OPEN',title)
    b.txt(p,description,M,122,10,color='soft')
    for i,a in enumerate(assets):
        col=i//10; row=i%10
        x=M+col*394; y=158+row*37
        b.txt(p,a['id'],x,y,9.5,color='bronze')
        b.txt(p,a['name'],x+44,y,12,bold=True)
        b.txt(p,str(a['page']),x+352,y,10.5,color='bronze')
        b.txt(p,a['filename'],x+44,y+18,7.1,color='soft')
        b.line(p,x,y+32,x+367,y+32)
        b.links.append((p.number,fitz.Rect(x,y-2,x+367,y+33),a['page']-1))
    if group=='tiles':
        b.txt(p,'反復のために残る作業',434,162,14,bold=True)
        b.block(p,'原本は1254×1254pxです。依頼の1024×1024pxへ整える工程と、上下左右の境界をつなぐ工程が残ります。\n\n明るさのばらつきは記録済みです。境界が一致し、繰り返しが目立たないかは、実装用の修正後に再確認してください。',434,201,363,size=11,leading=20,max_h=230)


def info_title(b,p,text,x,y):
    b.txt(p,text,x,y,9.1,bold=True,color='bronze')


def rock_info(b,p,a):
    m=a['measurement']; d=m['measured_dimensions_m_for_patterns']
    info_title(b,p,'設計指定',M,426)
    b.txt(p,f"{a['size']}  幅 {fmt(a['width'])} × 奥行 {fmt(a['depth'])} × 高さ {fmt(a['height'])} m",M,445,10.1)
    b.txt(p,f"原本 {m['image_px'][0]} × {m['image_px'][1]} px / 指定 1536 × 512 px",M,464,9.7)
    b.txt(p,f"画像測定：幅 {fmt(d['width'])} × 奥行 {fmt(d['depth'])} × 高さ {fmt(d['height'])} m",M,483,9.7)
    info_title(b,p,'三面と接地の測定',434,426)
    diffs=m['view_dimension_differences_percent']
    mx=max(diffs.values())
    b.txt(p,f"三面の寸法差：最大 {fmt(mx,1)}% / 許容8%"+('以内' if mx<=8 else '超過'),434,445,9.8)
    ground=max(m[k]['ground_line_deviation_normalized_px'] for k in ['front','side'])
    b.txt(p,f"地面線384pxから下へ最大 {fmt(ground,1)}px / 土の許容8px",434,464,9.5)
    b.txt(p,f"本体の明るさ標準偏差 {fmt(m['brightness_std_all_subject'],1)} / 目標20〜35",434,483,9.7)
    b.txt(p,'原寸・輪郭・接地の補正は未実施。三面の模様対応と3D化は別途確認。',M,531,9,color='soft')


def cliff_info(b,p,a):
    m=a['measurement'];t=a['target']
    info_title(b,p,'設計指定',M,426)
    b.txt(p,f"幅24m / 中央高さ {pair(t['heightM'],'m')} / 端高 左・右 {pair(t['edgesM'],'m')}",M,445,9.7)
    b.txt(p,f"原本 {m['dimensions'][0]} × {m['dimensions'][1]} px / 指定 2048 × 768 px",M,464,9.7)
    b.txt(p,f"中央の輪郭測定：{pair(m['centralCrestHeightRangeM'],'m')}（最小 / 最大）",M,483,9.7)
    info_title(b,p,'端と接地の測定',434,426)
    b.txt(p,f"端高 左・右 {pair(m['edgeHeightsM'],'m')} / 許容誤差 ±0.3m",434,445,9.7)
    b.txt(p,f"本体下端 y{m['bodyBottomY']} / 指定の土かぶり上限 y720",434,464,9.7)
    b.txt(p,f"本体の明るさ標準偏差 {fmt(m['rockLuminanceStdRec709'],1)} / 目標20〜35",434,483,9.7)
    note='薄いalphaの残留あり。端の連結・奥行き・3D地形化・実機表示は未検証。'
    if not m.get('bodyBottomWithinSoilAllowance',False):
        note='接地下端が許容範囲を超過。輪郭調整とalpha清掃が必要。連結・3D化は未検証。'
    if a['id'] in ['C-19','C-20']:
        e=m.get('exitStrip') or {}
        opaque=e.get('alphaAtLeast128Pixels')
        residual=e.get('nonzeroAlphaPixels')
        if opaque is not None and residual is not None:
            note=f'出口側6m：alpha ≥ 128 が{opaque}画素、alpha > 0 が{residual}画素。厳密な透明と接続を要確認。'
        else:
            note='出口側6mの空白は原本で確認が必要。端高・alpha残留の詳細は制作JSONを参照。'
    b.txt(p,note,M,531,9,color='soft')


def tile_info(b,p,a):
    m=a['measurement'];x=468
    info_title(b,p,'設計指定',x,151)
    b.block(p,DESCRIPTIONS[a['id']],x,174,332,size=11,leading=20,max_h=64)
    b.txt(p,'1タイル＝3m / 1024 × 1024 px',x,247,11)
    info_title(b,p,'原本・測定',x,289)
    b.txt(p,f"原本 {m['width_px']} × {m['height_px']} px / {m['mode']}",x,312,10.5)
    b.txt(p,f"明るさ標準偏差 {fmt(m['luminance_std'],1)} / 目標20〜35",x,335,10.5)
    b.txt(p,f"左右の境界差比 {fmt(m['lr_seam_mae_ratio'],2)} / 上下 {fmt(m['tb_seam_mae_ratio'],2)}",x,358,10)
    info_title(b,p,'採用前の作業',x,405)
    b.block(p,'上下左右のつなぎ目が残っています。規定寸法への調整、境界修正、反復表示の再確認が必要です。色図のみで、法線・粗さ・奥行きマップは含みません。',x,429,332,size=10.6,leading=19,max_h=99)


def make_asset(b,a):
    p=b.page(a['label'])
    b.txt(p,f"{a['id']}   /   {a['number']:02d} OF 44",M,36,8.7,color='bronze')
    b.txt(p,a['name'],M,59,24,bold=True)
    b.txt(p,a['filename'],M,98,8.2,color='soft')
    p.draw_rect(fitz.Rect(W-M-132,35,W-M,57),color=None,fill=COL['line'])
    b.txt(p,'制作資料・採用前確認',W-M-120,40,9.2,color='dark')
    b.line(p,M,121,W-M,121)
    if a['group']=='tiles':
        xref=b.image(p,a['path'],fitz.Rect(M,142,428,530))
        tile_info(b,p,a)
    else:
        if a['group']=='rocks':
            for i,label in enumerate(['正面','右側面','真上']):
                b.txt(p,label,M+i*(W-2*M)/3+110,127,8,color='soft')
            imrect=fitz.Rect(M,145,W-M,412)
        else:
            imrect=fitz.Rect(M,131,W-M,417)
        xref=b.image(p,a['path'],imrect)
        b.line(p,M,418,W-M,418)
        rock_info(b,p,a) if a['group']=='rocks' else cliff_info(b,p,a)
    ent=b.images[a['path']]
    b.mapping.append({'id':a['id'],'name':a['name'],'filename':a['filename'],'page':p.number+1,
                      'source_sha256':a['source_sha256'],'source_size':list(ent['original_size']),
                      'image_xref':xref,'embedded_jpeg_sha256':ent['jpeg_sha256']})


def make_sources(b):
    p=b.page('出典と制作記録');b.heading(p,'SOURCES','依頼と制作記録')
    sections=[
        ('正式依頼','docs/chatgpt-request-10.txt / docs/chatgpt-board.md。岩20種、崖20種、岩肌4種の名称・用途・数値指定を参照しています。'),
        ('画風と狩場','art-source/board/style_board_v2.png、docs/chatgpt-ref/field_v019_a.jpg・field_v019_b.jpg。冷たく湿った灰褐色の岩、灰緑の苔、光らない青銅色の晶脈。'),
        ('改善対象の岩肌','art-source/env/tex_rock_basin_v1.png。従来の弱い濃淡を改善するため、割れ目・くぼみ・欠けを描いて局所的な明暗を増やしています。'),
        ('原本と測定','PNGは生成原本のままです。rocks_generation.json、cliffs_generation.json、tiles_generation.json にプロンプト、由来、実測値と限界を記録。patterns.json とREADME.mdへ引き継ぎます。'),
    ]
    y=143
    for title,body in sections:
        b.txt(p,title,M,y,12.3,bold=True)
        y=b.block(p,body,195,y,605,size=10.5,leading=19,max_h=75)+28
    b.line(p,M,472,W-M,472)
    b.block(p,'本冊子の画像は閲覧用に圧縮しています。透明部分を紙色に合成したPDF内の画像から、輪郭・色・透明度を測らないでください。実装には同梱の原寸PNGと制作JSONを使用します。',M,494,W-2*M,size=10.5,leading=18,max_h=54)


def make_limits(b):
    p=b.page('採用前に残る作業');b.heading(p,'HANDOFF / LIMITATIONS','原画から実装へ渡すために')
    blocks=[
        ('岩の三面を整える','原寸は指定と異なります。地面線、三面の寸法、各図の中心、同じ割れ目や苔の対応を確認し、必要な輪郭補正を行います。寸法測定だけで正投影の立体整合は保証できません。'),
        ('崖をつないで確かめる','端高と接地下端の測定は制作JSONに記録しています。縦溝の見た目、自然な連結、曲げた後の凹凸は未検証。任意の20枚の奥行き図は作成していません。'),
        ('透明の輪郭を整える','岩と崖にはalphaがごく薄く残る画素があります。本体の閾値128による測定と、完全透明の保証は別です。原本を保持したまま、実装用の透明処理を確認してください。'),
        ('岩肌の反復を直す','4枚は1254px四方で、指定の1024px四方ではありません。つなぎ目と反復模様が残るため境界修正が必要です。法線や粗さなどのPBR情報は作成していません。'),
        ('採用してから3Dへ','44枚は未採用の制作資料です。3Dモデル、当たり判定、UV、ゲーム内表示、iPhoneでの性能は未確認です。READMEの未達事項を確認してから、正式な置き場へ引き継ぎます。'),
    ]
    y=143
    for title,body in blocks:
        b.txt(p,title,M,y,12,bold=True)
        y=b.block(p,body,195,y,605,size=10.3,leading=18,max_h=61)+23
    rocks=[a['measurement'] for a in b.assets if a['group']=='rocks']
    canvas_bad=sum(not m['canvas_spec_pass'] for m in rocks)
    view_bad=sum(not m['dimension_consistency_pass'] for m in rocks)
    ground_bad=sum(not m['ground_allowance_pass'] for m in rocks)
    note=f'主な数値未達：岩は原寸{canvas_bad}点・三面差{view_bad}点・接地{ground_bad}点。崖はC-12の接地下端、C-16・C-18の高さ、C-20の濃淡。岩肌4点は原寸と反復境界の調整が必要です。'
    b.block(p,note,M,483,W-2*M,size=9.4,leading=16,color='soft',max_h=34)
    b.txt(p,'原画と測定値の確認 → 採用判断 → 輪郭・境界調整 → 3D化と実機確認',M,531,10.3,bold=True,color='bronze')


def verify(output,qa_dir,b):
    qa_dir.mkdir(parents=True,exist_ok=True)
    doc=fitz.open(output)
    checks=[];outside=[]
    for m in b.mapping:
        p=doc[m['page']-1];text=p.get_text()
        if m['name'] not in text or m['filename'] not in text or m['id'] not in text:
            raise ValueError(f"Text mismatch on page {m['page']}")
        images=p.get_images(full=True)
        if len(images)!=1:
            raise ValueError(f"Image count mismatch on page {m['page']}")
        actual=hashlib.sha256(doc.extract_image(images[0][0])['image']).hexdigest()
        if actual!=m['embedded_jpeg_sha256']:
            raise ValueError(f"Embedded image mismatch on page {m['page']}")
        m['pdf_image_xref']=images[0][0]
        checks.append({'id':m['id'],'page':m['page'],'name_filename_id_match':True,'image_matches':True})
    rendered=[]
    for i,p in enumerate(doc):
        p.get_pixmap(matrix=fitz.Matrix(.6,.6),alpha=False).save(qa_dir/f'page_{i+1:02d}.png')
        rendered.append(i+1)
        for block in p.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    box=fitz.Rect(span['bbox'])
                    if box.x0<0 or box.y0<0 or box.x1>W+.5 or box.y1>H+.5:
                        outside.append({'page':i+1,'text':span['text'],'bbox':list(box)})
    if outside:
        raise ValueError(f'Text outside page: {outside}')
    for n in [1,2,3,5,6,15,25,26,37,44,45,46,49,50,51]:
        doc[n-1].get_pixmap(matrix=fitz.Matrix(1.2,1.2),alpha=False).save(qa_dir/f'detail_{n:02d}.png')
    result={'pdf':output.name,'page_count':len(doc),'artworks':len(b.mapping),'bytes':output.stat().st_size,
            'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'all_pages_rendered':rendered,
            'title_filename_image_checks':checks,'outside_page_text':outside,
            'internal_links':sum(sum(l['kind']==fitz.LINK_GOTO for l in p.get_links()) for p in doc),
            'bookmarks':len(doc.get_toc()),'font_method':'Embedded Noto Sans CJK JP regular/bold; retain_gids=True',
            'image_processing':'PDF-only JPEG quality88; transparent pixels composited onto paper; original PNGs unchanged',
            'visual_review':'Pending representative page review','mapping':b.mapping}
    (ROOT/'pdf_validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['pdf','page_count','artworks','bytes','sha256','internal_links','bookmarks']},indent=2))


def build(output,qa_dir):
    assets=get_assets();b=Book(assets)
    make_cover(b);make_guide(b)
    for group,title,description in [
        ('rocks','R / 埋まった岩の20種','1枚に正面・右側面・真上の図。名称の行から個別ページへ移動できます。'),
        ('cliffs','C / 外周につなぐ崖の20種','自然な上端の輪郭と、接続用の端を持つ正面図。'),
        ('tiles','T / 岩肌の4種','細かな濃淡と材質の検討。反復境界の修正は残っています。'),
    ]:
        make_index(b,group,title,description)
    for a in assets:
        make_asset(b,a)
    make_sources(b);make_limits(b)
    for pno,rect,target in b.links:
        b.doc[pno].insert_link({'kind':fitz.LINK_GOTO,'from':rect,'page':target})
    toc=[[1,'霧境の狩人 岩と崖の設定資料',1],[1,'図を見る前に',2],[1,'収録一覧',3],
         [2,'岩20種',3],[2,'崖20種',4],[2,'岩肌4種',5]]
    old=None
    for a in assets:
        if a['label']!=old:
            toc.append([1,a['label'],a['page']]);old=a['label']
        toc.append([2,f"{a['id']} {a['name']}",a['page']])
    toc.extend([[1,'依頼と制作記録',50],[1,'原画から実装へ渡すために',51]])
    b.doc.set_toc(toc)
    b.doc.set_metadata({'title':'霧境の狩人 VEILBOUND HUNTERS 岩と崖の設定資料44点',
                        'author':'ChatGPT','subject':'正式依頼10 / 原画・測定・採用前の確認',
                        'keywords':'VEILBOUND HUNTERS, 岩, 崖, 原画, request 10'})
    b.doc.save(output,garbage=4,deflate=True)
    b.doc.close()
    verify(output,qa_dir,b)


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--output',type=Path,default=ROOT/'VEILBOUND_HUNTERS_rocks_cliffs_44_v1.pdf')
    ap.add_argument('--qa-dir',type=Path,default=ROOT.parent.parent.parent.parent/'pdf_qa_request10')
    args=ap.parse_args()
    build(args.output,args.qa_dir)
