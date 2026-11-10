/**
 * «Equipos en taller» montado: configuración, fuentes, repositorio, servicio y
 * programador. Lo usa index.ts (y nadie más) tras initDb().
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { DbLectura } from '../trazabilidad/fuente.js';
import { crearCanalAlerta } from './alerta.js';
import { leerConfig, type ConfigEquipos } from './config.js';
import { fuenteDesk2 } from './fuente-desk2.js';
import { fuenteDrive } from './fuente-drive.js';
import { iniciarProgramadorEquipos } from './programador.js';
import { crearRepoEquipos, type RepoEquipos } from './repo.js';
import { crearServicioEquipos, type ServicioEquipos } from './servicio.js';

export { createEquiposTallerRouter } from './router.js';
export { detenerProgramadorEquipos } from './programador.js';

export interface EquiposTaller {
  repo: RepoEquipos;
  servicio: ServicioEquipos;
  /** Enciende la corrida diaria. No hace nada si el módulo está sin configurar. */
  iniciarProgramador(): boolean;
}

export function crearEquiposTaller(hub: Pool, desk2: () => DbLectura | null, cfg: ConfigEquipos = leerConfig()): EquiposTaller {
  const repo = crearRepoEquipos(hub);
  const drive = cfg.drive;
  // Fuentes NUEVAS en cada corrida (nunca memoizadas): la de Drive cuenta sus copias
  // temporales por instancia y la de Desk 2.0 guarda un mapa de ids de ticket por corrida.
  const fuentes = drive ? () => ({ drive: fuenteDrive(drive), desk2: fuenteDesk2(desk2) }) : null;
  const servicio = crearServicioEquipos({ repo, fuentes, canal: crearCanalAlerta(cfg.alerta), reserva: cfg.reserva });
  if (!drive) console.warn('equipos-taller: sin configurar (faltan o no valen: ' + cfg.faltaDrive.join(', ') + ')');
  return {
    repo,
    servicio,
    // Nunca corre al arrancar (A7): solo agenda la próxima hora diaria.
    iniciarProgramador: () => (drive ? iniciarProgramadorEquipos(() => servicio.ejecutar('programada', null), { hora: cfg.horaDiaria }) : false),
  };
}
