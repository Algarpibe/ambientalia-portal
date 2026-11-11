// Pantalla de TV del taller: lienzo fijo de 1920×1080 escalado a la ventana, solo lectura. La fuente
// de datos se inyecta (`pedir`): hoy la sesión del portal; el kiosco la sustituirá sin tocar la pantalla.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AjustesTablero, RespuestaEquipos, RespuestaTablero, Tablero } from './nucleo';
import { apiEquipos, apiKiosco, leerTokenKiosco } from './api';
import { SinTablero, TableroVista, hhmm, lineaEstado, useTableroDatos } from './tablero/Tablero';
import { useSondeo, type Fallo } from './tablero/useSondeo';
import { LIENZO, escalaLienzo, fechaLarga, resolverTema } from './tablero/pantalla';
import { AJUSTES_TABLERO_POR_DEFECTO } from './nucleo';
import './tablero/tv.css';

export type FuenteTablero = (senal: AbortSignal) => Promise<RespuestaEquipos>;

/** Instante actual, renovado cada `cadaMs`. Un solo temporizador, que se limpia al desmontar. */
function useAhora(cadaMs: number): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}

function useVentana(): { ancho: number; alto: number } {
  const leer = () => ({ ancho: window.innerWidth, alto: window.innerHeight });
  const [v, setV] = useState(leer);
  useEffect(() => {
    const al = () => setV(leer());
    window.addEventListener('resize', al);
    return () => window.removeEventListener('resize', al);
  }, []);
  return v;
}

/** Reloj HH:MM con su propio temporizador de 1 s: solo se repinta él. */
function Reloj() {
  return <span role="timer" className="tt-reloj tt-mono">{hhmm(useAhora(1000))}</span>;
}

function Cabecera({ okEn, datosEn }: { okEn: number | null; datosEn: string | null }) {
  return (
    <header className="tt-cabecera">
      <div>
        <p className="tt-antetitulo">AMBIENTALIA · SERVICIO TÉCNICO</p>
        <h1 className="tt-titulo">Estado de equipos en taller</h1>
      </div>
      <div className="tt-cab-der">
        <div className="tt-cab-texto">
          {okEn !== null ? <p>{lineaEstado(okEn, datosEn)}</p> : null}
          <p className="tt-fecha">{fechaLarga(Date.now())}</p>
        </div>
        <Reloj />
      </div>
    </header>
  );
}

interface DatosPantalla {
  modelo: Tablero | null;
  ajustes: AjustesTablero;
  hayDatos: boolean;
  datosEn: string | null;
  okEn: number | null;
  fallo: Fallo;
  obsoleto: boolean;
}

/** Camino de la TV con sesión del portal: el navegador arma el tablero con el núcleo compartido. */
function TvSesion({ pedir: pedirProp, buscar }: { pedir?: FuenteTablero; buscar?: string }) {
  const pedirSesion = useMemo(() => apiEquipos().estado, []);
  const pedir = useCallback((s: AbortSignal) => (pedirProp ?? pedirSesion)(s), [pedirProp, pedirSesion]);
  const { datos, ...r } = useTableroDatos(pedir);
  return <Pantalla {...r} hayDatos={!!datos} buscar={buscar} />;
}

/** Camino de la TV con llave de kiosco: el servidor ya devuelve el tablero armado. */
function TvKiosco({ token, buscar }: { token: string; buscar?: string }) {
  const api = useMemo(() => apiKiosco(token), [token]);
  const pedir = useCallback((s: AbortSignal) => api.tablero(s), [api]);
  const { datos, okEn, fallo, obsoleto } = useSondeo<RespuestaTablero>(pedir);
  return (
    <Pantalla modelo={datos?.tablero ?? null} ajustes={datos?.ajustes ?? AJUSTES_TABLERO_POR_DEFECTO} hayDatos={!!datos}
      datosEn={datos?.fotoEn ?? null} okEn={okEn} fallo={fallo} obsoleto={obsoleto} kiosco buscar={buscar} />
  );
}

/** Con `pedir` (sesión) o sin llave en el fragmento, la sesión del portal; con `#k=`, el kiosco. */
export default function TvEquipos({ pedir, buscar }: { pedir?: FuenteTablero; buscar?: string }) {
  const token = useMemo(() => (pedir ? null : leerTokenKiosco()), [pedir]);
  return token ? <TvKiosco token={token} buscar={buscar} /> : <TvSesion pedir={pedir} buscar={buscar} />;
}

function Pantalla({ modelo, ajustes, hayDatos, datosEn, okEn, fallo, obsoleto, kiosco = false, buscar }: DatosPantalla & { kiosco?: boolean; buscar?: string }) {
  const ahora = useAhora(10_000);
  const param = new URLSearchParams(buscar ?? location.search).get('tema');
  const tema = resolverTema(param, ahora, ajustes);
  const { ancho, alto } = useVentana();
  const { escala, x, y } = escalaLienzo(ancho, alto);

  return (
    <div className="tt-pantalla">
      <div
        data-testid="tv-lienzo"
        className="tt-lienzo"
        style={{ width: LIENZO.ancho, height: LIENZO.alto, transform: `translate(${x}px, ${y}px) scale(${escala})` }}
      >
        {modelo ? (
          <TableroVista tablero={modelo} ajustes={ajustes} tema={tema} presupuesto okEn={okEn} datosEn={datosEn} obsoleto={obsoleto}
            cabecera={<Cabecera okEn={okEn} datosEn={datosEn} />} />
        ) : (
          <SinTablero tema={tema} hayDatos={hayDatos} fallo={fallo} kiosco={kiosco} />
        )}
      </div>
    </div>
  );
}
