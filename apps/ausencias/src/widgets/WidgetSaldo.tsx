import { useEffect, useState } from 'react';
import { fetchMiSaldo, type SaldoVacaciones } from '../api';
import IndicadorSaldo from '../IndicadorSaldo';

// Widget del Dashboard del Portal. Autocontenido a la fuerza: el contrato de
// WidgetDescriptor no le pasa props, así que carga su propio dato. El Portal lo
// envuelve en Suspense + ErrorBoundary.

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error' }
  | { fase: 'listo'; saldo: SaldoVacaciones | null };

export default function WidgetSaldo() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    let vivo = true;
    fetchMiSaldo()
      .then((saldo) => vivo && setEstado({ fase: 'listo', saldo }))
      .catch(() => vivo && setEstado({ fase: 'error' }));
    return () => {
      vivo = false;
    };
  }, []);

  if (estado.fase === 'cargando') return <Mensaje>Cargando…</Mensaje>;
  if (estado.fase === 'error') return <Mensaje tono="error">No se pudo cargar tu saldo.</Mensaje>;
  // `null` (sin ficha) y `configurado: false` caen juntos a propósito: en los dos
  // casos no hay número que enseñar. Y nunca un 0,0 en grande — se leería como
  // «no me quedan días», que no es lo mismo que «nadie ha fijado tu punto de
  // partida», y hoy le pasa a una decena de personas de verdad.
  if (!estado.saldo?.configurado) return <Mensaje>Todavía sin configurar. Habla con administración.</Mensaje>;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <IndicadorSaldo saldo={estado.saldo} variante="widget" />
      {/* Un <a> de verdad, no navegación de React Router: `apps/ausencias` no
          depende de react-router y arranca también suelta en `vite dev`, sin
          Router, donde un useNavigate reventaría. Recarga la SPA, a cambio de
          poder abrirse con ctrl+clic en otra pestaña. Sin parámetros: App.tsx
          arranca ya en la pestaña «nueva». */}
      <a
        href="/ausencias"
        className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        Pedir vacaciones →
      </a>
    </div>
  );
}

function Mensaje({ children, tono }: { children: React.ReactNode; tono?: 'error' }) {
  return (
    <div
      className={`flex h-full items-center justify-center px-3 text-center text-sm ${
        tono === 'error' ? 'text-red-500' : 'text-gray-400'
      }`}
    >
      {children}
    </div>
  );
}
