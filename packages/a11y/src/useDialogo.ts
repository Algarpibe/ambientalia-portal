import { useEffect, useId, useRef } from 'react';

// FE-419 — comportamiento de teclado y foco compartido por los diálogos modales
// del portal y de las sub-apps. El marcado (role="dialog", aria-modal, aria-labelledby) lo pone
// cada componente con lo que devuelve el hook; aquí vive lo que no se ve:
//
// - Al abrir, el foco entra en el primer control del diálogo (o en el propio
//   diálogo si no tiene ninguno). Sin esto, quien navega con teclado o lector de
//   pantalla seguía en la página de detrás sin saber que algo se había abierto.
// - Escape cierra, salvo con `bloqueado` (p. ej. un guardado en vuelo: cerrar
//   ahí ocultaría el resultado de una petición que sigue corriendo).
// - Tab y Shift+Tab dan la vuelta dentro del diálogo en vez de escapar a la
//   página que aria-modal declara inerte.
// - Al cerrar (o desmontar), el foco vuelve al control que lo abrió, si sigue
//   en el documento; si desapareció (p. ej. el widget recién eliminado), se deja
//   donde el navegador lo ponga.
//
// `onCerrar` y `bloqueado` se leen por ref para que el efecto dependa solo de
// `abierto`: si se re-ejecutara en cada render, devolvería y robaría el foco
// cada vez que el componente padre cambia de estado.

const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface OpcionesDialogo {
  /** El diálogo está en pantalla. Por defecto true, para los que solo existen montados. */
  abierto?: boolean;
  onCerrar: () => void;
  /** Mientras sea true, Escape no cierra. */
  bloqueado?: boolean;
}

export function useDialogo<T extends HTMLElement = HTMLDivElement>({
  abierto = true,
  onCerrar,
  bloqueado = false,
}: OpcionesDialogo) {
  const ref = useRef<T>(null);
  const idTitulo = useId();
  const onCerrarRef = useRef(onCerrar);
  const bloqueadoRef = useRef(bloqueado);
  useEffect(() => {
    onCerrarRef.current = onCerrar;
    bloqueadoRef.current = bloqueado;
  });

  useEffect(() => {
    const dialogo = ref.current;
    if (!abierto || !dialogo) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const enfocables = () => Array.from(dialogo.querySelectorAll<HTMLElement>(ENFOCABLES));
    (enfocables()[0] ?? dialogo).focus();

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!bloqueadoRef.current) onCerrarRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables();
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (!dialogo.contains(activo)) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && (activo === primero || activo === dialogo)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alPulsar);
    return () => {
      document.removeEventListener('keydown', alPulsar);
      if (previo?.isConnected) previo.focus();
    };
  }, [abierto]);

  return { ref, idTitulo };
}
