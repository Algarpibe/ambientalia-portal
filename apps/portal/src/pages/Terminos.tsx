import { useEffect, type ReactNode } from 'react';
import {
  CORREO_CONTACTO,
  INTRODUCCION,
  LINEA_VERSION,
  SECCIONES,
  TITULO_TERMINOS,
  type Bloque,
} from '../legal/terminos';

// /terminos — pública, fuera de RequireAuth (spec 2026-11-20-terminos, §5). La
// enlazan el registro (todavía sin sesión), la pantalla de aceptación y Ajustes,
// siempre en pestaña nueva. Solo pinta el texto de legal/terminos.ts: no lee la
// sesión ni pide nada al servidor. Mismo fondo y tarjetas que Configuración.

const TITULO_PESTANA = 'Condiciones de uso y tratamiento de datos · Portal Ambientalia';

/** Pinta el texto tal cual, salvo el correo de contacto, que sale como enlace mailto. */
function ConCorreo({ texto }: { texto: string }) {
  if (!texto.includes(CORREO_CONTACTO)) return <>{texto}</>;
  const trozos: ReactNode[] = [];
  texto.split(CORREO_CONTACTO).forEach((trozo, i) => {
    if (i > 0) {
      trozos.push(
        <a key={i} href={`mailto:${CORREO_CONTACTO}`} className="text-blue-700 underline">
          {CORREO_CONTACTO}
        </a>,
      );
    }
    trozos.push(trozo);
  });
  return <>{trozos}</>;
}

function PintarBloque({ bloque, contexto }: { bloque: Bloque; contexto: string }) {
  if (bloque.tipo === 'parrafo') {
    return (
      <p className="text-gray-700 leading-relaxed">
        {bloque.destacado && (
          <>
            <strong className="font-semibold text-gray-900">{bloque.destacado}</strong>{' '}
          </>
        )}
        <ConCorreo texto={bloque.texto} />
      </p>
    );
  }
  if (bloque.tipo === 'lista') {
    return (
      <ul className="list-disc pl-6 space-y-1 text-gray-700 leading-relaxed">
        {bloque.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  // Una tabla de tres columnas no cabe en un celular: se desplaza DENTRO de su
  // caja, nunca la página entera. La caja se puede enfocar y tiene nombre para que
  // quien navega con teclado o lector de pantalla pueda desplazarla. Las de dos
  // columnas caben sin ancho mínimo.
  const ancha = bloque.columnas.length > 2;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={contexto}>
      <table
        className={`w-full ${ancha ? 'min-w-[28rem] ' : ''}text-sm text-left border border-gray-200`}
      >
        <thead className="bg-gray-50 text-gray-900">
          <tr>
            {bloque.columnas.map((columna) => (
              <th key={columna} scope="col" className="px-3 py-2 font-semibold border-b border-gray-200">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloque.filas.map((fila, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              {fila.map((celda, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-3 py-2 align-top text-left font-medium text-gray-900">
                    <ConCorreo texto={celda} />
                  </th>
                ) : (
                  <td key={j} className="px-3 py-2 align-top text-gray-700">
                    <ConCorreo texto={celda} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Terminos() {
  // Título propio mientras la página está abierta; al salir se devuelve el anterior.
  useEffect(() => {
    const anterior = document.title;
    document.title = TITULO_PESTANA;
    return () => {
      document.title = anterior;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900">
      <main className="max-w-3xl mx-auto px-4 py-8 md:py-12">
        <a href="/" className="inline-block mb-4 text-sm font-medium text-blue-700 hover:underline">
          Volver al portal
        </a>
        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 md:p-10 space-y-8">
          <header className="space-y-3">
            <h1 className="text-2xl md:text-3xl font-bold text-blue-700">{TITULO_TERMINOS}</h1>
            <p className="text-gray-700 leading-relaxed">{INTRODUCCION}</p>
            <p className="text-sm font-medium text-gray-500">{LINEA_VERSION}</p>
          </header>
          {SECCIONES.map((seccion) => (
            <section key={seccion.titulo} className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900">{seccion.titulo}</h2>
              {seccion.apartados.map((apartado, i) => (
                <div key={apartado.titulo ?? i} className="space-y-3">
                  {apartado.titulo && <h3 className="text-base font-semibold text-gray-900">{apartado.titulo}</h3>}
                  {apartado.bloques.map((bloque, j) => (
                    <PintarBloque key={j} bloque={bloque} contexto={apartado.titulo ?? 'Tabla'} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}
