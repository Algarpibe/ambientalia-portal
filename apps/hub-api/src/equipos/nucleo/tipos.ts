// Tipos del módulo «Equipos en Ambientalia».
// Las claves cortas (d, c, sn, est…) se conservan porque son las que ya están guardadas
// en la base de la página de Claude y en equipos.estado; cambiarlas obligaría a migrar datos.

/** Archivo o carpeta de Google Drive, tal como lo lista la fuente. */
export interface ArchivoDrive {
  id: string;
  title: string;
}

/** Carpeta «AAMMDD - Cliente - S/N» (entrada o salida generada por n8n). */
export interface Entrada {
  id: string;
  /** Fecha AAAA-MM-DD tomada del nombre. */
  d: string;
  /** Cliente. */
  c: string;
  /** Serial tal como está en el nombre de la carpeta. */
  sn: string;
}

/** Ítem de una remisión escaneada: lo que dice la fila del serial y el ticket que trae. */
export interface ItemEscaneo {
  e: string;
  k: string;
}

/** Texto útil de un PDF de REMISIONES 2026\SALIDA (caché: no se vuelve a leer el PDF). */
export interface Escaneo {
  id: string;
  /** Nombre del archivo. */
  n: string;
  /** Fecha del nombre (AAAA-MM-DD) o "" si no tiene. */
  d: string;
  /** Seriales y códigos encontrados, en clase OCR (ver cls). */
  t: string[];
  /** Detalle por serial. */
  it: Record<string, ItemEscaneo>;
}

export interface CacheEscaneos {
  v: number;
  list: Escaneo[];
}

/** Ticket tal como lo entrega la API de Zoho Desk (o el espejo de Desk 2.0 con la misma forma). */
export interface TicketZoho {
  id?: string;
  ticketNumber: string | number;
  status?: string;
  statusType?: string;
  createdTime?: string;
  closedTime?: string | null;
  modifiedTime?: string;
  subject?: string;
  webUrl?: string;
  cf?: Record<string, string | null | undefined>;
}

/** Ticket normalizado. */
export interface Ticket {
  /** Número. */
  n: string;
  id: string;
  st: string;
  stt: string;
  /** Creado, cerrado (AAAA-MM-DD). */
  ct: string;
  cl: string;
  /** Última modificación (ISO completo). */
  m: string;
  u: string;
  /** Fecha Remisión Entrada, Fecha Remisión de Salida, Fecha Finalización ST. */
  fe: string;
  fs: string;
  ff: string;
  /** Salida a servicio externo y regreso. */
  xo: string;
  xi: string;
  /** Fecha del código de servicio. */
  cd: string;
  enc: string;
  eq: string;
  srv: string;
  /** Seriales del ticket en clase OCR. */
  tk: string[];
  /** Cómo se enlazó con la entrada. */
  lw?: string;
}

/** Ticket reducido que se guarda en cada fila. */
export type TicketFila = Pick<Ticket, "n" | "id" | "st" | "stt" | "u" | "m" | "enc" | "eq" | "srv" | "fs" | "cl">;

export interface ComentarioZoho {
  commentedTime: string;
  content: string;
  attachments?: { name: string }[];
}

export interface EvidenciaComentario {
  d: string;
  q: string;
}

/** Salida escaneada dentro de la ventana de una entrada. */
export interface EscaneoVisita {
  id: string;
  n: string;
  d: string;
  ext: boolean;
  part: boolean;
  e: string;
  tkt: string;
}

export interface Visita extends Entrada {
  /** Serial en clase OCR. */
  k: string;
  /** Carpetas repetidas. */
  dup: string[];
  /** Fecha de la siguiente entrada del mismo serial. */
  next: string | null;
  sc: EscaneoVisita[];
  /** Si se consulta Zoho para esta entrada. */
  q: boolean;
  z: Ticket | null;
  kRem?: string;
  extra?: Ticket[];
}

export const EST = {
  TALLER: "En taller",
  EXTERNO: "Servicio externo",
  REVISAR: "Revisar",
  CERRADO: "Ticket cerrado sin salida",
  ENTREGADO: "Entregado",
  RETIRADO: "Retirado",
} as const;
export type Estado = (typeof EST)[keyof typeof EST];

export interface SalidaParcial {
  d: string;
  n: string;
  id: string;
  q: string;
  k: string;
}

/** Evidencia que respalda el estado: PDF, carpeta o texto. */
export interface Evidencia {
  n: string;
  id?: string;
  fo?: string;
  q?: string;
}

export interface Clasificacion {
  est: Estado;
  src: string;
  why: string[];
  x: Evidencia | null;
  z: Ticket | null;
  pa: SalidaParcial[];
  xd: string;
}

/** Una fila de la pantalla: una entrada de un equipo. */
export interface Fila {
  id: string;
  d: string;
  c: string;
  sn: string;
  est: Estado;
  src: string;
  why: string[];
  x: Evidencia | null;
  z: TicketFila | null;
  /** Ticket cerrado. */
  zc: boolean;
  pa: SalidaParcial[];
  /** Fecha de salida. */
  xd: string;
  /** Nombre del equipo tomado de la remisión de entrada. */
  eq: string;
  /** Marcada por un ajuste manual (1 = de esta entrada, 2 = del serial). */
  man?: 1 | 2;
}

export interface EquipoPosible {
  sn: string;
  d: string;
  est: Estado;
  c: string;
}

/** Remisión escaneada ilegible o con fecha errada en el nombre. */
export interface Ilegible {
  id: string;
  n: string;
  d: string;
  m: string;
  q: string;
  p: EquipoPosible[];
}

/** Foto de la última actualización: lo que muestra la pantalla. */
export interface Foto {
  at: string;
  hoy: string;
  rows: Fila[];
  ilegibles?: Ilegible[];
}

export interface ComentariosCache {
  m: string;
  l: { d: string; t: string; a: string[] }[];
}

export interface RemisionEntrada {
  eq: string;
  srv: string;
  k: string;
}

/** Estado guardado entre actualizaciones. */
export interface EstadoModulo {
  snap: Foto | null;
  exits: CacheEscaneos | null;
  cmt: Record<string, ComentariosCache>;
  ent: Record<string, RemisionEntrada>;
}

/** De dónde salen los datos. Todas las funciones son de solo lectura. */
export interface Fuentes {
  entradas(): Promise<ArchivoDrive[]>;
  salidasGeneradas(): Promise<ArchivoDrive[]>;
  salidasEscaneadas(): Promise<ArchivoDrive[]>;
  textoPdf(id: string): Promise<string>;
  /** Tickets que mencionan el serial. Lista vacía si no hay; error solo si falla. */
  tickets(serial: string): Promise<TicketZoho[]>;
  comentarios(ticketId: string): Promise<unknown>;
  remisionEntrada?(carpetaId: string): Promise<string>;
  ticketNumero?(n: string): Promise<TicketZoho[]>;
}

export interface Resultado {
  snap: Foto;
  exits: CacheEscaneos;
  cmt: Record<string, ComentariosCache>;
  ent: Record<string, RemisionEntrada>;
  avisos: string[];
}

export interface OpcionesActualizar {
  prog?: (t: string) => void;
  msg?: (e: unknown) => string;
  /** AAAA-MM-DD; por defecto, hoy en Bogotá. */
  hoy?: string;
  paralelo?: number;
}

/** Ajuste manual guardado. Clave: «SERIAL|AAAA-MM-DD» (entrada), «*SERIAL» (todas las entradas) o «pdf:<id>» (remisión ilegible revisada). */
export interface Ajuste {
  t: "in" | "out" | "ret" | "pdf";
  m: string;
  at: string;
  /** Para «*SERIAL»: aplica a entradas hasta esta fecha. */
  d?: string;
}
export type Ajustes = Record<string, Ajuste>;

/** Última actualización registrada en equipos.ejecucion. */
export interface UltimaEjecucion {
  id: number;
  origen: string;
  inicio: string;
  fin: string | null;
  estado: string;
  avisos: string[];
  error: string | null;
}

/** Respuesta de GET /api/equipos. */
export interface EstadoPantalla {
  snap: Foto | null;
  ajustes: Ajustes;
  actualizando: boolean;
  ultima: UltimaEjecucion | null;
}
