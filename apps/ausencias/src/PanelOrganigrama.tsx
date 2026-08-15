import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { fetchEmpleados, fijarJefe, fijarCopia, fijarVisor, fijarSegundaFirma, type EmpleadoConJefatura } from './api';

// El organigrama de la empresa. Cada persona tiene un jefe inmediato y ese único
// dato basta: el segundo aprobador se deriva subiendo un escalón, así que el
// árbol existe una sola vez y no puede desincronizarse consigo mismo.
//
// La hoja de Google NO manda aquí. Su importación conserva el jefe que ya
// hubiera; antes lo pisaba en cada pasada y borraba el árbol entero.

interface Fila {
  aprobadorCorreo: string;
  copiaCorreo: string | null;
  veAdjuntos: boolean;
  requiereSegundaFirma: boolean;
  guardando: boolean;
  error: string | null;
  exito: boolean;
}

const filaInicial = (e: EmpleadoConJefatura): Fila => ({
  aprobadorCorreo: e.aprobadorCorreo,
  copiaCorreo: e.copiaCorreo,
  veAdjuntos: e.veAdjuntos,
  requiereSegundaFirma: e.requiereSegundaFirma,
  guardando: false,
  error: null,
  exito: false,
});

interface Props {
  /** Carga diferida: la pestaña queda montada aunque esté oculta. */
  activo: boolean;
}

export default function PanelOrganigrama({ activo }: Props) {
  const [empleados, setEmpleados] = useState<EmpleadoConJefatura[]>([]);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  // Arranca en true por lo mismo que PanelSaldos: con false, «aún no he pedido
  // nada» y «no hay empleados» renderizan igual.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const yaCargado = useRef(false);
  const timeoutsExito = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  /**
   * Recarga el maestro. `idResincronizar` es la fila que se acaba de guardar.
   *
   * Las demás filas CONSERVAN lo que el usuario tenga a medio editar. Antes esto
   * reconstruía `filas` entero desde el servidor, y como `guardar` termina
   * llamando aquí, pulsar el botón de una fila descartaba en silencio lo escrito
   * en todas las demás: sus botones se apagaban y el cambio se perdía. Con una
   * sola columna editable casi no se notaba; con la de copia al lado, editar
   * varias filas antes de guardar es el caso normal.
   *
   * La que sí se resincroniza es la recién guardada, porque el servidor pudo
   * normalizar el valor —los correos se guardan en minúsculas— y hay que quedarse
   * con lo que de verdad haya en la base, no con lo que se tecleó.
   */
  function cargar(idResincronizar?: string) {
    setCargando(true);
    return fetchEmpleados()
      .then((es) => {
        yaCargado.current = true;
        setEmpleados(es);
        setFilas((previas) =>
          Object.fromEntries(
            es.map((e) => {
              const previa = previas[e.id];
              if (!previa || e.id === idResincronizar) return [e.id, filaInicial(e)];
              return [e.id, previa];
            }),
          ),
        );
        setError(null);
      })
      .catch((e: Error) => {
        // El listado se vacía a propósito: dejar el organigrama anterior bajo un
        // error es enseñar un árbol que ya no se sostiene.
        setEmpleados([]);
        setError(e.message);
      })
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    if (!activo || yaCargado.current) return;
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  useEffect(() => {
    return () => {
      Object.values(timeoutsExito.current).forEach(clearTimeout);
    };
  }, []);

  function actualizar(id: string, campos: Partial<Fila>) {
    setFilas((fs) => ({ ...fs, [id]: { ...fs[id], ...campos } }));
  }

  async function guardar(id: string) {
    const fila = filas[id];
    if (!fila) return;
    actualizar(id, { guardando: true, error: null, exito: false });
    try {
      // Un solo botón por fila, como hasta ahora, pero CUATRO endpoints detrás: se
      // llama a cada uno solo si su campo cambió. Secuencial y no en paralelo
      // porque los cuatro responden el maestro entero y cada uno tiene que ver ya
      // escrito lo del anterior — con `Promise.all`, la respuesta que llegara
      // última podría ser la construida ANTES de los otros cambios.
      const empleado = empleados.find((x) => x.id === id);
      if (fila.aprobadorCorreo !== empleado?.aprobadorCorreo) await fijarJefe(id, fila.aprobadorCorreo);
      if (fila.copiaCorreo !== empleado?.copiaCorreo) await fijarCopia(id, fila.copiaCorreo);
      if (fila.veAdjuntos !== empleado?.veAdjuntos) await fijarVisor(id, fila.veAdjuntos);
      if (fila.requiereSegundaFirma !== empleado?.requiereSegundaFirma)
        await fijarSegundaFirma(id, fila.requiereSegundaFirma);
      // Se recarga el maestro entero y no solo esta fila: cambiar el jefe de
      // alguien cambia la SEGUNDA firma de todos los que cuelgan de él, y dejar
      // esas filas con el valor viejo sería mentir sobre a quién sube su
      // solicitud.
      await cargar(id);
      actualizar(id, { exito: true });
      clearTimeout(timeoutsExito.current[id]);
      timeoutsExito.current[id] = setTimeout(() => {
        actualizar(id, { exito: false });
        delete timeoutsExito.current[id];
      }, 2000);
    } catch (e) {
      actualizar(id, { guardando: false, error: (e as Error).message });
    }
  }

  const activos = empleados.filter((e) => e.activo);
  const enCiclo = activos.filter((e) => e.enCiclo);

  // Correo → nombre, para poder enseñar la segunda firma como persona y no como
  // buzón. Se construye sobre `empleados` y no sobre `activos` para que un jefe
  // recién desactivado siga teniendo nombre mientras la lista se recarga.
  const nombrePorCorreo = new Map(empleados.map((e) => [e.correo.toLowerCase(), e.nombreCompleto]));

  /** El nombre de quien firma, o el correo tal cual si no tiene ficha —el buzón
   *  por defecto no la tiene, y enseñar un hueco sería peor que enseñar el correo. */
  const quienFirma = (correo: string) => nombrePorCorreo.get(correo.toLowerCase()) ?? correo;

  return (
    // Sin `mt-10 border-t pt-8` ni encabezado propio: los tenía cuando compartía
    // pestaña con la importación de empleados, y ahora dejarían una raya sin nada
    // encima y un título que repite el nombre de la pestaña.
    <div>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        El <b>jefe inmediato</b> es quien da el primer visto bueno a las solicitudes de esa
        persona. <b>Quién</b> sería la segunda firma se deduce solo: es el jefe de su jefe —quien
        no tenga a nadie por encima cierra con una sola firma—. Que haga falta o no, lo decides
        tú con la casilla <b>Necesaria</b>.
      </p>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Si desmarcas <b>Necesaria</b>, la solicitud queda aprobada con la firma del jefe inmediato.
        Quien estaba en el segundo escalón <b>sigue recibiendo el correo</b> con el resultado,
        aprobado o rechazado; lo que pierde es tener que firmarlo, y con ello el acceso al soporte
        adjunto de esa solicitud —salvo que tenga marcada <b>Soportes</b>—. Si no hay nadie por
        encima, la casilla no cambia nada.
      </p>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Cambiar el organigrama <b>o esta casilla</b> no mueve las solicitudes que ya están en
        trámite: cada una lleva anotado desde que se envió quién la firma y a quién se informa
        del resultado.
      </p>
      <p className="mb-4 flex max-w-3xl items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Quien esté en <b>copia</b> recibirá también los acuses de <b>incapacidad</b> de esa persona, que son
          información de salud. Y la casilla <b>Soportes</b> es una llave maestra: quien la tenga puede abrir el PDF de
          cualquier incapacidad de cualquier persona, no solo de su equipo. Esa lista debe quedarse corta y cada
          persona tener un motivo. Quién la da o la quita queda registrado.
        </span>
      </p>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {enCiclo.length > 0 && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Hay {enCiclo.length} {enCiclo.length === 1 ? 'persona' : 'personas'} en un círculo del
            organigrama ({enCiclo.map((e) => e.nombreCompleto).join(', ')}). Sus solicitudes se
            cierran con una sola firma hasta que se deshaga.
          </span>
        </p>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando el organigrama…
        </p>
      ) : activos.length === 0 ? (
        !error && <p className="text-sm text-gray-500">No hay empleados activos.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Persona</th>
                <th className="px-4 py-3 font-medium">Jefe inmediato (1ª firma)</th>
                <th className="px-4 py-3 font-medium">2ª firma</th>
                <th className="px-4 py-3 font-medium">Copia</th>
                <th className="px-4 py-3 font-medium">Soportes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activos.map((e) => {
                const fila = filas[e.id];
                if (!fila) return null;
                // Se compara contra lo GUARDADO, no contra un flag de «tocado»:
                // volver al valor original tras cambiar de idea vuelve a dejar el
                // botón apagado, que es lo que la fila dice de verdad.
                const haCambiado =
                  fila.aprobadorCorreo !== e.aprobadorCorreo ||
                  fila.copiaCorreo !== e.copiaCorreo ||
                  fila.veAdjuntos !== e.veAdjuntos ||
                  fila.requiereSegundaFirma !== e.requiereSegundaFirma;
                const arriba = e.segundoAprobadorCorreo ?? e.informadoCorreo;
                return (
                  <tr key={e.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{e.nombreCompleto}</div>
                      <div className="text-xs text-gray-500">{e.correo}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={fila.aprobadorCorreo}
                        onChange={(ev) => actualizar(e.id, { aprobadorCorreo: ev.target.value, error: null })}
                        aria-label={`Jefe inmediato de ${e.nombreCompleto}`}
                        className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        {/* El propio empleado sale en su lista: elegirse a uno mismo
                            es como se declara la raíz del organigrama. */}
                        {activos.map((j) => (
                          <option key={j.id} value={j.correo}>
                            {j.correo === e.correo ? `${j.nombreCompleto} (sin jefe: raíz)` : j.nombreCompleto}
                          </option>
                        ))}
                        {/* El valor actual puede no estar en la lista: el buzón por
                            defecto no tiene ficha de empleado y hoy cuelga de él
                            toda la plantilla. Sin esta opción el <select> se
                            mostraría en blanco y guardar cambiaría el jefe sin que
                            nadie lo hubiera pedido. */}
                        {!activos.some((j) => j.correo === fila.aprobadorCorreo) && (
                          <option value={fila.aprobadorCorreo}>{fila.aprobadorCorreo}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          // `!!` por lo mismo que en la casilla de soportes: una
                          // fila de un backend que aún no mande el campo volvería
                          // el checkbox «no controlado» a medio render.
                          checked={!!fila.requiereSegundaFirma}
                          onChange={(ev) =>
                            actualizar(e.id, { requiereSegundaFirma: ev.target.checked, error: null })
                          }
                          aria-label={`Las solicitudes de ${e.nombreCompleto} necesitan dos firmas`}
                          aria-describedby={`arriba-${e.id}`}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
                        />
                        Necesaria
                      </label>
                      {/* Quién está arriba sale de lo GUARDADO (`e`): cambiar el
                          jefe en el desplegable sí cambia el abuelo, y el
                          navegador no puede recalcularlo. Su PAPEL sale de lo
                          editado (`fila`) porque los cuatro cortes de
                          `aprobadoresDe` se aplican ANTES de mirar la casilla:
                          firmante o informado es el mismo correo en otra ranura,
                          no hay nada que adivinar. */}
                      <div id={`arriba-${e.id}`} className="mt-1 text-xs">
                        {arriba ? (
                          <span title={arriba} className={fila.requiereSegundaFirma ? undefined : 'text-gray-500'}>
                            {quienFirma(arriba)}
                            {!fila.requiereSegundaFirma && ' — solo informado'}
                          </span>
                        ) : (
                          <span className="text-gray-400">— una sola firma</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={fila.copiaCorreo ?? ''}
                        onChange={(ev) => actualizar(e.id, { copiaCorreo: ev.target.value || null, error: null })}
                        aria-label={`Copia de ${e.nombreCompleto}`}
                        className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">— sin copia</option>
                        {/* El propio empleado sale en su lista: ponerse a uno mismo
                            es inofensivo porque el servidor deduplica los
                            destinatarios, y excluirlo sería una regla más que
                            explicar por un caso que no rompe nada. */}
                        {activos.map((j) => (
                          <option key={j.id} value={j.correo}>
                            {j.nombreCompleto}
                          </option>
                        ))}
                        {/* Misma red que en el jefe: el valor guardado puede no
                            estar entre los activos (por ejemplo si esa persona se
                            dio de baja después). Sin esto el select saldría en
                            blanco y guardar borraría la copia sin pedirlo. */}
                        {fila.copiaCorreo && !activos.some((j) => j.correo === fila.copiaCorreo) && (
                          <option value={fila.copiaCorreo}>{fila.copiaCorreo}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          // `!!` y no el valor tal cual: si algún día llega una fila
                          // de un backend que aún no manda `veAdjuntos`, `undefined`
                          // volvería este checkbox «no controlado» a medio render y
                          // React lo avisaría a gritos en la consola.
                          checked={!!fila.veAdjuntos}
                          onChange={(ev) => actualizar(e.id, { veAdjuntos: ev.target.checked, error: null })}
                          aria-label={`${e.nombreCompleto} puede abrir cualquier soporte`}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
                        />
                        Todos
                      </label>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          // Apagado mientras no haya nada que guardar: en una tabla
                          // de una fila por persona, un botón activo en todas invita
                          // a pulsar el de al lado por error.
                          disabled={fila.guardando || !haCambiado}
                          onClick={() => void guardar(e.id)}
                          // «La fila», no «el jefe»: este botón guarda también la
                          // copia, la llave de los soportes y la segunda firma, y
                          // un rótulo que nombre solo uno de los cuatro campos
                          // engaña justo a quien no puede ver cuál ha cambiado.
                          aria-label={`Guardar la fila de ${e.nombreCompleto}`}
                          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                        >
                          {fila.guardando ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : fila.exito ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Guardar
                        </button>
                        {/* Cambiar un icono no le dice nada a quien usa lector de
                            pantalla: sin este texto el guardado pasa inadvertido. */}
                        {fila.exito && (
                          <span role="status" className="sr-only">
                            Cambios de {e.nombreCompleto} guardados.
                          </span>
                        )}
                        {fila.error && (
                          <span role="alert" className="max-w-[16rem] text-right text-xs text-red-600">
                            {fila.error}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
