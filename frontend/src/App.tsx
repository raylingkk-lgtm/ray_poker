import { useCallback, useEffect, useState } from 'react';
import { PortraitLockOverlay } from './components/PortraitLockOverlay';
import { useIsLandscape } from './hooks/usePortraitLock';
import { getApiBase } from './lib/apiBase';
import {
  bootstrapSession,
  clearSession,
  ensureSession,
  type PlayerSession,
} from './lib/session';
import { GameRoom } from './pages/GameRoom';
import { Lobby } from './pages/Lobby';

function readRoomIdFromLocation(): string {
  const q = new URLSearchParams(window.location.search);
  return (q.get('room') ?? q.get('roomId') ?? '').trim();
}

export default function App() {
  const landscape = useIsLandscape();
  const [roomId, setRoomId] = useState(readRoomIdFromLocation);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<PlayerSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setRoomId(readRoomIdFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigateToRoom = useCallback((id: string) => {
    const trimmed = id.trim();
    const url = new URL(window.location.href);
    url.searchParams.set('room', trimmed);
    window.history.pushState({}, '', url);
    setRoomId(trimmed);
  }, []);

  const navigateToLobby = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('roomId');
    const qs = url.searchParams.toString();
    window.history.pushState(
      {},
      '',
      qs ? `${url.pathname}?${qs}` : url.pathname,
    );
    setRoomId('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAuthError(null);
    ensureSession()
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthError('无法获取游戏身份，请确认后端已启动且 VITE_SOCKET_URL 正确');
        }
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const renewSession = useCallback(async (): Promise<PlayerSession> => {
    clearSession();
    const s = await bootstrapSession();
    setSession(s);
    return s;
  }, []);

  const retryBootstrap = useCallback(() => {
    setAuthReady(false);
    setAuthError(null);
    ensureSession()
      .then((s) => setSession(s))
      .catch(() =>
        setAuthError('无法获取游戏身份，请确认后端已启动且 VITE_SOCKET_URL 正确'),
      )
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) {
    return (
      <>
        {landscape ? <PortraitLockOverlay /> : null}
        {!landscape ? (
          <div className="flex min-h-screen items-center justify-center bg-gray-900 text-sm text-white/60">
            正在准备会话…
          </div>
        ) : null}
      </>
    );
  }

  if (authError || !session) {
    return (
      <>
        {landscape ? <PortraitLockOverlay /> : null}
        {!landscape ? (
          <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-900 px-4 text-center">
            <p className="text-sm text-amber-200/90">{authError ?? '无会话'}</p>
            <p className="text-xs text-white/40">API：{getApiBase()}</p>
            <button
              type="button"
              onClick={retryBootstrap}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
            >
              重试
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      {landscape ? <PortraitLockOverlay /> : null}
      {!landscape ? (
        <div className="min-h-full min-w-full">
          {roomId ? (
            <GameRoom
              roomId={roomId}
              session={session}
              onRenewSession={renewSession}
              onNavigateToRoom={navigateToRoom}
              onLeaveRoom={navigateToLobby}
            />
          ) : (
            <Lobby
              session={session}
              onEnterRoom={navigateToRoom}
              onRenewSession={renewSession}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
