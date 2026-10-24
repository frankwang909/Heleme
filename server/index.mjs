import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createPool,migrate} from './database.mjs';
import {authenticate,handleAccountRoutes,requireUser,requireCsrf} from './auth.mjs';
import {recommend,pickRandomDrink,randomRecommendations} from './catalog.mjs';
const pool=createPool();
await migrate(pool);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw Object.assign(Error('请求内容过长'),{status:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Error('JSON 格式错误');}
}
const strings=(v)=>Array.isArray(v)&&v.length<=20&&v.every(s=>typeof s==='string'&&s.length<=40);
const catalogScope=JSON.parse(await readFile(new URL('../data/brands.json',import.meta.url),'utf8'));
const serializeDrink=x=>({...x,price:x.price==null?null:Number(x.price),reference_price:x.reference_price==null?null:Number(x.reference_price)});
async function state(userId=null){
 const [d,r,p,f,archived]=await Promise.all([
  pool.query("SELECT * FROM drinks WHERE status='active' ORDER BY brand_name,name,id"),
  pool.query('SELECT * FROM drink_records WHERE user_id=$1 ORDER BY consumed_at DESC',[userId]),
  pool.query('SELECT * FROM user_preferences WHERE user_id=$1',[userId]),
  pool.query('SELECT drink_id FROM favorites WHERE user_id=$1',[userId]),
  pool.query("SELECT d.* FROM drinks d WHERE status='inactive' AND (EXISTS(SELECT 1 FROM favorites f WHERE f.drink_id=d.id AND f.user_id=$1) OR EXISTS(SELECT 1 FROM drink_records r WHERE r.drink_id=d.id AND r.user_id=$1))",[userId])
 ]);
 return {drinks:d.rows.map(serializeDrink),archived_drinks:archived.rows.map(serializeDrink),records:r.rows,preferences:p.rows[0]||{preferred_categories:[],preferred_flavors:[],avoided_ingredients:[],default_sweetness_level:2,default_ice_level:'less',budget_max:null},favorites:f.rows.map(x=>x.drink_id),catalog_scope:catalogScope};
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const port=Number(process.env.PORT||3000),allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  if(!allowedHosts.has(req.headers.host))return json(res,403,{error:'不允许的访问地址'});
  const isApi=url.pathname.startsWith('/api/'),mutating=!['GET','HEAD'].includes(req.method);
  if(isApi&&mutating){
   if((req.headers.origin&&req.headers.origin!==`http${process.env.COOKIE_SECURE==='1'?'s':''}://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'不允许跨站写入'});
   if(req.headers['x-heleme-request']!=='1')return json(res,403,{error:'缺少请求校验头'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return json(res,415,{error:'请求需使用JSON格式'});
  }
  const session=isApi?await authenticate(pool,req):null,user=session?.user;
  if(isApi&&await handleAccountRoutes(pool,req,res,url,session,{json,body}))return;
  if(isApi&&mutating){requireUser(session);requireCsrf(req,session);}
  if(url.pathname==='/api/export')requireUser(session);
  if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,await state(user?.id));
  if(['/api/recommend','/api/random'].includes(url.pathname)&&req.method==='GET'){
   const s=await state(user?.id),budgetValue=url.searchParams.get('budget')??s.preferences.budget_max??100;
   const budget=budgetValue==='all'?Infinity:Number(budgetValue);
   if((budgetValue!== 'all'&&(!Number.isFinite(budget)||budget<0))||budgetValue==='')return json(res,400,{error:'预算应为非负金额或 all'});
   const options={category:url.searchParams.get('category')||'',brand:url.searchParams.get('brand')||'',budget,
    includeUnknown:url.searchParams.get('includeUnknown')==='true',novel:url.searchParams.get('novel')==='true',excludeId:url.searchParams.get('exclude_id')||'',excludeIds:(url.searchParams.get('exclude_ids')||'').split(',').filter(Boolean).slice(0,3)};
   return json(res,200,url.pathname==='/api/random'?pickRandomDrink(s.drinks,s.records,s.preferences,options):url.searchParams.get('mode')==='random'?randomRecommendations(s.drinks,s.records,s.preferences,options):recommend(s.drinks,s.records,s.preferences,options));
  }
  const editMatch=url.pathname.match(/^\/api\/records\/([0-9a-f-]+)$/i);
  if(editMatch&&req.method==='DELETE'){
   if(!uuid.test(editMatch[1]))return json(res,404,{error:'记录不存在'});
   const deleted=await pool.query('DELETE FROM drink_records WHERE id=$1 AND user_id=$2 RETURNING id',[editMatch[1],user.id]);
   if(!deleted.rowCount)return json(res,404,{error:'记录不存在'});
   return json(res,200,{ok:true});
  }
  if((url.pathname==='/api/records'&&req.method==='POST')||(editMatch&&req.method==='PATCH')){
   const b=await body(req);
   if(!uuid.test(b.drink_id||''))throw Error('请选择饮料');
   if(b.rating!=null&&(!Number.isInteger(b.rating)||b.rating<1||b.rating>5))throw Error('评分应为 1–5');
   if(b.price_paid!=null&&(!Number.isFinite(b.price_paid)||b.price_paid<0||b.price_paid>99999))throw Error('金额无效');
   if(b.sweetness_level!=null&&(!Number.isInteger(b.sweetness_level)||b.sweetness_level<0||b.sweetness_level>5))throw Error('甜度无效');
   if(!['regular','less','none','room','warm','hot'].includes(b.ice_level))throw Error('冰量无效');
   if(typeof b.note!=='string'||b.note.length>1000)throw Error('备注不能超过 1000 字');
   const d=(editMatch?await pool.query('SELECT d.* FROM drinks d JOIN drink_records r ON r.drink_id=d.id WHERE d.id=$1 AND r.id=$2 AND r.user_id=$3',[b.drink_id,editMatch[1],user.id]):await pool.query('SELECT * FROM drinks WHERE id=$1 AND status=$2',[b.drink_id,'active'])).rows[0];if(!d)throw Error('饮料不存在或记录饮品不匹配');
   if(editMatch){
    if(!uuid.test(editMatch[1]))throw Error('记录不存在');
    const changed=await pool.query('UPDATE drink_records SET sweetness_level=$3,sweetness_label=$4,ice_level=$5,ice_label=$6,price_paid=$7,rating=$8,note=$9 WHERE id=$1 AND user_id=$2 RETURNING *',[editMatch[1],user.id,b.sweetness_level,['无糖','微糖','三分糖','半糖','七分糖','全糖'][b.sweetness_level]||null,b.ice_level,{regular:'正常冰',less:'少冰',none:'去冰',room:'常温',warm:'温',hot:'热'}[b.ice_level],b.price_paid,b.rating,b.note]);
    if(!changed.rows.length)return json(res,404,{error:'记录不存在'});return json(res,200,changed.rows[0]);
   }
   const r=await pool.query('INSERT INTO drink_records(user_id,drink_id,brand_name_snapshot,drink_name_snapshot,sweetness_level,sweetness_label,ice_level,ice_label,price_paid,rating,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[user.id,d.id,d.brand_name,d.name,b.sweetness_level,['无糖','微糖','三分糖','半糖','七分糖','全糖'][b.sweetness_level]||null,b.ice_level,{regular:'正常冰',less:'少冰',none:'去冰',room:'常温',warm:'温',hot:'热'}[b.ice_level],b.price_paid,b.rating,b.note]);return json(res,201,r.rows[0]);
  }
  if(url.pathname==='/api/preferences'&&req.method==='PUT'){
   const b=await body(req);if(!strings(b.preferred_categories)||!strings(b.preferred_flavors)||!strings(b.avoided_ingredients))throw Error('偏好格式无效');
   if(!Number.isFinite(b.budget_max)||b.budget_max<0||b.budget_max>99999)throw Error('预算无效');
   if(!Number.isInteger(b.default_sweetness_level)||b.default_sweetness_level<0||b.default_sweetness_level>5)throw Error('甜度无效');
   if(!['regular','less','none','room','warm','hot'].includes(b.default_ice_level))throw Error('冰量无效');
   await pool.query('UPDATE user_preferences SET preferred_categories=$2,preferred_flavors=$3,avoided_ingredients=$4,budget_max=$5,default_sweetness_level=$6,default_ice_level=$7 WHERE user_id=$1',[user.id,b.preferred_categories,b.preferred_flavors,b.avoided_ingredients,b.budget_max,b.default_sweetness_level,b.default_ice_level]);return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/favorites'&&req.method==='POST'){
   const b=await body(req);if(!uuid.test(b.drink_id||'')||typeof b.active!=='boolean')throw Error('收藏参数无效');
   if(b.active){const drink=await pool.query("SELECT 1 FROM drinks WHERE id=$1 AND status='active'",[b.drink_id]);if(!drink.rowCount)throw Error('饮料已从当前菜单移除');await pool.query('INSERT INTO favorites(user_id,drink_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[user.id,b.drink_id]);}else await pool.query('DELETE FROM favorites WHERE user_id=$1 AND drink_id=$2',[user.id,b.drink_id]);return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/export'&&req.method==='GET')return json(res,200,await state(user?.id));
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'方法不支持'});
  const allowed={'/':'index.html','/app.js':'app.js','/drink-menu.js':'drink-menu.js','/style.css':'style.css'};const file=allowed[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}
  const bytes=await readFile(resolve('public',file));res.writeHead(200,{'Cache-Control':'no-cache','Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)],'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);
 }catch(e){const client=/^(22|23)/.test(e.code||'');json(res,e.status||(client||!e.code?400:500),{error:e.code?(client?'数据格式或关联关系无效':'数据库暂时不可用'):e.message});}
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('喝了么 Demo: http://127.0.0.1:'+ (process.env.PORT||3000)));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>pool.end().then(()=>process.exit(0))));
