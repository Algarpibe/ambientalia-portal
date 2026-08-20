import { useEffect, useState } from 'react';
import { fetchMisSaldos, type SaldoCompensatorios, type SaldoVacaciones } from '../api';
import IndicadorSaldo from '../IndicadorSaldo';
import Mensaje from './Mensaje';

// Widget del Dashboard del Portal. Autocontenido a la fuerza: el contrato de
// WidgetDescriptor no le pasa props, así que carga su propio dato. El Portal lo
// envuelve en Suspense + ErrorBoundary.
//
// Enseña las DOS bolsas, y cuál se pinta lo decide `IndicadorSaldo`: aquí solo
// se resuelve si hay algo que enseñar. Repartir esa decisión sería la forma de
// que el dashboard y la app acabaran diciendo números distintos.

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo'; saldo: SaldoVacaciones | null; compensatorios?: SaldoCompensatorios | null };

export default function WidgetSaldo() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    let vivo = true;
    fetchMisSaldos()
      .then(({ saldo, compensatorios }) => vivo && setEstado({ fase: 'listo', saldo, compensatorios }))
      // `mensajeDeError` (dentro de `fetchMisSaldos`) ya distingue 401 de 403 del
      // resto: decirle a alguien «no se pudo cargar» cuando lo que pasa es que
      // caducó su sesión —el token vive en localStorage y una pestaña puede
      // llevar horas abierta— le hace perder el tiempo en vez de mandarlo a
      // volver a entrar.
      .catch(
        (e) =>
          vivo &&
          setEstado({ fase: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo cargar tu saldo.' }),
      );
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.fase === 'cargando') return <Mensaje>Cargando…</Mensaje>;
  if (estado.fase === 'error') return <Mensaje tono="error">{estado.mensaje}</Mensaje>;
  // `null` (sin ficha) y `configurado: false` caen juntos a propósito: en los dos
  // casos no hay número que enseñar. Y nunca un 0,0 en grande — se leería como
  // «no me quedan días», que no es lo mismo que «nadie ha fijado tu punto de
  // partida», y hoy le pasa a una decena de personas de verdad.
  //
  // Basta con que UNA de las dos bolsas esté configurada: lo contrario dejaría el
  // widget en blanco a quien tenga vacaciones y todavía no compensatorios, que el
  // día del despliegue es absolutamente todo el mundo.
  if (!estado.saldo?.configurado && !estado.compensatorios?.configurado) {
    return <Mensaje>Todavía sin configurar. Habla con administración.</Mensaje>;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <IndicadorSaldo saldo={estado.saldo} compensatorios={estado.compensatorios} variante="widget" />
      {/* Un <a> de verdad, no navegación de React Router: `apps/ausencias` no
          depende de react-router y arranca también suelta en `vite dev`, sin
          Router, donde un useNavigate reventaría. Recarga la SPA, a cambio de
          poder abrirse con ctrl+clic en otra pestaña. Sin parámetros: App.tsx
          arranca ya en la pestaña «nueva».

          «Pedir días» y no «Pedir vacaciones»: desde aquí se piden las dos cosas,
          y el ancho de 4×3 no da para nombrarlas. */}
      <a
        href="/ausencias"
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        Pedir días <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
