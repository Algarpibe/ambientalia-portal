import { useEffect, useRef, useState } from 'react';
import { User, Mail, Lock, KeyRound, Shield, Camera, Save, Clock, Eye, EyeOff } from 'lucide-react';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';
import { fileToResizedDataUrl } from '../lib/image';
import { useProfile, notifyProfileUpdated } from '../hooks/useProfile';
import Avatar from '../components/Avatar';

const MIN_PASSWORD = 8; // coincide con el backend (Req 1.6)

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Configuracion() {
  const { profile, reload } = useProfile();

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (profile) setName(profile.full_name);
  }, [profile]);

  const nameChanged = profile != null && name.trim() !== profile.full_name && name.trim().length > 0;

  const saveName = async () => {
    setSavingName(true);
    try {
      const res = await authFetch('/api/users/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: name.trim() }),
      });
      if (!res.ok) {
        notify('No se pudo actualizar el nombre.', 'error');
        return;
      }
      notify('Nombre actualizado.', 'info');
      notifyProfileUpdated();
      reload();
    } catch {
      notify('No se pudo conectar con el servidor.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir el mismo archivo
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify('El archivo debe ser una imagen.', 'error');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file, 256, 0.85);
      const res = await authFetch('/api/users/me/avatar', {
        method: 'PATCH',
        body: JSON.stringify({ avatar: dataUrl }),
      });
      if (!res.ok) {
        notify('No se pudo actualizar la foto.', 'error');
        return;
      }
      notify('Foto de perfil actualizada.', 'info');
      notifyProfileUpdated();
      reload();
    } catch {
      notify('No se pudo procesar la imagen.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const updatePassword = async () => {
    if (newPassword.length < MIN_PASSWORD) {
      notify(`La nueva contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`, 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      notify('Las contraseñas no coinciden.', 'error');
      return;
    }
    setSavingPwd(true);
    try {
      const res = await authFetch('/api/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.status === 400) {
        notify('La contraseña actual es incorrecta o la nueva no es válida.', 'error');
        return;
      }
      if (!res.ok) {
        notify('No se pudo actualizar la contraseña.', 'error');
        return;
      }
      notify('Contraseña actualizada.', 'info');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      notify('No se pudo conectar con el servidor.', 'error');
    } finally {
      setSavingPwd(false);
    }
  };

  const isAdmin = profile?.role === 'admin';

  return (
    <div className="flex-grow bg-[#F7F8FA] p-6 md:p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Banner */}
        <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-8">
          <h1 className="text-3xl font-bold text-blue-700">Configuración</h1>
          <p className="text-gray-600 mt-1">Administra los detalles de tu cuenta y seguridad.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Card Perfil */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900">Perfil</h2>
              </div>
              {profile && (
                <span
                  className={
                    'px-3 py-1 rounded-full text-xs font-medium ' +
                    (isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700')
                  }>
                  {isAdmin ? 'Administrador' : 'Lector'}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mb-6">Gestiona tu información personal y cuenta.</p>

            {/* Avatar + subida */}
            <div className="flex flex-col items-center mb-6">
              <div className="relative">
                <Avatar src={profile?.avatar} name={profile?.full_name} size={112} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Cambiar foto de perfil"
                  className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-md hover:bg-blue-700 disabled:opacity-60">
                  <Camera className="w-4 h-4" />
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              </div>
              <p className="text-sm font-semibold text-blue-600 mt-3">FOTO DE PERFIL</p>
              <p className="text-xs text-gray-500">{uploading ? 'Subiendo…' : 'Recomendado: JPG o PNG, máx. 2MB'}</p>
            </div>

            {/* Nombre */}
            <label className="block text-sm font-medium text-gray-600 mb-1">Nombre Completo</label>
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <button
                onClick={saveName}
                disabled={!nameChanged || savingName}
                className="px-3 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                <Save className="w-4 h-4" /> Guardar
              </button>
            </div>

            {/* Email (solo lectura) */}
            <label className="block text-sm font-medium text-gray-600 mb-1">Correo Electrónico</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={profile?.email ?? ''}
                readOnly
                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-500"
              />
            </div>
          </div>

          {/* Columna derecha: Seguridad + Miembro desde */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-gray-900">Seguridad</h2>
              </div>
              <p className="text-sm text-gray-500 mb-6">Actualiza tu contraseña para mantener tu cuenta segura.</p>

              <div className="space-y-4">
                {[
                  { label: 'Contraseña Actual', value: currentPassword, set: setCurrentPassword, ph: 'Tu contraseña actual', Icon: Lock },
                  { label: 'Nueva Contraseña', value: newPassword, set: setNewPassword, ph: `Mínimo ${MIN_PASSWORD} caracteres`, Icon: KeyRound },
                  { label: 'Confirmar Contraseña', value: confirmPassword, set: setConfirmPassword, ph: 'Repite la nueva contraseña', Icon: Shield },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="block text-sm font-medium text-gray-600 mb-1">{f.label}</label>
                    <div className="relative">
                      <f.Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.ph}
                        className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-gray-200 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((s) => !s)}
                        aria-label="Mostrar u ocultar contraseñas"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={updatePassword}
                  disabled={savingPwd || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" /> Actualizar Contraseña
                </button>
              </div>
            </div>

            {/* Miembro desde */}
            {profile && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Miembro desde</p>
                  <p className="text-lg font-bold text-blue-700">{formatDate(profile.created_at)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
