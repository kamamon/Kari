"""Icon atlas: bespoke silhouette artwork with the approved creature's material crops. Not 3D gear models."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter,ImageOps,ImageEnhance
import json,math,numpy as np
P=Path(__file__).parent;O=P/'data';S=P/'material_source';Q=256
tex={f.stem:Image.open(f).convert('RGB').resize((Q,Q),Image.Resampling.LANCZOS) for f in S.glob('*.webp')};atlas=Image.new('RGBA',(128*11,128*9));idx={}
# render at 2x, then reduce. Metallic outlines / different tier tint are design choices.
def make(cat,k,r):
 im=Image.new('RGBA',(Q,Q));
 def poly(points,mat='hide',color=None,outline=True):
  pts=[(round(x*Q/128),round(y*Q/128)) for x,y in points];m=Image.new('L',(Q,Q));d=ImageDraw.Draw(m);d.polygon(pts,fill=255);out=m.filter(ImageFilter.MaxFilter(7));sh=Image.new('RGBA',(Q,Q),(26,20,34));sh.putalpha(out);im.alpha_composite(sh);tile=ImageEnhance.Brightness(tex[mat]).enhance([.92,1.10,1.22][r-1]) if color is None else Image.new('RGB',(Q,Q),color);tile=tile.convert('RGBA');tile.putalpha(m);im.alpha_composite(tile)
  d=ImageDraw.Draw(im)
  if outline:d.line(pts[:]+[pts[0]],fill=('#aaa275' if r==1 else '#d3acba' if r==2 else '#e6d39b'),width=2,joint='curve')
 def handle(a,b,w=7):
  a=np.array(a);b=np.array(b);v=b-a;v=np.array([-v[1],v[0]])/np.linalg.norm(v)*w;poly([a+v,b+v,b-v,a-v],'leg');
 def feather(x,y,dx,dy,w=12):
  a=np.array([x,y]);b=a+np.array([dx,dy]);v=np.array([-dy,dx])/math.hypot(dx,dy)*w;poly([a,a+(b-a)*.35+v,b,a+(b-a)*.65-v],'feather')
 def blade(a,b,w=14):
  a=np.array(a);b=np.array(b);v=b-a;v=np.array([-v[1],v[0]])/np.linalg.norm(v)*w;poly([a-v*.58,a+(b-a)*.23-v,b,a+(b-a)*.35+v,a+v*.58],'hide');feather(*(a+(b-a)*.2),*(b-a)*.52,w*.6)
 def shield(x,y,w=25):poly([(x-w,y-12),(x,y-w),(x+w,y-12),(x+w*.9,y+w*.48),(x,y+w),(x-w*.9,y+w*.48)],'wing');poly([(x-7,y-14),(x+8,y-14),(x+10,y+8),(x,y+18),(x-10,y+8)],'sac')
 if cat=='weapons':
  if k=='heavy_blade':handle((25,108),(48,81),7);blade((45,85),(108,15),20);poly([(29,76),(53,101),(63,90),(39,65)],'claw')
  elif k=='guard_blade':handle((18,107),(31,89),5);blade((30,90),(79,21),10);shield(89,79,24)
  elif k=='twin_blades':
   for x in (12,52):handle((x+8,108),(x+25,84),5);blade((x+24,86),(x+63,26),11)
  elif k=='long_blade':handle((17,109),(40,88),5);poly([(35,88),(50,89),(86,55),(115,13),(100,26),(69,48)],'claw');feather(37,88,45,-53,9)
  elif k=='war_maul':handle((25,111),(80,48),7);poly([(54,26),(84,11),(112,37),(108,59),(74,72),(49,48)],'hide');feather(59,52,37,-30,14);poly([(67,16),(78,22),(93,17),(101,33),(92,39),(61,37)],'sac')
  elif k in ('long_lance','gunlance'):handle((15,113),(91,33),5);blade((53,70),(113,11),11 if k=='long_lance' else 15);shield(38,56,21); 
  elif k=='ring_bow':
   poly([(29,112),(13,89),(14,55),(36,24),(74,10),(110,23),(116,39),(98,30),(73,22),(43,34),(26,56),(25,82),(41,105)],'hide');poly([(29,112),(35,102),(116,39),(109,29)],'leg');feather(27,84,45,-47,9);feather(66,24,40,0,7)
  elif k=='hunting_horn':handle((22,112),(68,55),8);poly([(48,43),(65,14),(88,10),(111,36),(105,59),(81,76),(54,65)],'sac');feather(56,61,48,-49,15);poly([(73,28),(92,22),(101,34),(88,43),(72,38)],'claw')
  else:
   poly([(13,91),(30,65),(50,68),(64,46),(111,22),(118,32),(73,58),(65,78),(39,93),(28,109)],'hide');poly([(42,59),(63,44),(79,47),(93,60),(82,75),(56,76)],'sac');feather(30,88,49,-47,10);poly([(70,61),(114,34),(119,41),(77,70)],'claw');
   if k=='heavy_bowgun':poly([(38,65),(53,55),(70,58),(74,84),(60,101),(42,93)],'wing')
  if r>=2:feather(30,95,43,-44,7 if r==2 else 12)
 elif cat=='armor':
  if k=='head':poly([(20,82),(23,42),(42,26),(72,20),(104,37),(110,69),(92,91),(64,92),(45,109),(30,100)],'hide');poly([(30,60),(97,52),(91,71),(56,78),(36,75)],'claw');feather(54,38,22,-32,14);feather(64,44,40,-25,12)
  elif k=='chest':poly([(19,38),(47,22),(63,37),(80,22),(109,38),(96,69),(86,112),(44,112),(33,69)],'hide');poly([(42,45),(64,40),(88,45),(82,96),(64,108),(46,96)],'belly');feather(31,51,-20,-27,11);feather(94,51,22,-29,11)
  elif k=='arms':
   for x in (33,91):poly([(x-17,21),(x+17,21),(x+20,54),(x+13,110),(x-14,110),(x-20,56)],'hide');feather(x-8,69,16,-51,13);poly([(x-12,95),(x+13,95),(x+15,114),(x-14,114)],'claw')
  elif k=='waist':poly([(20,30),(106,30),(112,57),(105,103),(77,112),(62,80),(48,112),(15,99)],'wing');poly([(17,29),(108,29),(110,47),(19,47)],'hide');feather(52,62,-34,40,13);feather(76,62,34,40,13);poly([(53,30),(75,30),(82,45),(64,57),(46,45)],'sac')
  else:
   for x in (36,91):poly([(x-20,14),(x+19,14),(x+13,78),(x+24,111),(x-20,111),(x-13,80)],'hide');poly([(x-13,69),(x+15,69),(x+24,110),(x-20,110)],'leg');feather(x-7,58,14,-34,11)
  if r==3:feather(61,67,18,-42,9)
 else:
  if k=='scale':
   for x,y in [(31,67),(65,44),(95,73)]:poly([(x-23,y-15),(x+3,y-26),(x+24,y-9),(x+17,y+20),(x,y+30),(x-19,y+13)],'hide')
  elif k=='claw':
   for x in (13,58):poly([(x,36),(x+27,22),(x+42,44),(x+34,80),(x+8,107),(x+16,68)],'claw')
  elif k in ('feather','tail_plume','crest'):
   for i in range(3 if k!='tail_plume' else 4):feather(24+i*16,111,28+i*3,-89+i*5,12)
  elif k=='membrane':poly([(11,45),(39,20),(74,16),(112,33),(108,90),(90,75),(67,103),(48,82),(21,110)],'wing');handle((14,45),(111,33),3);handle((39,25),(67,98),3)
  elif k=='sac':poly([(63,13),(91,22),(111,48),(107,84),(83,108),(47,113),(18,87),(13,55),(35,24)],'sac')
  else:poly([(61,8),(105,42),(91,98),(64,120),(28,98),(17,42)],'sac');poly([(61,8),(79,47),(64,120),(36,50)],'feather')
 # subtle highlights preserve silhouette; rank tip mark is omitted to keep icons pictorial
 return im.resize((128,128),Image.Resampling.LANCZOS)
fs=['heavy_blade','guard_blade','twin_blades','long_blade','war_maul','long_lance','ring_bow','hunting_horn','gunlance','light_bowgun','heavy_bowgun'];slots=['head','chest','arms','waist','legs'];ms=['scale','claw','feather','sac','tail_plume','membrane','crest','core'];rank=['low','mid','high']
for r in range(1,4):
 for cat,keys,rr in [('weapons',fs,r-1),('armor',slots,r+2),('materials',ms[:5+r],r+5)]:
  for j,k in enumerate(keys):
   id=f'weapon.{k}.venolka.r{r}' if cat=='weapons' else f'armor.{k}.venolka.r{r}' if cat=='armor' else f'mat.venolka.{k}.r{r}';atlas.alpha_composite(make(cat,k,r),(j*128,rr*128));idx[id]={'file':f'{cat}/{rank[r-1]}_{k}.webp','column':j,'row':rr}
atlas.save(P/'icon_atlas.webp',quality=87,method=4);(O/'icon_index.json').write_text(json.dumps(idx,indent=2));assert len(idx)==69;print('69 icons', (P/'icon_atlas.webp').stat().st_size)
