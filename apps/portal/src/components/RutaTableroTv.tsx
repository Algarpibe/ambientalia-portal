import { Suspense } from 'react';
import { lazyConReintento } from '../lib/lazyConReintento';
import RequireAuth from './RequireAuth';
import AppGuard from './AppGuard';
import ErrorBoundary from './ErrorBoundary';
import { leerTokenKiosco } from '../../../equipos-taller/src/api';

// La TV del taller vive en su propio chunk (con las fuentes del tablero).
const TvEquipos = lazyConReintento(() => import('../../../equipos-taller/src/TvEquipos'));

/**
 * `/equipos-taller/tv`: pantalla completa, FUERA del shell (sin barra lateral ni superior). Entra con
 * la sesión del portal, o sin ella con la llave de kiosco del fragmento; sin sesión redirige al login y sin la app al inicio, sin pedir ningún dato.
 * El meta `referrer` evita que el navegador envíe la URL de la pantalla a otros sitios.
 */
export default function RutaTableroTv() {
  const pantalla = (
    <>
      <meta name="referrer" content="no-referrer" />
      <ErrorBoundary>
        <Suspense fallback={<p role="status">Cargando tablero…</p>}>
          <TvEquipos />
        </Suspense>
      </ErrorBoundary>
    </>
  );
  // Con la llave de kiosco en el fragmento (`#k=`) la TV no tiene sesión: la llave es la credencial y el
  // servidor la comprueba; una llave inválida solo muestra el aviso de acceso, sin datos.
  if (leerTokenKiosco()) return pantalla;
  return (
    <RequireAuth>
      <AppGuard appId="equipos-taller">{pantalla}</AppGuard>
    </RequireAuth>
  );
}
