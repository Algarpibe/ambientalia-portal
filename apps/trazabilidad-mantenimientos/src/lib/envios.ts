/**
 * Lo que «Avisos a clientes» dice del envío: el rótulo del interruptor, el
 * estado de cada envío, el botón de cada tarjeta, quién avisó a un equipo y los
 * errores del envío en palabras. Puro: sin React ni red. A quién va y qué texto
 * sale lo decide el servidor (avisos-envios-repo.ts, en hub-api); el modo, su entorno.
 *
 * Regla de la pantalla: «Sí salió» / «No salió» y el botón de cada tarjeta se
 * deciden SÓLO con el estado que sirve GET /avisos/envios, nunca con la
 * respuesta del POST. El POST contesta «sin confirmar» al instante ante un
 * tiempo agotado; GET lo presenta «en curso» hasta los 2 minutos y el servidor
 * rechaza (409) resolverlo antes. Tras enviar, la pantalla vuelve a pedir la lista.
 */
import { MAX_DESTINATARIOS, SIN_CONFIRMAR_MS, destinatariosAceptables, type EnvioAviso, type EstadoCanal, type EstadoEnvio, type MotivoApagado, type TramoAviso } from '../dominio';

export interface Rotulo {
  tono: 'amber' | 'blue' | 'green';
  titulo: string;
  texto: string;
}

const POR_QUE: Record<MotivoApagado, string> = {
  sin_valor: 'nadie ha encendido el interruptor',
  valor_desconocido: 'el interruptor tiene un valor que no se reconoce',
  sin_canal: 'falta la configuración del canal de correo (la URL de n8n tiene que ser https, o de un host interno de una sola palabra, y hay que poner el token)',
  sin_buzon_prueba: 'falta el buzón de prueba o no es de @ambientalia.com.co',
};

/** El rótulo de arriba de la pantalla: cómo está el interruptor de envío y, si está apagado sin pedirlo, por qué. */
export function rotuloModo(c: EstadoCanal): Rotulo {
  if (c.modo === 'real') return { tono: 'green', titulo: 'Envío real', texto: 'Al pulsar «Enviar correo», el aviso sale desde info@ambientalia.com.co hacia el cliente y sus equipos quedan como avisados hoy.' };
  if (c.modo === 'prueba') return { tono: 'blue', titulo: 'Envío en prueba', texto: `Todo va sólo a ${c.buzonPrueba}, con «[PRUEBA]» en el asunto: ningún cliente recibe nada y ningún equipo queda marcado como avisado.` };
  return { tono: 'amber', titulo: 'Envío apagado', texto: `No sale ningún correo${c.motivo ? `: ${POR_QUE[c.motivo]}` : ''}. El interruptor se cambia sólo en el servidor.` };
}

const TEXTO_ESTADO: Record<EstadoEnvio, string> = {
  en_curso: 'Enviando… (si no se confirma en 2 minutos, quedará sin confirmar)',
  sin_confirmar: 'Sin confirmar: revisa Enviados de info@',
  enviado: 'Enviado',
  fallido: 'Fallido',
};

/** El resultado de un envío, en palabras («Fallido» lleva su motivo). */
export function textoEstadoEnvio(e: Pick<EnvioAviso, 'estado' | 'error'>): string {
  return e.estado === 'fallido' && e.error ? `Fallido: ${e.error}` : TEXTO_ESTADO[e.estado];
}

/** El último envío de una tarjeta (cliente + tramo), o null. `envios` va del más reciente al más antiguo, como lo sirve la API. */
export function ultimoEnvioDe(envios: readonly EnvioAviso[], claveCliente: string, tramo: TramoAviso): EnvioAviso | null {
  return envios.find((e) => e.claveCliente === claveCliente && e.tramo === tramo) ?? null;
}

/** Cómo va el botón «Enviar correo» de una tarjeta: apagado, ocupado por un envío abierto, o listo. */
export function botonEnviar(c: EstadoCanal, ultimo: EnvioAviso | null): { activo: boolean; texto: string } {
  if (c.modo === 'apagado') return { activo: false, texto: 'Envío apagado' };
  if (ultimo?.estado === 'en_curso') return { activo: false, texto: 'Enviando…' };
  if (ultimo?.estado === 'sin_confirmar') return { activo: false, texto: 'Sin confirmar' };
  return { activo: true, texto: 'Enviar correo' };
}

/** Si se ofrecen «Sí salió» / «No salió»: sólo con un envío que la lista de GET ya presenta como «sin confirmar» (nunca con la respuesta del POST). */
export function puedeResolver(envio: EnvioAviso | null): boolean {
  return envio?.estado === 'sin_confirmar';
}

/** El envío REAL que avisó a un equipo desde aquí EN SU TRAMO (el más reciente), o null si se le avisó de otra forma (por teléfono, a mano). */
export function envioDeEquipo(envios: readonly EnvioAviso[], clave: string, tramo: TramoAviso | null): EnvioAviso | null {
  return envios.find((e) => e.modo === 'real' && e.estado === 'enviado' && e.tramo === tramo && e.equipos.includes(clave)) ?? null;
}

/** Qué ofrece una tarjeta con destinatario: nada (sin permiso), una indicación (no se podría enviar) o el botón. */
export type AccionTarjeta = { tipo: 'aviso'; texto: string } | { tipo: 'boton'; activo: boolean; texto: string };

/** Decide qué pone la pantalla en una tarjeta: `para` son sus destinatarios de verdad (correoReal) y `ultimo` su último envío según GET. */
export function accionTarjeta(a: { puedeEnviar: boolean; canal: EstadoCanal | null; fallo: boolean; ultimo: EnvioAviso | null; para: readonly string[] }): AccionTarjeta | null {
  if (!a.puedeEnviar) return null;
  if (!a.canal) return { tipo: 'boton', activo: false, texto: a.fallo ? 'Sin estado del envío' : 'Cargando…' };
  if (a.canal.modo !== 'apagado' && !destinatariosAceptables(a.para)) {
    return { tipo: 'aviso', texto: `No se puede enviar: tiene que ir a entre 1 y ${MAX_DESTINATARIOS} correos válidos y distintos. Pon a mano el contacto del cliente.` };
  }
  return { tipo: 'boton', ...botonEnviar(a.canal, a.ultimo) };
}

/** True si el modo (y el buzón de prueba) son los mismos: lo que enseñó la confirmación contra lo que dice el servidor ahora. El motivo de un apagado no cuenta. */
export function canalIgual(a: EstadoCanal, b: EstadoCanal): boolean {
  return a.modo === b.modo && a.buzonPrueba === b.buzonPrueba;
}

/** Cuándo volver a pedir los envíos si la lista tiene alguno «en curso» (a los 2 minutos más 5 segundos ya será «sin confirmar»); null si no hace falta. */
export function msHastaRefresco(envios: readonly EnvioAviso[]): number | null {
  return envios.some((e) => e.estado === 'en_curso') ? SIN_CONFIRMAR_MS + 5000 : null;
}

/** Lo que se dice cuando el canal contesta que el correo NO salió; el motivo ya suele traer su punto. */
export function textoFallo(error: string | null): string {
  return `No salió: ${(error ?? 'sin motivo').replace(/\.+$/, '')}. No se ha marcado nada; puedes volver a intentarlo.`;
}

/** Con `recargar`, la pantalla ya se ha vuelto a pedir al servidor cuando se enseña el mensaje. */
const RECARGA = ' Se ha actualizado la pantalla.';

/** Lo que dice la pantalla por cada código de error del envío; `recargar` = la pantalla vuelve a pedir la lista. */
const ERROR_ENVIO: Record<string, { texto: string; recargar: boolean }> = {
  envio_apagado: { texto: `El envío está apagado: no se ha enviado nada.${RECARGA}`, recargar: true },
  modo_cambiado: { texto: `El modo del envío cambió mientras tenías abierta la confirmación y no se ha enviado nada. Revisa el modo y vuelve a enviar.${RECARGA}`, recargar: true },
  destinatarios_cambiados: { texto: `Los destinatarios de este aviso cambiaron mientras tenías abierta la confirmación y no se ha enviado nada. Revisa a quién va y vuelve a enviar.${RECARGA}`, recargar: true },
  tarjeta_no_encontrada: { texto: `Ese aviso ya no está pendiente: puede que ya se haya enviado o que sus equipos hayan cambiado.${RECARGA}`, recargar: true },
  tarjeta_cambiada: { texto: `La tarjeta cambió desde que la abriste y no se ha enviado nada.${RECARGA}`, recargar: true },
  ya_enviando: { texto: 'Este aviso ya se está enviando o quedó sin confirmar: míralo en «Últimos envíos».', recargar: false },
  destinatarios_no_validos: { texto: 'Este aviso no se puede enviar: tiene que ir a entre 1 y 5 correos válidos y distintos. Pon a mano el contacto del cliente, con 5 direcciones como mucho, y vuelve a intentarlo. No se ha enviado nada.', recargar: false },
  no_sin_confirmar: { texto: `Ese envío ya no está sin confirmar: ya se resolvió o todavía se está enviando (espera un par de minutos).${RECARGA}`, recargar: true },
  marcar_retirado: { texto: `Marcar avisos en bloque se retiró. El aviso se envía desde su tarjeta, con «Enviar correo».${RECARGA}`, recargar: true },
};

/**
 * El mensaje que se enseña ante un error del envío. `e` es un `ApiError` (o cualquier cosa): con un código conocido
 * sale el texto de aquí; con otro, el mensaje del servidor; la sesión caducada (401) conserva el suyo.
 */
export function errorDeEnvio(e: unknown): { texto: string; recargar: boolean } {
  const x = (e && typeof e === 'object' ? e : {}) as { status?: unknown; code?: unknown; message?: unknown };
  const propio = x.status === 401 || typeof x.code !== 'string' ? undefined : ERROR_ENVIO[x.code];
  if (propio) return propio;
  const mensaje = typeof x.message === 'string' && x.message.trim() !== '' ? x.message : 'No se pudo completar la operación. Inténtalo de nuevo en un momento.';
  return { texto: mensaje, recargar: false };
}
