import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCallback),cookieName='heleme_session';
const work={N:32768,r:8,p:3,maxmem:64*1024*1024};
export const legacyUserId='00000000-0000-4000-8000-000000000001';
export const httpError=(status,message)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
const publicUser=row=>({id:row.user_id,username:row.username,nickname:row.nickname,role:row.role,status:row.status});

export function validateUsername(value){
 if(typeof value!=='string'||!/^[a-zA-Z0-9_]{3,32}$/.test(value))throw httpError(400,'用户名需为3–32位字母、数字或下划线');
 return value.toLowerCase();
}
export function validateNickname(value){
 if(typeof value!=='string'||!value.trim()||[...value.trim()].length>40)throw httpError(400,'昵称需为1–40个字符');
 return value.trim();
}
export function validatePassword(value){
 if(typeof value!=='string'||[...value].length<10||[...value].length>128||Buffer.byteLength(value)>512)throw httpError(400,'密码需为10–128个字符');
 return value;
}
export async function hashPassword(password){
 validatePassword(password);
 const salt=randomBytes(16).toString('hex'),key=await scrypt(password,salt,64,work);
 return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||Buffer.byteLength(password)>512)return false;
 const match=/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored||'');
 if(!match)return false;
 const key=await scrypt(password,match[1],64,work);
 return timingSafeEqual(key,Buffer.from(match[2],'hex'));
}
const dummyHash=await hashPassword(randomBytes(24).toString('hex'));
function sessionToken(req){
 const cookies=(req.headers.cookie||'').split(';').map(v=>v.trim());
 const value=cookies.find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 return /^[A-Za-z0-9_-]{43}$/.test(value||'')?value:null;
}
export function setSessionCookie(res,token){
 const secure=process.env.COOKIE_SECURE==='1'?'; Secure':'';
 res.setHeader('Set-Cookie',`${cookieName}=${token||''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?604800:0}${secure}`);
}
export async function authenticate(pool,req){
 const token=sessionToken(req);if(!token)return null;
 const {rows}=await pool.query(`SELECT a.user_id,a.username,a.role,a.status,u.nickname,s.csrf_token,s.token_hash
  FROM auth_sessions s JOIN user_accounts a ON a.user_id=s.user_id JOIN users u ON u.id=a.user_id
  WHERE s.token_hash=$1 AND a.status='active' AND s.expires_at>now() AND s.last_seen_at>now()-interval '1 day'`,[digest(token)]);
 if(!rows.length)return null;
 await pool.query("UPDATE auth_sessions SET last_seen_at=now() WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'",[rows[0].token_hash]);
 return {user:publicUser(rows[0]),csrf_token:rows[0].csrf_token,token_hash:rows[0].token_hash};
}
export function requireUser(session){if(!session)throw httpError(401,'请先登录');return session.user;}
export function requireCsrf(req,session){
 requireUser(session);
 const supplied=req.headers['x-csrf-token'];
 if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(session.csrf_token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(session.csrf_token)))throw httpError(403,'登录校验已失效，请刷新后重试');
}
export async function rateLimit(pool,key,limit=10){
 const result=await pool.query(`INSERT INTO auth_rate_limits(key_hash,attempts) VALUES($1,1)
 ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts+1 END,
 window_start=CASE WHEN auth_rate_limits.window_start<now()-interval '15 minutes' THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`,[digest(key)]);
 if(result.rows[0].attempts>limit)throw httpError(429,'尝试过于频繁，请15分钟后再试');
}
export async function createAccount(pool,{username,password,nickname,role='user',claimLegacy=false}){
 username=validateUsername(username);nickname=validateNickname(nickname||username);
 const passwordHash=await hashPassword(password),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(420241027)');
  if((await client.query('SELECT 1 FROM user_accounts WHERE username=$1',[username])).rowCount)throw httpError(409,'该用户名已被使用');
  let user;
  if(claimLegacy){
   const legacy=await client.query('SELECT id FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM user_accounts WHERE user_id=$1) FOR UPDATE',[legacyUserId]);
   if(legacy.rowCount)user=(await client.query('UPDATE users SET nickname=$2 WHERE id=$1 RETURNING id,nickname',[legacyUserId,nickname])).rows[0];
  }
  if(!user)user=(await client.query('INSERT INTO users(nickname) VALUES($1) RETURNING id,nickname',[nickname])).rows[0];
  const account=(await client.query('INSERT INTO user_accounts(user_id,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING user_id,username,role,status',[user.id,username,passwordHash,role])).rows[0];
  await client.query('INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
  await client.query('COMMIT');
  return {...publicUser({...account,nickname:user.nickname}),claimedLegacy:user.id===legacyUserId};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function startSession(pool,req,res,userId,expectedHash=null){
 const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url'),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const account=await client.query("SELECT a.*,u.nickname FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.user_id=$1 AND a.status='active' FOR UPDATE OF a",[userId]);
  if(!account.rowCount||(expectedHash&&account.rows[0].password_hash!==expectedHash))throw httpError(401,'账号或密码已变更，请重新登录');
  const old=sessionToken(req);if(old)await client.query('DELETE FROM auth_sessions WHERE token_hash=$1',[digest(old)]);
  await client.query("DELETE FROM auth_sessions WHERE expires_at<=now() OR last_seen_at<=now()-interval '1 day'");
  await client.query("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[digest(token),userId,csrf]);
  await client.query('UPDATE user_accounts SET last_login_at=now() WHERE user_id=$1',[userId]);
  await client.query('COMMIT');setSessionCookie(res,token);
  return {user:publicUser(account.rows[0]),csrf_token:csrf};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function handleAccountRoutes(pool,req,res,url,session,{json,body}){
 const path=url.pathname,method=req.method;
 if(path==='/api/auth/me'&&method==='GET'){json(res,200,{user:session?.user||null,csrf_token:session?.csrf_token||null});return true;}
 if(['/api/auth/register','/api/auth/login'].includes(path)&&method==='POST'){
  await rateLimit(pool,'auth-ip:'+req.socket.remoteAddress,60);
  const b=await body(req),username=validateUsername(b.username);
  await rateLimit(pool,path+':'+req.socket.remoteAddress+':'+username,path.endsWith('login')?10:5);
  if(path.endsWith('register')){
   const user=await createAccount(pool,{username,password:b.password,nickname:b.nickname});
   json(res,201,await startSession(pool,req,res,user.id));return true;
  }
  const account=(await pool.query('SELECT * FROM user_accounts WHERE username=$1',[username])).rows[0];
  const valid=await verifyPassword(b.password,account?.password_hash||dummyHash);
  if(!valid||!account||account.status!=='active')throw httpError(401,'用户名或密码错误，或账号不可用');
  json(res,200,await startSession(pool,req,res,account.user_id,account.password_hash));return true;
 }
 if(path==='/api/auth/logout'&&method==='POST'){
  if(session){requireCsrf(req,session);await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1',[session.token_hash]);}
  setSessionCookie(res,null);json(res,200,{ok:true});return true;
 }
 if(path==='/api/account/profile'&&method==='PATCH'){
  const user=requireUser(session);requireCsrf(req,session);const nickname=validateNickname((await body(req)).nickname);
  await pool.query('UPDATE users SET nickname=$2 WHERE id=$1',[user.id,nickname]);json(res,200,{user:{...user,nickname}});return true;
 }
 if(path==='/api/account/password'&&method==='POST'){
  const user=requireUser(session);requireCsrf(req,session);await rateLimit(pool,'password:'+user.id,10);
  const b=await body(req),account=(await pool.query('SELECT password_hash FROM user_accounts WHERE user_id=$1',[user.id])).rows[0];
  if(!await verifyPassword(b.current_password,account.password_hash))throw httpError(400,'当前密码不正确');
  const hash=await hashPassword(b.new_password),client=await pool.connect();
  try{
   await client.query('BEGIN');
   const changed=await client.query('UPDATE user_accounts SET password_hash=$2 WHERE user_id=$1 AND password_hash=$3',[user.id,hash,account.password_hash]);
   if(!changed.rowCount)throw httpError(409,'密码已发生变化，请重新登录');
   await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[user.id]);await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  setSessionCookie(res,null);json(res,200,{ok:true,login_required:true});return true;
 }
 if(path.startsWith('/api/admin/')){
  const actor=requireUser(session);if(actor.role!=='admin')throw httpError(403,'需要管理员权限');
  if(path==='/api/admin/users'&&method==='GET'){
   const rawPage=url.searchParams.get('page')||'1',page=Number(rawPage);
   if(!Number.isSafeInteger(page)||page<1||page>100000)throw httpError(400,'页码无效');
   const search=(url.searchParams.get('q')||'').trim().slice(0,40),pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
   const users=await pool.query(`SELECT a.user_id AS id,a.username,a.role,a.status,a.created_at,a.last_login_at,u.nickname
    FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.username ILIKE $1 OR u.nickname ILIKE $1 ORDER BY a.created_at,a.user_id LIMIT 20 OFFSET $2`,[pattern,(page-1)*20]);
   const count=await pool.query('SELECT count(*) FROM user_accounts a JOIN users u ON u.id=a.user_id WHERE a.username ILIKE $1 OR u.nickname ILIKE $1',[pattern]);
   json(res,200,{users:users.rows,total:Number(count.rows[0].count),page,page_size:20});return true;
  }
  const match=path.match(/^\/api\/admin\/users\/([0-9a-f-]{36})$/i);
  if(match&&method==='PATCH'){
   requireCsrf(req,session);const b=await body(req);
   if(!['active','disabled'].includes(b.status)||Object.keys(b).some(k=>k!=='status'))throw httpError(400,'仅可设置账号启用或禁用状态');
   if(match[1]===actor.id)throw httpError(400,'不能禁用或修改自己的管理状态');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(420241027)');
    const activeActor=await client.query("SELECT 1 FROM user_accounts WHERE user_id=$1 AND role='admin' AND status='active'",[actor.id]);
    if(!activeActor.rowCount)throw httpError(403,'管理员权限已失效');
    const changed=await client.query('UPDATE user_accounts SET status=$2 WHERE user_id=$1 RETURNING user_id',[match[1],b.status]);
    if(!changed.rowCount)throw httpError(404,'账号不存在');
    if(b.status==='disabled')await client.query('DELETE FROM auth_sessions WHERE user_id=$1',[match[1]]);
    await client.query('COMMIT');json(res,200,{ok:true});
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
   return true;
  }
 }
 return false;
}
