import type { EquipoInstalado } from './baseInstalada';
import { SIN_ESTACION, SIN_IDENTIFICAR } from './baseInstalada';
import { ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';
import type { CruceZoho } from './clientes';
import { ETIQUETA_ESTADO_CLIENTE, estadoCliente, hechosDe } from './clientes';

// La única hoja del libro (Excel admite como mucho 31 caracteres).
export const HOJA_EXCEL = 'Base instalada de aire';

// Las columnas del Excel, en su orden.
export const COLUMNAS_EXCEL = [
  'Laboratorio',
  'NIT',
  'Código',
  'Ciudad',
  'Departamento',
  'Estación',
  'Marca',
  'Modelo',
  'Códigos EPA',
  'Variables',
  'Serie',
  'Vigencia más próxima',
  'Estado de la vigencia',
  'Contacto',
  'Teléfono',
  'Correo',
  'Cliente',
  'Última factura',
] as const;

const SEPARADOR = '; ';

// Las dos columnas del cruce con Zoho. Sin cruce (consultando o con error) van
// vacías: un «No está en Zoho» sin haber preguntado sería falso.
function celdasCliente(equipo: EquipoInstalado, hoy: string, cruce: CruceZoho | null): string[] {
  if (cruce === null) return ['', ''];
  return [ETIQUETA_ESTADO_CLIENTE[estadoCliente(equipo.nit, cruce, hoy)], hechosDe(equipo.nit, cruce)?.ultimaFactura ?? ''];
}

// La cabecera y una fila por equipo, en el orden recibido, que es el de la
// pantalla. Marca y Modelo van en el mismo orden: la marca n.º i es la del
// modelo n.º i. Todo es texto, y aoa_to_sheet escribe un texto como celda de
// texto: nada sale como fórmula y un NIT o una serie no pierden ceros.
export function filasExcel(equipos: EquipoInstalado[], hoy: string, cruce: CruceZoho | null = null): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...equipos.map((equipo) => [
      equipo.laboratorio,
      equipo.nit,
      equipo.codigo,
      equipo.ciudad,
      equipo.departamento,
      equipo.estaciones.length === 0 ? SIN_ESTACION : equipo.estaciones.join(SEPARADOR),
      equipo.marcasYModelos.length === 0
        ? SIN_IDENTIFICAR
        : equipo.marcasYModelos.map((par) => par.marca).join(SEPARADOR),
      equipo.marcasYModelos.map((par) => par.modelo).join(SEPARADOR),
      equipo.codigosEpa.join(SEPARADOR),
      equipo.variables.join(SEPARADOR),
      equipo.serie,
      equipo.vigenciaMasProxima ?? '',
      ETIQUETA_VIGENCIA[estadoVigencia(equipo.vigenciaMasProxima, hoy)],
      equipo.contacto,
      equipo.telefono,
      equipo.correo,
      ...celdasCliente(equipo, hoy, cruce),
    ]),
  ];
}

export function nombreDeFichero(hoy: string): string {
  return `base-instalada-aire-${hoy}.xlsx`;
}
