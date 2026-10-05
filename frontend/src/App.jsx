import { Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './components/RequireRole.jsx';
import AdminOverviewPage from './pages/admin/AdminOverviewPage.jsx';
import AdminRidesPage from './pages/admin/AdminRidesPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import DriverDashboardPage from './pages/DriverDashboardPage.jsx';
import DriverDocumentsPage from './pages/DriverDocumentsPage.jsx';
import HomePage from './pages/HomePage.jsx';
import RiderPage from './pages/RiderPage.jsx';
import TripsPage from './pages/TripsPage.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route path="/rider/login" element={<AuthPage key="customer" role="customer" />} />
      <Route path="/rider" element={<RequireRole role="customer"><RiderPage /></RequireRole>} />
      <Route path="/rider/trips" element={<RequireRole role="customer"><TripsPage key="customer" role="customer" /></RequireRole>} />

      <Route path="/driver/login" element={<AuthPage key="driver" role="driver" />} />
      <Route path="/driver" element={<RequireRole role="driver"><DriverDashboardPage /></RequireRole>} />
      <Route path="/driver/trips" element={<RequireRole role="driver"><TripsPage key="driver" role="driver" /></RequireRole>} />
      <Route path="/driver/documents" element={<RequireRole role="driver"><DriverDocumentsPage /></RequireRole>} />
      <Route path="/driver/dashboard" element={<Navigate to="/driver" replace />} />

      <Route path="/admin/login" element={<AuthPage key="admin" role="admin" />} />
      <Route path="/admin" element={<RequireRole role="admin"><AdminOverviewPage /></RequireRole>} />
      <Route path="/admin/rides" element={<RequireRole role="admin"><AdminRidesPage /></RequireRole>} />
      <Route path="/admin/drivers" element={<RequireRole role="admin"><AdminUsersPage key="driver" role="driver" /></RequireRole>} />
      <Route path="/admin/riders" element={<RequireRole role="admin"><AdminUsersPage key="customer" role="customer" /></RequireRole>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
