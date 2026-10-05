import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandLink } from '../components/AppHeader.jsx';
import Icon from '../components/Icon.jsx';
import { Alert, Button, Spinner } from '../components/ui.jsx';
import { apiRequest } from '../lib/apiClient.js';
import { roleSlugs, useSession } from '../lib/session.js';
import { inputClasses, vehicleIcon } from '../lib/ui.js';

const vehicleTypes = [
  { id: 'bike', label: 'Bike' },
  { id: 'auto', label: 'Auto' },
  { id: 'mini', label: 'Mini' },
  { id: 'sedan', label: 'Sedan' },
  { id: 'suv', label: 'SUV' },
];

const copy = {
  customer: {
    noun: 'rider',
    title: { login: 'Welcome back', signup: 'Create a rider account' },
    subtitle: { login: 'Log in to book your next ride.', signup: 'Book rides in seconds with upfront fares.' },
    panelTitle: 'Your ride, on demand.',
    panelPoints: ['Upfront fares on every ride type', 'OTP-verified pickups', 'Live driver tracking'],
    otherRole: 'driver',
    otherLabel: 'Drive with us',
  },
  driver: {
    noun: 'driver',
    title: { login: 'Driver login', signup: 'Become a driver' },
    subtitle: { login: 'Log in to go online and accept trips.', signup: 'Register your vehicle and start earning.' },
    panelTitle: 'Earn on your own schedule.',
    panelPoints: ['Go online and offline anytime', 'See fare and distance before accepting', 'Track daily earnings and ratings'],
    otherRole: 'customer',
    otherLabel: 'Book a ride instead',
  },
  admin: {
    noun: 'admin',
    title: { login: 'Operations console', signup: 'Operations console' },
    subtitle: { login: 'Admin access for the Cab System team.', signup: 'Admin accounts are created by the system owner.' },
    panelTitle: 'Run the network.',
    panelPoints: ['Monitor live rides in real time', 'Verify and approve new drivers', 'Track revenue and trip volume'],
    otherRole: 'customer',
    otherLabel: 'Back to rider app',
    loginOnly: true,
  },
};

// Local demo logins. `import.meta.env.DEV` is false in production builds, so these are
// stripped from the shipped bundle entirely.
const demoLogins = import.meta.env.DEV ? {
  customer: { phone: '9000000001', password: 'demo1234' },
  driver: { phone: '9000000002', password: 'demo1234' },
  admin: { phone: '9000000000', password: 'admin1234567' },
} : {};

function Field({ label, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}

function AuthPage({ role }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { signIn } = useSession(role);
  const requestedMode = searchParams.get('mode');
  const mode = ['signup', 'reset'].includes(requestedMode) && !copy[role].loginOnly ? requestedMode : 'login';
  const [form, setForm] = useState({
    name: '', phone: '', password: '', vehicleType: 'mini', vehicleModel: '', vehicleNumber: '', otpCode: '', newPassword: '',
  });
  // Sign-up and password reset happen in two steps: enter details, then the SMS code.
  const [step, setStep] = useState('details');
  const [devCode, setDevCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const text = copy[role];
  const home = location.state?.from ?? `/${roleSlugs[role]}`;
  const isVerifying = step === 'verify' && mode !== 'login';

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const switchMode = (nextMode) => {
    setError('');
    setNotice('');
    setStep('details');
    setDevCode('');
    setForm((current) => ({ ...current, otpCode: '', newPassword: '' }));
    setSearchParams(nextMode === 'login' ? {} : { mode: nextMode }, { replace: true, state: location.state });
  };

  const sendCode = async () => {
    const result = await apiRequest('/auth/otp', {
      method: 'POST',
      body: { purpose: mode === 'reset' ? 'reset' : 'signup', role, phone: form.phone },
    });
    // Only returned by a development server without an SMS provider.
    setDevCode(result.devCode ?? '');
    setResendIn(60);
    setStep('verify');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        const session = await apiRequest('/auth/login', { method: 'POST', body: { role, phone: form.phone, password: form.password } });
        signIn(session);
        navigate(home, { replace: true });
      } else if (!isVerifying) {
        await sendCode();
      } else if (mode === 'signup') {
        const session = await apiRequest('/auth/register', { method: 'POST', body: { ...form, role } });
        signIn(session);
        navigate(home, { replace: true });
      } else {
        await apiRequest('/auth/password/reset', {
          method: 'POST',
          body: { role, phone: form.phone, otpCode: form.otpCode, newPassword: form.newPassword },
        });
        switchMode('login');
        setForm((current) => ({ ...current, password: '' }));
        setNotice('Password updated. Log in with your new password.');
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resend = async () => {
    setError('');
    try {
      await sendCode();
    } catch (resendError) {
      setError(resendError.message);
    }
  };

  const title = mode === 'reset' ? 'Reset your password' : text.title[mode];
  const subtitle = isVerifying
    ? `Enter the 6-digit code we sent to +91 ${form.phone}.`
    : mode === 'reset' ? "We'll text you a code to set a new password." : text.subtitle[mode];
  const submitLabel = mode === 'login'
    ? 'Log in'
    : !isVerifying ? 'Send verification code' : mode === 'signup' ? 'Verify and create account' : 'Set new password';

  return (
    <div className="grid min-h-screen bg-white text-ink lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <BrandLink />
          <Link to={`/${roleSlugs[text.otherRole]}/login`} className="text-sm font-medium text-muted hover:text-ink">
            {text.otherLabel}
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-muted">{subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
            {notice ? <Alert tone="success">{notice}</Alert> : null}

            {isVerifying ? (
              <>
                <Field label="Verification code">
                  <input
                    name="otpCode"
                    value={form.otpCode}
                    onChange={(event) => setForm((current) => ({ ...current, otpCode: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    placeholder="000000"
                    autoFocus
                    className={`${inputClasses} text-center font-mono text-xl tracking-[0.5em]`}
                  />
                </Field>
                {devCode ? (
                  <Alert tone="warning">Development server (no SMS provider): your code is <strong>{devCode}</strong>.</Alert>
                ) : null}
                {mode === 'reset' ? (
                  <Field label="New password">
                    <input
                      type="password"
                      name="newPassword"
                      value={form.newPassword}
                      onChange={handleChange}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className={inputClasses}
                    />
                  </Field>
                ) : null}
                <div className="flex justify-between text-sm">
                  <button type="button" onClick={() => setStep('details')} className="font-medium text-muted hover:text-ink">
                    Change details
                  </button>
                  <button type="button" onClick={resend} disabled={resendIn > 0} className="font-medium text-ink hover:underline disabled:text-subtle disabled:no-underline">
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                  </button>
                </div>
              </>
            ) : null}

            {!isVerifying && mode === 'signup' ? (
              <Field label="Full name">
                <input name="name" value={form.name} onChange={handleChange} required autoComplete="name" placeholder="As on your ID" className={inputClasses} />
              </Field>
            ) : null}

            {isVerifying ? null : (
            <Field label="Mobile number">
              <div className="flex h-12 items-center rounded-lg border border-line bg-white transition focus-within:border-ink focus-within:ring-4 focus-within:ring-ink/5">
                <span className="flex h-full items-center border-r border-line px-3.5 text-[15px] text-muted">+91</span>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  required
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[15px] outline-none placeholder:text-subtle"
                />
              </div>
            </Field>
            )}

            {isVerifying || mode === 'reset' ? null : (
              <Field label="Password">
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  className={inputClasses}
                />
              </Field>
            )}

            {mode === 'login' && !text.loginOnly ? (
              <button type="button" onClick={() => switchMode('reset')} className="-mt-2 w-fit text-sm font-medium text-muted hover:text-ink">
                Forgot password?
              </button>
            ) : null}

            {!isVerifying && mode === 'signup' && role === 'driver' ? (
              <div className="mt-2 grid gap-4 border-t border-line pt-6">
                <p className="text-sm font-semibold">Vehicle details</p>
                <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Vehicle type">
                  {vehicleTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      role="radio"
                      aria-checked={form.vehicleType === type.id}
                      onClick={() => setForm((current) => ({ ...current, vehicleType: type.id }))}
                      className={`flex flex-col items-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition ${
                        form.vehicleType === type.id ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:border-ink hover:text-ink'
                      }`}
                    >
                      <Icon name={vehicleIcon[type.id]} className="h-5 w-5" />
                      {type.label}
                    </button>
                  ))}
                </div>
                <Field label="Make and model">
                  <input name="vehicleModel" value={form.vehicleModel} onChange={handleChange} required placeholder="Maruti Suzuki Dzire" className={inputClasses} />
                </Field>
                <Field label="Registration number">
                  <input name="vehicleNumber" value={form.vehicleNumber} onChange={handleChange} required placeholder="OD 02 AB 1234" className={`${inputClasses} uppercase placeholder:normal-case`} />
                </Field>
              </div>
            ) : null}

            {error ? <Alert>{error}</Alert> : null}

            <Button type="submit" size="lg" block disabled={isSubmitting} className="mt-2">
              {isSubmitting ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </form>

          {text.loginOnly ? null : (
            <p className="mt-6 text-center text-sm text-muted">
              {mode === 'login' ? 'New to Cab System? ' : mode === 'signup' ? 'Already have an account? ' : 'Remembered it? '}
              <button type="button" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')} className="font-semibold text-ink hover:underline">
                {mode === 'login' ? 'Create an account' : 'Log in'}
              </button>
            </p>
          )}

          {demoLogins[role] && mode === 'login' ? (
            <button
              type="button"
              onClick={() => setForm((current) => ({ ...current, ...demoLogins[role] }))}
              className="mt-6 rounded-lg border border-dashed border-line px-4 py-3 text-left text-sm text-muted transition hover:border-ink"
            >
              <span className="font-medium text-ink">Use demo {text.noun} account</span>
              <span className="block">{demoLogins[role].phone} · {demoLogins[role].password}</span>
            </button>
          ) : null}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-end">
        <div
          className="absolute inset-0 opacity-40"
          style={{ backgroundImage: 'linear-gradient(#26272b 2px, transparent 2px), linear-gradient(90deg, #26272b 2px, transparent 2px)', backgroundSize: '56px 56px' }}
        />
        <div className="relative max-w-md">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-ink">
            <Icon name={{ driver: 'trending', admin: 'shield' }[role] ?? 'navigation'} className="h-7 w-7" />
          </span>
          <h2 className="mt-8 text-4xl font-bold leading-tight tracking-tight">{text.panelTitle}</h2>
          <ul className="mt-8 grid gap-4">
            {text.panelPoints.map((point) => (
              <li key={point} className="flex items-center gap-3 text-[#d4d4d8]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                  <Icon name="check" className="h-3.5 w-3.5 text-accent" strokeWidth={3} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

export default AuthPage;
