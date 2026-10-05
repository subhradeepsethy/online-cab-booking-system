import { useState } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout.jsx';
import BarChart from '../../components/BarChart.jsx';
import Icon from '../../components/Icon.jsx';
import { Alert, Card, Spinner } from '../../components/ui.jsx';
import { formatCurrency, formatDateTime, statusLabels, statusTone, toDailyChartData } from '../../lib/format.js';
import { useApi } from '../../lib/session.js';
import { usePolling } from '../../lib/usePolling.js';
import { useRealtime } from '../../lib/useRealtime.js';

function Kpi({ label, value, detail, icon, to }) {
  const body = (
    <Card className={`h-full p-5 ${to ? 'transition hover:shadow-panel' : ''}`}>
      <div className="flex items-center justify-between text-sm text-muted">
        {label}
        <Icon name={icon} className="h-4 w-4" />
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight">{value}</p>
      {detail ? <p className="mt-1 text-sm text-muted">{detail}</p> : null}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

const chartMetrics = {
  revenue: { label: 'Revenue', format: formatCurrency, tick: (value) => `₹${value >= 1000 ? `${value / 1000}K` : value}` },
  trips: { label: 'Completed trips', format: (value) => `${value} trip${value === 1 ? '' : 's'}`, tick: String },
};

function AdminOverviewPage() {
  const api = useApi('admin');
  const [overview, setOverview] = useState(null);
  const [liveRides, setLiveRides] = useState([]);
  const [pendingDrivers, setPendingDrivers] = useState([]);
  const [metric, setMetric] = useState('revenue');
  const [error, setError] = useState('');

  const isLive = useRealtime('admin', { 'admin:changed': () => refresh() });

  const refresh = usePolling(async () => {
    try {
      const [overviewResult, ridesResult, driversResult] = await Promise.all([
        api('/admin/overview'),
        api('/admin/rides?status=active'),
        api('/admin/users?role=driver&filter=pending'),
      ]);
      setOverview(overviewResult);
      setLiveRides(ridesResult.rides);
      setPendingDrivers(driversResult.users);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, isLive ? 60000 : 10000);

  if (!overview) {
    return (
      <AdminLayout title="Overview" isLive={isLive}>
        {error ? <Alert>{error}</Alert> : <div className="flex justify-center py-20 text-muted"><Spinner className="h-6 w-6" /></div>}
      </AdminLayout>
    );
  }

  const { counts, revenue, daily } = overview;
  const chart = chartMetrics[metric];
  const weekTotal = daily.reduce((sum, day) => sum + day[metric], 0);

  return (
    <AdminLayout title="Overview" description="Live operations across riders, drivers and trips." isLive={isLive}>
      {error ? <div className="mb-4"><Alert>{error}</Alert></div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue today" value={formatCurrency(revenue.today)} detail={`${formatCurrency(revenue.total)} all time`} icon="wallet" />
        <Kpi label="Active rides" value={counts.activeRides} detail={`${counts.searchingRides} searching · ${counts.scheduledRides} scheduled`} icon="route" to="/admin/rides" />
        <Kpi label="Drivers online" value={counts.driversOnline} detail={`of ${counts.drivers} registered`} icon="car" to="/admin/drivers" />
        <Kpi label="Pending approvals" value={counts.pendingApprovals} detail={`${counts.riders} riders registered`} icon="shield" to="/admin/drivers?filter=pending" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{chart.label}, last 7 days</h2>
              <p className="text-2xl font-bold tracking-tight">{chart.format(weekTotal)}</p>
            </div>
            <div className="flex rounded-lg bg-canvas p-1 text-sm font-medium" role="radiogroup" aria-label="Chart metric">
              {Object.keys(chartMetrics).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={metric === key}
                  onClick={() => setMetric(key)}
                  className={`rounded-md px-3 py-1.5 transition ${metric === key ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}
                >
                  {key === 'revenue' ? 'Revenue' : 'Trips'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <BarChart data={toDailyChartData(daily, metric)} valueLabel={chart.label} formatValue={chart.format} formatTick={chart.tick} height={220} />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
            <div><p className="text-muted">Completed</p><p className="font-semibold">{counts.completedRides}</p></div>
            <div><p className="text-muted">Promo discounts</p><p className="font-semibold">{formatCurrency(revenue.discounts)}</p></div>
            <div><p className="text-muted">Driver payouts</p><p className="font-semibold">{formatCurrency(revenue.driverPayouts)}</p></div>
          </div>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-bold">Live rides</h2>
              <Link to="/admin/rides" className="text-sm font-medium text-muted hover:text-ink">View all</Link>
            </div>
            {liveRides.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No rides in progress right now.</p>
            ) : (
              <ul className="divide-y divide-line">
                {liveRides.slice(0, 6).map((ride) => (
                  <li key={ride.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{ride.customer.name} → {ride.dropoff.address}</p>
                      <p className="text-xs text-muted">{ride.driver ? ride.driver.name : 'No driver yet'} · {formatDateTime(ride.requestedAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[ride.status]}`}>{statusLabels[ride.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="font-bold">Drivers awaiting approval</h2>
              <Link to="/admin/drivers?filter=pending" className="text-sm font-medium text-muted hover:text-ink">Review</Link>
            </div>
            {pendingDrivers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">All caught up.</p>
            ) : (
              <ul className="divide-y divide-line">
                {pendingDrivers.slice(0, 5).map((driver) => {
                  const uploaded = Object.values(driver.driver.documents).filter((document) => document.uploaded).length;
                  return (
                    <li key={driver.id}>
                      <Link to={`/admin/drivers?filter=pending&user=${driver.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{driver.name}</p>
                          <p className="text-xs text-muted">{driver.driver.vehicleModel} · {driver.driver.vehicleType.toUpperCase()}</p>
                        </div>
                        <span className="shrink-0 text-xs text-muted">{uploaded}/3 docs</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminOverviewPage;
