import { useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { fmt } from "../lib/format";
import { chartTheme, chartTooltipStyle } from "../lib/theme";

// Split out of Leaderboard so Recharts lands in its own chunk. The standings
// list above it renders without waiting for ~400KB of charting code.
function LeaderboardCharts({ activeChart, barData, lineData, visibleStats }) {
  const t = useMemo(chartTheme, []);
  const tooltip = useMemo(() => chartTooltipStyle(t), [t]);

  const axis = { stroke: t.axis, fontSize: 11, tick: { fill: t.axis } };
  const labelStyle = { color: t.text, fontWeight: 600, marginBottom: 4 };
  const money = (v) => "$" + v;

  return (
    <div className="lb-chart">
      {activeChart === "bar" ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} tickFormatter={money} width={52} />
            <ReferenceLine y={0} stroke={t.zeroLine} />
            <Tooltip contentStyle={tooltip} formatter={(v, name) => [fmt(v), name]} labelStyle={labelStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
            {visibleStats.map((p) => (
              <Bar key={p.id} dataKey={p.name} fill={p.color} radius={[3, 3, 0, 0]} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} />
            <YAxis {...axis} tickFormatter={money} width={52} />
            <ReferenceLine y={0} stroke={t.zeroLine} />
            <Tooltip contentStyle={tooltip} formatter={(v, name) => [fmt(v), name]} labelStyle={labelStyle} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
            {visibleStats.map((p) => (
              <Line key={p.id} type="monotone" dataKey={p.name} stroke={p.color}
                strokeWidth={2} dot={{ fill: p.color, r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default LeaderboardCharts;
