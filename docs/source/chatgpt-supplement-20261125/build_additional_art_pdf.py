#!/usr/bin/env python3
"""Build the 53-image art review book. Paths are relative to this script."""
from pathlib import Path
import io, json, hashlib, re, argparse
import fitz
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = Path(__file__).resolve().parent
W, H = 595.276, 841.89
M = 44
COL = {k: tuple(int(v[i:i+2], 16)/255 for i in (0,2,4)) for k,v in {
    'paper':'F6F3EB','ink':'29362F','soft':'627068','line':'D6D7CC','bronze':'8F7650','dark':'34483C','white':'FFFFFF'
}.items()}

def load_group(folder, file, key, label, en):
    data=json.loads((ROOT/folder/file).read_text())
    out=[]
    for row in data[key]:
        r=dict(row)
        r['filename']=r.get('filename') or r.get('file')
        r['group']=folder; r['label']=label; r['en']=en
        r['path']=ROOT/folder/r['filename']
        if not r['path'].is_file(): raise FileNotFoundError(r['path'])
        out.append(r)
    return out

def get_assets():
    assets=[]
    assets += load_group('icons','icons_generation.json','assets','道具・ガルドロス素材','ITEMS / MATERIALS')
    assets += load_group('equipment','equipment_manifest.json','items','岩殻装備の制作資料','EQUIPMENT STUDIES')
    assets += load_group('characters-props','metadata.json','assets','里の人物・小物・共通材質','VILLAGE / MATERIALS')
    assets += load_group('fields','fields_generation.json','records','狩場の景観原画','FIELD CONCEPTS')
    if len(assets)!=53: raise ValueError(f'Expected 53 artworks; got {len(assets)}')
    if len({a['path'] for a in assets}) != 53: raise ValueError('Duplicate image path')
    for n,a in enumerate(assets,1): a['number']=n; a['page']=n+5
    return assets

def subset_font(path, corpus):
    font=TTFont(path,fontNumber=0)
    opt=subset.Options(retain_gids=True)
    sub=subset.Subsetter(options=opt); sub.populate(text=corpus); sub.subset(font)
    buf=io.BytesIO(); font.save(buf); return buf.getvalue()

class Book:
    def __init__(self,assets):
        self.assets=assets; self.doc=fitz.open(); self.links=[]; self.mapping=[]; self.images={}
        corpus=Path(__file__).read_text()+json.dumps(assets,ensure_ascii=False,default=str)+''.join(chr(i) for i in range(32,127))
        self.reg=subset_font('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',corpus)
        self.bold=subset_font('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',corpus)
        self.fonts={'R':fitz.Font(fontbuffer=self.reg),'B':fitz.Font(fontbuffer=self.bold)}
    def page(self,section):
        p=self.doc.new_page(width=W,height=H)
        p.draw_rect(p.rect,color=None,fill=COL['paper'])
        p.insert_font(fontname='JP',fontbuffer=self.reg)
        p.insert_font(fontname='JPB',fontbuffer=self.bold)
        self.line(p,M,798,W-M,798)
        self.txt(p,'VEILBOUND HUNTERS',M,810,7.3,color='soft')
        self.txt(p,section,222,810,7.3,color='soft')
        self.txt(p,f'{p.number+1:02d}',W-M-18,808,9,color='bronze')
        return p
    def txt(self,p,t,x,y,size=10.5,bold=False,color='ink'):
        f='B' if bold else 'R'; width=self.fonts[f].text_length(t,fontsize=size)
        if x+width>W-M+1: raise ValueError(f'Text overflow: {t}')
        p.insert_text((x,y+size),t,fontname='JPB' if bold else 'JP',fontsize=size,color=COL[color])
        return width
    def wrap(self,t,width,size,bold=False):
        font=self.fonts['B' if bold else 'R']; result=[]
        for para in t.split('\n'):
            line=''
            for c in para:
                if line and font.text_length(line+c,fontsize=size)>width:
                    if c in '、。，．）】」』！？': result.append(line[:-1]); line=line[-1]+c
                    else: result.append(line); line=c
                else: line+=c
            result.append(line)
        return result
    def block(self,p,t,x,y,width=W-2*M,size=10.5,leading=17.5,bold=False,color='ink',max_h=None):
        ls=self.wrap(t,width,size,bold)
        if max_h is not None and len(ls)*leading>max_h: raise ValueError(f'Block overflow {len(ls)} lines: {t}')
        for i,l in enumerate(ls): self.txt(p,l,x,y+i*leading,size,bold,color)
        return y+len(ls)*leading
    def line(self,p,x1,y1,x2,y2,color='line'):
        p.draw_line((x1,y1),(x2,y2),color=COL[color],width=.6)
    def heading(self,p,kicker,title):
        self.txt(p,kicker,M,46,8.4,color='bronze')
        self.txt(p,title,M,68,23,bold=True)
        self.line(p,M,117,W-M,117)
    def image(self,p,path,rect):
        path=Path(path)
        if path not in self.images:
            with Image.open(path) as im:
                im.load(); original_size=im.size
                if im.mode=='RGBA' or 'transparency' in im.info:
                    rgba=im.convert('RGBA'); rgb=Image.new('RGB',im.size,(246,243,235)); rgb.paste(rgba,mask=rgba.getchannel('A'))
                else: rgb=im.convert('RGB')
                rgb.thumbnail((1800,1800),Image.Resampling.LANCZOS)
                data=io.BytesIO();rgb.save(data,format='JPEG',quality=88,optimize=True,subsampling=0)
            self.images[path]={'bytes':data.getvalue(),'original_size':original_size,'xref':None,'jpeg_sha256':hashlib.sha256(data.getvalue()).hexdigest()}
        ent=self.images[path]
        xref=p.insert_image(rect,stream=ent['bytes'],xref=ent['xref'] or 0,keep_proportion=True)
        ent['xref']=xref
        return xref
    def badge(self,p,text):
        x=W-M-76
        p.draw_rect(fitz.Rect(x,45,W-M,65),color=None,fill=COL['line'])
        self.txt(p,text,x+10,49,8.2,color='dark')

def make_cover(b):
    p=b.page('追加素材集 / 2026.11.25')
    b.txt(p,'ORIGINAL GAME / PRODUCTION ART COLLECTION',M,48,8.7,color='bronze')
    b.txt(p,'霧境の狩人',M,78,29,bold=True)
    b.txt(p,'VEILBOUND HUNTERS',M,123,13.7,bold=True)
    b.txt(p,'追加素材集',M,161,20,bold=True)
    b.txt(p,'53点の原画と制作資料',M,195,11.5,color='soft')
    cover=next(a for a in b.assets if a['group']=='fields')
    b.image(p,cover['path'],fitz.Rect(M,237,W-M,575))
    b.line(p,M,610,W-M,610,'bronze')
    cols=[('14','道具・素材'),('9','装備資料'),('10','人物・小物・材質'),('20','狩場景観')]
    for i,(num,title) in enumerate(cols):
        x=M+i*128
        b.txt(p,num,x,628,25,bold=True)
        b.txt(p,title,x,667,9.3,color='soft')
    b.block(p,'採用済みの画風とリポジトリの構想をもとに制作。\n新規原画の提案であり、3Dモデルやゲーム実装の完成品ではありません。',M,722,size=10.0,leading=17,color='soft')

def make_guide(b):
    p=b.page('読み方と収録範囲'); b.heading(p,'READING GUIDE','この冊子の読み方')
    y=148
    sections=[
      ('01  一点ずつ確認する','53枚すべてを個別ページに収録しました。名称とファイル名を同じページへ置き、出典と制作上の判断を添えています。収録一覧の行を押すと該当ページへ移動できます。'),
      ('02  採用する原画を選ぶ','本冊子の全画像は新規案です。採用済みの基準ボードや装備を参照していますが、新しい形や裏面の補完まで採用済みとは扱いません。'),
      ('03  元PNGと制作記録を渡す','実装担当には原寸PNGと同梱のJSON・READMEを渡してください。このPDFは閲覧用に画像を圧縮しています。文字、識別ID、当たり判定は原画へ焼き込んでいません。')
    ]
    for title,body in sections:
        b.txt(p,title,M,y,13.4,bold=True); y=b.block(p,body,M,y+29,size=10.5,leading=18)+31
    b.line(p,M,y,W-M,y);y+=25
    b.txt(p,'今回の収録範囲',M,y,13.4,bold=True);y+=30
    b.block(p,'・アイコン14点は、道具4点とガルドロス素材10点です。他の実装済みモンスター素材67点のアイコンは含みません。\n・20狩場のうち風礫盆地以外の19狩場は、登録簿にある計画の景観案です。\n・全86種のモンスター原画・183ページ図鑑（PR #3）、追加武器6枚（PR #2）は再生成していません。',M,y,size=10.0,leading=18)
    b.txt(p,'参照基点：main b62f1e6 / 制作日：2026-11-25',M,747,8.6,color='soft')

def make_index(b,title,assets,description):
    p=b.page('収録一覧');b.heading(p,'CONTENTS / CLICK TO OPEN',title)
    b.block(p,description,M,135,size=9.5,leading=16,color='soft')
    y=181
    for a in assets:
        b.txt(p,f"{a['number']:02d}",M,y,10,color='bronze')
        b.txt(p,a['name'],M+31,y,10.8,bold=True)
        b.txt(p,str(a['page']),W-M-21,y,10.8,color='bronze')
        b.txt(p,a['filename'],M+31,y+14,6.5,color='soft')
        b.line(p,M,y+24,W-M,y+24)
        b.links.append((p.number,fitz.Rect(M,y-2,W-M,y+24),a['page']-1))
        y+=26.0 if len(assets)>21 else 28.0
    if len(assets)<15:
        b.block(p,'人物は職種ごとの外見案です。固有名・身長・性格・会話設定は確定していません。\n\n共通材質は色と表面の印象を検討する資料です。シームレスな反復、法線や粗さのPBRマップの完成を表すものではありません。',M,560,size=10.5,leading=18,color='soft')

def purpose(a):
    if a['group']=='icons':
        if str(a.get('id','')).startswith('item.'):
            return '所持品・商店・狩猟中の道具選択で使う識別用の原画。形状は世界観に合わせた制作案です。'
        return 'ガルドロス素材の報酬・所持品・装備強化で使う識別用の原画。素材ごとの輪郭と質感を描き分けています。'
    notes=a.get('spec_notes',[])
    return (notes[0] if notes else '3D制作に向けた形と材質の参考原画です。')

def make_asset(b,a):
    p=b.page(a['label'])
    b.txt(p,f"{a['number']:02d} / 53    {a['en']}",M,46,8.3,color='bronze')
    b.badge(p,'採用待ち')
    size=21
    while b.fonts['B'].text_length(a['name'],fontsize=size)>W-2*M: size-=.5
    b.txt(p,a['name'],M,75,size,bold=True)
    b.txt(p,a['filename'],M,112,7.2,color='soft')
    b.line(p,M,135,W-M,135)
    if a['group']=='fields':
        imrect=fitz.Rect(M,155,W-M,560)
        xref=b.image(p,a['path'],imrect)
        b.txt(p,'地形',M,591,9,bold=True,color='bronze')
        b.block(p,a.get('terrain',''),M,611,size=11,leading=18,max_h=55)
        b.txt(p,'光と空気',M,680,9,bold=True,color='bronze')
        b.block(p,a.get('mood',''),M,700,size=10.4,leading=17.5,max_h=55)
        b.txt(p,'風礫盆地の景観資料 / 厳密な区画図ではありません' if a.get('number_in_source',a.get('number'))==1 or a['name']=='風礫盆地' else '登録簿に記載された狩場構想の景観案',M,769,8.1,color='soft')
    else:
        imrect=fitz.Rect(M,153,W-M,634)
        xref=b.image(p,a['path'],imrect)
        b.txt(p,'用途・制作上の判断',M,658,9,bold=True,color='bronze')
        b.block(p,purpose(a),M,679,size=10.3,leading=17,max_h=68)
        if a.get('id'): b.txt(p,a['id'],M,756,8.1,color='soft')
        else:
            info='人物の新規外見案 / 固有名は未設定' if a.get('kind','').startswith('npc') else '材質・構造の参照原画 / 寸法と3D化は未確認'
            b.txt(p,info,M,756,8.1,color='soft')
    ent=b.images[a['path']]
    b.mapping.append({'number':a['number'],'name':a['name'],'filename':a['filename'],'group':a['group'],'page':p.number+1,'source_sha256':hashlib.sha256(a['path'].read_bytes()).hexdigest(),'source_size':list(ent['original_size']),'image_xref':xref,'embedded_jpeg_sha256':ent['jpeg_sha256']})

def make_sources(b):
    p=b.page('出典と既存資料');b.heading(p,'SOURCES','制作の根拠と既存資料')
    y=150
    blocks=[
      ('共通の画風','採用済みの art-source/board/style_board_v2.png。灰緑、灰褐色の岩、青銅、生成り、厚布と革を基準にしています。'),
      ('道具と素材','public/data/items.json と COPY14。名称と識別IDは現行データへ対応させ、外見は新規に提案しました。'),
      ('装備の近接資料','docs/chatgpt-request-7.txt、7b.txt、COPY13、NP-021。採用された防具・武器を参照し、部位詳細と岩殻段階の派生案を補っています。'),
      ('人物・小物・共通材質','制作計画の NP-025・NP-026・NP-032・NP-048。鍛冶担当と道具担当、テント、採集草、露頭、革・木・鉄の色材質。'),
      ('20狩場の名称・地形','public/data/bestiary.json の fields。狩場構想の地形と雰囲気を原画へ展開しました。細かな配置は画像制作時の提案です。')
    ]
    for title,body in blocks:
        b.txt(p,title,M,y,12,bold=True);y=b.block(p,body,M,y+25,size=10,leading=17.5)+24
    b.line(p,M,646,W-M,646)
    b.txt(p,'提出済み資料への参照',M,667,12,bold=True)
    for t,url,yy in [('武器設定図6枚 / PR #2','https://github.com/kamamon/Kari/pull/2',704),('全86種の原画・図鑑 / PR #3','https://github.com/kamamon/Kari/pull/3',738)]:
        b.txt(p,t,M,yy,10.2,color='bronze');b.txt(p,url,M,yy+17,8,color='soft')
        p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(M,yy,W-M,yy+32),'uri':url})

def make_limits(b):
    p=b.page('採用と引き継ぎ');b.heading(p,'HANDOFF / LIMITATIONS','採用前に確認すること')
    sections=[
      ('原画と実装を分ける','この53点は制作資料です。正式採用、3Dモデル、UV、骨、動作、当たり判定、ゲーム内表示、iPhoneでの性能は、この冊子では確認していません。'),
      ('アイコンの原本を保持する','アイコン原本は1254×1254のRGBAです。依頼の1024×1024原寸ではありません。ごく薄いalphaが外周に残り、主体も完全不透明ではない部分があります。縮小・alpha清掃・小さなUIでの視認性確認は実装工程で行ってください。'),
      ('装備の数値は元の仕様を使う','原画の輪郭を無補正でメッシュや当たり判定に使わないでください。兜のひも、裏地や留め具の補完、武器の岩板と裏面構造は、新規の判断として同梱READMEに記録しています。'),
      ('地形と材質を検証する','狩場原画の寸法・通路・高低差は厳密な設計図ではありません。材質3枚も、反復境界やPBR情報が確定した実行用素材ではありません。'),
      ('採用したものから受け渡す','原寸PNG、各グループの制作JSON、全体READMEを確認し、採用する画像を正式な置き場へ移してください。本冊子の画像は閲覧用に圧縮しており、元PNGを変更していません。')
    ]
    y=149
    for title,body in sections:
        b.txt(p,title,M,y,12.5,bold=True);y=b.block(p,body,M,y+28,size=10.4,leading=18)+28
    b.txt(p,'原画の確認 → 採用 → 3D・UIへの変換 → 実機で確認',M,755,10.1,bold=True,color='bronze')

def build(output,qa_dir):
    assets=get_assets();b=Book(assets)
    make_cover(b);make_guide(b)
    make_index(b,'道具・素材と岩殻装備',assets[:23],'アイコン14点と装備資料9点。行を押すと個別ページを開きます。')
    make_index(b,'里の人物・小物・共通材質',assets[23:33],'新しい人物の前後4枚、小物3枚、共通材質3枚。')
    make_index(b,'20狩場の景観原画',assets[33:],'地形と空気感を読むための原画。配置・当たり判定は別に確定します。')
    for a in assets:make_asset(b,a)
    make_sources(b);make_limits(b)
    for pno,rect,target in b.links:b.doc[pno].insert_link({'kind':fitz.LINK_GOTO,'from':rect,'page':target})
    toc=[[1,'霧境の狩人 追加素材集',1],[1,'この冊子の読み方',2],[1,'収録一覧',3],[2,'道具・素材と装備',3],[2,'人物・小物・材質',4],[2,'狩場景観',5]]
    old=None
    for a in assets:
        if a['label']!=old:toc.append([1,a['label'],a['page']]);old=a['label']
        toc.append([2,a['name'],a['page']])
    toc.extend([[1,'制作の根拠と既存資料',59],[1,'採用前に確認すること',60]])
    b.doc.set_toc(toc)
    b.doc.set_metadata({'title':'霧境の狩人 VEILBOUND HUNTERS 追加素材集53点','author':'ChatGPT','subject':'2026-11-25 / 新規原画53点・採用待ちの制作資料','keywords':'VEILBOUND HUNTERS, concept art, 狩場, 素材, 装備'})
    b.doc.save(output,garbage=4,deflate=True)
    b.doc.close()
    qa_dir.mkdir(parents=True,exist_ok=True)
    doc=fitz.open(output);checks=[];rendered=[];outside=[]
    for m in b.mapping:
        p=doc[m['page']-1];txt=p.get_text()
        if m['name'] not in txt or m['filename'] not in txt:raise ValueError(f'Text mismatch page {m["page"]}')
        images=p.get_images(full=True)
        if len(images)!=1:raise ValueError(f'Wrong artwork count on page {m["page"]}: {len(images)}')
        img=doc.extract_image(images[0][0])
        embedded_sha=hashlib.sha256(img['image']).hexdigest()
        if embedded_sha!=m['embedded_jpeg_sha256']:raise ValueError(f'Image source mismatch page {m["page"]}')
        m['pdf_image_xref']=images[0][0]
        checks.append({'page':m['page'],'name':m['name'],'title_and_filename_match':True,'embedded_image_matches':True})
    for i,p in enumerate(doc):
        p.get_pixmap(matrix=fitz.Matrix(.5,.5),alpha=False).save(qa_dir/f'page_{i+1:02d}.png');rendered.append(i+1)
        for block in p.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    box=fitz.Rect(span['bbox'])
                    if box.x0<0 or box.y0<0 or box.x1>W+.5 or box.y1>H+.5:outside.append({'page':i+1,'text':span['text'],'bbox':list(box)})
    if outside:raise ValueError(f'Text outside page: {outside}')
    for n in [1,2,3,6,20,23,29,35,39,44,58,59,60]:
        doc[n-1].get_pixmap(matrix=fitz.Matrix(1.2,1.2),alpha=False).save(qa_dir/f'detail_{n:02d}.png')
    result={'pdf':str(output.name),'page_count':len(doc),'artworks':53,'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'all_pages_rendered':rendered,'title_filename_image_checks':checks,'outside_page_text':outside,'internal_links':sum(len([x for x in p.get_links() if x['kind']==fitz.LINK_GOTO]) for p in doc),'bookmarks':len(doc.get_toc()),'font_method':'Noto Sans CJK JP regular/bold embedded; FontTools retain_gids=True','image_processing':'PDF-only JPEG quality 88, alpha composited onto paper color; original PNGs unchanged','visual_review':'Pending representative page review by the author','mapping':b.mapping}
    (ROOT/'pdf_validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['pdf','page_count','artworks','bytes','sha256','internal_links','bookmarks']},ensure_ascii=False,indent=2))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=ROOT/'VEILBOUND_HUNTERS_additional_art_53_v1.pdf');ap.add_argument('--qa-dir',type=Path,default=ROOT.parent.parent.parent.parent/'pdf_qa');args=ap.parse_args()
    build(args.output,args.qa_dir)
