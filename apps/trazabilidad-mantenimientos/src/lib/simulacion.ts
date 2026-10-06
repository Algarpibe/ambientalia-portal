/**
 * Lo que pinta la sub-vista «Simulación automática» de «Avisos a clientes».
 * Puro: sin React ni red. El plan (a quién le tocaría el aviso y a quién iría)
 * lo calcula el dominio (`planAvisos`); aquí sólo se redacta, se cuenta y se
 * revisa lo que se teclea en el editor de contacto.
 *
 * Es una SIMULACIÓN: nada de este fichero —ni de la app— envía un correo.
 */
import {
  CONTACTO_MAX_EMAILS,
  esEmail,
  esEmailInterno,
  normalizarEmail,
  type AvisoEquipo,
  type CorreoSimulado,
  type Destinatario,
  type EquipoVista,
  type OrigenContacto,
  type PlanAvisos,
  type TramoAviso,
} from '../dominio';
import { fmtFecha, mensajeAviso } from './vistas';

/**
 * La primera línea del correo: por su nombre si entre los destinatarios hay
 * exactamente uno con nombre; si no hay ninguno o hay varios, el saludo
 * genérico al cliente.
 */
export function saludoAviso(cliente: string, destinatarios: readonly Destinatario[]): string {
  const nombres = [...new Set(destinatarios.map((d) => d.nombre.trim()).filter(Boolean))];
  return nombres.length === 1 ? `Estimado/a ${nombres[0]}:` : `Estimado cliente ${cliente}:`;
}

/** Cómo empieza el asunto en cada tramo: primer aviso, recordatorio y último aviso. */
const ASUNTO_TRAMO: Record<TramoAviso, (monitores: string) => string> = {
  90: (m) => `Calibración de ${m}: vence en los próximos 90 días`,
  60: (m) => `Recordatorio: la calibración de ${m} vence en los próximos 60 días`,
  30: (m) => `Último aviso: la calibración de ${m} vence en los próximos 30 días`,
};

export interface CorreoRedactado {
  /** Los destinatarios, separados por comas; vacío si el grupo no tiene a quién. */
  para: string;
  asunto: string;
  cuerpo: string;
}

/** El correo que se enviaría para un grupo (cliente + tramo): destinatarios, asunto y cuerpo. */
export function correoAviso(c: CorreoSimulado<EquipoVista>): CorreoRedactado {
  const monitores = c.equipos.length === 1 ? 'su monitor GRIMM' : 'sus monitores GRIMM';
  return {
    para: c.destinatarios.map((d) => d.email).join(', '),
    asunto: `${ASUNTO_TRAMO[c.tramo](monitores)} · ${c.cliente}`,
    cuerpo: mensajeAviso(
      c.cliente,
      c.equipos.map((x) => x.equipo),
      { tramo: c.tramo, saludo: saludoAviso(c.cliente, c.destinatarios) },
    ),
  };
}

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

/** La fecha que explica por qué un equipo no está en la simulación, según su motivo. */
export function fechaRelevante(a: AvisoEquipo<EquipoVista>): string {
  if (a.motivo === 'YA_AVISADO') return `avisado el ${fmtFecha(a.equipo.seguimiento?.avisoEnviado)} · en el tramo desde el ${fmtFecha(a.entradaTramo)}`;
  if (a.motivo === 'VENCIDA' || a.motivo === 'FUERA_CICLO') return `venció el ${fmtFecha(a.vence)}`;
  return a.vence ? `vence el ${fmtFecha(a.vence)}` : 'sin fecha de calibración';
}
