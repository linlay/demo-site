# 全栈部署说明

当前项目名为 `demo-site`，singapore02 的运行目录为 `/docker/demo-site`，站点为 `https://demo-site.zenmind.cc`。具体发布版本、备份和验证结果见 [服务器部署记录](../deploy/README.md)。完整业务后端迁移尚未完成；本文件说明通用打包与恢复步骤。

## 本机

用户准备依赖后，`pnpm run dev` 从根目录启动前后端。检查 `/healthz` 和 `/api/v1/session`，通过头像重置，从 `/analysis` 验证历史样本查询。

生产构建使用 `make build`。从 `backend/` 运行 `../build/demo-site-server`，或显式配置数据库/静态资源绝对路径再启动。数据不得放入 `dist`、镜像构建目录或临时目录。

## 容器打包

Dockerfile 使用 scratch，仅复制已构建的程序与网页，不触发安装。以 amd64 为例，依赖准备并通过测试后手动执行：

```bash
pnpm --dir frontend run build
make build-linux TARGET_ARCH=amd64
docker build --platform linux/amd64 -t demo-site:local .
docker run --rm -p 127.0.0.1:2181:2181 -v demo-site-data:/data demo-site:local
```

arm64 需对应 `TARGET_ARCH=arm64` 和 `--platform linux/arm64`，不能打包宿主 macOS 二进制。运行用户为 UID/GID 65532，持久卷必须可写。本轮已实际执行前端生产构建、Linux/amd64 构建及远端镜像打包；上面的本机 `docker run` 示例未执行。

## 受控服务器

现有目标为 singapore02（Linux/amd64），通过 Nginx 提供 HTTPS，应用只绑定 `127.0.0.1:11983`。新部署环境需另行明确服务器、CPU 架构、域名和部署方式。服务单实例运行；不共享 SQLite 文件给多副本服务。HTTPS 环境设置 `AWCP_SECURE_COOKIE=true`，并将 `AWCP_ALLOWED_ORIGINS` 配为精确外部 HTTPS origin。后端不信任客户端传入的 Forwarded Header 来决定 Cookie 安全属性。

`deploy/demo-site.nginx.conf` 对应当前站点，`deploy/nginx.conf.example` 为其他环境的可选模板。旧域名已退役，相关跳转配置、证书及 ACME webroot 已删除。域名、证书和端口需要按目标环境配置。

## 备份与回退

- 升级前停止应用，再备份完整数据目录（包含可能存在的 SQLite WAL/SHM）；不在线直接复制单个主数据库文件。
- 保存对应程序、前端产物与数据库备份的版本关联。
- 程序启动按版本应用事务迁移，拒绝已执行 SQL 校验和变化和未知的较新迁移。
- 迁移或升级失败时停止服务，恢复匹配版本程序及完整数据库备份；不要直接删除用户数据库重建。
- 后续验收需实际演练：运行、办理、重启恢复、备份、重置、从备份恢复。当前没有宣称演练通过。
