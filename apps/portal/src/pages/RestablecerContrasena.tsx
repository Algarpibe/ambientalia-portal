import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, KeyRound, Shield, TriangleAlert } from 'lucide-react';
import AuthLeftPanel from '../components/Auth/AuthLeftPanel';
import { API_BASE, clearToken } from '../auth';
import { MENSAJE_DEMASIADOS_INTENTOS, MENSAJE_SIN_SERVIDOR, type ModoAuth } from '../components/Auth/recuperacion';

// /auth/restablecer — pública, fuera de RequireAuth (spec 2026-11-13, §6.2).
// Llega desde el enlace del correo de «¿Olvidaste tu contraseña?», con el token
// tras el `#` (#t=…): el navegador no lo manda al servidor, así que no queda en
// los logs de nginx ni en el Referer. Al montar se lee y se quita de la barra de
// direcciones para que tampoco quede en el historial. Mismo diseño de tarjeta
// que /auth.

const MIN_PASSWORD = 8; // coincide con el backend (MIN_PASSWORD_LENGTH)
const MENSAJE_CLAVE_CORTA = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
const MENSAJE_NO_COINCIDEN = 'Las contraseñas no coinciden.';
const MENSAJE_NO_RESTABLECIDA = 'No se pudo restablecer la contraseña. Reintenta.';
const CLASE_CAMPO =
  'w-full pl-12 pr-12 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20';

type Estado = 'formulario' | 'hecho' | 'invalido';

// El servidor solo acepta 32 bytes aleatorios en base64url (43 caracteres). Un
// enlace cortado o mal pegado jamás va a valer: se descarta aquí para no dejar a
// la persona escribir la contraseña dos veces antes de decirle que el enlace falla.
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** El token de `#t=<token>`, o cadena vacía si no viene o no tiene el formato del servidor. */
function leerToken(hash: string): string {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t') ?? '';
  return FORMATO_TOKEN.test(token) ? token : '';
}

export default function RestablecerContrasena() {
  const navigate = useNavigate();
  // En el inicializador y no en el efecto: en StrictMode el efecto corre dos
  // veces, y la segunda ya no encontraría el hash.
  const [token] = useState(() => leerToken(window.location.hash));
  const [estado, setEstado] = useState<Estado>(token ? 'formulario' : 'invalido');
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [verClaves, setVerClaves] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const uid = useId();
  const ids = { clave: `${uid}-clave`, confirmacion: `${uid}-confirmacion` };
  const tituloHecho = useRef<HTMLHeadingElement>(null);
  const tituloInvalido = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (window.location.hash) {
      // Conserva el `state` del historial: react-router guarda ahí su índice.
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);

  // Al guardarse, el formulario desaparece y el foco caería al <body>: se lleva
  // al título de la confirmación para que el lector de pantalla la anuncie.
  useEffect(() => {
    if (estado === 'hecho') tituloHecho.current?.focus();
    if (estado === 'invalido') tituloInvalido.current?.focus();
  }, [estado]);

  const irAlAcceso = (modo: ModoAuth) => {
    navigate('/auth', { state: { modo } });
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clave.length < MIN_PASSWORD) {
      setError(MENSAJE_CLAVE_CORTA);
      return;
    }
    if (clave !== confirmacion) {
      setError(MENSAJE_NO_COINCIDEN);
      return;
    }
    setGuardando(true);
    setError('');
    try {
      if (!API_BASE) throw new Error('config');
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: clave }),
      });
      if (res.ok) {
        // La sesión que hubiera abierta ya no vale (token_version subió): fuera.
        clearToken();
        setEstado('hecho');
        return;
      }
      if (res.status === 429) {
        setError(MENSAJE_DEMASIADOS_INTENTOS);
        return;
      }
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 400 && cuerpo.error === 'invalid_or_expired_token') {
        setEstado('invalido');
        return;
      }
      setError(res.status === 400 && cuerpo.error === 'password_too_short' ? MENSAJE_CLAVE_CORTA : MENSAJE_NO_RESTABLECIDA);
    } catch {
      setError(MENSAJE_SIN_SERVIDOR);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 25%, #ffa5a5 50%, #ffb3b3 75%, #ffc5c5 100%)',
        backgroundAttachment: 'fixed',
      }}>
      <div className="w-full max-w-4xl mx-auto px-4 py-8">
        <div
          className="w-full max-h-[90vh] rounded-[18px] overflow-hidden shadow-2xl flex"
          style={{ boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(255, 107, 107, 0.1)' }}>
          <div className="hidden md:flex md:w-1/2">
            <AuthLeftPanel />
          </div>

          <div className="w-full md:w-1/2">
            <div
              className="w-full h-full flex flex-col p-8 md:p-12 overflow-y-auto"
              style={{ background: 'linear-gradient(135deg, #2d3561 0%, #1a2847 100%)' }}>
              {estado === 'invalido' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <TriangleAlert className="w-16 h-16 text-amber-300 mb-6" />
                  <h3 ref={tituloInvalido} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
                    Este enlace no es válido o ha caducado
                  </h3>
                  <p className="text-gray-300 mb-8 max-w-sm">
                    Los enlaces para restablecer la contraseña valen 30 minutos y una sola vez. Pide uno nuevo.
                  </p>
                  <button
                    type="button"
                    onClick={() => irAlAcceso('olvido')}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                    Pedir un enlace nuevo
                  </button>
                </div>
              )}

              {estado === 'hecho' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-16 h-16 text-cyan-400 mb-6" />
                  <h3 ref={tituloHecho} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
                    Contraseña actualizada
                  </h3>
                  <p className="text-gray-300 mb-8 max-w-sm">
                    Ya puedes iniciar sesión con tu nueva contraseña. Por seguridad, se han cerrado todas las sesiones
                    que tenías abiertas.
                  </p>
                  <button
                    type="button"
                    onClick={() => irAlAcceso('login')}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                    Ir a iniciar sesión
                  </button>
                </div>
              )}

              {estado === 'formulario' && (
                <form onSubmit={guardar} className="flex-1" noValidate>
                  <h3 className="text-2xl font-bold text-white mb-3">Elige una contraseña nueva</h3>
                  <p className="text-gray-300 text-sm mb-8">Mínimo {MIN_PASSWORD} caracteres.</p>

                  {/* role="alert" para que se anuncie (FE-419), como en el login. */}
                  {error && (
                    <div role="alert" className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg">
                      <p className="text-red-300 text-sm">{error}</p>
                    </div>
                  )}

                  <div className="mb-6">
                    <label htmlFor={ids.clave} className="block text-sm font-medium text-gray-300 mb-2">
                      Nueva contraseña
                    </label>
                    <div className="relative group">
                      <KeyRound className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                      <input
                        id={ids.clave}
                        type={verClaves ? 'text' : 'password'}
                        value={clave}
                        onChange={(e) => {
                          setClave(e.target.value);
                          setError('');
                        }}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        autoFocus
                        className={CLASE_CAMPO}
                      />
                      {/* Un solo ojo para los dos campos, como en Configuración (FE-419):
                          el nombre dice lo que hará y aria-pressed su estado. */}
                      <button
                        type="button"
                        onClick={() => setVerClaves((v) => !v)}
                        aria-label={verClaves ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                        aria-pressed={verClaves}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                        {verClaves ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="mb-8">
                    <label htmlFor={ids.confirmacion} className="block text-sm font-medium text-gray-300 mb-2">
                      Confirmar contraseña
                    </label>
                    <div className="relative group">
                      <Shield className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                      <input
                        id={ids.confirmacion}
                        type={verClaves ? 'text' : 'password'}
                        value={confirmacion}
                        onChange={(e) => {
                          setConfirmacion(e.target.value);
                          setError('');
                        }}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className={CLASE_CAMPO}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={guardando}
                    style={{
                      background: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
                      boxShadow: '0 8px 20px rgba(26, 188, 156, 0.3)',
                    }}
                    className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed">
                    {guardando ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    ) : (
                      'Guardar contraseña'
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
