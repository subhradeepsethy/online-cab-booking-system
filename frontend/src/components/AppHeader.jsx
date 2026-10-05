import { Link, NavLink } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Avatar, Logo } from './ui.jsx';

export function BrandLink({ inverted }) {
  return (
    <Link to="/" aria-label="Cab System home">
      <Logo inverted={inverted} />
    </Link>
  );
}

const navLinkClass = ({ isActive }) => `inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
  isActive ? 'bg-canvas text-ink' : 'text-muted hover:text-ink'
}`;

function AppHeader({ links = [], user, onSignOut, roleLabel, children }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-360 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <BrandLink />
          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end className={navLinkClass}>{link.label}</NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {children}
          {user ? (
            <>
              <div className="flex items-center gap-2.5 sm:border-l sm:border-line sm:pl-3">
                <Avatar name={user.name} className="h-8 w-8 text-xs" />
                <div className="hidden leading-tight md:block">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-muted">{roleLabel}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Log out"
                title="Log out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-canvas hover:text-ink"
              >
                <Icon name="logout" className="h-4.5 w-4.5" />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {links.length > 0 ? (
        <nav className="flex gap-1 border-t border-line px-4 py-2 sm:hidden">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end className={navLinkClass}>{link.label}</NavLink>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export default AppHeader;
