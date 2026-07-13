import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { notify } from '../lib/notify';

// Guard de ruta por aplicación (Req 4.5): si `appId` no está en las apps
// asignadas del JWT, redirige a / y muestra una notificación de acceso no
// autorizado. La verificación real de permisos vive en el backend; esto es UX.

function DeniedRedirect() {
  // Emite el aviso en un efecto (no en render) para no duplicarlo ni provocar
  // efectos durante el renderizado; luego redirige a inicio.
  useEffect(() => {
    notify('No tienes acceso a esta aplicación.', 'error');
  }, []);
  return <Navigate to="/" replace />;
}

export default function AppGuard({ appId, children }: { appId: string; children: ReactNode }) {
  const { apps } = useAuth();
  if (!apps.includes(appId)) {
    return <DeniedRedirect />;
  }
  return <>{children}</>;
}
