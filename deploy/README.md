# singapore02 部署

站点：https://demo-site.zenmind.cc 。当前发布：`8651a8d-demo-site-20261013.1`（源码提交 `8651a8d`，已推送至 GitHub main；工作台、审批、差旅费用及分析接入 Go/SQLite，MCP 默认完整授权收敛为 11 个基础工具）。GitHub 仓库为 [linlay/demo-site](https://github.com/linlay/demo-site)。

公网 MCP：`https://demo-site.zenmind.cc/mcp`，支持 OAuth + PKCE 和手动 Bearer Token；默认完整授权提供 11 个基础工具，显式受限授权按 Scope 显示工具；重置工具关闭。登录入口为 `https://demo-site.zenmind.cc/api/v1/mcp/connect`，公开演示用户名和密码为 **demo / demo**。

- 服务器根目录：`/docker/demo-site`，仅保存发布产物、配置和持久数据，没有 Git 源码检出
- 构建产物：`releases/8651a8d-demo-site-20261013.1`（前后端重新构建，含 release.json 与 deployment-receipt.json）；Docker 镜像：`demo-site:8651a8d-demo-site-20261013.1`
- Compose：`/docker/demo-site/compose.yaml`；`.env` 指定 `AWCP_RELEASE`
- 容器：`demo-site-app-1`，自动重启；仅映射 `127.0.0.1:11983:2181`
- SQLite：`/docker/demo-site/data/awcp.sqlite`，目录归 UID/GID 65532 所有，独立于镜像持久化
- Nginx：`/etc/nginx/sites-available/demo-site.zenmind.cc.conf`，由 sites-enabled 同名链接启用
- TLS：`/etc/letsencrypt/live/demo-site.zenmind.cc`；webroot 为 `/var/www/demo-site`，证书到期日为 2027-01-10
- Certbot：沿用自动续期计时器；部署钩子为 `/etc/letsencrypt/renewal-hooks/deploy/demo-site-reload-nginx`
- 旧域名 `awcp-site.zenmind.cc`：已退役；用户已删除 DNS，服务器上的 Nginx 站点、证书及私钥、续期配置和 ACME webroot 已删除

新域名的 Cookie 和 localStorage 属于独立 origin；浏览器重新建立演示会话，MCP 客户端更新地址并重新授权。旧域名的浏览器存储不会自动迁入新域名。项目改名保留 `AWCP_*` 环境变量、Cookie 名、浏览器存储键及数据库文件名，以兼容现有配置和数据。

## 更新

依赖必须已按项目约定安装。运行 `pnpm --dir frontend run build` 与 `make build-linux TARGET_ARCH=amd64`，将 Dockerfile、.dockerignore、build/demo-site-server-linux、frontend/dist 和 deploy/runtime 打包到新版本 release 目录。远端执行 `docker build --network=none -t demo-site:<版本> releases/<版本>`，更新 `.env` 中的 `AWCP_RELEASE` 后执行 `docker compose up -d --pull never --no-build`。不得覆盖 data 目录。线上使用 standard 数据规模、公开 demo 登录及关闭的重置工具；不要直接使用模板默认值覆盖线上配置。

更新前备份 SQLite：优先使用 SQLite 在线 backup API；如采用文件复制，须先停止此应用容器，再复制整个 data 目录（含存在的 WAL/SHM 文件），完成后启动容器。不要只复制运行中的主数据库文件。当前未配置自动备份。

回滚时选择已保留且兼容当前数据库的旧镜像版本，修改 `AWCP_RELEASE` 后重新执行 `docker compose up -d --pull never --no-build`。改名前镜像仍以 `awcp-site:<版本>` 保留，回退使用前须将所选旧镜像标记为 `demo-site:<版本>`。数据库结构变更前必须独立备份；迁移 004、005、006 已应用，回退不支持迁移 006 的旧二进制需恢复匹配数据库备份，不能只切回旧镜像。

## 检查

```sh
ssh singapore02 'cd /docker/demo-site && docker compose ps && docker compose logs --tail=50'
curl -fsS https://demo-site.zenmind.cc/healthz
```

当前演示版本未接入 Go 的业务仍使用浏览器 repository，部署并不表示全部业务已经迁移到 SQLite。

## 2026-10-13 提交 8651a8d 全栈发布

实施：用户要求推送并重新部署。使用指定代理将 `a7808ec`、`8651a8d` 推送至 `linlay/demo-site` main，并确认远端 HEAD 为 `8651a8d274803eefb531e499514c73d37b059adc`。从干净工作区构建前端与 Linux/amd64 后端，发布 `demo-site:8651a8d-demo-site-20261013.1`；镜像构建禁用网络并写入源码 revision 标签，没有安装依赖。沿用线上 standard 数据规模、demo 公开登录、关闭的重置工具和既有 Nginx/TLS 配置。

迁移与备份：先在服务器的独立数据库副本和临时容器验证迁移 005→006、24,000 条历史样本的 standard 会话以及新业务 HTTP 查询，副本 `PRAGMA quick_check` 通过；临时容器及副本已清理。正式切换前停止应用，以 SQLite backup API 保存最后一致的数据库及 Compose/.env、Nginx 配置至 `/docker/demo-site/backups/20261013T044653Z-before-8651a8d-business`，`PRAGMA quick_check` 通过。备份包含 69 个空间和 1,656,000 条历史样本。迁移 006 成功，全站 AWCP 设置保留开启／版本 10；未重置演示空间。旧镜像与数据库备份继续保留。

验证：协议、计划及生成目录检查通过；lint、TypeScript、81 个前端测试文件共 204 项测试、完整 Go race 测试及前后端构建通过。隔离本机 SQLite 的业务冒烟通过审批、差旅和费用全流程、11 工具发现、幂等及共享网页状态，OAuth 冒烟也通过。公网首页、分析、导航及 O01/O08/O09 页面 200，HTML／前端主包 SHA-256 与本地产物一致；真实 HTTP demo 登录、默认完整 OAuth／PKCE 兑换、11 工具列表、MCP／网页业务读取、24,000 条历史样本查询、SSE ready 和 15 秒心跳通过。所有公网测试 Token 已逐一撤销并验证返回 401，诊断 OAuth 客户端与授权码已删除；公网没有执行审批、费用办理或空间重置。

发布清单和验收记录保存在 release 目录。旧 `context:read` 连接继续保持受限权限，使用业务能力需申请完整授权；已有完整授权连接重新同步工具列表。迁移 006 后回退至此前 `.1` 镜像需同时恢复匹配备份。本轮未重新完成真实 Desktop WebView 注入验收、完整场景浏览器视觉检查或备份恢复演练。构建仍有主包 841 KiB 体积告警。

- 后端 SHA-256：`5ea71026f08390421b9e86cf33bb57867efeb8bdcd36508b6d1e242499ae8c53`
- 前端 `assets/main.0ac0774d.js` SHA-256：`6a652b3be9c1236c6465de9a80735ec09d2b002ecb731ee4e50a9ce0658526c9`

## 2026-10-13 OAuth 浏览器登录与 Desktop 回调修复

原因：登录页的 `Referrer-Policy: no-referrer` 使浏览器原生表单提交携带 `Origin: null`，在密码校验前被 API 来源保护拒绝；修正来源策略后，Chrome 又因 `form-action 'self'` 拦截已登记的本地 OAuth 回调。此前手工设置 Origin 的 HTTP 验证没有覆盖这两项浏览器行为。

实施：MCP 登录页改用 `same-origin`，保持同源表单的真实 Origin；OAuth 授权页的 CSP 仅额外允许当前客户端已验证的回调 origin。来源校验、Cookie 绑定 nonce、一次性授权码、PKCE 及注册回调匹配继续生效，授权重定向保持 `no-referrer`。新增完整 HTTP 中间件回归测试，覆盖外部打开授权页、正常登录、非法来源、跨站提交、缺失 Cookie、nonce 重放及 PKCE 兑换。

部署：发布 `demo-site:4b1410c-demo-site-20261013.1`，使用 `.3` 镜像作为基础，仅替换 Go 二进制，沿用前端资产、配置和持久数据。未增加数据库迁移。发布前在线备份 SQLite 和 Compose/.env 至 `/docker/demo-site/backups/20261013T012833Z-before-oauth-origin-fix`，备份完整性检查通过；旧镜像保留。

验证：完整 Go 测试通过；修复前用独立 Chrome 在公网复现 `Origin: null` 与 403。修复后本地和公网 Chrome 均通过 `demo / demo` 原生表单登录、303 本地回调、state/issuer 绑定、PKCE Token 兑换及认证 MCP initialize；公网测试 Token 撤销后再访问返回 401，空来源与恶意来源仍返回 403。后端本地/服务器 SHA-256 一致：`7de0567b9c52fff968daae5ef0d985c09f4060d4c137d69045320a9d6352af43`。公网健康正常，全站 AWCP 设置沿用。未直接操作用户 Desktop 的授权会话。

旧登录表单的内存 nonce 在容器切换后失效，需从 Desktop 重新发起授权。前端没有变更，本轮未重跑前端测试或构建。

## 2026-10-12 旧域名退役

实施：用户删除 `awcp-site.zenmind.cc` 的 DNS 后，先停用旧域名 Nginx 站点并通过配置检查、重载，再通过 Certbot 删除独立证书及私钥、archive/live 目录和续期配置。已删除旧 ACME 空目录 `/var/www/awcp-site`、服务器根目录下两份闲置旧域名配置，以及本地旧域名跳转模板。新域名的证书、webroot、续期计时器及部署钩子继续保留。

验证：旧资源路径均不存在，Nginx、续期目录、钩子、systemd 和 cron 配置中没有旧域名引用；Nginx 配置检查通过并运行正常。新站首页 HTTP/2 200、HTTPS 健康接口及 AWCP 设置读取通过，新证书到期日仍为 2027-01-10，`certbot.timer` 已启用且运行中。本轮未执行证书续期 dry-run；Nginx 仍有既有的多站点 protocol options 重定义告警。

## 2026-10-12 AWCP 两种提供方式

已发布 `demo-site:4b1410c-demo-site-20261012.3`。Header 的“主动提供 AWCP”开关保存全站状态；开启由网站提供，关闭时网站不主动提供接口，保留 Desktop WebView 自行注入的接口。当前主动提供关闭（设置版本 3）。

实施：迁移 005 新增独立的站点设置表，配置独立于演示空间重置和 MCP。关闭时撤销网站旧接口引用、取消其在途请求，保留普通表单草稿；前端对已打开的可见页面每 15 秒读取设置，并在恢复焦点时同步。

备份：发布前在线备份 SQLite 及 Compose/.env 至 `/docker/demo-site/backups/20261012T065028Z-before-awcp-setting`，完整性检查通过，旧镜像保留。镜像构建禁用网络，不安装依赖。

验证：202 项前端测试、Go 全部测试、协议/计划检查、lint、类型检查和构建通过；本地覆盖 Desktop 先注入、后注入及网站入口撤销时的对象保留。公网初始关闭、开启、跨请求全站一致、过期设置版本拒绝、无 Cookie/错误来源拒绝、服务重启后开启状态保留、恢复关闭、页面路径和静态资源哈希通过。未执行 Desktop 实机注入、浏览器视觉或备份恢复演练；详细实施与验证见 [AWCP 提供方式记录](../docs/awcp-active-progress.md)。

迁移 005 应用后不能仅切回 `.2` 或更早镜像，需先恢复兼容的数据库备份。该次发布时，源码变更尚未提交或推送。

- 后端 SHA-256：`3171fcdb173725643906deae2b058517a7e01672501afe219679fd580e321f2f`
- 前端 `main.4093b777.js` SHA-256：`6b25a693d765378f9610d6094c2d7bf6ef4d615ebcb6b6f63bae2fff1a89fcb5`

## 2026-10-12 产品展示名称清理

实施：按用户补充的命名要求，产品名称统一为 `demo-site`。加载页和侧栏品牌、浏览器标题、MCP 登录页标题、发现元数据及相关中英文词条已清理旧产品称呼；侧栏说明使用“业务场景”。AWCP 仅保留为协议、接口及技术标识，业务页面的“工作台”名称继续按场景含义使用。命名规则已写入 AGENTS.md。本轮不变更依赖或业务合同。

部署：当前镜像为 `demo-site:4b1410c-demo-site-20261012.2`，此前镜像保留。发布前通过 SQLite 在线 backup API 备份至 `/docker/demo-site/backups/20261012T060312Z-before-branding-cleanup`，并保留 Compose 与 .env；备份完整性检查通过。沿用既有数据卷与 MCP 开关。

验证：lint、TypeScript、77 个前端测试文件共 195 项测试、全部 Go 测试、前端生产构建及 Linux/amd64 构建通过。线上健康接口、`<title>demo-site</title>`、MCP 连接页标题和发现元数据 `resource_name=demo-site MCP` 通过；本地及线上新产物 SHA-256 一致。浏览器工具未能启动，本轮未完成浏览器视觉验收；未重跑 OAuth PKCE 或 SSE 全流程，这些逻辑没有变更。

- 后端 `demo-site-server-linux`：`953ae45de26e2e9f88536a379e66c59979b1fa4c0944a97f3c1e474ecffe6ea6`
- 前端 `main.8d5b0251.js`：`70e788f0538a597632330f9f0817a1fa0dd10a931b109b044471d26e06e7c446`

## 2026-10-12 项目与域名改名

实施：开始前本地 Git 工作区干净，HEAD 为 `4b1410c`，origin 仍为 `linlay/awcp-examples`；已通过用户指定的代理确认 `linlay/demo-site` 的 main 与本地一致，并更新本地 origin。项目包名、Go 模块及 imports、MCP 服务名、浏览器标题、页面作用域、构建产物及部署模板统一为 `demo-site`。本机目录迁移至 `/Users/linlay/Project/zenmind-servers/demo-site`。保留协议 Action、protocolVersion 1、`manual` / `invoke` / `cancel` 与持久化兼容标识，不变更依赖版本，也不安装依赖。

部署：SQLite 在线备份和原 Compose、.env、Nginx 配置位于 `/docker/demo-site/backups/20261012T052812Z-before-demo-site`，备份完整性检查通过；原目录中的历史 releases、backups 及数据一起迁移，旧镜像保留。停止应用时数据库共有 46 个空间、1,104,000 条历史样本；目录移动前后的主数据库 SHA-256 一致：`18a4bd8f485ee58e4574f73e3bf0b45d9840eed819e4dfb3f0ccc1990e64121b`。未执行数据库迁移或演示空间重置。新镜像仅打包预构建产物，镜像构建禁用网络。

首次切换在 Nginx reload 后立即进行 TLS 校验时遇到旧证书，自动恢复原目录、Compose、容器和 Nginx。独立验证新证书实际加载后再次切换成功。公网复核发现既有 `/navigation` 路由未进入服务端 SPA 白名单，已补齐并扩充已有 HTTP 集成测试。发布修复前再次在线备份至 `/docker/demo-site/backups/20261012T053656Z-before-navigation-fix`，完整性检查通过。

验证：协议与计划静态检查、lint、TypeScript、77 个前端测试文件共 195 项测试、全部 Go 测试、前端生产构建和 Linux/amd64 构建通过；导航修复后重跑全部 Go 测试及 Linux 构建通过。公网 HTTPS 健康接口、页面和静态资源哈希、demo 登录、安全 Cookie、MCP 服务名、四个只读工具、24,000 条历史样本查询、OAuth 发现、动态注册与 PKCE 兑换、SSE ready 和 15 秒心跳、旧域名 308 跳转以及新域名 HTTP 至 HTTPS 跳转通过。测试 Token 均逐一撤销并验证撤销后返回 401。最终导航页直达通过。

最终产物 SHA-256：

- 后端 `demo-site-server-linux`：`7738ccde6c62ad744f68bdfd657b3c70d4bc7eb44281bd23ae8eb085aecaa248`
- 前端 `main.da0a3059.js`：`eb9ac3cb2936395c004b6c6448058cb5b68cbad7c8d5aa284902fbf419bd68f8`

本轮未执行证书续期 dry-run、备份恢复演练、容量压测或全部 31 场景的浏览器视觉验收。前端构建仍有主包体积告警；Nginx 存在既有的多站点 protocol options 重定义告警。发布包上传曾被自动审批要求明确授权，用户批准后完成上传与部署。

以下记录保留当时的路径、域名和镜像名称；原 `/docker/awcp-site` 下的历史文件已整体移到 `/docker/demo-site`。

## 2026-10-03 更新

已将应用从 `4dcfdbf` 更新到 `11fe473`，包含工作台信息密度优化及 MCP 连接入口。线上沿用 standard 数据规模和现有 Nginx/TLS 配置，显式设置 `AWCP_MCP_ENABLED=false`；公网 MCP 启用操作被自动审批拒绝，尚未生成凭据或开放 MCP。线上 Compose 保留原有配置，仅更新镜像版本并禁用 MCP，与仓库的部署模板不同。

部署前通过 SQLite 在线 backup API 创建 `/docker/awcp-site/backups/20261003T033707Z-before-11fe473/awcp.sqlite`，完整性检查通过，同目录保留原 `.env` 与 Compose。旧镜像保留。

验证：前端生产构建、Linux/amd64 后端构建及后端测试通过；仍有前端包体积提示。容器运行 `awcp-site:11fe473`，HTTPS 健康接口、会话接口及四个 SPA 路径通过，线上主 JS 的 SHA-256 与本地构建一致。本次未重新执行前端全量测试、浏览器视觉验收、MCP 公网验收或备份恢复演练。

## 2026-10-03 公网 MCP 启用

用户明确授权后，已在现有 `11fe473` 镜像上启用 MCP，不重新构建镜像或安装依赖。Compose 从 `.env` 读取开关、用户名与必填密码，公网地址固定为 `https://awcp-site.zenmind.cc/mcp`，`AWCP_MCP_RESET_ENABLED=false`。独立随机密码保存在服务器 `/docker/awcp-site/.env`（权限 0600），不写入仓库；凭据通过本次任务交付给用户。

实施前使用 SQLite 在线 backup API 备份数据库并通过完整性检查，目录为 `/docker/awcp-site/backups/20261003T041657Z-before-mcp-enable`，同时保留 Compose、`.env` 和 Nginx 配置。应用继续使用原数据卷和 standard 数据规模。仅重建 app 容器并重载 Nginx；MCP 路由禁用代理缓冲，OAuth 与登录路由关闭访问日志。Nginx 配置检查通过，其他既有站点仍有 TLS protocol options 重复配置告警。

已执行公网验证：健康接口 200、会话 `mcpAvailable=true`、连接地址正确、匿名 MCP 请求 401 与发现挑战、资源及授权服务器元数据、真实密码登录签发 Token、四个只读工具、历史样本查询，以及动态客户端注册、OAuth 同意、PKCE 兑换和授权 MCP 请求。测试令牌均已撤销，并验证撤销后返回 401；未执行重置工具或业务写操作。本次未执行备份恢复演练。

## 2026-10-03 公开演示凭据

实施：按用户要求把线上用户名和密码设为 `demo / demo`，启用 `AWCP_MCP_PUBLIC_DEMO_LOGIN=true`。新增显式模式允许固定的公开演示凭据，并在连接登录页及 OAuth 授权登录页显示。关闭该模式时仍保留公网自定义密码校验；开启时拒绝混用自定义凭据，避免展示其他密码。沿用四个读取工具及原数据卷。

部署：后端重新构建为 Linux/amd64，复用 `11fe473` 的前端资产，创建独立镜像 `awcp-site:11fe473-demo-login-20261003`。发布前备份配置和 SQLite 至 `/docker/awcp-site/backups/20261003T043531Z-before-public-demo-login`，数据库完整性检查通过。新二进制本地与远端 SHA-256 一致：`5f7360e90a1e45365e8bc1558b3235f874aa54f7fade4c9a3d9751b1331ec69b`。旧镜像和配置备份保留。

验证：全部后端测试及 Linux 构建通过；新增测试覆盖公开模式配置、私有密码不展示、两种登录页提示与两种登录流程。公网 HTTP 验证登录页提示、正确密码登录、错误密码拒绝、OAuth 发现、动态注册、PKCE 兑换、MCP 四个读取工具与历史查询通过；测试令牌已撤销并验证返回 401。密码变更会使旧 Token 失效。浏览器预览工具超时，本轮没有完成视觉验收；页面内容与登录功能已通过真实 HTTPS 验证。未修改前端源码，未重新运行前端测试。


## SSE 上线（2026-10-03）

已将提交 `1e76cf2` 的前端与 Linux/amd64 后端重新构建并部署。部署前在线备份 SQLite 及 `.env`、Compose、Nginx 至 `/docker/awcp-site/backups/20261003T073445Z-before-1e76cf2-sse`，数据库完整性检查通过；旧镜像继续保留。迁移 004 已应用，浏览器凭证与共享空间分离。回退此迁移必须恢复匹配的旧数据库备份，不能只切回旧镜像。

Nginx 在既有配置中新增 SSE 精确路由，禁用代理缓冲、缓存与 gzip，设置 65 秒读取超时并启用 HTTP/2。原 MCP/OAuth 路由、公开 demo/demo 登录和只读工具范围保持不变。配置校验通过，仍有同端口多个站点 protocol options 重定义告警。

验证：容器 `awcp-site:1e76cf2` 持续运行；公网 TLS 和 HTTP/2 健康接口 200；会话与 24,000 条历史样本查询正常；公网 SSE 的 ready、15 秒心跳和禁用压缩通过；OAuth 发现与登录入口正常；实际登录的两套浏览器凭证同时访问同一 MCP 空间及 SSE；四个只读 MCP 工具、上下文和分析调用通过。本次测试令牌已逐一撤销，没有执行空间重置或业务写操作。前端主包与 Linux 二进制本地／远端 SHA-256 一致：

- 后端：`bcb1ca91b600f514ab31f497a494c6d3de1e4cff98ed2e5e7578bbca62f78987`
- 前端 `main.8f01934d.js`：`0cd3a4d4518fc044318c302bdf395778ed3f152b7e51c1a61eac027581dfa491`

未执行线上空间重置、备份恢复演练、容量压测或完整 OAuth PKCE 重跑；相关实现和本地验证见 [SSE 实施记录](../docs/realtime-progress.md)。前端构建仍有主包体积告警。
