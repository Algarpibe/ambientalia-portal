/**
 * «Equipos en taller» montado: configuración, fuentes, repositorios, servicio y
 * programador. Lo usa index.ts (y nadie más) tras initDb().
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { DbLectura } from '../trazabilidad/fuente.js';
import { crearCanalAlerta } from './alerta.js';
import { leerConfig, type ConfigEquipos } from './config.js';
import { fuenteDesk2 } from './fuente-desk2.js';
import { fuenteN8n } from './fuente-n8n.js';
import { iniciarProgramadorEquipos } from './programador.js';
import { crearRepoEquipos, type RepoEquipos } from './repo.js';
import { crearRepoSync, type RepoSync, type SincronizacionHecha } from './repo-sync.js';
import { crearRepoTablero } from './repo-tablero.js';
import { crearServicioEquipos, type ServicioEquipos } from './servicio.js';
import { crearServicioTablero, type ServicioTablero } from './servicio-tablero.js';

export { createEquiposTallerRouter } from './router.js';
export { detenerProgramadorEquipos } from './programador.js';

export interface EquiposTaller {
  repo: RepoEquipos;
  /** La copia de Drive que manda n8n (rutas /equipos-taller/sync/*). */
  sync: RepoSync;
  servicio: ServicioEquipos;
  /** Ajustes del tablero y llaves de kiosco de la TV (rutas /equipos-taller/tablero/* y /equipos-taller/kiosco/*). */
  tablero: ServicioTablero;
  /** Enciende la corrida diaria. Hasta la primera sincronización completa de n8n, cada corrida programada se omite. */
  iniciarProgramador(): boolean;
}

export function crearEquiposTaller(hub: Pool, desk2: () => DbLectura | null, cfg: ConfigEquipos = leerConfig()): EquiposTaller {
  const repo = crearRepoEquipos(hub);
  const sync = crearRepoSync(hub);
  // Fuentes NUEVAS en cada corrida (nunca memoizadas): la de Desk 2.0 guarda un mapa de ids
  // de ticket por corrida, y la de Drive lee la copia tal como la dejó la pasada `s`.
  const fuentes = (s: SincronizacionHecha) => ({ drive: fuenteN8n(sync, s.pasada), desk2: fuenteDesk2(desk2) });
  const servicio = crearServicioEquipos({ repo, sync, fuentes, maxHorasSync: cfg.maxHorasSync, canal: crearCanalAlerta(cfg.alerta), reserva: cfg.reserva });
  const tablero = crearServicioTablero({ repo, tablero: crearRepoTablero(hub), configurado: () => servicio.configurado() });
  if (!cfg.tokenSync) console.warn('equipos-taller: falta o no vale EQUIPOS_SYNC_TOKEN: n8n no podrá mandar la copia de Drive');
  return {
    repo,
    sync,
    servicio,
    tablero,
    // Nunca corre al arrancar (A7): solo agenda la próxima hora diaria.
    iniciarProgramador: () => iniciarProgramadorEquipos(() => servicio.ejecutar('programada', null), { hora: cfg.horaDiaria }),
  };
}
