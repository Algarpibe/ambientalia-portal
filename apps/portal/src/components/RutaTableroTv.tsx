import { Suspense } from 'react';
import { lazyConReintento } from '../lib/lazyConReintento';
import RequireAuth from './RequireAuth';
import AppGuard from './AppGuard';
import ErrorBoundary from './ErrorBoundary';

// La TV del taller vive en su propio chunk (con las fuentes del tablero).
const TvEquipos = lazyConReintento(() => import('../../../equipos-taller/src/TvEquipos'));

/**
 * `/equipos-taller/tv`: pantalla completa, FUERA del shell (sin barra lateral ni superior). Hoy entra con
 * la sesión del portal; sin sesión redirige al login y sin la app al inicio, sin pedir ningún dato.
 * El meta `referrer` evita que el navegador envíe la URL de la pantalla a otros sitios.
 */
export default function RutaTableroTv() {
  return (
    <RequireAuth>
      <AppGuard appId="equipos-taller">
        <meta name="referrer" content="no-referrer" />
        <ErrorBoundary>
          <Suspense fallback={<p role="status">Cargando tablero…</p>}>
            <TvEquipos />
          </Suspense>
        </ErrorBoundary>
      </AppGuard>
    </RequireAuth>
  );
}
