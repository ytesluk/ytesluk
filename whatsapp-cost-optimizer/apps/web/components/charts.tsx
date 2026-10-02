"use client";

import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Card, Table, Tabs } from "./ui";

/**
 * Chart primitives following the dataviz method: categorical slots in fixed order (blue, orange,
 * aqua), 2px lines, ≥8px active markers with a 2px surface ring, hairline recessive grid, one
 * y-axis, legend for ≥2 series plus direct end labels, hover tooltip, and a table view for every chart.
 */
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;

export interface SeriesSpec {
  key: string;
  label: string;
}

type Row = Record<string, string | number | null>;

const axisTick = { fill: "var(--axis)", fontSize: 11 };

function TooltipBox({ active, payload, label, format, labelFormat }: Partial<TooltipContentProps<number, string>> & { format: (v: number) => string; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : String(label)}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium text-ink">{format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

function LegendRow({ series }: { series: SeriesSpec[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legenda">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES[i] }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ChartFrame({ title, subtitle, series, rows, xKey, xLabel, format, xFormat, height, children }: {
  title: string;
  subtitle?: React.ReactNode;
  series: SeriesSpec[];
  rows: Row[];
  xKey: string;
  xLabel: string;
  format: (v: number) => string;
  xFormat?: (v: string) => string;
  height: number;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={<Tabs value={view} onChange={setView} options={[{ value: "chart", label: "Gráfico" }, { value: "table", label: "Tabela" }]} />}
    >
      {view === "chart" ? (
        <figure aria-label={title}>
          <LegendRow series={series} />
          <div style={{ height }}>{children}</div>
        </figure>
      ) : (
        <div className="max-h-[360px] overflow-y-auto">
          <Table
            dense
            rows={rows}
            rowKey={(r, i) => `${r[xKey]}-${i}`}
            columns={[
              { key: xKey, header: xLabel, render: (r) => (xFormat ? xFormat(String(r[xKey])) : String(r[xKey])) },
              ...series.map((s) => ({ key: s.key, header: s.label, align: "right" as const, render: (r: Row) => (r[s.key] === null ? "—" : format(Number(r[s.key]))) })),
            ]}
          />
        </div>
      )}
    </Card>
  );
}

export function LineCard(props: { title: string; subtitle?: React.ReactNode; rows: Row[]; xKey: string; xLabel: string; series: SeriesSpec[]; format: (v: number) => string; xFormat?: (v: string) => string; height?: number }) {
  const { rows, xKey, series, format, xFormat } = props;
  const last = rows.length - 1;
  // Direct end labels with collision avoidance: each label is nudged above any label already placed
  // within 14px (labels render in series order during one pass).
  const placed = useRef<number[]>([]);
  placed.current = [];
  const endLabel = (text: string) =>
    function EndLabel({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) {
      if (index !== last) return <g />;
      let yy = Number(y);
      for (const p of [...placed.current].sort((a, b) => b - a)) if (Math.abs(p - yy) < 14) yy = p - 14;
      placed.current.push(yy);
      return (
        <text x={Number(x) + 8} y={yy} dy={4} fontSize={11} fill="var(--ink-2)">
          {text}
        </text>
      );
    };
  return (
    <ChartFrame {...props} height={props.height ?? 260}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: series.length > 1 ? 96 : 16, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
          <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} tickFormatter={xFormat} minTickGap={24} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} width={78} />
          <Tooltip content={<TooltipBox format={format} labelFormat={xFormat} />} cursor={{ stroke: "var(--baseline)", strokeWidth: 1 }} />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={SERIES[i]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
              isAnimationActive={false}
              label={series.length > 1 ? endLabel(s.label) : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function BarCard(props: { title: string; subtitle?: React.ReactNode; rows: Row[]; xKey: string; xLabel: string; series: SeriesSpec[]; format: (v: number) => string; xFormat?: (v: string) => string; height?: number; stacked?: boolean; layout?: "vertical" | "horizontal" }) {
  const { rows, xKey, series, format, xFormat, stacked } = props;
  const horizontal = props.layout === "horizontal";
  return (
    <ChartFrame {...props} height={props.height ?? 260}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, bottom: 0, left: 4 }} barCategoryGap={horizontal ? "28%" : "22%"} barGap={2}>
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--grid)" strokeWidth={1} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} />
              <YAxis type="category" dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} width={150} tickFormatter={xFormat} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--baseline)" }} tickFormatter={xFormat} minTickGap={16} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v: number) => format(v)} width={78} />
            </>
          )}
          <Tooltip content={<TooltipBox format={format} labelFormat={xFormat} />} cursor={{ fill: "var(--surface-2)" }} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={SERIES[i]}
              stackId={stacked ? "s" : undefined}
              stroke={stacked ? "var(--surface-1)" : undefined}
              strokeWidth={stacked ? 2 : 0}
              radius={stacked ? (i === series.length - 1 ? [4, 4, 0, 0] : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
          {series.length > 1 ? <Legend content={() => null} /> : null}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
