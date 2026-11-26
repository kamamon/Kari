// 「帰り道の灯—雷が帰る峰」の拠点側演出。未来章を遊べると偽らず、正本の実在依頼だけで進む。
import type {Content} from './schemas';
import type {StoryScene} from './story';
export type HubThreat=0|1|2|3;
type Clears=Readonly<Record<string,number>>;
const known=(c:Content,clears:Clears,id:string)=>c.quests.has(id)&&(clears[id]??0)>0;
export function hubThreat(c:Content,clears:Clears):HubThreat{
 // 正式な看板の戦闘個体と依頼が揃い、成功保存された場合だけ帰還報告。
 if(c.monsters.has('monster.orzelion')&&[...c.quests.values()].some(q=>q.targetMonsterId==='monster.orzelion'&&q.id==='quest.story.thunder_return'&&(clears[q.id]??0)>0))return 3;
 if(known(c,clears,'quest.basin.003')&&known(c,clears,'quest.selvark.r1'))return 2;
 if(known(c,clears,'quest.basin.003'))return 1;
 return 0;
}
const scenes:readonly StoryScene[]=[
 {id:'hub.thunder.rumor',title:'山から届く記録',place:'灯継ぎの里・依頼板',art:'event_story_first_delivery_v1',summary:'荷道の安全を確認。高地の雷と濡れの記録を、場所と時期を分けて調べる。',lines:[
  {who:'isane',text:'荷は通ったよ。高地の方では、いつもと違う雷を見たという話がある。'},
  {who:'rokuha',text:'焼けた筋と濡れた石は、同じ場所のものとは限らん。道具も確かめよう。'},
  {who:'minagi',text:'何が起きたかはまだ決めない。日付と場所を分けて記録するね。'}]},
 {id:'hub.thunder.watch',title:'消す灯、残す道',place:'灯継ぎの里・灯見の台',art:'event_story_limited_lights_v1',summary:'鉛雲高地の記録を受け、雷雲の間は見回りを増やす。旧道は閉じたまま。',lines:[
  {who:'senaki',text:'高地から雷の報告が続く。灯見の台で見張りを増やそう。旧道は閉じたままだ。'},
  {who:'minagi',text:'鳴天竜オルゼリオンの名は古い観測帳にある。でも今の水の変化まで、まだ結びつけられない。'},
  {who:'isane',text:'荷を分けて通すよ。人が帰れる道を先に残しておこう。'},
  {who:'rokuha',text:'留め具を確かめよう。灯は確認できた道へ集める。'},
  {who:'minagi',text:'高地の点検班が戻ったら、次に進むための記録をまとめるね。'}]},
 {id:'hub.thunder.return',title:'雷のあとにする仕事',place:'灯継ぎの里・帰還報告',art:'event_story_homecoming_v1',summary:'決戦の成功を保存した。高地の点検路の安全確認を作業班へ引き継ぐ。',lines:[
  {who:'senaki',text:'無事に戻ったな。高地の点検へ入れるか、まず人と道の安全を確かめる。'},
  {who:'rokuha',text:'短い部材なら、後から確かめて交換できる。直す仕事はここからだ。'},
  {who:'isane',text:'帰れる道を一つずつつないでいこう。荷を通す準備をしておくよ。'},
  {who:'minagi',text:'今回の成功を記録した。まだ分からない所も残そう。次の人が同じ所から調べられるように。'}]}
];
export const hubStoryScene=(id:string):StoryScene|undefined=>scenes.find(s=>s.id===id);
export function hubReports(c:Content,clears:Clears):StoryScene[]{return scenes.slice(0,hubThreat(c,clears));}
export function newHubReports(c:Content,before:Clears,after:Clears):string[]{
 const old=new Set(hubReports(c,before).map(s=>s.id));
 return hubReports(c,after).filter(s=>!old.has(s.id)).map(s=>s.id);
}
