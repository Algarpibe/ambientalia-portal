import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { api, type Inventario } from '../api';
import { CONTACTO_MAX_EMAILS, planAvisos, type AvisoEquipo, type ContactoCliente, type CorreoSimulado, type Destinatario, type EquipoVista, type TramoAviso } from '../dominio';
import { correoAviso, etiquetaOrigen, fechaRelevante, resumenSimulacion, revisarEmails, textoParaCopiar } from '../lib/simulacion';
import { fmtFecha } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, TONO, Tag } from '../ui';

/**
 * Sub-vista «Simulación automática» de «Avisos a clientes»: qué correos
 * mandaría HOY el aviso automático a 90, 60 y 30 días, a quién y con qué
 * texto, y qué equipos quedan fuera y por qué.
 *
 * Es un ensayo: aquí no hay botón de enviar ni nada que envíe. Lo único que
 * se guarda es el contacto puesto a mano a un cliente (a quién se le
 * escribiría), y el texto se puede copiar para mandarlo a mano.
 */
interface Props {
  equipos: EquipoVista[];
  hoy: string;
  contactos: ContactoCliente[];
  onFicha: (clave: string) => void;
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

const INPUT =
  'block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

/** Clases de la etiqueta de cada tramo: las mismas que el estado «vence en …» de ese tramo. */
const TONO_TRAMO: Record<TramoAviso, string> = { 90: TONO.VENCE_90.badge, 60: TONO.VENCE_60.badge, 30: TONO.VENCE_30.badge };
const TITULO_TRAMO: Record<TramoAviso, string> = { 90: 'Primer aviso', 60: 'Recordatorio', 30: 'Último aviso' };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const idGrupo = (c: CorreoSimulado<EquipoVista>) => `${c.tramo}|${c.claveCliente}`;

export default function SimulacionAvisos({ equipos, hoy, contactos, onFicha, onInventario, notificar }: Props) {
  const plan = useMemo(() => planAvisos(equipos, hoy, contactos), [equipos, hoy, contactos]);
  const r = resumenSimulacion(plan);
  const manualDe = useMemo(() => new Map(contactos.map((c) => [c.clave, c])), [contactos]);
  /** El grupo cuyo editor de contacto está abierto. */
  const [editando, setEditando] = useState<string | null>(null);
  /** Poner o cambiar el contacto de un cliente es lo único que aquí escribe: sin el permiso no se ofrece. */
  const { puede, motivo } = usePermisos();
  const puedeContactos = puede('contactos.write');

  const editor =(c: CorreoSimulado<EquipoVista>, onCancel?: () => void) => (
    <EditorContacto
      cliente={c.cliente}
      actual={manualDe.get(c.claveCliente)}
      onCancel={onCancel}
      onGuardado={(inv, msg) => {
        onInventario(inv);
        setEditando(null);
        notificar(msg);
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="amber" title="Simulación: no se envía ningún correo">
        <p>
          Esto es lo que el aviso automático enviaría hoy ({fmtFecha(hoy)}) a 90, 60 y 30 días del vencimiento. Estamos en fase de pruebas: la app no manda nada a ningún cliente. Sirve para
          revisar destinatarios y textos. Si quieres avisar a alguien, copia el texto, envíalo tú y márcalo como avisado en la vista «Manual».
        </p>
      </Alert>

      <p className="text-sm text-gray-700" aria-live="polite">
        <strong className="font-semibold text-gray-900">{plural(r.correos, 'correo simulado', 'correos simulados')}</strong> a {plural(r.clientes, 'cliente', 'clientes')} ·{' '}
        {plural(r.equipos, 'equipo', 'equipos')} · {plural(r.sinDestinatario, 'grupo', 'grupos')} sin destinatario
      </p>

      <section aria-labelledby="sim-correos" className="flex flex-col gap-3">
        <h3 id="sim-correos" className="text-base font-semibold text-gray-900">
          Correos que se enviarían hoy ({plan.correos.length})
        </h3>
        {plan.correos.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Hoy el aviso automático no enviaría ningún correo{plan.sinDestinatario.length > 0 ? ': los grupos a los que toca avisar no tienen destinatario (abajo).' : '.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {plan.correos.map((c) => {
              const id = idGrupo(c);
              return (
                <Tarjeta key={id} correo={c} onFicha={onFicha}>
                  <Destinatarios lista={c.destinatarios} />
                  <Vista correo={c} notificar={notificar} />
                  {puedeContactos &&
                    (editando === id ? (
                      editor(c, () => setEditando(null))
                    ) : (
                      <div>
                        <Button variant="ghost" className="-ml-2" onClick={() => setEditando(id)}>
                          <Pencil className="h-4 w-4" aria-hidden /> Cambiar destinatario
                        </Button>
                      </div>
                    ))}
                </Tarjeta>
              );
            })}
          </div>
        )}
      </section>

      {plan.sinDestinatario.length > 0 && (
        <section aria-labelledby="sim-sin-destinatario" className="flex flex-col gap-3">
          <div>
            <h3 id="sim-sin-destinatario" className="text-base font-semibold text-gray-900">
              Sin destinatario ({plan.sinDestinatario.length})
            </h3>
            <p className="text-sm text-gray-500">
              A estos clientes les tocaría el aviso, pero ningún ticket de Desk de sus equipos trae un correo que sirva (los correos de Ambientalia no cuentan).{' '}
              {puedeContactos ? 'Ponles un contacto.' : `Falta ponerles un contacto. ${motivo}`}
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {plan.sinDestinatario.map((c) => (
              <Tarjeta key={idGrupo(c)} correo={c} onFicha={onFicha}>
                {puedeContactos && editor(c)}
              </Tarjeta>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <Informativo titulo="Ya avisados en este tramo" nota="Tienen un aviso registrado desde que entraron en su tramo: no se les repite hasta el siguiente." lista={plan.yaAvisados} onFicha={onFicha} />
        <Informativo titulo="En servicio" nota="En un tramo, pero ya en Ambientalia o con un ticket abierto en Desk: no se les avisa." lista={plan.enServicio} onFicha={onFicha} />
        <Informativo
          titulo="Vencidas sin aviso"
          nota="Vencidas hace menos de un año, fuera de servicio y sin aviso desde que vencieron. El aviso automático no las cubre: avísales desde la vista «Manual»."
          lista={plan.vencidasSinAviso}
          onFicha={onFicha}
        />
        <Informativo titulo="Fuera de ciclo" nota="Vencidas hace más de un año. El aviso automático no las cubre." lista={plan.fueraCiclo} onFicha={onFicha} />
      </div>
    </div>
  );
}

/** La tarjeta de un grupo (cliente + tramo): cabecera, equipos y lo que se le cuelgue. */
function Tarjeta({ correo: c, onFicha, children }: { correo: CorreoSimulado<EquipoVista>; onFicha: (clave: string) => void; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <h4 className="break-words text-base font-semibold text-gray-900">{c.cliente}</h4>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONO_TRAMO[c.tramo]}`}>
            {TITULO_TRAMO[c.tramo]} · {c.tramo} días
          </span>
          <Tag>{plural(c.equipos.length, 'equipo', 'equipos')}</Tag>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Equipos de {c.cliente} en el tramo de {c.tramo} días</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Serial</th>
              <th scope="col">Modelo</th>
              <th scope="col">Vence</th>
              <th scope="col">Días que quedan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {c.equipos.map(({ equipo: e, vence, diasParaVencer }) => (
              <tr key={e.clave}>
                <td className="py-1.5 pr-2">
                  <button type="button" onClick={() => onFicha(e.clave)} className="rounded font-mono text-[13px] text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                    {e.serial}
                  </button>
                </td>
                <td className="py-1.5 pr-2 text-gray-600">{e.modelo}</td>
                <td className="py-1.5 pr-2 tabular-nums text-gray-600">{fmtFecha(vence)}</td>
                <td className={`py-1.5 text-right font-semibold tabular-nums ${TONO[e.estado].text}`}>{diasParaVencer} d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </article>
  );
}

function Destinatarios({ lista }: { lista: Destinatario[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Para</p>
      <ul className="flex flex-wrap gap-1.5">
        {lista.map((d) => (
          <li
            key={d.email}
            className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm"
            title={d.ticket === null ? 'Puesto a mano para este cliente' : `Contacto del ticket ${d.ticket} de Zoho Desk`}
          >
            <span className="break-all text-gray-900">
              {d.nombre && <span className="font-medium">{d.nombre} · </span>}
              {d.email}
            </span>
            <Tag tone={d.origen === 'manual' ? 'blue' : 'gray'}>{etiquetaOrigen(d.origen)}</Tag>
            {d.interno && <Tag tone="amber">interno</Tag>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Asunto y cuerpo del correo simulado, plegados, con su botón de copiar. Sin botón de enviar: no hay envío. */
function Vista({ correo, notificar }: { correo: CorreoSimulado<EquipoVista>; notificar: (m: string) => void }) {
  const c = useMemo(() => correoAviso(correo), [correo]);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(c));
      notificar('Texto copiado');
    } catch {
      notificar('No se pudo copiar: selecciona el texto y usa Ctrl+C');
    }
  }
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">Ver asunto y texto</summary>
      <div className="flex flex-col gap-2 border-t border-gray-200 p-3">
        <p className="text-sm">
          <span className="text-gray-500">Asunto: </span>
          <span className="font-medium text-gray-900">{c.asunto}</span>
        </p>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-800">{c.cuerpo}</pre>
        <div>
          <Button onClick={() => void copiar()}>
            <Copy className="h-4 w-4" aria-hidden /> Copiar texto
          </Button>
        </div>
      </div>
    </details>
  );
}

/**
 * Editor del contacto puesto a mano a un cliente: sus correos (hasta cinco) y,
 * si se quiere, el nombre de la persona. Vale para TODOS los equipos del
 * cliente y gana al contacto de Desk; con los correos vacíos se quita y vuelve
 * a valer el de Desk.
 */
function EditorContacto({
  cliente,
  actual,
  onCancel,
  onGuardado,
}: {
  cliente: string;
  actual: ContactoCliente | undefined;
  onCancel?: () => void;
  onGuardado: (inv: Inventario, msg: string) => void;
}) {
  const id = useId();
  const [emails, setEmails] = useState(actual?.emails.join(', ') ?? '');
  const [nombre, setNombre] = useState(actual?.nombre ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rev = revisarEmails(emails);
  const quitar = rev.emails.length === 0;

  async function guardar(lista: string[]) {
    setGuardando(true);
    setError(null);
    try {
      const inv = await api.guardarContacto(cliente, lista, lista.length === 0 ? '' : nombre.trim());
      onGuardado(inv, lista.length === 0 ? `Contacto manual de ${cliente} quitado` : `Contacto de ${cliente} guardado`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  function enviarFormulario(ev: FormEvent) {
    ev.preventDefault();
    if (rev.error) {
      setError(rev.error);
      return;
    }
    void guardar(rev.emails);
  }

  return (
    <form onSubmit={enviarFormulario} className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3" aria-label={`Contacto de ${cliente}`}>
      <p className="text-xs text-gray-600">
        Contacto para todos los equipos de <strong className="font-semibold">{cliente}</strong>. Gana al que venga de Desk.
        {actual && ` Puesto por ${actual.actualizadoPor} el ${fmtFecha(actual.actualizadoEn)}.`}
      </p>
      <label htmlFor={`${id}-emails`} className="block text-sm">
        <span className="mb-1 block font-medium text-gray-700">Correos (hasta {CONTACTO_MAX_EMAILS}, separados por comas o espacios)</span>
        <input
          id={`${id}-emails`}
          type="text"
          inputMode="email"
          autoComplete="off"
          className={INPUT}
          value={emails}
          onChange={(ev) => {
            setEmails(ev.target.value);
            setError(null);
          }}
          placeholder="compras@example.com, mantenimiento@example.com"
          aria-invalid={rev.error !== null}
          aria-describedby={`${id}-ayuda`}
        />
      </label>
      <label htmlFor={`${id}-nombre`} className="block text-sm">
        <span className="mb-1 block font-medium text-gray-700">Nombre del contacto (opcional)</span>
        <input id={`${id}-nombre`} type="text" maxLength={200} autoComplete="off" className={INPUT} value={nombre} onChange={(ev) => setNombre(ev.target.value)} />
      </label>
      <div id={`${id}-ayuda`} className="flex flex-col gap-1 text-xs">
        {rev.error && <p className="text-red-700">{rev.error}</p>}
        {rev.internos.length > 0 && <p className="text-amber-800">Correo interno de Ambientalia ({rev.internos.join(', ')}): vale para probar, pero no es del cliente.</p>}
        {quitar && actual && <p className="text-gray-600">Sin correos, se quita el contacto manual y vuelve a valer el de Desk.</p>}
      </div>
      {error && !rev.error && <Alert tone="red">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={guardando} disabled={rev.error !== null || (quitar && !actual)}>
          {quitar && actual ? 'Quitar contacto manual' : 'Guardar contacto'}
        </Button>
        {actual && !quitar && (
          <Button disabled={guardando} onClick={() => void guardar([])}>
            Quitar y volver al de Desk
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" disabled={guardando} onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

/** Una sección informativa plegada: por qué esos equipos no están en la simulación. */
function Informativo({ titulo, nota, lista, onFicha }: { titulo: string; nota: string; lista: AvisoEquipo<EquipoVista>[]; onFicha: (clave: string) => void }) {
  return (
    <details className="rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
        {titulo} <Tag>{lista.length}</Tag>
      </summary>
      <div className="border-t border-gray-200 px-4 py-3">
        <p className="mb-2 text-xs text-gray-500">{nota}</p>
        {lista.length === 0 ? (
          <p className="text-sm text-gray-500">Ninguno.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {lista.map((a) => (
              <li key={a.equipo.clave} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="min-w-0 break-words text-gray-900">{a.equipo.cliente}</span>
                <button type="button" onClick={() => onFicha(a.equipo.clave)} className="rounded font-mono text-[13px] text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                  {a.equipo.serial}
                </button>
                <span className="text-gray-500">{fechaRelevante(a)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
