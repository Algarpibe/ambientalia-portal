import type { Prospecto } from './prospects';
import { sumarMeses } from './fechas';

// Cruce de los prospectos con Zoho Books por NIT. Ver
// docs/superpowers/specs/2026-11-26-prospectos-cruce-zoho-design.md.

export type EstadoCliente = 'activo' | 'antiguo' | 'sin-compras' | 'no-en-zoho' | 'sin-nit';

/** Lo que hub-api devuelve de cada NIT: solo fechas AAAA-MM-DD. */
export type HechosZoho = {
  ultimaFactura: string | null;
  ocmaVendido: string | null;
  ultimosRepuestos: string | null;
};

/** El cruce, por NIT base. Un NIT que no está es «No está en Zoho». */
export type CruceZoho = ReadonlyMap<string, HechosZoho>;

/** Cómo va la consulta a hub-api. */
export type EstadoCruce = 'cargando' | 'listo' | 'error';

/** Lo que llegó de hub-api para una consulta concreta: el cruce, o null si falló. */
export type ResultadoCruce = { clave: string; cruce: CruceZoho | null };

/**
 * El estado de la consulta vigente. Un resultado de otra clave (otros NIT tras
 * un refresco, o un reintento) no vale: la vista vuelve a «cargando» y nunca
 * enseña un cruce viejo como si fuera el de ahora.
 */
export function estadoDelCruce(resultado: ResultadoCruce | null, clave: string): EstadoCruce {
  if (resultado === null || resultado.clave !== clave) return 'cargando';
  return resultado.cruce === null ? 'error' : 'listo';
}

// Sin facturarle en este tiempo, el cliente pasa de activo a antiguo.
export const MESES_CLIENTE_ACTIVO = 36;

export const ESTADOS_CLIENTE: readonly EstadoCliente[] = ['activo', 'antiguo', 'sin-compras', 'no-en-zoho', 'sin-nit'];

export const ETIQUETA_ESTADO_CLIENTE: Record<EstadoCliente, string> = {
  activo: 'Cliente activo',
  antiguo: 'Cliente antiguo',
  'sin-compras': 'En Zoho sin compras',
  'no-en-zoho': 'No está en Zoho',
  'sin-nit': 'Sin NIT',
};

/**
 * NIT base, la misma regla que hub-api (apps/hub-api/src/laboratorios/
 * clientes.ts): lo de antes del primer «-», solo dígitos, de 6 a 10.
 * `900.241.439-8` da `900241439`. Un NIT que no vale no se envía: hub-api
 * rechazaría la petición entera. Si cambias esta regla, cambia también la de
 * hub-api y las pruebas de las dos.
 */
export function nitBase(nit: string): string | null {
  const digitos = nit.split('-')[0].replace(/\D/g, '');
  return digitos.length >= 6 && digitos.length <= 10 ? digitos : null;
}

export function hechosDe(nit: string, cruce: CruceZoho): HechosZoho | null {
  const base = nitBase(nit);
  return base === null ? null : (cruce.get(base) ?? null);
}

/**
 * El estado comercial del laboratorio. «Activo» si la última factura cae en los
 * últimos 36 meses de calendario, con el límite incluido: con hoy 2026-11-26,
 * una factura del 2023-11-26 todavía cuenta.
 * `hoy` va en AAAA-MM-DD (hoyLocal); con otro formato el límite sale mal.
 */
export function estadoCliente(nit: string, cruce: CruceZoho, hoy: string): EstadoCliente {
  const base = nitBase(nit);
  if (base === null) return 'sin-nit';
  const hechos = cruce.get(base);
  if (!hechos) return 'no-en-zoho';
  // == y no ===: si hub-api dejara de enviar el campo, sería «sin compras» y no «antiguo».
  if (hechos.ultimaFactura == null) return 'sin-compras';
  // Las fechas son AAAA-MM-DD: comparar como texto es comparar como fecha.
  return hechos.ultimaFactura >= sumarMeses(hoy, -MESES_CLIENTE_ACTIVO) ? 'activo' : 'antiguo';
}

/** Los NIT base que se envían a hub-api: sin repetir y ordenados. */
export function nitsParaConsultar(prospectos: Prospecto[]): string[] {
  const nits = new Set<string>();
  for (const prospecto of prospectos) {
    const base = nitBase(prospecto.nit);
    if (base !== null) nits.add(base);
  }
  return [...nits].sort();
}

/** Sin estado elegido, o sin cruce (cargando o con error), no filtra. */
export function filtrarPorCliente(
  prospectos: Prospecto[],
  estado: EstadoCliente | '',
  cruce: CruceZoho | null,
  hoy: string,
): Prospecto[] {
  if (estado === '' || cruce === null) return prospectos;
  return prospectos.filter((prospecto) => estadoCliente(prospecto.nit, cruce, hoy) === estado);
}
