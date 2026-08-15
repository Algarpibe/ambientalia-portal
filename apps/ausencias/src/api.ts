import { authHeaders, esAdmin } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';

export { esAdmin };

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

// Espejo de apps/hub-api/src/ausencias/types.ts. Si cambia allí, cambia aquí.

export type TipoSolicitud = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad';
/** `pendiente_2` = el jefe inmediato ya firmó y falta su superior. */
export type EstadoSolicitud = 'pendiente' | 'pendiente_2' | 'aprobada' | 'rechazada' | 'registrada';

export interface Empleado {
  id: string;
  nombreCompleto: string;
  correo: string;
  cargo: string | null;
  credencial: number | null;
  /** El correo de su jefe inmediato: la única arista del organigrama. */
  aprobadorCorreo: string;
  /** A quién se pone en copia de sus correos. `null` = a nadie. */
  copiaCorreo: string | null;
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
  /** Si sus solicitudes necesitan la firma del jefe de su jefe, o basta una. */
  requiereSegundaFirma: boolean;
  userId: string | null;
  activo: boolean;
}

/** Un empleado del maestro con su posición en el árbol, derivada por hub-api. */
export interface EmpleadoConJefatura extends Empleado {
  segundoAprobadorCorreo: string | null;
  /** El de segundo nivel cuando NO firma. Excluyente con el de arriba. */
  informadoCorreo: string | null;
  enCiclo: boolean;
}

export interface Adjunto {
  id: string;
  nombreArchivo: string;
  mime: string;
  bytes: number;
}

export interface Solicitud {
  id: string;
  tipo: TipoSolicitud;
  empleadoId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  /** Decimal: el histórico de la hoja trae medios días (6,5). */
  diasHabiles: number;
  comentarios: string | null;
  /** Notas al margen de la hoja, y el PDF de las incapacidades antiguas. */
  observaciones: string | null;
  /** `hoja` = importada del histórico; `portal` = nacida en la app. */
  origen: 'portal' | 'hoja';
  estado: EstadoSolicitud;
  /** Quien firma primero, congelado en el alta. No rota al avanzar de nivel. */
  aprobadorCorreo: string | null;
  /** Quien firma después, congelado. `null` = una sola firma. */
  segundoAprobadorCorreo: string | null;
  /** Leído de la ficha al consultar, no congelado en el alta. */
  copiaCorreo: string | null;
  primeraFirmaAt: string | null;
  decididaAt: string | null;
  motivoRechazo: string | null;
  createdAt: string;
  adjunto: Adjunto | null;
}

export interface Contexto {
  empleado: Empleado | null;
  /** Nombre de quien le aprueba. Null si ese correo no tiene ficha de empleado. */
  aprobadorNombre: string | null;
  /** Puede abrir cualquier adjunto: admin, o estar en la lista de administración. */
  esVisorAdjuntos: boolean;
  /** El correo de la sesión, para poder decir cuál hay que dar de alta. */
  email: string;
  esAdmin: boolean;
  esAprobador: boolean;
  /** Festivos del año en curso y los dos siguientes, para contar días sin ir al servidor. */
  festivos: string[];
  /** Null si el usuario no tiene ficha de empleado, o si el cálculo del saldo falló. */
  saldo: SaldoVacaciones | null;
}

/** El saldo de vacaciones de una persona, ya calculado por hub-api. */
export interface SaldoVacaciones {
  /** False si nadie ha configurado todavía su punto de corte. */
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  devengadas: number;
  disfrutadas: number;
  /** Pendientes de aprobar. No bajan el saldo firme, pero sí el que se puede pedir. */
  enTramite: number;
  disponible: number;
}

export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
}

/** Un día del mes, con lo que hace falta para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada del calendario. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
}

export interface CalendarioDelMes {
  empleados: { id: string; nombreCompleto: string }[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

export interface NuevaSolicitud {
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  comentarios?: string;
  adjunto?: { nombreArchivo: string; mime: string; contenidoBase64: string };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

async function conCuerpo<T>(metodo: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown) => conCuerpo<T>('POST', path, body);
const patch = <T,>(path: string, body: unknown) => conCuerpo<T>('PATCH', path, body);
const put = <T,>(path: string, body: unknown) => conCuerpo<T>('PUT', path, body);

export const fetchContexto = () => get<Contexto>('/api/ausencias/contexto');

/**
 * Solo el saldo de quien pregunta. Lo usa el widget del dashboard, que no
 * necesita el resto del contexto —festivos de tres años incluidos— y lo cargaría
 * en cada visita a la home del portal.
 */
export const fetchMiSaldo = () =>
  get<{ saldo: SaldoVacaciones | null }>('/api/ausencias/mi-saldo').then((d) => d.saldo);

export const fetchMisSolicitudes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/mis-solicitudes').then((d) => d.solicitudes);

export const fetchPendientes = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/pendientes').then((d) => d.solicitudes);

export const crearSolicitud = (s: NuevaSolicitud) => post<Solicitud>('/api/ausencias/solicitudes', s);

export const decidirSolicitud = (id: string, aprueba: boolean, motivo?: string) =>
  post<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}/decision`, { aprueba, motivo });


/** Da de alta a todos los usuarios del portal que ya tienen la app asignada. */
export const sincronizarEmpleados = () =>
  post<{ creados: number; vinculados: number }>('/api/ausencias/empleados/sincronizar', {});

/** Una fila del Excel histórico, tal como la lee el navegador. */
export interface FilaHistorico {
  nombre: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  dias: number | string;
  comentarios?: string | null;
  adjunto?: string | null;
  observaciones?: string | null;
}

export interface ResumenImportacion {
  total: number;
  resueltas: number;
  importadas: number;
  yaExistian: number;
  sinResolver: string[];
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/** Con `dryRun` no escribe nada: solo devuelve el recuento para previsualizar. */
export const importarHistorico = (solicitudes: FilaHistorico[], dryRun: boolean) =>
  post<ResumenImportacion>('/api/ausencias/historico/import', { solicitudes, dryRun });

/** Todas las solicitudes de la compañía (solo admin). */
export const fetchHistorico = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/historico').then((d) => d.solicitudes);

/** Los campos que un admin puede corregir desde el registro general. */
export interface EdicionSolicitud {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: EstadoSolicitud;
  comentarios: string | null;
  observaciones: string | null;
}

/** Corrige una solicitud (solo admin). No manda correos a nadie. */
export const editarSolicitud = (id: string, campos: EdicionSolicitud) =>
  patch<Solicitud>(`/api/ausencias/solicitudes/${encodeURIComponent(id)}`, campos);

/** Borra una solicitud del registro (solo admin). Es irreversible. */
export async function borrarSolicitud(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/solicitudes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

export const fetchEmpleados = () =>
  get<{ empleados: EmpleadoConJefatura[] }>('/api/ausencias/empleados').then((d) => d.empleados);

/**
 * Cambia el jefe inmediato de alguien (solo admin). No manda ningún correo.
 *
 * Autoasignarse declara la raíz del organigrama. Un ciclo se rechaza con 409.
 * Las solicitudes ya en vuelo no se mueven: llevan sus firmantes congelados.
 */
export const fijarJefe = (empleadoId: string, aprobadorCorreo: string) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/jefe`, { aprobadorCorreo });

/** Fija a quién se pone en copia. `null` = sin copia. */
export const fijarCopia = (id: string, copiaCorreo: string | null) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/copia`, { copiaCorreo });

/** Da o quita la llave maestra de los adjuntos. Queda registrado en el servidor. */
export const fijarVisor = (id: string, veAdjuntos: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor`, { veAdjuntos });

/** Enciende o apaga la segunda firma de alguien. No mueve lo que ya está en vuelo. */
export const fijarSegundaFirma = (id: string, requiereSegundaFirma: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/segunda-firma`, {
    requiereSegundaFirma,
  });

/**
 * Descarga el PDF de una solicitud. Va por fetch y no por `<a href>` porque el
 * endpoint exige la cabecera Authorization, que un enlace no puede mandar.
 */
export async function descargarAdjunto(adjunto: Adjunto): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/adjuntos/${encodeURIComponent(adjunto.id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = adjunto.nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee un File como base64 sin la cabecera `data:...;base64,`. */
export function leerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const r = String(lector.result);
      const coma = r.indexOf(',');
      resolve(coma >= 0 ? r.slice(coma + 1) : r);
    };
    lector.readAsDataURL(file);
  });
}

/** Las solicitudes con PDF. Solo para admin y la lista de administración. */
export const fetchConAdjunto = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/adjuntos').then((d) => d.solicitudes);

/** Lo que a quien pregunta le tocaba firmar y ya está cerrado. */
export const fetchDecididas = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/decididas').then((d) => d.solicitudes);

/** Los saldos que puede ver quien pregunta: todos si es admin, si no los suyos. */
export const fetchSaldos = () =>
  get<{ saldos: SaldoDeEmpleado[] }>('/api/ausencias/saldos').then((d) => d.saldos);

/**
 * Fija el punto de corte de un empleado (solo admin). Las dos a null lo vacía.
 *
 * `saldoCorte` admite `string` a propósito, además de `number`: si el panel
 * convirtiera con `Number()` antes de mandarlo, un `'abc'` tecleado por error
 * se volvería `NaN`, y `JSON.stringify(NaN)` produce `null` — con lo que el
 * backend recibiría «vaciar la configuración» en vez de «esto no es un
 * número», y respondería un 400 confuso o, peor, borraría un saldo ya puesto.
 * Mandando la cadena tal cual, la validación de forma vive en un solo sitio
 * (el backend, con su regex) y el mensaje de error que llega es el correcto.
 */
export const fijarSaldo = (empleadoId: string, saldoCorte: number | string | null, fechaCorte: string | null) =>
  put<SaldoDeEmpleado>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/saldo`, {
    saldoCorte,
    fechaCorte,
  });

/** El calendario de un mes `YYYY-MM`. Lo ve cualquiera que tenga la app. */
export const fetchCalendario = (mes: string) =>
  get<CalendarioDelMes>(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`);
