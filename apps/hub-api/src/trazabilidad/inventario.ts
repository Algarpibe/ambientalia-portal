/**
 * QUÉ ES «EL INVENTARIO» DE LA APP, en un solo sitio (lotes 9d-2a y 9f). Es lo
 * que sale en Resumen, Equipos, Calendario y Avisos (y su simulación), lo que
 * tiene seguimiento y contacto y lo que recibe punto de partida en la pasada de
 * calibraciones. El nombre del cliente de un ticket en «Servicios» NO depende de
 * esto (2026-11-04): lo da cualquier equipo del maestro, `CLIENTE_POR_SERIAL`.
 *
 * Un equipo de `portal.tmc_equipos` está en el inventario si está EN
 * SEGUIMIENTO (058: los GRIMM EDM 180, siempre) **o** si su marca está
 * INCLUIDA (061, `portal.tmc_marcas`: un interruptor por marca que enciende o
 * apaga quien tiene `inventario.write`). La inclusión se DERIVA en cada
 * lectura: no se copia a los equipos y nadie escribe `en_seguimiento`
 * (seguimiento.test.ts). Con todas las marcas apagadas —como queda al
 * desplegar: la 061 no siembra— vale exactamente lo de antes.
 *
 * La marca se compara por su clave, la misma con que la app agrupa marcas
 * (`claveMarca` = `claveCliente`, dominio.ts: sin mayúsculas, tildes ni
 * espacios de más), aquí escrita en SQL; marcas.db.test.ts comprueba contra
 * Postgres que las dos dan lo mismo. Sin imports a propósito: lo leen repo.ts,
 * calibraciones-repo.ts y hoja-repo.ts sin ciclos.
 */

const CON_TILDE = 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç';
const SIN_TILDE = 'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc';

/** La clave de la marca de `columna`, en SQL: lo mismo que `claveMarca` en JS. */
export const claveMarcaSql = (columna: string): string => `btrim(regexp_replace(lower(translate(${columna}, '${CON_TILDE}', '${SIN_TILDE}')), '\\s+', ' ', 'g'))`;

/** La condición, sobre una fila de `portal.tmc_equipos`: en seguimiento o de una marca incluida. */
export const EN_INVENTARIO = `(en_seguimiento OR ${claveMarcaSql('marca')} IN (SELECT m.clave FROM portal.tmc_marcas m WHERE m.incluida))`;

/**
 * De quién es cada equipo del maestro, de CUALQUIER marca y esté o no en el
 * inventario: sólo para nombrar al cliente de un ticket en «Servicios» (saber de
 * quién es un equipo no depende de que se siga). Sólo las columnas para el
 * nombre y para elegir uno entre seriales repetidos (`en_inventario` primero).
 * Ningún equipo entra por aquí en Resumen, Equipos, Avisos ni contactos.
 */
export const CLIENTE_POR_SERIAL = `(SELECT clave, serial, cliente, activo, ${EN_INVENTARIO} AS en_inventario FROM portal.tmc_equipos)`;
