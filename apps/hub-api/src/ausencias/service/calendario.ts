import type { Pool } from '@algarpibe/zoho-sync';
import {
  diasDelAnio,
  diasDelMes,
  esAnioValido,
  esMesValido,
  franjasDelAnio,
  marcasDelMes,
  mesesDelAnio,
  rangoDelAnio,
  rangoDelMes,
  type DiaCalendario,
  type FranjaCalendario,
  type MarcaCalendario,
  type MesDelAnio,
} from '../calendario.js';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import type { Sesion } from './sesion.js';

// ARQ-612 — el calendario del mes y del año, sacado de service.ts tal cual,
// con el alcance de la sesión que comparten las dos vistas. La rejilla y las
// franjas las construye ../calendario.ts, que es pura; aquí se decide a quién
// se ve. service.ts lo reexporta (lo vigila barril.test.ts).

/**
 * A quién ve esta sesión en el calendario: `null` es «sin acotar» y un correo es
 * «su rama de dos niveles y él mismo» (ver `repo.alcanceDelCalendario`).
 *
 * ⚠️ Existe una sola vez y la comparten la vista MENSUAL y la ANUAL. No es
 * comodidad: son la misma pantalla con dos formas, y si el alcance se resolviera
 * por separado en cada una, cambiar la regla en una dejaría a la otra
 * contestando lo de antes — sin fallar, y enseñando de más justo en la vista que
 * nadie volvió a revisar.
 *
 * El CORREO de la sesión, no el id de su ficha. Es la misma clave con la que
 * este módulo resuelve todo lo demás —`esAprobadorDeAlguien`,
 * `esVisorDeAdjuntos`, `puedeExportarRegistro`— y la única con la que se puede
 * expresar «mi rama», porque el organigrama son correos (`aprobador_correo`) y
 * no ids.
 *
 * Aquí hubo un `empleadoDeUsuario` + un centinela `ID_INEXISTENTE`. Aquel
 * centinela existía porque `null` significa «sin acotar» en los dos repos y
 * quien no tuviera ficha habría caído en esa rama viendo la plantilla entera.
 * Con el correo ya no hace falta: quien no tenga ficha no casa con ninguna fila
 * y recibe una rejilla vacía, que es justo lo que toca. Y un jefe SIN ficha
 * —que puede darse, porque se es aprobador por figurar en la columna de otro—
 * ve a su equipo en vez de nada.
 */
async function alcanceDeSesion(db: Pool, sesion: Sesion): Promise<string | null> {
  // El mismo `veTodo` que decide en `movimientosVisibles`, y escrito igual a
  // propósito: son las dos caras del mismo permiso, y quien lo tenga tiene que
  // ver la compañía entera en las dos pantallas o en ninguna.
  const veTodo = sesion.esAdmin || (await repo.esVisorDeTodaLaEmpresa(db, sesion.email));
  return veTodo ? null : sesion.email;
}

export interface CalendarioDelMes {
  empleados: repo.EmpleadoActivo[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

/**
 * El calendario de un mes, con las marcas ya expandidas por día.
 *
 * El parámetro es un mes y no un rango libre: acotarlo así impide que una
 * petición pida cinco años de golpe, y la interfaz solo navega mes a mes.
 *
 * **Tres alcances, y el del medio es el normal.** Un admin —o quien tenga
 * `ve_toda_la_empresa`, migración 032— ve la plantilla entera. **Un jefe ve su
 * propia fila y la de su rama de dos niveles**, que es exactamente la gente
 * cuyas ausencias firma. Quien no aprueba a nadie sigue viendo solo la suya.
 *
 * El escalón del medio se añadió el 2026-08-21 a petición expresa, y es el que
 * hace útil la pantalla para un jefe: coordinar un equipo exige ver cuándo falta
 * ese equipo. No reabre lo que se cerró en su día —la rejilla no vuelve a
 * enseñar a cualquiera cuándo falta cada compañero—, porque el alcance está
 * atado al organigrama y no al hecho de tener la app.
 *
 * El recorte lo hace el SQL, no un filtro sobre la respuesta: si las marcas
 * ajenas llegaran al navegador ya estarían expuestas, por mucho que no se
 * pinten. Y la definición de «mi rama» NO se reescribe aquí: el repo la comparte
 * con el registro de movimientos y con los saldos (ver `alcanceDelCalendario`).
 *
 * El recorte se hace en el SQL, no filtrando la respuesta: si las marcas ajenas
 * llegaran al navegador ya estarían expuestas, por mucho que no se pinten. Es la
 * misma lección del enmascarado de incapacidades que se retiró en su día.
 *
 * ⚠️ No oculta tanto como parece: n8n sigue publicando cada ausencia aprobada en
 * el Google Calendar «Ambientalia Staff», con el nombre de la persona en el
 * título. Quien tenga ese calendario compartido ve lo mismo por otra vía.
 */
export async function calendarioDelMes(db: Pool, sesion: Sesion, mes: string): Promise<CalendarioDelMes> {
  if (!esMesValido(mes)) throw new AusenciaError('mes_invalido', 400, 'mes');

  const soloDe = await alcanceDeSesion(db, sesion);

  const { desde, hasta } = rangoDelMes(mes);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db, soloDe),
    repo.ausenciasEntre(db, soloDe, desde, hasta),
  ]);

  return {
    empleados,
    dias: diasDelMes(mes),
    marcas: marcasDelMes(mes, ausencias),
  };
}

export interface CalendarioDelAnio {
  empleados: repo.EmpleadoActivo[];
  anio: string;
  /** 365, o 366 si es bisiesto. Es el denominador de todos los anchos. */
  diasDelAnio: number;
  meses: MesDelAnio[];
  franjas: FranjaCalendario[];
}

/**
 * El año entero, para la vista de franjas.
 *
 * Devuelve FRANJAS y no marcas por día, y ahí está el porqué de que exista una
 * función aparte en vez de un parámetro de `calendarioDelMes`: la rejilla
 * mensual rellena celdas y necesita un objeto por día; la anual dibuja barras y
 * necesita uno por ausencia. Expandir el año a días serían ~14.600 objetos en la
 * respuesta y otros tantos nodos en el DOM para pintar unas trescientas barras.
 *
 * **El alcance es EXACTAMENTE el de la vista mensual**, y no por copia: las dos
 * llaman a `alcanceDeSesion`. Un admin o un visor de empresa ven la plantilla
 * entera, un jefe su rama de dos niveles y su propia fila, y el resto solo la
 * suya. Ampliar el rango de un mes a un año no puede ampliar de paso a quién se
 * ve, que es la forma más fácil de convertir una vista nueva en una fuga.
 *
 * El parámetro es un año y no un rango libre, por lo mismo que allí es un mes:
 * acotarlo así impide que una petición pida cinco años de golpe.
 */
export async function calendarioDelAnio(db: Pool, sesion: Sesion, anio: string): Promise<CalendarioDelAnio> {
  if (!esAnioValido(anio)) throw new AusenciaError('anio_invalido', 400, 'anio');

  const soloDe = await alcanceDeSesion(db, sesion);

  const { desde, hasta } = rangoDelAnio(anio);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db, soloDe),
    repo.ausenciasEntre(db, soloDe, desde, hasta),
  ]);

  return {
    empleados,
    anio,
    diasDelAnio: diasDelAnio(anio),
    meses: mesesDelAnio(anio),
    franjas: franjasDelAnio(anio, ausencias),
  };
}
