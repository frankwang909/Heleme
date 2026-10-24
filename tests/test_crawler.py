import importlib.util
import json
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('crawler',Path(__file__).resolve().parents[1]/'scripts/crawl-catalog.py')
crawler=importlib.util.module_from_spec(spec);spec.loader.exec_module(crawler)
DATE='2026-10-24T00:00:00+00:00'
BRAND={'name':'蜜雪冰城'}
URL='https://www.nckfhsm.com/brands/mi-xue-bing-cheng/menu/available'

def page(names,heading='蜜雪冰城在售饮品菜单'):
    products=[{'item':{'name':name,'url':f'https://www.nckfhsm.com/products/test-{i}'}} for i,name in enumerate(names)]
    raw='<h1>'+heading+'</h1><script type="application/ld+json">'+json.dumps({'@type':'ItemList','itemListElement':products})+'</script>'
    for item in products:
        p=item['item'];raw+=f'<div class="group shadow-sm"><a href="{p["url"]}">{p["name"]}</a>¥7</div>'
    return raw

class CrawlerTests(unittest.TestCase):
    def test_reference_price_is_not_a_verified_chengdu_price(self):
        rows,_=crawler.parse_source(BRAND,page(['珍珠奶茶']),DATE,URL)
        self.assertEqual(rows[0]['reference_price'],7)
        self.assertIsNone(rows[0]['price']);self.assertIsNone(rows[0]['price_city'])
        self.assertEqual(rows[0]['source_region'],'中国大陆')
        self.assertEqual(rows[0]['price_kind'],'third_party_reference')
    def test_foreign_names_foreign_specials_food_and_bundles_are_excluded(self):
        rows,_=crawler.parse_source(BRAND,page(['Coconut Latte','香港限定奶茶','蛋糕','双杯套餐','草莓大圣代','珍珠奶茶']),DATE,URL)
        self.assertEqual([r['name'] for r in rows],['珍珠奶茶'])
    def test_unexpected_brand_or_empty_page_fails(self):
        for raw in [page(['奶茶'],'星巴克菜单'),'<html>redirect</html>',page([])]:
            with self.assertRaises(ValueError):crawler.parse_source(BRAND,raw,DATE,URL)
    def test_stable_key_does_not_change_with_collection_date(self):
        a,_=crawler.parse_source(BRAND,page(['珍珠奶茶']),DATE,URL)
        b,_=crawler.parse_source(BRAND,page(['珍珠奶茶']),'2026-10-25T00:00:00+00:00',URL)
        self.assertEqual(a[0]['source_key'],b[0]['source_key'])
    def test_pagination_only_returns_explicit_links(self):
        _,links=crawler.parse_source(BRAND,page(['珍珠奶茶'])+'<a href="'+URL+'?page=2">下一页</a>',DATE,URL)
        self.assertIn(URL+'?page=2',links)

if __name__=='__main__':unittest.main()
