// Pantalla «Equipos en taller» (React 19 + Tailwind 3.4 del portal).
// Trasladada SIN rediseño de la pantalla de Desk 2.0 (mismas vistas, columnas, motivos y
// botones que la página de Claude); los datos vienen de /api/equipos-taller. Añade tres
// cosas (§3.2 del diseño): el aviso de foto vieja, el panel de llaves (solo admin) y los
// botones de ajuste ocultos para quien no tenga la llave «edita ajustes». El servidor
// vuelve a comprobar cada llave: aquí solo se ocultan botones. Y quita uno: el de
// «Actualizar información» (11/11/2026), porque cada sincronización de n8n lanza la corrida.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ADENTRO, EST, VISTAS, TONO, SIN_FILTROS, aplicarAjustes, aplicarFiltros, avisoFoto, claveFila, claveIlegible, dias, enlaceArchivo, enlaceCarpeta,
  filasDeVista, hayFiltros, ilegiblesPendientes, opcionesFiltro, Reglas, type Ajuste, type Fila, type Filtros, type Ilegible, type RespuestaEquipos,
} from './nucleo';
import { apiEquipos, type ApiEquipos } from './api';

const TONOS = [
  'bg-emerald-100 text-emerald-900', // en taller
  'bg-amber-100 text-amber-900', // externo, revisar, parciales
  'bg-slate-200 text-slate-800', // cerrado sin salida, retirado
  'bg-sky-100 text-sky-900', // entregado
  'bg-violet-100 text-violet-900', // salió con ticket abierto
];
const enlace = 'text-sky-700 underline underline-offset-2 hover:text-sky-900';
const boton = 'mr-1.5 mt-1.5 rounded border border-slate-300 bg-white px-2 py-0.5 text-[13px] hover:bg-slate-50 disabled:opacity-50';
const fmt = (d: string) => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '');
/** Sin botón para actualizar: lo dicen los textos que antes mandaban a pulsarlo. */
const SOLA = 'Se actualiza sola cada hora, cuando termina la sincronización con n8n.';
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className={enlace} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

interface Pedido {
  clave: string;
  tipo: Ajuste['t'];
  ayuda: string;
}

export default function EquiposServicio({ api: apiProp }: { api?: ApiEquipos }) {
  const api = useMemo(() => apiProp || apiEquipos(), [apiProp]);
  const [datos, setDatos] = useState<RespuestaEquipos | null>(null);
  const [vista, setVista] = useState<string>(EST.TALLER);
  const [aviso, setAviso] = useState('');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [nota, setNota] = useState('');
  // Filtros por cliente y por estado en Desk: aplican a todas las vistas y a los conteos.
  const [fl, setFl] = useState<Filtros>(SIN_FILTROS);

  const cargar = useCallback(async () => {
    try { setDatos(await api.estado()); }
    catch (e) { setAviso('No se pudo cargar: ' + (e as Error).message); }
  }, [api]);
  useEffect(() => { void cargar(); }, [cargar]);
  // No hay botón: la pantalla se actualiza sola con la corrida de cada sincronización de n8n
  // (cada hora) y con la diaria. Mientras hay una en curso, se consulta cada 3 s.
  useEffect(() => {
    if (!datos?.actualizando) return;
    const t = setInterval(() => void cargar(), 3000);
    return () => clearInterval(t);
  }, [datos?.actualizando, cargar]);

  // Al terminar la corrida se piden los datos una vez más: la consulta que vio el final pudo
  // leer la foto justo antes de que se guardara la nueva.
  const estabaActualizando = useRef(false);
  useEffect(() => {
    const ahora = datos?.actualizando === true;
    if (estabaActualizando.current && !ahora) void cargar();
    estabaActualizando.current = ahora;
  }, [datos?.actualizando, cargar]);

  const ajustes = datos?.ajustes || {};
  const snap = datos?.snap || null;
  const puedeEditar = datos?.permisos.puedeEditar ?? false;
  const todas = useMemo(() => aplicarAjustes(snap?.rows || [], ajustes), [snap, ajustes]);
  const filas = useMemo(() => aplicarFiltros(todas, fl), [todas, fl]);
  const pendientes = ilegiblesPendientes(snap, ajustes);
  const hoy = snap?.hoy || new Date().toISOString().slice(0, 10);
  const v = VISTAS.find((x) => x.nombre === vista) || VISTAS[0];
  const lista = filasDeVista(filas, v.nombre);
  const deVista = filasDeVista(todas, v.nombre);
  const selector = (campo: keyof Filtros, titulo: string) => {
    const total = aplicarFiltros(deVista, { ...fl, [campo]: '' }).length;
    return (
      <label className="flex items-center gap-1.5 text-sm text-slate-600">
        {titulo}
        <select value={fl[campo]} onChange={(e) => setFl({ ...fl, [campo]: e.target.value })}
          className={'max-w-xs rounded-md border bg-white px-2 py-1 text-slate-900 ' + (fl[campo] ? 'border-sky-700' : 'border-slate-300')}>
          <option value="">Todos ({total})</option>
          {opcionesFiltro(deVista, campo, fl).map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta} ({o.n})</option>)}
        </select>
      </label>
    );
  };
  const fotoVieja = datos ? avisoFoto(datos, fmt) : null;

  async function guardar(clave: string, tipo: Ajuste['t'], m = '') {
    try {
      const a = await api.guardarAjuste(clave, tipo, m);
      setDatos((d) => (d ? { ...d, ajustes: { ...d.ajustes, [clave]: a } } : d));
      setPedido(null);
      setNota('');
    } catch (e) { setAviso('No se pudo guardar el cambio: ' + (e as Error).message); }
  }
  async function deshacer(claves: string[]) {
    try {
      const existentes = claves.filter((k) => ajustes[k]);
      await Promise.all(existentes.map((k) => api.borrarAjuste(k)));
      setDatos((d) => { if (!d) return d; const aj = { ...d.ajustes }; existentes.forEach((k) => delete aj[k]); return { ...d, ajustes: aj }; });
    } catch (e) { setAviso('No se pudo deshacer: ' + (e as Error).message); }
  }

  // Funciones de dibujo (no componentes) para que el campo de texto no se vuelva a montar al escribir.
  const pregunta = (clave: string) =>
    pedido?.clave === clave ? (
      <div className="mt-1.5 flex gap-1.5">
        <input autoFocus aria-label="Motivo" placeholder={pedido.ayuda} value={nota} onChange={(e) => setNota(e.target.value)}
          className="w-full rounded border border-slate-300 px-1.5 py-0.5" />
        <button className={boton} onClick={() => void guardar(clave, pedido.tipo, nota.trim())}>Guardar</button>
      </div>
    ) : null;
  const pedir = (clave: string, tipo: Ajuste['t'], ayuda: string) => { setPedido({ clave, tipo, ayuda }); setNota(''); };

  function filaEquipo(r: Fila) {
    const z = r.z;
    const k = claveFila(r);
    const adentro = ADENTRO.includes(r.est);
    const revisar = r.est === EST.REVISAR || r.est === EST.CERRADO;
    const motivos = r.why.filter((w) => !adentro || !/^Salida parcial /.test(w));
    return (
      <tr key={r.id} className="border-t border-slate-200 align-top">
        <td className="whitespace-nowrap px-2 py-2 font-mono">{r.sn}</td>
        <td className="px-2 py-2">
          {z?.eq || r.eq || 'Equipo sin identificar'}
          {!z?.eq && r.eq ? <span className="text-slate-500"> (remisión de entrada)</span> : null}
          <div className="text-sm text-slate-500">{r.c}</div>
        </td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">
          <A href={enlaceCarpeta(r.id)}>{r.d}</A>
          <div className="text-sm text-slate-500">{adentro && r.d ? dias(r.d, hoy) + ' días' : ''}</div>
        </td>
        <td className="px-2 py-2">
          {z ? <A href={z.u}>#{z.n}</A> : adentro ? <span className={'rounded px-1.5 py-0.5 text-sm ' + TONOS[1]}>Sin ticket</span> : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-2 py-2">
          {z ? (<>{z.st}<div className="text-sm text-slate-500">{(z.srv || '') + (z.m ? ' · modificado ' + z.m.slice(0, 10) : '')}</div></>) : null}
        </td>
        <td className="px-2 py-2">{z?.enc || ''}</td>
        <td className="max-w-xl px-2 py-2 text-sm">
          <span className={'rounded px-1.5 py-0.5 ' + TONOS[TONO[r.est] ?? 2]}>{r.est}{r.src ? ' · ' + r.src : ''}</span>
          {r.est === EST.ENTREGADO && z && !r.zc && r.xd ? (
            <div className="mt-1 font-semibold">Salió el {r.xd} · ticket abierto hace {dias(r.xd, hoy)} días</div>
          ) : null}
          {r.x ? (
            <div className="mt-1">
              {r.x.id ? <A href={enlaceArchivo(r.x.id)}>{r.x.n}</A> : r.x.fo ? <A href={enlaceCarpeta(r.x.fo)}>{r.x.n}</A> : r.x.n}
              {r.x.q ? <div className="text-slate-500">{r.x.q}</div> : null}
            </div>
          ) : null}
          {adentro ? r.pa.map((p) => (
            <div key={p.id + p.d} className={'mt-1 rounded px-2 py-1 ' + TONOS[1]}>
              <b>Salida parcial {p.d}:</b> {p.q || 'accesorio'}{p.k ? ' · ticket ' + p.k : ''} · <A href={enlaceArchivo(p.id)}>{p.n}</A>
            </div>
          )) : null}
          {motivos.length ? <ul className="mt-1 list-disc pl-4 text-slate-600">{motivos.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
          {!puedeEditar ? null : r.man ? (
            <div><button className={boton} onClick={() => void deshacer([k, '*' + Reglas.cls(r.sn)])}>Deshacer ajuste</button></div>
          ) : adentro ? (
            <div>
              {revisar ? (<>
                <button className={boton} onClick={() => void guardar(k, 'in')}>Sigue en taller</button>
                <button className={boton} onClick={() => pedir(k, 'out', 'Cómo se confirmó (ej. recogido 12 nov, falta escanear)')}>Confirmar salida</button>
              </>) : null}
              <button className={boton} onClick={() => pedir(k, 'ret', 'Motivo (ej. devuelto a fábrica)')}>Marcar retirado</button>
              {pregunta(k)}
            </div>
          ) : null}
        </td>
      </tr>
    );
  }

  function ilegibles() {
    if (snap && !snap.ilegibles) return <p className="mt-6 text-sm text-slate-500">Las remisiones escaneadas ilegibles saldrán aquí en la próxima actualización. {SOLA}</p>;
    const todas = snap?.ilegibles || [];
    const hechas = todas.filter((x) => ajustes[claveIlegible(x)]);
    const tabla = (a: Ilegible[]) => (
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-sm text-slate-600"><tr><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Remisión escaneada</th><th className="px-2 py-1.5">Qué pasa</th></tr></thead>
          <tbody>{a.map((x) => {
            const k = claveIlegible(x);
            const hecho = ajustes[k];
            return (
              <tr key={x.id} className="border-t border-slate-200 align-top">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">{x.d || '—'}</td>
                <td className="px-2 py-2"><A href={enlaceArchivo(x.id)}>{x.n}</A></td>
                <td className="px-2 py-2 text-sm">
                  <span className={'rounded px-1.5 py-0.5 ' + TONOS[1]}>{x.m}</span>
                  <div className="mt-1">{x.q}</div>
                  {x.p.length ? <div className="mt-1"><b>Puede ser la salida de:</b> {x.p.map((p) => p.sn + ' (' + p.c + ', entrada ' + p.d + ' · ' + p.est + ')').join('; ')}</div> : null}
                  {hecho ? (<>
                    <div className="mt-1 text-slate-500">Revisada {hecho.at}{hecho.m ? ': ' + hecho.m : ''}</div>
                    {puedeEditar ? <button className={boton} onClick={() => void deshacer([k])}>Deshacer</button> : null}
                  </>) : puedeEditar ? (<>
                    <button className={boton} onClick={() => pedir(k, 'pdf', 'Qué se encontró (ej. es la salida de 18A00000, vuelto a escanear)')}>Ya revisada</button>
                    {pregunta(k)}
                  </>) : null}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    );
    return (
      <section className="mt-8">
        <h2 className="text-base font-semibold">Remisiones de salida escaneadas ilegibles ({pendientes.length})</h2>
        <p className="mb-2 text-sm text-slate-600">PDFs de REMISIONES 2026\SALIDA que no se pudieron leer o cruzar con ningún equipo. Si alguna es la salida de un equipo que figura adentro, usa «Confirmar salida» en ese equipo; luego marca la remisión como revisada.</p>
        {pendientes.length ? tabla(pendientes) : <p className="text-sm text-slate-500">No hay remisiones ilegibles pendientes.</p>}
        {hechas.length ? <details className="mt-3"><summary className="cursor-pointer text-sm">Ya revisadas ({hechas.length})</summary>{tabla(hechas)}</details> : null}
      </section>
    );
  }

  const ultima = datos?.ultima;
  return (
    <main className="mx-auto max-w-7xl p-4 text-slate-900">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Equipos en taller</h1>
          <p className="text-sm text-slate-600">{snap ? <>Última actualización: <b>{fmt(snap.at)}</b></> : 'Sin actualizar todavía'}</p>
        </div>
        {datos?.actualizando ? <p className="text-sm font-medium text-sky-800">Actualizando…</p> : null}
      </header>
      {fotoVieja ? (
        <p role="alert" className={'mb-2 rounded px-3 py-2 text-sm ' + (fotoVieja.destacado ? 'border border-red-300 bg-red-50 font-semibold text-red-800' : 'bg-amber-50 text-amber-900')}>
          {fotoVieja.texto}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-600">{aviso}</p>

      <nav className="my-3 flex flex-wrap gap-2" aria-label="Vistas">
        {VISTAS.map((x) => (
          <span key={x.nombre} className="contents">
            {x.grupo ? <span className="mx-1 w-px self-stretch bg-slate-300" aria-hidden /> : null}
            <button aria-pressed={x.nombre === vista} onClick={() => setVista(x.nombre)}
              className={'flex items-baseline gap-2 rounded-md border bg-white px-3 py-1.5 ' + (x.nombre === vista ? 'border-sky-700 shadow-[inset_0_-3px_0_theme(colors.sky.700)]' : 'border-slate-200')}>
              <b className="text-lg font-semibold tabular-nums">{filas.filter(x.filtro).length}</b>
              <span className={'rounded px-1.5 text-sm ' + TONOS[x.tono]}>{x.nombre}</span>
              {x.nombre === EST.REVISAR && pendientes.length ? (
                <span className="text-sm text-slate-500">+ {pendientes.length} {pendientes.length > 1 ? 'remisiones ilegibles' : 'remisión ilegible'}</span>
              ) : null}
            </button>
          </span>
        ))}
      </nav>
      <div role="group" aria-label="Filtros" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {selector('cliente', 'Cliente')}
        {selector('zoho', 'Estado en Desk')}
        {hayFiltros(fl) ? <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[13px] hover:bg-slate-50" onClick={() => setFl(SIN_FILTROS)}>Quitar filtros</button> : null}
      </div>
      <p className="mb-3 text-sm text-slate-600">{v.ayuda}</p>

      {!snap ? (
        <p className="py-8 text-slate-500">Aún no hay datos. {SOLA}</p>
      ) : lista.length ? (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-sm text-slate-600">
              <tr>{['S/N', 'Equipo y cliente', 'Entrada', 'Ticket', 'Estado en Desk', 'Responsable', 'Clasificación y motivo'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>{lista.map(filaEquipo)}</tbody>
          </table>
        </div>
      ) : (
        <p className="py-8 text-slate-500">{hayFiltros(fl) ? 'No hay equipos en esta vista con los filtros elegidos.' : 'No hay equipos en esta vista.'}</p>
      )}
      {v.nombre === EST.REVISAR && snap ? ilegibles() : null}

      {ultima?.avisos?.length ? (
        <details className="mt-6 text-sm text-red-800">
          <summary>{ultima.avisos.length} aviso{ultima.avisos.length > 1 ? 's' : ''} en la última ejecución</summary>
          <ul className="mt-1 list-disc pl-5">{ultima.avisos.slice(0, 40).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      ) : null}
    </main>
  );
}
