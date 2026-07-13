import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { API_BASE, setToken } from '../../auth';

interface AuthRightPanelProps {
  isSignUp: boolean;
  onToggle: (value: boolean) => void;
}

export default function AuthRightPanel({ isSignUp, onToggle }: AuthRightPanelProps) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: ''
  });
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setError(''); // Clear error when user starts typing
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // El registro lo gestiona el administrador (usuarios por configuración).
    if (isSignUp) {
      setError('El registro de usuarios lo gestiona el administrador.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      if (!API_BASE) throw new Error('config');
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email, password: formData.password }),
      });
      if (!res.ok) {
        setError('Correo electrónico o contraseña inválidos');
        return;
      }
      const data = await res.json();
      if (!data?.token) {
        setError('Respuesta de autenticación inválida');
        return;
      }
      setToken(data.token);
      navigate('/');
    } catch {
      setError('No se pudo conectar con el servidor. Reintenta.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="w-full h-full flex flex-col p-8 md:p-12 overflow-y-auto"
      style={{
        background: 'linear-gradient(135deg, #2d3561 0%, #1a2847 100%)'
      }}>
      {/* Tab Toggle */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => onToggle(false)}
          className={`pb-2 font-semibold text-sm transition-all duration-300 ${
            !isSignUp
              ? 'text-white border-b-2 border-cyan-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}>
          Iniciar sesión
        </button>
        <button
          onClick={() => onToggle(true)}
          className={`pb-2 font-semibold text-sm transition-all duration-300 ${
            isSignUp
              ? 'text-white border-b-2 border-cyan-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}>
          Registrarse
        </button>
      </div>

      {/* Sign Up Form */}
      {isSignUp && (
        <form onSubmit={handleSubmit} className="flex-1">
          <h3 className="text-2xl font-bold text-white mb-8">Crea tu cuenta</h3>

          {/* Full Name Field */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Nombre completo
            </label>
            <div className="relative group">
              <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                placeholder="Juan Pérez"
                className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
              />
            </div>
          </div>

          {/* Email Field */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Correo electrónico
            </label>
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="tu@ejemplo.com"
                className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Contraseña
            </label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="••••••••"
                className="w-full pl-12 pr-12 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Terms Checkbox */}
          <div className="mb-8 flex items-start gap-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={(e) => setAgreeTerms(e.target.checked)}
                  className="appearance-none w-5 h-5 rounded border border-gray-500 checked:border-cyan-400 checked:bg-cyan-400 transition-all cursor-pointer"
                />
                {agreeTerms && (
                  <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white pointer-events-none" />
                )}
              </div>
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                Acepto todos los{' '}
                <a href="#" className="text-cyan-400 hover:text-cyan-300 transition-colors">
                  términos de servicio
                </a>
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !agreeTerms}
            style={{
              background: agreeTerms
                ? 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)'
                : 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
              opacity: agreeTerms && !isLoading ? 1 : 0.6,
              boxShadow:
                agreeTerms && !isLoading
                  ? '0 8px 20px rgba(26, 188, 156, 0.3)'
                  : '0 4px 10px rgba(26, 188, 156, 0.2)'
            }}
            className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:hover:scale-100 disabled:cursor-not-allowed">
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creando cuenta...
              </span>
            ) : (
              'Registrarse'
            )}
          </button>

          {/* Login Link */}
          <p className="text-center text-gray-400 text-sm mt-6">
            Ya soy miembro{' '}
            <button
              type="button"
              onClick={() => onToggle(false)}
              className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
              Iniciar sesión
            </button>
          </p>
        </form>
      )}

      {/* Sign In Form */}
      {!isSignUp && (
        <form onSubmit={handleSubmit} className="flex-1">
          <h3 className="text-2xl font-bold text-white mb-8">Bienvenido de vuelta</h3>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Email Field */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Correo electrónico
            </label>
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="tu@ejemplo.com"
                className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
              />
            </div>
          </div>

          {/* Password Field */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Contraseña
            </label>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="••••••••"
                className="w-full pl-12 pr-12 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              background: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
              boxShadow: '0 8px 20px rgba(26, 188, 156, 0.3)'
            }}
            className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:hover:scale-100 disabled:cursor-not-allowed">
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Iniciando sesión...
              </span>
            ) : (
              'Iniciar sesión'
            )}
          </button>

          {/* Signup Link */}
          <p className="text-center text-gray-400 text-sm mt-6">
            ¿No tienes cuenta?{' '}
            <button
              type="button"
              onClick={() => onToggle(true)}
              className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
              Registrarse
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
