import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import MapLayout from '../components/MapLayout.jsx';
import RideMap from '../components/RideMap.jsx';
import { Alert, Avatar, Button, Rating, Spinner, TripStops } from '../components/ui.jsx';
import VerificationBadge from '../components/VerificationBadge.jsx';
import { formatCurrency, formatScheduleTime, googleMapsDirectionsUrl, paymentLabels, statusLabels } from '../lib/format.js';
import { describeLocationError, locationUnavailableReason } from '../lib/geolocation.js';
import { driverLinks, driverRoleLabel } from '../lib/navigation.js';
import { useApi, useSession } from '../lib/session.js';
import { buttonClasses, paymentIcon, vehicleIcon } from '../lib/ui.js';
import { usePolling } from '../lib/usePolling.js';
import { useRealtime } from '../lib/useRealtime.js';

const locationPingMs = 5000;

function VerificationPanel({ user }) {
  const { approvalStatus, approvalNote, documents } = user.driver;
  const uploaded = Object.values(documents).filter((document) => document.uploaded).length;
  const total = Object.keys(documents).length;

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Account verification</h2>
        <VerificationBadge status={approvalStatus} />
      </div>
      {approvalStatus === 'rejected' ? (
        <Alert tone="error">Your documents were not approved: {approvalNote}</Alert>
      ) : (
        <p className="text-sm text-muted">
          {uploaded < total
            ? 'Upload your documents so our team can verify your account. You can go online once you are approved.'
            : 'Thanks! Your documents are being reviewed. This page updates automatically when you are approved.'}
        </p>
      )}
      <div>
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">Documents uploaded</span>
          <span className="text-muted">{uploaded} of {total}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(uploaded / total) * 100}%` }} />
        </div>
      </div>
      <ul className="grid gap-2 text-sm">
        {Object.entries(documents).map(([type, document]) => (
          <li key={type} className="flex items-center gap-2">
            <Icon name={document.uploaded ? 'check' : 'clock'} className={`h-4 w-4 ${document.uploaded ? 'text-brand' : 'text-subtle'}`} />
            {document.label}
          </li>
        ))}
      </ul>
      <Link to="/driver/documents" className={buttonClasses({ size: 'lg', block: true })}>
        {uploaded < total || approvalStatus === 'rejected' ? 'Upload documents' : 'View documents'}
      </Link>
    </div>
  );
}

function CompletedTrip({ ride, onRate, onDone }) {
  const [rating, setRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setIsSaving(true);
    setError('');
    try {
      await onRate(rating);
    } catch (rateError) {
      setError(rateError.message);
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-5 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
      </span>
      <div>
        <h2 className="text-xl font-bold">Trip completed</h2>
        <p className="mt-1 text-4xl font-bold tracking-tight">{formatCurrency(ride.driverEarnings)}</p>
        <p className="mt-1 text-sm text-muted">
          {ride.paymentMethod === 'cash' ? `Collect ${formatCurrency(ride.fare)} in cash from the rider` : `Paid via ${paymentLabels[ride.paymentMethod]}`}
          {ride.discount > 0 ? ` · promo ${formatCurrency(ride.discount)} covered by Cab System` : ''}
        </p>
      </div>
      {ride.riderRating ? (
        <Alert tone="success">You rated {ride.customer.name} {ride.riderRating} stars.</Alert>
      ) : (
        <div className="rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">How was {ride.customer.name} as a rider?</p>
          <div className="mt-3 flex justify-center gap-1" role="radiogroup" aria-label="Rider rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
                onClick={() => setRating(value)}
                className={`rounded-md p-1 transition ${value <= rating ? 'text-[#f5a524]' : 'text-line hover:text-[#f5a524]'}`}
              >
                <Icon name="star" filled className="h-8 w-8" strokeWidth={1} />
              </button>
            ))}
          </div>
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          <Button block className="mt-4" disabled={!rating || isSaving} onClick={submit}>
            {isSaving ? <Spinner /> : null}
            Rate rider
          </Button>
        </div>
      )}
      <Button variant="secondary" size="lg" block onClick={onDone}>Back to requests</Button>
    </div>
  );
}

function OnlineToggle({ isOnline, onToggle, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOnline}
      aria-label={isOnline ? 'Go offline' : 'Go online'}
      disabled={disabled}
      onClick={onToggle}
      className="flex items-center gap-2.5 rounded-full border border-line py-1 pl-3 pr-1 text-sm font-medium transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="hidden sm:inline">{isOnline ? 'Online' : 'Offline'}</span>
      <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${isOnline ? 'bg-brand' : 'bg-line'}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${isOnline ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

function EarningsStrip({ summary }) {
  const items = [
    { label: 'Today', value: formatCurrency(summary?.todayEarnings) },
    { label: 'Trips', value: summary?.todayTrips ?? 0 },
    { label: 'Rating', value: summary?.rating ? summary.rating.toFixed(1) : 'New' },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-line rounded-xl bg-canvas py-3 text-center">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-lg font-bold">{item.value}</p>
          <p className="text-xs text-muted">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function ActiveTrip({ ride, onAction, busyAction }) {
  const [otp, setOtp] = useState('');
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const isBeforePickup = ['accepted', 'arrived'].includes(ride.status);
  const headline = {
    accepted: 'Head to pickup',
    arrived: 'Waiting for rider',
    in_progress: 'Drive to destination',
  }[ride.status];

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand">{statusLabels[ride.status]}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{headline}</h2>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">{formatCurrency(ride.subtotal)}</p>
          <p className="flex items-center justify-end gap-1 text-xs text-muted">
            <Icon name={paymentIcon[ride.paymentMethod]} className="h-3.5 w-3.5" />
            {ride.paymentMethod === 'cash' ? `Collect ${formatCurrency(ride.fare)}` : paymentLabels[ride.paymentMethod]}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-4">
        <div className="flex items-center gap-3">
          <Avatar name={ride.customer.name} className="h-11 w-11" />
          <div>
            <p className="font-semibold">{ride.customer.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted"><Rating value={ride.customer.rating} /> · {ride.distanceKm} km</p>
          </div>
        </div>
        <a
          href={`tel:+91${ride.customer.phone}`}
          aria-label={`Call ${ride.customer.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition hover:bg-line"
        >
          <Icon name="phone" className="h-4.5 w-4.5" />
        </a>
      </div>

      <TripStops pickup={ride.pickup} dropoff={ride.dropoff} compact />

      <a
        href={googleMapsDirectionsUrl(isBeforePickup ? ride.pickup : ride.dropoff)}
        target="_blank"
        rel="noreferrer"
        className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}
      >
        <Icon name="navigation" className="h-4 w-4" />
        Navigate to {isBeforePickup ? 'pickup' : 'drop-off'}
      </a>

      {ride.status === 'accepted' ? (
        <Button size="lg" block disabled={Boolean(busyAction)} onClick={() => onAction('arrive')}>
          {busyAction === 'arrive' ? <Spinner /> : null}
          I&apos;ve arrived
        </Button>
      ) : null}

      {isBeforePickup ? (
        <form
          className="grid gap-3 border-t border-line pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            onAction('start', { otp });
          }}
        >
          <label htmlFor="ride-otp" className="text-sm font-semibold">Enter the rider&apos;s 4-digit OTP</label>
          <input
            id="ride-otp"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="0000"
            className="h-14 rounded-lg border border-line text-center font-mono text-2xl font-bold tracking-[0.6em] outline-none placeholder:text-line focus:border-ink focus:ring-4 focus:ring-ink/5"
          />
          <Button type="submit" variant="brand" size="lg" block disabled={otp.length !== 4 || Boolean(busyAction)}>
            {busyAction === 'start' ? <Spinner /> : null}
            Start trip
          </Button>
        </form>
      ) : null}

      {ride.status === 'in_progress' ? (
        <Button variant="brand" size="lg" block disabled={Boolean(busyAction)} onClick={() => onAction('complete')}>
          {busyAction === 'complete' ? <Spinner /> : null}
          Complete trip
        </Button>
      ) : null}

      {isBeforePickup ? (
        isConfirmingCancel ? (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-medium">Cancel this trip? It will be offered to other drivers.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setIsConfirmingCancel(false)}>Keep trip</Button>
              <Button variant="danger" disabled={Boolean(busyAction)} onClick={() => onAction('cancel')}>Cancel trip</Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setIsConfirmingCancel(true)} className="text-sm font-medium text-muted hover:text-danger">
            Cancel trip
          </button>
        )
      ) : null}
    </div>
  );
}

function RequestCard({ request, onAccept, onDecline, busyAction }) {
  return (
    <div className="rounded-xl border border-line p-4 transition hover:shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-bold">{formatCurrency(request.driverEarnings)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <Icon name={paymentIcon[request.paymentMethod]} className="h-3.5 w-3.5" />
            {paymentLabels[request.paymentMethod]} · {request.distanceKm} km trip · {request.customer.name}
            <Rating value={request.customer.rating} />
          </p>
          {request.scheduledFor ? (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-[#5b3cc4]">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Scheduled pickup {formatScheduleTime(request.scheduledFor)}
            </p>
          ) : null}
        </div>
        {request.pickupDistanceKm != null ? (
          <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-medium">{request.pickupDistanceKm} km away</span>
        ) : null}
      </div>
      <div className="mt-4"><TripStops pickup={request.pickup} dropoff={request.dropoff} compact /></div>
      <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
        <Button variant="secondary" disabled={Boolean(busyAction)} onClick={() => onDecline(request.id)}>Decline</Button>
        <Button disabled={Boolean(busyAction)} onClick={() => onAccept(request.id)}>
          {busyAction === `accept:${request.id}` ? <Spinner /> : null}
          Accept
        </Button>
      </div>
    </div>
  );
}

function DriverDashboardPage() {
  const { user, signOut, updateUser } = useSession('driver');
  const api = useApi('driver');
  const isOnline = Boolean(user?.driver?.isOnline);
  const [summary, setSummary] = useState(null);
  const [requests, setRequests] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  // Bumped by "Try again" to restart the location watch (and re-show the permission prompt).
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [completedRide, setCompletedRide] = useState(null);
  const trackedRideIdRef = useRef(null);
  const lastPingRef = useRef(0);
  const isApproved = user.driver.approvalStatus === 'approved';

  const refreshSummary = async () => {
    const result = await api('/driver/summary').catch(() => null);
    if (result) setSummary(result.summary);
  };

  const refreshProfile = () => api('/auth/me').then((result) => updateUser(result.user)).catch(() => {});

  const isLive = useRealtime('driver', {
    'ride:changed': () => refresh(),
    'requests:changed': () => refresh(),
    'account:changed': refreshProfile,
  });

  usePolling(refreshSummary, 30000);

  // Sockets push changes instantly; polling stays on as a slower safety net.
  const refresh = usePolling(async () => {
    try {
      const { ride } = await api('/rides/active');
      if (ride) {
        trackedRideIdRef.current = ride.id;
        setActiveRide(ride);
        setRequests([]);
      } else {
        setActiveRide(null);
        const endedId = trackedRideIdRef.current;
        trackedRideIdRef.current = null;
        if (endedId) {
          const ended = await api(`/rides/${endedId}`).catch(() => null);
          if (ended?.ride.status === 'cancelled') setNotice({ tone: 'warning', text: 'The rider cancelled the trip.' });
        }
        const result = isOnline ? await api('/driver/requests') : { requests: [] };
        setRequests(result.requests);
      }
    } catch (pollError) {
      setNotice({ tone: 'error', text: pollError.message });
    } finally {
      setHasLoaded(true);
    }
  }, isLive ? 15000 : 4000);

  // Share live GPS position while online so riders can see the car approach.
  useEffect(() => {
    if (!isOnline) return undefined;
    const unavailable = locationUnavailableReason();
    if (unavailable) {
      setLocationError(unavailable);
      return undefined;
    }

    // Starting the watch is what makes the browser show its location permission prompt.
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        setLocation(point);
        setLocationError('');
        if (Date.now() - lastPingRef.current >= locationPingMs) {
          lastPingRef.current = Date.now();
          api('/driver/location', { method: 'PUT', body: point }).catch(() => {});
        }
      },
      (error) => setLocationError(`${describeLocationError(error)} Riders can't see where you are until it's fixed.`),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [isOnline, api, locationAttempt]);

  const runAction = async (key, task) => {
    setBusyAction(key);
    setNotice(null);
    try {
      await task();
    } catch (actionError) {
      setNotice({ tone: 'error', text: actionError.message });
    } finally {
      setBusyAction('');
    }
  };

  const toggleOnline = () => runAction('toggle', async () => {
    const result = await api('/driver/availability', { method: 'PATCH', body: { isOnline: !isOnline } });
    updateUser(result.user);
    if (!result.user.driver.isOnline) setRequests([]);
  });

  const acceptRequest = (id) => runAction(`accept:${id}`, async () => {
    try {
      const { ride } = await api(`/driver/rides/${id}/accept`, { method: 'POST' });
      trackedRideIdRef.current = ride.id;
      setActiveRide(ride);
      setRequests([]);
    } catch (error) {
      setRequests((current) => current.filter((request) => request.id !== id));
      throw error;
    }
  });

  const declineRequest = (id) => runAction(`decline:${id}`, async () => {
    await api(`/driver/rides/${id}/decline`, { method: 'POST' });
    setRequests((current) => current.filter((request) => request.id !== id));
  });

  const tripAction = (action, body) => runAction(action, async () => {
    if (action === 'cancel') {
      await api(`/rides/${activeRide.id}/cancel`, { method: 'POST' });
      trackedRideIdRef.current = null;
      setActiveRide(null);
      setNotice({ tone: 'success', text: 'Trip cancelled and offered to other drivers.' });
      return;
    }

    const { ride } = await api(`/driver/rides/${activeRide.id}/${action}`, { method: 'POST', body });
    if (ride.status === 'completed') {
      trackedRideIdRef.current = null;
      setActiveRide(null);
      setCompletedRide(ride);
      refreshSummary();
    } else {
      setActiveRide(ride);
    }
  });

  const rateRider = async (rating) => {
    const { ride } = await api(`/driver/rides/${completedRide.id}/rate`, { method: 'POST', body: { rating } });
    setCompletedRide(ride);
  };

  let panel;
  if (!hasLoaded) {
    panel = <div className="flex justify-center py-12 text-muted"><Spinner className="h-6 w-6" /></div>;
  } else if (activeRide) {
    panel = <ActiveTrip key={activeRide.id} ride={activeRide} onAction={tripAction} busyAction={busyAction} />;
  } else if (completedRide) {
    panel = <CompletedTrip ride={completedRide} onRate={rateRider} onDone={() => setCompletedRide(null)} />;
  } else if (!isApproved) {
    panel = <VerificationPanel user={user} />;
  } else if (!isOnline) {
    panel = (
      <div className="grid gap-5">
        <EarningsStrip summary={summary} />
        <div className="py-4 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-canvas text-muted">
            <Icon name="power" className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-xl font-bold">You&apos;re offline</h2>
          <p className="mt-1 text-sm text-muted">Go online to start receiving {user.driver.vehicleType.toUpperCase()} trip requests.</p>
        </div>
        <Button variant="brand" size="lg" block onClick={toggleOnline} disabled={Boolean(busyAction)}>
          {busyAction === 'toggle' ? <Spinner /> : null}
          Go online
        </Button>
      </div>
    );
  } else {
    panel = (
      <div className="grid gap-5">
        <EarningsStrip summary={summary} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Trip requests</h2>
          {isLive ? (
            <span className="flex items-center gap-2 text-xs font-medium text-brand">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              Live
            </span>
          ) : (
            <span className="text-xs font-medium text-muted">Reconnecting...</span>
          )}
        </div>
        {requests.length === 0 ? (
          <div className="rounded-xl bg-canvas px-4 py-10 text-center">
            <Icon name="clock" className="mx-auto h-6 w-6 text-muted" />
            <p className="mt-3 text-sm font-medium">Waiting for trip requests</p>
            <p className="mt-1 text-xs text-muted">New requests near you will appear here automatically.</p>
          </div>
        ) : requests.map((request) => (
          <RequestCard key={request.id} request={request} onAccept={acceptRequest} onDecline={declineRequest} busyAction={busyAction} />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader links={driverLinks} user={user} onSignOut={signOut} roleLabel={driverRoleLabel(user)}>
        <OnlineToggle isOnline={isOnline} onToggle={toggleOnline} disabled={!isApproved || Boolean(busyAction) || Boolean(activeRide)} />
      </AppHeader>

      <MapLayout
        map={(
          <RideMap
            pickup={activeRide?.pickup}
            dropoff={activeRide?.dropoff}
            driverLocation={isOnline ? location : null}
            className="h-full"
          />
        )}
      >
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas">
            <Icon name={vehicleIcon[user.driver.vehicleType]} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Hello, {user.name.split(' ')[0]}</p>
            <p className="truncate text-sm text-muted">{user.driver.vehicleModel}</p>
          </div>
        </div>
        {notice ? <div className="mb-4"><Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert></div> : null}
        {isOnline && locationError ? (
          <div className="mb-4 grid gap-2">
            <Alert tone="warning">{locationError}</Alert>
            {window.isSecureContext ? (
              <Button
                variant="secondary"
                size="sm"
                className="w-fit"
                onClick={() => {
                  setLocationError('');
                  setLocationAttempt((attempt) => attempt + 1);
                }}
              >
                <Icon name="locate" className="h-4 w-4" />
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
        {panel}
      </MapLayout>
    </div>
  );
}

export default DriverDashboardPage;
