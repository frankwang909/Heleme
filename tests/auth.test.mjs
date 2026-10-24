import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {createPool} from '../server/database.mjs';
import {accountFixture,newClient,testPassword,testUsername,base} from './account-helper.mjs';
import {hashPassword,verifyPassword,rateLimit} from '../server/auth.mjs';

test('passwords are independently salted, validated, and not stored as plaintext',async()=>{
 const password=testPassword(),first=await hashPassword(password),second=await hashPassword(password);
 assert.ok(first!==second&&!first.includes(password));assert.ok(await verifyPassword(password,first));assert.ok(!await verifyPassword('wrong-password',first));
 await assert.rejects(hashPassword('short'),/10–128/);assert.ok(!await verifyPassword(password,'malformed'));
});

test('guests can browse but cannot access exports, save data, or send unverified writes',async()=>{
 const guest=newClient();const [,s]=await guest.request('/api/state');assert.ok(s.drinks.length>0);assert.deepEqual(s.records,[]);assert.deepEqual(s.favorites,[]);
 assert.equal((await guest.request('/api/export'))[0].status,401);
 assert.equal((await guest.request('/api/records','POST',{}))[0].status,401);
 const unverified=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unverified.status,403);
 const cross=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Heleme-Request':'1',Origin:'https://untrusted.example'},body:'{}'});assert.equal(cross.status,403);
});

test('public registration always creates a normal user and blocks duplicate usernames',async()=>{
 const fixture=await accountFixture();const registered=newClient();let id;
 try{
  const username=testUsername(),password=testPassword();
  const [r,j]=await registered.request('/api/auth/register','POST',{username:username.toUpperCase(),password,nickname:'新用户',role:'admin',user_id:fixture.user.id});
  id=j.user?.id;assert.equal(r.status,201);assert.equal(j.user.role,'user');assert.equal(j.user.username,username);assert.notEqual(j.user.id,fixture.user.id);
  const cookie=r.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly')&&cookie.includes('SameSite=Strict'));
  assert.equal((await newClient().request('/api/auth/register','POST',{username,password}))[0].status,409);
  assert.equal((await newClient().request('/api/auth/register','POST',{username:testUsername(),password:'short'}))[0].status,400);
  const row=(await fixture.pool.query('SELECT password_hash FROM user_accounts WHERE user_id=$1',[id])).rows[0];assert.ok(!row.password_hash.includes(password));
 }finally{if(id)await fixture.pool.query('DELETE FROM users WHERE id=$1',[id]);await fixture.cleanup();}
});

test('Unicode credentials remain valid when UTF-8 characters cross request chunks',async()=>{
 const username=testUsername(),password='中文密码可以安全保存'+testPassword(),pool=createPool();let id;
 try{
  const payload=Buffer.from(JSON.stringify({username,password,nickname:'中文昵称'}));
  const split=payload.indexOf(Buffer.from('中'))+1;
  const result=await new Promise((resolve,reject)=>{
   const req=http.request(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Heleme-Request':'1'}},res=>{
    const data=[];res.on('data',chunk=>data.push(chunk));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(data).toString())}));
   });
   req.on('error',reject);req.write(payload.subarray(0,split));setTimeout(()=>req.end(payload.subarray(split)),10);
  });
  id=result.data.user?.id;assert.equal(result.status,201);
  assert.equal((await newClient().request('/api/auth/login','POST',{username,password}))[0].status,200);
 }finally{if(id)await pool.query('DELETE FROM users WHERE id=$1',[id]);await pool.end();}
});

test('records, favorites, preferences, exports, and profile updates are isolated by session',async()=>{
 const a=await accountFixture(),b=await accountFixture();
 try{
  const [,s]=await a.client.request('/api/state'),drink=s.drinks[0];
  const input={drink_id:drink.id,sweetness_level:2,ice_level:'less',price_paid:18,rating:5,note:'用户隔离测试'};
  const [created,r]=await a.client.request('/api/records','POST',input);assert.equal(created.status,201);
  await a.client.request('/api/favorites','POST',{drink_id:drink.id,active:true});
  const [,bState]=await b.client.request('/api/state');assert.ok(!bState.records.some(x=>x.id===r.id));assert.ok(!bState.favorites.includes(drink.id));
  assert.equal((await b.client.request('/api/records/'+r.id,'PATCH',input))[0].status,400);
  const [,own]=await b.client.request('/api/records','POST',{...input,user_id:a.user.id});
  const [,aExport]=await a.client.request('/api/export'),[,bExport]=await b.client.request('/api/export');
  assert.ok(aExport.records.some(x=>x.id===r.id)&&!aExport.records.some(x=>x.id===own.id));assert.ok(bExport.records.some(x=>x.id===own.id));
  await a.client.request('/api/preferences','PUT',{preferred_categories:['纯茶'],preferred_flavors:[],avoided_ingredients:[],default_sweetness_level:1,default_ice_level:'less',budget_max:19});
  const [,bNext]=await b.client.request('/api/state');assert.equal(bNext.preferences.budget_max,null);
  const [profile,changed]=await a.client.request('/api/account/profile','PATCH',{nickname:'修改后的昵称',user_id:b.user.id});assert.equal(profile.status,200);assert.equal(changed.user.id,a.user.id);
  const [,bMe]=await b.client.request('/api/auth/me');assert.equal(bMe.user.nickname,'测试账号');
 }finally{await a.cleanup();await b.cleanup();}
});

test('CSRF, password changes, logout, and expiration protect persistent sessions',async()=>{
 const fixture=await accountFixture(),other=newClient();
 try{
  await other.request('/api/auth/login','POST',{username:fixture.username,password:fixture.password});
  assert.equal((await fixture.client.request('/api/account/profile','PATCH',{nickname:'不应修改'},{'X-CSRF-Token':'wrong'}))[0].status,403);
  assert.equal((await fixture.client.request('/api/account/profile','PATCH',{nickname:'不应修改'},{'X-CSRF-Token':'é'.repeat(43)}))[0].status,403);
  assert.equal((await fixture.client.request('/api/account/password','POST',{current_password:'wrong-password',new_password:testPassword()}))[0].status,400);
  const nextPassword=testPassword();assert.equal((await fixture.client.request('/api/account/password','POST',{current_password:fixture.password,new_password:nextPassword}))[0].status,200);
  assert.equal((await other.request('/api/auth/me'))[1].user,null);
  assert.equal((await other.request('/api/export'))[0].status,401);
  assert.equal((await newClient().request('/api/auth/login','POST',{username:fixture.username,password:fixture.password}))[0].status,401);
  const active=newClient();assert.equal((await active.request('/api/auth/login','POST',{username:fixture.username,password:nextPassword}))[0].status,200);
  const copied=newClient();copied.cookie=active.cookie;
  await active.request('/api/auth/logout','POST');assert.equal((await copied.request('/api/auth/me'))[1].user,null);
  await active.request('/api/auth/login','POST',{username:fixture.username,password:nextPassword});
  await fixture.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[fixture.user.id]);
  assert.equal((await active.request('/api/auth/me'))[1].user,null);
  const stored=await fixture.pool.query('SELECT token_hash FROM auth_sessions WHERE user_id=$1',[fixture.user.id]);assert.ok(stored.rows.every(row=>!active.cookie.includes(row.token_hash)));
 }finally{await fixture.cleanup();}
});

test('administrators list accounts and disable sessions; ordinary users cannot administer',async()=>{
 const admin=await accountFixture('admin'),normal=await accountFixture();
 try{
  assert.equal((await normal.client.request('/api/admin/users'))[0].status,403);
  const [list,result]=await admin.client.request('/api/admin/users?q='+normal.username);assert.equal(list.status,200);assert.equal(result.total,1);assert.equal(result.users[0].id,normal.user.id);
  assert.ok(!JSON.stringify(result).includes('password_hash'));assert.ok(!JSON.stringify(result).includes('csrf_token'));
  assert.equal((await admin.client.request('/api/admin/users/'+admin.user.id,'PATCH',{status:'disabled'}))[0].status,400);
  assert.equal((await admin.client.request('/api/admin/users/'+normal.user.id,'PATCH',{status:'disabled',role:'admin'}))[0].status,400);
  assert.equal((await admin.client.request('/api/admin/users/'+normal.user.id,'PATCH',{status:'disabled'}))[0].status,200);
  assert.equal((await normal.client.request('/api/auth/me'))[1].user,null);
  assert.equal((await newClient().request('/api/auth/login','POST',{username:normal.username,password:normal.password}))[0].status,401);
  assert.equal((await admin.client.request('/api/admin/users/'+normal.user.id,'PATCH',{status:'active'}))[0].status,200);
  assert.equal((await newClient().request('/api/auth/login','POST',{username:normal.username,password:normal.password}))[0].status,200);
  assert.equal((await admin.client.request('/api/admin/users?page=invalid'))[0].status,400);
 }finally{await admin.cleanup();await normal.cleanup();}
});

test('authentication throttling survives process-local state',async()=>{
 const fixture=await accountFixture(),key='test-limit:'+testUsername();
 try{await rateLimit(fixture.pool,key,2);await rateLimit(fixture.pool,key,2);await assert.rejects(rateLimit(fixture.pool,key,2),e=>e.status===429);}
 finally{await fixture.pool.query('DELETE FROM auth_rate_limits WHERE key_hash=$1',[createHash('sha256').update(key).digest('hex')]);await fixture.cleanup();}
});
