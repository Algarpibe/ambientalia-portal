import { useEffect } from 'react';
import { can } from '../lib/domain';
import type { O3Section, Route } from '../lib/hash';
import type { Me } from '../types';
import EquipmentSection from './EquipmentSection';
import VerificationsSection from './VerificationsSection';
import CalculatorsSection from './CalculatorsSection';
import ExpirationsSection from './ExpirationsSection';
import ConfigSection from './ConfigSection';
import RolesSection from './RolesSection';

export interface SectionProps {
  me: Me;
  route: Route;
  navigate: (r: Route, replace?: boolean) => void;
}

/** «Verificación Patrones de Ozono» tab: sub-sections filtered by role. */
export default function O3Tab({ me, route, navigate }: SectionProps) {
  const sections: [O3Section, string][] = [
    ['equipos', 'Equipos'],
    ['verificaciones', 'Verificaciones'],
    ['calculadoras', 'Calculadoras'],
    ['vencimientos', 'Vencimientos'],
  ];
  if (can(me, 'limits.write') || can(me, 'config.write')) sections.push(['configuracion', 'Configuración']);
  if (me.canManageRoles) sections.push(['roles', 'Roles']);

  const allowed = sections.some(([s]) => s === route.section);
  useEffect(() => {
    if (!allowed) navigate({ type: 'o3', section: 'equipos', id: null }, true);
  }, [allowed, navigate]);

  return (
    <div>
      <nav aria-label="Secciones" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={route.section === id ? 'page' : undefined}
            onClick={() => navigate({ type: 'o3', section: id, id: null })}
            className={`min-h-[44px] shrink-0 rounded-xl px-4 text-sm font-medium transition-colors ${
              route.section === id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {route.section === 'equipos' && <EquipmentSection me={me} route={route} navigate={navigate} />}
      {route.section === 'verificaciones' && <VerificationsSection me={me} route={route} navigate={navigate} />}
      {route.section === 'calculadoras' && <CalculatorsSection />}
      {route.section === 'vencimientos' && <ExpirationsSection route={route} navigate={navigate} />}
      {route.section === 'configuracion' && allowed && <ConfigSection me={me} />}
      {route.section === 'roles' && allowed && <RolesSection />}
    </div>
  );
}
