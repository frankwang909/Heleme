import pg from 'pg';
import {readFile} from 'node:fs/promises';

export function createPool(){return new pg.Pool({host:process.env.PGHOST||'127.0.0.1',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||'heleme',database:process.env.PGDATABASE||'heleme',password:process.env.POSTGRES_PASSWORD});}

export async function migrate(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(420241024)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const version of ['002_catalog_sources','003_mainland_catalog','004_accounts']){
   if(!(await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version])).rowCount){
    await client.query(await readFile(new URL(`../db/migrations/${version}.sql`,import.meta.url),'utf8'));
    await client.query('INSERT INTO schema_migrations(version) VALUES($1)',[version]);
   }
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
