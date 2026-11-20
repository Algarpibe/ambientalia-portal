import { Suspense } from 'react';
import { lazyConReintento } from '../lib/lazyConReintento';
import { useProfile } from '../hooks/useProfile';
import RequireAuth from './RequireAuth';
import AppGuard from './AppGuard';
import ErrorBoundary from './ErrorBoundary';

// «Mis equipos» vive en su propio chunk (con las fuentes del tablero).
const MisEquipos = lazyConReintento(() => import('../../../equipos-taller/src/MisEquipos'));

const cargando = <p role="status">Cargando…</p>;

/**
 * Espera al perfil propio: sin él, la vista diría «No tienes equipos asignados» aunque los tenga. Manda el
 * nombre (para los equipos de Desk) y la cuenta (para los que el portal asignó a este usuario).
 */
function ConPerfil() {
  const { profile, loading } = useProfile();
  if (loading) return cargando;
  return <MisEquipos nombre={profile?.full_name ?? null} userId={profile?.id ?? null} />;
}

/**
 * `/equipos-taller/mis-equipos`: vista móvil de solo lectura, FUERA del shell (sin barra lateral ni
 * superior). Requiere sesión y la app «equipos-taller»; el nombre y el id salen de `GET /api/users/me`.
 */
export default function RutaMisEquipos() {
  return (
    <RequireAuth>
      <AppGuard appId="equipos-taller">
        <ErrorBoundary>
          <Suspense fallback={cargando}>
            <ConPerfil />
          </Suspense>
        </ErrorBoundary>
      </AppGuard>
    </RequireAuth>
  );
}
