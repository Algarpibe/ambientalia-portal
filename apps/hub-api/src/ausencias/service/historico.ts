import type { Pool } from '@algarpibe/zoho-sync';
import { resolverEmpleado, validarFilasHistorico } from '../historico.js';
import * as repo from '../repo.js';

// ARQ-612 — la importación del histórico de la hoja, sacada de service.ts tal
// cual. Validar las filas y atribuir cada nombre a un empleado lo hace
// ../historico.ts, que es pura; aquí se junta con el repo y se resume.
// service.ts lo reexporta (lo vigila barril.test.ts).

export interface ResumenImportacion {
  /** Filas leídas del Excel. */
  total: number;
  /** De esas, las que se pudieron atribuir a un empleado. */
  resueltas: number;
  importadas: number;
  yaExistian: number;
  /** Nombres que no casan con nadie. Se enseñan, no se adivinan. */
  sinResolver: string[];
  /** Nombres que casan con más de una persona. */
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/**
 * Importa el histórico que solo vivía en la hoja.
 *
 * Con `dryRun` no escribe nada: la UI lo llama primero así para poder enseñar
 * el recuento y los nombres problemáticos antes de tocar la tabla.
 *
 * Importa lo que resuelve y **reporta lo que no**, en vez de abortar entero por
 * un nombre suelto. Reimportar es inocuo (el INSERT se salta lo que ya está),
 * así que corregir el maestro y volver a pasar el fichero es el camino natural.
 */
export async function importarHistorico(db: Pool, body: unknown): Promise<ResumenImportacion> {
  const filas = validarFilasHistorico(body);
  const dryRun = (body as { dryRun?: unknown })?.dryRun === true;
  const empleados = await repo.listarEmpleados(db);

  const resueltas: repo.FilaHistoricoResuelta[] = [];
  const sinResolver = new Set<string>();
  const ambiguos = new Map<string, string[]>();

  for (const f of filas) {
    const r = resolverEmpleado(f.nombre, empleados);
    if (r.ambiguo) {
      ambiguos.set(f.nombre, r.ambiguo.map((e) => e.nombreCompleto));
      continue;
    }
    if (!r.empleado) {
      sinResolver.add(f.nombre);
      continue;
    }
    resueltas.push({
      empleadoId: r.empleado.id,
      tipo: f.tipo,
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      dias: f.dias,
      comentarios: f.comentarios,
      observaciones: f.observaciones,
      // Todas las de la hoja están resueltas: las incapacidades se informan y el
      // resto llegó con «Aprobado? = Sí» (los rechazos nunca se registraron).
      estado: f.tipo === 'incapacidad' ? 'registrada' : 'aprobada',
    });
  }

  const { importadas, yaExistian } = await repo.importarHistorico(db, resueltas, dryRun);

  return {
    total: filas.length,
    resueltas: resueltas.length,
    importadas,
    yaExistian,
    sinResolver: [...sinResolver],
    ambiguos: [...ambiguos].map(([nombre, candidatos]) => ({ nombre, candidatos })),
  };
}
