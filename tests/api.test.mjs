import {test,before,after} from 'node:test';
import {accountFixture,newClient} from './account-helper.mjs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createPool} from '../server/database.mjs';
const base='http://127.0.0.1:3000';
let fixture;
before(async()=>{fixture=await accountFixture();});
after(async()=>{if(fixture)await fixture.cleanup();});
async function request(path,method='GET',data){return fixture.client.request(path,method,data);}
test('API records persist, edits work, invalid ratings and cross-origin writes are rejected',async()=>{
 const [,s]=await request('/api/state');assert.ok(s.drinks.length>=8);const d=s.drinks.find(d=>!d.is_demo)||s.drinks[0];
 const input={drink_id:d.id,sweetness_level:2,ice_level:'less',price_paid:18,rating:5,note:'API integration <script> sample'};
 let id;
 try{
  const [bad]=await request('/api/records','POST',{...input,rating:6});assert.equal(bad.status,400);
  const [r,v]=await request('/api/records','POST',input);assert.equal(r.status,201);id=v.id;assert.equal(v.rating,5);
  const [,updated]=await request('/api/records/'+id,'PATCH',{...input,rating:4});assert.equal(updated.rating,4);
  const [,five]=await request('/api/records/'+id,'PATCH',{...input,rating:5});assert.equal(five.rating,5);
  const [,next]=await request('/api/state');assert.equal(next.records.find(x=>x.id===id).note,input.note);assert.equal(next.records.find(x=>x.id===id).rating,5);
  const [cross]=await fetch(base+'/api/records',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify(input)}).then(async r=>[r,await r.json()]);assert.equal(cross.status,403);
  const page=await fetch(base);assert.equal(page.status,200);const html=await page.text();assert.match(html,/喝了么/);assert.match(html,/id="record-brand"/);assert.match(html,/id="record-drink" required disabled/);
  const ratingSelect=html.match(/<select\b[^>]*name="rating"[^>]*>([\s\S]*?)<\/select>/);assert.ok(ratingSelect);
  const ratings=[...ratingSelect[1].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>/g)].map(match=>match[1]);assert.deepEqual(ratings,['','5','4','3','2','1']);
  const menuModule=await fetch(base+'/drink-menu.js');assert.equal(menuModule.status,200);assert.match(menuModule.headers.get('content-type'),/javascript/);
 }finally{
  if(id){const pool=new pg.Pool({host:'127.0.0.1',user:'heleme',database:'heleme',password:process.env.POSTGRES_PASSWORD});await pool.query('DELETE FROM drink_records WHERE id=$1',[id]);await pool.end();}
 }
});

test('imported catalog has traceable sources and price filtering works',async()=>{
 const [,s]=await request('/api/state');const imported=s.drinks.filter(d=>d.source_key);
 assert.ok(imported.length>=4);const scope=JSON.parse(await readFile(new URL('../data/brands.json',import.meta.url),'utf8'));assert.deepEqual(new Set(s.drinks.map(d=>d.brand_name)),new Set(scope.brands.map(b=>b.name)));assert.equal(scope.brands.length,15);assert.equal(s.drinks.length,imported.length);
 for(const d of imported){assert.ok(d.source_url.startsWith('https://'));assert.equal(d.source_region,'中国大陆');assert.match(d.name,/[\u4e00-\u9fff]/);assert.ok(d.reference_price===null||d.reference_price>0);assert.equal(d.price_city,null);assert.ok(d.source_label.includes('第三方'));assert.equal(d.status,'active');assert.ok(d.source_checked_at);assert.equal(d.price,null);assert.equal(d.is_demo,false);}
 const [,hidden]=await request('/api/recommend?brand='+encodeURIComponent('蜜雪冰城')+'&budget=0');assert.deepEqual(hidden,[]);
 const [,shown]=await request('/api/recommend?brand='+encodeURIComponent('蜜雪冰城')+'&budget=0&includeUnknown=true');assert.ok(shown.length);assert.ok(shown.every(d=>d.brand_name==='蜜雪冰城'&&d.price===null));
});

test('random endpoint uses current filters, excludes the previous drink, and handles no matches',async()=>{
 const brand=encodeURIComponent('蜜雪冰城');
 const [emptyStatus,empty]=await request('/api/random?brand='+brand+'&budget=0');assert.equal(emptyStatus.status,200);assert.deepEqual(empty,{drink:null,candidate_count:0});
 const [status,first]=await request('/api/random?brand='+brand+'&budget=all&includeUnknown=true');assert.equal(status.status,200);assert.ok(first.candidate_count>3);assert.equal(first.drink.brand_name,'蜜雪冰城');
 const [,second]=await request('/api/random?brand='+brand+'&budget=all&includeUnknown=true&exclude_id='+first.drink.id);assert.notEqual(second.drink.id,first.drink.id);
 const [,unknown]=await request('/api/random?brand=not-a-brand&includeUnknown=true');assert.equal(unknown.drink,null);
 const [bad]=await request('/api/random?budget=invalid');assert.equal(bad.status,400);
});

test('random recommendation mode returns a fresh group in the recommendation response',async()=>{
 const url='/api/recommend?mode=random&brand='+encodeURIComponent('蜜雪冰城')+'&budget=all&includeUnknown=true';
 const [status,first]=await request(url);assert.equal(status.status,200);assert.equal(first.length,3);
 assert.equal(new Set(first.map(d=>d.id)).size,3);assert.ok(first.every(d=>d.brand_name==='蜜雪冰城'&&d.reason.includes('随机推荐')));
 const [,next]=await request(url+'&exclude_ids='+first.map(d=>d.id).join(','));assert.equal(next.length,3);assert.ok(next.every(d=>!first.some(p=>p.id===d.id)));
 const [,empty]=await request('/api/recommend?mode=random&budget=0');assert.deepEqual(empty,[]);
});

test('retired drinks keep history and favorites, allow record edits, and reject new consumption',async()=>{
 const pool=createPool(),drinkId=randomUUID(),recordId=randomUUID(),user=fixture.user.id;
 try{
  await pool.query("INSERT INTO drinks(id,brand_name,name,category,status) VALUES($1,'归档测试品牌','归档测试饮品','奶茶','inactive')",[drinkId]);
  await pool.query("INSERT INTO drink_records(id,user_id,drink_id,brand_name_snapshot,drink_name_snapshot,rating) VALUES($1,$2,$3,'归档测试品牌','归档测试饮品',3)",[recordId,user,drinkId]);
  await pool.query('INSERT INTO favorites(user_id,drink_id) VALUES($1,$2)',[user,drinkId]);
  const [,state]=await request('/api/state');assert.ok(!state.drinks.some(d=>d.id===drinkId));assert.ok(state.archived_drinks.some(d=>d.id===drinkId));assert.ok(state.favorites.includes(drinkId));
  const input={drink_id:drinkId,sweetness_level:2,ice_level:'less',price_paid:12,rating:4,note:'归档记录编辑测试'};
  const [edited,value]=await request('/api/records/'+recordId,'PATCH',input);assert.equal(edited.status,200);assert.equal(value.rating,4);
  const [created]=await request('/api/records','POST',input);assert.equal(created.status,400);
 }finally{await pool.query('DELETE FROM drink_records WHERE id=$1',[recordId]);await pool.query('DELETE FROM drinks WHERE id=$1',[drinkId]);await pool.end();}
});


test('record deletion requires login and CSRF, isolates accounts, and updates exported history',async()=>{
 const other=await accountFixture();
 try{
  const [,initial]=await request('/api/state');
  const [created,record]=await request('/api/records','POST',{drink_id:initial.drinks[0].id,sweetness_level:2,ice_level:'less',price_paid:12,rating:4,note:'删除流程测试'});
  assert.equal(created.status,201);
  const path='/api/records/'+record.id;
  const [guest]=await newClient().request(path,'DELETE');assert.equal(guest.status,401);
  const [csrf]=await fixture.client.request(path,'DELETE',{}, {'X-CSRF-Token':''});assert.equal(csrf.status,403);
  const [foreign]=await other.client.request(path,'DELETE');assert.equal(foreign.status,404);
  const [,before]=await request('/api/state');assert.ok(before.records.some(r=>r.id===record.id));
  const [deleted,result]=await request(path,'DELETE');assert.equal(deleted.status,200);assert.deepEqual(result,{ok:true});
  const [,after]=await request('/api/state');assert.equal(after.records.length,initial.records.length);assert.ok(!after.records.some(r=>r.id===record.id));
  const [,exported]=await request('/api/export');assert.ok(!exported.records.some(r=>r.id===record.id));
  const [missing]=await request(path,'DELETE');assert.equal(missing.status,404);
  const [invalid]=await request('/api/records/abc','DELETE');assert.equal(invalid.status,404);
 }finally{await other.cleanup();}
});
