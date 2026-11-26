import type { GrupoProspecto, Prospecto } from './prospects';
import { ETIQUETA_GRUPO, ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';

// La única hoja del libro.
export const HOJA_EXCEL = 'Prospectos';

// Las columnas del Excel, en su orden.
export const COLUMNAS_EXCEL = [
  'Laboratorio',
  'NIT',
  'Código',
  'Ciudad',
  'Departamento',
  'Grupo',
  'Matrices',
  'Métodos',
  'Vigencia más próxima',
  'Estado de la vigencia',
  'Contacto',
  'Teléfono',
  'Correo',
] as const;

const SEPARADOR = '; ';

// La cabecera y una fila por laboratorio, en el orden recibido, que es el de la
// pantalla. Todo es texto, y aoa_to_sheet escribe un texto como celda de texto:
// un nombre que empiece por «=» nunca sale como fórmula, y un NIT o un teléfono
// no pierden ceros ni se vuelven números.
export function filasExcel(prospectos: Prospecto[], hoy: string): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...prospectos.map((prospecto) => [
      prospecto.nombre,
      prospecto.nit,
      prospecto.codigo,
      prospecto.ciudad,
      prospecto.departamento,
      ETIQUETA_GRUPO[prospecto.grupo],
      prospecto.matrices.join(SEPARADOR),
      prospecto.metodos.join(SEPARADOR),
      prospecto.vigenciaMasProxima ?? '',
      ETIQUETA_VIGENCIA[estadoVigencia(prospecto.vigenciaMasProxima, hoy)],
      prospecto.contacto,
      prospecto.telefono,
      prospecto.correo,
    ]),
  ];
}

export function nombreDeFichero(grupo: GrupoProspecto, hoy: string): string {
  return `prospectos-grasas-aceites-${grupo}-${hoy}.xlsx`;
}
