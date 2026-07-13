import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// Guard del Panel de Administración (Req 5.1, 5.2, 5.3):
//  - Sin sesión           → /auth
//  - Autenticado no-admin  → /  (incluye reader y roles desconocidos)
//  - admin                 → renderiza children
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  if (role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
