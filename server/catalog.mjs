function eligibleDrinks(drinks,prefs,{category='',brand='',budget=100,includeUnknown=false}={}){
 return drinks.filter(d=>d.status!=='inactive'&&(!category||d.category===category)&&(!brand||d.brand_name===brand)&&(d.price==null?includeUnknown:Number(d.price)<=budget)&&!(prefs.avoided_ingredients||[]).some(x=>(d.ingredients||[]).includes(x)));
}

export function randomRecommendations(drinks,records,prefs,options={},random=Math.random){
 let candidates=eligibleDrinks(drinks,prefs,options);
 if(options.novel){
  const consumed=new Set(records.map(r=>r.drink_id)),unseen=candidates.filter(d=>!consumed.has(d.id));
  if(unseen.length)candidates=unseen;
 }
 const excluded=new Set(options.excludeIds||[]);
 const shuffle=items=>{
  const result=[...items];
  for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
 };
 return [...shuffle(candidates.filter(d=>!excluded.has(d.id))),...shuffle(candidates.filter(d=>excluded.has(d.id)))].slice(0,3)
  .map(d=>({...d,reason:d.price==null?'随机推荐 · 价格待确认':'随机推荐 · 符合当前筛选条件'}));
}

export function pickRandomDrink(drinks,records,prefs,options={},random=Math.random){
 let candidates=eligibleDrinks(drinks,prefs,options);
 if(options.novel){
  const consumed=new Set(records.map(r=>r.drink_id));
  const unseen=candidates.filter(d=>!consumed.has(d.id));
  if(unseen.length)candidates=unseen;
 }
 const count=candidates.length;
 if(count>1)candidates=candidates.filter(d=>d.id!==options.excludeId);
 const picked=candidates.length?candidates[Math.floor(random()*candidates.length)]:null;
 return {drink:picked?{...picked,reason:picked.price==null?'随机选中这一杯 · 价格待确认':'随机选中这一杯'}:null,candidate_count:count};
}

export function recommend(drinks,records,prefs,options={}) {
 const {novel=false}=options;
 return eligibleDrinks(drinks,prefs,options)
 .map(d=>{
  const history=records.filter(r=>r.drink_id===d.id), rated=history.filter(r=>r.rating);
  const average=rated.length?rated.reduce((s,r)=>s+r.rating,0)/rated.length:0;
  const liked=(prefs.preferred_categories||[]).includes(d.category)||(prefs.preferred_flavors||[]).some(t=>d.flavor_tags.includes(t));
  const recent=history.some(r=>Date.now()-new Date(r.consumed_at).getTime()<3*86400000);
  return {...d,score:(liked?3:0)+average-(recent?3:0)+(novel&&!history.length?4:0),reason:d.price==null?'价格待确认，请以门店点单页为准':novel&&!history.length?'还没喝过，给味蕾一点新鲜感':average>=4?'你之前给过高分':liked?'符合你喜欢的口味':recent?'最近喝过，偶尔重温也不错':'预算内的轻松选择'};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'zh')).slice(0,3);
}
