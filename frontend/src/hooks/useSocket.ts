import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ConnectionStatus } from '../types';

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lastPongAt, setLastPongAt] = useState<number | null>(null);
  const [lastAckAt, setLastAckAt] = useState<number | null>(null);

  const ping = useCallback(() => {
    socket?.emit('heartbeat:ping');
  }, [socket]);

  useEffect(() => {
    setStatus('connecting');
    const s = io(socketUrl, {
      transports: ['websocket', 'polling'],
    });

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onConnectError = () => setStatus('error');

    const onAck = (payload: { t: number }) => setLastAckAt(payload.t);
    const onPong = (payload: { t: number }) => setLastPongAt(payload.t);

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    s.on('heartbeat:ack', onAck);
    s.on('heartbeat:pong', onPong);

    setSocket(s);

    const interval = window.setInterval(() => {
      s.emit('heartbeat:ping');
    }, 5000);

    return () => {
      window.clearInterval(interval);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.off('heartbeat:ack', onAck);
      s.off('heartbeat:pong', onPong);
      s.close();
      setSocket(null);
      setStatus('disconnected');
    };
  }, []);

  return { socket, status, lastAckAt, lastPongAt, ping };
}
