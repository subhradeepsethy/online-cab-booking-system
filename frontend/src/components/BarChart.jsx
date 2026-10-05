import { useState } from 'react';

// Rounds the axis maximum up to a clean value (1, 2, 2.5 or 5 x 10^n per tick).
function niceScale(maxValue, tickCount = 4) {
  if (maxValue <= 0) return { max: tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, index) => index) };
  const rawStep = maxValue / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rawStep);
  return { max: step * tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, index) => index * step) };
}

const compact = (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(value));

// Single-series column chart. The last bar (the current period) is highlighted and labelled;
// every value is available on hover/focus and in the table view.
function BarChart({ data, valueLabel, formatValue = String, formatTick = compact, height = 200 }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const { max, ticks } = niceScale(Math.max(...data.map((point) => point.value), 0));
  const lastIndex = data.length - 1;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowTable((current) => !current)}
          className="text-xs font-medium text-muted hover:text-ink"
        >
          {showTable ? 'Show chart' : 'View as table'}
        </button>
      </div>

      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 font-medium">Day</th>
              <th className="py-2 text-right font-medium">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.key} className="border-b border-line last:border-0">
                <td className="py-2">{point.fullLabel ?? point.label}</td>
                <td className="py-2 text-right tabular-nums">{formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-3">
          <div className="relative w-10 shrink-0 text-right text-[11px] tabular-nums text-subtle" style={{ height }} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} className="absolute right-0" style={{ bottom: `${(tick / max) * 100}%`, transform: 'translateY(50%)' }}>
                {formatTick(tick)}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height }} role="list" aria-label={`${valueLabel} by day`}>
              {ticks.map((tick) => (
                <div key={tick} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(tick / max) * 100}%` }} aria-hidden="true" />
              ))}

              <div className="absolute inset-0 flex">
                {data.map((point, index) => {
                  const percent = max > 0 ? (point.value / max) * 100 : 0;
                  const isActive = activeIndex === index;
                  const isLatest = index === lastIndex;
                  return (
                    <div
                      key={point.key}
                      role="listitem"
                      tabIndex={0}
                      aria-label={`${point.fullLabel ?? point.label}: ${formatValue(point.value)}`}
                      onPointerEnter={() => setActiveIndex(index)}
                      onPointerLeave={() => setActiveIndex(null)}
                      onFocus={() => setActiveIndex(index)}
                      onBlur={() => setActiveIndex(null)}
                      className="relative flex flex-1 cursor-default items-end justify-center outline-none"
                    >
                      {isActive ? <div className="absolute inset-x-1 inset-y-0 rounded-md bg-ink/[0.04]" aria-hidden="true" /> : null}
                      <div
                        className={`relative w-full max-w-6 rounded-t-[4px] transition-opacity ${isLatest ? 'bg-brand' : 'bg-chart'} ${isActive ? 'opacity-80' : ''}`}
                        style={{ height: `${percent}%`, minHeight: point.value > 0 ? 2 : 0, marginInline: 2 }}
                      />
                      {isLatest && !isActive && point.value > 0 ? (
                        <span
                          className="pointer-events-none absolute whitespace-nowrap text-xs font-semibold text-ink"
                          style={{ bottom: `calc(${percent}% + 6px)` }}
                        >
                          {formatValue(point.value)}
                        </span>
                      ) : null}
                      {isActive ? (
                        <div
                          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-white shadow-panel"
                          style={{ bottom: `calc(${Math.min(percent, 80)}% + 10px)` }}
                          role="tooltip"
                        >
                          <p className="text-sm font-semibold">{formatValue(point.value)}</p>
                          <p className="text-[11px] text-[#a1a1aa]">{point.fullLabel ?? point.label}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex text-center text-[11px] text-muted" aria-hidden="true">
              {data.map((point, index) => (
                <span key={point.key} className={`flex-1 ${index === lastIndex ? 'font-semibold text-ink' : ''}`}>{point.label}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BarChart;
