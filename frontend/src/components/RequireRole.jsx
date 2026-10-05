import { Navigate, useLocation } from 'react-router-dom';
import { roleSlugs, useSession } from '../lib/session.js';
import { Spinner } from './ui.jsx';

function RequireRole({ role, children }) {
  const { user, isRestoring } = useSession(role);
  const location = useLocation();

  if (!user && isRestoring) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/${roleSlugs[role]}/login`} replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default RequireRole;
