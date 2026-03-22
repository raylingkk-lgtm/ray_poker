import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ConnectionStatus } from '../types';
import type {
  AdminChangedPayload,
  GameEndedPayload,
  JoinRoomPayload,
  PlayerActionPayload,
  RequestBuyInPayload,
  SanitizedGameState,
  SitDownPayload,
  StandUpPayload,
  UpdateNicknamePayload,
} from '../types/game';
import { mapJoinRoomError, mapPlayerActionError } from '../lib/socketMessages';
import { SocketClientEvent, SocketServerEvent } from '../types/game';

const defaultUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

export interface UseGameSocketOptions {
  url?: string;
  /** 挂载后自动 `io.connect()` */
  autoConnect?: boolean;
  /** `sit_down_ack`：服务端返回 ok: false 时回调（例如座位已被占） */
  onSitDownAck?: (payload: {
    roomId?: string;
    ok?: boolean;
    message?: string;
  }) => void;
  onStandUpAck?: (payload: {
    roomId?: string;
    ok?: boolean;
    message?: string;
  }) => void;
  /** `request_buy_in_ack`：成功/失败均回调，便于 Toast（不再写入 lastSocketError） */
  onRequestBuyInAck?: (payload: {
    roomId?: string;
    ok?: boolean;
    reason?: string;
    requestId?: string;
  }) => void;
  /** `admin_control_ack`：便于 Toast 提示（如开桌失败） */
  onAdminControlAck?: (payload: {
    roomId?: string;
    ok?: boolean;
    message?: string;
  }) => void;
  /** `join_room_error` 为 AUTH_INVALID 时（如服务端重启丢会话）重新签发身份 */
  onAuthInvalid?: () => Promise<void>;
  /** 进房失败、行动错误、连接失败等玩家提示（中文） */
  onSocketToast?: (message: string) => void;
}

export interface GameStateUpdatePayload {
  roomId: string;
  state: SanitizedGameState;
  seq?: number;
}

export interface SyncGameStatePayload {
  roomId: string;
  state: SanitizedGameState;
  serverTime?: number;
}

/**
 * 游戏房间 Socket：连接、join_room、行动与买入；用 React state 保存房间快照与本地玩家 id。
 */
export function useGameSocket(options: UseGameSocketOptions = {}) {
  const url = options.url ?? defaultUrl;
  const autoConnect = options.autoConnect !== false;
  const onSitDownAckRef = useRef(options.onSitDownAck);
  onSitDownAckRef.current = options.onSitDownAck;
  const onStandUpAckRef = useRef(options.onStandUpAck);
  onStandUpAckRef.current = options.onStandUpAck;
  const onRequestBuyInAckRef = useRef(options.onRequestBuyInAck);
  onRequestBuyInAckRef.current = options.onRequestBuyInAck;
  const onAdminControlAckRef = useRef(options.onAdminControlAck);
  onAdminControlAckRef.current = options.onAdminControlAck;
  const onAuthInvalidRef = useRef(options.onAuthInvalid);
  onAuthInvalidRef.current = options.onAuthInvalid;
  const onSocketToastRef = useRef(options.onSocketToast);
  onSocketToastRef.current = options.onSocketToast;

  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [gameState, setGameState] = useState<SanitizedGameState | null>(null);
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [hostPlayerId, setHostPlayerId] = useState<string | null>(null);
  const [lastSocketError, setLastSocketError] = useState<string | null>(null);
  const [lastSeq, setLastSeq] = useState<number | null>(null);
  const [gameEndedPayload, setGameEndedPayload] = useState<GameEndedPayload | null>(null);

  const selfPlayer = useMemo(() => {
    if (!gameState || !selfPlayerId) return null;
    return gameState.players.find((p) => p.id === selfPlayerId) ?? null;
  }, [gameState, selfPlayerId]);

  const applySnapshot = useCallback((state: SanitizedGameState) => {
    setGameState(state);
    if (state.hostPlayerId) setHostPlayerId(state.hostPlayerId);
  }, []);

  const disconnect = useCallback(() => {
    const s = socketRef.current;
    if (s) {
      s.removeAllListeners();
      // disconnect() 替代 close()；先 polling 再升级 ws，减少 Strict Mode 在 WS CONNECTING 阶段被 tear down 时的控制台噪音
      s.disconnect();
      socketRef.current = null;
    }
    setSocket(null);
    setConnectionStatus('disconnected');
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return socketRef.current;

    disconnect();
    setLastSocketError(null);
    setConnectionStatus('connecting');

    const s = io(url, {
      // 先 long-polling 再升级到 WebSocket，避免 dev 下 Strict Mode 极早 cleanup 时关掉尚未 open 的 raw WebSocket
      transports: ['polling', 'websocket'],
      autoConnect: false,
    });
    socketRef.current = s;

    const onConnect = () => setConnectionStatus('connected');
    const onDisconnect = () => setConnectionStatus('disconnected');
    const onError = (err: unknown) => {
      setConnectionStatus('error');
      const raw = err instanceof Error ? err.message : 'CONNECT_ERROR';
      setLastSocketError(raw);
      onSocketToastRef.current?.(
        err instanceof Error
          ? `无法连接：${err.message}`
          : '无法连接服务器，请检查网络与 VITE_SOCKET_URL',
      );
    };

    const onGameStateUpdate = (payload: GameStateUpdatePayload) => {
      if (payload?.state) {
        applySnapshot(payload.state);
        if (typeof payload.seq === 'number') setLastSeq(payload.seq);
      }
    };

    const onSyncGameState = (payload: SyncGameStatePayload) => {
      if (payload?.state) applySnapshot(payload.state);
    };

    const onAdminChanged = (payload: AdminChangedPayload) => {
      if (payload?.newHostId) setHostPlayerId(payload.newHostId);
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    s.on(SocketServerEvent.GameStateUpdate, onGameStateUpdate);
    s.on(SocketServerEvent.SyncGameState, onSyncGameState);
    s.on(SocketServerEvent.AdminChanged, onAdminChanged);
    s.on('join_room_error', (p: { message?: string }) => {
      const code = p?.message ?? 'JOIN_ROOM_FAILED';
      if (code === 'AUTH_INVALID' && onAuthInvalidRef.current) {
        void onAuthInvalidRef.current();
        return;
      }
      if (code !== 'ROOM_PASSWORD_REQUIRED') {
        onSocketToastRef.current?.(mapJoinRoomError(code));
      }
      if (
        code === 'ROOM_PASSWORD_REQUIRED' ||
        code === 'ROOM_PASSWORD_INVALID' ||
        code === 'ROOM_NOT_FOUND'
      ) {
        setLastSocketError(code);
      } else {
        setLastSocketError(null);
      }
    });
    s.on('player_action_error', (p: { message?: string }) => {
      onSocketToastRef.current?.(
        mapPlayerActionError(p?.message ?? 'ACTION_FAILED'),
      );
    });
    s.on('sit_down_ack', (p: { roomId?: string; ok?: boolean; message?: string }) => {
      onSitDownAckRef.current?.(p);
    });
    s.on('stand_up_ack', (p: { roomId?: string; ok?: boolean; message?: string }) => {
      onStandUpAckRef.current?.(p);
    });
    s.on('update_nickname_ack', (p: { ok?: boolean; message?: string }) => {
      if (p?.ok !== false) return;
      const code = p.message ?? '';
      const map: Record<string, string> = {
        NOT_AT_TABLE: '你不在座位上，无法改名',
        INVALID_NICKNAME: '昵称无效，请填写非空内容',
      };
      onSocketToastRef.current?.(
        map[code] ?? (code ? `改名失败：${code}` : '改名失败'),
      );
    });
    s.on(SocketServerEvent.GameEnded, (p: GameEndedPayload) => {
      if (p?.roomId && Array.isArray(p.rows)) setGameEndedPayload(p);
    });
    s.on(
      'request_buy_in_ack',
      (p: {
        roomId?: string;
        ok?: boolean;
        reason?: string;
        requestId?: string;
      }) => {
        onRequestBuyInAckRef.current?.(p);
      },
    );
    s.on(
      'admin_control_ack',
      (p: { roomId?: string; ok?: boolean; message?: string }) => {
        onAdminControlAckRef.current?.(p);
      },
    );

    s.connect();
    setSocket(s);
    return s;
  }, [url, disconnect, applySnapshot]);

  useEffect(() => {
    if (!autoConnect) return;
    connect();
    return () => disconnect();
  }, [autoConnect, connect, disconnect]);

  const clearLastSocketError = useCallback(() => setLastSocketError(null), []);

  const joinRoom = useCallback(
    (payload: JoinRoomPayload) => {
      setLastSocketError(null);
      setSelfPlayerId(payload.playerId);
      const s = socketRef.current ?? connect();
      s.emit(SocketClientEvent.JoinRoom, payload);
    },
    [connect],
  );

  const sitDown = useCallback((payload: SitDownPayload) => {
    socketRef.current?.emit(SocketClientEvent.SitDown, payload);
  }, []);

  const standUp = useCallback((payload: StandUpPayload) => {
    socketRef.current?.emit(SocketClientEvent.StandUp, payload);
  }, []);

  const updateNickname = useCallback((payload: UpdateNicknamePayload) => {
    socketRef.current?.emit(SocketClientEvent.UpdateNickname, payload);
  }, []);

  const sendPlayerAction = useCallback((payload: PlayerActionPayload) => {
    socketRef.current?.emit(SocketClientEvent.PlayerAction, payload);
  }, []);

  const requestBuyIn = useCallback((payload: RequestBuyInPayload) => {
    socketRef.current?.emit(SocketClientEvent.RequestBuyIn, payload);
  }, []);

  const sendAdminControl = useCallback(
    (payload: {
      roomId: string;
      command: string;
      targetPlayerId?: string;
      value?: number;
      reason?: string;
      requestId?: string;
      newRoomPassword?: string;
    }) => {
      socketRef.current?.emit(SocketClientEvent.AdminControl, payload);
    },
    [],
  );

  const dismissGameEnded = useCallback(() => setGameEndedPayload(null), []);

  const pingHeartbeat = useCallback(() => {
    socketRef.current?.emit('heartbeat:ping');
  }, []);

  return {
    socket,
    connectionStatus,
    gameState,
    selfPlayerId,
    selfPlayer,
    hostPlayerId,
    setHostPlayerId,
    lastSocketError,
    lastSeq,
    connect,
    disconnect,
    joinRoom,
    clearLastSocketError,
    sitDown,
    standUp,
    updateNickname,
    sendPlayerAction,
    requestBuyIn,
    sendAdminControl,
    pingHeartbeat,
    gameEndedPayload,
    dismissGameEnded,
  };
}
