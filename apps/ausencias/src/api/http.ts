import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
// Sin ciclo en runtime: lo que `dominio` coge de api.ts son solo tipos, con
// `import type`, y con `verbatimModuleSyntax` esa línea se borra al compilar.
import { ETIQUETA_TIPO, formatFecha, rangoFechas } from '../dominio';
import type { EstadoSolicitud, TipoSolicitud } from './tipos';

// ARQ-612 — cómo se habla con hub-api, sacado de api.ts tal cual: la URL base,
// la lectura de los errores que traen un `detalle` (el que `mensajeDeError`
// tira) y los verbos con los que se escriben los endpoints. Es INTERNO: api.ts
// no lo reexporta —solo los tipos de esos detalles—, y los trozos importan de
// aquí lo que usan (lo vigila barril.test.ts).

export const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

// ── El 409 del solapamiento ────────────────────────────────────────────────

/** El conflicto que devuelve un `rango_solapado`. Espejo de `detalleDelSolape`. */
export interface SolapeDetalle {
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

/**
 * Cómo se nombra el estado del choque, y qué se deduce de él.
 *
 * El estado va en el texto porque cambia lo que queda por hacer: una aprobada ya
 * concedió esos días y solo los suelta si se anula, mientras que una sin decidir
 * puede acabar rechazada y soltarlos sola.
 *
 * Falta `rechazada` porque el `WHERE` de `solapeDe` (`repo.ts`) solo devuelve
 * ausencias vivas y una rechazada no lo es, así que hoy el servidor no la manda
 * nunca en el `detalle`; si algún día llegara, o llegara un estado que este
 * bundle todavía no conozca, sale por la rama sin estado de `mensajeDeSolape`.
 *
 * Cada `salida` describe la CONDICIÓN —cuándo se sueltan esos días— y no receta
 * un botón, y eso no es estilo: es lo único que puede ser cierto a la vez para
 * los tres lectores posibles de estos cuatro 409. El dueño puede cambiar las
 * fechas o pedir la anulación; el admin que corrige el registro puede editar esa
 * otra solicitud —fechas o estado— o borrarla; y el jefe que firma una propuesta
 * no puede tocar la ausencia que choca, solo rechazar la propuesta que se la
 * pisa. «Anula esa solicitud primero» nombraba un botón que solo el dueño tiene.
 * Dicho como condición, cada uno lo mapea a lo que sí pueda hacer.
 *
 * Ojo al sujeto de los tres verbos de las `salida`: son cosas que le pasan a ESA
 * solicitud, la que choca. Rechazar la propuesta que se la pisa no es ninguna de
 * las tres —quita la demanda de esos días, no su ocupación—, y por eso no se
 * nombra.
 *
 * Por lo mismo no hay «ya tienes»: para el jefe y para el admin la ausencia que
 * choca no es suya. Es la trampa que `MENSAJE_DECISION` resuelve en la bandeja
 * con una segunda redacción; aquí se esquiva no hablándole a nadie en concreto.
 */
const SOLAPE_POR_ESTADO: Partial<Record<EstadoSolicitud, { estado: string; salida: string }>> = {
  pendiente: {
    estado: 'pendiente de aprobar',
    salida: 'Mientras siga en pie ocupa esos días: no se liberan hasta que se rechace, se cambie o se anule.',
  },
  pendiente_2: {
    estado: 'pendiente de la segunda firma',
    salida: 'Mientras siga en pie ocupa esos días: no se liberan hasta que se rechace, se cambie o se anule.',
  },
  aprobada: {
    estado: 'aprobada',
    salida: 'Esos días ya están concedidos: no se liberan hasta que esa solicitud se cambie o se anule.',
  },
  registrada: {
    estado: 'registrada',
    salida: 'Esos días ya están ocupados: no se liberan hasta que esa solicitud se cambie o se anule.',
  },
};

/**
 * El choque, dicho entero: contra qué se choca y qué hacer con ello.
 *
 * Decir el tipo y las fechas es toda su razón de ser: sin eso el aviso es «no
 * puedes» a secas, y quien lo lee no tiene por qué acordarse de qué días tenía
 * ya cogidos.
 *
 * Las fechas van por `rangoFechas`, que las pasa por el `formatFecha` con el que
 * las tablas pintan sus columnas: así el rango del aviso y la fila que se ve en
 * pantalla se escriben igual. De regalo, colapsa el rango de un solo día en una
 * fecha sola en vez de repetirla.
 *
 * El estado va PEGADO al tipo entre paréntesis y no como tercer elemento de la
 * lista. Con el `es-CO` de hoy `formatFecha` escribe «10 de jul de 2026», así que
 * un «…, 10 de jul de 2026 – 14 de jul de 2026, aprobada.» se lee un instante
 * como si «aprobada» calificara a la fecha de fin.
 */
function mensajeDeSolape(d: SolapeDetalle): string {
  const cuando = rangoFechas(d.fechaInicio, d.fechaFin);
  // Un tipo que este bundle no conozca cae en su propio código —feo, pero dice
  // algo— en vez de en un «undefined» a mitad de frase. Misma ventana de
  // despliegue que cubre la rama sin estado de aquí abajo.
  const tipo = ETIQUETA_TIPO[d.tipo] ?? d.tipo;
  const como = SOLAPE_POR_ESTADO[d.estado];
  if (!como) {
    return `Esas fechas chocan con otra ausencia: ${tipo}, ${cuando}. Esos días no se liberan hasta que esa solicitud se cambie o se anule.`;
  }
  return `Esas fechas chocan con otra ausencia: ${tipo} (${como.estado}), ${cuando}. ${como.salida}`;
}

/** El error de un endpoint corriente: el texto de `mensajeDeError` y nada más. */
export async function errorGenerico(res: Response): Promise<Error> {
  return new Error(await mensajeDeError(res));
}

/**
 * Igual, pero conservando el `detalle` de un `rango_solapado`.
 *
 * Hace falta porque `mensajeDeError` (@suite/http) devuelve para un 409 solo el
 * campo `error` y tira el resto del cuerpo — y el resto del cuerpo es justo
 * contra qué se choca. No se arregla allí: ese helper lo comparten las doce apps
 * del portal. El cuerpo se lee sobre un `clone()` porque el de una `Response` se
 * puede leer una sola vez, y el helper lo vuelve a leer para todo lo demás.
 *
 * Cualquier otro fallo —otro 409, un 400, un 500, un cuerpo que no sea JSON, o
 * un `rango_solapado` al que le faltara el `detalle`— sale por `mensajeDeError`
 * exactamente como antes de esto.
 */
async function errorDeAusencia(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    // `detalle` es la MISMA clave para todos los errores que la llevan; lo que
    // cambia de forma según el `error` es su contenido, así que se estrecha con
    // el código antes de usarlo y no al revés.
    .catch(() => null)) as {
    error?: string;
    detalle?: SolapeDetalle | CompensatoriosDetalle | RetiroDetalle;
  } | null;
  // Su último día ya está fijado y pide algo que lo pasa. Nombra la fecha: quien
  // lo lee casi nunca sabe de memoria qué día le pusieron, y sin ella el aviso
  // no dice qué corregir.
  if (cuerpo?.error === 'fecha_posterior_al_retiro' && cuerpo.detalle) {
    const { fechaRetiro } = cuerpo.detalle as RetiroDetalle;
    return new Error(
      `Tu último día en la compañía es el ${formatFecha(fechaRetiro)} y estos días lo pasan. ` +
        'Ajusta las fechas o, si la de tu salida no es correcta, habla con administración.',
    );
  }
  if (cuerpo?.error === 'rango_solapado' && cuerpo.detalle) {
    return new Error(mensajeDeSolape(cuerpo.detalle as SolapeDetalle));
  }
  // Sin estas dos ramas el usuario leería literalmente `compensatorios_insuficientes`
  // en la caja roja: `mensajeDeError` devuelve el código crudo en los 400 y 409.
  // Los códigos del otorgamiento. Sin estas ramas el usuario leería
  // `trabajo_demasiado_antiguo` tal cual en la caja roja: `mensajeDeError`
  // devuelve el código crudo en los 400 y 409.
  const DEL_OTORGAMIENTO: Record<string, string> = {
    otorgamiento_un_solo_dia:
      'Un compensatorio se pide por UN día trabajado, no por un rango. Si trabajaste varios días, manda una petición por cada uno.',
    trabajo_demasiado_antiguo:
      'Ese trabajo es de hace más de tres meses. Los compensatorios hay que pedirlos dentro de ese plazo; si se te pasó, habla con administración.',
    trabajo_en_el_futuro: 'Un compensatorio se pide por un día ya trabajado, no por uno que todavía no ha llegado.',
    motivo_requerido: 'Cuéntale a quien aprueba por qué pides esos días: sin motivo no se puede valorar.',
    dias_invalidos: 'Los días a conceder tienen que ser un número mayor que cero, con una décima como mucho (por ejemplo 0,5 o 1).',
    dias_demasiados: 'Como máximo se pueden pedir 30 días en una sola petición.',
    otorgamiento_solo_anulable: 'Un compensatorio concedido no tiene fechas que cambiar: solo se puede anular.',
    // Nombra el día porque el error llega sin detalle: quien lo lee acaba de
    // teclear esa fecha y no siempre recuerda haberla pedido ya —justo lo que
    // hacía que se reclamara dos veces—.
    otorgamiento_duplicado:
      'Ya pediste un compensatorio por ese mismo día trabajado. Si el anterior sigue pendiente o te lo concedieron, ' +
      'esos días ya están contados; si te lo rechazaron, puedes volver a pedirlo.',
  };
  if (cuerpo?.error && DEL_OTORGAMIENTO[cuerpo.error]) return new Error(DEL_OTORGAMIENTO[cuerpo.error]);

  // DATA-337 — alguien firmó, rechazó o anuló la solicitud mientras el admin
  // tenía abierto el formulario. No se guardó nada: guardar habría deshecho esa
  // decisión. Lo que toca es volver a abrirla para partir de lo que hay ahora.
  if (cuerpo?.error === 'solicitud_cambiada') {
    return new Error(
      'La solicitud cambió mientras la editabas (alguien la firmó, rechazó o anuló) y no se ha guardado nada. ' +
        'Cierra el formulario y vuelve a abrirla para ver cómo está ahora.',
    );
  }

  // Los de la incapacidad. Mapa aparte del de arriba y no una entrada más: son
  // de otro tipo de solicitud, y juntarlos haría que un vistazo al nombre del
  // mapa dijera algo falso sobre la mitad de sus claves.
  const DE_LA_INCAPACIDAD: Record<string, string> = {
    incapacidad_en_el_futuro:
      'Una incapacidad se informa por días que ya empezaron, no por unos que todavía no han llegado. ' +
      'Si el médico te firmó una baja que arranca más adelante, infórmala el primer día.',
    // No promete que administración pueda crearla: NO hay vía para que un admin
    // dé de alta una incapacidad en nombre de otro —solo puede corregir una fila
    // que ya exista, o importarla del histórico—. Decir «que te la registren»
    // mandaría a la gente a pedir algo que hoy no se puede hacer de un clic.
    incapacidad_demasiado_antigua:
      'Esa baja empieza hace más de dos días, que es todo lo que se puede informar por aquí. ' +
      'Habla con administración para que la registren ellos.',
  };
  if (cuerpo?.error && DE_LA_INCAPACIDAD[cuerpo.error]) return new Error(DE_LA_INCAPACIDAD[cuerpo.error]);

  // Los de la hora del permiso. Ninguno debería verlos un usuario normal —el
  // formulario no deja llegar ahí—, pero `mensajeDeError` devuelve el código
  // crudo en los 400, así que sin esto la caja roja diría `hora_invalida`.
  const DE_LA_HORA: Record<string, string> = {
    hora_invalida:
      'Revisa el horario: hacen falta las dos horas, en formato HH:MM, y la de fin tiene que ser posterior a la de inicio.',
    hora_no_permitida:
      'El horario solo se puede poner en un permiso de un único día. Si son varios días, quita las horas.',
  };
  if (cuerpo?.error && DE_LA_HORA[cuerpo.error]) return new Error(DE_LA_HORA[cuerpo.error]);
  // El mismo código llega por las DOS puertas —el alta con 400 y la petición de
  // cambio con 409—, así que la frase tiene que servir para las dos: ni «elige
  // otra fecha» a secas, que no diría nada al que ya la envió, ni «anula esta»,
  // que no diría nada al que todavía no la ha creado.
  //
  // Ninguna de las dos pantallas deja llegar hasta aquí: las dos ofrecen una
  // sola fecha. Llegar significa que la petición se mandó por otra vía — pero
  // `mensajeDeError` devolvería el código crudo en la caja roja, y ese no le
  // dice nada a nadie.
  if (cuerpo?.error === 'permiso_de_un_solo_dia') {
    return new Error(
      'Un permiso es de un solo día: elige una sola fecha. Si necesitas varios días seguidos, habla con administración.',
    );
  }

  if (cuerpo?.error === 'compensatorios_sin_saldo') {
    return new Error(
      'Todavía no tienes bolsa de compensatorios configurada, así que no se puede descontar de ella. ' +
        'Habla con administración para que fije tu punto de partida.',
    );
  }
  if (cuerpo?.error === 'compensatorios_insuficientes' && cuerpo.detalle) {
    return new Error(mensajeDeCompensatorios(cuerpo.detalle as CompensatoriosDetalle));
  }
  // El detalle tiene la MISMA forma que el de los compensatorios —lo emiten dos
  // funciones gemelas—, pero la frase no puede serlo: aquellos no se devengan y
  // estos sí, así que «esperar no los aumenta» sería falso aquí y le ahorraría a
  // alguien la única salida que de verdad tiene, que es pedir menos días o
  // esperar a devengar.
  if (cuerpo?.error === 'vacaciones_insuficientes' && cuerpo.detalle) {
    return new Error(mensajeDeVacaciones(cuerpo.detalle as CompensatoriosDetalle));
  }
  return errorGenerico(res);
}

/** Lo que manda el servidor con un `compensatorios_insuficientes`. */
export interface CompensatoriosDetalle {
  pedidos: number;
  pedible: number;
  disponible: number;
  enTramite: number;
}

/**
 * El mensaje del bloqueo por bolsa insuficiente.
 *
 * Dice el déficit SIN `Math.max(0, …)`, por lo mismo que las tarjetas: redondear
 * el rojo a cero borra el dato por el que existe el aviso. Y explica de dónde
 * sale el número cuando hay días esperando firma, porque si no la cifra de aquí
 * y la de la tarjeta de arriba parecen contradecirse.
 */
function mensajeDeCompensatorios(d: CompensatoriosDetalle): string {
  const dias = (n: number) => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })}`;
  const base =
    `Pides ${dias(d.pedidos)} días de compensatorio y solo puedes pedir ${dias(d.pedible)}: ` +
    `te faltan ${dias(d.pedidos - d.pedible)}.`;
  const tramite =
    d.enTramite > 0
      ? ` En la cuenta entran los ${dias(d.enTramite)} días que ya tienes pendientes de aprobar.`
      : '';
  return (
    `${base}${tramite} Los compensatorios no se devengan con el tiempo: se ganan por horas o días ` +
    'extra y hay que otorgarlos, así que esperar no los aumenta. Si crees que te faltan días por ' +
    'reconocer, habla con administración.'
  );
}

/**
 * El mismo bloqueo, para la bolsa de vacaciones.
 *
 * Comparte el detalle con su gemela y también el `sin Math.max(0, …)`: redondear
 * el déficit a cero borraría el dato por el que existe el aviso.
 *
 * Lo que NO comparte es el cierre, y es la razón de que sean dos funciones y no
 * una con un parámetro. Los compensatorios no se devengan y las vacaciones sí,
 * así que aquí la salida real del trabajador es otra —pedir menos días, o
 * esperar a acumular— y decirle «esperar no los aumenta» sería mentirle sobre lo
 * único que puede hacer por su cuenta.
 */
function mensajeDeVacaciones(d: CompensatoriosDetalle): string {
  const dias = (n: number) => `${n.toLocaleString('es-CO', { maximumFractionDigits: 1 })}`;
  const base =
    `Pides ${dias(d.pedidos)} días de vacaciones y solo puedes pedir ${dias(d.pedible)}: ` +
    `te faltan ${dias(d.pedidos - d.pedible)}.`;
  const tramite =
    d.enTramite > 0
      ? ` En la cuenta entran los ${dias(d.enTramite)} días que ya tienes pendientes de aprobar.`
      : '';
  return (
    `${base}${tramite} Puedes pedir menos días, o esperar: las vacaciones se devengan a razón de ` +
    '1,25 días por mes trabajado. Si no te cuadra el saldo, habla con administración.'
  );
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as T;
}

export async function conCuerpo<T>(
  metodo: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
  leerError: (res: Response) => Promise<Error> = errorGenerico,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await leerError(res);
  return (await res.json()) as T;
}

export const post = <T,>(path: string, body: unknown) => conCuerpo<T>('POST', path, body);
export const put = <T,>(path: string, body: unknown) => conCuerpo<T>('PUT', path, body);
/**
 * `PATCH` sin el decodificador de solapes. Lo usa la corrección de un MOVIMIENTO
 * del registro, que no puede contestar `rango_solapado`: una modificación cerrada
 * no ocupa agenda —lo que la ocupa es la solicitud—, así que corregir sus fechas
 * no choca con nada. Darle `patchSolapable` insinuaría una quinta puerta del
 * solapamiento que no existe.
 */
export const patch = <T,>(path: string, body: unknown) => conCuerpo<T>('PATCH', path, body);

/**
 * Los verbos de las CUATRO puertas del solapamiento —el alta, pedir un cambio de
 * fechas, firmarlo y el `PATCH` del registro—, que son las cuatro que pueden
 * contestar `rango_solapado`. El resto de endpoints sigue con `post`/`put`.
 *
 * `patch` a secas volvió a existir arriba, para la corrección de un movimiento:
 * ese `PATCH` no es una de las cuatro puertas y no puede dar `rango_solapado`.
 */
export const postSolapable = <T,>(path: string, body: unknown) => conCuerpo<T>('POST', path, body, errorDeAusencia);
export const patchSolapable = <T,>(path: string, body: unknown) => conCuerpo<T>('PATCH', path, body, errorDeAusencia);

/** El detalle de un `fecha_posterior_al_retiro`: su último día de trabajo. */
export interface RetiroDetalle {
  fechaRetiro: string;
}
