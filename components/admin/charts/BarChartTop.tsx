'use client';
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';

export interface BarChartTopProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
  formatValue?: (v: number) => string;
  href?: (label: string) => string;
}

const DEFAULT_COLORS = ['#5A4530', '#7A9E7E', '#C09060', '#8B6F47', '#9c8f7a'];

function defaultFormat(v: number): string {
  return v.toLocaleString('zh-CN');
}

export function BarChartTop({
  data,
  formatValue = defaultFormat,
  href,
}: BarChartTopProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        style={{ height: Math.max(120, data.length * 32) }}
        className="bg-muted/30 rounded animate-pulse"
      />
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded p-8">
        暂无数据
      </div>
    );
  }

  return (
    <ResponsiveContainer
      width="100%"
      height={Math.max(120, data.length * 32)}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
      >
        <XAxis type="number" hide />
        <YAxis
          dataKey="label"
          type="category"
          tick={{ fontSize: 12, fill: '#3a3027' }}
          width={120}
        />
        <Tooltip
          formatter={(v: number) => formatValue(v)}
          contentStyle={{ background: '#fffaf2', border: '1px solid #d8cfbe', borderRadius: 6 }}
        />
        <Bar dataKey="value" isAnimationActive={false}>
          {data.map((entry, i) => (
            <Cell
              key={entry.label}
              fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              cursor={href ? 'pointer' : 'default'}
              onClick={href ? () => { window.location.href = href(entry.label); } : undefined}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
