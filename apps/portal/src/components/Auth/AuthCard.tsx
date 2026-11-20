import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthLeftPanel from './AuthLeftPanel';
import AuthRightPanel from './AuthRightPanel';
import type { ModoAuth } from './recuperacion';

export default function AuthCard() {
  // Con qué se abre /auth, por este orden:
  //  1. `location.state.modo`, de quien navega hasta aquí desde otra pantalla:
  //     «login» tras restablecer la contraseña y «olvido» desde un enlace no
  //     válido. Manda sobre lo demás.
  //  2. «Iniciar sesión» si la URL trae `?modo=login` (el botón «Entrar al
  //     portal» de los correos de acceso) o si se llega echado de una ruta
  //     protegida (`state.from`, que ponen RequireAuth y RequireAdmin): quien
  //     viene de ahí ya tiene cuenta.
  //  3. Si no, el registro, como siempre.
  const location = useLocation();
  const state = location.state as { modo?: ModoAuth; from?: unknown } | null;
  const modo = state?.modo;
  const abreEnLogin =
    modo === 'login' ||
    modo === 'olvido' ||
    new URLSearchParams(location.search).get('modo') === 'login' ||
    typeof state?.from === 'string';
  const [isSignUp, setIsSignUp] = useState(!abreEnLogin);

  return (
    <div
      className="w-full max-h-[90vh] rounded-[18px] overflow-hidden shadow-2xl flex"
      style={{
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(255, 107, 107, 0.1)'
      }}>
      {/* Left Panel - Visual/Branding */}
      <div className="hidden md:flex md:w-1/2">
        <AuthLeftPanel />
      </div>

      {/* Right Panel - Authentication */}
      <div className="w-full md:w-1/2">
        <AuthRightPanel isSignUp={isSignUp} onToggle={setIsSignUp} olvidoInicial={modo === 'olvido'} />
      </div>
    </div>
  );
}
