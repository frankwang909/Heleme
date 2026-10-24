import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPool,migrate} from '../server/database.mjs';

const payload=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
const config=JSON.parse(await readFile(new URL('../data/brands.json',import.meta.url),'utf8'));
const {drinks}=payload,brands=new Set(config.brands.map(b=>b.name)),replaceScope=process.argv.includes('--replace-scope');
if(payload.schema_version!==2||brands.size!==15||!Array.isArray(drinks)||!drinks.length)throw Error('采集范围异常，取消导入');
const keys=new Set();
for(const d of drinks){
 const url=new URL(d.source_url);
 if(url.protocol!=='https:'||url.hostname!=='www.nckfhsm.com'||!url.pathname.startsWith('/products/')||!brands.has(d.brand_name)||!/[\u4e00-\u9fff]/.test(d.name)||!d.category||d.source_region!=='中国大陆'||!/^[a-f0-9]{32}$/.test(d.source_key)||keys.has(d.source_key)||!Number.isFinite(Date.parse(d.source_checked_at))||d.price!==null||!Array.isArray(d.flavor_tags)||!Array.isArray(d.ingredients)||!(d.reference_price===null||(Number.isFinite(d.reference_price)&&d.reference_price>0&&d.reference_price<=100))||d.price_city!==null||d.price_store!==null||d.price_kind!==(d.reference_price===null?'unknown':'third_party_reference')||(d.reference_price!==null&&(d.price_source_url!==d.source_url||!Number.isFinite(Date.parse(d.price_checked_at)))))throw Error('大陆菜单/价格来源验证失败，取消导入');
 keys.add(d.source_key);
}
if(new Set(drinks.map(d=>d.brand_name)).size!==15)throw Error('未覆盖全部15品牌，取消导入');
const pool=createPool();
try{
 await migrate(pool);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(420241025)');
  let retired=0;
  if(replaceScope){retired=(await client.query("UPDATE drinks SET status='inactive' WHERE status='active' AND (source_key IS NULL OR NOT (source_key=ANY($1::text[])))",[[...keys]])).rowCount;}
  for(const d of drinks){
   const hex=createHash('sha256').update('heleme:'+d.source_key).digest('hex');
   const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
   await client.query(`INSERT INTO drinks(id,brand_name,name,category,flavor_tags,source_key,source_url,source_region,source_checked_at,source_category,price,ingredients,reference_price,source_label,price_kind,price_city,price_store,price_source_url,price_checked_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT(source_key) DO UPDATE SET brand_name=EXCLUDED.brand_name,name=EXCLUDED.name,category=EXCLUDED.category,
    flavor_tags=EXCLUDED.flavor_tags,source_url=EXCLUDED.source_url,source_region=EXCLUDED.source_region,
    source_checked_at=EXCLUDED.source_checked_at,source_category=EXCLUDED.source_category,price=EXCLUDED.price,ingredients=EXCLUDED.ingredients,
    reference_price=EXCLUDED.reference_price,source_label=EXCLUDED.source_label,price_kind=EXCLUDED.price_kind,price_city=EXCLUDED.price_city,
    price_store=EXCLUDED.price_store,price_source_url=EXCLUDED.price_source_url,price_checked_at=EXCLUDED.price_checked_at,
    status=CASE WHEN $20 THEN 'active' ELSE drinks.status END`,
    [id,d.brand_name,d.name,d.category,d.flavor_tags,d.source_key,d.source_url,d.source_region,d.source_checked_at,d.source_category,d.price,d.ingredients,
     d.reference_price,d.source_label,d.price_kind,d.price_city,d.price_store,d.price_source_url,d.price_checked_at,replaceScope]);
  }
  await client.query('COMMIT');
  console.log(`已导入/更新 ${drinks.length} 款饮料；从当前菜单移除 ${retired} 条旧条目，保留其历史和收藏。`);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}finally{await pool.end();}
