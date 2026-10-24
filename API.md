# 网页 Demo API

本机开发服务，绑定 127.0.0.1:3000。支持用户名密码登录和会话鉴权。菜单与推荐允许游客访问，个人数据按会话用户隔离；生产环境还需HTTPS与部署加固。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/state | 饮料、本人记录、偏好、收藏 |
| GET | /api/recommend?category=纯茶&budget=20&novel=true | 返回最多三款推荐及理由 |
| POST | /api/records | 新增记录 |
| PATCH | /api/records/:id | 更新本人记录的配置、金额、评分与备注 |
| DELETE | /api/records/:id | 删除本人记录，不存在或属于他人时返回404 |
| PUT | /api/preferences | 保存偏好 |
| POST | /api/favorites | 设置收藏状态 |
| GET | /api/export | 导出 JSON 数据 |

新增和修改记录请求：
```json
{"drink_id":"饮料UUID","sweetness_level":2,"ice_level":"less","price_paid":18,"rating":5,"note":"茶味很舒服"}
```
金额和评分允许 null。备注最多 1000 字。冰量枚举见 README。
修改记录不改变原饮料及名称快照。

收藏请求：`{"drink_id":"饮料UUID","active":true}`。

偏好请求：
```json
{"preferred_categories":["纯茶"],"preferred_flavors":["清爽"],"avoided_ingredients":[],"budget_max":25,"default_sweetness_level":2,"default_ice_level":"less"}
```

推荐规则：偏好匹配 +3，历史平均评分加权，近三天喝过 -3，开启尝鲜时未喝过 +4，先过滤品类与预算。相同分数稳定排序。

当前菜单来自大陆15品牌的第三方整理数据，价格为参考价；尚未收录完整原料数据，不能提供过敏原保证。

## 品牌菜单与来源

`GET /api/state` 的饮料新增 `source_key`、`source_url`、`source_region`、`source_checked_at`、`source_category`、`is_demo`、`price` 和 `ingredients`。未知价格为 `null`；空原料列表表示未收录完整配料，不表示没有过敏原。来源展示不代表实时在售。

`GET /api/recommend` 支持 `brand`（精确品牌名）、`category`、`budget`（金额或 `all`）、`includeUnknown=true`（显式包含价格未知的饮料）及 `novel=true`。默认排除未知价格；显式包含时返回价格待确认提示。

## 大陆15品牌范围与价格溯源

`catalog_scope` 提供15品牌范围、榜单出处和目标价格城市成都。`drinks` 仅返回当前有效菜单；`archived_drinks` 仅提供当前用户收藏或历史中引用的已移除饮品，用于保留收藏和编辑历史，不进入新记录菜单或推荐。PATCH只能修改原记录对应饮品，归档饮品允许补充评分但禁止新增饮用记录。

`reference_price` 是第三方整理参考价，`price_kind=third_party_reference`；`price_city`、`price_store`、`price_source_url`、`price_checked_at` 记录价格出处。当前未核验成都门店价，因此 `price=null`，参考价不参与预算判断。`source_label` 明确菜单整理方，`source_region=中国大陆`。

## 随机选品

`GET /api/random` 支持与推荐接口相同的 `brand`、`category`、`budget`（非负金额或 `all`）、`includeUnknown`、`novel`，以及 `exclude_id`（上次抽中的饮品ID）。返回 `{drink, candidate_count}`；无候选时为 `{drink:null,candidate_count:0}`，预算无效返回400。候选数量为按筛选与尝鲜条件匹配的数量；多于1款时从中排除上次结果后等概率抽取。不新增饮用记录。

完整菜单浏览基于 `/api/state` 的活动菜单，独立按品牌、品类和关键词过滤，包含未知价格产品，并按24款分批展示。

## 随机推荐模式

`GET /api/recommend?mode=random` 返回最多3款随机推荐数组，遵守原有筛选和尝鲜选项。`exclude_ids` 为上一组最多3个饮品ID，用逗号分隔；候选足够时整组换新，候选较少时补足已有候选，同组不会重复。默认不传mode仍为个性化评分推荐。界面“随机推荐”使用此模式，直接刷新推荐区。旧 `/api/random` 单杯接口保留兼容。

## 登录、账号与管理员接口

| 方法 | 路径 | 访问及行为 |
|---|---|---|
| POST | /api/auth/register | 注册普通账号并登录，字段username/password/nickname；无法通过请求设置角色或用户ID |
| POST | /api/auth/login | username/password登录，更新会话 |
| GET | /api/auth/me | 返回当前user及csrf_token；游客为null |
| POST | /api/auth/logout | 撤销当前会话并清除Cookie |
| PATCH | /api/account/profile | 登录用户修改nickname |
| POST | /api/account/password | current_password/new_password，校验旧密码并撤销所有会话 |
| GET | /api/admin/users?q=&page=1 | 管理员分页查找账号，每页20条，不返回密码或会话信息 |
| PATCH | /api/admin/users/:id | 管理员设置status为active/disabled；禁止修改自己的状态，禁用撤销目标会话 |

所有API写入请求必须使用 `Content-Type: application/json` 和 `X-Heleme-Request: 1`。已登录的业务及账号写入还需 `X-CSRF-Token`，其值从 `/api/auth/me` 或登录响应取得；会话通过HttpOnly Cookie携带，不使用localStorage令牌。浏览器仅允许同源写入。未登录返回401、越权或CSRF校验失败403、账号重复409、限流429。

`/api/state` 和推荐/随机接口允许游客访问，游客个人记录及收藏为空、偏好使用默认值；`/api/export` 和记录/收藏/偏好写入要求登录。前端传入user_id不会改变数据归属。管理员列表只展示账号元数据，无跨用户饮用记录读取接口。原单人数据仅由本机 `npm run user:admin` 安全接管，普通注册不会占有它。
