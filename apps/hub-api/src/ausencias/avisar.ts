// Aviso a n8n de que hay algo nuevo en la cola.
//
// Es un ATAJO, no el mecanismo. El workflow sigue preguntando por su cuenta cada
// diez minutos, así que si este aviso se pierde —n8n reiniciándose, un corte de
// red, un despliegue a medias— lo único que pasa es que el correo tarda unos
// minutos en vez de un segundo. Nada se queda sin enviar.
//
// De ahí las tres reglas de esta función:
//   1. Nunca lanza. Un fallo notificando no puede tumbar la creación de una
//      solicitud que YA está guardada y encolada.
//   2. Nunca se espera. Va con `void`, sin await, para no meter latencia de red
//      en la petición del usuario.
//   3. Se corta a los 3 segundos. Un n8n colgado no debe dejar sockets abiertos
//      acumulándose en hub-api.

/** Tope de espera. Pasado esto damos el aviso por perdido y el polling se encarga. */
const TIMEOUT_MS = 3000;

/**
 * Avisa a n8n de que la cola tiene trabajo. Sin `AUSENCIAS_WEBHOOK_URL`
 * configurada no hace nada — que es lo correcto en local y en los tests: el
 * polling sigue funcionando igual.
 *
 * Se autentica con el MISMO token que n8n usa para llamar a hub-api. Es la misma
 * frontera de confianza, solo que en el otro sentido; un secreto aparte solo
 * añadiría una cosa más que rotar sin ganar nada.
 */
export async function avisarN8n(): Promise<void> {
  const url = process.env.AUSENCIAS_WEBHOOK_URL;
  const token = process.env.AUSENCIAS_CRON_TOKEN;
  if (!url || !token) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ausencias-Cron-Token': token },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // La respuesta no se mira a propósito: el aviso es "ve a preguntar", y quien
    // decide qué hacer es el propio workflow cuando llame a /pendiente.
  } catch (e) {
    // A nivel warn, no error: no es un fallo del sistema, es un atajo que no
    // funcionó. Si sale muy a menudo, mira si n8n está sano o si la URL cambió.
    console.warn('ausencias: no se pudo avisar a n8n (el polling lo recogerá)', (e as Error).message);
  }
}
