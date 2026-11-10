import { shortDate } from './format.ts';

interface Series {
  name: string;
  color: string;
  values: number[];
}

export function TrendChart({
  labels,
  series,
  height = 220,
  emptyLabel = 'لا توجد بيانات ضمن هذه الفترة.',
}: {
  labels: string[];
  series: Series[];
  height?: number;
  emptyLabel?: string;
}) {
  const width = 760;
  const padX = 26;
  const padTop = 18;
  const padBottom = 34;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const innerHeight = height - padTop - padBottom;
  const stepX = labels.length > 1 ? (width - padX * 2) / (labels.length - 1) : 0;
  const point = (value: number, index: number) => ({
    x: padX + index * stepX,
    y: padTop + innerHeight - (value / max) * innerHeight,
  });
  const visibleLabels = labels.map((label, index) => ({ label, index })).filter((item) => {
    if (labels.length <= 8) return true;
    return item.index % Math.ceil(labels.length / 7) === 0 || item.index === labels.length - 1;
  });

  if (labels.length === 0 || series.every((item) => item.values.every((value) => value === 0))) {
    return <div className="dev-chart-empty">{emptyLabel}</div>;
  }

  return (
    <div className="dev-chart">
      <div className="dev-chart-legend">
        {series.map((item) => (
          <span key={item.name}>
            <i style={{ background: item.color }} />
            {item.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="رسم بياني زمني">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padTop + innerHeight - innerHeight * ratio;
          return <line key={ratio} x1={padX} x2={width - padX} y1={y} y2={y} className="dev-chart-grid" />;
        })}
        {series.map((item) => {
          const points = item.values.map((value, index) => point(value, index));
          const path = points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
          return (
            <g key={item.name}>
              <path d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, index) => (
                <circle key={index} cx={p.x} cy={p.y} r="3" fill="var(--surface)" stroke={item.color} strokeWidth="2">
                  <title>{`${item.name} · ${labels[index]} · ${item.values[index]}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {visibleLabels.map((item) => (
          <text key={item.index} x={padX + item.index * stepX} y={height - 10} textAnchor="middle" className="dev-chart-label">
            {shortDate(item.label)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function UsageBars({
  items,
  emptyLabel = 'لا توجد استخدامات مسجلة بعد.',
}: {
  items: Array<{ label: string; value: number; share: number; tone?: string }>;
  emptyLabel?: string;
}) {
  if (items.length === 0 || items.every((item) => item.value === 0)) {
    return <div className="dev-chart-empty">{emptyLabel}</div>;
  }
  return (
    <div className="dev-bars">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="dev-bar-row">
          <span className="dev-bar-label">{item.label}</span>
          <span className="dev-bar-track">
            <i style={{ width: `${Math.max(item.share, item.value > 0 ? 2 : 0)}%`, background: item.tone }} />
          </span>
          <span className="dev-bar-value">
            {item.value}
            <small>{item.share}%</small>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="dev-donut-wrap">
      <svg viewBox="0 0 110 110" className="dev-donut" role="img" aria-label={centerLabel}>
        <circle cx="55" cy="55" r={radius} fill="none" stroke="var(--line-soft)" strokeWidth="14" />
        {total > 0 &&
          segments.map((segment) => {
            const length = (segment.value / total) * circumference;
            const element = (
              <circle
                key={segment.label}
                cx="55"
                cy="55"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth="14"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 55 55)"
              />
            );
            offset += length;
            return element;
          })}
        <text x="55" y="52" textAnchor="middle" className="dev-donut-value">
          {centerValue}
        </text>
        <text x="55" y="66" textAnchor="middle" className="dev-donut-label">
          {centerLabel}
        </text>
      </svg>
      <div className="dev-donut-legend">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} />
            {segment.label}
            <b>{segment.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
