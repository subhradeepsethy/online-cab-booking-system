import { useEffect, useRef, useState } from 'react';
import AdminLayout from '../../components/AdminLayout.jsx';
import { Alert, Button, Card, Spinner } from '../../components/ui.jsx';
import { formatCurrency, formatDateTime, paymentLabels, statusLabels, statusTone } from '../../lib/format.js';
import { useApi } from '../../lib/session.js';
import { inputClasses } from '../../lib/ui.js';
import { usePolling } from '../../lib/usePolling.js';
import { useRealtime } from '../../lib/useRealtime.js';

const statusFilters = [
  { id: 'active', label: 'Active' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
];

const cancellable = ['scheduled', 'requested', 'accepted', 'arrived', 'in_progress'];

function CancelAction({ ride, onCancel }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  if (!cancellable.includes(ride.status)) return null;
  if (!isConfirming) {
    return <Button variant="ghost" size="sm" onClick={() => setIsConfirming(true)}>Cancel</Button>;
  }

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setIsConfirming(false)}>Keep</Button>
      <Button
        variant="danger"
        size="sm"
        disabled={isBusy}
        onClick={async () => {
          setIsBusy(true);
          await onCancel(ride.id);
          setIsBusy(false);
          setIsConfirming(false);
        }}
      >
        {isBusy ? <Spinner /> : 'Confirm'}
      </Button>
    </div>
  );
}

function AdminRidesPage() {
  const api = useApi('admin');
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [rides, setRides] = useState(null);
  const [notice, setNotice] = useState(null);

  const isLive = useRealtime('admin', { 'admin:changed': () => refresh() });

  const refresh = usePolling(async () => {
    try {
      const params = new URLSearchParams({ status, q: query.trim() });
      const result = await api(`/admin/rides?${params}`);
      setRides(result.rides);
    } catch (loadError) {
      setNotice({ tone: 'error', text: loadError.message });
    }
  }, isLive ? 60000 : 10000);

  // Refetch when the status filter changes (the initial load is handled by usePolling).
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    refresh();
  }, [status, refresh]);

  const changeFilter = (next) => {
    setStatus(next);
    setRides(null);
  };

  const cancelRide = async (rideId) => {
    try {
      await api(`/admin/rides/${rideId}/cancel`, { method: 'POST', body: { reason: 'Cancelled by Cab System support.' } });
      setNotice({ tone: 'success', text: 'Ride cancelled. The rider and driver were notified.' });
      refresh();
    } catch (cancelError) {
      setNotice({ tone: 'error', text: cancelError.message });
    }
  };

  return (
    <AdminLayout title="Rides" description="Monitor every trip and step in when something goes wrong." isLive={isLive}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-line">
          {statusFilters.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => changeFilter(option.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${status === option.id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form
          className="min-w-56 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            refresh();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rider, driver, vehicle or address and press Enter"
            aria-label="Search rides"
            className={`${inputClasses} h-10`}
          />
        </form>
      </div>

      {notice ? <div className="mb-4"><Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert></div> : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-215 text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Requested</th>
                <th className="px-4 py-3 font-medium">Rider</th>
                <th className="px-4 py-3 font-medium">Driver</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 text-right font-medium">Fare</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rides === null ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted"><Spinner className="h-5 w-5" /></td></tr>
              ) : null}
              {rides?.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted">No rides match these filters.</td></tr>
              ) : null}
              {rides?.map((ride) => (
                <tr key={ride.id} className="align-top hover:bg-canvas/60">
                  <td className="whitespace-nowrap px-4 py-3">
                    <p>{formatDateTime(ride.requestedAt)}</p>
                    {ride.scheduledFor ? <p className="text-xs text-[#5b3cc4]">For {formatDateTime(ride.scheduledFor)}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{ride.customer.name}</p>
                    <p className="text-xs text-muted">+91 {ride.customer.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    {ride.driver ? (
                      <>
                        <p className="font-medium">{ride.driver.name}</p>
                        <p className="text-xs text-muted">{ride.driver.vehicleNumber}</p>
                      </>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td className="max-w-72 px-4 py-3">
                    <p className="truncate" title={ride.pickup.address}>{ride.pickup.address}</p>
                    <p className="truncate text-muted" title={ride.dropoff.address}>→ {ride.dropoff.address}</p>
                    <p className="text-xs text-muted">{ride.rideTypeLabel} · {ride.distanceKm} km · {paymentLabels[ride.paymentMethod]}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    <p className="font-semibold">{formatCurrency(ride.fare)}</p>
                    {ride.discount > 0 ? <p className="text-xs text-brand">{ride.promoCode} −{formatCurrency(ride.discount)}</p> : null}
                    {ride.cancellationFee > 0 ? <p className="text-xs text-muted">Fee {formatCurrency(ride.cancellationFee)}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[ride.status]}`}>{statusLabels[ride.status]}</span>
                    {ride.status === 'cancelled' && ride.cancelledBy ? <p className="mt-1 text-xs text-muted">by {ride.cancelledBy === 'customer' ? 'rider' : ride.cancelledBy}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CancelAction ride={ride} onCancel={cancelRide} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AdminLayout>
  );
}

export default AdminRidesPage;
