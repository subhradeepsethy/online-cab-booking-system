export const formatCurrency = (amount) => `₹${Math.round(amount ?? 0).toLocaleString('en-IN')}`;

export const formatDateTime = (value) => (value
  ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '');

export const paymentLabels = { cash: 'Cash', upi: 'UPI', card: 'Card' };

export const statusLabels = {
  scheduled: 'Scheduled',
  requested: 'Finding driver',
  accepted: 'Driver on the way',
  arrived: 'Driver arrived',
  in_progress: 'On trip',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const statusTone = {
  scheduled: 'bg-[#f1ecfd] text-[#5b3cc4]',
  requested: 'bg-warning-soft text-warning',
  accepted: 'bg-[#e8effd] text-[#1d4ed8]',
  arrived: 'bg-[#e8effd] text-[#1d4ed8]',
  in_progress: 'bg-brand-soft text-[#0b6b3c]',
  completed: 'bg-canvas text-ink',
  cancelled: 'bg-danger-soft text-danger',
};

// Turns the API's `daily` series into BarChart points; the last day is labelled "Today".
export function toDailyChartData(daily = [], field) {
  return daily.map((day, index) => ({
    key: day.date,
    label: index === daily.length - 1 ? 'Today' : day.label,
    fullLabel: new Date(`${day.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }),
    value: day[field],
  }));
}

export const formatScheduleTime = (value) => (value
  ? new Date(value).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '');

export function googleMapsDirectionsUrl(destination, origin) {
  const toParam = (place) => (Number.isFinite(place?.lat) ? `${place.lat},${place.lng}` : place?.address ?? '');
  const params = new URLSearchParams({ api: '1', destination: toParam(destination), travelmode: 'driving' });
  if (origin) params.set('origin', toParam(origin));
  return `https://www.google.com/maps/dir/?${params}`;
}
