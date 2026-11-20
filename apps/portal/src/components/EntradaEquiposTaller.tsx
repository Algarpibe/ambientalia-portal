import { useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/** Celular = pantalla de menos de 768 px (D2). Algunos navegadores viejos (y jsdom) no traen `matchMedia`. */
const esPantallaDeCelular = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;

/**
 * D1–D3: se entra por la raíz de la app, sin `?vista=` y desde un celular. Con `?vista=` (cualquier valor) manda la
 * dirección en cualquier ancho; una subruta tampoco salta. No se exporta: el fichero solo exporta el componente
 * (regla `react-refresh/only-export-components`), y sus pruebas lo cubren a través de él.
 */
const vaAMisEquipos = (pathname: string, search: string): boolean =>
  pathname.replace(/\/+$/, '') === '/equipos-taller' && !new URLSearchParams(search).has('vista') && esPantallaDeCelular();

/**
 * Entrada de `/equipos-taller/*` dentro del shell (va dentro del `AppGuard`). En el celular abre «Mis equipos» con el
 * router del portal, sin recargar la página. `replace` sustituye la entrada del historial: «Atrás» vuelve a donde
 * estaba el usuario. Decide UNA vez, al montar: girar el teléfono después no mueve a nadie. Mientras salta no pinta
 * la app, así que ni descarga su chunk ni pide sus datos.
 */
export default function EntradaEquiposTaller({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const [salta] = useState(() => vaAMisEquipos(pathname, search));
  return salta ? <Navigate to="/equipos-taller/mis-equipos" replace /> : <>{children}</>;
}
