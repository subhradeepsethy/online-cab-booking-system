import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AdminLayout from '../../components/AdminLayout.jsx';
import DocumentPreview from '../../components/DocumentPreview.jsx';
import Icon from '../../components/Icon.jsx';
import { Alert, Avatar, Button, Card, Rating, Spinner } from '../../components/ui.jsx';
import VerificationBadge from '../../components/VerificationBadge.jsx';
import { formatCurrency, formatDateTime } from '../../lib/format.js';
import { useApi } from '../../lib/session.js';
import { inputClasses, vehicleIcon } from '../../lib/ui.js';
import { usePolling } from '../../lib/usePolling.js';
import { useRealtime } from '../../lib/useRealtime.js';

const filtersByRole = {
  driver: [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending review' },
    { id: 'online', label: 'Online' },
    { id: 'blocked', label: 'Blocked' },
  ],
  customer: [
    { id: 'all', label: 'All' },
    { id: 'blocked', label: 'Blocked' },
  ],
};

function UserDetail({ user, role, onUpdate, onClose }) {
  const [note, setNote] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const isDriver = role === 'driver';

  const run = async (key, body) => {
    setBusy(key);
    setError('');
    try {
      await onUpdate(user.id, body);
      setIsRejecting(false);
      setNote('');
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={user.name} className="h-12 w-12" />
          <div>
            <p className="text-lg font-bold">{user.name}</p>
            <p className="text-sm text-muted">+91 {user.phone} · joined {formatDateTime(user.createdAt)}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {isDriver ? <VerificationBadge status={user.driver.approvalStatus} /> : null}
        {user.blocked ? <span className="rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger">Blocked</span> : null}
        {isDriver && user.driver.isOnline ? <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-[#0b6b3c]">Online</span> : null}
      </div>

      <div className="grid grid-cols-3 divide-x divide-line rounded-xl bg-canvas py-3 text-center text-sm">
        <div><p className="text-muted">Trips</p><p className="font-semibold">{user.stats.trips}</p></div>
        <div><p className="text-muted">{isDriver ? 'Earned' : 'Spent'}</p><p className="font-semibold">{formatCurrency(user.stats.amount)}</p></div>
        <div><p className="text-muted">Rating</p><p className="flex justify-center font-semibold"><Rating value={user.stats.rating} /></p></div>
      </div>

      {isDriver ? (
        <div>
          <h3 className="text-sm font-semibold">Vehicle</h3>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <Icon name={vehicleIcon[user.driver.vehicleType]} className="h-4 w-4" />
            {user.driver.vehicleModel} · {user.driver.vehicleType.toUpperCase()}
            <span className="rounded border border-ink/70 px-1.5 font-mono text-xs font-bold">{user.driver.vehicleNumber}</span>
          </p>
        </div>
      ) : null}

      {isDriver ? (
        <div>
          <h3 className="text-sm font-semibold">Documents</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {Object.entries(user.driver.documents).map(([type, document]) => (
              <div key={type}>
                <p className="mb-1.5 text-xs font-medium text-muted">{document.label}</p>
                {document.uploaded ? (
                  <DocumentPreview
                    path={`/admin/users/${user.id}/documents/${type}?v=${encodeURIComponent(document.uploadedAt)}`}
                    role="admin"
                    mimeType={document.mimeType}
                    label={document.label}
                    className="h-28"
                  />
                ) : (
                  <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-line text-xs text-subtle">Not uploaded</div>
                )}
              </div>
            ))}
          </div>
          {user.driver.approvalStatus === 'rejected' && user.driver.approvalNote ? (
            <p className="mt-2 text-sm text-muted">Rejection note: {user.driver.approvalNote}</p>
          ) : null}
        </div>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      {isDriver && user.driver.approvalStatus !== 'approved' && !isRejecting ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setIsRejecting(true)}>Reject</Button>
          <Button variant="brand" disabled={Boolean(busy)} onClick={() => run('approve', { approvalStatus: 'approved' })}>
            {busy === 'approve' ? <Spinner /> : <Icon name="check" className="h-4 w-4" />}
            Approve driver
          </Button>
        </div>
      ) : null}

      {isDriver && user.driver.approvalStatus === 'approved' && !isRejecting ? (
        <Button variant="secondary" onClick={() => setIsRejecting(true)}>Revoke approval</Button>
      ) : null}

      {isRejecting ? (
        <form
          className="grid gap-2 rounded-xl border border-line p-4"
          onSubmit={(event) => {
            event.preventDefault();
            run('reject', { approvalStatus: 'rejected', note });
          }}
        >
          <label htmlFor="reject-note" className="text-sm font-medium">Reason (shown to the driver)</label>
          <textarea
            id="reject-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            required
            placeholder="e.g. Licence photo is blurry. Please upload a clearer image."
            className={`${inputClasses} h-auto py-2.5`}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setIsRejecting(false)}>Back</Button>
            <Button type="submit" variant="danger" disabled={!note.trim() || Boolean(busy)}>
              {busy === 'reject' ? <Spinner /> : null}
              Reject
            </Button>
          </div>
        </form>
      ) : null}

      <div className="border-t border-line pt-4">
        {user.blocked ? (
          <Button variant="secondary" block disabled={Boolean(busy)} onClick={() => run('block', { blocked: false })}>Unblock account</Button>
        ) : (
          <Button variant="ghost" block className="text-danger hover:bg-danger-soft" disabled={Boolean(busy)} onClick={() => run('block', { blocked: true })}>
            Block account
          </Button>
        )}
        <p className="mt-2 text-center text-xs text-muted">
          {user.blocked ? 'This person cannot log in or use the app.' : 'Blocking logs this person out and stops them using the app.'}
        </p>
      </div>
    </div>
  );
}

function AdminUsersPage({ role }) {
  const api = useApi('admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') ?? 'all';
  const selectedId = searchParams.get('user');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState(null);
  const [notice, setNotice] = useState(null);
  const isDriver = role === 'driver';

  const isLive = useRealtime('admin', { 'admin:changed': () => refresh() });

  const refresh = usePolling(async () => {
    try {
      const params = new URLSearchParams({ role, filter, q: query.trim() });
      const result = await api(`/admin/users?${params}`);
      setUsers(result.users);
    } catch (loadError) {
      setNotice({ tone: 'error', text: loadError.message });
    }
  }, isLive ? 60000 : 10000);

  // Refetch when the filter in the URL changes (the initial load is handled by usePolling).
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    refresh();
  }, [filter, refresh]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const updateUser = async (id, body) => {
    const result = await api(`/admin/users/${id}`, { method: 'PATCH', body });
    setUsers((current) => current?.map((user) => (user.id === id ? result.user : user)) ?? current);
    const messages = {
      approved: `${result.user.name} is approved and can now go online.`,
      rejected: `${result.user.name} was asked to fix their documents.`,
    };
    setNotice({
      tone: 'success',
      text: messages[body.approvalStatus] ?? (body.blocked ? `${result.user.name} has been blocked.` : `${result.user.name} has been unblocked.`),
    });
  };

  const selected = users?.find((user) => user.id === selectedId) ?? null;

  return (
    <AdminLayout
      title={isDriver ? 'Drivers' : 'Riders'}
      description={isDriver ? 'Verify documents, approve new drivers and manage accounts.' : 'Look up riders and manage their accounts.'}
      isLive={isLive}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-line">
          {filtersByRole[role].map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setParam('filter', option.id === 'all' ? '' : option.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${filter === option.id ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
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
            placeholder={isDriver ? 'Search name, phone or vehicle number and press Enter' : 'Search name or phone and press Enter'}
            aria-label={`Search ${isDriver ? 'drivers' : 'riders'}`}
            className={`${inputClasses} h-10`}
          />
        </form>
      </div>

      {notice ? <div className="mb-4"><Alert tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Alert></div> : null}

      <div className={`grid gap-6 ${selected ? 'lg:grid-cols-[1fr_420px]' : ''}`}>
        <Card className="overflow-hidden">
          {users === null ? <div className="flex justify-center py-12 text-muted"><Spinner className="h-5 w-5" /></div> : null}
          {users?.length === 0 ? <p className="py-12 text-center text-sm text-muted">No {isDriver ? 'drivers' : 'riders'} match these filters.</p> : null}
          <ul className="divide-y divide-line">
            {users?.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => setParam('user', user.id === selectedId ? '' : user.id)}
                  className={`flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-canvas ${user.id === selectedId ? 'bg-canvas' : ''}`}
                >
                  <Avatar name={user.name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{user.name}</span>
                      {user.blocked ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">Blocked</span> : null}
                      {isDriver && user.driver.isOnline ? <span className="h-2 w-2 shrink-0 rounded-full bg-brand" title="Online" /> : null}
                    </p>
                    <p className="truncate text-sm text-muted">
                      +91 {user.phone}
                      {isDriver ? ` · ${user.driver.vehicleNumber} · ${user.driver.vehicleType.toUpperCase()}` : ''}
                    </p>
                  </div>
                  <div className="hidden text-right text-sm sm:block">
                    <p className="font-medium">{user.stats.trips} trips</p>
                    <p className="text-muted">{formatCurrency(user.stats.amount)}</p>
                  </div>
                  {isDriver ? <div className="hidden md:block"><VerificationBadge status={user.driver.approvalStatus} /></div> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selected ? (
          <Card className="h-fit p-5 lg:sticky lg:top-8">
            <UserDetail key={selected.id} user={selected} role={role} onUpdate={updateUser} onClose={() => setParam('user', '')} />
          </Card>
        ) : null}
      </div>
    </AdminLayout>
  );
}

export default AdminUsersPage;
