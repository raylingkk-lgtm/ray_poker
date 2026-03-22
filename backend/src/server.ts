import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import { GamePhase } from '@ray-poker/shared';
import { mountApiRoutes } from './http/apiRoutes.js';
import { mountSocketHandlers } from './socket/handler.js';
import { RoomManager } from './socket/RoomManager.js';

/**
 * 生产环境设置 `CORS_ORIGINS=https://你的前端域名,https://备用域名`；
 * 未设置时保持开发体验（允许任意来源 + credentials，与原先一致）。
 */
function socketIoCorsOrigin(): boolean | string | string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return true;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  if (list.length === 1) return list[0]!;
  return list;
}

const app = express();
app.use(
  cors({
    origin: socketIoCorsOrigin(),
    credentials: true,
  }),
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, phase: GamePhase.Idle });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: socketIoCorsOrigin(),
    credentials: true,
  },
});

const roomManager = new RoomManager();
mountApiRoutes(app, roomManager);
mountSocketHandlers(io, roomManager);

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST ?? '0.0.0.0';

httpServer.listen(port, host, () => {
  console.info(`[http] listening on http://localhost:${port} (bound ${host})`);
  console.info(`[socket] ready (namespace /)`);
  if (host === '0.0.0.0') {
    const nets = networkInterfaces();
    const addrs: string[] = [];
    for (const list of Object.values(nets)) {
      for (const ni of list ?? []) {
        const fam = ni.family as string | number;
        const isV4 = fam === 'IPv4' || fam === 4;
        if (isV4 && !ni.internal) addrs.push(ni.address);
      }
    }
    if (addrs.length) {
      console.info('[http] LAN 访问示例（前端需配置 VITE_SOCKET_URL）：');
      for (const a of addrs) {
        console.info(`         http://${a}:${port}`);
      }
    }
  }
});
