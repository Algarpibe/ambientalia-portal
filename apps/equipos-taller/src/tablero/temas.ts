// Tokens de color del tablero (única fuente) y el CSS de los temas. Los componentes y tablero.css
// solo usan `var(--tt-*)`; aquí viven todos los colores. Si un par no cumple el contraste,
// se cambia el valor del token, nunca el umbral.

export type Tema = 'dia' | 'noche';
export type Token = keyof typeof NOCHE;

const NOCHE = {
  fondo: '#0B0F14', kpi: '#151B22', 'kpi-borde': '#151B22', columna: '#11171D', tarjeta: '#1A2129',
  'tarjeta-borde': '#1A2129', sombra: 'none', divisor: '#27313C', 'vacio-borde': '#2A3440',
  tx1: '#E6EDF3', tx2: '#C9D3DD', cuerpo: '#C9D3DD', atenuado: '#AEB9C5', tenue: '#9AA7B4', 'tx-vacio': '#8592A0',
  'est-entrada': '#CBD5E1', 'est-diagnostico': '#60A5FA', 'est-notificacion': '#FBBF24', 'est-proceso': '#A78BFA',
  'est-externo': '#22D3EE', 'est-entregar': '#4ADE80', 'tx-estado': '#0B0F14',
  'dias-verde': '#4ADE80', 'dias-ambar': '#FBBF24', 'dias-rojo': '#F87171',
  'tx-dias-verde': '#0B0F14', 'tx-dias-ambar': '#0B0F14', 'tx-dias-rojo': '#0B0F14',
  etiqueta: '#3A2E12', 'tx-etiqueta': '#FCD34D', 'sin-asignar': '#F87171',
  'kpi-ambar': '#FBBF24', 'kpi-rojo': '#F87171', 'kpi-verde': '#4ADE80',
  'av-0': '#60A5FA', 'av-1': '#C4B5FD', 'av-2': '#F9A8D4', 'av-3': '#FDBA74', 'av-4': '#5EEAD4', 'av-5': '#BEF264', 'tx-av': '#0B0F14',
} as const;

const DIA: Record<Token, string> = {
  fondo: '#FFFFFF', kpi: '#F3F5F8', 'kpi-borde': '#E2E8F0', columna: '#F3F5F8', tarjeta: '#FFFFFF',
  'tarjeta-borde': '#DCE3EA', sombra: '0 1px 3px rgba(15,23,42,.08)', divisor: '#E5E9EE', 'vacio-borde': '#CBD5E1',
  tx1: '#111827', tx2: '#1F2937', cuerpo: '#374151', atenuado: '#4B5563', tenue: '#4B5563', 'tx-vacio': '#4B5563',
  'est-entrada': '#475569', 'est-diagnostico': '#2563EB', 'est-notificacion': '#B45309', 'est-proceso': '#7C3AED',
  'est-externo': '#0E7490', 'est-entregar': '#15803D', 'tx-estado': '#FFFFFF',
  'dias-verde': '#15803D', 'dias-ambar': '#F59E0B', 'dias-rojo': '#DC2626',
  'tx-dias-verde': '#FFFFFF', 'tx-dias-ambar': '#111827', 'tx-dias-rojo': '#FFFFFF',
  etiqueta: '#FEF3C7', 'tx-etiqueta': '#92400E', 'sin-asignar': '#B91C1C',
  'kpi-ambar': '#B45309', 'kpi-rojo': '#DC2626', 'kpi-verde': '#15803D',
  'av-0': '#2563EB', 'av-1': '#7C3AED', 'av-2': '#BE185D', 'av-3': '#C2410C', 'av-4': '#0F766E', 'av-5': '#4D7C0F', 'tx-av': '#FFFFFF',
};

export const TEMAS: Record<Tema, Record<Token, string>> = { dia: DIA, noche: NOCHE };

// ---------- Contraste (WCAG) ----------
const luz = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contraste = (a: string, b: string): number => {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

export interface ParTexto { fg: Token; bg: Token; /** Tamaño del texto en px (desde 24 basta 3:1). */ px: number }

const par = (fg: Token, bgs: Token[], px: number): ParTexto[] => bgs.map((bg) => ({ fg, bg, px }));
const ESTADOS: Token[] = ['est-entrada', 'est-diagnostico', 'est-notificacion', 'est-proceso', 'est-externo', 'est-entregar'];
const AVATARES: Token[] = ['av-0', 'av-1', 'av-2', 'av-3', 'av-4', 'av-5'];

/** Todos los pares texto/fondo que usa el tablero. */
export const PARES_TEXTO: readonly ParTexto[] = [
  ...par('tx1', ['fondo', 'kpi', 'columna', 'tarjeta'], 24),
  ...par('tx2', ['fondo', 'tarjeta'], 20),
  ...par('cuerpo', ['fondo', 'tarjeta'], 18),
  ...par('atenuado', ['fondo', 'kpi', 'columna', 'tarjeta'], 18),
  ...par('tenue', ['columna', 'tarjeta'], 16),
  ...par('tx-vacio', ['columna'], 20),
  ...par('tx-estado', ESTADOS, 22),
  ...par('tx-dias-verde', ['dias-verde'], 20),
  ...par('tx-dias-ambar', ['dias-ambar'], 20),
  ...par('tx-dias-rojo', ['dias-rojo'], 20),
  ...par('tx-etiqueta', ['etiqueta'], 16),
  ...par('sin-asignar', ['tarjeta'], 18),
  ...par('kpi-ambar', ['kpi'], 48), ...par('kpi-rojo', ['kpi'], 48), ...par('kpi-verde', ['kpi'], 48),
  ...AVATARES.flatMap((bg) => par('tx-av', [bg], 15)),
];

export interface Violacion { par: string; razon: number; minimo: number }

/** Pares que no llegan a 4,5:1 (3:1 desde 24 px) con los colores de `tokens`. */
export function violaciones(tokens: Record<Token, string>, pares: readonly ParTexto[] = PARES_TEXTO): Violacion[] {
  return pares.flatMap((p) => {
    const razon = contraste(tokens[p.fg], tokens[p.bg]);
    const minimo = p.px >= 24 ? 3 : 4.5;
    return razon < minimo ? [{ par: p.fg + ' sobre ' + p.bg, razon, minimo }] : [];
  });
}

// ---------- CSS ----------
const RAIZ = '.tt-tablero';
const variables = (t: Tema): string => Object.entries(TEMAS[t]).map(([k, v]) => `--tt-${k}:${v}`).join(';');

/** CSS de los temas, acotado a la raíz del tablero (no toca :root ni el resto del portal). */
export function cssTemas(): string {
  return [
    `${RAIZ}[data-tema="dia"]{${variables('dia')}}`,
    `${RAIZ}[data-tema="noche"]{${variables('noche')}}`,
    `${RAIZ}[data-tema="sistema"]{${variables('dia')}}`,
    `@media (prefers-color-scheme: dark){${RAIZ}[data-tema="sistema"]{${variables('noche')}}}`,
    `${RAIZ}{transition:background-color 400ms ease,color 400ms ease,border-color 400ms ease}`,
    `@media (prefers-reduced-motion: reduce){${RAIZ},${RAIZ} *{transition:none}}`,
  ].join('\n');
}
