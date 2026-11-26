import {describe,expect,it} from 'vitest';
import {individualScale,scalePoint,isAirborneAction} from '../src/game/individual';
describe('個体差と滑翔の接地',()=>{
it('狩猟seedで0.92～1.12倍、同じseedでは同じ値',()=>{const a=Array.from({length:300},(_,i)=>individualScale(i,'monster.galdros'));expect(a.every(n=>n>=.92&&n<=1.12)).toBe(true);expect(new Set(a).size).toBeGreaterThan(5);expect(individualScale(123,'monster.galdros')).toBe(a[123])});
it('部位・技の座標は個体の中心を基準に拡縮',()=>{expect(scalePoint({x:2,y:3,z:4},{x:1,y:1,z:1},2)).toEqual({x:3,y:5,z:7})});
it('空中の技は着地まで罠が効かない区間がある',()=>{expect(isAirborneAction('monster.ashreia.glide',39)).toBe(false);expect(isAirborneAction('monster.ashreia.glide',40)).toBe(true);expect(isAirborneAction('monster.ashreia.glide',68)).toBe(false);expect(isAirborneAction('monster.galdros.roar',50)).toBe(false)});
});
