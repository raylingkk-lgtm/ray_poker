/**
 * Socket.IO 事件名（与 PRD §3.3 行动流、§3.7 牌力展示一致）。
 * 使用 snake_case 与客户端约定对齐。
 */

/** 客户端 → 服务端 */
export enum ClientSocketEvent {
  /** 入桌 / 断线重连：携带 roomId + playerId，服务端下发 sync_game_state */
  JoinRoom = 'join_room',
  SitDown = 'sit_down',
  PlayerAction = 'player_action',
  RequestBuyIn = 'request_buy_in',
  AdminControl = 'admin_control',
}

/** 服务端 → 客户端 */
export enum ServerSocketEvent {
  /** 牌局状态增量/全量推送（负载须已按接收方清洗） */
  GameStateUpdate = 'game_state_update',
  /** 同步快照（加入房间、重连、显式拉取；负载须已按接收方清洗） */
  SyncGameState = 'sync_game_state',
  /** 房主变更（非牌面敏感，可房间广播同一份） */
  AdminChanged = 'admin_changed',
  /** 房间结束 / 手动解散：战绩表（非底牌敏感，可房间广播） */
  GameEnded = 'game_ended',
}
