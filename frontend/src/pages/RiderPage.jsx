import { useEffect, useRef, useState } from 'react';
import AppHeader from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import MapLayout from '../components/MapLayout.jsx';
import PlaceInput from '../components/PlaceInput.jsx';
import RideMap from '../components/RideMap.jsx';
import { Alert, Avatar, Button, Rating, Spinner, TripStops } from '../components/ui.jsx';
import { formatCurrency, formatScheduleTime, paymentLabels, statusLabels } from '../lib/format.js';
import { describeLocationError, locationUnavailableReason } from '../lib/geolocation.js';
import { getDrivingRoute, googleMapsApiKey, reverseGeocode, withCoordinates } from '../lib/googleMaps.js';
import { useApi, useSession } from '../lib/session.js';
import { takeTripDraft } from '../lib/tripDraft.js';
import { inputClasses, paymentIcon, vehicleIcon } from '../lib/ui.js';
import { usePolling } from '../lib/usePolling.js';
import { useRealtime } from '../lib/useRealtime.js';
import { riderLinks } from '../lib/navigation.js';

const placeLabels = { home: 'Home', work: 'Work' };

// <input type="datetime-local"> wants local time without a timezone suffix.
function toLocalInputValue(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CancelButton({ onConfirm, isBusy, label, fee = 0 }) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return <Button variant="secondary" size="lg" block onClick={() => setIsConfirming(true)}>{label}</Button>;
  }

  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-sm font-medium">Cancel this ride?</p>
      {fee > 0 ? (
        <p className="mt-1 text-sm text-warning">A {formatCurrency(fee)} cancellation fee will be charged because your driver is already on the way.</p>
      ) : (
        <p className="mt-1 text-sm text-muted">You won&apos;t be charged.</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setIsConfirming(false)}>Keep ride</Button>
        <Button variant="danger" disabled={isBusy} onClick={onConfirm}>
          {isBusy ? <Spinner /> : null}
          {fee > 0 ? `Cancel · ${formatCurrency(fee)}` : 'Yes, cancel'}
        </Button>
      </div>
    </div>
  );
}

function FareRow({ ride }) {
  return (
    <div className="grid gap-2 border-t border-line pt-4 text-sm">
      {ride.discount > 0 ? (
        <>
          <div className="flex justify-between text-muted"><span>Trip fare</span><span>{formatCurrency(ride.subtotal)}</span></div>
          <div className="flex justify-between text-brand"><span>Promo {ride.promoCode}</span><span>−{formatCurrency(ride.discount)}</span></div>
        </>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-muted">
          <Icon name={paymentIcon[ride.paymentMethod]} className="h-4 w-4" />
          {paymentLabels[ride.paymentMethod]}
        </span>
        <span className="text-lg font-bold text-ink">{formatCurrency(ride.fare)}</span>
      </div>
    </div>
  );
}

function SearchingState() {
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-[pulse-ring_1.6s_ease-out_infinite] rounded-full bg-brand/30" />
        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white">
          <Icon name="car" className="h-6 w-6" />
        </span>
      </span>
      <h2 className="mt-4 text-xl font-bold">Finding you a driver</h2>
      <p className="mt-1 text-sm text-muted">Matching you with nearby drivers. This usually takes under a minute.</p>
      <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-canvas">
        <div className="h-full w-1/3 animate-[searching_1.4s_ease-in-out_infinite] rounded-full bg-ink" />
      </div>
    </div>
  );
}

function ActiveRidePanel({ ride, onCancel, isCancelling }) {
  const headline = {
    accepted: ride.driverEtaMin ? `Arriving in ${ride.driverEtaMin} min` : 'Driver is on the way',
    arrived: 'Your driver has arrived',
    in_progress: 'Heading to your destination',
  }[ride.status];

  return (
    <div className="grid gap-5">
      {ride.status === 'requested' ? <SearchingState /> : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-brand">{statusLabels[ride.status]}</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">{headline}</h2>
          </div>
          {ride.otp ? (
            <div className="rounded-xl bg-ink px-3.5 py-2 text-center text-white">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a1a1aa]">OTP</p>
              <p className="font-mono text-xl font-bold tracking-[0.2em]">{ride.otp}</p>
            </div>
          ) : null}
        </div>
      )}

      {ride.driver ? (
        <div className="rounded-xl bg-canvas p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={ride.driver.name} className="h-12 w-12" />
              <div>
                <p className="font-semibold">{ride.driver.name}</p>
                <p className="flex items-center gap-1.5 text-sm text-muted"><Rating value={ride.driver.rating} /> · {ride.driver.vehicleModel}</p>
              </div>
            </div>
            <a
              href={`tel:+91${ride.driver.phone}`}
              aria-label={`Call ${ride.driver.name}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-ink shadow-sm transition hover:bg-line"
            >
              <Icon name="phone" className="h-4.5 w-4.5" />
            </a>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">{ride.rideTypeLabel}</span>
            <span className="rounded-md border border-ink/80 bg-white px-2 py-0.5 font-mono text-sm font-bold tracking-wide">{ride.driver.vehicleNumber}</span>
          </div>
        </div>
      ) : null}

      {ride.otp ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Icon name="shield" className="h-4 w-4 shrink-0 text-brand" />
          Share OTP {ride.otp} with your driver only after you get in.
        </p>
      ) : null}

      <TripStops pickup={ride.pickup} dropoff={ride.dropoff} compact />
      <FareRow ride={ride} />

      {['requested', 'accepted', 'arrived'].includes(ride.status) ? (
        <CancelButton
          onConfirm={onCancel}
          isBusy={isCancelling}
          fee={ride.cancellationFeeIfCancelledNow}
          label={ride.status === 'requested' ? 'Cancel request' : 'Cancel ride'}
        />
      ) : null}
    </div>
  );
}

function FinishedRidePanel({ ride, onRate, onDone }) {
  const [rating, setRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const submitRating = async () => {
    setIsSaving(true);
    setError('');
    try {
      await onRate(rating);
    } catch (rateError) {
      setError(rateError.message);
      setIsSaving(false);
    }
  };

  if (ride.status === 'cancelled') {
    const title = {
      system: 'No drivers available',
      admin: 'Ride cancelled by support',
    }[ride.cancelledBy] ?? 'Ride cancelled';

    return (
      <div className="grid gap-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
          <Icon name="close" className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{ride.cancelReason}</p>
          {ride.cancellationFee > 0 ? (
            <p className="mt-3 text-sm font-medium">Cancellation fee: {formatCurrency(ride.cancellationFee)}</p>
          ) : null}
        </div>
        <Button size="lg" block onClick={onDone}>Book another ride</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon name="check" className="h-7 w-7" strokeWidth={2.5} />
        </span>
        <h2 className="mt-4 text-xl font-bold">You&apos;ve arrived</h2>
        <p className="mt-1 text-4xl font-bold tracking-tight">{formatCurrency(ride.fare)}</p>
        <p className="mt-1 text-sm text-muted">
          {ride.paymentMethod === 'cash' ? 'Please pay your driver in cash' : `Paid via ${paymentLabels[ride.paymentMethod]}`}
          {ride.discount > 0 ? ` · You saved ${formatCurrency(ride.discount)}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 divide-x divide-line rounded-xl bg-canvas py-3 text-center text-sm">
        <div><p className="text-muted">Distance</p><p className="font-semibold">{ride.distanceKm} km</p></div>
        <div><p className="text-muted">Ride</p><p className="font-semibold">{ride.rideTypeLabel}</p></div>
        <div><p className="text-muted">Payment</p><p className="font-semibold">{paymentLabels[ride.paymentMethod]}</p></div>
      </div>

      <TripStops pickup={ride.pickup} dropoff={ride.dropoff} compact />

      {ride.rating ? (
        <Alert tone="success">Thanks for rating {ride.driver?.name} {ride.rating} stars.</Alert>
      ) : (
        <div className="rounded-xl border border-line p-4 text-center">
          <p className="text-sm font-semibold">Rate your trip with {ride.driver?.name}</p>
          <div className="mt-3 flex justify-center gap-1" role="radiogroup" aria-label="Rating">
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
          <Button block className="mt-4" disabled={!rating || isSaving} onClick={submitRating}>
            {isSaving ? <Spinner /> : null}
            Submit rating
          </Button>
        </div>
      )}
      <Button variant="secondary" size="lg" block onClick={onDone}>Book another ride</Button>
    </div>
  );
}

function SavedPlaces({ savedPlaces, onPick, onSave, onRemove, canSave }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(placeLabels).map(([label, title]) => {
        const place = savedPlaces?.[label];
        if (place) {
          return (
            <span key={label} className="inline-flex max-w-full items-center rounded-full border border-line text-sm">
              <button
                type="button"
                onClick={() => onPick(place)}
                title={place.address}
                className="flex min-w-0 items-center gap-1.5 rounded-l-full py-1.5 pl-3 pr-2 font-medium hover:bg-canvas"
              >
                <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
                {title}
                <span className="max-w-32 truncate font-normal text-muted">{place.address}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(label)}
                aria-label={`Remove saved ${title}`}
                className="rounded-r-full py-1.5 pl-1 pr-2.5 text-subtle hover:bg-canvas hover:text-ink"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        }
        return (
          <button
            key={label}
            type="button"
            disabled={!canSave}
            onClick={() => onSave(label)}
            title={canSave ? `Save the drop-off as ${title}` : 'Enter a drop-off first to save it'}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Save {title}
          </button>
        );
      })}
    </div>
  );
}

function BookingPanel({ api, user, onUserChange, pickup, setPickup, dropoff, setDropoff, onBooked, promos }) {
  const [estimate, setEstimate] = useState(null);
  const [estimateState, setEstimateState] = useState('idle');
  const [rideType, setRideType] = useState('mini');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [timing, setTiming] = useState('now');
  const [scheduledFor, setScheduledFor] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [isPromoOpen, setIsPromoOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [error, setError] = useState('');
  const canEstimate = pickup.address.trim().length >= 3 && dropoff.address.trim().length >= 3;

  useEffect(() => {
    if (!canEstimate) {
      setEstimate(null);
      setEstimateState('idle');
      return undefined;
    }

    let isCurrent = true;
    setEstimateState('loading');

    // Wait for typing to settle before asking Google for the road distance and the API for fares.
    const timer = setTimeout(async () => {
      let route = {};
      let resolvedPickup = pickup;
      let resolvedDropoff = dropoff;
      if (googleMapsApiKey) {
        [resolvedPickup, resolvedDropoff] = await Promise.all([withCoordinates(pickup), withCoordinates(dropoff)]);
        route = await getDrivingRoute(resolvedPickup, resolvedDropoff).catch(() => ({}));
      }

      try {
        const result = await api('/rides/estimate', {
          method: 'POST',
          body: {
            pickup: resolvedPickup,
            dropoff: resolvedDropoff,
            distanceKm: route.distanceKm,
            durationMin: route.durationMin,
            promoCode: promoCode || undefined,
          },
        });
        if (isCurrent) {
          setEstimate({
            ...result,
            resolvedPickup,
            resolvedDropoff,
            routeDistanceKm: route.distanceKm,
            routeDurationMin: route.durationMin,
          });
          setEstimateState('ready');
          setError('');
        }
      } catch (estimateError) {
        if (isCurrent) {
          setEstimateState('error');
          setError(estimateError.message);
        }
      }
    }, 600);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
    // The JSON key covers every field of pickup/dropoff that affects the fare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canEstimate, JSON.stringify(pickup), JSON.stringify(dropoff), promoCode]);

  const useCurrentLocation = () => {
    const unavailable = locationUnavailableReason();
    if (unavailable) {
      setError(`${unavailable} You can also type your pickup address.`);
      return;
    }

    setIsLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        const address = googleMapsApiKey ? await reverseGeocode(point).catch(() => null) : null;
        setPickup({ ...point, address: address ?? `Current location (${point.lat.toFixed(4)}, ${point.lng.toFixed(4)})` });
        setIsLocating(false);
      },
      (locationError) => {
        setError(`${describeLocationError(locationError)} You can also type your pickup address.`);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const savePlace = async (label) => {
    try {
      const result = await api(`/me/places/${label}`, { method: 'PUT', body: dropoff });
      onUserChange(result.user);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const removePlace = async (label) => {
    try {
      const result = await api(`/me/places/${label}`, { method: 'DELETE' });
      onUserChange(result.user);
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const bookRide = async () => {
    setIsBooking(true);
    setError('');
    try {
      const { ride } = await api('/rides', {
        method: 'POST',
        body: {
          // The same places the quote was based on, so the booked fare matches what was shown.
          pickup: estimate?.resolvedPickup ?? pickup,
          dropoff: estimate?.resolvedDropoff ?? dropoff,
          rideType,
          paymentMethod,
          promoCode: promoCode || undefined,
          scheduledFor: timing === 'later' ? new Date(scheduledFor).toISOString() : undefined,
          distanceKm: estimate?.routeDistanceKm,
          durationMin: estimate?.routeDurationMin,
        },
      });
      if (ride.status === 'scheduled') {
        setPromoCode('');
        setPromoInput('');
        setTiming('now');
      }
      onBooked(ride);
    } catch (bookError) {
      setError(bookError.message);
    } finally {
      setIsBooking(false);
    }
  };

  const selected = estimate?.estimates.find((option) => option.id === rideType);
  const promoBlocksSelection = Boolean(promoCode && selected?.promoError);
  const minSchedule = toLocalInputValue(new Date(Date.now() + 20 * 60 * 1000));

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Get a ride</h1>
        <div className="flex rounded-lg bg-canvas p-1 text-sm font-medium" role="radiogroup" aria-label="Pickup time">
          {[['now', 'Now'], ['later', 'Schedule']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={timing === value}
              onClick={() => setTiming(value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition ${timing === value ? 'bg-white shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {value === 'later' ? <Icon name="clock" className="h-3.5 w-3.5" /> : null}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <PlaceInput
          label="Pickup location"
          value={pickup}
          onChange={setPickup}
          placeholder="Pickup location"
          marker={<span className="h-2.5 w-2.5 rounded-full bg-brand" />}
          action={(
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={isLocating}
              aria-label="Use my current location"
              title="Use my current location"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-line hover:text-ink disabled:opacity-50"
            >
              {isLocating ? <Spinner /> : <Icon name="locate" className="h-4.5 w-4.5" />}
            </button>
          )}
        />
        <PlaceInput
          label="Drop-off location"
          value={dropoff}
          onChange={setDropoff}
          placeholder="Where to?"
          marker={<span className="h-2.5 w-2.5 bg-ink" />}
        />
        <SavedPlaces
          savedPlaces={user.rider?.savedPlaces}
          onPick={setDropoff}
          onSave={savePlace}
          onRemove={removePlace}
          canSave={dropoff.address.trim().length >= 3}
        />
      </div>

      {timing === 'later' ? (
        <label className="grid gap-1.5">
          <span className="text-sm font-medium">Pickup time</span>
          <input
            type="datetime-local"
            value={scheduledFor}
            min={minSchedule}
            onChange={(event) => setScheduledFor(event.target.value)}
            className={inputClasses}
          />
          <span className="text-xs text-muted">We&apos;ll start finding a driver 15 minutes before this time.</span>
        </label>
      ) : null}

      {estimateState === 'loading' && !estimate ? (
        <div className="grid gap-2" aria-label="Loading fares">
          {[0, 1, 2].map((item) => <div key={item} className="h-17 animate-pulse rounded-xl bg-canvas" />)}
        </div>
      ) : null}

      {estimate && estimateState !== 'idle' ? (
        <div className={`grid gap-5 transition-opacity ${estimateState === 'loading' ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Choose a ride</h2>
            <span className="flex items-center gap-1.5 text-sm text-muted">
              <Icon name="route" className="h-4 w-4" />
              {estimate.distanceKm} km · {estimate.durationMin} min
            </span>
          </div>
          <div className="grid gap-1.5" role="radiogroup" aria-label="Ride type">
            {estimate.estimates.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={rideType === option.id}
                onClick={() => setRideType(option.id)}
                className={`flex items-center gap-4 rounded-xl border-2 px-3 py-2.5 text-left transition ${
                  rideType === option.id ? 'border-ink' : 'border-transparent hover:bg-canvas'
                }`}
              >
                <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-lg bg-canvas">
                  <Icon name={vehicleIcon[option.id]} className="h-7 w-7" strokeWidth={1.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {option.label}
                    <span className="flex items-center gap-0.5 text-xs font-normal text-muted">
                      <Icon name="users" className="h-3 w-3" />{option.seats}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted">{option.description}</span>
                </span>
                <span className="text-right">
                  <span className="block font-bold">{formatCurrency(option.fare)}</span>
                  {option.discount > 0 ? <span className="block text-xs text-subtle line-through">{formatCurrency(option.subtotal)}</span> : null}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
            {Object.entries(paymentLabels).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={paymentMethod === id}
                onClick={() => setPaymentMethod(id)}
                className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition ${
                  paymentMethod === id ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:border-ink hover:text-ink'
                }`}
              >
                <Icon name={paymentIcon[id]} className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {promoCode ? (
            <div className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-sm ${
              estimate.promo?.valid ? 'border-[#bfe3cf] bg-brand-soft' : 'border-[#f5c2c2] bg-danger-soft'
            }`}
            >
              <span>
                <span className="font-semibold">{promoCode}</span>
                <span className="text-muted"> · {estimate.promo?.valid
                  ? (selected?.discount ? `You save ${formatCurrency(selected.discount)}` : selected?.promoError ?? 'Applied')
                  : estimate.promo?.message}</span>
              </span>
              <button type="button" onClick={() => { setPromoCode(''); setPromoInput(''); }} className="font-medium text-muted hover:text-ink">Remove</button>
            </div>
          ) : isPromoOpen ? (
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPromoCode(promoInput.trim().toUpperCase());
                setIsPromoOpen(false);
              }}
            >
              <div className="flex gap-2">
                <input
                  value={promoInput}
                  onChange={(event) => setPromoInput(event.target.value)}
                  placeholder="Promo code"
                  aria-label="Promo code"
                  autoFocus
                  className={`${inputClasses} h-10 uppercase placeholder:normal-case`}
                />
                <Button type="submit" variant="secondary" disabled={!promoInput.trim()}>Apply</Button>
              </div>
              {promos.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {promos.map((promo) => (
                    <button
                      key={promo.code}
                      type="button"
                      onClick={() => { setPromoCode(promo.code); setPromoInput(promo.code); setIsPromoOpen(false); }}
                      title={promo.description}
                      className="rounded-md bg-canvas px-2 py-1 font-mono text-xs font-semibold hover:bg-line"
                    >
                      {promo.code}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          ) : (
            <button type="button" onClick={() => setIsPromoOpen(true)} className="flex w-fit items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
              <Icon name="receipt" className="h-4 w-4" />
              Add promo code
            </button>
          )}
        </div>
      ) : null}

      {estimateState === 'idle' ? (
        <div className="flex items-center gap-3 rounded-xl bg-canvas p-4 text-sm text-muted">
          <Icon name="receipt" className="h-5 w-5 shrink-0" />
          Enter pickup and drop-off to see upfront prices for every ride type.
        </div>
      ) : null}

      {error ? <Alert onDismiss={() => setError('')}>{error}</Alert> : null}

      <Button size="lg" block onClick={bookRide} disabled={!selected || isBooking || estimateState !== 'ready' || promoBlocksSelection}>
        {isBooking ? <Spinner /> : null}
        {!selected ? 'Request ride' : timing === 'later' ? `Schedule ${selected.label}` : `Request ${selected.label} · ${formatCurrency(selected.fare)}`}
      </Button>
    </div>
  );
}

function UpcomingRides({ rides, onCancel }) {
  const [cancellingId, setCancellingId] = useState(null);
  if (rides.length === 0) return null;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon name="clock" className="h-4 w-4" />
        Upcoming rides
      </h2>
      <div className="mt-3 grid gap-2">
        {rides.map((ride) => (
          <div key={ride.id} className="rounded-xl border border-line p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{formatScheduleTime(ride.scheduledFor)}</p>
                <p className="truncate text-sm text-muted">To {ride.dropoff.address}</p>
                <p className="mt-0.5 text-xs text-muted">{ride.rideTypeLabel} · {formatCurrency(ride.fare)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={cancellingId === ride.id}
                onClick={async () => {
                  setCancellingId(ride.id);
                  await onCancel(ride.id);
                  setCancellingId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiderPage() {
  const { user, signOut, updateUser } = useSession('customer');
  const api = useApi('customer');
  const [draft] = useState(() => takeTripDraft());
  const [pickup, setPickup] = useState(() => draft?.pickup ?? { address: '' });
  const [dropoff, setDropoff] = useState(() => draft?.dropoff ?? { address: '' });
  const [activeRide, setActiveRide] = useState(null);
  const [finishedRide, setFinishedRide] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [promos, setPromos] = useState([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [notice, setNotice] = useState(null);
  const trackedRideIdRef = useRef(null);

  const isLive = useRealtime('customer', {
    'ride:changed': () => refresh(),
    'account:changed': () => api('/auth/me').then((result) => updateUser(result.user)).catch(() => {}),
  });

  // Sockets push changes instantly; polling stays on as a slower safety net.
  const refresh = usePolling(async () => {
    try {
      const [{ ride }, upcomingResult] = await Promise.all([api('/rides/active'), api('/rides/upcoming')]);
      setUpcoming(upcomingResult.rides);
      if (ride) {
        trackedRideIdRef.current = ride.id;
        setActiveRide(ride);
      } else {
        setActiveRide(null);
        // The ride we were following just ended: show its final state (receipt or cancellation).
        const finishedId = trackedRideIdRef.current;
        trackedRideIdRef.current = null;
        if (finishedId) {
          const result = await api(`/rides/${finishedId}`);
          setFinishedRide(result.ride);
        }
      }
    } catch (pollError) {
      setNotice({ tone: 'error', text: pollError.message });
    } finally {
      setHasLoaded(true);
    }
  }, isLive ? 15000 : 4000);

  useEffect(() => {
    api('/rides/types').then((result) => setPromos(result.promos)).catch(() => {});
  }, [api]);

  const handleBooked = (ride) => {
    if (ride.status === 'scheduled') {
      setUpcoming((current) => [...current, ride].sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor)));
      setNotice({ tone: 'success', text: `Ride scheduled for ${formatScheduleTime(ride.scheduledFor)}.` });
      setDropoff({ address: '' });
      return;
    }
    trackedRideIdRef.current = ride.id;
    setActiveRide(ride);
    setFinishedRide(null);
    setNotice(null);
  };

  const cancelRide = async () => {
    setIsCancelling(true);
    try {
      const { ride } = await api(`/rides/${activeRide.id}/cancel`, { method: 'POST' });
      trackedRideIdRef.current = null;
      setActiveRide(null);
      setFinishedRide(ride);
    } catch (cancelError) {
      setNotice({ tone: 'error', text: cancelError.message });
    } finally {
      setIsCancelling(false);
    }
  };

  const cancelScheduled = async (rideId) => {
    try {
      await api(`/rides/${rideId}/cancel`, { method: 'POST' });
      setUpcoming((current) => current.filter((ride) => ride.id !== rideId));
      setNotice({ tone: 'success', text: 'Scheduled ride cancelled.' });
    } catch (cancelError) {
      setNotice({ tone: 'error', text: cancelError.message });
    }
  };

  const rateRide = async (rating) => {
    const { ride } = await api(`/rides/${finishedRide.id}/rate`, { method: 'POST', body: { rating } });
    setFinishedRide(ride);
  };

  const startOver = () => {
    setFinishedRide(null);
    setDropoff({ address: '' });
  };

  const mapRide = activeRide ?? finishedRide;

  let panel;
  if (!hasLoaded) {
    panel = <div className="flex justify-center py-12 text-muted"><Spinner className="h-6 w-6" /></div>;
  } else if (activeRide) {
    panel = <ActiveRidePanel ride={activeRide} onCancel={cancelRide} isCancelling={isCancelling} />;
  } else if (finishedRide) {
    panel = <FinishedRidePanel ride={finishedRide} onRate={rateRide} onDone={startOver} />;
  } else {
    panel = (
      <>
        <BookingPanel
          api={api}
          user={user}
          onUserChange={updateUser}
          pickup={pickup}
          setPickup={setPickup}
          dropoff={dropoff}
          setDropoff={setDropoff}
          onBooked={handleBooked}
          promos={promos}
        />
        <UpcomingRides rides={upcoming} onCancel={cancelScheduled} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader links={riderLinks} user={user} onSignOut={signOut} roleLabel={user.rider?.rating ? `Rider · ★ ${user.rider.rating.toFixed(1)}` : 'Rider'} />
      <MapLayout
        map={(
          <RideMap
            pickup={mapRide?.pickup ?? pickup}
            dropoff={mapRide?.dropoff ?? dropoff}
            driverLocation={activeRide?.driverLocation}
            className="h-full"
          />
        )}
      >
        {notice ? <div className="mb-4"><Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert></div> : null}
        {panel}
      </MapLayout>
    </div>
  );
}

export default RiderPage;
