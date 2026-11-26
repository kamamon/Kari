// 拠点の採集場を軽量な立体で表示。既存の畑と沢を使い、判定や地形は増やさない。
import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, RingGeometry, DoubleSide } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
import { HUB_RESOURCE_POINTS } from '../game/hubResources';
import { imageLambert,projectSurfaceUV,type ImageSurface } from './materialImages';
const COLOR={plant:0x86b563,mine:0x78bdd1,fish:0x70d8ce,insect:0xe5ba63,bone:0xe1d2b2};
export function buildHubResourceProps(map:MapDef):Group {
  const group=new Group();group.name='hub-resource-points';
  const solid:BufferGeometry[]=[], markers:BufferGeometry[]=[];
  const surface=(color:number):ImageSurface=>color===0x827e70||color===0x575d59?'cliff':color===0x8eab9c?'crystal':color===0x829849||color===0x4c713f?'leaf':color===0xdac16c?'scale':color===0xd6c8aa?'bone':color===0x64513b?'bark':'wood';
  const put=(g:BufferGeometry,color:number,x:number,y:number,z:number,dst=solid)=>{
    const geo=g.index?g.toNonIndexed():g; if(geo!==g)g.dispose();
    geo.translate(x,y,z);projectSurfaceUV(geo,.55);if(dst===solid)geo.userData.imageSurface=surface(color);
    const c=new Color(color),a=new Float32Array(geo.getAttribute('position').count*3);
    for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);
    geo.setAttribute('color',new Float32BufferAttribute(a,3));dst.push(geo);
  };
  for(const p of HUB_RESOURCE_POINTS){
    const {x,z}=p,y=groundAt(map.platforms,x,z);
    const ring=new RingGeometry(.60,.72,16);ring.rotateX(-Math.PI/2);
    put(ring,COLOR[p.kind],x,y+.035,z,markers);
    // 道を塞がないよう、採取目印の脇に小物を置く。
    if(p.id==='farm'){
      // 既存の畑の手前、種籠と木札。
      put(new BoxGeometry(.65,.43,.55),0x796343,x+.85,y+.23,z+.35);
      put(new BoxGeometry(.09,.80,.09),0x684b32,x+.90,y+.4,z-.4);
      put(new BoxGeometry(.55,.30,.10),0xa4875d,x+.90,y+.72,z-.4);
    }else if(p.kind==='mine'){
      for(let i=0;i<4;i++){
        const rock=new IcosahedronGeometry(.45+i%2*.13,0);rock.scale(1.1,.72,1);
        put(rock,i%2?0x827e70:0x575d59,x-1.05+Math.cos(i*2.4)*.42,y+.25,z+Math.sin(i*2.4)*.4);
      }
      for(let i=0;i<3;i++)put(new ConeGeometry(.14,.36+i*.08,5),0x8eab9c,x-1.34+i*.26,y+.54,z);
    }else if(p.kind==='fish'){
      // 沢へは降りず岸から釣る。低い腰掛け、竿置き、波紋。
      put(new BoxGeometry(.76,.12,.44),0x725538,x+.65,y+.35,z+.55);
      for(let s of [-1,1])put(new BoxGeometry(.12,.35,.12),0x49392d,x+.65+s*.27,y+.175,z+.55);
      const rod=new CylinderGeometry(.026,.04,1.65,6);rod.rotateZ(.72);
      put(rod,0xa48963,x-.63,y+.77,z+.65);
      const ripple=new RingGeometry(.27,.31,20);ripple.rotateX(-Math.PI/2);
      const waterY=groundAt(map.platforms,-44,z);
      put(ripple,0x96c8c4,-44,waterY+.04,z,markers);
    }else if(p.kind==='insect'){
      const log=new CylinderGeometry(.23,.26,.94,7);log.rotateZ(Math.PI/2);
      put(log,0x64513b,x+.90,y+.24,z+.36);
      for(let i=0;i<5;i++)put(new IcosahedronGeometry(.2,0),i%2?0x829849:0x4c713f,x+.6+i*.15,y+.38,z+.38+Math.sin(i)*.2);
      for(let i=0;i<3;i++)put(new IcosahedronGeometry(.11,0),0xdac16c,x+.7+i*.17,y+.73+i*.06,z+.39);
    }else{
      for(let i=0;i<3;i++){
        const g=new CylinderGeometry(.064,.08,.56,6);g.rotateZ(Math.PI/2);g.rotateY(i*.65);
        put(g,0xd6c8aa,x+.65+i*.23,y+.13,z+.7);
      }
    }
  }
  if(solid.length){const objects=new Group();objects.name='resource-objects';
    for(const kind of ['cliff','crystal','leaf','scale','bone','bark','wood'] as const){const geos=solid.filter(g=>g.userData.imageSurface===kind);if(!geos.length)continue;const m=new Mesh(mergeGeometries(geos)!,imageLambert(kind,{vertexColors:true,flatShading:true}));m.name='resource-'+kind;m.userData.noMerge=true;objects.add(m);}group.add(objects);}
  if(markers.length){const m=new Mesh(mergeGeometries(markers)!,new MeshBasicMaterial({vertexColors:true,side:DoubleSide}));m.name='resource-markers';m.userData.noMerge=true;group.add(m);}
  for(const g of [...solid,...markers])g.dispose();
  return group;
}
