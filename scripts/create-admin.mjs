import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {createPool,migrate} from '../server/database.mjs';
import {createAccount} from '../server/auth.mjs';

if(process.argv.includes('--help')){
 console.log('npm run user:admin：交互创建管理员，密码不回显。首个本机管理员接管尚未绑定账号的原单人数据。');
 process.exit(0);
}
if(!stdin.isTTY){console.error('请在本机交互终端执行 npm run user:admin，密码不会回显，也不接受命令行或环境变量密码。');process.exit(1);}
function secret(prompt){
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  const done=(error)=>{stdin.off('data',receive);stdin.setRawMode(false);stdin.pause();stdout.write('\n');error?reject(error):resolve(value);};
  const receive=buffer=>{
   for(const char of buffer.toString('utf8')){
    if(char==='\u0003'){done(Error('已取消'));return;}
    if(char==='\r'||char==='\n'){done();return;}
    if(char==='\u007f'||char==='\b'){value=[...value].slice(0,-1).join('');continue;}
    if(char>=' ')value+=char;
   }
  };
  stdin.on('data',receive);
 });
}
const pool=createPool();
try{
 const rl=createInterface({input:stdin,output:stdout});
 const username=(await rl.question('管理员用户名（3–32位字母、数字、下划线）：')).trim();
 const nickname=(await rl.question('显示昵称（可留空）：')).trim()||username;rl.close();
 const password=await secret('管理员密码（10–128个字符，不回显）：');
 if(password!==await secret('再次输入密码：'))throw Error('两次密码不一致');
 await migrate(pool);
 const user=await createAccount(pool,{username,nickname,password,role:'admin',claimLegacy:true});
 console.log(`管理员 ${user.username} 已创建。${user.claimedLegacy?'原有单人记录、收藏与偏好已归属此账号。':''}请在网页登录。`);
}catch(e){console.error(e.code?'创建失败，请检查数据库连接或用户名是否重复。':e.message);process.exitCode=1;}finally{await pool.end();}
