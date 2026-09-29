import { useCallback, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { api } from './api';
import { ROLE_LABEL } from './lib/domain';
import { buildHash, CALIBRATION_TYPES, parseHash, type Route } from './lib/hash';
import type { Me } from './types';
import { Alert, Badge, Loading } from './ui';
import O3Tab from './o3/O3Tab';

/**
 * Calibraciones app. Top-level tabs are calibration TYPES (hash `#<type>/...`);
 * the first and only one today is the O3 transfer-standard verification. A new
 * type adds an entry to CALIBRATION_TYPES (lib/hash.ts) and its own tab
 * component here.
 */
export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => alive && setMe(m))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const navigate = useCallback((r: Route, replace = false) => {
    const hash = buildHash(r);
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
    setRoute(r);
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <main className="min-w-0 flex-grow bg-transparent p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <Gauge className="h-7 w-7 text-blue-600" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Calibraciones</h1>
            <p className="max-w-2xl text-sm text-gray-500">
              Cálculo, evaluación y registro de verificaciones de patrones, con trazabilidad ISO/IEC 17025.
            </p>
          </div>
        </div>
        {me && (
          <div className="text-right text-sm text-gray-600">
            <Badge tone={me.role === 'LECTOR' ? 'gray' : 'blue'}>{ROLE_LABEL[me.role]}</Badge>
            <p className="mt-1 text-xs text-gray-500">{me.email}</p>
          </div>
        )}
      </header>

      {error && <Alert tone="red">{error}</Alert>}
      {!me && !error && <Loading />}

      {me && (
        <>
          <nav aria-label="Tipos de calibración" className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
            {CALIBRATION_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={route.type === t.id ? 'page' : undefined}
                onClick={() => navigate({ type: t.id, section: 'equipos', id: null })}
                className={`-mb-px min-h-[44px] border-b-2 px-4 py-2 text-sm transition-colors ${
                  route.type === t.id ? 'border-blue-500 font-semibold text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {route.type === 'o3' && <O3Tab me={me} route={route} navigate={navigate} />}
        </>
      )}
    </main>
  );
}
