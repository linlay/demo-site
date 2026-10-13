# 项目协作约定

- 产品名称统一使用 `demo-site`；AWCP 仅用于协议、接口和技术标识，不作为产品品牌或工作台名称。
- 修改依赖只编辑精确版本清单，不自动运行 install、add、update、dlx、npx 等可能安装依赖的命令。等待用户安装并明确要求继续后再做安装后的验证。
- 当前应用使用虚构演示数据。当前按 `plans/fullstack/README.md` 的 Go 1.26 + SQLite 全栈计划与用户指定范围推进，不自动扩展场景。
- AWCP 提供方式分为网站主动提供和 Desktop WebView 注入；主动提供由全站开关控制并持久化，关闭时网站不暴露自己的入口，不移除或冒充 Desktop 注入的接口。
- AWCP 浏览器协议运行时位于 `package/awcp`，业务源码通过 `@app/awcp` 导入；当前使用的筛选、表格与树组件位于 `package/ui`。维护 protocolVersion 1、manual、invoke、cancel 和 Action 合同。
- 前端源码位于 `frontend/src`，采用 React/TypeScript 严格模式；UI、Hooks、service、common 分层，样式使用 CSS Modules。业务 HTTP 接入集中在 `package/api` 与有类型的 service 层，后端位于 `backend`。
- 页面 Action 按活动页面注册；迁移后业务状态、幂等、版本与角色检查由 Go service 执行；迁移期未接入场景须明确记录。只使用虚构演示数据。
- 修改前记录工作区状态，完成后检查差异并清理本次临时文件，保留用户既有变更。实施与验证结果分别记录，不把未执行的验证标记通过。
