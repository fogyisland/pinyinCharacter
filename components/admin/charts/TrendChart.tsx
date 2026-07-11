'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

interface SeriesPoint {
  date: string;
  value: number;
}

export interface TrendChartProps {
  series: Array<{
    label: string;
    data: SeriesPoint[];
    color?: string;
  }>;
  height?: number;
  yLabel?: string;
  formatValue?: (v: number) => string;
}

const DEFAULT_COLORS = ['#5A4530', '#7A9E7E', '#C09060', '#8B6F47'];

function defaultFormat(v: number): string {
  return v.toLocaleString('zh-CN');
}

interface MergedPoint extends SeriesPoint {
  [seriesLabel: string]: number | string;
}

function mergeSeries(series: TrendChartProps['series']): MergedPoint[] {
  const byDate = new Map<string, MergedPoint>();
  for (const s of series) {
    for (const p of s.data) {
      const existing: MergedPoint = byDate.get(p.date) ?? ({ date: p.date } as MergedPoint);
      existing[s.label] = p.value;
      byDate.set(p.date, existing);
    }
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function TrendChart({
  series,
  height = 240,
  yLabel,
  formatValue = defaultFormat,
}: TrendChartProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        style={{ height }}
        className="bg-muted/30 rounded animate-pulse"
        aria-label="图表加载中"
      />
    );
  }

  if (series.length === 0 || series.every((s) => s.data.length === 0)) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded"
      >
        暂无数据
      </div>
    );
  }

  const merged = mergeSeries(series);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e0d8" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#7a6f5f' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#7a6f5f' }}
          tickFormatter={formatValue}
          label={
            yLabel
              ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#7a6f5f' } }
              : undefined
          }
        />
        <Tooltip
          formatter={(v: number) => formatValue(v)}
          contentStyle={{ background: '#fffaf2', border: '1px solid #d8cfbe', borderRadius: 6 }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.label}
            type="monotone"
            dataKey={s.label}
            stroke={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
