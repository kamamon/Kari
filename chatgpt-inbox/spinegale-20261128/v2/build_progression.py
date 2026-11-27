"""Rank-specific item definitions, recipes and procedural transparent inventory icons."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter,ImageEnhance,ImageFont
import numpy as np,json,math
P=Path(__file__).parent;O=P/'icons';O.mkdir(exist_ok=True)
rank=['初級','中級','上級'];prefix=['疾棘','迅棘','嵐棘'];kinds=['scale','claw','spine','dewlap','fan','tendon','crown','core']
labels=[['鱗','鋭爪','背棘','喉膜','尾扇','弾性腱'],['上鱗','硬爪','硬背棘','強喉膜','上尾扇','強靭腱','冠骨'],['煌鱗','穿爪','裂風棘','彩喉膜','双翼尾扇','瞬発腱','嵐冠骨','疾走核']]
W=[('heavy_blade','疾棘断剣','裂風断剣','絶迅断剣',.93,10,'背棘を連ねた峰、上級は二重の長い棘'),('guard_blade','疾棘護刃','迅棘護刃','嵐牙護刃',.90,15,'鉤爪型短剣と二股尾扇盾'),('twin_blades','双棘牙','双迅爪','双嵐閃',.88,20,'左右対称の細身の爪刃'),('long_blade','疾風棘刀','裂風迅刀','天駆嵐刀',.92,15,'反り刃と二股の鍔'),('war_maul','疾棘穿槌','迅棘破槌','嵐冠轟槌',.94,10,'束ねた背棘と冠骨を打面に'),('long_lance','疾棘穿槍','裂風尖槍','天駆穿槍',.93,10,'細長い穂先と尾扇盾'),('ring_bow','疾棘環弓','迅翼環弓','双嵐天弓',.90,15,'湾曲棘と弾性腱の弦')]
A=[('head','疾棘頭冠','迅棘風冠','嵐棘天冠',[8,18,33],{'回避性能':3},'冠棘と喉膜の襟'),('chest','疾棘胴衣','迅棘軽鎧','嵐棘翔鎧',[8,19,34],{'体術':4},'細い鱗板と後流形の胸当て'),('arms','疾棘腕甲','迅棘腕甲','嵐棘裂腕',[7,17,32],{'回避性能':3},'湾曲棘の腕甲'),('waist','疾棘腰帯','迅棘尾腰','嵐棘双翼腰',[7,17,32],{'体術':3},'二股尾扇の腰布'),('legs','疾棘脚装','迅棘走脚','嵐棘天駆脚',[8,19,34],{'回避性能':4,'体術':3},'脚の腱を模した関節可動帯')]
def mid(k,r):return f'item.spinegale.{k}.r{r+1}'
materials=[];tiers=[];weapons=[];armor=[]
for r in range(3):
    rr=range(len(labels[r]));items=[]
    for i in rr:
        k=kinds[i];it={'id':mid(k,r),'name':'疾棘竜の'+labels[r][i],'rank':f'rank.{r+1}','kind':k,'icon':f'icons/{k}_r{r+1}.png','rarity':min(8,2+2*r+(2 if k in ('tendon','crown','core') else 1 if k in ('dewlap','fan') else 0))};items.append(it);materials.append(it)
    def table(pairs):assert sum(v for k,v in pairs)==100;return [{'item':mid(k,r),'weight':v} for k,v in pairs]
    body=[('scale',42),('claw',25),('spine',18),('dewlap',10),('tendon',5)] if r==0 else [('scale',37),('claw',22),('spine',17),('dewlap',10),('tendon',8),('crown',6)] if r==1 else [('scale',32),('claw',20),('spine',16),('dewlap',10),('tendon',10),('crown',9),('core',3)]
    cap=[('scale',30),('claw',15),('spine',15),('dewlap',20),('tendon',20)] if r==0 else [('scale',26),('claw',15),('spine',15),('dewlap',17),('tendon',16),('crown',11)] if r==1 else [('scale',23),('claw',14),('spine',14),('dewlap',16),('tendon',16),('crown',13),('core',4)]
    break_head=[('spine',70),('scale',30)] if r==0 else [('crown',55),('spine',45)];legs=[('claw',65),('tendon',35)] if r!=2 else [('claw',57),('tendon',38),('core',5)]
    tiers.append({'rank':f'rank.{r+1}','name':rank[r],'hp':[1450,3200,5800][r],'walkMps':[2.8,3.0,3.2][r],'runMps':[7.2,7.8,8.5][r],'staminaMax':[100,120,140][r],'fatigueTicks':[600,540,480][r],'fatigueThresholdRatio':.2,'attackScale':[1,1.55,2.15][r],'rageSpeedScale':1.15,'rageStaminaCostScale':1.2,'fatigueAttack':False,'fatigueMove':False,'comboPolicy':['基本単発・二連','最大三連・間合いに応じて追撃','フェイント・最大三連、予告と終了硬直維持'][r],'appearance':['基準の黄緑・炭色','発達した背棘・暗い金の縞','冠棘と尾扇の成長・濃い縞'][r],'loot':{'body':table(body),'capture':table(cap),'tail':table([('fan',80),('scale',20)]),'headBreak':table(break_head),'dewlapBreak':table([('dewlap',100)]),'spineBreak':table([('spine',100)]),'legBreak':table(legs)}})
    for i,(family,*v) in enumerate(W):
        names=v[:3];ratio,aff,look=v[3:];main=['spine','claw','claw','spine','spine','spine','fan'][i];secondary=['tendon','fan','tendon','claw','claw','fan','tendon'][i];ingredients={mid('scale',r):[3,4,5][r],mid(main,r):[2,3,4][r],mid(secondary,r):[1,2,3][r]};
        if r==2 and i in [0,3,4,5]:ingredients[mid('crown',r)]=1
        if r==2 and i in [2,6]:ingredients[mid('core',r)]=1
        weapons.append({'id':f'weapon.spinegale.{family}.r{r+1}','name':names[r],'rank':f'rank.{r+1}','family':family,'element':'none','attackRatioVsRankStandard':round(ratio+[0,.015,.025][r],3),'affinityPercent':aff+[0,5,10][r],'upgradeFrom':f'weapon.spinegale.{family}.r{r}' if r else None,'recipe':ingredients,'cost':[850,3200,8400][r],'appearance':look})
    for i,(slot,*v) in enumerate(A):
        names=v[:3];defs,skills,look=v[3:];secondary=['spine','dewlap','claw','fan','tendon'][i];recipe={mid('scale',r):[2,3,4][r],mid(secondary,r):[1,2,3][r]};
        if r>=1 and slot=='head':recipe[mid('crown',r)]=1
        if r==2 and slot=='legs':recipe[mid('core',r)]=1
        sk=skills.copy()
        if r==1:sk['高速研磨']=2
        if r==2:sk['見切り']=2
        armor.append({'id':f'armor.spinegale.{slot}.r{r+1}','name':names[r],'rank':f'rank.{r+1}','slot':slot,'defense':defs[r],'skills':sk,'recipe':recipe,'cost':[450,1500,3600][r],'appearance':look,'resistanceProposal':{'ice':-2,'water':-1,'fire':0,'thunder':0,'wind':0,'mist':0}})
D={'schema':'kari-spinegale-design-v2-proposal','monsterId':'monster.spinegale','note':'提案JSON。既存型への変換・ID確認・実機調整はClaude。原種は上級まで、極級の追加なし。上位見た目は今後差分メッシュを制作する。初級GLBの既存クリップは60 tick/s。疲労は怒りで解除しない。中級・上級は疲労ループ区間のみ短縮し始動・復帰を維持する。','tiers':tiers,'materials':materials,'weapons':weapons,'armor':armor,'weaponDesign':'軽量・無属性・高会心。強化前装備を消費する派生案。会心は現行の式に合わせる。','armorDesign':'男女同じ性能。各級の5部位セットは回避性能10・体術10。中級は高速研磨10、上級は見切り10。技能名や発動値は現行実装と照合。'}
assert len(materials)==21 and len(weapons)==21 and len(armor)==15
ids={m['id'] for m in materials};assert all(set(x['recipe'])<=ids for x in weapons+armor)
(P/'rank_progression_v2.json').write_text(json.dumps(D,ensure_ascii=False,indent=2))
# Icons: each asset painted from generated material textures, with rank-specific shape/palette and transparent alpha.
S=320;res=256
maps={k:Image.open(P/'textures'/f'{k}_basecolor.png').convert('RGB') for k in ['hide','keratin','membrane','feather','mouth']}
def icon(k,r):
    # independently composited material silhouettes with texture and depth; deterministic geometry
    canvas=Image.new('RGBA',(S,S));
    def part(poly,mat,offset=(0,0),light=1):
        m=Image.new('L',(S,S));dr=ImageDraw.Draw(m);dr.polygon(poly,fill=255);edge=m.filter(ImageFilter.MaxFilter(7));sh=Image.new('RGBA',(S,S),(16,15,13,0));sh.putalpha(edge.filter(ImageFilter.GaussianBlur(2)));canvas.alpha_composite(sh,(2,4));
        a=maps[mat].resize((S,S),Image.Resampling.LANCZOS);a=ImageEnhance.Color(a).enhance(1+.13*r);a=ImageEnhance.Contrast(a).enhance(1+.15*r);a=ImageEnhance.Brightness(a).enhance(light*(1+.07*r));aa=a.convert('RGBA');aa.putalpha(m);canvas.alpha_composite(aa);outline=ImageDraw.Draw(canvas);outline.line(poly+[poly[0]],fill=(38,32,23,210),width=2,joint='curve')
    if k=='scale':
        for i,(x,y) in enumerate([(92,110),(165,80),(205,146),(117,193),(170,182)]):
            w=38+r*4;h=55+r*5;part([(x,y-h),(x+w,y-h*.4),(x+w*.85,y+h*.35),(x,y+h),(x-w*.8,y+h*.25),(x-w,y-h*.35)],'hide',light=.95+.06*i)
    elif k in ('claw','spine'):
        for i in range(2+(r>0)):
            x=75+i*65;y=250-i*20;h=150+r*10;w=50 if k=='claw' else 35;part([(x-w*.55,y),(x-w*.65,y-65),(x-w*.32,y-115),(x+25,y-h),(x+65+r*5,y-h-10),(x+40,y-h+32),(x+11,y-82),(x+w*.48,y-20)],'keratin',light=1.12-.08*i)
    elif k=='dewlap':
        part([(46,85),(90,61),(155,77),(226,57),(270,91),(252,160),(223,211),(180,250),(145,235),(112,257),(67,207),(51,155)],'membrane',light=1.05);dr=ImageDraw.Draw(canvas)
        for i in range(6+r):dr.line((72+i*30,89,110+i*20,222),fill=(121,48,26,180),width=2)
    elif k=='fan':
        for s in [-1,1]:
            for i in range(4+r):
                x=155+s*(25+i*16);y=65+i*18;part([(160,256),(x-s*10,y+70),(x,y),(x+s*19,y+35),(x+s*13,y+103),(180 if s>0 else 140,258)],'feather',light=1+.05*i)
    elif k=='tendon':
        for i in range(4+r):
            x=87+i*24;part([(x-13,250),(x-22,205),(x+4,151),(x+21,97),(x+12,58),(x+29,54),(x+39,99),(x+24,155),(x+7,210),(x+11,253)],'mouth',light=1.50+.09*i)
    elif k=='crown':
        part([(60,230),(68,148),(115,104),(135,55),(148,110),(180,73),(193,114),(245,73),(229,156),(263,190),(243,242),(184,258),(102,254)],'keratin',light=1.4);part([(88,225),(98,169),(140,132),(196,137),(235,189),(216,230)],'hide')
    else:
        part([(70,169),(95,85),(169,55),(243,87),(255,165),(217,237),(142,263),(83,227)],'mouth',light=1.30)
        for i in range(5):part([(95+i*12,220),(100+i*20,117),(128+i*20,91),(135+i*20,133),(109+i*15,235)],'keratin',light=1.20)
    return canvas.resize((res,res),Image.Resampling.LANCZOS)
for m in materials:icon(m['kind'],int(m['rank'][-1])-1).save(P/m['icon'])
# 3 rank rows, inventory preview. Font kept local only.
fontp='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';font=ImageFont.truetype(fontp,18);small=ImageFont.truetype(fontp,14);sheet=Image.new('RGB',(1280,600),(31,37,37));draw=ImageDraw.Draw(sheet);draw.text((22,13),'SPINEGALE  |  MATERIAL INVENTORY  /  RANK 1–3',font=font,fill=(230,211,150))
for r in range(3):
    draw.text((22,65+r*177),f'RANK {r+1}',font=small,fill=(230,211,150));
    for i,k in enumerate(kinds[:len(labels[r])]):
        x=115+i*145;y=47+r*177;draw.rounded_rectangle((x,y,x+135,y+145),radius=8,fill=(47,54,53),outline=(79,87,77));im=Image.open(O/f'{k}_r{r+1}.png').resize((117,117));sheet.paste(im,(x+9,y+5),im);draw.text((x+9,y+122),k.upper(),font=small,fill=(218,224,213))
sheet.save(P/'material_inventory.png');print('rank data: 3 tiers, 21 materials/icons, 21 weapons, 15 armor parts')
