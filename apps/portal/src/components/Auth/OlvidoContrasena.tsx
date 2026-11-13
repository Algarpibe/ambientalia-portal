import { useEffect, useId, useRef, useState } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../../auth';
import {
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_ENLACE_PEDIDO,
  MENSAJE_NO_ENVIADO,
  MENSAJE_SIN_SERVIDOR,
} from './recuperacion';

// Tercer modo del panel de acceso: pedir el enlace para restablecer la
// contraseña. hub-api responde SIEMPRE lo mismo, exista o no la cuenta, así que
// aquí tampoco se distingue: tras un 200, el mismo mensaje para todos.

interface OlvidoContrasenaProps {
  /** Vuelve al formulario de iniciar sesión. */
  onVolver: () => void;
}

export default function OlvidoContrasena({ onVolver }: OlvidoContrasenaProps) {
  const [correo, setCorreo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const idCorreo = `${useId()}-correo`;
  const tituloEnviado = useRef<HTMLHeadingElement>(null);

  // Al enviarse, el formulario desaparece y el foco caería al <body>: se lleva
  // al título de la confirmación para que el lector de pantalla la anuncie.
  useEffect(() => {
    if (enviado) tituloEnviado.current?.focus();
  }, [enviado]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = correo.trim();
    if (email === '') return;
    setEnviando(true);
    setError('');
    try {
      if (!API_BASE) throw new Error('config');
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setEnviado(true);
        return;
      }
      setError(res.status === 429 ? MENSAJE_DEMASIADOS_INTENTOS : MENSAJE_NO_ENVIADO);
    } catch {
      setError(MENSAJE_SIN_SERVIDOR);
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-16 h-16 text-cyan-400 mb-6" />
        <h3 ref={tituloEnviado} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
          Revisa tu correo
        </h3>
        <p role="status" className="text-gray-300 mb-8 max-w-sm">
          {MENSAJE_ENLACE_PEDIDO}
        </p>
        <button
          type="button"
          onClick={onVolver}
          className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex-1" noValidate>
      <h3 className="text-2xl font-bold text-white mb-3">¿Olvidaste tu contraseña?</h3>
      <p className="text-gray-300 text-sm mb-8">
        Escribe el correo con el que entras al portal y te enviaremos un enlace para elegir una contraseña nueva.
      </p>

      {/* role="alert" para que se anuncie (FE-419), como en el login. */}
      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      <div className="mb-8">
        <label htmlFor={idCorreo} className="block text-sm font-medium text-gray-300 mb-2">
          Correo electrónico
        </label>
        <div className="relative group">
          <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
          <input
            id={idCorreo}
            type="email"
            name="email"
            value={correo}
            onChange={(e) => {
              setCorreo(e.target.value);
              setError('');
            }}
            placeholder="tu@ejemplo.com"
            maxLength={254}
            autoComplete="email"
            autoFocus
            className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando || correo.trim() === ''}
        style={{
          background: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
          boxShadow: '0 8px 20px rgba(26, 188, 156, 0.3)',
        }}
        className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed">
        {enviando ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Enviando...
          </span>
        ) : (
          'Enviar enlace'
        )}
      </button>

      <p className="text-center text-sm mt-6">
        <button
          type="button"
          onClick={onVolver}
          className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
          Volver a iniciar sesión
        </button>
      </p>
    </form>
  );
}
