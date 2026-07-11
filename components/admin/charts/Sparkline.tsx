'use client';
import { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line } from 'recharts';

export interface SparklineProps {
  data: Array<number>;
  height?: number;
  color?: string;
  trend?: 'up' | 'down' | 'flat';
}

const TREND_COLORS = {
  up: '#7A9E7E',
  down: '#C76F6F',
  flat: '#9c8f7a',
};

function defaultColor(data: Array<number>, trend?: SparklineProps['trend']): string {
  if (trend) return TREND_COLORS[trend];
  if (data.length < 2) return TREND_COLORS.flat;
  const first = data[0];
  const last = data[data.length - 1];
  if (last > first) return TREND_COLORS.up;
  if (last < first) return TREND_COLORS.down;
  return TREND_COLORS.flat;
}

interface SparkPoint {
  i: number;
  v: number;
}

export function Sparkline({ data, height = 32, color, trend }: SparklineProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div style={{ height, width: 80 }} className="bg-muted/30 rounded animate-pulse" />;
  }

  if (data.length === 0) {
    return <div style={{ height, width: 80 }} className="text-xs text-muted-foreground">—</div>;
  }

  const points: SparkPoint[] = data.map((v, i) => ({ i, v }));
  const stroke = color ?? defaultColor(data, trend);

  return (
    <ResponsiveContainer width={80} height={height}>
      <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={stroke}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}