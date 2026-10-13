# 项目事实与架构

## 定位

`demo-site` 提供基于虚构数据的证券办公业务场景演示，并支持 AWCP 浏览器协议。AWCP 仅作为协议与技术标识，不作为产品品牌。31 个既有场景的完整后端迁移是目标，目前仅完成基础代码；实际实施与验证状态见 `plans/fullstack/README.md` 和 `docs/fullstack-progress.md`。

## 目录及职责

- `frontend/src/app`：应用入口、会话边界、按路由作用域挂载 AWCP。
- `frontend/src/pc`：页面、组件、Hooks、路由和有类型 service。
- `frontend/src/common`：既有虚构业务类型、种子、浏览器 repository 和 AWCP 合同。
- `package/awcp`：浏览器协议运行时，业务仍通过 `@app/awcp` 引用。
- `package/ui`：内部筛选、表格、树适配。
- `package/api`：同源 HTTP、取消、超时、错误、会话和历史报表 DTO。
- `backend/cmd/server`：Go 进程入口及关闭。
- `backend/internal/config`：环境读取与校验，默认值唯一维护位置。
- `backend/internal/handler`：HTTP 路由、JSON、Cookie、Origin、静态 SPA。
- `backend/internal/service`：会话令牌、请求校验和服务编排。
- `backend/internal/repository`：SQLite、事务、种子、分页与聚合。
- `backend/internal/model`：后端模型与受控错误。
- `backend/internal/authn`：小型内置 OAuth 的客户端、授权码、Token 哈希存储及校验。
- `backend/internal/mcpserver`：官方 SDK、按 Scope 注册的工具及浏览器 PKCE/Token 入口。
- `backend/migrations`：编译进程序的版本化 SQL，带应用校验和。
- `contracts/openapi.json`：当前 HTTP 接口合同。
- `plans/fullstack`：当前改造计划；其他旧计划保留为历史。

## 调用关系

浏览器 UI / AWCP Action → 前端 service / API → Go handler → service → repository → SQLite。

上面的链路目前只接通会话、重置、历史分析。21 个 O/S 业务场景及 P03/P06/P07 的业务副作用仍走原浏览器 service；禁止把它们视作已服务端化。`sessionRepository.ts` 是迁移期隔离适配，后续按业务领域删除其调用。

MCP 是小型安装验证 demo，授权内置于同一个 Go 进程和 SQLite，不引入外部身份平台、缓存或队列。默认本地 demo/demo，公网必须自定义密码。Bearer Token 哈希持久化并逐请求校验，支持发现、授权码 + PKCE、公共客户端注册和撤销。当前只暴露已有 Go Service 的基础工具；本次不扩展全量业务迁移。实施范围见 `plans/mcp/README.md`。

## 会话和数据

- 浏览器持有 HttpOnly、SameSite=Lax Cookie；服务端仅存 256 位随机令牌的 SHA-256 摘要。
- 每个会话独立的 generation、固定种子、模拟时间与数据。闲置七天过期，启动及每小时清理。
- 当前 SQLite 表：会话、部门、人员、历史分析记录、重置回执、任务预留表。没有完整 DemoState 快照。
- 标准种子保留既有 EMP-001～EMP-012 身份及角色，其他人员仅用于历史分析。
- reset 在一个事务中恢复种子、替换 generation、清理旧任务；回执留存用于丢失响应后的幂等重试。
- 单实例、单数据库连接串行执行事务；旧 generation 的请求拒绝，前端亦丢弃取消后的迟到响应。
- `report_entries` 仅为历史统计样本，不是审批/费用等业务实体。事务写入、角色和状态机仍待领域迁移。
- `demo_jobs` 当前只有表和重置清理，没有后台执行器；不得宣称异步任务恢复已实现。

## AWCP

`protocolVersion: 1`、manual、invoke、cancel 运行在浏览器。既有场景 Action 未改名。新增 `/analysis` 页面提供 `demo.analysis.query`，查询走 Go/SQLite，支持 AbortSignal；离开路由后由既有 Provider 注销。

## 配置与部署

环境变量优先于 Go 默认值。真实配置不提交；`.env.example` 维护变量说明，README 引用。开发时前后端两个进程；生产候选形态为一个 Go 实例同时服务静态资源与 API，SQLite 持久卷独立于构建产物。Dockerfile 只打包已构建的 Linux 文件，Makefile 负责构建与运行命令。
