import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SettlementTableBlock } from '../components/SettlementTableBlock';
import { Toast } from '../components/Toast';
import { getApiBase } from '../lib/apiBase';
import {
  clipRoomDisplayName,
  randomRoomDisplayName,
  roomNameCodePointLength,
} from '../lib/roomDisplayName';
import { PENDING_ROOM_PASSWORD_KEY } from '../lib/roomJoin';
import { setStoredRoomPassword } from '../lib/roomPasswordStorage';
import { mapLobbyHttpError } from '../lib/socketMessages';
import type { PlayerSession } from '../lib/session';
import type {
  MatchHistoryRecord,
  RoomListingItem,
} from '../types/game';

export interface LobbyProps {
  session: PlayerSession;
  onEnterRoom: (roomId: string) => void;
  onRenewSession: () => Promise<PlayerSession>;
}

function SheetModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lobby-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/70"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className="relative z-10 max-h-[min(90vh,32rem)] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/10 bg-gray-900 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 id="lobby-modal-title" className="text-base font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-white/60 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Lobby({ session, onEnterRoom, onRenewSession }: LobbyProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [createPwd, setCreatePwd] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  /** 从列表点入时的 `joinPasswordRevision`；手动输入房间号为 `null` */
  const [joinListRev, setJoinListRev] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomListingItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [matches, setMatches] = useState<MatchHistoryRecord[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<MatchHistoryRecord | null>(
    null,
  );

  const fetchRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/api/rooms`);
      const j = (await r.json()) as { rooms?: RoomListingItem[] };
      if (r.ok && Array.isArray(j.rooms)) setRooms(j.rooms);
    } catch {
      /* 静默失败，列表可为空 */
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  const fetchMatches = useCallback(async () => {
    setMatchesLoading(true);
    try {
      const r = await fetch(`${getApiBase()}/api/match-history?limit=50`);
      const j = (await r.json()) as { matches?: MatchHistoryRecord[] };
      if (r.ok && Array.isArray(j.matches)) setMatches(j.matches);
    } catch {
      /* ignore */
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRooms();
    void fetchMatches();
  }, [fetchMatches, fetchRooms]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchRooms();
    }, 8000);
    return () => window.clearInterval(id);
  }, [fetchRooms]);

  const handleCreate = useCallback(async () => {
    setModalError(null);
    const trimmedName = clipRoomDisplayName(createDisplayName.trim());
    if (!trimmedName) {
      setModalError('请填写房间展示名');
      return;
    }
    if (roomNameCodePointLength(trimmedName) > 10) {
      setModalError('房间名最多 10 个字');
      return;
    }
    setBusy(true);
    try {
      const base = getApiBase();
      const buildBody = (sess: PlayerSession) => {
        const body: {
          playerId: string;
          authToken: string;
          displayName: string;
          password?: string;
        } = {
          playerId: sess.playerId,
          authToken: sess.authToken,
          displayName: trimmedName,
        };
        const pwd = createPwd.trim();
        if (pwd) body.password = pwd;
        return body;
      };

      const parseJson = async (r: Response) => {
        try {
          return (await r.json()) as { roomId?: string; error?: string };
        } catch {
          return {} as { roomId?: string; error?: string };
        }
      };

      let sess = session;
      let r = await fetch(`${base}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(sess)),
      });

      if (r.status === 401) {
        try {
          sess = await onRenewSession();
          setToast('登录已更新，正在创建房间…');
          r = await fetch(`${base}/api/rooms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildBody(sess)),
          });
        } catch {
          const msg = '无法重新获取身份，请检查网络后刷新页面';
          setModalError(msg);
          setToast(msg);
          return;
        }
      }

      const j = await parseJson(r);
      if (!r.ok) {
        const errMsg = mapLobbyHttpError(j.error, r.status);
        setModalError(errMsg);
        setToast(errMsg);
        return;
      }
      if (!j.roomId) {
        setModalError('创建失败：无房间号');
        return;
      }
      setCreateOpen(false);
      setCreatePwd('');
      setCreateDisplayName('');
      onEnterRoom(j.roomId);
    } catch {
      const msg = '网络错误，请检查 VITE_SOCKET_URL 与后端是否可达';
      setModalError(msg);
      setToast(msg);
    } finally {
      setBusy(false);
    }
  }, [createDisplayName, createPwd, onEnterRoom, onRenewSession, session]);

  const handleJoin = useCallback(() => {
    setModalError(null);
    const id = joinRoomId.trim();
    if (!id) {
      setModalError('请输入房间号');
      return;
    }
    const p = joinPwd.trim();
    const rev =
      rooms.find((r) => r.roomId === id)?.joinPasswordRevision ??
      joinListRev ??
      0;
    if (p) {
      setStoredRoomPassword(id, p, rev);
      sessionStorage.setItem(PENDING_ROOM_PASSWORD_KEY, p);
    } else {
      sessionStorage.removeItem(PENDING_ROOM_PASSWORD_KEY);
    }
    setJoinOpen(false);
    onEnterRoom(id);
  }, [joinListRev, joinPwd, joinRoomId, onEnterRoom, rooms]);

  const openJoinWithRoomId = useCallback((id: string, row?: RoomListingItem) => {
    setJoinRoomId(id);
    setJoinListRev(row ? row.joinPasswordRevision : null);
    setJoinOpen(true);
    setModalError(null);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-gray-900 px-4 py-6 text-white">
      <div className="mx-auto w-full max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Ray Poker</h1>
          <p className="mt-1 text-sm text-white/50">
            身份已绑定本机浏览器。请选择创建或进入房间。
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500"
            onClick={() => {
              setModalError(null);
              setCreateDisplayName(randomRoomDisplayName());
              setCreateOpen(true);
            }}
          >
            创建房间
          </button>
          <button
            type="button"
            className="flex-1 rounded-xl border border-white/20 bg-white/5 py-3 text-sm font-semibold text-white hover:bg-white/10"
            onClick={() => {
              setModalError(null);
              setJoinListRev(null);
              setJoinOpen(true);
            }}
          >
            进入房间
          </button>
        </div>

        <section className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-white/85">进行中的桌</h2>
            <button
              type="button"
              className="text-xs text-emerald-400/90 hover:underline"
              onClick={() => void fetchRooms()}
            >
              {roomsLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
          {rooms.length === 0 ? (
            <p className="mt-2 text-center text-xs text-white/40">
              暂无进行中的房间，或无法连接列表
            </p>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
              {rooms.map((row) => (
                <li key={row.roomId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => openJoinWithRoomId(row.roomId, row)}
                  >
                    <span className="min-w-0 flex-1 truncate text-left text-sm text-white/95">
                      {row.displayName ?? row.roomId}
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-white/50">
                      <span className="block font-mono text-[10px] text-white/40">
                        {row.roomId}
                      </span>
                      {row.seatedCount} 人 · {row.smallBlind}/{row.bigBlind}
                      {row.hasPassword ? ' · 🔒' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-white/85">对局记录</h2>
            <button
              type="button"
              className="text-xs text-emerald-400/90 hover:underline"
              onClick={() => void fetchMatches()}
            >
              {matchesLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
          {matches.length === 0 ? (
            <p className="mt-2 text-center text-xs text-white/40">
              暂无已结束房间记录（服务端重启后清空）
            </p>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                    onClick={() => setHistoryDetail(m)}
                  >
                    <span className="text-[11px] text-white/45">
                      {new Date(m.endedAt).toLocaleString()}
                    </span>
                    <span className="font-mono text-xs text-white/85">
                      {m.roomId}
                    </span>
                    <span className="text-[11px] text-white/50">
                      {m.rows.length} 名玩家
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {createOpen ? (
        <SheetModal title="创建房间" onClose={() => setCreateOpen(false)}>
          <p className="mb-2 text-xs text-white/45">
            房间展示名（最多 10 个字）；可选进房密码。
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              autoComplete="off"
              placeholder="房间名"
              value={createDisplayName}
              onChange={(e) =>
                setCreateDisplayName(clipRoomDisplayName(e.target.value))
              }
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
            />
            <button
              type="button"
              className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
              onClick={() => setCreateDisplayName(randomRoomDisplayName())}
            >
              随机
            </button>
          </div>
          <p className="mb-2 mt-1 text-[10px] text-white/35">
            已输入 {roomNameCodePointLength(createDisplayName)} / 10
          </p>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="进房密码（可选）"
            value={createPwd}
            onChange={(e) => setCreatePwd(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
          />
          {modalError ? (
            <p className="mt-2 text-xs text-amber-300/90">{modalError}</p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCreate()}
            className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建并进入'}
          </button>
        </SheetModal>
      ) : null}

      {joinOpen ? (
        <SheetModal title="进入房间" onClose={() => setJoinOpen(false)}>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="房间号"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm outline-none ring-emerald-500/40 focus:ring-2"
          />
          <input
            type="password"
            autoComplete="off"
            placeholder="进房密码（若房主设置了）"
            value={joinPwd}
            onChange={(e) => setJoinPwd(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
          />
          {modalError ? (
            <p className="mt-2 text-xs text-amber-300/90">{modalError}</p>
          ) : null}
          <button
            type="button"
            onClick={handleJoin}
            className="mt-4 w-full rounded-lg border border-white/20 bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
          >
            进入
          </button>
        </SheetModal>
      ) : null}

      {historyDetail ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭"
            onClick={() => setHistoryDetail(null)}
          />
          <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/10 bg-gray-950 p-4 shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">战绩详情</h2>
              <button
                type="button"
                className="text-sm text-white/60 hover:text-white"
                onClick={() => setHistoryDetail(null)}
              >
                关闭
              </button>
            </div>
            <p className="mb-2 text-center text-[11px] text-white/45">
              {new Date(historyDetail.endedAt).toLocaleString()}
            </p>
            <SettlementTableBlock
              roomId={historyDetail.roomId}
              rows={historyDetail.rows}
            />
          </div>
        </div>
      ) : null}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
