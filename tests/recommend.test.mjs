import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recommend,pickRandomDrink,randomRecommendations} from '../server/catalog.mjs';
const drinks=[{id:'a',name:'A',category:'纯茶',price:10,flavor_tags:['清爽']},{id:'b',name:'B',category:'奶茶',price:20,flavor_tags:['奶香']}];
test('budget and category constraints are respected',()=>{assert.deepEqual(recommend(drinks,[],{}, {budget:9}),[]);assert.equal(recommend(drinks,[],{},{category:'纯茶'})[0].id,'a');});
test('historical ratings influence suggestions',()=>{assert.equal(recommend(drinks,[{drink_id:'b',rating:5,consumed_at:'2020-01-01'}],{})[0].id,'b');});
test('recent drinks receive a penalty and exploration favors new ones',()=>{assert.equal(recommend(drinks,[{drink_id:'a',rating:3,consumed_at:new Date()}],{},{novel:true})[0].id,'b');});
test('matched preferences improve ranking',()=>{assert.equal(recommend(drinks,[],{preferred_flavors:['奶香']})[0].id,'b');});
test('unknown prices require opt-in and brand filtering is respected',()=>{
 const menu=[{id:'unknown',name:'未知价格',brand_name:'品牌甲',category:'咖啡',price:null,flavor_tags:[]},{id:'known',name:'已知价格',brand_name:'品牌乙',category:'咖啡',price:10,flavor_tags:[]}];
 assert.deepEqual(recommend(menu,[],{},{budget:0}),[]);
 const result=recommend(menu,[],{},{brand:'品牌甲',budget:0,includeUnknown:true});
 assert.equal(result.length,1);assert.equal(result[0].id,'unknown');assert.match(result[0].reason,/价格待确认/);
 assert.deepEqual(recommend(menu,[],{},{brand:'品牌乙',budget:0,includeUnknown:true}),[]);
});

test('random selection uses the full eligible menu and avoids the previous pick',()=>{
 const menu=Array.from({length:10},(_,i)=>({id:String(i),name:String(i),brand_name:'甲',category:'纯茶',price:10,ingredients:[]}));
 const first=pickRandomDrink(menu,[],{},{brand:'甲',budget:10},()=>0.999);
 assert.equal(first.candidate_count,10);assert.equal(first.drink.id,'9');
 const next=pickRandomDrink(menu,[],{},{excludeId:'9'},()=>0.999);assert.equal(next.drink.id,'8');
 assert.equal(pickRandomDrink([menu[0]],[],{},{excludeId:'0'}).drink.id,'0');
});
test('random selection respects unknown prices, filters, ingredients, and exploration',()=>{
 const menu=[{id:'a',name:'A',brand_name:'甲',category:'茶',price:null,reference_price:1,ingredients:[]},
  {id:'b',name:'B',brand_name:'甲',category:'茶',price:10,ingredients:[]},
  {id:'c',name:'C',brand_name:'乙',category:'茶',price:10,ingredients:['花生']},
  {id:'old',name:'old',price:0,status:'inactive'}];
 assert.deepEqual(pickRandomDrink(menu,[],{},{budget:0}),{drink:null,candidate_count:0});
 assert.equal(pickRandomDrink(menu,[],{},{budget:0,includeUnknown:true}).drink.id,'a');
 assert.equal(pickRandomDrink(menu,[],{},{brand:'乙',category:'茶'}).drink.id,'c');
 assert.equal(pickRandomDrink(menu,[],{avoided_ingredients:['花生']},{brand:'乙'}).drink,null);
 assert.equal(pickRandomDrink(menu,[{drink_id:'b'}],{},{brand:'甲',includeUnknown:true,novel:true},()=>0.999).drink.id,'a');
 assert.equal(pickRandomDrink(menu,[{drink_id:'a'},{drink_id:'b'}],{},{brand:'甲',includeUnknown:true,novel:true},()=>0).candidate_count,2);
});

test('random recommendations refresh three cards from the full menu without repeats',()=>{
 const menu=Array.from({length:12},(_,i)=>({id:String(i),name:String(i),price:10,ingredients:[],brand_name:'甲',category:'纯茶'}));
 const first=randomRecommendations(menu,[],{},{},()=>0);
 assert.equal(first.length,3);assert.equal(new Set(first.map(d=>d.id)).size,3);
 const next=randomRecommendations(menu,[],{},{excludeIds:first.map(d=>d.id)},()=>0);
 assert.equal(next.length,3);assert.ok(next.every(d=>!first.some(p=>p.id===d.id)));
 assert.deepEqual(randomRecommendations(menu,[],{},{budget:0}),[]);
 assert.equal(randomRecommendations(menu.slice(0,2),[],{},{excludeIds:['0','1']},()=>0).length,2);
 assert.deepEqual(randomRecommendations(menu,[],{},{brand:'不存在'}),[]);
});
