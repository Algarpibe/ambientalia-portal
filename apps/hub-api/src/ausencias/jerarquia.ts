// El organigrama y las dos firmas que salen de él.
//
// `portal.empleados.aprobador_correo` significa «el correo de mi jefe
// inmediato». El árbol es esa única columna: no hay tabla de jerarquía, ni
// segundo aprobador guardado en el maestro. El segundo aprobador se DERIVA
// subiendo un escalón, y así el organigrama existe una sola vez y no puede
// desincronizarse consigo mismo.
//
// Puro y con tests, como `saldo.ts` y `calendario.ts`: las reglas del corte
// —raíz, ficha inactiva, correo desconocido, ciclo— no se pueden probar si viven
// en una consulta, porque en este repo no hay Postgres en ningún test.

/** Una ficha reducida a su enlace hacia arriba. Los correos van en minúsculas. */
export interface EnlaceJerarquia {
  correo: string;
  aprobadorCorreo: string;
}

export interface Aprobadores {
  /** Quien firma primero. Siempre el `aprobadorCorreo` del solicitante. */
  primero: string;
  /** Quien firma después, o `null` si el árbol se acaba: una sola firma. */
  segundo: string | null;
}

/**
 * Los dos que tienen que firmar, para congelarlos en el alta de la solicitud.
 *
 * @param solicitante su correo y el de su jefe inmediato.
 * @param jefe la ficha ACTIVA del jefe, o `null` si no la tiene (no está en el
 *   maestro, o alguien la desactivó). Lo resuelve `repo.enlaceDe`.
 */
export function aprobadoresDe(
  solicitante: { correo: string; aprobadorCorreo: string },
  jefe: EnlaceJerarquia | null,
): Aprobadores {
  // El primer nivel NO tiene condiciones: es literalmente lo que dice la ficha,
  // igual que antes de existir la cascada. Importa porque ese correo puede ser un
  // buzón sin ficha de empleado —hoy lo es para toda la plantilla— y tiene que
  // seguir funcionando exactamente igual.
  const primero = solicitante.aprobadorCorreo.toLowerCase();
  const yo = solicitante.correo.toLowerCase();

  // Sin ficha activa del jefe no se puede subir. Y NO se salta al abuelo: si a
  // alguien le desactivan el jefe, su solicitud se cierra con una firma en vez de
  // aterrizar en el buzón de quien no la esperaba.
  if (!jefe) return { primero, segundo: null };

  const abuelo = jefe.aprobadorCorreo.toLowerCase();

  // El jefe es su propio jefe: es la raíz del organigrama, no hay más escalones.
  if (abuelo === jefe.correo.toLowerCase()) return { primero, segundo: null };

  // El jefe del jefe es el mismo que ya firma primero: una firma, no dos iguales.
  if (abuelo === primero) return { primero, segundo: null };

  // El jefe del jefe soy yo. Pasa con un ciclo de dos (A jefe de B, B jefe de A).
  // Sin este corte, el solicitante se firmaría a sí mismo la segunda aprobación y
  // la cascada se convertiría en autoaprobación sin que nada fallara.
  if (abuelo === yo) return { primero, segundo: null };

  return { primero, segundo: abuelo };
}

/** Índice correo → correo del jefe, todo en minúsculas. */
export function construirIndice(enlaces: EnlaceJerarquia[]): Map<string, string> {
  return new Map(enlaces.map((e) => [e.correo.toLowerCase(), e.aprobadorCorreo.toLowerCase()]));
}

/**
 * True si poner a `nuevoJefe` como jefe de `empleado` cerraría un círculo.
 *
 * Autoasignarse devuelve `false`: es como se declara la raíz, no un ciclo
 * prohibido. Si esto lo bloqueara, no habría forma de crear la raíz desde el
 * panel.
 */
export function creariaCiclo(
  indice: Map<string, string>,
  empleadoCorreo: string,
  nuevoJefeCorreo: string,
): boolean {
  const empleado = empleadoCorreo.toLowerCase();
  const nuevoJefe = nuevoJefeCorreo.toLowerCase();
  if (empleado === nuevoJefe) return false;

  // El `Set` no es defensivo: si YA hay un ciclo en la base de datos que no
  // involucra a este empleado, un recorrido sin visitados deja un handler de
  // Express girando para siempre. No es un error que se vea: es un cuelgue.
  // También corta el caso de la raíz, que es jefe de sí misma: se visita una vez
  // y a la segunda vuelta ya está en el conjunto.
  const visitados = new Set<string>([empleado]);
  let actual: string | undefined = nuevoJefe;

  while (actual) {
    if (actual === empleado) return true;
    if (visitados.has(actual)) return false;
    visitados.add(actual);
    actual = indice.get(actual);
  }
  return false;
}

/**
 * Los ciclos que YA existen en el árbol, cada uno como la lista de correos que lo
 * forman. Para avisar en el panel: un ciclo no se bloquea —bloquearlo lo haría
 * imposible de arreglar desde la interfaz— pero hay que poder verlo.
 *
 * La raíz (jefe de sí misma) no es un ciclo.
 */
export function detectarCiclos(indice: Map<string, string>): string[][] {
  const ciclos: string[][] = [];
  const yaEnUnCiclo = new Set<string>();

  for (const inicio of indice.keys()) {
    if (yaEnUnCiclo.has(inicio)) continue;

    const camino: string[] = [];
    const posicion = new Map<string, number>();
    let actual: string | undefined = inicio;

    while (actual && !yaEnUnCiclo.has(actual)) {
      const visto = posicion.get(actual);
      if (visto !== undefined) {
        const ciclo = camino.slice(visto);
        // Un solo elemento es la raíz apuntándose a sí misma, no un círculo.
        if (ciclo.length > 1) {
          ciclos.push(ciclo);
          ciclo.forEach((c) => yaEnUnCiclo.add(c));
        }
        break;
      }
      posicion.set(actual, camino.length);
      camino.push(actual);
      actual = indice.get(actual);
    }
  }
  return ciclos;
}
