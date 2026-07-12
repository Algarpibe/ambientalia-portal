import { useState } from 'react';
import AuthLeftPanel from './AuthLeftPanel';
import AuthRightPanel from './AuthRightPanel';

export default function AuthCard() {
  const [isSignUp, setIsSignUp] = useState(true);

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
        <AuthRightPanel isSignUp={isSignUp} onToggle={setIsSignUp} />
      </div>
    </div>
  );
}
