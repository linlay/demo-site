# demo-site MCP：运行与连接

## 本地使用

沿用已安装的 Go/前端依赖，没有新增身份服务、数据库容器或安装步骤。

```sh
pnpm run dev
```

打开 <http://127.0.0.1:2181/api/v1/mcp/connect>，输入 **demo / demo**，复制页面中的 Access Token。

也可从业务网站总 Header 的 **MCP 连接** 进入：查看并复制服务地址、选择 OAuth 或手动 Token 接入，展开 OAuth 发现地址。登录页在新标签页打开。地址使用会话返回的后端连接配置，不使用前端开发服务器端口；服务未启用或连接信息不可用时会显示对应提示。

- MCP URL：`http://127.0.0.1:2181/mcp`
- 认证：`Authorization: Bearer <Access Token>`
- Token 有效期：一小时，过期重新登录。
- 同一 demo 账号共享一个演示空间；网页登录只轮换当前浏览器 Cookie，其他浏览器的有效凭证继续可用。
- 页面提供“撤销此账号的全部 MCP Token”。撤销同时清除未兑换授权码并断开空间；令牌只保存哈希，不写入浏览器存储。

Node/pnpm 只用于开发和构建。已有前端构建后可直接 `make dev-backend`；打包运行只需要 Go 可执行文件、前端静态文件和 SQLite 数据文件。Docker 是可选打包方式。

默认使用 48 条历史样本的小型数据集；设置 `AWCP_DATA_PROFILE=standard` 才为新空间生成 24,000 条压测样本。已有空间不会因修改默认值被覆盖。

## 配置

服务读取进程环境，不自动读取 `.env`。完整变量见根 `.env.example`。

| 变量 | 本地默认值 | 用途 |
| --- | --- | --- |
| AWCP_MCP_ENABLED | true | 开关 |
| AWCP_MCP_PUBLIC_URL | http://127.0.0.1:2181/mcp | 精确 MCP 地址，issuer 使用同一 origin |
| AWCP_MCP_USERNAME | demo | 演示账号 |
| AWCP_MCP_PASSWORD | demo | 演示密码 |
| AWCP_MCP_PUBLIC_DEMO_LOGIN | false | 显式允许公开 demo / demo，并在两种登录页显示凭据 |
| AWCP_MCP_RESET_ENABLED | false | 是否开放重置工具 |
| AWCP_MCP_MAX_CONCURRENT | 8 | MCP 请求并发上限 |

公网使用 HTTPS、精确的 `AWCP_ALLOWED_ORIGINS`，默认要求自定义密码（至少八位）。纯公开演示站可以显式设置 `AWCP_MCP_PUBLIC_DEMO_LOGIN=true`，同时把用户名和密码均设为 `demo`；连接登录页和 OAuth 授权登录页会显示“用户名 demo，密码 demo”。该模式只接受固定演示凭据，不展示自定义密码。修改账号、密码、issuer 或资源地址后，旧令牌和授权码失效。原有部署 Compose 默认保持 MCP 关闭；启用时设置 `AWCP_MCP_ENABLED=true` 并选择上述登录模式，仍只有 app 一个容器。

## 标准 OAuth 客户端

除手动粘贴 Token 外，也支持客户端浏览器登录授权：

1. 客户端访问 `/mcp`，401 的 `WWW-Authenticate` 指向资源发现文档。
2. `/.well-known/oauth-protected-resource/mcp`（同时提供根路径别名）声明资源、Scope 和 issuer。
3. `/.well-known/oauth-authorization-server` 提供 RFC 8414 元数据。
4. `/oauth/register` 支持公共客户端动态注册（`token_endpoint_auth_method: "none"`），最多八个精确 HTTPS 或回环 HTTP 回调地址；不允许通配符、用户信息或 fragment。
5. `/api/v1/mcp/oauth/authorize` 展示客户端名称、回调和权限；输入 demo 账号密码并确认授权。
6. `/oauth/token` 只支持 `authorization_code`，要求 S256 PKCE，授权码绑定客户端、回调、资源、Scope、配置凭据，五分钟有效且只用一次。
7. `/oauth/revoke` 接收 token 和 client_id，撤销该客户端令牌。

授权和兑换请求均携带 `resource=<精确 MCP URL>`。授权回调包含 `state` 和 `iss`。所有客户端使用公共客户端 + PKCE；不实现机密客户端、OIDC、CIMD、刷新令牌、密码 grant、企业 SSO 或多用户管理，也不在元数据中宣称支持它们。用户名密码表单是本应用的登录页面，不是 OAuth 密码 grant。

标准流程适用支持动态注册或已注册 client_id 的 MCP 客户端；仅支持其他注册机制的客户端可使用手动 Bearer Token。官方依据：[MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。

## 可用工具

默认完整授权包含 `context:read directory:read reports:read business:read business:write`，提供 11 个基础工具。所有连接均须包含 `context:read`，下表是各工具追加要求的 Scope。省略 OAuth `scope` 时使用完整范围，登录授权页仍明确展示权限；显式申请较少权限时保持限制，不升级旧令牌。开启重置并授权 `demo:reset` 才增加 2 个重置工具。精确目录见 [tools.json](../contracts/mcp/tools.json)。

| 能力 | 工具 | Scope |
| --- | --- | --- |
| 空间、场景支持与流转能力 | `context_get` | context:read |
| 组织人员与虚构角色 | `directory_query` | directory:read |
| 待办／已办筛选与分页 | `tasks_query` | business:read |
| 审批／差旅／费用列表或详情 | `records_query` | business:read |
| 提交或重提通用审批 | `approval_submit` | business:write |
| 提交差旅申请 | `travel_submit` | business:write |
| 保存现有差旅草稿 | `travel_draft_save` | business:write |
| 登记虚构票据元数据 | `receipt_register` | business:write |
| 核验保存费用或补正退回单 | `expense_prepare` | business:write |
| 执行一步业务流转 | `workflow_transition` | business:write |
| 实时／历史数据分析 | `analysis_query` | reports:read |
| 可选空间重置 | `workspace_reset_preview`、`workspace_reset_execute` | demo:reset |

先调用 `context_get` 获取 `generation`，再在业务查询／办理中传 `expectedGeneration`。`directory_query` 列出虚构员工和角色；`actorId` 只在当前已授权演示空间中模拟这些角色。写操作需稳定 `idempotencyKey`，已有单据还需当前 `expectedVersion`；新申请／费用校验使用版本 0。新通用审批的 `requestId` 为 null，退回／撤回重提则传原 ID。权限、角色、版本与幂等由同一 Go service 检查。

`tasks_query` 的 `status` 为 `open`（默认）或 `done`，`kind` 可选 approval／travel／expense。`from`、`to` 是含首尾的北京时间日历日期：待办按截止日筛选，已办按完成日筛选。返回 `total` 是筛选后总数；需要明细计算时按 `page`／`pageSize` 读取全部页。

`records_query` 的 `kind` 选择三类单据；省略 `id` 为分页列表，指定 `id` 为详情。详情查询不能混传关键词、状态或分页参数。单据和关联任务、历史来自同一次读取；审批查询附 `materials`，差旅详情附 `assets`，可直接用于提交资料、草稿关联或票据核验。

`workflow_transition` 每次只执行一个动作，传单据 `id`、`kind`、`action` 以及当前版本。审批、退回和撤回必须给出 `opinion`。

| kind | 合法 action |
| --- | --- |
| approval | approve、return、withdraw |
| travel | approve、return、resubmit |
| expense | submit、approve、return |

按日汇总由分别查询待办／已办、读取所需明细后计算；办理待办则先读取任务的 `sourceType`／`sourceId`／`sourceVersion`，再对来源单据调用一次 `workflow_transition`。完整报销由 `records_query` → 必要时 `receipt_register` → `expense_prepare` → `workflow_transition(action=submit)` → 主管 `workflow_transition(action=approve或return)` 组合。退回后分别补正、提交、审批；没有自动串联或批量流转入口。

`expense_prepare` 省略 `expenseFormId` 且 `expectedVersion=0` 创建核验后的费用草稿；指定原费用 ID 和当前版本补正退回单。两种方式都只保存，不自动提交。`receipt_register` 只登记虚构票据元数据，不上传真实文件。

`analysis_query` 默认 `filter.dataSource="business"`，统计 O08/O09 业务表。显式 `historical-fixtures` 查询固定历史样本。实时统计中的 `kind` 可选 approval、travel、expense，用于分开差旅预算与报销；金额按单据口径合计，不表示去重后的实际支出。实时明细可以回到来源单据，历史样本不会伪装成可办理事项。

原 `demo_*` 及被合并的细粒度工具名已移除。**更新 Go 服务后，完整授权连接重新同步工具列表即可。** Scope 没有变化。旧 `context:read` 令牌只看到包含场景目录的 `context_get`，使用其他业务能力需重新授权；若客户端固定只申请该 Scope，可明确配置完整范围，或从 MCP 连接页获取完整权限的手动 Token。不要通过放宽 Scope 检查解决旧令牌工具缺失。

Header 的实时同步模式仍按标签页保存。浏览器 SSE 与 MCP 协议通道分开；O08/O09 普通业务变更与空间重置都在同一事务发布资源事件。生产工作台／审批／差旅费用页面已接入查询更新，编辑中的表单不由事件覆盖；旧 generation 请求被拒绝。其他 browser-only 场景尚不具备普通业务跨客户端同步。

使用已有官方 Go SDK v1.7.0，无新增依赖。协议测试覆盖 2026-07-28 与 2025-11-25。`node scripts/mcpSmoke.mjs` 读取 Token 环境变量执行只读发现与历史查询；`scripts/mcpBusinessSmoke.mjs` 会办理虚构业务，**只对回环地址的独立测试数据库运行**。业务接入记录见 [接入记录](mcp-business-progress.md)，当前工具实施、验证与未覆盖项见 [收敛记录](mcp-primitives-progress.md)。

## 存储与维护

只有既有 SQLite：保存客户端、授权码与 Token 哈希、空间关联及演示数据。临时登录表单在内存中，重启后重新打开页面；有效 Token 与客户端注册保留。每小时清理过期凭据，注册总量上限 1024，登录和协议端点有限流。

数据库备份沿用原有 SQLite 方案。不要把 SQLite 放入静态目录。反向代理示例见 `deploy/mcp.nginx.conf.example`。本地服务启动后，`node scripts/mcpDemoSmoke.mjs` 使用本地 demo 账号验证真实登录、发现、注册、PKCE、MCP 读取、撤销与重放拒绝；它只连接回环地址，不打印令牌。运行检查结果见 [实施记录](mcp-progress.md)。
