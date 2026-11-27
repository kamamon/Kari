"""Reference-assisted pigment projection onto actual skinned mesh; no geometry or keyframes changed."""
from pathlib import Path
import numpy as np,json,struct
from PIL import Image
from scipy.ndimage import map_coordinates,gaussian_filter
P=Path(__file__).parent
ref=np.asarray(Image.open(P/'reference.webp').convert('RGB'),dtype=np.float32)/255
# Coordinates are in the supplied 1408x1056 adopted reference D; account for original image dimensions.
H,W=ref.shape[:2]
print('reference shape',ref.shape,flush=True)
raw=bytearray((P/'spinegale_v3_game_raw.glb').read_bytes());jl=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+jl]);start=28+jl;dt={5126:'<f4',5123:'<u2',5125:'<u4'};cs={'VEC2':2,'VEC3':3,'VEC4':4,'SCALAR':1}
def A(i):
 a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];return np.frombuffer(raw,dtype=dt[a['componentType']],count=cs[a['type']]*a['count'],offset=start+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,cs[a['type']])
def linear(c):return np.where(c<=.04045,c/12.92,((c+.055)/1.055)**2.4)
def srgb(c):return np.where(c<=.0031308,12.92*c,1.055*np.maximum(c,0)**(1/2.4)-.055)
def sample(x,y):
 x=np.clip(x,0,1407)*W/1408;y=np.clip(y,0,1055)*H/1056;return np.stack([map_coordinates(ref[:,:,i],np.array([y,x]),order=1,mode='nearest') for i in range(3)],1)
def poly_map(yz,m,a,bw):
 # Find closest point on model centerline, map signed transverse displacement onto corresponding reference centerline.
 best=np.full(len(yz),1e9);ox=np.zeros(len(yz));oy=np.zeros(len(yz))
 for i in range(len(m)-1):
  u=m[i+1]-m[i];t=np.clip(((yz-m[i])*u).sum(1)/(u@u),0,1);p=m[i]+t[:,None]*u;v=yz-p;err=(v*v).sum(1);hit=err<best;best[hit]=err[hit];l=np.linalg.norm(u);vmod=np.array([-u[1],u[0]])/l;perp=v@vmod
  ap=a[i]+t[:,None]*(a[i+1]-a[i]);apdir=a[i+1]-a[i];apdir=apdir/np.linalg.norm(apdir);apnorm=np.array([-apdir[1],apdir[0]]);width=bw[i][0]+(bw[i+1][0]-bw[i][0])*t;pix=bw[i][1]+(bw[i+1][1]-bw[i][1])*t;ap+=apnorm*(np.clip(perp/(width+1e-6),-.86,.86)*pix)[:,None];ox[hit]=ap[hit,0];oy[hit]=ap[hit,1]
 return ox,oy
j_names=[x['name'] for x in d['nodes'][:77]]
for pr in d['meshes'][0]['primitives']:
 mat=d['materials'][pr['material']]['name'];at=pr['attributes'];p=A(at['POSITION']);n=A(at['NORMAL']);j=A(at['JOINTS_0']);w=A(at['WEIGHTS_0']);c=A(at['COLOR_0']);dom=j[np.arange(len(j)),w.argmax(1)];x,y,z=p.T;side=np.clip((np.abs(n[:,0])-.18)/.70,0,1);rgb=srgb(c);changed=0
 if mat=='hide':
  # Smoothly match source anatomical landmarks along side profile. Height radius mapped to inside body silhouette.
  ids=[k for k,name in enumerate(j_names) if name.startswith('tail_') or name in ['pelvis','body','lumbar','chest','neck_01','neck_02','head','jaw','snout','ribs_l','ribs_r','dorsal_01','dorsal_02','dorsal_03','dorsal_04','lid_l','lid_r']]
  mask=np.isin(dom,ids)
  # z (tail->nose), y of model center, radius, source x, source y, half height at center
  ctrl=np.array([[-3.50,1.32,.026,1022,318,12],[-2.95,1.37,.055,910,322,16],[-2.35,1.43,.09,820,315,18],[-1.75,1.44,.12,736,301,29],[-1.10,1.43,.17,666,308,34],[-.65,1.4,.23,617,320,52],[-.35,1.41,.30,566,331,67],[-.02,1.43,.35,512,337,61],[.34,1.48,.33,449,342,51],[.60,1.57,.23,388,358,33],[.78,1.70,.19,347,340,35],[.97,1.85,.15,303,290,31],[1.18,1.88,.15,252,249,25],[1.36,1.85,.12,213,249,21],[1.6,1.79,.06,139,258,12],[1.79,1.73,.025,91,271,6]])
  xx=np.interp(z[mask],ctrl[:,0],ctrl[:,3]);yc=np.interp(z[mask],ctrl[:,0],ctrl[:,1]);rad=np.interp(z[mask],ctrl[:,0],ctrl[:,2]);yy=np.interp(z[mask],ctrl[:,0],ctrl[:,4])-np.clip((y[mask]-yc)/rad,-.84,.84)*np.interp(z[mask],ctrl[:,0],ctrl[:,5]);samp=sample(xx,yy);good=(samp.min(1)<.64)|(samp.max(1)-samp.min(1)>.16);alpha=(.80*side[mask]*good)[:,None];rgb[mask]=(1-alpha)*rgb[mask]+alpha*np.clip(samp*1.08,0,1);changed+=int(good.sum())
  for region,model,art,width in [
   ('hind',[[1.42,-.29],[1.24,-.31],[1.02,-.17],[.79,.065],[.59,-.16],[.41,-.42],[.26,-.23],[.13,-.05]],[[552,316],[557,340],[552,377],[584,416],[654,449],[723,482],[745,530],[716,572]],[[.15,38],[.23,45],[.19,38],[.12,26],[.10,17],[.07,15],[.06,12],[.075,14]]),
   ('fore',[[1.50,.42],[1.40,.38],[1.22,.27],[1.08,.55],[1.02,.64],[.91,.73]],[[420,352],[423,386],[406,428],[376,461],[369,493],[380,520]],[[.10,22],[.10,20],[.07,15],[.05,11],[.06,14],[.02,6]])]:
   ids=[k for k,name in enumerate(j_names) if name.startswith(('hind_','hock_','metatarsus_','toe_'))] if region=='hind' else [k for k,name in enumerate(j_names) if name.startswith(('fore_','wrist_','palm_','digit_'))];mask=np.isin(dom,ids);xx,yy=poly_map(p[mask][:,[1,2]],np.asarray(model),np.asarray(art),np.asarray(width));samp=sample(xx,yy);good=(samp.min(1)<.62)|(samp.max(1)-samp.min(1)>.15);alpha=(.64*side[mask]*good)[:,None];rgb[mask]=(1-alpha)*rgb[mask]+alpha*np.clip(samp*1.08,0,1);changed+=int(good.sum())
  c[:]=linear(np.clip(rgb,0,1));print('hide projected samples',changed,flush=True)
 elif mat=='feather':
  ids=[k for k,name in enumerate(j_names) if name.startswith('fan_')];mask=np.isin(dom,ids);xx=np.interp(z[mask],[-4.56,-3.22],[1378,1020]);yy=318-(y[mask]-1.34)*170;sp=sample(xx,yy);good=(sp.min(1)<.65)|(sp.max(1)-sp.min(1)>.18);alpha=(.77*good)[:,None];rgb[mask]=(1-alpha)*rgb[mask]+alpha*np.clip(sp*1.08,0,1);c[:]=linear(np.clip(rgb,0,1));print('fan projected',int(good.sum()),flush=True)
# Change JSON metadata safely by rebuilding chunks. Geometry + skin/keyframes remain byte-identical.
d['asset']['generator']='Kari Spinegale V3.2 reference-assisted pigment';d['extras']['status']='high density reference-assisted sculpt; photoreal parity not established';d['extras']['referencePigment']='Adopted concept D, lateral anatomical landmarks; manual approximation, not a scan.'
j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);buf=memoryview(raw)[start:];out=P/'spinegale_v3_game.glb';
with out.open('wb') as f:f.write(struct.pack('<4sII',b'glTF',2,28+len(j)+len(buf)));f.write(struct.pack('<I4s',len(j),b'JSON'));f.write(j);f.write(struct.pack('<I4s',len(buf),b'BIN\0'));f.write(buf)
print(out.name,out.stat().st_size,flush=True)
