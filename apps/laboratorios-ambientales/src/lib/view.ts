// Cada vista vive en el hash de la URL (#buscador, #marcas) para poder enlazarla
// y para que el botón «atrás» del navegador funcione. Hash y no subrutas: la app
// no depende de react-router y arranca también suelta en `vite dev`, igual que
// hace Ausencias con su #bandeja.
export type View = 'main' | 'buscador' | 'dashboard';

// 'dashboard' se publica como #marcas: es el nombre que ve el usuario
// («Análisis de Marcas») y el que tendrá el enlace que comparta.
const HASHES: Record<Exclude<View, 'main'>, string> = {
  buscador: 'buscador',
  dashboard: 'marcas',
};

export function parseView(hash: string): View {
  const limpio = hash.replace(/^#/, '').trim().toLowerCase();
  const encontrada = (Object.keys(HASHES) as Exclude<View, 'main'>[]).find((view) => HASHES[view] === limpio);
  return encontrada ?? 'main';
}

export function hashFor(view: View): string {
  return view === 'main' ? '' : `#${HASHES[view]}`;
}
