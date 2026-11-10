/**
 * Lo que n8n («Equipos · Sincronizar remisiones») manda a hub-api con la copia de
 * Drive (§3.3 del diseño, revisión del 10/11/2026): las tres carpetas, los límites y la
 * validación estricta de los tres cuerpos. Puro, sin E/S: lo usan router-sync.ts
 * (validar) y repo-sync.ts (la regla del listado sospechoso).
 *
 * Los mensajes de error son fijos: nunca repiten lo recibido.
 */

export const CARPETAS = ['entradas', 'salidas_n8n', 'salidas_escaneadas'] as const;
export type Carpeta = (typeof CARPETAS)[number];

/** Forma de un id de archivo o carpeta de Drive (lo comprueba también la base). */
export const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
/** Id de una pasada: el de la ejecución de n8n (`{{ $execution.id }}`). */
export const ID_PASADA = /^[A-Za-z0-9_-]{1,64}$/;
/** Con nombres normales (unos 60 caracteres), 10 000 archivos son menos de 1 MB: caben en el límite de 2 MB de hub-api. */
export const MAX_ARCHIVOS = 10_000;
export const MAX_TITULO = 300;
/** Un texto más largo se recorta: una remisión ocupa unos pocos miles de caracteres. */
export const MAX_TEXTO = 200_000;
/** Un listado que borraría más archivos que esto, y más de la mitad de la carpeta, es sospechoso. */
export const UMBRAL_BAJAS = 10;

export interface ArchivoListado {
  id: string;
  titulo: string;
}
/** Lo que llega de un archivo: su texto o el código del fallo de ESE archivo. */
export type ResultadoTexto = { texto: string } | { status: number };
/** Archivos listados en cada carpeta, según n8n al terminar. */
export type ConteosFin = Record<Carpeta, number>;

export type Validado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** ¿Es un fallo de ESE archivo? Un 4xx que no sea del token (401) ni de la cuota (429). */
export function esStatusDeArchivo(s: unknown): s is number {
  return typeof s === 'number' && Number.isInteger(s) && s >= 400 && s <= 499 && s !== 401 && s !== 429;
}

/**
 * ¿Un listado que no hay que aplicar? Vacío cuando la carpeta tiene archivos, o que
 * borraría más de UMBRAL_BAJAS y más de la mitad: casi siempre es un fallo del flujo
 * (otra carpeta, un permiso perdido, páginas perdidas), y aplicarlo haría desaparecer equipos.
 */
export function listadoSospechoso(bajas: number, vivos: number, recibidos: number): boolean {
  return (recibidos === 0 && vivos > 0) || (bajas > UMBRAL_BAJAS && bajas * 2 > vivos);
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const soloClaves = (o: Record<string, unknown>, permitidas: readonly string[]) => Object.keys(o).every((k) => permitidas.includes(k));
/** Postgres no admite el carácter nulo en un texto. */
const sinNulos = (s: string) => s.replace(/\u0000/g, '');
const pasadaValida = (v: unknown): v is string => typeof v === 'string' && ID_PASADA.test(v);
const no = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validarListado(b: unknown): Validado<{ pasada: string; carpeta: Carpeta; archivos: ArchivoListado[] }> {
  if (!objeto(b) || !soloClaves(b, ['pasada', 'carpeta', 'archivos'])) return no('cuerpo no válido');
  if (!pasadaValida(b.pasada)) return no('pasada no válida');
  if (!CARPETAS.includes(b.carpeta as Carpeta)) return no('carpeta no válida');
  if (!Array.isArray(b.archivos) || b.archivos.length > MAX_ARCHIVOS) return no('archivos no válidos');
  const vistos = new Set<string>();
  const archivos: ArchivoListado[] = [];
  for (const a of b.archivos as unknown[]) {
    if (!objeto(a) || !soloClaves(a, ['id', 'titulo']) || typeof a.id !== 'string' || !ID_DRIVE.test(a.id)) return no('archivo no válido');
    if (typeof a.titulo !== 'string') return no('título no válido');
    // El nombre se guarda tal cual (el núcleo lo interpreta); solo se quitan los nulos.
    const titulo = sinNulos(a.titulo);
    if (!titulo.trim() || titulo.length > MAX_TITULO) return no('título no válido');
    if (vistos.has(a.id)) return no('id repetido');
    vistos.add(a.id);
    archivos.push({ id: a.id, titulo });
  }
  return { ok: true, valor: { pasada: b.pasada, carpeta: b.carpeta as Carpeta, archivos } };
}

export function validarTexto(b: unknown): Validado<{ id: string; resultado: ResultadoTexto }> {
  if (!objeto(b) || !soloClaves(b, ['id', 'texto', 'error'])) return no('cuerpo no válido');
  if (typeof b.id !== 'string' || !ID_DRIVE.test(b.id)) return no('id no válido');
  if (('texto' in b) === ('error' in b)) return no('hace falta texto o error, uno de los dos');
  if ('texto' in b) {
    if (typeof b.texto !== 'string') return no('texto no válido');
    return { ok: true, valor: { id: b.id, resultado: { texto: sinNulos(b.texto).slice(0, MAX_TEXTO) } } };
  }
  const e = b.error;
  if (!objeto(e) || !soloClaves(e, ['status']) || !esStatusDeArchivo(e.status)) return no('error no válido: status ha de ser un 4xx del archivo (ni 401 ni 429)');
  return { ok: true, valor: { id: b.id, resultado: { status: e.status as number } } };
}

export function validarFin(b: unknown): Validado<{ pasada: string; conteos: ConteosFin }> {
  if (!objeto(b) || !soloClaves(b, ['pasada', 'conteos'])) return no('cuerpo no válido');
  if (!pasadaValida(b.pasada)) return no('pasada no válida');
  const c = b.conteos;
  const entero = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  if (!objeto(c) || !soloClaves(c, CARPETAS) || !CARPETAS.every((k) => entero(c[k]))) return no('conteos no válidos: un entero por carpeta');
  const conteos = { entradas: c.entradas as number, salidas_n8n: c.salidas_n8n as number, salidas_escaneadas: c.salidas_escaneadas as number };
  return { ok: true, valor: { pasada: b.pasada, conteos } };
}
