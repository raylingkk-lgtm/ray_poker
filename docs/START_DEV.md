# 本地启动开发服务

## 前置条件

- 已安装 **Node.js**（建议 LTS）
- 已安装 **pnpm**（可用 `corepack enable` 后使用项目指定的包管理器）
- 在仓库**根目录**执行过一次依赖安装：

```bash
pnpm install
```

## 启动（前后端并行）

在项目根目录执行：

```bash
./scripts/dev.sh
```

若提示没有执行权限，先执行：

```bash
chmod +x scripts/dev.sh
```

也可不显式加权限，直接用 bash 调用：

```bash
bash scripts/dev.sh
```

脚本会 `cd` 到仓库根并执行根目录 `package.json` 中的 `pnpm dev`，**同时**启动：

- **后端**：默认 `http://0.0.0.0:3001`（逻辑见 `backend/src/server.ts`）
- **前端**：Vite 开发服，默认 `http://localhost:5173`，并监听局域网（见 `frontend/vite.config.ts` 中 `server.host: true`）

浏览器可打开：`http://localhost:5173`

停止服务：在运行脚本的终端按 **Ctrl+C**。

## 只启动一端

在仓库根目录：

```bash
pnpm dev:backend   # 仅后端
pnpm dev:frontend  # 仅前端
```

## 手机 / 局域网调试

手机访问电脑上的页面时，Socket 与 API 不能写 `localhost`（在手机上会指向手机自己）。请在 `frontend/.env.local` 中设置：

```bash
VITE_SOCKET_URL=http://<你的电脑局域网IP>:3001
```

修改后需**重启**前端开发服务。详见 [NETWORK_PLAY.md](./NETWORK_PLAY.md)。

## 提交脚本时保留可执行位（可选）

若希望克隆仓库后 `./scripts/dev.sh` 默认可执行：

```bash
git update-index --chmod=+x scripts/dev.sh
```
