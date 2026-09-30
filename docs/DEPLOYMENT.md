# 将 SlideLink 分享成一个可用的网站

## 先区分三个东西

- **GitHub repo** 保存和分享工具代码；不应存放用户上传的真实材料。
- **网站实例** 运行 Node.js 服务，提供上传、项目库、文件存储和 WebSocket 同步。
- **演示链接** 指向某个版本；投屏与演讲者链接不同，且属于访问凭证。

GitHub Pages 是静态网站托管，不能运行本项目的 Node.js 服务。[GitHub 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)。

## 选项 A：已有服务器 + Docker

运行一个实例、挂载一个持久化目录，并使用 HTTPS 反向代理。

```sh
docker build -t slidelink .
docker volume create slidelink-data
docker run -d --name slidelink \
  -p 127.0.0.1:3000:3000 \
  -v slidelink-data:/app/data \
  -e NODE_ENV=production \
  -e PUBLIC_ORIGIN=https://slides.example.com \
  -e UPLOAD_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET \
  slidelink
```

将域名 HTTPS 流量代理到 `127.0.0.1:3000`。代理必须支持 WebSocket Upgrade，并允许至少 8 MB 请求体。可使用已有的 Nginx、Caddy 或云平台反向代理。`PUBLIC_ORIGIN` 必须精确匹配最终使用的 HTTPS 域名，不带尾斜线和子路径。

备份整个持久化目录，包括 `library.json`、每份版本 JSON 和相关链接。停机备份可避免捕获写入中的版本。不要运行多个 Node 进程共享此目录；当前架构为单实例文件存储。

## 选项 B：连接 GitHub 到托管平台

例如 Render 的 Web Service 支持 Node.js / Docker 和 WebSocket；配置持久化磁盘后，上传文件可以跨重启与部署保留。[Web Service 文档](https://render.com/docs/web-services)、[WebSocket 文档](https://render.com/docs/websocket)。

1. 在平台创建 Web Service，连接此 GitHub 仓库。
2. 使用 Node.js 24，Build Command 为 `npm ci --omit=dev`，Start Command 为 `npm start`。
3. 设置下表中的环境变量，健康检查路径设为 `/healthz`。
4. 把持久化磁盘挂载到 `/var/data`，确认服务用户有写权限。
5. 部署完成后打开网站，在“工作空间设置”输入上传口令，先使用内置示例验证。
6. 将网站首页和上传口令发给受邀用户。他们首次打开会获得自己的工作空间密钥。

| 变量 | 示例／用途 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | 使用平台分配的端口 |
| `PUBLIC_ORIGIN` | 平台分配的完整 HTTPS origin，例如 `https://your-service.onrender.com` |
| `UPLOAD_KEY` | 随机上传口令，分享给允许上传的人 |
| `DATA_DIR` | `/var/data/slidelink`，必须在持久化磁盘内 |
| `RETENTION_DAYS` | `0` 持续保留；设为 `1`–`365` 时自动过期 |
| `MAX_DECKS` | 整个实例最多保存多少版本，默认 `100` |

Render 的默认文件系统是临时的；重启或重新部署会丢失未放在持久化磁盘上的修改。持久化磁盘需要支持该功能的付费服务，不能将其视为免费永久存储。部署前在平台确认当前费用。[磁盘官方文档](https://render.com/docs/disks)。

以上是部署指导，不代表已经创建云服务或订购任何套餐。

## 仅在可信局域网试用

```sh
HOST=0.0.0.0 UPLOAD_KEY=YOUR_TEMPORARY_UPLOAD_KEY npm start
```

通过电脑在局域网的 IP 和端口访问，例如 `http://192.168.1.10:3000`，两台设备需要能互相连通，电脑防火墙需要允许连接。HTTP 没有传输加密，一些 Safari 全屏、剪贴板、保持唤醒功能可能不可用。不要用这个方式在公共网络传送私人讲稿。正式演示使用 HTTPS。

## 演示前检查

1. 打开完整的两个链接，iPad 状态显示 `Screen linked`。
2. 试翻两页、画一笔、撤销，再把投屏页刷新，确认能够恢复当前页和批注。
3. 确认投影连接的是电脑投屏页面，而不是镜像 iPad 的整块屏幕。
4. 在实际使用的 iPad、Apple Pencil、Wi-Fi 下检查横竖屏、防误触及息屏恢复。
5. 保留原始 slides、讲稿和电脑键盘翻页替代方案。此版本投屏页面只接受演讲者控制，控制端网络断开时保留最后一页。

## 面向大量公众用户之前

当前上传口令适合邀请制小范围使用。工作空间靠随机密钥隔离，没有账号找回、精细团队权限、每用户配额或内容管理。扩大开放前，增加常规账户系统、对象存储与数据库、上传队列、按用户配额、审计和备份恢复。服务端目前会把版本数据加载进内存，不能单纯调大 `MAX_DECKS` 代替扩容。
