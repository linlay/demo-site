# demo-site

仓库：[linlay/demo-site](https://github.com/linlay/demo-site)。

`demo-site` 是使用虚构数据的业务场景演示站点，包含 O01～O16、S01～S05、P01～P10 共 31 个既有场景，并支持 AWCP 浏览器协议。产品名称统一使用 `demo-site`，AWCP 仅作为协议与技术标识。

**当前处于全栈改造第一阶段：基础版本已有本机验证及远程部署记录，整体业务迁移尚未完成。** Go/SQLite 本地已实现会话、重置、历史／实时分析，以及 O01 工作台、O08 通用审批和 O09 差旅费用核心业务；其余 O/S 业务规则仍在浏览器，不能把本阶段理解为 31 个场景已经迁移到后端。执行状态见 [全栈改造计划](plans/fullstack/README.md)，已执行检查见 [实施记录](docs/fullstack-progress.md)。

MCP 使用同一 Go 进程和 SQLite 内置授权，提供 demo 登录、标准 OAuth 发现、Access Token 获取，以及工作台、通用审批、差旅费用和实时／历史分析的 11 个基础工具。复合流程通过多次调用基础工具完成，见 [MCP 计划](plans/mcp/README.md)、[配置与使用](docs/mcp-deployment.md) 和 [工具收敛记录](docs/mcp-primitives-progress.md)。未迁移业务不会以可执行 MCP 工具暴露；这不代表全量业务迁移已完成。

## 技术栈与目录

前端保持 React 18、TypeScript strict、Ant Design、Webpack + SWC、CSS Modules；后端采用 Go 1.26、标准库 HTTP 和 SQLite。前端位于 `frontend/`，后端位于 `backend/`，AWCP 与 UI 源码继续位于 `package/awcp`、`package/ui`；类型化 HTTP 客户端位于 `package/api`。

工作区统一使用根 `package.json` 精确管理前端及共享源码依赖，`frontend/package.json` 管理前端命令。Go 依赖由 `backend/go.mod` 管理。架构与边界见 [CLAUDE.md](CLAUDE.md)。

## 准备依赖

在仓库根目录由维护者执行：

```bash
pnpm install
cd backend
GOTOOLCHAIN=local go mod tidy
cd ..
```

需要 Node.js 22+、pnpm 10.32.1 和 Go 1.26.x。首次安装应生成根 `pnpm-lock.yaml` 和 `backend/go.sum`，保留并审查这些文件。后续运行命令禁用 Go 自动工具链下载与依赖下载，工作区关闭 pnpm 启动时自动安装。SWC/esbuild 使用平台可选依赖提供的二进制，不运行安装脚本。

## 本地启动

安装并完成验证后，在仓库根目录运行：

```bash
pnpm run dev
```

该命令启动前端开发服务器及 Go API，结束时同时停止两者。开发地址为 `http://127.0.0.1:2180`，前端代理 `/api` 到 Go 服务。首次访问创建独立演示会话；失败时页面显示重试入口，不静默降级为已联网。

- `/`：默认工作台。
- `/navigation`：可按业务名称、技术能力或编号搜索的 31 场景站内导航。
- `/scenes/O01`：既有工作台。
- `/scenes/{ID}/objects/{objectId}`：既有事项详情。
- `/scenes/{ID}/new/{formType}`：既有新建表单。
- `/scenes/O08`：审批中心，按待我审批、我已审批、我发起的聚合不同类型单据。
- `/scenes/O08/new`：申请类型列表，可新建风险处置、投行立项、机构服务、客户适当性、采购、用印、综合事项、差旅和报销。
- `/scenes/S04`：办理人员直接填写风险调查，审核人员独立审批，无需先领取或分派。
- `/analysis`：独立的数据分析导航，支持实时业务与历史样本查询、分组钻取和分页。
- 右上角账户菜单：展示姓名、部门和业务职责，全站切换当前用户，刷新后保留；也可恢复当前会话初始状态。

本地 MCP 默认启用：打开 `http://127.0.0.1:2181/api/v1/mcp/connect`，输入 `demo` / `demo`，复制 Access Token；MCP 地址为 `http://127.0.0.1:2181/mcp`。不需要安装额外容器。公网部署设置自定义密码，详见 [MCP 使用说明](docs/mcp-deployment.md)。

分析页区分实时业务与历史样本，不把未迁移场景的新办理记录计入服务端统计。右上角统一提供六个账户：林悦、王晨、刘洋发起与办理各类业务；陈明、赵敏审核各类业务；周宁查看全局数据分析与业务明细。职责不再按业务场景拆分，个人事项按办理人分配。初始办理队列分别为 20、12、3 条，审核队列分别为 4、2 条；办理后按实际状态变化。申请人不能自审，历史处理记录保留原姓名。工作台与每日汇总仅展示本人任务，列表省去重复大标题和通用介绍。实施与验证见 [粗职责与个人队列记录](docs/coarse-account-progress.md)。

## AWCP 提供方式

| 方式 | 网站行为 | 接口来源 |
| --- | --- | --- |
| 主动提供开启 | 自动提供当前页面的 AWCP 接口 | `demo-site` |
| 主动提供关闭 | 保持普通网页，不主动提供 AWCP | Desktop WebView 可以自行注入 |

Header 的“主动提供 AWCP”开关控制整个站点，状态保存到 SQLite，首次初始化关闭。刷新按服务端状态决定是否提供 `window.awcp` 的 `manual`、`invoke` 和 `cancel`。关闭时撤销网站自己的入口与缓存引用，取消其在途调用，保留正常按钮、路由和未保存输入；取消不回滚已提交的业务。

Desktop WebView 注入模式由 Desktop 管理接口和注入生命周期。网站在主动提供关闭时不创建接口；已有或随后注入的 Desktop 接口不会被网站删除，关闭原生入口时恢复先前的 Desktop 接口。这个开关不代表 Desktop 注入是否开启。

其他已打开页面在恢复焦点或可见状态时读取设置，可见页面每 15 秒同步一次。读取失败时保持网站主动提供关闭。该设置独立于演示空间重置和 MCP；当前虚构演示站点允许有效演示会话的访客切换全站状态。实施与验证见 [AWCP 提供方式记录](docs/awcp-active-progress.md)。

## 配置

变量契约见 [.env.example](.env.example)，默认值以 `backend/internal/config/config.go` 为准。服务直接读取进程环境，不自动加载 `.env`；通过 shell、服务管理器或容器注入。相对路径以启动工作目录为基准，本地编排从 `backend/` 启动。

演示 Cookie 只用于隔离数据，不是正式登录。部署在受控访问环境中，HTTPS 时配置安全 Cookie，并设置精确的允许来源。数据库必须放在持久目录。

## 验证

```bash
pnpm run check:protocol
pnpm run check:plans
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:backend
pnpm run build
```

`quality` 串联上述验证。计划文件引用检查通过不代表页面测试通过。前端 86 个测试文件、241 项测试及 Go 测试已通过；覆盖六人粗职责、各类申请发起与审批、个人队列隔离、风险直接填表、AI 全局切换账户及旧数据库升级。完整 31 场景浏览器和外部宿主验收仍待完成，具体验证见 [粗职责与个人队列记录](docs/coarse-account-progress.md)。

## 构建与部署

`make build` 构建前端及当前平台 Go 程序。Go 服务提供 SPA 与 API，深层页面刷新由服务端处理，未知 API 和不存在的静态资源不会回退成 HTML。

容器只打包预先构建的 Linux 产物，Dockerfile 不安装依赖。详见 [部署说明](docs/fullstack-deployment.md)。本地预览地址为 `http://127.0.0.1:2181/analysis`；[部署记录](deploy/README.md) 记录了 singapore02 上的发布与验收；当前站点为 `https://demo-site.zenmind.cc`，MCP 地址为 `https://demo-site.zenmind.cc/mcp`；旧域名已退役。当前部署不代表全部业务已迁移到 Go/SQLite。

## 数据与恢复

所有客户、人员、事项和历史数据均为虚构。默认使用小型验收集（`AWCP_DATA_PROFILE=acceptance`）；压测时可显式选择 `standard`。两种数据集均保留 3 个部门及历史人员引用，开放六个可操作账户；标准数据集包含 24,000 条历史样本，小型验收集包含 48 条历史样本。个人队列对应可继续办理的业务单据，独立于历史分析样本。其余人员停用后仍可展示历史记录，不再出现在账户列表。重置使用固定种子和独立数据版本，不影响其他访问者。

既有业务暂由会话和数据版本隔离的浏览器存储承接，原迁移前 localStorage 不导入、不覆盖、不删除。项目改名继续保留 `awcp-examples:v1:repository` 存储键、`awcp-session` 前缀、`awcp_demo` Cookie、`awcp.sqlite` 数据库文件和 `AWCP_*` 环境变量，以保持既有数据与配置兼容。SQLite 持久化范围及后续迁移任务以当前全栈计划为准。

新域名具有独立的 Cookie 和浏览器存储，需要重新建立演示会话；MCP 客户端更新服务地址后重新授权。旧域名的浏览器数据不会自动迁入新域名。

导航、紧凑布局和关联演示样本的本轮实施与验证见 [界面改造记录](docs/ui-density-progress.md)。

审批中心与申请入口的本轮范围、迁移边界及验证见 [审批中心改造记录](docs/approval-center-progress.md)。
