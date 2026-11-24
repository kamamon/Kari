#!/usr/bin/env python3
"""Build the illustrated bestiary from the registry and unchanged concept art.

Run from any directory. Only the specified output directory is written.
Requires PyMuPDF, Pillow and fontTools; Noto CJK fonts are embedded as subsets.
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import io
import json
import math
import re
import subprocess
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PAPER = (595.276, 841.89)
MARGIN = 42.0
CW = PAPER[0] - 2 * MARGIN
COLOR = {
    'paper': '#F6F5F0', 'white': '#FFFFFF', 'ink': '#23342E',
    'muted': '#5F6B63', 'line': '#D3D9CF', 'green': '#415A4B',
    'pale': '#E7EBE2', 'bronze': '#96743F', 'bronze_pale': '#EEE6D8',
}
E = {'none':'無属性','fire':'火','water':'水','thunder':'雷','ice':'氷','wind':'風','mist':'霧'}
STATUS = {'poison':'毒','paralysis':'麻痺','sleep':'睡眠','stun':'気絶'}
RANK = {'rank.1':'初級','rank.2':'中級','rank.3':'上級','rank.4':'極級'}
CLASS = {'large':'大型','huge':'超大型','juvenile':'幼体'}
VARIANT = {'base':'通常種','subspecies':'亜種','rare':'希少種'}
ECOLOGY = [('diet','食性'),('behavior','気質・行動'),('territory','縄張り'),
           ('rhythm','活動周期'),('nest','巣・休息'),('relations','他種との関係'),
           ('juvenile','幼体・成長'),('signs','痕跡')]
PDF_IMAGE_SETTINGS = {'format':'JPEG','maxWidth':1280,'maxHeight':960,
                      'quality':79,'chromaSubsampling':2,'optimize':True}

def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def rgb(value):
    value=COLOR.get(value,value).lstrip('#')
    return tuple(int(value[i:i+2],16)/255 for i in (0,2,4))

def compact(text):
    return re.sub(r'\s+','',str(text))

def jlist(items, mapping=None, empty='なし'):
    if not items: return empty
    return '・'.join(mapping.get(x,x) if mapping else x for x in items)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--data-repo', type=Path, default=REPO)
    ap.add_argument('--output', type=Path, default=HERE)
    ap.add_argument('--temp', type=Path, required=True)
    ap.add_argument('--snapshot-sha', default='e006b3500184e82b321ff8e64797e900113523a0')
    ap.add_argument('--snapshot-version', default='v0.16.0')
    ap.add_argument('--date', default='2026-11-24')
    args=ap.parse_args()
    out=args.output.resolve(); out.mkdir(parents=True,exist_ok=True)
    tmp=args.temp.resolve(); tmp.mkdir(parents=True,exist_ok=True)
    registry_path=args.data_repo/'public/data/bestiary.json'
    registry=json.loads(registry_path.read_text())
    manifest=json.loads((HERE/'art-manifest.json').read_text())
    species=sorted(registry['species'],key=lambda s:s['no'])
    by_id={s['id']:s for s in species}
    arts={s['id']:s for s in manifest['species']}
    frames={f['id']:f for f in registry['frames']}
    assert len(species)==86 and len(by_id)==86 and len(arts)==86
    assert [s['no'] for s in species]==list(range(1,87))
    assert len(registry['fields'])==20
    assert all(len(s['ecology'])==8 for s in species)
    for s in species:
        a=arts[s['id']]
        assert a['name']==s['name'] and a['no']==s['no']
        path=REPO/a['art']
        assert sha256(path)==a['sha256'],path
        with Image.open(path) as im:
            assert im.size==(a['width'],a['height'])
    # Retain glyph IDs for CFF CID fonts: this keeps PDF painting and extraction aligned.
    extra='''霧境の狩人 モンスター図鑑 原画・生態・狩猟資料 全種索引 狩場索引 読み方 原画と基本情報 生態と暮らし
    採用済み設定図 原画案・採用待ち 実装済み 未実装 図鑑登録 実装段階 全長 骨格 初出 種別 系統 属性 弱点 耐性 状態異常 生息地
    見分ける特徴 特徴器官 予備動作と技 注目部位 素材 装備への用途 防具の見た目 成体 群れ候補 同時出現候補 登録簿の補足 出典 検査
    初級 中級 上級 極級 通常種 亜種 希少種 大型 超大型 幼体 なし 無属性 火 水 雷 氷 風 霧 毒 麻痺 睡眠 気絶
    番号 名前 二つ名 ページ 原画 生態 食性 気質・行動 縄張り 活動周期 巣・休息 他種との関係 幼体・成長 痕跡
    登録数 成体 初級 中級 上級 極級 合計 歩ける狩場 地形 雰囲気 登録種 検索語 目次へ 次の種へ 前の種へ
    参考状態 頁 版 候補 資料 画 実 制 作 示 源 猟 全 種 体 冊 構成 凡例 設定 正本 内容 関係 本文 使用 範囲 現在 情報 参照
    小さな新芽から霧の巨躯まで。原画と暮らしを、ひとつの記録へ。
    0000000000 1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#./:_-+%()[]→〜・、。『』「」：／（）
    '''
    prose = [
        '本書は、登録簿にある86種を原画と設定で読む制作図鑑です。原画・属性・弱点・生態の案と、ゲーム内の実装状況を区別して記載しています。',
        '現在遊べるモンスターはガルドロス1種です。他の85種は未実装で、原画の採用も未確定です。原画があることは、3Dモデル・技・当たり判定の完成を意味しません。',
        'ガルドロスは採用済み設定図を使用。既存12種と新規73種は採用待ちの原画案です。本書のために原画を描き直したり、正式な採用状態を変えたりしていません。',
        '各種の前半ページに原画・基本情報・特徴器官・行動予告と技を、後半ページに生態8項目・素材・装備の意匠をまとめました。全種索引の行から各種ページへ移動できます。',
        '全長・属性・弱点・耐性は登録簿の値です。ガルドロスの確定事項を除き、多くは候補です。ゲームでの数値性能や攻略の確定情報ではありません。',
        '技は「予備動作→技」の順に記載しています。実装済みガルドロスについても、図鑑の代表技を掲載しており、全23技の仕様書ではありません。',
        '狩場20件は設定案を含みます。歩ける狩場は風礫盆地1件です。狩場の登録種一覧も、実際の出現が実装済みという意味ではありません。',
        '恒久IDは元データのままです。名称からIDを推測せず、原画の対応はart-manifest.jsonを参照してください。',
        '本書はv0.16.0時点のスナップショットです。登録簿や採用状態が変わった場合は、出典の版を確認して更新してください。',
        '下記の7骨格は制作上の分類です。四足重獣を除く6骨格は、現行の登録簿では未作成です。',
        '掲載項目を登録簿と照合し、日本語フォントを埋め込んでいます。画像は原本からPDF用に圧縮して内蔵し、外部リンクなしで閲覧できます。',
        '図鑑の内容と原画の採用判断は別です。受領・採用・原画登録・ゲーム実装を分けて管理してください。',
        '体格の値は全長です。身長や原画のピクセル幅とは異なります。左右非対称の器官は生物自身の左右を基準にし、制作時に四方向図で固定してください。',
        'このPDFは閲覧用の編集資料です。3Dモデル、動作、当たり判定、実機性能は今回の作成対象ではありません。',
    ]
    text_pool=json.dumps(registry,ensure_ascii=False)+json.dumps(manifest,ensure_ascii=False)+extra+''.join(prose)
    # Include the script source so labels and explanatory text added here are covered.
    text_pool += Path(__file__).read_text()
    font_paths={}
    for key,file in [('regular','NotoSansCJK-Regular.ttc'),('bold','NotoSansCJK-Bold.ttc'),('serif','NotoSerifCJK-Regular.ttc')]:
        face=TTFont('/usr/share/fonts/opentype/noto/'+file,fontNumber=0)
        options=subset.Options(retain_gids=True)
        sub=subset.Subsetter(options=options); sub.populate(text=text_pool); sub.subset(face)
        dest=tmp/(key+'.otf'); face.save(dest); font_paths[key]=dest
    doc=fitz.open()
    font_objs={k:fitz.Font(fontfile=str(v)) for k,v in font_paths.items()}
    fonts={'regular':'FReg','bold':'FBold','serif':'FSerif'}
    placements=[]; images={}; page_roles=[]; link_jobs=[]
    pp={} # species id -> 0-based first page

    def text(page,txt,x,y,size=11,font='regular',color='ink',width=None,leading=None,align='left',role='body'):
        txt=str(txt)
        leading=leading or size*1.47
        width=CW if width is None else width
        lines=[]
        for paragraph in txt.split('\n'):
            if not paragraph: lines.append(''); continue
            line=''
            for ch in re.findall(r'[A-Za-z0-9][A-Za-z0-9._:/-]*|.',paragraph):
                candidate=line+ch
                if font_objs[font].text_length(candidate,fontsize=size)>width and line:
                    # Avoid beginning a line with Japanese closing punctuation.
                    if ch in '、。，．！？：；）］｝」』】〉》ー〜':
                        # Pull the preceding character onto the next line together
                        # with the closing mark, rather than overrunning the box.
                        tail=line[-1]; lines.append(line[:-1]); line=tail+ch
                    else:
                        if line[-1:] in '（［｛「『【〈《':
                            last=line[-1];line=line[:-1];lines.append(line);line=last+ch
                        else: lines.append(line);line=ch
                else: line=candidate
            if line: lines.append(line)
        for i,line in enumerate(lines):
            length=font_objs[font].text_length(line,fontsize=size)
            assert length <= width + size*1.02,(txt,width,length)
            xx=x+(width-length)/2 if align=='center' else x+width-length if align=='right' else x
            page.insert_text((xx,y+size+i*leading),line,fontname=fonts[font],fontsize=size,color=rgb(color))
            placements.append({'page':page.number+1,'text':line,'role':role,'fontSize':size,'rect':[xx,y+i*leading,xx+length,y+i*leading+leading]})
        return y+len(lines)*leading

    def rect(page,r,fill='pale',stroke=None,radius=0):
        page.draw_rect(fitz.Rect(r),color=rgb(stroke) if stroke else None,fill=rgb(fill),width=.6,overlay=True)

    def line(page,x0,y0,x1,y1,color='line',width=.6):
        page.draw_line((x0,y0),(x1,y1),color=rgb(color),width=width)

    def new_page(role):
        p=doc.new_page(width=PAPER[0],height=PAPER[1]);page_roles.append(role)
        for k,v in font_paths.items():p.insert_font(fontname=fonts[k],fontfile=str(v))
        rect(p,(0,0,PAPER[0],PAPER[1]),'paper')
        return p

    def footer(p,label='VEILBOUND HUNTERS',toc=True):
        y=806
        line(p,MARGIN,y-7,PAPER[0]-MARGIN,y-7)
        text(p,label,MARGIN,y,8.3,color='muted',width=CW-50,role='footer')
        text(p,f'{p.number+1:03d}',PAPER[0]-MARGIN-35,y,9,font='bold',width=35,align='right',role='footer')
        if toc:
            text(p,'全種索引へ',PAPER[0]-MARGIN-130,24,9,color='muted',width=130,align='right',role='nav')
            link_jobs.append((p.number,fitz.Rect(PAPER[0]-MARGIN-90,21,PAPER[0]-MARGIN,40),2))

    def heading(p,kicker,title,sub=None):
        rect(p,(MARGIN,43,MARGIN+27,46),'bronze')
        text(p,kicker,MARGIN+39,35,9,font='bold',color='muted',role='kicker')
        text(p,title,MARGIN,59,26,font='serif')
        if sub:text(p,sub,MARGIN,99,11,color='muted')

    def picture(p,sid,r):
        if sid not in images:
            a=arts[sid]
            with Image.open(REPO/a['art']) as im:
                im=im.convert('RGB')
                im.thumbnail((PDF_IMAGE_SETTINGS['maxWidth'],PDF_IMAGE_SETTINGS['maxHeight']),Image.Resampling.LANCZOS)
                b=io.BytesIO();im.save(b,format=PDF_IMAGE_SETTINGS['format'],quality=PDF_IMAGE_SETTINGS['quality'],
                                     optimize=PDF_IMAGE_SETTINGS['optimize'],subsampling=PDF_IMAGE_SETTINGS['chromaSubsampling'])
            xr=p.insert_image(fitz.Rect(r),stream=b.getvalue(),keep_proportion=True)
            images[sid]=xr
        else:p.insert_image(fitz.Rect(r),xref=images[sid],keep_proportion=True)

    # 1: cover.
    p=new_page('cover')
    rect(p,(0,0,16,PAPER[1]),'green')
    text(p,'VEILBOUND HUNTERS',48,55,12,font='bold',color='bronze')
    text(p,'霧境の狩人',48,94,29,font='serif')
    text(p,'モンスター図鑑',47,140,36,font='bold')
    text(p,'原画・生態・狩猟資料',49,199,14,color='muted')
    picture(p,'monster.galdros',(42,249,553,568))
    line(p,48,602,548,602,'bronze',1)
    text(p,'86',47,621,64,font='serif',color='green',width=110)
    text(p,'種の原画と設定',168,647,21,font='serif')
    text(p,'成体78種 ＋ 幼体8種 / 狩場20案',169,681,11,color='muted')
    text(p,'小さな新芽から霧の巨躯まで。\n原画と暮らしを、ひとつの記録へ。',49,728,12,leading=19)
    footer(p,args.snapshot_version+' / '+args.date+' / 図鑑第2版',False)

    # 2: guide and state, deliberately separating concept from implementation.
    p=new_page('guide');heading(p,'HOW TO READ','この図鑑の読み方')
    y=text(p,prose[0],MARGIN,112,11.5,leading=18)
    y+=17
    rect(p,(MARGIN,y,PAPER[0]-MARGIN,y+105),'green')
    text(p,'実装済みは、ガルドロス1種。',MARGIN+16,y+13,17,font='bold',color='white',width=CW-32)
    text(p,prose[1],MARGIN+16,y+45,11,color='white',width=CW-32,leading=17)
    y+=128
    for title,body in [('原画と採用',prose[2]),('各種2ページの構成',prose[3]),('設定値と技の読み方',prose[4]+' '+prose[5]),('狩場と制作状態',prose[6]),('更新の基準',prose[8])]:
        text(p,title,MARGIN,y,12,font='bold',color='green');y+=22
        y=text(p,body,MARGIN,y,11,leading=17)+17
    assert y<797,('guide',y)
    footer(p,args.snapshot_version+' / 原画の採用とゲーム実装を区別')

    # 3-5: clickable catalog index.
    index_pages=[]
    widths=[34,117,66,52,70,112,CW-451]
    labels=['番号','名前','二つ名','初出','属性','生息地','頁']
    for chunk in range(3):
        p=new_page('species-index');index_pages.append(p.number)
        heading(p,'CATALOG INDEX',f'全種索引 {chunk+1}/3','行を選ぶと、その種の原画ページへ移動します。')
        y=134
        rect(p,(MARGIN,y,PAPER[0]-MARGIN,y+26),'green')
        x=MARGIN
        for lab,w in zip(labels,widths):
            text(p,lab,x+4,y+6,10.5,font='bold',color='white',width=w-8,align='right' if lab=='頁' else 'left')
            x+=w
        y+=26
        for s in species[chunk*30:(chunk+1)*30]:
            rect(p,(MARGIN,y,PAPER[0]-MARGIN,y+20.4),'white' if s['no']%2 else 'pale')
            values=[f"{s['no']:02d}",s['name'],s['title'],RANK[s['rank']],jlist(s['elements'],E),s['habitat'],'']
            x=MARGIN
            for val,w in zip(values,widths):text(p,val,x+4,y+4,10.5,width=w-8);x+=w
            # Fill page number after all section pages have been created.
            link_jobs.append((p.number,fitz.Rect(MARGIN,y,PAPER[0]-MARGIN,y+20.4),s['id']))
            pp.setdefault('index_rows',[]).append((p.number,s['id'],y+4))
            y+=20.4
        footer(p,'全86種 / 成体78種・幼体8種')

    # 6-9: habitat index.
    for group in range(4):
        p=new_page('habitat-index');heading(p,'HABITAT INDEX',f'狩場索引 {group+1}/4','20件中、現在歩けるのは風礫盆地のみです。')
        y=135
        for f in registry['fields'][group*5:(group+1)*5]:
            row_top=y
            text(p,f['name'],MARGIN,y,15,font='bold',color='green',width=200)
            label='歩ける狩場' if f.get('fieldId') else '狩場案・未実装'
            text(p,label,MARGIN+250,y+3,10.5,color='muted',width=CW-250,align='right')
            y+=26
            y=text(p,f['terrain'],MARGIN,y,10.5,leading=15.4)
            if f.get('mood'):y=text(p,f['mood'],MARGIN,y+3,10.5,color='muted',leading=15.4)
            residents=[s for s in species if s['habitat']==f['name']]
            tokens=' / '.join(f"{s['no']:02d} {s['name']}" for s in residents)
            y=text(p,'登録種：'+tokens,MARGIN,y+6,10.5,leading=15.4)
            assert y<=row_top+125,(f['name'],y-row_top)
            y=row_top+128
            line(p,MARGIN,y-10,PAPER[0]-MARGIN,y-10)
        footer(p,'狩場の設定案 / 登録種は出現実装を示しません')

    # 10: frames and populations.
    p=new_page('frames');heading(p,'DESIGN FRAMEWORK','骨格と登場段階')
    y=text(p,prose[9],MARGIN,112,11,leading=17)+22
    for frame in registry['frames']:
        text(p,frame['name'],MARGIN,y,12,font='bold',color='green',width=130)
        note=frame['note']
        yy=text(p,note,MARGIN+135,y,10.5,leading=16,width=CW-135)
        y=max(yy,y+22)+14
        line(p,MARGIN,y-7,PAPER[0]-MARGIN,y-7)
    y+=13
    text(p,'初めて登場する成体の数',MARGIN,y,14,font='serif');y+=31
    counts=[('初級',13),('中級',20),('上級',25),('極級',20)]
    cell=CW/4
    for i,(title,n) in enumerate(counts):
        x=MARGIN+cell*i
        rect(p,(x,y,x+cell-7,y+92),'pale')
        text(p,title,x+12,y+11,12,font='bold')
        text(p,str(n),x+12,y+35,30,font='serif')
    y+=108
    text(p,'別枠の幼体は8種。成体78種と合わせて86種です。\n亜種13種・希少種13種・超大型10種を含みます。',MARGIN,y,11,leading=18)
    assert y+40<797,('frames',y)
    footer(p,'登録簿の骨格7分類 / 成体の登場計画')

    # 11 onward: two pages per species.
    for s in species:
        no=s['no'];sid=s['id'];pp[sid]=len(doc)
        artstate='採用済み設定図' if arts[sid]['artState']=='approved-reference' else '原画案・採用待ち'
        impl='実装済み' if s['state']=='implemented' else '未実装'
        p=new_page(f'species:{no}:art')
        text(p,f"{no:02d} / {s['title']}",MARGIN,37,11,font='bold',color='bronze')
        text(p,s['name'],MARGIN,58,28,font='serif')
        tagline=f"{RANK[s['rank']]} / {CLASS[s['class']]} / {VARIANT[s['variant']]}"
        text(p,tagline,MARGIN,100,10.5,color='muted')
        picture(p,sid,(MARGIN,123,PAPER[0]-MARGIN,362))
        text(p,artstate+' / '+impl,MARGIN,367,10.5,color='muted',align='right')
        # Compact key facts, all taken from the source registry.
        y=393
        pairs=[('全長',f"{s['size']:g} m"),('骨格',frames[s['frame']]['name']),('生息地',s['habitat']),
               ('属性',jlist(s['elements'],E)),('弱点',jlist(s['weak'],E)),('耐性',jlist(s['resist'],E))]
        col=CW/3
        for i,(label,value) in enumerate(pairs):
            x=MARGIN+(i%3)*col; yy=y+(i//3)*39
            rect(p,(x,yy,x+col-7,yy+34),'pale')
            text(p,label,x+8,yy+3,10.5,color='muted',role='label')
            text(p,value,x+8,yy+18,11,font='bold',width=col-16)
        y+=84
        text(p,'状態異常：'+jlist(s['statuses'],STATUS),MARGIN,y,10.5);y+=22
        text(p,'見分ける特徴',MARGIN,y,11,font='bold',color='green');
        y=text(p,s['look'],MARGIN+89,y,10.5,width=CW-89,leading=15.8)+8
        text(p,'特徴器官',MARGIN,y,11,font='bold',color='green')
        y=text(p,s['organ'],MARGIN+89,y,10.5,width=CW-89,leading=15.8)+12
        text(p,'予備動作と技',MARGIN,y,11,font='bold',color='green');y+=22
        # Two columns keep the eight-move entries airy without shrinking their text.
        left=s['moves'][:math.ceil(len(s['moves'])/2)]
        right=s['moves'][math.ceil(len(s['moves'])/2):]
        bottoms=[]
        for ci,ls in enumerate((left,right)):
            yy=y;x=MARGIN+ci*(CW/2+5)
            for k,m in enumerate(ls):
                yy=text(p,m,x+8,yy,10.5,width=CW/2-18,leading=15.7)+5
                rect(p,(x,yy-17,x+3,yy-14),'bronze')
            bottoms.append(yy)
        y=max(bottoms)+7
        text(p,'注目部位',MARGIN,y,11,font='bold',color='green')
        y=text(p,jlist(s['parts']),MARGIN+89,y,10.5,width=CW-89,leading=15.8)
        assert y<791,(no,'art-page overflow',y)
        footer(p,f"{no:02d} 原画と基本情報 / {sid}")

        p=new_page(f'species:{no}:ecology')
        text(p,f"{no:02d} / {s['title']}",MARGIN,37,11,font='bold',color='bronze')
        text(p,s['name']+'の生態',MARGIN,59,25,font='serif')
        text(p,'ECOLOGY / 8つの観察記録',MARGIN,98,10.5,color='muted')
        y=132
        for ki,(key,label) in enumerate(ECOLOGY):
            text(p,f'{ki+1:02d}',MARGIN,y,10.5,font='bold',color='bronze',width=22)
            text(p,label,MARGIN+27,y,11,font='bold',color='green',width=92)
            bottom=text(p,s['ecology'][key],MARGIN+124,y,11,width=CW-124,leading=17)
            y=max(bottom,y+20)+11
            if ki<7:line(p,MARGIN+124,y-5,PAPER[0]-MARGIN,y-5)
        y+=8
        line(p,MARGIN,y-6,PAPER[0]-MARGIN,y-6,'bronze')
        for label,value in [('素材',jlist(s['materials'])),('装備への用途',s['gear']),('防具の見た目',s['armorLook'])]:
            text(p,label,MARGIN,y,11,font='bold',color='green',width=95)
            y=text(p,value,MARGIN+105,y,10.5,width=CW-105,leading=15.8)+9
        relatives=[]
        if s.get('baseId'):
            b=by_id[s['baseId']]
            relatives.append(('成体' if s['class']=='juvenile' else '基となる種')+'：'+f"{b['no']:02d} {b['name']}")
        if s.get('pack'):relatives.append('群れ候補：'+'〜'.join(map(str,s['pack']))+'頭')
        if s.get('pairs'):
            relatives.append('同時出現候補：'+' / '.join(f"{by_id[i]['no']:02d} {by_id[i]['name']}" for i in s['pairs']))
        if relatives:y=text(p,' / '.join(relatives),MARGIN,y+3,10.5,color='muted',leading=15.8)
        if s.get('elementNote'):
            y=text(p,'属性の注記：'+s['elementNote'],MARGIN,y+7,10.5,color='muted',leading=15.8)
        assert y<791,(no,'ecology-page overflow',y)
        footer(p,f"{no:02d} 生態と暮らし / {args.snapshot_version}")

    # Final source page, including stable provenance and limitations.
    p=new_page('sources');source_page=p.number
    heading(p,'SOURCE & EDITORIAL NOTES','出典と編集記録')
    y=119
    for title,body in [('正本データ','GitHub: kamamon/Kari\npublic/data/bestiary.json\n'+args.snapshot_version+' / '+args.snapshot_sha),
                      ('生態の原本','docs/source/chatgpt-009/bestiary_9A.json\ndocs/source/chatgpt-009/bestiary_9B.json\ndocs/source/chatgpt-009/bestiary_9C.json\ndocs/source/chatgpt-009/bestiary_9D.json'),
                      ('原画の対応','chatgpt-inbox/009/art-manifest.json\n既存13原画と新規73原画を恒久IDで対応。\n既存原画はart-source/monster/、新規原画はchatgpt-inbox/009/art/。'),
                      ('編集方針',prose[10]+' '+prose[7]),('制作への引き継ぎ',prose[11]+' '+prose[12]),('この版の確認範囲',prose[13])]:
        text(p,title,MARGIN,y,12,font='bold',color='green');y+=22
        y=text(p,body,MARGIN,y,10.5,leading=16.3)+19
    assert y<797,('sources',y)
    footer(p,'原画・設定は制作資料 / 正式な採用と実装は別途')
    # Resolve links and late-bound page numbers.
    for pn,sid,y in pp.pop('index_rows'):
        p=doc[pn]
        text(p,str(pp[sid]+1),PAPER[0]-MARGIN-37,y,10.5,width=33,align='right')
    for pn,r,target in link_jobs:
        target=pp[target] if isinstance(target,str) else target
        doc[pn].insert_link({'kind':fitz.LINK_GOTO,'from':r,'page':target,'to':fitz.Point(0,0)})
    toc=[[1,'霧境の狩人 モンスター図鑑',1],[1,'読み方・実装状況',2],
         [1,'全種索引',3],[1,'狩場索引',6],[1,'骨格と登場段階',10],
         [1,'全86種の詳細',11]]
    for s in species:
        toc.append([2,f"{s['no']:02d} {s['name']} / {s['title']}",pp[s['id']]+1])
        toc.append([3,'生態と暮らし',pp[s['id']]+2])
    toc.append([1,'出典と編集記録',source_page+1])
    doc.set_toc(toc)
    doc.set_metadata({'title':'霧境の狩人 モンスター図鑑 第2版','author':'VEILBOUND HUNTERS / ChatGPT',
                      'subject':'86種の原画・基本情報・生態、20狩場の設定案',
                      'keywords':'VEILBOUND HUNTERS, monster, bestiary, 生態, 原画',
                      'creator':'build_encyclopedia_v2.py', 'producer':'PyMuPDF with embedded Noto CJK fonts'})
    pdf=out/'VEILBOUND_HUNTERS_monster_encyclopedia_v2.pdf'
    doc.save(pdf,garbage=4,deflate=True,clean=True)
    doc.close()
    check=fitz.open(pdf)
    errors=[];checked=0
    for s in species:
        a=check[pp[s['id']]].get_text();b=check[pp[s['id']]+1].get_text()
        for value in [s['name'],s['title'],s['look'],s['organ'],s['habitat'],*s['moves'],*s['parts']]:
            checked+=1
            if compact(value) not in compact(a):errors.append([s['no'],'art',value])
        for value in [*s['ecology'].values(),s['gear'],s['armorLook'],*s['materials']]:
            checked+=1
            if compact(value) not in compact(b):errors.append([s['no'],'ecology',value])
    page_texts=[p.get_text() for p in check]
    assert not errors,errors[:8]
    assert len(check)==183,len(check)
    # Layout bounds include all drawing calls, not just extracted text.
    overflow=[x for x in placements if x['rect'][0]<MARGIN-2 or x['rect'][2]>PAPER[0]-MARGIN+2 or x['rect'][1]<0 or x['rect'][3]>PAPER[1]-14]
    assert not overflow,overflow[:3]
    # Render every page to a thumbnail for contact-sheet review.
    thumb_dir=tmp/'page-thumbnails';thumb_dir.mkdir(exist_ok=True)
    thumbs=[]
    for i,p in enumerate(check):
        pix=p.get_pixmap(matrix=fitz.Matrix(.45,.45),alpha=False)
        path=thumb_dir/f'p{i+1:03d}.png';pix.save(path);thumbs.append(path)
    contact_paths=[]
    for chunk in range(math.ceil(len(thumbs)/24)):
        selected=thumbs[chunk*24:(chunk+1)*24]
        sheet=Image.new('RGB',(4*282,6*405),(217,222,213));d=ImageDraw.Draw(sheet)
        for k,path in enumerate(selected):
            im=Image.open(path);x=(k%4)*282+7;y=(k//4)*405+19
            sheet.paste(im,(x,y));d.text((x,y-16),f'{chunk*24+k+1:03d}',fill=(31,46,38))
        path=tmp/f'contact_{chunk+1:02d}.jpg';sheet.save(path,quality=87);contact_paths.append(str(path))
    preview_specs=[('cover',0),('galdros',pp['monster.galdros']),('galdros_ecology',pp['monster.galdros']+1),
                   ('kordopil',pp['monster.kordopil']),('final_species',pp[species[-1]['id']])]
    previews=[]
    for label,pn in preview_specs:
        pix=check[pn].get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False)
        im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
        name=f'encyclopedia_v2_{label}.jpg';im.save(out/name,quality=89)
        previews.append(name)
    source_sha=sha256(registry_path)
    details={
      'title':'霧境の狩人 モンスター図鑑 第2版','date':args.date,'version':args.snapshot_version,
      'sourceCommit':args.snapshot_sha,'sourceRegistry':'public/data/bestiary.json','sourceRegistrySHA256':source_sha,
      'pdf':pdf.name,'pdfSHA256':sha256(pdf),'bytes':pdf.stat().st_size,'pages':len(check),
      'species':86,'adults':78,'juveniles':8,'habitats':20,'playableHabitatCount':1,
      'implementedSpeciesCount':1,'existingArt':13,'newConceptsFromPreviousPR':73,'newImagesGenerated':0,
      'uniqueEmbeddedSpeciesImages':len(images),'ecologyFields':688,'checkedTextValues':checked,
      'pdfImageEncoding':PDF_IMAGE_SETTINGS,
      'textMismatches':errors,'bodyFontMinimumPt':10.5,'captionLabelMinimumPt':10.5,
      'outlineEntries':len(check.get_toc()),'internalLinks':sum(len(p.get_links()) for p in check),
      'renderedPages':len(thumbs),'layoutBoundsViolations':len(overflow),
      'originalImagesUnchanged':True,'artAdoptionUnchanged':True,'gameDataUnchanged':True,
      'previews':previews,
      'speciesPages':[{'no':s['no'],'id':s['id'],'name':s['name'],'artPage':pp[s['id']]+1,'ecologyPage':pp[s['id']]+2,'artSHA256':arts[s['id']]['sha256']} for s in species],
      'visualReview':{'status':'pending','contactSheets':contact_paths},
      'limitations':['原画85種は採用待ち。全86種が遊べるという意味ではない。','3Dモデル・動作・当たり判定・実機表示は今回未検証。','属性・弱点等の多くは候補値で、攻略の確定情報ではない。']
    }
    (out/'encyclopedia_v2_manifest.json').write_text(json.dumps(details,ensure_ascii=False,indent=2)+'\n')
    (tmp/'layout-records.json').write_text(json.dumps(placements,ensure_ascii=False))
    print(json.dumps({k:details[k] for k in ['pdf','bytes','pages','species','ecologyFields','checkedTextValues','outlineEntries','internalLinks','renderedPages']},ensure_ascii=False,indent=2))
    print('CONTACT_SHEETS',contact_paths)

if __name__=='__main__':main()
