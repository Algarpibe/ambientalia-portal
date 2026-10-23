import type { Pool } from '@algarpibe/zoho-sync';
import { withTransaction } from './comun.js';

// ARQ-612 — las cuatro llaves de cada ficha, sacadas de repo.ts tal cual: ver
// soportes (adjuntos), exportar el registro, ver toda la empresa y ver el panel
// de KPIs. Cada «es…»/«puede…» responde solo por la columna (el rol de admin lo
// suma quien llama), y cada «fijar…» cambia la llave y deja su línea de
// auditoría en la MISMA transacción. repo.ts las reexporta: el resto del código
// las sigue llamando como `repo.*` (lo vigila barril.test.ts).

/**
 * Si ese correo tiene la llave maestra de los adjuntos.
 *
 * Consulta por correo y no por id porque quien pregunta es una sesión, y una
 * sesión puede no tener ficha de empleado — en ese caso no es visor, que es la
 * respuesta correcta.
 */
export async function esVisorDeAdjuntos(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_adjuntos`,
    [email],
  );
  return rows.length > 0;
}

/** Datos de un cambio de llave: quién la da, a quién y en qué sentido. */
export interface CambioVisor {
  empleadoId: string;
  veAdjuntos: boolean;
  adminEmail: string;
  empleadoCorreo: string;
}

/**
 * Da o quita la llave Y deja constancia, en la MISMA transacción.
 *
 * No son dos funciones sueltas a propósito. Si el UPDATE cuajara y el INSERT
 * fallara, el reintento se encontraría el valor ya cambiado, el guard de «solo
 * si cambia» saltaría la escritura, y la llave quedaría concedida sin una sola
 * línea de registro — justo lo que esta tabla existe para impedir, y con el
 * reintento consolidando el hueco en vez de repararlo.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarVisorConRegistro(db: Pool, cambio: CambioVisor): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE portal.empleados SET ve_adjuntos = $2 WHERE id = $1 AND activo`,
      [cambio.empleadoId, cambio.veAdjuntos],
    );
    if ((rowCount ?? 0) === 0) return false;

    await client.query(
      `INSERT INTO portal.visores_adjuntos_log (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [cambio.adminEmail, cambio.empleadoId, cambio.empleadoCorreo, cambio.veAdjuntos],
    );
    return true;
  });
}

/**
 * Si ese correo tiene marcado el permiso de exportar el registro.
 *
 * Consulta por correo y no por id, por el mismo motivo que `esVisorDeAdjuntos`:
 * quien pregunta es una sesión, y una sesión puede no tener ficha de empleado —
 * en ese caso no puede exportar, que es la respuesta correcta.
 */
export async function puedeExportarRegistro(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND exporta_registro`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita el permiso de exportar, y lo DEJA REGISTRADO, en la MISMA
 * transacción — mismo motivo que `fijarVisorConRegistro` (ver arriba): si el
 * UPDATE cuajara y el INSERT fallara, el permiso quedaría concedido sin una
 * sola línea de auditoría, y un reintento posterior no tendría forma de
 * notar el hueco (el estado ya coincidiría con lo pedido) para repararlo.
 *
 * El log guarda el correo además del id y sin clave foránea, por lo mismo que
 * `visores_adjuntos_log`: si la ficha se borra, el registro tiene que seguir
 * diciendo a quién se le dio. Un registro que desaparece con su sujeto no es
 * un registro de auditoría.
 *
 * El correo que se registra es el que devuelve el propio UPDATE (`RETURNING
 * correo`) y no uno que traiga quien llama: así la función no depende de que
 * el llamador haya cargado la ficha de antemano, y el log siempre refleja el
 * correo que la fila tenía en el instante del cambio.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarExportador(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.empleados SET exporta_registro = $2 WHERE id = $1 AND activo RETURNING correo`,
      [empleadoId, concedido],
    );
    if (!rows.length) return false;

    await client.query(
      `INSERT INTO portal.exportadores_registro_log
         (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
    );
    return true;
  });
}

/**
 * Si ese correo ve el calendario y el registro de TODA la compañía sin ser
 * administrador.
 *
 * Consulta por correo y no por id, por lo mismo que `esVisorDeAdjuntos` y
 * `puedeExportarRegistro`: quien pregunta es una sesión, y una sesión puede no
 * tener ficha de empleado — en ese caso no es visor, que es la respuesta
 * correcta.
 *
 * ⚠️ El `AND activo` no es decorativo: sin él, a un ex-empleado cuya ficha
 * siguiera en la tabla se le quedaría abierto el registro de la plantilla
 * entera. Es la misma trampa que el JSDoc de `esVisorDeAdjuntos` señala para su
 * consulta gemela, y aquí sí la vigila un test contra Postgres
 * (`repo.visor-empresa.db.test.ts`).
 */
export async function esVisorDeTodaLaEmpresa(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_toda_la_empresa`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita la vista de toda la empresa, y lo DEJA REGISTRADO, en la MISMA
 * transacción — mismo motivo que `fijarVisorConRegistro` y `fijarExportador`
 * (ver arriba): si el UPDATE cuajara y el INSERT fallara, el permiso quedaría
 * concedido sin una sola línea de auditoría, y un reintento posterior no
 * tendría forma de notar el hueco (el estado ya coincidiría con lo pedido) para
 * repararlo.
 *
 * El correo que se registra sale del propio UPDATE (`RETURNING correo`) y no de
 * quien llama, igual que en `fijarExportador`: así el log refleja el correo que
 * la fila tenía en el instante del cambio, sin depender de que el llamador
 * hubiera cargado la ficha de antemano.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarVisorDeEmpresa(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.empleados SET ve_toda_la_empresa = $2 WHERE id = $1 AND activo RETURNING correo`,
      [empleadoId, concedido],
    );
    if (!rows.length) return false;

    await client.query(
      `INSERT INTO portal.visores_empresa_log
         (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
    );
    return true;
  });
}

/**
 * ¿Tiene esta persona la llave del panel de KPIs? (migración 038)
 *
 * Se lee como sus tres hermanas —`sesion.esAdmin || repo.esVisorDeKpis(...)`—,
 * así que esta consulta responde solo por la COLUMNA: quién entra por el rol lo
 * decide quien llama. Es la vía para dar el panel a quien no es administrador.
 *
 * El `AND activo` no es decorativo, igual que en `esVisorDeTodaLaEmpresa`: sin
 * él, a un ex-empleado cuya ficha siguiera en la tabla se le quedaría abierto
 * el pasivo de vacaciones de la plantilla y el desglose de tiempos por
 * aprobador. Lo vigila un test contra Postgres (`repo.visor-kpis.db.test.ts`).
 */
export async function esVisorDeKpis(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_kpis`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita el panel de KPIs, y lo DEJA REGISTRADO, en la MISMA transacción
 * —mismo motivo que `fijarVisorDeEmpresa` y `fijarExportador`—: si el UPDATE
 * cuajara y el INSERT fallara, el permiso quedaría concedido sin una sola línea
 * de auditoría, y un reintento posterior no tendría forma de notar el hueco (el
 * estado ya coincidiría con lo pedido) para repararlo.
 *
 * El correo que se registra sale del propio UPDATE (`RETURNING correo`) y no de
 * quien llama: así el log refleja el correo que la fila tenía en el instante
 * del cambio, sin depender de que el llamador hubiera cargado la ficha antes.
 *
 * Devuelve false si la ficha no existía o estaba inactiva, y entonces no se
 * escribe registro: un intento fallido no puede ensuciar la auditoría.
 */
export async function fijarVisorDeKpis(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.empleados SET ve_kpis = $2 WHERE id = $1 AND activo RETURNING correo`,
      [empleadoId, concedido],
    );
    if (!rows.length) return false;

    await client.query(
      `INSERT INTO portal.visores_kpis_log
         (admin_email, empleado_id, empleado_correo, concedido)
       VALUES (lower($1), $2, lower($3), $4)`,
      [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
    );
    return true;
  });
}
