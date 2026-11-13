import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthLeftPanel from './AuthLeftPanel';
import AuthRightPanel from './AuthRightPanel';
import type { ModoAuth } from './recuperacion';

export default function AuthCard() {
  // Quien llega desde otra pantalla puede pedir con qué se abre, en
  // `location.state.modo`: «login» tras restablecer la contraseña y «olvido»
  // desde un enlace no válido. Sin indicación, el registro, como siempre.
  const modo = (useLocation().state as { modo?: ModoAuth } | null)?.modo;
  const [isSignUp, setIsSignUp] = useState(modo !== 'login' && modo !== 'olvido');

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
