import type { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { ClientSocketEvent, ServerSocketEvent } from './events.js';
import {
  buildGameStateUpdatePayload,
  buildSyncGameStatePayload,
  type AdminChangedServerPayload,
  type AdminControlClientPayload,
  type JoinRoomClientPayload,
  type PlayerActionClientPayload,
  type RequestBuyInClientPayload,
  type SitDownClientPayload,
} from './interfaces.js';
import { pushMatchRecord } from '../http/matchHistoryStore.js';
import { verifyPlayerSession } from '../auth/sessionStore.js';
import { ROOM_MAX_TABLE_PLAYERS, type Room } from './Room.js';
import type { RoomManager } from './RoomManager.js';

const stateSeqByRoom = new Map<string, number>();

/** 单局结算弹窗展示时间，之后再自动开下一手 */
const HAND_SETTLEMENT_AUTO_NEXT_MS = 4500;

const autoNextHandTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelPendingAutoNextSchedule(roomId: string): void {
  const t = autoNextHandTimers.get(roomId);
  if (t !== undefined) {
    clearTimeout(t);
    autoNextHandTimers.delete(roomId);
  }
}

function schedulePendingAutoNextHand(
  io: Server,
  roomManager: RoomManager,
  roomId: string,
): void {
  cancelPendingAutoNextSchedule(roomId);
  autoNextHandTimers.set(
    roomId,
    setTimeout(() => {
      autoNextHandTimers.delete(roomId);
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      flushAutoNextHandEmits(io, room);
    }, HAND_SETTLEMENT_AUTO_NEXT_MS),
  );
}

function nextStateSeq(roomId: string): number {
  const n = (stateSeqByRoom.get(roomId) ?? 0) + 1;
  stateSeqByRoom.set(roomId, n);
  return n;
}

function presence(room: Room) {
  return { connectedPlayerIds: room.getConnectedPlayerIdSet() };
}

/**
 * 向房间内每位**在线**玩家单独下发清洗后的牌桌状态（禁止 `io.to(room).emit` 单包广播全桌快照）。
 */
function socketIdForRoomViewer(room: Room, playerId: string): string | undefined {
  return room.getSocketIdForPlayer(playerId) ?? room.getLobbySocketId(playerId);
}

export function emitSanitizedGameStateToRoom(io: Server, room: Room): void {
  const snapshot = room.buildEngineSnapshot();
  const pres = presence(room);
  const seq = nextStateSeq(room.roomId);
  const recipients = new Set<string>([
    ...room.getTablePlayerIds(),
    ...room.getLobbyPlayerIds(),
  ]);
  for (const playerId of recipients) {
    const socketId = socketIdForRoomViewer(room, playerId);
    if (!socketId) continue;
    const sock = io.sockets.sockets.get(socketId);
    if (!sock?.connected) continue;
    sock.emit(
      ServerSocketEvent.GameStateUpdate,
      buildGameStateUpdatePayload(snapshot, playerId, seq, pres),
    );
  }
}

/** 分池后自动续局：每开一手再推一帧快照 */
function flushAutoNextHandEmits(io: Server, room: Room): void {
  while (room.runAutoNextHandFromPending()) {
    emitSanitizedGameStateToRoom(io, room);
  }
}

function emitSyncGameStateToSocket(io: Server, room: Room, playerId: string): void {
  const socketId = socketIdForRoomViewer(room, playerId);
  if (!socketId) return;
  const sock = io.sockets.sockets.get(socketId);
  if (!sock?.connected) return;
  const snapshot = room.buildEngineSnapshot();
  sock.emit(
    ServerSocketEvent.SyncGameState,
    buildSyncGameStatePayload(snapshot, playerId, Date.now(), presence(room)),
  );
}

function isPlayerAtTable(room: Room, playerId: string): boolean {
  return room.getTablePlayerIds().includes(playerId);
}

function handleJoinRoom(
  io: Server,
  socket: Socket,
  roomManager: RoomManager,
  raw: unknown,
): void {
  const payload = raw as JoinRoomClientPayload;
  if (!payload?.roomId || !payload?.playerId || !payload?.authToken) {
    socket.emit('join_room_error', { message: 'INVALID_PAYLOAD' });
    return;
  }

  if (!verifyPlayerSession(payload.playerId, payload.authToken)) {
    socket.emit('join_room_error', { message: 'AUTH_INVALID' });
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (!room) {
    socket.emit('join_room_error', { message: 'ROOM_NOT_FOUND' });
    return;
  }

  const pw =
    payload.playerId === room.hostPlayerId
      ? ('ok' as const)
      : room.checkJoinPassword(payload.roomPassword);
  if (pw === 'required') {
    socket.emit('join_room_error', { message: 'ROOM_PASSWORD_REQUIRED' });
    return;
  }
  if (pw === 'invalid') {
    socket.emit('join_room_error', { message: 'ROOM_PASSWORD_INVALID' });
    return;
  }

  const prevRoomId = socket.data.roomId as string | undefined;
  const prevPlayerId = socket.data.playerId as string | undefined;
  if (
    prevRoomId &&
    prevRoomId !== payload.roomId &&
    prevPlayerId === payload.playerId
  ) {
    const oldRoom = roomManager.getRoom(prevRoomId);
    if (oldRoom) {
      if (oldRoom.isLobbyPlayer(payload.playerId)) {
        oldRoom.handleLobbyDisconnect(payload.playerId);
      } else {
        oldRoom.handlePlayerDisconnect(payload.playerId);
      }
    }
    void socket.leave(prevRoomId);
  }

  socket.data.roomId = payload.roomId;
  socket.data.playerId = payload.playerId;
  void socket.join(payload.roomId);

  if (isPlayerAtTable(room, payload.playerId)) {
    room.bindPlayerSocket(payload.playerId, socket.id);
  } else {
    room.bindLobbySocket(payload.playerId, socket.id);
  }

  emitSyncGameStateToSocket(io, room, payload.playerId);
  emitSanitizedGameStateToRoom(io, room);

  if (isPlayerAtTable(room, payload.playerId)) {
    if (room.tryAutoStartFirstHand()) {
      emitSanitizedGameStateToRoom(io, room);
    }
    flushAutoNextHandEmits(io, room);
  }
}

function handleDisconnect(io: Server, socket: Socket, roomManager: RoomManager): void {
  const { roomId, playerId } = socket.data;
  if (!roomId || !playerId) return;

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (room.isLobbyPlayer(playerId)) {
    room.handleLobbyDisconnect(playerId);
  } else {
    room.handlePlayerDisconnect(playerId);
  }
  emitSanitizedGameStateToRoom(io, room);
}

/**
 * 挂载 Socket.IO：心跳、`join_room` 重连、行动与买入、房主转移广播。
 */
export function mountSocketHandlers(io: Server, roomManager: RoomManager): void {
  roomManager.registerHostTransferredHandler((e) => {
    const adminPayload: AdminChangedServerPayload = {
      roomId: e.roomId,
      previousHostId: e.previousHostId,
      newHostId: e.newHostId,
    };
    io.to(e.roomId).emit(ServerSocketEvent.AdminChanged, adminPayload);
    const room = roomManager.getRoom(e.roomId);
    if (room) emitSanitizedGameStateToRoom(io, room);
  });

  io.on('connection', (socket: Socket) => {
    console.info('[socket] client connected', socket.id);

    socket.emit('heartbeat:ack', { t: Date.now() });

    socket.on('heartbeat:ping', () => {
      socket.emit('heartbeat:pong', { t: Date.now() });
    });

    socket.on(ClientSocketEvent.JoinRoom, (payload: unknown) => {
      handleJoinRoom(io, socket, roomManager, payload);
    });

    socket.on(ClientSocketEvent.PlayerAction, (raw: unknown) => {
      const p = raw as PlayerActionClientPayload;
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId || p?.roomId !== roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      try {
        room.handlePlayerAction(playerId, p.action, p.amount ?? 0);
        emitSanitizedGameStateToRoom(io, room);
        if (room.hasPendingAutoStartNextHand()) {
          schedulePendingAutoNextHand(io, roomManager, roomId);
        } else {
          flushAutoNextHandEmits(io, room);
        }
      } catch (err) {
        socket.emit('player_action_error', {
          message: err instanceof Error ? err.message : 'ACTION_FAILED',
        });
      }
    });

    socket.on(ClientSocketEvent.RequestBuyIn, (raw: unknown) => {
      const p = raw as RequestBuyInClientPayload;
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId || p?.roomId !== roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      const res = room.requestBuyIn(playerId, p.amount);
      socket.emit('request_buy_in_ack', { roomId, ...res });
      if (res.ok) emitSanitizedGameStateToRoom(io, room);
    });

    socket.on(ClientSocketEvent.SitDown, (raw: unknown) => {
      const p = raw as SitDownClientPayload;
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId || p?.roomId !== roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      const seat = p.seatIndex;
      if (
        typeof seat !== 'number' ||
        !Number.isInteger(seat) ||
        seat < 0 ||
        seat >= ROOM_MAX_TABLE_PLAYERS
      ) {
        socket.emit('sit_down_ack', {
          roomId,
          ok: false,
          message: 'INVALID_SEAT',
          playerId,
        });
        return;
      }

      if (isPlayerAtTable(room, playerId)) {
        const res = room.moveSeatAtTable(playerId, seat);
        if (!res.ok) {
          socket.emit('sit_down_ack', {
            roomId,
            ok: false,
            message: res.reason,
            playerId,
          });
          return;
        }
        room.refreshActionTimerAfterSeatChange();
        socket.emit('sit_down_ack', {
          roomId,
          ok: true,
          playerId,
          seatIndex: res.engineSeatIndex,
        });
        emitSanitizedGameStateToRoom(io, room);
        return;
      }

      if (!room.isLobbyPlayer(playerId)) {
        socket.emit('sit_down_ack', {
          roomId,
          ok: false,
          message: 'NOT_IN_LOBBY',
          playerId,
        });
        return;
      }

      const res = room.sitDownFromLobby(playerId, {
        nickname: p.nickname,
        stack: p.stack,
        seatIndex: seat,
      });
      if (!res.ok) {
        socket.emit('sit_down_ack', {
          roomId,
          ok: false,
          message: res.reason,
          playerId,
        });
        return;
      }

      room.unbindLobbySocket(playerId);
      room.bindPlayerSocket(playerId, socket.id);

      socket.emit('sit_down_ack', {
        roomId,
        ok: true,
        playerId,
        seatIndex: res.engineSeatIndex,
      });
      emitSanitizedGameStateToRoom(io, room);
      if (room.tryAutoStartFirstHand()) {
        emitSanitizedGameStateToRoom(io, room);
      }
      flushAutoNextHandEmits(io, room);
    });

    socket.on(ClientSocketEvent.AdminControl, (raw: unknown) => {
      const p = raw as AdminControlClientPayload;
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId || p?.roomId !== roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;
      if (playerId !== room.hostPlayerId) {
        socket.emit('admin_control_ack', {
          roomId,
          ok: false,
          message: 'NOT_HOST',
        });
        return;
      }

      switch (p.command) {
        case 'approve_buy_in': {
          const reqId = p.requestId ?? '';
          const res = room.approveBuyIn(reqId, playerId);
          socket.emit('admin_control_ack', { roomId, ok: res.ok, message: res.reason });
          if (res.ok) emitSanitizedGameStateToRoom(io, room);
          break;
        }
        case 'reject_buy_in': {
          const reqId = p.requestId ?? '';
          const res = room.rejectBuyIn(reqId, playerId);
          socket.emit('admin_control_ack', { roomId, ok: res.ok, message: res.reason });
          if (res.ok) emitSanitizedGameStateToRoom(io, room);
          break;
        }
        case 'close_room': {
          cancelPendingAutoNextSchedule(roomId);
          const settlement = room.buildGameEndedSettlement();
          io.to(roomId).emit(ServerSocketEvent.GameEnded, settlement);
          pushMatchRecord({
            roomId: settlement.roomId,
            rows: settlement.rows,
          });
          socket.emit('admin_control_ack', { roomId, ok: true });
          stateSeqByRoom.delete(roomId);
          roomManager.removeRoom(roomId);
          void io
            .in(roomId)
            .fetchSockets()
            .then((socks) => {
              for (const s of socks) {
                void s.leave(roomId);
              }
            })
            .catch(() => {
              /* ignore adapter errors */
            });
          break;
        }
        case 'start_hand': {
          cancelPendingAutoNextSchedule(roomId);
          const res = room.hostRequestStartNextHand();
          socket.emit('admin_control_ack', { roomId, ok: res.ok, message: res.reason });
          if (res.ok) {
            emitSanitizedGameStateToRoom(io, room);
            flushAutoNextHandEmits(io, room);
          }
          break;
        }
        case 'set_room_password': {
          if (typeof p.newRoomPassword !== 'string') {
            socket.emit('admin_control_ack', {
              roomId,
              ok: false,
              message: 'MISSING_NEW_ROOM_PASSWORD',
            });
            break;
          }
          const res = room.setJoinPassword(p.newRoomPassword);
          socket.emit('admin_control_ack', {
            roomId,
            ok: res.ok,
            message: res.ok ? undefined : res.reason,
          });
          if (res.ok) emitSanitizedGameStateToRoom(io, room);
          break;
        }
        default:
          socket.emit('admin_control_ack', {
            roomId,
            ok: false,
            message: 'UNKNOWN_OR_UNIMPLEMENTED_COMMAND',
          });
      }
    });

    socket.on('disconnect', (reason) => {
      console.info('[socket] client disconnected', socket.id, reason);
      handleDisconnect(io, socket, roomManager);
    });
  });
}
