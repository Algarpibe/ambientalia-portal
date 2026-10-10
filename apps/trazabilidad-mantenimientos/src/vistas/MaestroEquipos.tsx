import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { CambioMaestro, EquipoRevisar, RespuestaCruceFst022, RespuestaPlanMaestro } from '../dominio';
import { bloquesDetalle, hayQueAplicar, lineasPlan, textoCambio, textoUltima, type LineaPlan } from '../lib/maestro';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, Loading, Modal, Tag } from '../ui';

interface Props {
  notificar: (msg: string) => void;
  /** Tras sincronizar: el inventario de la app (Resumen, Equipos, Calendario, Avisos) hay que leerlo otra vez. */
  onSincronizado: () => void;
}

/** Títulos cortos, para que la cabecera quepa en una línea; el largo va en el `title` y en la nota de debajo. */
const COLUMNAS_CRUCE: [string, string][] = [
  ['Marca', 'Marca'],
  ['Hoja', 'Filas de equipo en la hoja congelada'],
  ['Desk', 'Equipos en Desk 2.0'],
  ['Casan', 'Casan por serial'],
  ['Sólo hoja', 'Sólo en la hoja'],
  ['Sólo Desk', 'Sólo en Desk 2.0'],
  ['Ambig.', 'Ambiguos: serial repetido en alguno de los dos lados'],
  ['Sin ceros', 'De «sólo hoja», los de serial numérico que casarían ignorando los ceros a la izquierda'],
];

function Lineas({ lineas }: { lineas: LineaPlan[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {lineas.map((l) => (
        <div key={l.texto} className={`contents ${l.aviso ? 'font-semibold text-amber-900' : l.cambia ? 'font-semibold text-blue-900' : ''}`}>
          <dt className={l.aviso ? '-mx-1 rounded bg-amber-100 px-1' : l.cambia ? '' : 'text-gray-600'}>{l.texto}</dt>
          <dd className={`text-right font-semibold tabular-nums ${l.aviso ? '-mx-1 rounded bg-amber-100 px-1' : ''}`}>{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const cambio = (c: CambioMaestro): [string, string] => [c.clave, textoCambio(c)];
const equipo = (e: EquipoRevisar): [string, string] => [`${e.origen === 'desk' ? 'Desk 2.0' : 'Portal'} · ${e.serial}`, `${e.cliente || '(sin cliente)'}${e.activo ? '' : ' · inactivo'}`];

/** Un bloque plegable del detalle: equipo (en negrita) y lo que le pasa. Vacío no se pinta. */
function Bloque({ titulo, nota, items, abierto = false }: { titulo: string; nota?: string; items: [string, string][]; abierto?: boolean }) {
  if (items.length === 0) return null;
  return (
    <details open={abierto} className="text-xs text-gray-700">
      <summary className="cursor-pointer text-sm font-medium text-gray-800">{titulo}</summary>
      {nota && <p className="mt-1 text-gray-500">{nota}</p>}
      <ul className="mt-2 flex flex-col gap-1">
        {items.map(([quien, que], i) => <li key={`${quien}-${i}`}><span className="font-mono font-semibold">{quien}</span> · {que}</li>)}
      </ul>
    </details>
  );
}

/**
 * «Maestro de equipos · Desk 2.0», en Configuración: el inventario de GRIMM EDM
 * 180 se alimenta de los equipos de Desk 2.0, a mano. La ve cualquiera con la
 * app (el plan del cruce en recuentos, la última sincronización y el cruce
 * informativo por marca con la F-ST-022 congelada); «Sincronizar con Desk 2.0»
 * sólo le sale a quien tiene el permiso `maestro.sincronizar` (el Director
 * Técnico y los administradores del portal), con una confirmación que repite
 * los recuentos y enseña los cambios uno a uno. Sin Desk 2.0 no deja aplicar.
 */
export default function MaestroEquipos({ notificar, onSincronizado }: Props) {
  const { puede, motivo } = usePermisos();
  const [datos, setDatos] = useState<RespuestaPlanMaestro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cruce, setCruce] = useState<RespuestaCruceFst022 | null>(null);
  const [errorCruce, setErrorCruce] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.planMaestro());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** El cruce por marca se pide al desplegarlo (una vez): es otra lectura de Desk 2.0. */
  const abrirCruce = (abierto: boolean) => {
    if (!abierto || cruce) return;
    setErrorCruce(null);
    api.cruceMaestro().then(setCruce, (e: Error) => setErrorCruce(e.message));
  };

  const aplicar = async () => {
    if (!datos?.plan) return;
    setAplicando(true);
    setErrorAplicar(null);
    try {
      await api.sincronizarMaestro(datos.plan.huella);
      setConfirmar(false);
      setCruce(null);
      notificar('Inventario sincronizado con Desk 2.0');
      onSincronizado();
    } catch (e) {
      setErrorAplicar((e as Error).message);
    } finally {
      setAplicando(false);
      // También tras un error: si el plan cambió, que se vea el de ahora.
      await cargar();
    }
  };

  const plan = datos?.plan ?? null;
  const lineas = plan ? lineasPlan(plan.recuentos) : [];
  const pendiente = plan !== null && hayQueAplicar(plan.recuentos);
  const sincroniza = puede('maestro.sincronizar');
  const detalle = datos?.detalle ?? [];
  const sinEnsenar = (datos?.detalleTotal ?? 0) - detalle.length;
  const bloques = bloquesDetalle(detalle);
  const revisar = datos?.revisar ?? { soloPortal: [], ambiguos: [] };

  return (
    <Card
      title="Maestro de equipos · Desk 2.0"
      hint="El inventario de GRIMM EDM 180 sale de los equipos de Desk 2.0. Se sincroniza a mano, después de ver el plan: no hay sincronización automática. La fecha de calibración no se toca."
      actions={sincroniza && plan ? <Button variant="primary" onClick={() => { setErrorAplicar(null); setConfirmar(true); }}>Sincronizar con Desk 2.0</Button> : undefined}
    >
      {error && <Alert tone="red">{error}</Alert>}
      {/* Si al aplicar el maestro dejó de contestar ya no hay plan (ni diálogo): el motivo se dice aquí. */}
      {errorAplicar && !plan && <Alert tone="red">{errorAplicar}</Alert>}
      {!datos && !error && <Loading texto="Cargando el plan del maestro de equipos…" />}
      {datos && (
        <div className="flex max-w-2xl flex-col gap-3 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            {datos.maestro.disponible ? <Tag tone="blue">Disponible</Tag> : <Tag tone="amber">No disponible</Tag>}
            {datos.maestro.disponible ? 'Desk 2.0 contesta' : 'El maestro de equipos no está disponible'}
          </p>
          {!datos.maestro.disponible && (
            <Alert tone="amber" title="No se puede sincronizar ahora">
              {datos.maestro.mensaje} El inventario sigue como estaba y el resto de la app funciona igual.
            </Alert>
          )}
          <p className="text-xs text-gray-500">Última sincronización: {datos.ultima ? textoUltima(datos.ultima) : 'todavía ninguna'}</p>
          {plan && (
            <>
              <h3 className="font-semibold text-gray-900">Plan: qué pasaría al sincronizar ahora</h3>
              <Lineas lineas={lineas} />
              <p className="text-xs text-gray-500">
                {pendiente ? 'En azul, lo que cambiaría; en ámbar, lo que conviene mirar antes.' : 'El inventario ya está como el maestro: sincronizar no cambiaría nada.'} Lo que sólo está en el portal y los ambiguos no se borran ni se desactivan; el seguimiento y los
                contactos se conservan. {!sincroniza && `Sincroniza el Director Técnico. ${motivo}`}
              </p>
            </>
          )}
          <details className="text-xs text-gray-600" onToggle={(e) => abrirCruce(e.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">Cruce informativo con la F-ST-022 congelada, por marca</summary>
            {errorCruce && <Alert tone="red">{errorCruce}</Alert>}
            {!cruce && !errorCruce && <Loading texto="Cruzando la hoja congelada con Desk 2.0…" />}
            {cruce && (!cruce.maestro.disponible || !cruce.congelacion) && (
              <p className="mt-2">{cruce.maestro.disponible ? 'Este entorno no tiene ninguna congelación de la F-ST-022 con la que cruzar.' : cruce.maestro.mensaje}</p>
            )}
            {cruce && cruce.marcas.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <p className="mb-2">Todas las marcas, por serial, entre «{cruce.congelacion?.archivo}» y Desk 2.0. Sólo informa: al inventario sólo entran los GRIMM EDM 180.</p>
                <table className="w-full text-left tabular-nums">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      {COLUMNAS_CRUCE.map(([t, largo], i) => <th key={t} title={largo} className={`whitespace-nowrap px-2 py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>{t}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {cruce.marcas.map((m) => (
                      <tr key={m.marca} className="border-b border-gray-100">
                        <td className="px-2 py-1 font-medium text-gray-800">{m.marca}</td>
                        {[m.v3, m.desk, m.casan, m.soloV3, m.soloDesk, m.ambiguos, m.sinCeros].map((n, i) => <td key={i} className="px-2 py-1 text-right">{n}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-gray-500">«Ambig.» = serial repetido en alguno de los dos lados. «Sin ceros» = de los que sólo están en la hoja, los de serial numérico que casarían ignorando los ceros a la izquierda.</p>
              </div>
            )}
          </details>
        </div>
      )}
      {confirmar && plan && (
        <Modal
          title="Sincronizar con Desk 2.0"
          onClose={() => !aplicando && setConfirmar(false)}
          footer={
            <>
              <Button onClick={() => setConfirmar(false)} disabled={aplicando}>Cancelar</Button>
              <Button variant="primary" onClick={() => void aplicar()} busy={aplicando}>{pendiente ? 'Sincronizar' : 'Confirmar sin cambios'}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm">
            {errorAplicar && <Alert tone="red">{errorAplicar}</Alert>}
            <p>Se aplicará este plan al inventario de GRIMM EDM 180, firmado con tu correo. La fecha de calibración, el seguimiento y los contactos no se tocan, y no se borra ningún equipo.</p>
            {/* Las altas, lo primero y destacadas: son equipos nuevos en el inventario y, entre cien cambios de nombre, pasan desapercibidas. */}
            {bloques.altas.length > 0 && (
              <Alert tone="amber" title={`Altas: ${bloques.altas.length} ${bloques.altas.length === 1 ? 'equipo nuevo entrará' : 'equipos nuevos entrarán'} al inventario`}>
                <p>Nacen <strong>sin fecha de calibración</strong> («Sin fecha»). Si alguno no debería estar (un equipo de prueba, por ejemplo), cancela y desactívalo antes en Desk 2.0.</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {bloques.altas.map((c) => <li key={c.clave} className="font-semibold">{c.despues}</li>)}
                </ul>
              </Alert>
            )}
            <Lineas lineas={lineas} />
            <Bloque abierto titulo={`Clientes con otro nombre (${bloques.otroNombre.length})`} nota="No es sólo la forma de escribirlo: puede ser el mismo cliente con sus siglas o su razón social completa, otro cliente o una errata. Míralos uno a uno." items={bloques.otroNombre.map(cambio)} />
            <Bloque abierto titulo={`Otros cambios: modelo, serial y activo (${bloques.otros.length})`} items={bloques.otros.map(cambio)} />
            <Bloque titulo={`Clientes que sólo cambian de forma: mayúsculas, tildes, puntuación o forma societaria (${bloques.mismaForma.length})`} items={bloques.mismaForma.map(cambio)} />
            <Bloque titulo={`Sólo en el portal: no se tocan (${revisar.soloPortal.length})`} nota="No están entre los GRIMM EDM 180 de Desk 2.0. Si el serial está escrito distinto allí, corrígelo en Desk 2.0." items={revisar.soloPortal.map(equipo)} />
            <Bloque titulo={`Ambiguos, con el serial repetido: no se tocan (${revisar.ambiguos.length})`} nota="El serial se repite en Desk 2.0, o el portal lo tiene en dos equipos activos (o en ninguno activo)." items={revisar.ambiguos.map(equipo)} />
            {sinEnsenar > 0 && <p className="text-xs text-gray-600">…y {sinEnsenar} cambios más que no caben aquí; quedarán en la auditoría.</p>}
          </div>
        </Modal>
      )}
    </Card>
  );
}
