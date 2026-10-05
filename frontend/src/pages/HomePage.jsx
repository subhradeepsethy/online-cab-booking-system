import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandLink } from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import PlaceInput from '../components/PlaceInput.jsx';
import { Button, Logo } from '../components/ui.jsx';
import { apiRequest } from '../lib/apiClient.js';
import { formatCurrency } from '../lib/format.js';
import { useSession } from '../lib/session.js';
import { saveTripDraft } from '../lib/tripDraft.js';
import { buttonClasses, vehicleIcon } from '../lib/ui.js';

const features = [
  { icon: 'receipt', title: 'Upfront pricing', text: 'See the exact fare for every ride type before you book. No surprises at drop-off.' },
  { icon: 'shield', title: 'OTP-verified pickups', text: 'Every trip starts only after you share a 4-digit code with your driver.' },
  { icon: 'navigation', title: 'Live tracking', text: 'Watch your driver approach on the map and know exactly when to step out.' },
];

function HeroIllustration() {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink p-6 shadow-panel sm:p-8">
      <svg viewBox="0 0 400 300" className="w-full" aria-hidden="true">
        <defs>
          <pattern id="streets" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="#26272b" strokeWidth="6" />
          </pattern>
        </defs>
        <rect width="400" height="300" fill="#1a1b1e" rx="16" />
        <rect width="400" height="300" fill="url(#streets)" rx="16" />
        <path d="M70 240 C 70 170, 150 190, 170 130 S 280 80, 320 60" fill="none" stroke="#d9f45d" strokeWidth="6" strokeLinecap="round" />
        <circle cx="70" cy="240" r="11" fill="#0f9d58" stroke="#fff" strokeWidth="4" />
        <rect x="310" y="50" width="20" height="20" fill="#fff" />
        <circle cx="170" cy="130" r="9" fill="#2563eb" stroke="#fff" strokeWidth="3" />
      </svg>
      <div className="absolute inset-x-6 bottom-6 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 sm:inset-x-8 sm:bottom-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-canvas">
            <Icon name="car" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Driver arriving in 3 min</p>
            <p className="text-xs text-muted">Swift Dzire · OD 02 AB 1234</p>
          </div>
        </div>
        <span className="rounded-md bg-ink px-2.5 py-1.5 font-mono text-sm font-bold tracking-[0.2em] text-white">4821</span>
      </div>
    </div>
  );
}

function HomePage() {
  const navigate = useNavigate();
  const rider = useSession('customer').user;
  const driver = useSession('driver').user;
  const [pickup, setPickup] = useState({ address: '' });
  const [dropoff, setDropoff] = useState({ address: '' });
  const [rideTypes, setRideTypes] = useState([]);

  useEffect(() => {
    apiRequest('/rides/types').then((result) => setRideTypes(result.rideTypes)).catch(() => {});
  }, []);

  const seePrices = (event) => {
    event.preventDefault();
    saveTripDraft({ pickup, dropoff });
    navigate('/rider');
  };

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <BrandLink />
            <nav className="hidden items-center gap-6 text-sm font-medium text-muted md:flex">
              <a href="#ride" className="hover:text-ink">Ride</a>
              <a href="#drive" className="hover:text-ink">Drive</a>
              <a href="#safety" className="hover:text-ink">Safety</a>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link to={rider ? '/rider' : '/rider/login'} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
              {rider ? 'Rider app' : 'Log in'}
            </Link>
            <Link to={rider ? '/rider' : '/rider/login?mode=signup'} className={buttonClasses({ size: 'sm' })}>
              {rider ? 'Book a ride' : 'Sign up'}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section id="ride" className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <h1 className="text-[2.75rem] font-bold leading-[1.05] tracking-tight sm:text-6xl">Go anywhere with Cab System</h1>
            <p className="mt-5 max-w-md text-lg text-muted">Request a ride, hop in, and go. Upfront fares, verified drivers and live tracking on every trip.</p>

            <form onSubmit={seePrices} className="mt-8 grid max-w-md gap-2">
              <PlaceInput label="Pickup location" value={pickup} onChange={setPickup} placeholder="Pickup location" marker={<span className="h-2.5 w-2.5 rounded-full bg-brand" />} />
              <PlaceInput label="Drop-off location" value={dropoff} onChange={setDropoff} placeholder="Where to?" marker={<span className="h-2.5 w-2.5 bg-ink" />} />
              <Button type="submit" size="lg" className="mt-2 w-fit px-8">See prices</Button>
            </form>
          </div>
          <HeroIllustration />
        </section>

        {rideTypes.length > 0 ? (
          <section className="border-t border-line bg-canvas">
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">A ride for every trip</h2>
              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {rideTypes.map((type) => (
                  <div key={type.id} className="rounded-2xl bg-white p-5 transition hover:shadow-panel">
                    <Icon name={vehicleIcon[type.id]} className="h-8 w-8" strokeWidth={1.5} />
                    <p className="mt-4 font-semibold">{type.label}</p>
                    <p className="mt-1 text-sm text-muted">{type.description}</p>
                    <p className="mt-3 text-sm font-medium">From {formatCurrency(type.minimumFare)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section id="safety" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built around your safety</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title}>
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas">
                  <Icon name={feature.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-muted">{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="drive" className="bg-ink text-white">
          <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-16 sm:px-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Drive when you want, earn what you need</h2>
              <p className="mt-4 max-w-xl text-[#a1a1aa]">Go online whenever it suits you, accept trips near you and track every rupee you earn.</p>
            </div>
            <Link
              to={driver ? '/driver' : '/driver/login?mode=signup'}
              className={`${buttonClasses({ variant: 'secondary', size: 'lg' })} border-transparent`}
            >
              {driver ? 'Open driver app' : 'Sign up to drive'}
              <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <Logo />
          <div className="flex gap-6">
            <Link to="/rider/login" className="hover:text-ink">Rider login</Link>
            <Link to="/driver/login" className="hover:text-ink">Driver login</Link>
            <Link to="/admin/login" className="hover:text-ink">Admin</Link>
          </div>
          <p>© {new Date().getFullYear()} Cab System</p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
