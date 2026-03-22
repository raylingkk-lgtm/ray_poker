# 朋友用其他设备加入牌桌

示例桌默认仅 **`host-1`** 预入座；其他人用 `?player=` 进房观战再点「坐下」。公网 HTTPS 部署见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 1. 同一 Wi‑Fi（局域网）

1. **后端**在本机启动（默认已监听 `0.0.0.0`，局域网可连）。终端里会打印 `LAN 访问示例` 的 IP。
2. **前端**在朋友设备上打开时，浏览器里的 Socket 不能写 `localhost`（那会指向朋友自己的电脑）。在 **`frontend/.env.local`** 中设置（勿把该变量写进 `.env.development`，否则 Vite 会用它覆盖 `.env.local`，手机仍会连错地址）：

   ```bash
   VITE_SOCKET_URL=http://<你的电脑局域网IP>:3001
   ```

   例如：`http://192.168.0.106:3001`。改完后重新执行 `pnpm dev`（或重启 Vite）。
3. **你本机**打开：`http://<你的IP>:5173` 或 `http://localhost:5173`（本机若用 localhost，`.env.local` 里仍可指向 `http://192.168.x.x:3001`，与手机一致最省事）。
4. **朋友手机**：浏览器访问 `http://<你的IP>:5173/?player=guest-1`（页面里也会提示路径）。
5. **防火墙**：若连不上，在 macOS「系统设置 → 网络 → 防火墙」或路由器上放行 **3001**（API/Socket）和 **5173**（开发态前端）。

## 2. 公网（不同网络）

需要把 **3001** 和 **5173** 暴露出去（云服务器、内网穿透如 ngrok / frp 等），并把 **`VITE_SOCKET_URL`** 设成**朋友能访问到的** Socket 地址。正式对外域名、TLS、Nginx 反代 WebSocket、买入与 CORS 等见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

## 3. 环境变量说明

| 变量 | 作用 |
|------|------|
| `HOST` | 后端绑定地址，默认 `0.0.0.0` |
| `PORT` | 后端端口，默认 `3001` |
| `CORS_ORIGINS` | 生产建议设置：前端页面 origin，逗号分隔（见 DEPLOYMENT.md） |
| `VITE_SOCKET_URL` | 前端连接 Socket.IO 的完整 origin（开发时多为 `http://IP:3001`） |
