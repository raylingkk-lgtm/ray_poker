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
} from '../types/game';
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
  const onRequestBuyInAckRef = useRef(options.onRequestBuyInAck);
  onRequestBuyInAckRef.current = options.onRequestBuyInAck;
  const onAdminControlAckRef = useRef(options.onAdminControlAck);
  onAdminControlAckRef.current = options.onAdminControlAck;

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
      s.close();
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
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
    socketRef.current = s;

    const onConnect = () => setConnectionStatus('connected');
    const onDisconnect = () => setConnectionStatus('disconnected');
    const onError = (err: unknown) => {
      setConnectionStatus('error');
      setLastSocketError(err instanceof Error ? err.message : 'CONNECT_ERROR');
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
      setLastSocketError(p?.message ?? 'JOIN_ROOM_FAILED');
    });
    s.on('player_action_error', (p: { message?: string }) => {
      setLastSocketError(p?.message ?? 'ACTION_FAILED');
    });
    s.on('sit_down_ack', (p: { roomId?: string; ok?: boolean; message?: string }) => {
      onSitDownAckRef.current?.(p);
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
        if (p?.ok === false) {
          setLastSocketError(p.message ?? 'ADMIN_CONTROL_FAILED');
        }
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

  const joinRoom = useCallback(
    (payload: JoinRoomPayload) => {
      setSelfPlayerId(payload.playerId);
      const s = socketRef.current ?? connect();
      s.emit(SocketClientEvent.JoinRoom, payload);
    },
    [connect],
  );

  const sitDown = useCallback((payload: SitDownPayload) => {
    socketRef.current?.emit(SocketClientEvent.SitDown, payload);
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
    sitDown,
    sendPlayerAction,
    requestBuyIn,
    sendAdminControl,
    pingHeartbeat,
    gameEndedPayload,
    dismissGameEnded,
  };
}
