import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { captureError } from '../sentry';
import { esFalloDeCargaDeModulo } from '../lib/lazyConReintento';

// Envuelve cada mini-app en App.tsx. Vive en su propio fichero para poder
// probarlo sin arrastrar el árbol entero de rutas.

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    captureError(error);
  }

  render() {
    if (this.state.hasError) {
      // FE-413 — antes se pintaba `error.message` tal cual: en inglés, a veces con
      // detalles internos y sin decir qué hacer. El error real sigue yendo a consola
      // y a Sentry en `componentDidCatch`; aquí solo un texto que se pueda leer.
      //
      // El chunk que no llega se separa porque su remedio es concreto: tras un
      // despliegue, un tab abierto pide ficheros que ya no existen, y
      // `lazyConReintento` ya agotó su reintento y su recarga automática.
      const deCarga = esFalloDeCargaDeModulo(this.state.error);
      return (
        <div className="flex-grow bg-red-50 p-12 flex items-center justify-center text-center">
          <div>
            <h2 className="text-2xl font-bold text-red-700 mb-4">Error al cargar la aplicación</h2>
            <p className="text-red-600 mb-6 max-w-md mx-auto">
              {deCarga
                ? 'No se pudo descargar esta aplicación. Puede que haya una versión nueva del portal o que se haya cortado la conexión: recarga la página para continuar.'
                : 'Algo falló al mostrar esta aplicación. Vuelve a intentarlo y, si sigue pasando, avisa al equipo de soporte.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-600 text-white rounded-lg font-semibold"
            >
              {deCarga ? 'Recargar la página' : 'Reintentar'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
