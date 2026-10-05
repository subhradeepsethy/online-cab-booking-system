import { buttonClasses, initials } from '../lib/ui.js';
import Icon from './Icon.jsx';

export function Button({ variant, size, block, className = '', type = 'button', ...props }) {
  return <button type={type} className={`${buttonClasses({ variant, size, block })} ${className}`} {...props} />;
}

export function Card({ className = '', ...props }) {
  return <div className={`rounded-2xl border border-line bg-white ${className}`} {...props} />;
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden="true" />;
}

export function Alert({ tone = 'error', children, onDismiss }) {
  const tones = {
    error: 'border-[#f5c2c2] bg-danger-soft text-danger',
    warning: 'border-[#f3dfa6] bg-warning-soft text-warning',
    success: 'border-[#bfe3cf] bg-brand-soft text-[#0b6b3c]',
  };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm ${tones[tone]}`}>
      <p className="flex-1">{children}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
          <Icon name="close" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function Avatar({ name, className = 'h-10 w-10 text-sm' }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white ${className}`}>
      {initials(name)}
    </span>
  );
}

export function Rating({ value }) {
  if (!value) return <span className="text-muted">New</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon name="star" filled className="h-3.5 w-3.5 text-[#f5a524]" />
      {value.toFixed(1)}
    </span>
  );
}

// Pickup/drop-off pair joined by a dotted line, as in most ride-hailing apps.
export function TripStops({ pickup, dropoff, compact = false }) {
  const text = compact ? 'text-sm' : 'text-[15px]';
  return (
    <div className="grid grid-cols-[16px_1fr] gap-x-3">
      <div className="flex flex-col items-center pt-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-brand-soft" />
        <span className="my-1 w-px flex-1 border-l border-dashed border-subtle" />
        <span className="h-2.5 w-2.5 bg-ink" />
      </div>
      <div className="grid gap-4">
        <div>
          <p className="text-xs font-medium text-muted">Pickup</p>
          <p className={`${text} leading-snug text-ink`}>{pickup.address}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted">Drop-off</p>
          <p className={`${text} leading-snug text-ink`}>{dropoff.address}</p>
        </div>
      </div>
    </div>
  );
}

export function Logo({ inverted = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${inverted ? 'bg-white text-ink' : 'bg-ink text-accent'}`}>
        <Icon name="navigation" filled className="h-4 w-4" strokeWidth={1.5} />
      </span>
      <span className={`text-[17px] font-bold tracking-tight ${inverted ? 'text-white' : 'text-ink'}`}>Cab System</span>
    </span>
  );
}
