/**
 * Lo que pinta la sub-vista «Simulación automática» de «Avisos a clientes».
 * Puro: sin React ni red. El plan (a quién le toca el aviso y a quién iría)
 * lo calcula el dominio (`planAvisos`) y el texto del correo, hub-api
 * (`avisos-correo.ts`: el mismo que redacta el servidor); aquí sólo se cuenta,
 * se junta para copiar y se revisa lo que se teclea en el editor de contacto.
 * Nada de este fichero envía nada.
 */
import {
  CONTACTO_MAX_EMAILS,
  esEmail,
  esEmailInterno,
  normalizarEmail,
  type AvisoEquipo,
  type CorreoRedactado,
  type CorreoSimulado,
  type EquipoVista,
  type OrigenContacto,
  type PlanAvisos,
} from '../dominio';
import { fmtFecha } from './vistas';

/** El saludo y el correo de cada tarjeta viven en hub-api (`avisos-correo.ts`): se reexportan para que la app tenga una sola regla. */
export { correoAviso, saludoAviso } from '../dominio';
export type { CorreoRedactado } from '../dominio';

/** Destinatarios, asunto y cuerpo en un solo texto, para copiarlo al portapapeles. */
export function textoParaCopiar(c: CorreoRedactado): string {
  return `Para: ${c.para || '(sin destinatario)'}\nAsunto: ${c.asunto}\n\n${c.cuerpo}`;
}

export interface ResumenSimulacion {
  /** Correos que se enviarían (grupos con destinatario). */
  correos: number;
  /** Clientes distintos a los que irían. */
  clientes: number;
  /** Equipos que cubren esos correos. */
  equipos: number;
  /** Grupos a los que tocaría avisar pero no tienen a quién. */
  sinDestinatario: number;
  equiposSinDestinatario: number;
}

export function resumenSimulacion(p: PlanAvisos<EquipoVista>): ResumenSimulacion {
  const equiposDe = (l: readonly CorreoSimulado<EquipoVista>[]) => l.reduce((s, c) => s + c.equipos.length, 0);
  return {
    correos: p.correos.length,
    clientes: new Set(p.correos.map((c) => c.claveCliente)).size,
    equipos: equiposDe(p.correos),
    sinDestinatario: p.sinDestinatario.length,
    equiposSinDestinatario: equiposDe(p.sinDestinatario),
  };
}

export interface EmailsRevisados {
  /** Lo tecleado, ya en minúsculas y sin repetir. Vacío = quitar el contacto puesto a mano. */
  emails: string[];
  invalidos: string[];
  /** Los de un dominio propio: se admiten (para probar), pero se señalan. */
  internos: string[];
  /** Por qué no se puede guardar; null si se puede. */
  error: string | null;
}

/**
 * Revisa los correos tecleados en el editor de contacto, separados por comas,
 * punto y coma, espacios o saltos de línea. La misma regla que aplica el
 * servidor (que valida otra vez).
 */
export function revisarEmails(texto: string): EmailsRevisados {
  const emails = [...new Set(texto.split(/[\s,;]+/).map(normalizarEmail).filter(Boolean))];
  const invalidos = emails.filter((e) => !esEmail(e));
  const error = invalidos.length > 0 ? `No son correos válidos: ${invalidos.join(', ')}` : emails.length > CONTACTO_MAX_EMAILS ? `Como mucho ${CONTACTO_MAX_EMAILS} correos por cliente.` : null;
  return { emails, invalidos, internos: emails.filter((e) => esEmail(e) && esEmailInterno(e)), error };
}

export function etiquetaOrigen(origen: OrigenContacto): string {
  return origen === 'desk' ? 'Desk' : 'manual';
}

/** La fecha que explica por qué un equipo no tiene tarjeta, según su motivo (en «vencida», desde cuándo está vencida). */
export function fechaRelevante(a: AvisoEquipo<EquipoVista>): string {
  if (a.motivo === 'YA_AVISADO') return `avisado el ${fmtFecha(a.equipo.seguimiento?.avisoEnviado)} · ${a.tramo === 'vencida' ? 'vencida' : 'en el tramo'} desde el ${fmtFecha(a.entradaTramo)}`;
  if (a.tramo === 'vencida' || a.motivo === 'FUERA_CICLO') return `venció el ${fmtFecha(a.vence)}`;
  return a.vence ? `vence el ${fmtFecha(a.vence)}` : 'sin fecha de calibración';
}
