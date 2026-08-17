import { useEffect, useState } from 'react';
import { fetchPendientes } from '../api';
import { resumirPendientes, type ResumenPendientes } from './resumirPendientes';
import Mensaje from './Mensaje';

// Widget del Dashboard del Portal. Autocontenido a la fuerza: el contrato de
// WidgetDescriptor no le pasa props, así que carga su propio dato. El Portal lo
// envuelve en Suspense + ErrorBoundary.

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo'; resumen: ResumenPendientes };

/** Mínimo entre recargas al volver a la pestaña. */
const REFRESCO_MS = 60_000;

export default function WidgetPendientes() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    let vivo = true;
    let ultimaCarga = 0;

    const cargar = () => {
      ultimaCarga = Date.now();
      const intento = ultimaCarga;
      fetchPendientes()
        .then((solicitudes) => {
          // `intento !== ultimaCarga`: si una recarga adelantó a esta respuesta,
          // la vieja no puede pisar a la nueva con un recuento rancio.
          if (!vivo || intento !== ultimaCarga) return;
          setEstado({ fase: 'listo', resumen: resumirPendientes(solicitudes, new Date()) });
        })
        // `mensajeDeError` (dentro de `fetchPendientes`) ya distingue 401 y 403 del
        // resto: el token vive en localStorage y una pestaña puede llevar horas
        // abierta, así que decir «no se pudo cargar» cuando lo que pasa es que
        // caducó la sesión manda a la persona a recargar en vez de a volver a entrar.
        .catch((e) => {
          if (!vivo || intento !== ultimaCarga) return;
          setEstado({
            fase: 'error',
            mensaje: e instanceof Error ? e.message : 'No se pudo cargar tu bandeja.',
          });
        });
    };

    cargar();

    // Un dashboard se queda abierto toda la mañana y este número envejece mal.
    // Volver al navegador tras leer el correo es justo cuando ha llegado una
    // solicitud nueva, así que el foco es la señal correcta; con la pestaña
    // oculta no se gasta ni una llamada. Se escuchan las dos señales porque no
    // son lo mismo: si alguien lee el correo en OTRA ventana sin ocultar esta,
    // `visibilitychange` no dispara, solo `focus`.
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultimaCarga > REFRESCO_MS) cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);

    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, []);

  if (estado.fase === 'cargando') return <Mensaje>Cargando…</Mensaje>;
  if (estado.fase === 'error') return <Mensaje tono="error">{estado.mensaje}</Mensaje>;

  const { total, esperaDias } = estado.resumen;
  // Sin botón a propósito: no hay ninguna urgencia a la que mandar a nadie.
  if (total === 0) return <Mensaje>Nada pendiente de firmar.</Mensaje>;

  const frase = total === 1 ? '1 solicitud espera tu firma' : `${total} solicitudes esperan tu firma`;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
      {/* El número y su etiqueta son UNA frase para un lector de pantalla: sueltos
          se leen «3» y luego «solicitudes», que no es lo que enseña la tarjeta. */}
      <span className="sr-only">{esperaDias === null ? `${frase}.` : `${frase}. ${lineaDeEspera(esperaDias)}.`}</span>
      <span aria-hidden="true" className="text-4xl font-bold leading-none tabular-nums text-blue-600">
        {total}
      </span>
      <span aria-hidden="true" className="text-sm text-gray-500">
        {total === 1 ? 'solicitud' : 'solicitudes'}
      </span>
      {esperaDias !== null && (
        <span aria-hidden="true" className="mt-1 text-xs text-gray-500">
          {lineaDeEspera(esperaDias)}
        </span>
      )}
      {/* Un <a> de verdad, no navegación de React Router: `apps/ausencias` no
          depende de react-router y arranca también suelta en `vite dev`, sin
          Router, donde un useNavigate reventaría. El `#bandeja` lo lee App.tsx
          al arrancar para aterrizar en la bandeja y no en el formulario. */}
      <a
        href="/ausencias#bandeja"
        className="mt-2 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
      >
        Ir a firmar <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

/**
 * La frase se arma en una plantilla y no en JSX con etiquetas anidadas: en este
 * repo un salto de línea entre texto y etiqueta ya se comió un espacio una vez
 * («persona.Quién»), y aquí no hay nada que ganar arriesgándolo.
 *
 * «1 día», nunca «1 días»: la concordancia acaba de fallar en el aviso de saldo.
 */
function lineaDeEspera(dias: number): string {
  if (dias === 0) return 'La más antigua llegó hoy';
  return `La más antigua lleva ${dias} ${dias === 1 ? 'día' : 'días'} esperando`;
}
