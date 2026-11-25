"""Render exported CPU mesh/rig geometry for documentation. This is not a WebGL screenshot."""
import json, math, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(size): return ImageFont.truetype(FONT,size,index=0)
EDGES=[('pelvis','spine'),('spine','chest'),('chest','neck'),('neck','head')]
for side in ['L','R']:
    EDGES += [('chest','upperArm'+side),('upperArm'+side,'forearm'+side),('forearm'+side,'hand'+side),('pelvis','thigh'+side),('thigh'+side,'shin'+side),('shin'+side,'foot'+side)]

def render(snap,w=480,h=560,yaw=-.65,pitch=.16,bones=True):
    ss=2; im=Image.new('RGB',(w*ss,h*ss),'#eff3f1'); d=ImageDraw.Draw(im)
    def project(a):
        a=np.asarray(a,dtype=float)
        x=np.cos(yaw)*a[...,0]-np.sin(yaw)*a[...,2]
        z=np.sin(yaw)*a[...,0]+np.cos(yaw)*a[...,2]
        y=np.cos(pitch)*(a[...,1]-.94)-np.sin(pitch)*z
        depth=np.cos(pitch)*z+np.sin(pitch)*a[...,1]
        return np.stack((x,y,depth),axis=-1)
    pts=np.concatenate([np.array(m['points']) for m in snap['meshes']])
    pr=project(pts); pxmin,pxmax=pr[:,0].min(),pr[:,0].max(); pymin,pymax=pr[:,1].min(),pr[:,1].max()
    sc=min((w-36)/max(2.8,pxmax-pxmin),(h-62)/max(2.25,pymax-pymin)); ox=w/2-(pxmax+pxmin)/2*sc; oy=h/2+(pymax+pymin)/2*sc
    def xy(p): return ((ox+p[0]*sc)*ss,(oy-p[1]*sc)*ss)
    for g in np.arange(-2.5,3,.5):
        for aa,bb in [([g,0,-2.5],[g,0,2.5]),([-2.5,0,g],[2.5,0,g])]:d.line([xy(project(aa)),xy(project(bb))],fill='#d5dfd9',width=ss)
    faces=[]; light=np.array([-.45,.85,.5]);light=light/np.linalg.norm(light)
    for m in snap['meshes']:
        p=np.array(m['points']); ps=project(p)
        idx=np.array(m['index'] if m['index'] is not None else np.arange(len(p)),dtype=int).reshape(-1,3)
        tri=p[idx]; normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]); normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-8)
        sh=np.clip(.45+.5*np.abs(normals@light),.24,.95)
        base=np.array([177,155,119] if m['name']=='hunter_body' else [119,143,149])
        for ids,shade in zip(idx,sh):
            faces.append((float(ps[ids,2].mean()),[xy(q) for q in ps[ids]],tuple((base*shade).astype(int))))
    for _,p,c in sorted(faces,key=lambda f:f[0]):d.polygon(p,fill=c)
    if bones:
        jp={k:xy(project(v)) for k,v in snap['joints'].items()}
        for a,b in EDGES:d.line([jp[a],jp[b]],fill='#20a6a0',width=3*ss)
        for x,y in jp.values():d.ellipse((x-3*ss,y-3*ss,x+3*ss,y+3*ss),fill='#e6fff7',outline='#177b75',width=ss)
    d.text((14*ss,12*ss),snap['name'],font=font(13*ss),fill='#344a43')
    d.text((14*ss,(h-28)*ss),'CPU形状図 / テクスチャ省略',font=font(12*ss),fill='#52665d')
    return im.resize((w,h),Image.Resampling.LANCZOS)

def main():
    source=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
    data=json.loads(source.read_text()); sn={s['name']:s for s in data['snapshots']}
    for name,s in sn.items():render(s).save(out/(name+'.png'))
    names=['heavy_sweep_34','guard_blade','long_lance','ring_bow','war_maul','twin_blades','long_blade']
    board=Image.new('RGB',(4*350,2*435+80),'#ffffff');draw=ImageDraw.Draw(board)
    draw.text((24,18),'現行ソースの骨格と形状（CPU計算・テクスチャ省略）',font=font(27),fill='#193a32')
    for i,n in enumerate(names):board.paste(render(sn[n],350,435),((i%4)*350,80+(i//4)*435))
    board.save(out/'seven-weapons.png')
    gait=Image.new('RGB',(4*350,460),'#ffffff')
    for i in range(4):gait.paste(render(sn['gait_'+str(i)],350,460),(i*350,0))
    gait.save(out/'gait-phases.png')
    print(json.dumps({'out':str(out),'images':len(sn)+2}))

if __name__=='__main__':main()
