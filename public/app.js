import {groupDrinksByBrand,findDrinkSelection,browseDrinks} from './drink-menu.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
let state,rec=[],currentTab='today',toastTimer,editingId=null,brandMenu=new Map(),recordBrandMenu=new Map(),catalogLimit=24,recommendationMode='personalized',currentUser=null,csrfToken='',authMode='login',loadRequest=0,adminPage=1,adminRequest=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,method='GET',data){
 const writes=!['GET','HEAD'].includes(method),headers=writes?{'Content-Type':'application/json','X-Heleme-Request':'1'}:{};
 if(writes&&csrfToken)headers['X-CSRF-Token']=csrfToken;
 const r=await fetch('/api/'+path,{method,credentials:'same-origin',headers,body:writes?JSON.stringify(data??{}):undefined});
 const j=await r.json();
 if(!r.ok){if(r.status===401&&currentUser)clearPrivateState();throw Object.assign(Error(j.error||'请求失败'),{status:r.status});}
 return j;
}
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,2800);}
function error(e){$('#error').textContent=e.message||'连接失败，请稍后再试';$('#error').hidden=false;}
async function run(fn){try{$('#error').hidden=true;await fn();}catch(e){error(e);}}
for(const s of $$('.sweetness'))s.innerHTML=['无糖','微糖','三分糖','半糖','七分糖','全糖'].map((x,i)=>`<option value="${i}">${x}</option>`).join('');
for(const s of $$('.ice'))s.innerHTML=Object.entries({regular:'正常冰',less:'少冰',none:'去冰',room:'常温',warm:'温',hot:'热'}).map(([v,t])=>`<option value="${v}">${t}</option>`).join('');
function choice(container,values,name,selected){$(container).innerHTML=values.map(v=>`<label class="choice"><input type="checkbox" name="${esc(name)}" value="${esc(v)}" ${selected.includes(v)?'checked':''}>${esc(v)}</label>`).join('');}
function renderPrefs(){const p=state.preferences,f=$('#preferences');choice('#category-choices',[...new Set([...state.drinks.map(d=>d.category),...p.preferred_categories])].sort((a,b)=>a.localeCompare(b,'zh')),'preferred_categories',p.preferred_categories);choice('#flavor-choices',['花香','果香','奶香','清爽','浓郁','茶味浓','酸甜','咖啡香'],'preferred_flavors',p.preferred_flavors);f.elements.default_sweetness_level.value=p.default_sweetness_level??2;f.elements.default_ice_level.value=p.default_ice_level||'less';f.elements.budget_max.value=p.budget_max??25;f.elements.avoided_ingredients.value=p.avoided_ingredients.join('，');}
function card(d){const saved=state.favorites.includes(d.id),color=state.drinks.findIndex(x=>x.id===d.id)%8;return `<article class="card"><div class="drink-art color-${color}"><div class="mini-cup">喝了么</div><button class="heart" data-favorite="${esc(d.id)}" aria-label="${saved?'取消收藏':'收藏'}${esc(d.name)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div><div class="card-body"><div class="brand-small">${esc(d.brand_name)}</div><div class="card-title"><h3>${esc(d.name)}</h3><span class="price">${d.price!=null?'¥'+esc(d.price):d.reference_price!=null?'参考 ¥'+esc(d.reference_price):'价格待确认'}</span></div><div class="tags">${d.flavor_tags.length?d.flavor_tags.map(esc).join(' · '):esc(d.category)}</div><div class="reason">✦ ${esc(d.reason||(d.status==='inactive'?'已移出当前菜单':d.reference_price!=null?'第三方参考价 · 成都门店价待核验':d.source_region||'收藏的好味道，随时再来一杯'))}</div>${d.source_url?`<p class="menu-source"><a href="${esc(d.source_url)}" target="_blank" rel="noopener noreferrer">菜单来源 ↗</a> · ${esc(new Date(d.source_checked_at).toLocaleDateString('zh-CN'))}采集</p>`:''}${d.status==='inactive'?'<p class="muted">已移出菜单，收藏和历史保留</p>':`<button class="record-button" data-record="${esc(d.id)}">就喝这杯 ＋</button>`}</div></article>`;}
function renderCards(){$('#recommendations').innerHTML=rec.length?rec.map(card).join(''):'<div class="empty">当前推荐条件下没有候选，试试调整品牌、品类或预算，或勾选“包含价格待确认”。下方仍可浏览完整菜单。</div>';const f=[...state.drinks,...(state.archived_drinks||[])].filter(d=>state.favorites.includes(d.id));$('#favorites').innerHTML=f.length?f.map(card).join(''):'<div class="empty">点击饮料旁的 ♡，收集你的喜欢。</div>';}
function renderHistory(){const q=$('#search').value.trim(),rating=Number($('#rating-filter').value),all=state.records,rows=all.filter(r=>(r.drink_name_snapshot+r.brand_name_snapshot).includes(q)&&(!rating||r.rating>=rating));const rated=all.filter(r=>r.rating),avg=rated.length?(rated.reduce((s,r)=>s+r.rating,0)/rated.length).toFixed(1):'—';$('#stats').innerHTML=`<div class="stat">喝过的杯数<strong>${all.length}</strong></div><div class="stat">平均满意度<strong>${avg}</strong></div><div class="stat">收藏的味道<strong>${state.favorites.length}</strong></div>`;$('#records').innerHTML=rows.length?rows.map(r=>`<article class="record-row"><div><div class="brand-small">${esc(r.brand_name_snapshot)} · ${esc(new Date(r.consumed_at).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</div><h3>${esc(r.drink_name_snapshot)}</h3><p>${esc(r.sweetness_label||'甜度未填')} · ${esc(r.ice_label||'冰量未填')} ${r.price_paid==null?'':'· ¥'+esc(r.price_paid)}</p>${r.note?`<p>${esc(r.note)}</p>`:''}</div><div><button class="text-button" data-edit="${esc(r.id)}">编辑 / 补评价</button><button class="text-button" data-delete="${esc(r.id)}" aria-label="删除${esc(r.drink_name_snapshot)}的记录">删除</button><div class="stars">${r.rating?'★'.repeat(r.rating)+'☆'.repeat(5-r.rating):'待评价'}</div>${r.drink_id?`<button class="text-button" data-again="${esc(r.id)}">再来一杯 ↗</button>`:''}</div></article>`).join(''):`<div class="empty">${all.length?'没有匹配的记录。':'还没有记录。第一杯快乐，从“记一杯”开始。'}</div>`;}

function renderMenuFilters(){
 for(const [id,values,label] of [['brand',[...brandMenu.keys()],'全部品牌'],['category',state.drinks.map(d=>d.category),'都可以'],['catalog-brand',[...brandMenu.keys()],'全部品牌'],['catalog-category',state.drinks.map(d=>d.category),'全部品类']]){
  const selected=$('#'+id).value;
  $('#'+id).innerHTML=`<option value="">${label}</option>`+[...new Set(values)].sort((a,b)=>a.localeCompare(b,'zh')).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  $('#'+id).value=values.includes(selected)?selected:'';
 }
}
function renderCatalog(){
 const drinks=browseDrinks(state.drinks,{query:$('#catalog-search').value,brand:$('#catalog-brand').value,category:$('#catalog-category').value});
 const shown=drinks.slice(0,catalogLimit);
 $('#catalog-count').textContent=`当前 ${drinks.length} 款 · 已显示 ${shown.length} 款 · 共收录 ${state.drinks.length} 款 / ${state.catalog_scope?.brands?.length||0} 家品牌`;
 $('#catalog').innerHTML=drinks.length?shown.map(card).join(''):'<div class="empty">没有匹配的饮料，试试调整菜单品牌、品类或搜索词，也可点击“重置菜单筛选”。</div>';
 $('#catalog-more').hidden=shown.length>=drinks.length;
}
function updateCatalog(){if(state){catalogLimit=24;renderCatalog();}}
$('#catalog-search').oninput=updateCatalog;
for(const id of ['catalog-brand','catalog-category'])$('#'+id).onchange=updateCatalog;
$('#catalog-reset').onclick=()=>{$('#catalog-brand').value='';$('#catalog-category').value='';$('#catalog-search').value='';updateCatalog();};
$('#catalog-more').onclick=()=>{catalogLimit+=24;renderCatalog();};

function recommendationOptions(){return {category:$('#category').value,brand:$('#brand').value,budget:$('#budget').value||'all',includeUnknown:$('#include-unknown').checked,novel:$('#novel').checked};}
$('#random-recommend').onclick=()=>run(()=>refreshRecommendations('random'));
let recommendationRequest=0;
async function refreshRecommendations(mode=recommendationMode){
 const n=++recommendationRequest,button=$('#random-recommend');
 const params={...recommendationOptions(),mode};
 if(mode==='random')params.exclude_ids=rec.map(d=>d.id).join(',');
 button.disabled=true;button.textContent=mode==='random'?'正在随机推荐…':'加载推荐…';
 try{
  const result=await api('recommend?'+new URLSearchParams(params));
  if(n!==recommendationRequest)return;
  recommendationMode=mode;rec=result;renderCards();
  $('#recommendation-status').textContent=mode==='random'?(rec.length?`已随机推荐 ${rec.length} 款，点击“再随机推荐”换一组。`:'当前筛选条件下暂无随机推荐，请调整条件。'):'根据你的口味与历史推荐';
 }finally{if(n===recommendationRequest){button.disabled=!state;button.textContent=recommendationMode==='random'?'再随机推荐 🎲':'随机推荐 🎲';}}
}
async function load(initial=false){
 const request=++loadRequest,previousUser=currentUser?.id,session=await api('auth/me');
 if(request!==loadRequest)return;
 currentUser=session.user;csrfToken=session.csrf_token||'';
 const nextState=await api('state');if(request!==loadRequest)return;state=nextState;renderAuth();
 if(previousUser!==currentUser?.id){initial=true;rec=[];}
 brandMenu=groupDrinksByBrand(state.drinks);renderMenuFilters();
 if(initial){
  renderPrefs();const b=Number(state.preferences.budget_max);
  if(state.preferences.budget_max==null)$('#budget').value='25';
  if(b>=0&&state.preferences.budget_max!=null){if(![...$('#budget').options].some(option=>option.value===String(b)))$('#budget').insertAdjacentHTML('beforeend',`<option value="${b}">¥${b}</option>`);$('#budget').value=String(b);}
 }
 renderHistory();renderCatalog();renderCards();$('#random-recommend').disabled=false;
 await refreshRecommendations();
}
function switchTab(tab){if(tab==='admin'&&currentUser?.role!=='admin')return;currentTab=tab;for(const name of ['today','history','mine','admin'])$('#'+name).hidden=name!==tab;for(const b of $$('nav button'))b.classList.toggle('active',b.dataset.tab===tab);if(tab==='admin')run(()=>loadAdmin());}
function renderRecordDrinks(selectedId=''){
 const brand=$('#record-brand').value,drinks=recordBrandMenu.get(brand)||[],select=$('#record-drink');
 select.innerHTML=`<option value="">${!brand?'请先选择品牌':drinks.length?'请选择具体饮品':'该品牌暂无可选饮品'}</option>`+drinks.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
 select.value=drinks.some(d=>d.id===selectedId)?selectedId:'';
 select.disabled=editingId!==null||!drinks.length;
}
$('#record-brand').onchange=()=>{renderRecordDrinks();$('#record-error').textContent='';};
function openRecord(id,previous,edit=false){
 if(!ensureLogin())return;
 if(!state)return toast('数据还在加载，请稍后');
 recordBrandMenu=groupDrinksByBrand(edit?[...state.drinks,...(state.archived_drinks||[])]:state.drinks);
 const selected=findDrinkSelection(recordBrandMenu,id);
 if((id||edit)&&!selected.drinkId)return toast('这款饮品已不在当前菜单中，请选择其他饮品');
 editingId=edit?previous.id:null;
 const f=$('#record-form');f.reset();
 $('#record-brand').innerHTML='<option value="">请先选择品牌</option>'+[...recordBrandMenu.keys()].map(brand=>`<option value="${esc(brand)}">${esc(brand)}</option>`).join('');
 $('#record-brand').value=selected.brand;
 $('#record-brand').disabled=edit;
 renderRecordDrinks(selected.drinkId);
 f.elements.sweetness_level.value=previous?.sweetness_level??state.preferences.default_sweetness_level??2;
 f.elements.ice_level.value=previous?.ice_level||state.preferences.default_ice_level||'less';
 if(edit){f.elements.price_paid.value=previous.price_paid??'';f.elements.rating.value=previous.rating??'';f.elements.note.value=previous.note||'';}
 $('#record-error').textContent='';$('#record-dialog').showModal();
}
for(const b of $$('nav button'))b.addEventListener('click',()=>switchTab(b.dataset.tab));
$('#new-record').onclick=()=>openRecord();$('#close-dialog').onclick=()=>$('#record-dialog').close();
for(const id of ['category','brand','budget','include-unknown','novel'])$('#'+id).addEventListener('change',()=>{run(()=>refreshRecommendations());});
$('#shuffle').onclick=()=>run(async()=>{$('#novel').checked=!$('#novel').checked;await refreshRecommendations('personalized');toast($('#novel').checked?'试试未喝过的新口味':'回到熟悉的好味道');});
$('#search').oninput=()=>state&&renderHistory();$('#rating-filter').onchange=()=>state&&renderHistory();
document.addEventListener('click',e=>{const edit=e.target.closest('[data-edit]');if(edit){const r=state.records.find(x=>x.id===edit.dataset.edit);if(r)openRecord(r.drink_id,r,true);}const record=e.target.closest('[data-record]'),favorite=e.target.closest('[data-favorite]'),again=e.target.closest('[data-again]');if(record)openRecord(record.dataset.record);if(again){const r=state.records.find(x=>x.id===again.dataset.again);if(r)openRecord(r.drink_id,r);}if(favorite&&ensureLogin())run(async()=>{favorite.disabled=true;try{const id=favorite.dataset.favorite;await api('favorites','POST',{drink_id:id,active:!state.favorites.includes(id)});await load();toast('收藏已更新');}finally{favorite.disabled=false;}});});
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-delete]');if(!button||!ensureLogin())return;
 const record=state.records.find(r=>r.id===button.dataset.delete);if(!record)return;
 if(!confirm(`确定删除「${record.brand_name_snapshot} · ${record.drink_name_snapshot}」这条记录？删除后无法恢复。`))return;
 run(async()=>{button.disabled=true;try{await api('records/'+record.id,'DELETE');await load();toast('记录已删除');}finally{button.disabled=false;}});
});
$('#record-form').onsubmit=async e=>{e.preventDefault();if(!ensureLogin())return;const f=e.currentTarget,b=f.querySelector('[type=submit]'),v=new FormData(f);b.disabled=true;try{if(!(recordBrandMenu.get(f.elements.brand_name.value)||[]).some(d=>d.id===f.elements.drink_id.value))throw Error('请先选择品牌，再选择该品牌下的具体饮品');await api(editingId?'records/'+editingId:'records',editingId?'PATCH':'POST',{drink_id:f.elements.drink_id.value,sweetness_level:Number(v.get('sweetness_level')),ice_level:v.get('ice_level'),price_paid:v.get('price_paid')===''?null:Number(v.get('price_paid')),rating:v.get('rating')===''?null:Number(v.get('rating')),note:v.get('note')});$('#record-dialog').close();await load();toast('这一杯，记住了。');switchTab('history');}catch(err){$('#record-error').textContent=err.message;}finally{b.disabled=false;}};
$('#preferences').onsubmit=e=>{e.preventDefault();if(!ensureLogin())return;const f=e.currentTarget,v=new FormData(f),b=f.querySelector('[type=submit]');run(async()=>{b.disabled=true;try{await api('preferences','PUT',{preferred_categories:v.getAll('preferred_categories'),preferred_flavors:v.getAll('preferred_flavors'),avoided_ingredients:v.get('avoided_ingredients').split(/[,，]/).map(s=>s.trim()).filter(Boolean),budget_max:Number(v.get('budget_max')),default_sweetness_level:Number(v.get('default_sweetness_level')),default_ice_level:v.get('default_ice_level')});await load();renderPrefs();toast('口味已保存，下一杯更懂你。');}finally{b.disabled=false;}});};
$('#export').onclick=()=>{if(!ensureLogin())return;return run(async()=>{const data=await api('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='喝了么-我的数据.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
function renderAuth(){
 $('#account-button').textContent=currentUser?currentUser.nickname:'登录 / 注册';
 $('#logout-button').hidden=!currentUser;$('#account-guest').hidden=!!currentUser;$('#account-details').hidden=!currentUser;
 $('#history-login').hidden=!!currentUser;$('#admin-nav').hidden=currentUser?.role!=='admin';
 if(currentUser){$('#account-identity').textContent=`用户名：${currentUser.username} · ${currentUser.role==='admin'?'管理员':'普通用户'}`;$('#profile-form').elements.nickname.value=currentUser.nickname;}
 else{$('#account-identity').textContent='';$('#profile-form').reset();}
 if(currentTab==='admin'&&currentUser?.role!=='admin')switchTab('today');
}
function clearPrivateState(){
 currentUser=null;csrfToken='';loadRequest++;recommendationRequest++;adminRequest++;rec=[];editingId=null;recordBrandMenu=new Map();
 if(state){state.records=[];state.favorites=[];state.archived_drinks=[];state.preferences={preferred_categories:[],preferred_flavors:[],avoided_ingredients:[],budget_max:null,default_sweetness_level:2,default_ice_level:'less'};}
 if($('#record-dialog').open)$('#record-dialog').close();
 $('#record-form').reset();$('#password-form').reset();$('#preferences').reset();$('#admin-users').innerHTML='';$('#admin-count').textContent='';
 renderAuth();if(state){renderHistory();renderCards();renderPrefs();}
}
function setAuthMode(mode){
 authMode=mode;const register=mode==='register',f=$('#auth-form');
 $('#auth-title').textContent=register?'创建你的账号':'登录喝了么';$('#auth-submit').textContent=register?'注册并登录':'登录';
 $('#auth-toggle').textContent=register?'已有账号？登录':'还没有账号？注册';
 $('#auth-nickname-label').hidden=!register;$('#auth-confirm-label').hidden=!register;
 f.elements.password.autocomplete=register?'new-password':'current-password';f.elements.password.minLength=register?10:1;
 f.elements.confirm_password.required=register;f.elements.confirm_password.disabled=!register;
 f.elements.password.value='';f.elements.confirm_password.value='';$('#auth-error').textContent='';
}
function openAuth(mode='login'){setAuthMode(mode);if(!$('#auth-dialog').open)$('#auth-dialog').showModal();}
function ensureLogin(){if(currentUser)return true;openAuth();return false;}
$('#account-button').onclick=()=>currentUser?switchTab('mine'):openAuth();
$('#auth-close').onclick=()=>$('#auth-dialog').close();$('#auth-toggle').onclick=()=>setAuthMode(authMode==='login'?'register':'login');
$('#auth-dialog').addEventListener('close',()=>{$('#auth-form').elements.password.value='';$('#auth-form').elements.confirm_password.value='';});
for(const button of $$('[data-login]'))button.onclick=()=>openAuth();
$('#auth-form').onsubmit=async e=>{
 e.preventDefault();const f=e.currentTarget,button=$('#auth-submit'),register=authMode==='register';button.disabled=true;
 try{
  if(register&&f.elements.password.value!==f.elements.confirm_password.value)throw Error('两次密码不一致');
  const session=await api('auth/'+(register?'register':'login'),'POST',{username:f.elements.username.value,password:f.elements.password.value,nickname:register?f.elements.nickname.value:undefined});
  clearPrivateState();currentUser=session.user;csrfToken=session.csrf_token;$('#auth-dialog').close();f.reset();await load(true);toast(register?'账号已创建，欢迎加入':'登录成功');
 }catch(e){$('#auth-error').textContent=e.message;f.elements.password.value='';f.elements.confirm_password.value='';}finally{button.disabled=false;}
};
$('#logout-button').onclick=()=>run(async()=>{await api('auth/logout','POST');clearPrivateState();switchTab('today');await load(true);toast('已退出登录');});
$('#profile-form').onsubmit=e=>{e.preventDefault();if(!ensureLogin())return;run(async()=>{const button=e.target.querySelector('button');button.disabled=true;try{const result=await api('account/profile','PATCH',{nickname:e.target.elements.nickname.value});currentUser=result.user;renderAuth();toast('昵称已更新');}finally{button.disabled=false;}});};
$('#password-form').onsubmit=e=>{
 e.preventDefault();if(!ensureLogin())return;const f=e.target;
 run(async()=>{const button=f.querySelector('button');button.disabled=true;try{
  if(f.elements.new_password.value!==f.elements.confirm_password.value)throw Error('两次新密码不一致');
  await api('account/password','POST',{current_password:f.elements.current_password.value,new_password:f.elements.new_password.value});
  f.reset();clearPrivateState();await load(true);openAuth();toast('密码已更新，请重新登录');
 }finally{button.disabled=false;}});
};
async function loadAdmin(){
 if(currentUser?.role!=='admin')return;
 const n=++adminRequest,result=await api('admin/users?'+new URLSearchParams({q:$('#admin-search').elements.q.value,page:adminPage}));
 if(n!==adminRequest||currentUser?.role!=='admin')return;
 $('#admin-count').textContent=`共 ${result.total} 个账号 · 第 ${result.page} 页`;
 $('#admin-users').innerHTML=result.users.length?result.users.map(user=>`<article class="admin-user ${user.status==='disabled'?'disabled-account':''}"><div><h3>${esc(user.nickname)}</h3><p>${esc(user.username)} · ${user.role==='admin'?'管理员':'普通用户'} · ${user.status==='active'?'已启用':'已禁用'}</p><p class="muted">注册于 ${esc(new Date(user.created_at).toLocaleDateString('zh-CN'))}</p></div><button class="text-button" data-account-id="${esc(user.id)}" data-account-status="${user.status==='active'?'disabled':'active'}" ${user.id===currentUser.id?'disabled':''}>${user.id===currentUser.id?'当前账号':user.status==='active'?'禁用账号':'启用账号'}</button></article>`).join(''):'<p class="empty">没有找到匹配账号。</p>';
 $('#admin-prev').disabled=adminPage<=1;$('#admin-next').disabled=adminPage*result.page_size>=result.total;
}
$('#admin-search').onsubmit=e=>{e.preventDefault();adminPage=1;run(loadAdmin);};
$('#admin-prev').onclick=()=>{if(adminPage>1){adminPage--;run(loadAdmin);}};
$('#admin-next').onclick=()=>{adminPage++;run(loadAdmin);};
$('#admin-users').onclick=e=>{
 const button=e.target.closest('[data-account-id]');if(!button||currentUser?.role!=='admin')return;
 if(!window.confirm(button.dataset.accountStatus==='disabled'?'确认禁用此账号？该用户会立即退出登录，个人数据会保留。':'确认重新启用此账号？'))return;
 run(async()=>{button.disabled=true;try{await api('admin/users/'+button.dataset.accountId,'PATCH',{status:button.dataset.accountStatus});await loadAdmin();toast('账号状态已更新');}finally{button.disabled=false;}});
};
await run(()=>load(true));
