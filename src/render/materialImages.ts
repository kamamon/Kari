// 画像ベースの材質。既存の絵を貼った地形/岩/草は置き換えず、未使用箇所を埋める。
// カラー付きのモデルには、生成絵から作った明度正規化版を貼って二重の色掛けを抑える。
import { BufferGeometry, Float32BufferAttribute, MeshLambertMaterial, MeshStandardMaterial, MeshBasicMaterial, RepeatWrapping, type MeshLambertMaterialParameters } from 'three';
import { loadEnvTexture } from './envArt';
export const IMAGE_SURFACES=['wood','masonry','roof','bronze','cloth','earth','grass','cliff','bark','moss','plaster','bone','skin','fur','feather','scale','leaf','crystal','water'] as const;
export type ImageSurface=typeof IMAGE_SURFACES[number];
export const MATERIAL_DIR='assets/textures/materials/';
export type ImageOptions={raw?:boolean;gain?:number;bump?:number;animated?:boolean;replaceFallback?:boolean};
type Lit=MeshLambertMaterial|MeshStandardMaterial|MeshBasicMaterial;
export const imageFile=(kind:ImageSurface,raw=false):string=>kind==='water'||raw?kind:kind+'_detail';
/** Same cached decode as envArt. Each moving water surface gets its own texture offset.
 * In Node / while loading / on error, existing fallback is retained. UV is preserved through mergeStatic.
 */
export function bindSurfaceImage<M extends Lit>(mat:M,kind:ImageSurface,options:ImageOptions={}):M{
 const raw=!!options.raw||kind==='water',file=imageFile(kind,raw),base=mat.color.clone();
 mat.userData.uv=true;mat.userData.surfaceImage=kind;mat.userData.surfaceFile=MATERIAL_DIR+file+'.webp';mat.userData.surfaceReady=false;
 loadEnvTexture(file,t=>{t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=4;},t=>{
   const map=options.animated?t.clone():t;if(options.animated)map.needsUpdate=true;
   const old=mat.map;
   if(options.replaceFallback&&old&&old!==map)old.dispose();
   mat.map=map;mat.color.copy(base).multiplyScalar(options.gain??(raw?1:1.35));
   if(options.bump&&'bumpMap' in mat){
    if(mat.normalMap&&options.replaceFallback)mat.normalMap.dispose();
    if(mat.normalMap)mat.normalMap=null;
    mat.bumpMap=map;mat.bumpScale=options.bump;
   }
   mat.userData.surfaceReady=true;mat.needsUpdate=true;
 },MATERIAL_DIR);
 return mat;
}
export function imageLambert(kind:ImageSurface,params:MeshLambertMaterialParameters={},options:ImageOptions={}):MeshLambertMaterial{
 return bindSurfaceImage(new MeshLambertMaterial(params),kind,options);
}
/** Dominant normal projection for geometry lacking UVs or for world-size tiling. Non-indexed geometry is preferred for hard corners. */
export function projectSurfaceUV(g:BufferGeometry,tile=1):BufferGeometry{
 const p=g.getAttribute('position');if(!g.getAttribute('normal'))g.computeVertexNormals();const n=g.getAttribute('normal'),a=new Float32Array(p.count*2);
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));
  const top=ny>=nx&&ny>=nz;
  a[i*2]=(top?x:nx>=nz?z:x)/tile;a[i*2+1]=(top?-z:y)/tile;
 }
 g.setAttribute('uv',new Float32BufferAttribute(a,2));return g;
}
export function ensureSurfaceUV(g:BufferGeometry,tile=1):BufferGeometry{
 return g.getAttribute('uv')?g:projectSurfaceUV(g,tile);
}
