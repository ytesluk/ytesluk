"use client";

import { useMemo, useState } from "react";
import { Tabs } from "./ui";

export type RangeKey = "7" | "30" | "90";

/** Date-range filter (one row above the charts). Returns the API query string for the range. */
export function rangeQuery(r: RangeKey): string {
  const to = new Date();
  const from = new Date(to.getTime() - Number(r) * 86_400_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <Tabs
      value={value}
      onChange={onChange}
      options={[
        { value: "7", label: "7 dias" },
        { value: "30", label: "30 dias" },
        { value: "90", label: "90 dias" },
      ]}
    />
  );
}

/** Range state with a stable query string (computed once per selection, not per render). */
export function useRange(initial: RangeKey = "30"): [RangeKey, (r: RangeKey) => void, string] {
  const [range, setRange] = useState<RangeKey>(initial);
  const query = useMemo(() => rangeQuery(range), [range]);
  return [range, setRange, query];
}
