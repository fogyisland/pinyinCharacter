'use client';

import { useEffect, useState, type ComponentType } from 'react';
import type { BarChartTopProps } from './BarChartTop';

/**
 * The top-paths chart, loaded on demand.
 *
 * recharts weighs roughly 350 KB of JavaScript, and the analytics page
 * needs it for nothing but this one chart. The module is therefore
 * imported after the page has become interactive instead of being part of
 * the page's initial bundle.
 */
export function LazyBarChartTop(props: BarChartTopProps) {
  const [Chart, setChart] = useState<ComponentType<BarChartTopProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('./BarChartTop')
      .then((mod) => {
        // The updater form: without it React would call the component
        // function with the previous state as its argument.
        if (!cancelled) setChart(() => mod.BarChartTop);
      })
      .catch((err: unknown) => {
        console.error('Failed to load the chart module', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Chart) {
    // Same geometry as the chart's own "not mounted yet" placeholder, so the
    // layout does not jump when the module arrives.
    return (
      <div
        style={{ height: Math.max(120, props.data.length * 32) }}
        className="bg-paper-deep/40 rounded animate-pulse"
      />
    );
  }

  return <Chart {...props} />;
}
