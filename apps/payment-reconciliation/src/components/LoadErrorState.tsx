import React from 'react';

interface LoadErrorStateProps {
  message: string;
  /** Vuelve a pedir los datos; sin él no se ofrece el botón. */
  onRetry?: () => void;
}

// FE-414: aviso de carga fallida compartido por todas las vistas de la app.
// Cuando la carga del hub falla, los arreglos se quedan vacíos y cada vista
// los presentaba como «no hay datos»; las vistas pintan esto ANTES de su
// estado vacío para que un fallo nunca se lea como ausencia de facturas.
export const LoadErrorState: React.FC<LoadErrorStateProps> = ({ message, onRetry }) => (
  <div className="p-6 text-center">
    <p role="alert" className="text-red-600 mb-4">{message}</p>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold"
      >
        Reintentar
      </button>
    )}
  </div>
);
