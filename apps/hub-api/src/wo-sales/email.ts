import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import type { WoSalesConfig } from './config.js';
import type { EmailPendiente, ResumenEmail } from './types.js';
import type { SalesOrderSource, SalesOrderFiltro } from './source.js';
import { buildWorldOfficeCsv } from './builder.js';
import { buildWorldOfficeXlsx } from './xlsx.js';
import { cambiadasDesde, guardarEstado, leerEstado, listarActivos } from './email.repo.js';

/** Huella estable del contenido del archivo. Cubre OV nueva, modificada y la que sale. */
export function hashMatriz(matriz: string[][]): string {
  return createHash('sha256').update(JSON.stringify(matriz)).digest('hex');
}

export type Decision = 'sin_cambios' | 'sin_destinatarios' | 'enviar';

/**
 * Decisión pura de envío. sin_cambios manda sobre todo (si el archivo es el mismo, no
 * hay nada que hacer aunque no haya destinatarios). Solo se envía si cambió Y hay a
 * quién. Con 'sin_destinatarios' el hash NO se avanza (ver computarPendiente), para que
 * el envío pendiente salga cuando se añada un destinatario.
 */
export function decidirEnvio(token: string, ultimoHash: string | null, hayDestinatarios: boolean): Decision {
  if (token === ultimoHash) return 'sin_cambios';
  if (!hayDestinatarios) return 'sin_destinatarios';
  return 'enviar';
}

export function construirCuerpo(resumen: ResumenEmail, config: WoSalesConfig): string {
  const lineas = [
    config.emailAsunto,
    '',
    'Se adjunta el archivo actualizado de pedidos para World Office.',
    `Órdenes de venta: ${resumen.ordenes} · Líneas de producto: ${resumen.filas}`,
  ];
  if (resumen.cambiadas.length) lineas.push(`OV con cambios: ${resumen.cambiadas.join(', ')}`);
  if (resumen.advertencias > 0) {
    lineas.push(`Advertencias: ${resumen.advertencias}. Revísalas en la app antes de subir el archivo.`);
  }
  return lineas.join('\n');
}

/**
 * Decide si hay que enviar y arma el payload para n8n. Envía solo si el archivo cambió
 * respecto del último CONFIRMADO y hay destinatarios activos. NO avanza el hash aquí
 * (eso lo hace confirmarEnvio): si n8n no confirma, el próximo ciclo reintenta.
 */
export async function computarPendiente(
  db: Pool,
  source: SalesOrderSource,
  config: WoSalesConfig,
  filtro: SalesOrderFiltro,
  nombreArchivo: string
): Promise<EmailPendiente> {
  const ordenes = await source.ordenesVivas(filtro);
  const { matriz, warnings } = buildWorldOfficeCsv(ordenes, config);
  const token = hashMatriz(matriz);

  const estado = await leerEstado(db);
  const destinatarios = await listarActivos(db);
  if (decidirEnvio(token, estado.ultimoHash, destinatarios.length > 0) !== 'enviar') {
    return { enviar: false };
  }

  const cambiadas = await cambiadasDesde(db, config, filtro, estado.ultimoEnvioAt);
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

/** Marca ese hash como enviado. Idempotente. */
export async function confirmarEnvio(db: Pool, token: string): Promise<void> {
  await guardarEstado(db, token);
}
