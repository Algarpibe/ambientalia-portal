/**
 * DocumentoNúmero persistente (§8.1). Lo puro de la numeración: en qué orden reciben su número
 * las OV que todavía no lo tienen. La parte de BD está en documento-numero.repo.ts.
 */

const NUMERO_OV = /^OV-(\d{4})-(\d+)$/i;

function clave(numeroOV: string): readonly [number, number] | null {
  const m = NUMERO_OV.exec(numeroOV.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function porTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orden de asignación: por año y consecutivo NUMÉRICOS de "OV-AAAA-XXX" (la OV-2026-999 antes que
 * la OV-2026-1000), para que en un lote la OV-2026-213 reciba su número antes que la 214. Lo que
 * no cumpla el patrón va al final, en orden de texto. Devuelve un arreglo nuevo.
 */
export function ordenarParaAsignar(numerosOV: readonly string[]): string[] {
  return [...numerosOV].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1] || porTexto(a, b);
    if (ka) return -1;
    if (kb) return 1;
    return porTexto(a, b);
  });
}

/**
 * Números de las OV que SÍ emiten filas (al menos una línea), en el orden de entrada. Una OV sin
 * líneas no llega a World Office, así que no consume número: lo recibe la primera vez que aparece
 * con líneas. Puede traer repetidos; el repo los deduplica.
 */
export function numerosANumerar(ordenes: readonly { numero: string; lineas: readonly unknown[] }[]): string[] {
  return ordenes.filter((o) => o.lineas.length > 0).map((o) => o.numero);
}
