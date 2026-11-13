import { conCuerpo, errorGenerico, get, put } from './http';
import type { Empleado, EmpleadoConJefatura } from './tipos';

// ARQ-612 — el organigrama visto desde la administración, sacado de api.ts tal
// cual en tres bloques: la lista de empleados con su posición en el árbol, y
// las puertas que lo cambian (jefe, copia, segunda firma, cargo) o que reparten
// las llaves de la ficha (visor, exportador, vista de toda la empresa, KPIs).
// api.ts lo reexporta (lo vigila barril.test.ts).

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

/**
 * Da o quita el permiso de exportar el registro. Solo admin. Queda registrado
 * en el servidor, igual que `fijarVisor`.
 *
 * Devuelve `{ ok: boolean }` y no la ficha: el permiso no se pinta en la fila
 * del maestro, así que quien lo cambia solo necesita saber que cuajó.
 */
export const fijarExportador = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/exportador`, { concedido });

/**
 * Da o quita la vista del calendario y el registro de toda la empresa. Solo
 * admin, y queda registrado en el servidor igual que las otras dos llaves.
 *
 * Devuelve `{ ok: boolean }` y no la ficha, por lo mismo que `fijarExportador`:
 * quien lo cambia solo necesita saber que cuajó, y la fila la resincroniza la
 * recarga del maestro.
 */
export const fijarVisorDeEmpresa = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor-empresa`, { concedido });

/**
 * Da o quita la llave del panel de KPIs. Solo admin, y queda registrado en el
 * servidor igual que las otras tres.
 *
 * Sirve para dárselo a quien NO es administrador: a los que lo son se lo da ya
 * el rol, y por eso su casilla tampoco se pinta en esas filas.
 */
export const fijarVisorDeKpis = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor-kpis`, { concedido });

/** Enciende o apaga la segunda firma de alguien. No mueve lo que ya está en vuelo. */
export const fijarSegundaFirma = (id: string, requiereSegundaFirma: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/segunda-firma`, {
    requiereSegundaFirma,
  });

/**
 * El error de `fijarCargo`, dicho para el admin.
 *
 * `mensajeDeError` enseñaría el código crudo `cargo_invalido` en un 400 y «No se
 * pudieron cargar los datos (error 404)» en un 404. El 404 solo se traduce si
 * trae `empleado_no_encontrado`: uno sin código es lo que contesta un hub-api
 * que aún no tiene la ruta (portal desplegado antes), y decir ahí «la ficha no
 * está activa» sería mentir.
 */
async function errorDeCargo(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown } | null;
  if (res.status === 400 && cuerpo?.error === 'cargo_invalido') {
    return new Error(
      'El cargo admite hasta 255 caracteres y no puede llevar saltos de línea ni caracteres de control.',
    );
  }
  if (res.status === 404 && cuerpo?.error === 'empleado_no_encontrado') {
    return new Error('Esa ficha ya no está activa. Recarga la lista.');
  }
  return errorGenerico(res);
}

/**
 * Pone, cambia o quita (`null` o vacío) el cargo de alguien. Solo admin. El
 * recorte y el «vacío = sin cargo» los decide el servidor.
 */
export const fijarCargo = (id: string, cargo: string | null) =>
  conCuerpo<Empleado>('PUT', `/api/ausencias/empleados/${encodeURIComponent(id)}/cargo`, { cargo }, errorDeCargo);
