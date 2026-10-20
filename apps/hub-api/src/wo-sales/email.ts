import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import type { WoSalesConfig } from './config.js';
import type { EmailPendiente, ResumenEmail } from './types.js';
import type { SalesOrderSource, SalesOrderFiltro } from './source.js';
import { buildWorldOfficeCsv } from './builder.js';
import { buildWorldOfficeXlsx } from './xlsx.js';
import {
  cambiadasDesde,
  conCandadoDelCorreo,
  destinatariosConEstado,
  guardarEstado,
  leerEstado,
  liberarReservas,
  marcarCortes,
  marcarEnviados,
  reservar,
  reservasVigentes,
} from './email.repo.js';
import { decidirEnvioDestinatario, ultimaFranja } from './frecuencia.js';

/** Huella estable del contenido del archivo. Cubre OV nueva, modificada y la que sale. */
export function hashMatriz(matriz: string[][]): string {
  return createHash('sha256').update(JSON.stringify(matriz)).digest('hex');
}

export function construirCuerpo(resumen: ResumenEmail, config: WoSalesConfig): string {
  const lineas = [
    config.emailAsunto,
    '',
    'Se adjunta el archivo actualizado de pedidos para World Office.',
    `Órdenes de venta: ${resumen.ordenes} · Líneas de producto: ${resumen.filas}`,
  ];
  // §9: este correo es la puerta por la que el archivo llega a contabilidad SIN pasar
  // por el panel de advertencias de la app. Si lleva varias OV, el aviso tiene que ir
  // aquí o nadie lo ve antes de subirlo a World Office.
  if (resumen.ordenes > 1) {
    lineas.push(
      '',
      `ATENCIÓN: el archivo lleva ${resumen.ordenes} órdenes de venta bajo el mismo número de ` +
        'documento, y World Office las fusionaría en un solo pedido. No lo subas tal cual ' +
        'al ERP: está pendiente de confirmar con contabilidad si el archivo debe llevar ' +
        'una sola orden de venta.',
      ''
    );
  }
  if (resumen.cambiadas.length) lineas.push(`OV con cambios: ${resumen.cambiadas.join(', ')}`);
  if (resumen.advertencias > 0) {
    lineas.push(`Advertencias: ${resumen.advertencias}. Revísalas en la app antes de subir el archivo.`);
  }
  return lineas.join('\n');
}

/**
 * Decide si hay que enviar y arma el payload para n8n. Cada destinatario se decide por
 * separado con su frecuencia (ver frecuencia.ts): 'inmediato' recibe en cuanto su último
 * archivo recibido difiere del actual; diario/semanal/fin de mes solo en una franja nueva
 * y si hubo cambios; 'nunca' no recibe. Las franjas nuevas SIN cambios se cierran aquí
 * mismo (un cambio posterior espera a la franja siguiente); las que llevan envío se sellan
 * en confirmarEnvio, así un envío que n8n no confirma se reintenta en el próximo ciclo.
 *
 * DATA-339 — servir RESERVA: a cada destinatario elegido se le apunta (email, hash,
 * ahora) y, mientras esa reserva del mismo archivo siga vigente, no se le vuelve a
 * ofrecer. Sin esto, dos disparadores de n8n solapados veían a los mismos destinatarios
 * pendientes (nada se marca hasta /confirmado) y el xlsx salía dos veces. Si n8n nunca
 * confirma, la reserva vence sola y el ciclo siguiente reintenta, como antes.
 */
export async function computarPendiente(
  db: Pool,
  source: SalesOrderSource,
  config: WoSalesConfig,
  filtro: SalesOrderFiltro,
  nombreArchivo: string,
  ahora: Date = new Date()
): Promise<EmailPendiente> {
  // Lo lento (leer la réplica de Zoho y armar la matriz) va FUERA del candado: no
  // depende del estado del correo y no tiene por qué hacer esperar a la otra petición.
  const ordenes = await source.ordenesVivas(filtro);
  const { matriz, warnings } = buildWorldOfficeCsv(ordenes, config);
  const token = hashMatriz(matriz);

  // Leer, decidir, sellar cortes y reservar en UNA transacción con el candado del
  // correo: la petición solapada espera aquí y, al entrar, ya ve las reservas de esta.
  const { estado, destinatarios } = await conCandadoDelCorreo(db, async (tx) => {
    const estado = await leerEstado(tx);
    const decisiones = (await destinatariosConEstado(tx)).map((d) => ({
      d,
      ...decidirEnvioDestinatario(d.estado, token, ahora),
    }));
    // Quien ya tiene reservado ESTE archivo se lo está llevando otra petición. Se
    // descarta del envío, pero NO pasa a «franja sin envío»: sellarle el corte haría
    // que, si aquel envío no se confirma, el reintento esperase a la franja siguiente.
    const reservados = await reservasVigentes(
      tx,
      token,
      decisiones.filter((x) => x.enviar).map((x) => x.d.email)
    );
    await marcarCortes(
      tx,
      decisiones.filter((x) => !x.enviar && x.franja).map((x) => ({ email: x.d.email, corte: x.franja as Date }))
    );
    const destinatarios = decisiones.filter((x) => x.enviar && !reservados.has(x.d.email)).map((x) => x.d);
    await reservar(tx, token, destinatarios.map((d) => d.email));
    return { estado, destinatarios };
  });
  if (destinatarios.length === 0) {
    // Nadie pendiente: sin destinatarios, todos al día, o no les toca todavía.
    return { enviar: false };
  }

  // Mejor esfuerzo: la lista de OV cambiadas es SOLO para el cuerpo del correo. Si esta
  // consulta falla, NO debe impedir el envío — el archivo, que es lo que de verdad
  // importa, ya está construido. Se degrada a lista vacía en vez de tumbar el envío
  // (que dejaría a n8n con un 500 y la feature sin enviar nada, en silencio).
  let cambiadas: string[] = [];
  try {
    cambiadas = await cambiadasDesde(db, config, filtro, estado.ultimoEnvioAt);
  } catch (e) {
    console.error('wo-sales cambiadasDesde (best-effort) falló; se envía sin la lista:', e);
  }
  const resumen: ResumenEmail = {
    ordenes: ordenes.length,
    filas: matriz.length - 1,
    cambiadas,
    advertencias: warnings.length,
  };
  return {
    enviar: true,
    xlsBase64: buildWorldOfficeXlsx(matriz).toString('base64'),
    nombreArchivo,
    destinatarios: destinatarios.map((d) => ({ email: d.email, nombre: d.nombre })),
    asunto: config.emailAsunto,
    cuerpo: construirCuerpo(resumen, config),
    resumen,
    token,
  };
}

/**
 * Marca ese hash como recibido por los destinatarios a los que n8n lo envió. Idempotente.
 * `emails` viene del payload que n8n devuelve (los mismos `destinatarios` que recibió en
 * /pendiente), para marcar EXACTAMENTE a quien se le envió y no a quien se haya podido
 * añadir entre el /pendiente y el /confirmado. Si n8n no los devuelve (compatibilidad),
 * se cae a marcar a todos los que están pendientes de ese hash ahora mismo.
 * Además sella la fecha global de último envío, que alimenta la lista "OV con cambios"
 * del cuerpo del correo (cambiadasDesde), y suelta las reservas de ese archivo.
 *
 * DATA-339 — todo en una transacción con el candado del correo: antes eran escrituras
 * sueltas, y un fallo a mitad dejaba al destinatario como «recibido» sin franja sellada
 * ni estado global avanzado. Ahora o queda todo o no queda nada, y el reintento de n8n
 * (o la reserva al vencer) lo vuelve a intentar entero.
 */
export async function confirmarEnvio(
  db: Pool,
  token: string,
  emails?: string[],
  ahora: Date = new Date()
): Promise<void> {
  await conCandadoDelCorreo(db, async (tx) => {
    const todos = await destinatariosConEstado(tx);
    const destinatarios =
      emails ?? todos.filter((d) => decidirEnvioDestinatario(d.estado, token, ahora).enviar).map((d) => d.email);
    await marcarEnviados(tx, token, destinatarios);
    // Sella la franja de quienes la usan (diario / semanal / fin de mes).
    const enviados = new Set(destinatarios);
    const cortes = todos
      .filter((d) => enviados.has(d.email))
      .map((d) => ({ email: d.email, corte: ultimaFranja(d.estado.preferencia, ahora) }))
      .filter((c): c is { email: string; corte: Date } => c.corte !== null);
    await marcarCortes(tx, cortes);
    // Ya consta como recibido: la reserva sobra (y el hash recibido es lo que manda ahora).
    await liberarReservas(tx, token, destinatarios);
    await guardarEstado(tx, token);
  });
}
