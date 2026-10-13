# demo-site MCP 实施记录

2026-10-13 业务能力与验证见 [业务接入记录](mcp-business-progress.md)，最新 11 个基础工具与验证见 [收敛记录](mcp-primitives-progress.md)。下文保留 2026-10-03 连接验证的历史范围。

## 范围与工作区

2026-10-03 初始工作区干净。本次保留维护者安装 SDK 后产生的 go.mod/go.sum 变更，没有执行依赖安装命令。

用户随后明确“小型化、只是 demo”。最终方案收敛为同一 Go 进程、同一 SQLite 文件中的 MCP 和简单授权。本次不执行全量业务迁移或线上部署。

## 已实现

- 移除本次新增且未启动的 Keycloak/PostgreSQL Compose、Nginx、配置生成脚本及本次生成的私有凭据。没有下载或启动相关镜像。
- 内置单 demo 账号登录，页面显示一小时 Access Token。默认本地 demo/demo，公网要求自定义密码。
- 标准资源与授权服务发现、公共客户端动态注册、授权码 + S256 PKCE、resource 绑定、一次性授权码、Token 撤销。
- Token/授权码仅持久化哈希，配置密码更改后失效；拒绝密码 grant。无企业 SSO、多用户系统、OIDC 或刷新令牌。
- 官方 Go SDK 的无状态 Streamable HTTP；默认四个读取工具，重置按配置和授权开放。
- Scope、空间绑定、generation、重置确认与幂等检查保持在后端。
- 默认种子规模从 standard 调整为 acceptance：48 条历史样本；24,000 条规模仍可显式选择。已有空间不被修改。

## 组件检查

| 组件 | 处理 |
| --- | --- |
| 外部授权平台及其 PostgreSQL | 已移除 |
| Redis、消息队列、搜索服务、Kubernetes | 项目运行链路未引入 |
| Go + 标准库 HTTP | 保留，唯一必需服务进程 |
| SQLite | 保留，文件数据库，无独立服务 |
| 官方 MCP Go SDK v1.7.0 | 保留，协议实现依赖 |
| Node、pnpm、Webpack、SWC、测试工具 | 只用于开发/构建，不进入生产运行镜像 |
| Ant Design | 保留既有 UI；主包较大，未扩大为 UI 框架迁移 |
| Docker / 外部 Nginx | 可选打包与公网 HTTPS；本地 demo 不需要 |

本机已构建可执行文件约 21 MiB，前端构建目录约 7.1 MiB（含 source map）；不是下载体积或内存测量。Dockerfile 仍从 scratch 打包预构建产物。

## 已执行验证

- 后端 `go test -mod=readonly ./...` 通过。
- 后端 `go test -race -mod=readonly ./...` 通过。
- 后端离线构建通过，没有安装新依赖。
- 授权测试覆盖登录失败、CSRF、浏览器绑定、匿名撤销拒绝、Scope、客户端/资源/回调绑定、PKCE、令牌过期、密码轮换、授权码重放及 Token 持久化校验。
- MCP 测试覆盖 2026-07-28 和 2025-11-25、工具 Schema、权限过滤、数据隔离与重置事务。
- 真实本地 Go 服务在 127.0.0.1:2181 启动，使用独立的 `data/mcp-demo.sqlite`，不修改原业务数据库。
- `node scripts/mcpDemoSmoke.mjs` 实际通过：demo 表单登录取 Token、401 发现、四个工具列表、上下文、历史查询、客户端绑定撤销、标准 OAuth 发现/注册/授权/PKCE、错误 resource 拒绝、授权码重放拒绝。测试未打印或持久化 Token 明文。
- 浏览器实际打开登录页并确认排版；内置浏览器表单提交未完成跳转，后续浏览器控制超时。因此不将浏览器完整登录交互或第三方客户端 OAuth 兼容性标记为通过；真实 HTTP 授权链路已独立验证。
- 前端 TS、Lint、73 个测试文件/177 项测试及构建已通过；本轮授权简化未修改前端业务代码。构建保留主包体积警告（784 KiB）。
- 协议合同、计划引用、生成目录和 Git whitespace 检查通过。

## 边界

线上未部署。没有声称企业级 OAuth 认证、全量业务后端迁移或全部第三方客户端验收。本次只交付小型安装、登录和 MCP 调用验证 demo。
