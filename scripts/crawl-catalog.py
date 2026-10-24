#!/usr/bin/env python3
"""Fetch a small allowlist of public brand menus; never contact ordering/login APIs."""
import argparse
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent



class Element:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def all(self, predicate):
        for child in self.children:
            if isinstance(child, Element):
                if predicate(child):
                    yield child
                yield from child.all(predicate)

    def has(self, cls):
        return cls in self.attrs.get('class', '').split()

    def text(self):
        return re.sub(r'\s+', ' ', ' '.join(c.text() if isinstance(c, Element) else c for c in self.children)).strip()


class DOM(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, text):
        self.stack[-1].children.append(text)


def first(node, cls):
    return next(node.all(lambda n: n.has(cls)), Element()).text()


def category_for(name):
    if re.search(r'咖啡|美式|澳白|馥芮白|冷萃|卡布|拿铁', name) and not re.search(r'红茶拿铁|绿茶拿铁|抹茶拿铁|幽兰拿铁|茶拿铁', name): return '咖啡'
    if re.search(r'奶盖|奶霜|芝士|奶芙|一朵|一口', name): return '奶盖茶'
    if re.search(r'奶茶|珍奶|烧仙草|奶绿|薯圆', name): return '奶茶'
    if re.search(r'奶白|鲜奶|牛乳|轻乳|拿铁|伯牙|白兰|白雾|山野栀子', name): return '鲜奶茶'
    if re.search(r'果|柠|橙|橘|葡萄|芒|桃|荔枝|杨梅|杨枝|椰|西瓜|蜜瓜|芭乐|莓|桑葚', name): return '果茶'
    if re.search(r'奶昔|酸奶', name): return '奶昔'
    if re.search(r'纯茶|原茶|冰茶|绿茶|红茶|乌龙|龙井|单丛|茉莉', name): return '纯茶'
    return '茶饮'


def parse_source(brand, raw, checked, page_url):
    dom = DOM(raw).root
    heading = next(dom.all(lambda n: n.tag == 'h1'), Element()).text()
    aliases = [brand['name']]
    if brand['name'] == '1点点': aliases.append('一点点')
    if not any(name.lower() in heading.lower() for name in aliases) or '在售饮品' not in heading:
        raise ValueError(f"{brand['name']}: 不是预期的简体中文菜单页面")
    products = []
    for node in dom.all(lambda n: n.tag == 'script' and n.attrs.get('type') == 'application/ld+json'):
        data = json.loads(node.text())
        if data.get('@type') == 'ItemList':
            products.extend(x['item'] for x in data.get('itemListElement', []))
    cards = list(dom.all(lambda n: n.tag == 'div' and n.has('group') and n.has('shadow-sm')))
    rows = []
    for item in products:
        name, url = item['name'].strip(), item['url']
        if not url.startswith('https://www.nckfhsm.com/products/') or not re.search(r'[\u4e00-\u9fff]', name): continue
        if re.search(r'套餐|双杯|三杯|任选|周边|杯套|购物袋|冰箱贴|蛋糕|烤红薯|烤地瓜|烤番薯|蛋挞|饼干|面包|薯条|鸡块|咖啡豆|茶包|挂耳|纯净水', name): continue
        if re.search(r'圣代|脆筒|冰淇淋|冰激凌|雪顶冰', name) and not re.search(r'奶茶|红茶|咖啡|奶昔|拿铁', name): continue
        if re.search(r'(?:香港|澳门|台湾|新加坡|马来西亚|海外)(?:限定|版|门店)', name): continue
        card = next((c for c in cards if any(a.attrs.get('href') == url for a in c.all(lambda n: n.tag == 'a'))), None)
        if card is None: raise ValueError(f'找不到产品卡片：{name}')
        price = re.search(r'[¥￥]\s*(\d+(?:\.\d+)?)', card.text())
        amount = float(price[1]) if price else None
        if amount is not None and not 0 < amount <= 100: continue
        rows.append(dict(source_key=hashlib.sha256((brand['name']+'\0'+name+'\0中国大陆').encode()).hexdigest()[:32],
                         brand_name=brand['name'],name=name,category=category_for(name),flavor_tags=[],ingredients=[],price=None,
                         reference_price=amount,price_kind='third_party_reference' if amount else 'unknown',
                         price_city=None,price_store=None,price_source_url=url if amount else None,price_checked_at=checked if amount else None,
                         source_label='咖啡奶茶喝什么（第三方整理）',source_url=url,source_region='中国大陆',
                         source_checked_at=checked,source_category='项目按名称整理',menu_page_url=page_url))
    if not products or len(products)>100: raise ValueError(f"{brand['name']}: 产品数量异常")
    links = [n.attrs.get('href','') for n in dom.all(lambda n: n.tag == 'a')]
    return rows, links


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--max-pages', type=int, default=3, help='每品牌首批最多采集页数，默认3页；最多50页')
    opts = parser.parse_args()
    if not 1 <= opts.max_pages <= 50: parser.error('--max-pages 必须为1到50')
    config = json.loads((ROOT/'data/brands.json').read_text())
    if len(config['brands']) != 15 or config['market'] != '中国大陆': raise ValueError('品牌范围配置异常')
    cache = ROOT/'data/sources'; cache.mkdir(parents=True, exist_ok=True)
    rows, sources = [], []
    for brand in config['brands']:
        count, has_more = 0, False
        for page in range(1,opts.max_pages+1):
            url = brand['url'] + (f'?page={page}' if page>1 else '')
            path = cache/f"cn-{brand['slug']}-{page}.html"
            if not opts.offline:
                req=Request(url,headers={'User-Agent':'HelemeCatalog/2.0 (local public menu research)'})
                with urlopen(req,timeout=30) as response:
                    if response.status!=200 or response.geturl()!=url: raise ValueError(f'{url}: 意外响应或重定向')
                    body=response.read(5_000_001)
                    if len(body)>5_000_000: raise ValueError('响应过大')
                path.write_bytes(body)
                time.sleep(1)
            raw=path.read_text(encoding='utf-8')
            checked=datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat()
            products,links=parse_source(brand,raw,checked,url)
            rows.extend(products);count+=len(products)
            sources.append(dict(brand=brand['name'],url=url,checked_at=checked,count=len(products),sha256=hashlib.sha256(raw.encode()).hexdigest()))
            has_more=brand['url']+f'?page={page+1}' in links
            if not has_more: break
        print(f"{brand['name']}: {count} 条，采集 {page} 页"+('（仍有后续页）' if has_more else ''),flush=True)
    unique={}
    for row in rows: unique.setdefault(row['source_key'],row)
    if set(r['brand_name'] for r in unique.values()) != set(b['name'] for b in config['brands']): raise ValueError('未覆盖全部15品牌，取消更新')
    payload=dict(schema_version=2,scope=config,sources=sources,drinks=list(unique.values()),
                 notes=f'首批每品牌最多{opts.max_pages}页；仅简体中文大陆菜单；第三方参考价未经成都门店核验，不是美团实时价；不包含完整配料。')
    target=ROOT/'data/catalog.json';temp=target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');temp.replace(target)
    print(f'合计 {len(unique)} 款 / 15 品牌，已保存，尚未导入数据库',flush=True)


if __name__=='__main__': main()
