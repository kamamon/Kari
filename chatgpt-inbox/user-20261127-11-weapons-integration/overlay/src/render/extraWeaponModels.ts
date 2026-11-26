// Original provisional game props. Coordinate: grip at origin, weapon +Y along the attack track.
import {BoxGeometry,CylinderGeometry,ConeGeometry,IcosahedronGeometry,Group,Mesh,MeshLambertMaterial, type BufferGeometry} from 'three';
import type {WeaponModel} from './heavyBlade';
const steel=0x7d9097, dark=0x303b41, bronze=0xc29353, leather=0x64432d, gem=0x85bec0;
function make(name:string, build:(box:(x:number,y:number,z:number,w:number,h:number,d:number,c:number)=>void,cyl:(x:number,y:number,z:number,r1:number,r2:number,h:number,c:number,segments?:number)=>void,crystal:(x:number,y:number,z:number,r:number,sx:number,sy:number,sz:number,c:number)=>void)=>void):WeaponModel {
 const group=new Group(); group.name=name;let triangles=0;
 const add=(g:BufferGeometry,x:number,y:number,z:number,c:number)=>{
  const m=new Mesh(g,new MeshLambertMaterial({color:c,flatShading:true}));m.position.set(x,y,z);m.castShadow=true;group.add(m);
  triangles+=(g.index?.count??g.attributes.position!.count)/3;
  return m;
 };
 build((x,y,z,w,h,d,c)=>{add(new BoxGeometry(w,h,d),x,y,z,c);},
 (x,y,z,r1,r2,h,c,n=10)=>{add(new CylinderGeometry(r1,r2,h,n),x,y,z,c);},
 (x,y,z,r,sx,sy,sz,c)=>{const m=add(new IcosahedronGeometry(r,0),x,y,z,c);m.scale.set(sx,sy,sz);});
 return {group,art:[],triangles};
}
export const buildHuntingHorn=()=>make('hunting_horn',(box,cyl,crystal)=>{
 cyl(0,.31,0,.038,.045,.98,leather);cyl(0,-.19,0,.059,.05,.13,bronze);
 for(const y of [.04,.25,.48,.73])cyl(0,y,0,.052,.052,.045,bronze);
 cyl(0,.91,0,.115,.066,.22,steel,8);cyl(0,1.12,0,.23,.14,.30,dark,12);
 for(let i=0;i<6;i++){const a=i*Math.PI/3;box(.18*Math.cos(a),1.11,.18*Math.sin(a),.065,.29,.065,bronze);}
 cyl(0,1.26,0,.23,.19,.10,bronze,12);cyl(0,1.32,0,.19,.19,.025,dark,12);
 crystal(0,1.08,-.23,.14,.6,1,.6,gem);box(.075,.54,0,.075,.2,.07,steel);
});
export const buildGunlance=()=>make('gunlance',(box,cyl,crystal)=>{
 cyl(0,.32,0,.053,.055,1.22,leather);cyl(0,-.27,0,.065,.05,.16,bronze);
 box(0,.96,0,.23,.68,.22,dark);cyl(0,1.32,0,.085,.12,.68,steel,12);
 for(const z of [-.12,.12]){box(0,1.03,z,.18,.35,.025,bronze);crystal(0,1.02,z*1.2,.09,1,1,.45,gem);}
 cyl(0,1.83,0,.075,.09,.55,steel);cyl(0,2.08,0,.095,.095,.075,bronze);
 box(0,2.11,-.10,.095,.36,.07,steel);crystal(0,2.27,-.08,.15,.34,1.0,.4,steel);
});
function gun(heavy:boolean):WeaponModel{return make(heavy?'heavy_bowgun':'light_bowgun',(box,cyl,crystal)=>{
 const w=heavy?.22:.16, len=heavy?1.05:.78;
 box(0,.16,0,w,.48,w*.85,dark);box(0,-.17,.035,w*.73,.28,w*.8,leather);box(0,.02,.07,w*.5,.15,.11,leather);
 cyl(0,.50,0,w*.40,w*.46,len-.48,steel,12);cyl(0,len-.035,0,w*.5,w*.4,.07,bronze);
 for(const y of [.18,.34])box(0,y,w*.5,w,.06,.035,bronze);
 box(0,.26,-w*.6,w*.75,.18,.09,leather);box(0,-.18,-.09,w*.8,.23,.055,steel);
 crystal(w*.57,.18,0,.075,.38,1.3,.6,gem);
 if(heavy){box(.15,.29,0,.14,.52,.19,steel);box(-.15,.29,0,.14,.52,.19,steel);}
 else {box(.10,.22,0,.07,.20,.09,bronze);}
 });}
export const buildLightBowgun=()=>gun(false);
export const buildHeavyBowgun=()=>gun(true);
