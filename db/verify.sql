\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE u uuid; d uuid; r uuid;
BEGIN
 INSERT INTO users(nickname) VALUES ('验证用户') RETURNING id INTO u;
 INSERT INTO drinks(brand_name,name,category) VALUES ('测试品牌','测试饮料','奶茶') RETURNING id INTO d;
 INSERT INTO drink_records(user_id,drink_id,brand_name_snapshot,drink_name_snapshot,rating) VALUES(u,d,'测试品牌','测试饮料',5) RETURNING id INTO r;
 INSERT INTO favorites(user_id,drink_id) VALUES(u,d);
 BEGIN
  INSERT INTO favorites(user_id,drink_id) VALUES(u,d);
  RAISE EXCEPTION 'duplicate favorite accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
  UPDATE drink_records SET rating = 6 WHERE id = r;
  RAISE EXCEPTION 'invalid rating accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE drink_records SET price_paid = -1 WHERE id = r;
  RAISE EXCEPTION 'negative price accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 DELETE FROM drinks WHERE id = d;
 IF NOT EXISTS(SELECT 1 FROM drink_records WHERE id = r AND drink_id IS NULL AND drink_name_snapshot='测试饮料') THEN
  RAISE EXCEPTION 'snapshot preservation failed';
 END IF;
 IF EXISTS(SELECT 1 FROM favorites WHERE user_id=u) THEN RAISE EXCEPTION 'favorite cascade failed'; END IF;
END;
$$;
ROLLBACK;
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
