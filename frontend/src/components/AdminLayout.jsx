import { NavLink } from 'react-router-dom';
import { useSession } from '../lib/session.js';
import Icon from './Icon.jsx';
import { Avatar, Logo } from './ui.jsx';

const links = [
  { to: '/admin', label: 'Overview', icon: 'trending' },
  { to: '/admin/rides', label: 'Rides', icon: 'route' },
  { to: '/admin/drivers', label: 'Drivers', icon: 'car' },
  { to: '/admin/riders', label: 'Riders', icon: 'users' },
];

const linkClass = ({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
  isActive ? 'bg-white/10 text-white' : 'text-[#a1a1aa] hover:bg-white/5 hover:text-white'
}`;

function AdminLayout({ title, description, actions, isLive, children }) {
  const { user, signOut } = useSession('admin');

  return (
    <div className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="bg-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex items-center justify-between px-5 py-4 lg:py-6">
          <Logo inverted />
          <button type="button" onClick={signOut} className="text-sm text-[#a1a1aa] hover:text-white lg:hidden">Log out</button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:pb-0">
          <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#71717a] lg:block">Operations</p>
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end className={linkClass}>
              <Icon name={link.icon} className="h-4.5 w-4.5" />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-3 border-t border-white/10 px-5 py-4 lg:flex">
          <Avatar name={user.name} className="h-9 w-9 bg-white/10 text-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="text-xs text-[#a1a1aa]">Administrator</p>
          </div>
          <button type="button" onClick={signOut} aria-label="Log out" title="Log out" className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-white/10 hover:text-white">
            <Icon name="logout" className="h-4.5 w-4.5" />
          </button>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
              {isLive !== undefined ? (
                <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${isLive ? 'bg-brand-soft text-[#0b6b3c]' : 'bg-canvas text-muted ring-1 ring-line'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-brand' : 'bg-subtle'}`} />
                  {isLive ? 'Live' : 'Offline'}
                </span>
              ) : null}
            </div>
            {description ? <p className="mt-1 text-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

export default AdminLayout;
