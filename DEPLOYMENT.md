# 部署与验证

## 当前交付范围
网页版、Node.js API、PostgreSQL 17业务及账号表、迁移与验证脚本；已支持用户名密码登录，小程序与微信/手机号登录尚未接入。

## 开发部署
要求 Docker Engine 和 Docker Compose v2；在项目根目录执行。

1. 创建 `.env`，写入 `POSTGRES_PASSWORD=你生成的随机长密码`。该文件不提交、不分享。可复制 `.env.example` 后修改。
2. 执行 `docker compose up -d --wait`。
3. 执行 `docker compose exec db psql -U heleme -d heleme` 连接数据库。
4. 执行 `docker compose exec -T db psql -U heleme -d heleme < db/verify.sql` 验证。测试使用事务回滚，不保留测试数据。

数据库名及开发用户名均为 heleme，端口仅绑定本机 127.0.0.1:5432。容器之间通过服务名 db 连接。

## 数据与迁移规则
- 数据保存在 Docker 命名卷 heleme_pgdata，停止容器不删除数据。
- 初始 SQL 只在空数据卷首次启动时执行。修改初始文件不会更新已有数据库。
- 后续结构变更新增编号迁移文件；审核后使用 psql 的 ON_ERROR_STOP 执行，并记录迁移版本。
- 不要执行 `docker compose down -v`，除非明确需要永久删除开发数据。
- 当前云工作区是开发环境，不能视为永久生产托管或备份。

## 上线前要求
- 当前 Compose 为开发配置；生产需创建受限应用账号，初始化管理员不用于业务请求。
- 数据库留在私网；网页和小程序通过 HTTPS 后端 API 访问，不直接连接数据库。
- 使用密钥管理或服务端环境变量注入密码；配置自动备份并演练恢复。
- 为生产迁移增加版本管理，迁移前备份，不通过重建数据卷升级。
- 微信 AppID、登录与合法请求域名在后端及小程序接入阶段配置；国内部署按实际情况准备备案。

## 当前验证结果
已在 PostgreSQL 17 执行初始迁移并确认六张表存在；验证了评分范围、非负金额、收藏唯一性、删除饮料后快照保留及收藏级联删除。

## 网页启动与交付范围更新

网页和 API 由同一个 Node.js 服务提供，使用真实 PostgreSQL 持久化。

1. 安装 Node.js 22+，在根目录运行 `npm ci`。
2. 启动数据库：`docker compose up -d --wait`。
3. 启动网页和 API：`npm start`。
4. 本机浏览器打开 http://127.0.0.1:3000 。
5. 保持服务运行，另一个终端运行 `npm test`。

服务器默认绑定回环地址；已支持账号登录和个人数据隔离，未配置生产托管。菜单为采集的大陆中文产品，没有填充饮用历史。
当前环境缺少 Sites 构建和源码同步辅助脚本，因此尚未生成外部在线地址。源码包可在具备上述环境的电脑启动。

后续真实上线需要：域名与TLS配置审核、受限数据库账号、HTTPS 反向代理、运行监控与备份；前端继续调用同域 `/api`。

## 快速启动

macOS/Linux/WSL 在项目目录执行 `bash start-demo.sh`。脚本仅在 `.env` 不存在时生成密码，不覆盖已有配置，不删除数据卷。需要可用的 Docker 和 Node.js。

### macOS 启动排查

- 使用 fnm 时，先执行 `eval "$(fnm env --use-on-cd --shell zsh)"`，再用 `node --version` 确认版本至少为 22。
- 出现 `unknown shorthand flag: 'd' in -d` 时，检查 `command -v docker` 和 `docker compose version`，确认 Docker Desktop 自带的 CLI 和 Compose 插件可用；安装或更新后重新打开终端。
- 用 `docker desktop status` 和 `docker info` 确认 Docker Desktop 已启动且引擎可连接。启动脚本会在 Compose 不可用或引擎不可连接时给出提示。
- 出现 `EADDRINUSE` 时，用 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 检查是否已有网页服务运行；若是当前项目，可直接访问网页，无需重复启动。
- 停止数据库使用 `docker compose stop`，保留数据卷；不要执行 `docker compose down -v`。

## 验证限制

已完成 JavaScript 语法检查、Node 测试及数据库约束验证。当前工具缺少浏览器控制能力，尚未进行浏览器端视觉及交互自动化验收；需在本机浏览器检查移动布局、弹窗、导出及完整点击流程。

## 本机目录与数据迁移（2026-10-24）

项目根目录为 `/Users/wfighter/Projects/Heleme`。Compose 项目、数据库和账号名称均为 `heleme`，使用显式命名卷 `heleme_pgdata`。旧卷 `helema_pgdata` 保留为迁移前副本，不用于当前服务。迁移前数据库备份位于 `backups/before-heleme-rename.dump`，该目录已被 Git 忽略，请勿分享。`heleme-source-legacy.zip` 是更名前的历史源码归档，不代表当前配置。

## 大陆15品牌菜单（当前配置）

`data/brands.json` 固定15品牌及大陆中文范围，目标价格城市成都。首批采集每品牌前3页，共853款；`npm run catalog:crawl -- --max-pages 10` 可扩大采集范围。普通导入 `npm run catalog:import`，显式替换当前范围使用 `npm run catalog:import -- --replace-scope`。启动脚本会导入随项目保存的数据集。002、003迁移由服务及导入脚本按版本执行。

旧品牌/海外菜单从当前菜单移除，数据库中以inactive保留其历史引用。替换前已备份至 `backups/before-mainland-top15.dump`。没有删除数据卷。第三方参考价有独立字段，未取得成都美团门店价格前不填核验售价，公开入口核验结果在 `data/price-sources.json`。

## 账号部署与运维

启动或导入命令会增量执行004_accounts迁移，新增user_accounts、auth_sessions和auth_rate_limits，不删除原users及其关联数据。首次管理员执行 `npm run user:admin`，在TTY终端交互输入用户名、昵称和不回显密码；可继承尚未绑定账号的原本机用户数据。公开注册不分配管理员权限。服务没有内置默认密码。

登录会话存储在数据库，重启服务不丢失；禁用账号或修改密码撤销对应会话。会话令牌只存哈希，密码为随机盐scrypt哈希。备份数据库仍包含敏感个人信息和密码哈希，应继续限制备份目录权限，不提交Git。

测试会创建并清理临时账号，验证隔离、CSRF、登录限流、改密/退出/禁用后的会话失效及原业务。当前只开放127.0.0.1；如果以后上线，需要HTTPS与受信主机配置、Secure Cookie（COOKIE_SECURE=1）、受限数据库账号、日志/备份及找回密码方案；不应直接将本地端口转发作为正式服务。
