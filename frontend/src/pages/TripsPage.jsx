import { useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import BarChart from '../components/BarChart.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Card, Spinner } from '../components/ui.jsx';
import { formatCurrency, formatDateTime, paymentLabels, statusLabels, statusTone, toDailyChartData } from '../lib/format.js';
import { driverLinks, driverRoleLabel, riderLinks } from '../lib/navigation.js';
import { useApi, useSession } from '../lib/session.js';
import { buttonClasses, vehicleIcon } from '../lib/ui.js';
import { usePolling } from '../lib/usePolling.js';
import { useRealtime } from '../lib/useRealtime.js';

const filters = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

function StatTile({ icon, label, value }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Icon name={icon} className="h-4 w-4" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
    </Card>
  );
}

// What this person earned (driver) or paid (rider) for a ride, including late-cancel fees.
function amountFor(ride, isDriver) {
  if (isDriver) return ride.driverEarnings ?? 0;
  if (ride.status === 'completed') return ride.fare;
  return ride.cancellationFee ?? 0;
}

function TripsPage({ role }) {
  const { user, signOut } = useSession(role);
  const api = useApi(role);
  const [rides, setRides] = useState(null);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const isDriver = role === 'driver';

  const isLive = useRealtime(role, { 'ride:changed': () => refresh() });

  const refresh = usePolling(async () => {
    try {
      const [ridesResult, summaryResult] = await Promise.all([
        api('/rides'),
        isDriver ? api('/driver/summary') : Promise.resolve(null),
      ]);
      setRides(ridesResult.rides);
      if (summaryResult) setSummary(summaryResult.summary);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, isLive ? 60000 : 15000);

  const all = rides ?? [];
  const visible = all.filter((ride) => filter === 'all' || ride.status === filter);
  const completed = all.filter((ride) => ride.status === 'completed');
  const total = all.reduce((sum, ride) => sum + amountFor(ride, isDriver), 0);
  const distance = completed.reduce((sum, ride) => sum + ride.distanceKm, 0);
  const weekTotal = summary?.daily.reduce((sum, day) => sum + day.earnings, 0) ?? 0;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader
        links={isDriver ? driverLinks : riderLinks}
        user={user}
        onSignOut={signOut}
        roleLabel={isDriver ? driverRoleLabel(user) : 'Rider'}
      />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-12">
        <h1 className="text-3xl font-bold tracking-tight">{isDriver ? 'Earnings' : 'Activity'}</h1>
        <p className="mt-1 text-muted">{isDriver ? 'Your trips, payouts and weekly performance.' : 'Your past and cancelled rides.'}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <StatTile icon="wallet" label={isDriver ? 'Total earned' : 'Total spent'} value={formatCurrency(total)} />
          <StatTile icon="check" label="Completed trips" value={completed.length} />
          <StatTile icon="route" label="Distance" value={`${Math.round(distance * 10) / 10} km`} />
        </div>

        {isDriver && summary ? (
          <Card className="mt-6 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">Earnings this week</h2>
                <p className="text-sm text-muted">Last 7 days, including cancellation fees</p>
              </div>
              <p className="text-2xl font-bold tracking-tight">{formatCurrency(weekTotal)}</p>
            </div>
            <div className="mt-4">
              <BarChart
                data={toDailyChartData(summary.daily, 'earnings')}
                valueLabel="Earnings"
                formatValue={formatCurrency}
                formatTick={(value) => `₹${value >= 1000 ? `${value / 1000}K` : value}`}
              />
            </div>
          </Card>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">Trips</h2>
          <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-line">
            {filters.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${filter === option.id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <div className="mt-4"><Alert>{error}</Alert></div> : null}

        <Card className="mt-4 divide-y divide-line overflow-hidden">
          {rides === null ? <div className="flex justify-center py-12 text-muted"><Spinner className="h-6 w-6" /></div> : null}
          {rides !== null && visible.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Icon name="history" className="mx-auto h-8 w-8 text-subtle" />
              <p className="mt-3 font-medium">No trips yet</p>
              <p className="mt-1 text-sm text-muted">{isDriver ? 'Go online to start receiving trips.' : 'Your rides will show up here.'}</p>
              <Link to={isDriver ? '/driver' : '/rider'} className={`${buttonClasses({ size: 'sm' })} mt-5`}>
                {isDriver ? 'Go to dashboard' : 'Book a ride'}
              </Link>
            </div>
          ) : null}
          {visible.map((ride) => {
            const amount = amountFor(ride, isDriver);
            const isVoid = ride.status === 'cancelled' && amount === 0;
            return (
              <article key={ride.id} className="flex gap-4 p-4 sm:p-5">
                <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-canvas sm:flex">
                  <Icon name={vehicleIcon[ride.rideType]} className="h-6 w-6" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{ride.dropoff.address}</p>
                      <p className="mt-0.5 truncate text-sm text-muted">From {ride.pickup.address}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-bold ${isVoid ? 'text-subtle line-through' : ''}`}>{formatCurrency(isVoid ? ride.fare : amount)}</p>
                      {ride.status === 'cancelled' && amount > 0 ? <p className="text-xs text-muted">Cancellation fee</p> : null}
                      {ride.status === 'completed' && ride.discount > 0 ? (
                        <p className="text-xs text-brand">{isDriver ? `Rider promo ${ride.promoCode}` : `Saved ${formatCurrency(ride.discount)}`}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${statusTone[ride.status]}`}>{statusLabels[ride.status]}</span>
                    <span>{formatDateTime(ride.scheduledFor ?? ride.requestedAt)}</span>
                    <span>{ride.rideTypeLabel} · {ride.distanceKm} km · {paymentLabels[ride.paymentMethod]}</span>
                    {isDriver ? <span>{ride.customer.name}</span> : null}
                    {!isDriver && ride.driver ? <span>{ride.driver.name}</span> : null}
                    {ride.rating ? (
                      <span className="flex items-center gap-0.5" title={isDriver ? 'Rider rated you' : 'Your rating'}>
                        <Icon name="star" filled className="h-3 w-3 text-[#f5a524]" />{ride.rating}
                      </span>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </Card>
      </main>
    </div>
  );
}

export default TripsPage;
