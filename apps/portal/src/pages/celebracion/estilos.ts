// Clases de Tailwind compartidas por las piezas de la invitación.

export const BOTON =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-[#E6E8EF] bg-white px-4 py-2.5 text-sm font-bold text-[#2B2D35] transition hover:-translate-y-0.5 hover:border-[#006699] hover:text-[#006699] disabled:cursor-not-allowed disabled:opacity-50';

export const BOTON_PRIMARIO =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006699] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#00527A] disabled:cursor-not-allowed disabled:opacity-50';

/** Botón grande con el degradado de la marca (el fondo va en `style`). */
export const BOTON_ESPECTRO =
  'w-full rounded-2xl px-6 py-4 text-base font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60';

export const CAMPO =
  'w-full rounded-xl border-[1.5px] border-[#E6E8EF] bg-white px-3.5 py-3 text-base text-[#1F2229] focus:border-[#006699] focus:outline-none focus:ring-2 focus:ring-[#006699]/30';

/** Botón de elección (Sí voy / No podré ir). */
export function opcion(activa: boolean): string {
  return `rounded-2xl border-2 px-4 py-4 text-base font-bold transition ${
    activa ? 'border-[#008556] bg-[#008556]/10 text-[#008556]' : 'border-[#E6E8EF] bg-white text-[#3E4352] hover:border-[#CBD2E1]'
  }`;
}
