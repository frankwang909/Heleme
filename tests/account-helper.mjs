import {randomBytes} from 'node:crypto';
import {createPool,migrate} from '../server/database.mjs';
import {createAccount} from '../server/auth.mjs';
export const base='http://127.0.0.1:3000';
export const testPassword=()=>randomBytes(20).toString('hex');
export const testUsername=()=> 'test_'+randomBytes(8).toString('hex');
export function newClient(){
 return {cookie:'',csrf:'',user:null,async request(path,method='GET',data,extraHeaders={}){
  const headers={'Content-Type':'application/json','X-Heleme-Request':'1',...extraHeaders};
  if(this.cookie)headers.Cookie=this.cookie;if(this.csrf&&!('X-CSRF-Token' in extraHeaders))headers['X-CSRF-Token']=this.csrf;
  const response=await fetch(base+path,{method,headers,body:!['GET','HEAD'].includes(method)?JSON.stringify(data??{}):undefined});
  const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];
  const json=await response.json();
  if('csrf_token' in json)this.csrf=json.csrf_token||'';
  if('user' in json)this.user=json.user;
  return [response,json];
 }};
}
export async function accountFixture(role='user'){
 const pool=createPool();await migrate(pool);
 const username=testUsername(),password=testPassword(),client=newClient();
 const user=await createAccount(pool,{username,password,nickname:'测试账号',role});
 const [response]=await client.request('/api/auth/login','POST',{username,password});
 if(response.status!==200){await pool.query('DELETE FROM users WHERE id=$1',[user.id]);await pool.end();throw Error('测试账号登录失败');}
 return {client,user,username,password,pool,async cleanup(){await pool.query('DELETE FROM users WHERE id=$1',[user.id]);await pool.end();}};
}
