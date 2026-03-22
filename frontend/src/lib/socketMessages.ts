/** 将服务端 Socket 错误码转为玩家可见中文 */

export function mapJoinRoomError(code: string): string {
  const m: Record<string, string> = {
    INVALID_PAYLOAD: '进房参数无效，请刷新页面重试',
    AUTH_INVALID: '登录已失效，正在重新获取身份…',
    ROOM_NOT_FOUND: '房间不存在或已关闭',
    ROOM_PASSWORD_REQUIRED: '需要输入房间密码',
    ROOM_PASSWORD_INVALID: '房间密码错误',
    JOIN_ROOM_FAILED: '进房失败',
  };
  return m[code] ?? (code.startsWith('Room.') || code.includes('_') ? `进房失败（${code}）` : code);
}

/** HTTP API（大厅创建房间等）错误码 */
export function mapLobbyHttpError(code: string | undefined, status: number): string {
  const m: Record<string, string> = {
    AUTH_INVALID: '登录已失效（例如后端重启后），已尝试重新获取身份；若仍失败请刷新页面',
    MISSING_AUTH: '缺少身份信息，请刷新页面',
    DISPLAY_NAME_TOO_LONG: '房间名最多 10 个字',
    INVALID_DISPLAY_NAME: '房间名无效',
  };
  if (code && m[code]) return m[code];
  if (status === 401) return '未授权，请刷新页面后重试';
  if (status === 403) return '没有权限执行此操作';
  return code ? `操作失败（${code}）` : `操作失败（${status}）`;
}

export function mapPlayerActionError(code: string): string {
  const m: Record<string, string> = {
    ACTION_FAILED: '操作失败',
    'PokerEngine.processAction: not this player turn': '还没轮到你操作',
    'PokerEngine.processAction: unknown player': '玩家身份异常',
    'PokerEngine.processAction: player cannot act': '当前无法行动',
    'PokerEngine.processAction: illegal check': '当前不能过牌',
    'PokerEngine.processAction: bet illegal when facing bet': '有人下注时不能开池',
    'PokerEngine.processAction: bet below big blind': '下注低于大盲',
    'PokerEngine.processAction: raise must exceed current highest': '加注未达到最低要求',
  };
  return m[code] ?? (code.length > 60 ? '操作无效' : code);
}
