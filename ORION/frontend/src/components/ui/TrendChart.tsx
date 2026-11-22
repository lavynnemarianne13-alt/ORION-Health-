import { useId } from 'react';
import { EmptyState } from './Surfaces';

type Point = { time: number; value: number };
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const preciseTimeLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const timeLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export default function TrendChart({ points, label, empty }: { points: Point[]; label: string; empty: string }) {
  const id = useId();
  const valid = points.filter(p => Number.isFinite(p.time) && Number.isFinite(p.value)).sort((a, b) => a.time - b.time);
  if (valid.length < 2) return <EmptyState>{empty}</EmptyState>;
  const first = valid[0].time;
  const last = valid[valid.length - 1].time;
  const values = valid.map(point => point.value);
  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const x = (time: number, i: number) => 44 + 550 * (last === first ? i / (valid.length - 1) : (time - first) / (last - first));
  const y = (value: number) => 150 - 135 * (value - min) / (max - min);
  const path = valid.map((point, i) => `${i ? 'L' : 'M'}${x(point.time, i)},${y(point.value)}`).join(' ');
  const dates = [first, first + (last - first) / 2, last];
  const span = last - first;
  const format = span < 300_000 ? preciseTimeLabel : span < 86_400_000 ? timeLabel : dateLabel;
  return <svg className="trend-chart" viewBox="0 0 620 180" role="img" aria-label={`${label}, ${valid.length} measurements, from ${values[0].toFixed(1)} to ${values.at(-1)?.toFixed(1)}`}>
    <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="var(--accent)" stopOpacity=".27"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs>
    {[0, 1, 2, 3].map(step => {
      const tick = min + step * (max - min) / 3;
      return <g key={step}><line x1="44" x2="594" y1={y(tick)} y2={y(tick)}/><text x="36" y={y(tick) + 4} textAnchor="end">{tick.toFixed(1)}</text></g>;
    })}
    <path d={`${path} L594,150 H44 Z`} fill={`url(#${id})`}/>
    <path d={path} className="trend-line" vectorEffect="non-scaling-stroke"/>
    {valid.map((point, i) => <circle key={i} cx={x(point.time, i)} cy={y(point.value)} r="3"><title>{`${new Date(point.time).toLocaleString('en-US')} · ${point.value.toFixed(1)}`}</title></circle>)}
    {(last === first ? [first] : dates).map((date, i) => <text key={i} textAnchor={last === first || i === 1 ? 'middle' : i === 0 ? 'start' : 'end'} x={last === first ? 319 : 44 + i * 275} y="173">{format.format(date)}</text>)}
  </svg>;
}
