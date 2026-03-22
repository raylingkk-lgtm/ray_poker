import type { Express } from 'express';
import { nanoid } from 'nanoid';
import { hashRoomPassword } from '../auth/roomPassword.js';
import { createPlayerSession, verifyPlayerSession } from '../auth/sessionStore.js';
import type { RoomManager } from '../socket/RoomManager.js';
import { PlayerStatus } from '../types/poker.js';
import { getRecentMatches } from './matchHistoryStore.js';

const MAX_PASSWORD_LEN = 128;
const MAX_DISPLAY_NAME_CODEPOINTS = 10;

function displayNameCodePointLength(s: string): number {
  return [...s].length;
}

export function mountApiRoutes(app: Express, roomManager: RoomManager): void {
  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: roomManager.listActiveRoomSummaries() });
  });

  app.get('/api/match-history', (req, res) => {
    const raw = req.query.limit;
    const limit =
      typeof raw === 'string' && /^\d+$/.test(raw)
        ? Math.min(100, Math.max(1, parseInt(raw, 10)))
        : 50;
    res.json({ matches: getRecentMatches(limit) });
  });

  app.post('/api/auth/bootstrap', (_req, res) => {
    const s = createPlayerSession();
    res.json(s);
  });

  app.post('/api/rooms', (req, res) => {
    const body = req.body as {
      playerId?: string;
      authToken?: string;
      fromRoomId?: string;
      password?: string;
      displayName?: string;
    };
    const { playerId, authToken, fromRoomId } = body;
    const password = body.password;
    const rawName = body.displayName;

    if (rawName !== undefined && rawName !== null) {
      if (typeof rawName !== 'string') {
        res.status(400).json({ error: 'INVALID_DISPLAY_NAME' });
        return;
      }
      const trimmed = rawName.trim();
      if (trimmed.length === 0) {
        res.status(400).json({ error: 'INVALID_DISPLAY_NAME' });
        return;
      }
      if (displayNameCodePointLength(trimmed) > MAX_DISPLAY_NAME_CODEPOINTS) {
        res.status(400).json({ error: 'DISPLAY_NAME_TOO_LONG' });
        return;
      }
    }

    if (typeof password === 'string' && password.length > MAX_PASSWORD_LEN) {
      res.status(400).json({ error: 'PASSWORD_TOO_LONG' });
      return;
    }

    if (!playerId || !authToken) {
      res.status(400).json({ error: 'MISSING_AUTH' });
      return;
    }
    if (!verifyPlayerSession(playerId, authToken)) {
      res.status(401).json({ error: 'AUTH_INVALID' });
      return;
    }

    if (fromRoomId) {
      const from = roomManager.getRoom(fromRoomId);
      if (!from || from.hostPlayerId !== playerId) {
        res.status(403).json({ error: 'NOT_HOST_OF_FROM_ROOM' });
        return;
      }
    }

    let joinPasswordSalt: string | undefined;
    let joinPasswordHash: string | undefined;
    if (typeof password === 'string' && password.length > 0) {
      const h = hashRoomPassword(password);
      joinPasswordSalt = h.salt;
      joinPasswordHash = h.hash;
    }

    const roomId = nanoid(12);
    const displayName =
      typeof rawName === 'string' && rawName.trim().length > 0
        ? rawName.trim()
        : `房间${roomId.slice(-4)}`;
    roomManager.createRoom({
      roomId,
      hostPlayerId: playerId,
      smallBlind: 1,
      bigBlind: 2,
      displayName,
      initialPlayers: [
        {
          id: playerId,
          nickname: displayName,
          stack: 200,
          bet: 0,
          status: PlayerStatus.Alive,
          seatIndex: 0,
        },
      ],
      joinPasswordSalt,
      joinPasswordHash,
    });
    res.json({ roomId });
  });
}
