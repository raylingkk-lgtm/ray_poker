# 公开域名部署（前端 + Socket + 买入）

目标：任意玩家通过 **HTTPS 域名** 打开页面，WebSocket 连到你的后端，使用现有 **申请买入 → 房主审批** 流程（无需改业务代码，只需环境与反向代理正确）。

## 架构概要

| 组件 | 说明 |
|------|------|
| 前端 | `pnpm --filter frontend build` 产出静态文件，由 Nginx / CDN / 对象存储托管 |
| 后端 | Node 跑 `backend` 的 `dist/server.js`（Express + Socket.IO），建议前面加 **Nginx 反向代理 + TLS** |
| 环境变量 | 构建前端时写入 `VITE_SOCKET_URL`；运行时后端读 `PORT`、`CORS_ORIGINS` 等 |

买入走 Socket 事件 `request_buy_in` / 房主 `admin_control`，与局域网一致；公网需保证 **浏览器能连上 Socket 的 wss:// 地址**。

## 1. 后端（Socket.IO）

### 环境变量

| 变量 | 说明 |
|------|------|
| `PORT` | 监听端口，默认 `3001` |
| `HOST` | 绑定地址，生产可保持默认 `0.0.0.0` |
| `CORS_ORIGINS` | 浏览器来源白名单，逗号分隔，例如 `https://poker.example.com`。不设则与开发一致（较宽松）。 |

### 构建与启动

本仓库为 monorepo，需先编译 **`@ray-poker/shared`**（产出 `shared/dist`），再编译 backend。在**仓库根目录**：

```bash
pnpm install
pnpm run build:backend
NODE_ENV=production PORT=3001 CORS_ORIGINS=https://poker.example.com pnpm --filter backend start
```

（仅调试也可 `cd backend && node dist/server.js`，但须已执行过 `pnpm run build:backend`。）

#### Render 等 PaaS（勿使用 `corepack enable`）

构建环境对 `/usr/bin` 只读时，`corepack enable` 会失败。可用 **npx** 调用 pnpm，并走根目录脚本：

| 项 | 值 |
|----|-----|
| **Root Directory** | 空（仓库根） |
| **Build Command** | `npx --yes pnpm@9 install && npx --yes pnpm@9 run build:backend` |
| **Start Command** | `npx --yes pnpm@9 --filter backend start` |
| **NODE_VERSION** | `20` 或 `22`（避免过新的主版本） |

生产建议用 **systemd** 或 **pm2** 保活，前面 **Nginx** 终止 TLS 并反代到 `127.0.0.1:3001`。

### Nginx 与 WebSocket（必配）

Socket.IO 需要 Upgrade 头，示例片段（域名与证书路径请替换）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name api.poker.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.poker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.poker.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 86400;
    }
}
```

证书可用 [Certbot](https://certbot.eff.org/)（Let’s Encrypt）。前端页面域名（如 `https://poker.example.com`）必须出现在 **`CORS_ORIGINS`** 中。

## 2. 前端（Vite 静态站）

构建时把 Socket 地址写成**用户浏览器可访问的公网 origin**（与页面是否同域无关，但必须可达且协议一致：页面是 https 时应用 **wss**）。

在**仓库根目录**（会先编 `shared` 再编前端）：

```bash
pnpm install
VITE_SOCKET_URL=https://api.poker.example.com pnpm run build:frontend
```

Vercel 等：`Build Command` 可用 `pnpm run build:frontend`，`Output Directory` 为 `frontend/dist`。

将 `frontend/dist` 部署到任意静态托管（Nginx `root`、Vercel、Cloudflare Pages、S3+CloudFront 等）。若前端与 API **同域不同路径**（例如 `/` 与 `/socket.io/`），可把 `VITE_SOCKET_URL` 设为与页面相同 origin，并在 Nginx 里把 `/socket.io/` 反代到 Node。

## 3. 买入在公网上的注意点

- **房主**账号需能打开「房间菜单 → 审批买入」；任意入座玩家可「申请买入」。
- 当前示例仍使用 **URL 参数 `player=`** 区分身份，**无真实鉴权**，公开部署时任何人可冒充任意 `playerId`。若要认真上线，需后续增加：登录、房间密码、或服务端签发会话 token（超出本文范围）。
- **最后一手**阶段服务端会拒绝新买入（`FINAL_HAND_NO_BUYIN`），与 PRD 一致。

## 4. 防火墙与安全组

在云厂商安全组 / 本机防火墙中放行 **443**（及可选 80 用于 ACME 校验）。Node 可只监听内网 `127.0.0.1`，由 Nginx 对外。

## 5. 健康检查

`GET /health` 返回 JSON，可用于负载均衡或探活。

## 6. 与局域网文档的关系

同一仓库内局域网联调说明见 [NETWORK_PLAY.md](./NETWORK_PLAY.md)。公网部署以本文为准：**务必使用 HTTPS + WSS**，并配置 `CORS_ORIGINS` 与 `VITE_SOCKET_URL`。
