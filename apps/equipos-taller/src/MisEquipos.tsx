// «Mis equipos»: vista de solo lectura, pensada para el celular, de los equipos de un técnico. Reutiliza el
// sondeo y el modelo del tablero (no duplica reglas) y filtra las tarjetas por el nombre del técnico.
// El nombre del usuario entra por `nombre` (lo da el portal); sin coincidencia única se pregunta «¿Quién eres?».
import { useCallback, useMemo, useState } from 'react';
import type { ColumnaTablero, Tarjeta } from './nucleo';
import { apiEquipos } from './api';
import { Raiz, SinTablero, hhmm, useTableroDatos } from './tablero/Tablero';
import EscanearSerial from './EscanearSerial';
import { coincideTecnico, esDe, tecnicosDelTablero } from './tecnico';
import './tablero/tablero.css';
import './tablero/mis-equipos.css';

export const CLAVE_TECNICO = 'equipos-taller:mis-equipos:tecnico';

// El almacenamiento local puede no existir (modo privado, política del navegador): nunca rompe la vista.
const leer = (): string | null => { try { return localStorage.getItem(CLAVE_TECNICO); } catch { return null; } };
const guardar = (v: string) => { try { localStorage.setItem(CLAVE_TECNICO, v); } catch { /* sin almacenamiento: vale solo en esta visita */ } };

function Selector({ nombres, onElegir }: { nombres: string[]; onElegir: (n: string) => void }) {
  return (
    <div role="group" aria-label="¿Quién eres?" className="tt-mis-selector">
      <h2>¿Quién eres?</h2>
      {nombres.map((n) => <button key={n} type="button" className="tt-mis-boton" onClick={() => onElegir(n)}>{n}</button>)}
    </div>
  );
}

export function Ficha({ t }: { t: Tarjeta }) {
  return (
    <article className="tt-tarjeta" aria-label={`Equipo ${t.sn}`}>
      <div className="tt-tarjeta-cab">
        <span className="tt-sn tt-mono">{t.sn}</span>
        <span className={`tt-dias-suave tt-dias-suave-${t.tono}`}>{`${t.dias} d`}</span>
      </div>
      <div className="tt-equipo">{t.equipo}</div>
      <div className="tt-cliente">{t.ticket ? `${t.cliente} · #${t.ticket}` : t.cliente}</div>
      {t.etiquetas.length ? <div className="tt-etiquetas">{t.etiquetas.map((e) => <span key={e.tipo + e.texto} className="tt-etiqueta">{e.texto}</span>)}</div> : null}
    </article>
  );
}

function Grupo({ col }: { col: ColumnaTablero }) {
  return (
    <section className={`tt-mis-grupo tt-col-${col.id}`} aria-label={col.nombre}>
      <div className="tt-col-cab">
        <span className="tt-punto" aria-hidden />
        <h3 className="tt-col-nombre">{col.nombre}</h3>
        <span className="tt-cuenta" aria-label={`Total ${col.tarjetas.length}`}>{col.tarjetas.length}</span>
      </div>
      {col.tarjetas.map((t) => <Ficha key={t.clave} t={t} />)}
    </section>
  );
}

export default function MisEquipos({ nombre, pedir: pedirProp }: { nombre: string | null; pedir?: (s: AbortSignal) => ReturnType<ReturnType<typeof apiEquipos>['estado']> }) {
  const pedirSesion = useMemo(() => apiEquipos().estado, []);
  const pedir = useCallback((s: AbortSignal) => (pedirProp ?? pedirSesion)(s), [pedirProp, pedirSesion]);
  const { datos, modelo, ajustes, okEn, fallo, obsoleto } = useTableroDatos(pedir);
  const [guardado, setGuardado] = useState<string | null>(leer);
  const [cambiando, setCambiando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  if (!modelo) return <SinTablero tema="sistema" hayDatos={!!datos} fallo={fallo} />;

  const nombres = tecnicosDelTablero(modelo);
  const coinciden = nombre ? nombres.filter((n) => coincideTecnico(nombre, n)) : [];
  const elegido = guardado ?? (coinciden.length === 1 ? coinciden[0] : null);
  const grupos = elegido
    ? modelo.columnas.map((c) => ({ ...c, tarjetas: c.tarjetas.filter((t) => esDe(t, elegido)) })).filter((c) => c.tarjetas.length > 0)
    : [];
  const todas = grupos.flatMap((g) => g.tarjetas);
  const dueno = todas[0]?.tecnico;
  const elegir = (n: string) => { guardar(n); setGuardado(n); setCambiando(false); };
  const kpis = [
    { e: 'Asignados', v: todas.length },
    { e: 'Esperan cliente', v: grupos.filter((g) => g.id === 'notificacion').reduce((s, g) => s + g.tarjetas.length, 0) },
    { e: `Más de ${ajustes.umbralRojo} d`, v: todas.filter((t) => t.dias > ajustes.umbralRojo).length },
  ];

  return (
    <Raiz tema="sistema" clase="tt-mis">
      <header className="tt-mis-cab">
        <span className={`tt-av tt-av-grande ${dueno ? `tt-av-${dueno.avatar}` : 'tt-av-neutro'}`} aria-hidden>{dueno?.iniciales ?? '–'}</span>
        <div className="tt-mis-id">
          <p>Mis equipos</p>
          <h1>{elegido ?? nombre ?? ''}</h1>
        </div>
        <button type="button" className="tt-mis-boton tt-mis-cambiar" onClick={() => setCambiando(true)}>Cambiar</button>
      </header>
      {obsoleto && okEn !== null ? <p role="alert" className="tt-aviso">{`Datos desactualizados desde ${hhmm(okEn)}`}</p> : null}
      <ul className="tt-mis-kpis" aria-label="Indicadores">
        {kpis.map((k) => <li key={k.e} className="tt-kpi"><span className="tt-kpi-n">{k.v}</span><span className="tt-kpi-e">{k.e}</span></li>)}
      </ul>
      {elegido && todas.length === 0 ? <p className="tt-mensaje">{`No hay equipos asignados a ${elegido}.`}</p> : null}
      {!elegido || todas.length === 0 || cambiando ? <Selector nombres={nombres} onElegir={elegir} /> : null}
      {escaneando ? <EscanearSerial tarjetas={modelo.columnas.flatMap((c) => c.tarjetas)} onCerrar={() => setEscaneando(false)} mostrar={(t) => <Ficha key={t.clave} t={t} />} /> : null}
      {grupos.map((g) => <Grupo key={g.id} col={g} />)}
      <nav className="tt-mis-barra" aria-label="Taller">
        <button type="button" className="tt-mis-boton" onClick={() => setEscaneando(true)}>Escanear S/N</button>
        <a className="tt-mis-boton" href="/equipos-taller?vista=tablero">Ver taller completo</a>
      </nav>
    </Raiz>
  );
}
