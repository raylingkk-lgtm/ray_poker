/**
 * 10 个座位在椭圆上的百分比坐标（相对牌桌容器中心）。
 * 座位 1（index 0）在底部正中，顺时针递增（俯视顺时针 → 角度递减）。
 */
export const TABLE_SEAT_COUNT = 10;

export interface SeatPosition {
  topPct: number;
  leftPct: number;
}

/** rx/ry 为相对中心半轴百分比（容器为正方形参照） */
export function computeEllipseSeatPositions(
  count: number,
  rxPct = 44,
  ryPct = 36,
): SeatPosition[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 2 - (i * 2 * Math.PI) / count;
    return {
      leftPct: 50 + rxPct * Math.cos(angle),
      topPct: 50 + ryPct * Math.sin(angle),
    };
  });
}
