import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../auth';
import AceptacionTerminos from './AceptacionTerminos';

// Envuelve las rutas protegidas: sin sesión válida → redirige a /auth. Con sesión,
// pasa por la aceptación de las condiciones de uso antes de pintar nada protegido:
// así la pantalla cubre el portal, la TV del taller y «Mis equipos», que son las
// tres rutas que usan este guardia.
export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  if (!isAuthenticated()) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }
  return <AceptacionTerminos>{children}</AceptacionTerminos>;
}
