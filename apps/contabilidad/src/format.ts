// Formateadores compartidos (@suite/format, cierra AI-613). Se conserva este
// módulo como fachada para no tocar los imports `./format` de la app.
import { formatCOP } from '@suite/format';
export { formatCOP, formatPct } from '@suite/format';

/**
 * Importe en su moneda. Hay pagos en USD y EUR, y formatearlos con formatCOP los pintaría
 * como pesos. Un código que Intl no reconoce no tumba la pantalla: se muestra tal cual.
 */
export function formatMoneda(n: number, moneda: string): string {
  if (moneda === 'COP') return formatCOP(n);
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${moneda} ${n}`;
  }
}
