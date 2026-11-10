#!/usr/bin/env node
// Anonimiza las fixtures reales del módulo «Equipos en taller» (D9 del diseño).
//
//   node scripts/equipos-anonimizar.mjs generar  <dir-reales> <dir-salida>
//   node scripts/equipos-anonimizar.mjs verificar <dir-reales> <ruta> [<ruta>…]
//
// <dir-reales> es una carpeta LOCAL, ignorada por git, con remisiones.json,
// escaneos-reales.json, roles.local.json y, si está, tickets.json (solo para que
// ningún valor sintético coincida con un serial o un ticket real). Este fichero no
// lleva ningún dato real: todo lo que sabe de los clientes, seriales y tickets lo
// lee de allí.
//
// Qué conserva (lo que prueban las reglas del núcleo):
//   · la CLASE OCR de cada serial: O/0, I/1, S/5, T/7 y B/8 siguen siendo
//     intercambiables y en la misma posición; una letra sigue siendo letra y un
//     dígito, dígito (el serial sin dígitos sigue sin dígitos);
//   · los ceros a la izquierda (no cuentan para la clase y se dejan tal cual);
//   · el prefijo de modelo de GRIMM (18A, 18B, 280…), que es público;
//   · el serial deformado «NN#NNNNN»: sus dígitos pasan a ser los del serial
//     sintético que les corresponde;
//   · las fechas AAMMDD / AAAAMMDD, los números de una o dos cifras, los números
//     de ticket dentro del rango 700–1499 (siguen dentro) y las palabras del
//     formato de la remisión que las reglas reconocen.
// Todo lo demás (clientes, personas, direcciones, otros números y códigos) se
// sustituye por valores sintéticos. La salida solo depende del ORDEN en que
// aparecen los valores, nunca de los valores: no hay forma de deshacerla.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Clases OCR: las mismas funciones que nucleo/reglas.ts ────────────────────
export const key = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
export const nrm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
export const cls = (s) => nrm(s).replace(/^0+(?=.)/, '').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');

/** Clases que se confunden en el OCR, con su forma de dígito y de letra. */
const CONF = { 0: ['0', 'O'], 1: ['1', 'I'], S: ['5', 'S'], T: ['7', 'T'], B: ['8', 'B'] };
const CONF_CLASES = Object.keys(CONF);
const DIGITOS_PLANOS = '23469';
const LETRAS_PLANAS = 'ACDEFGHJKLMNPQRUVWXYZ';

/** Lo que las reglas reconocen por su valor y no se puede tocar (en clase OCR). */
// Los seriales GRIMM (1BA…, 1BB…, 2B0…) NO están aquí: son seriales de clientes. Se
// anonimizan conservando el prefijo y la forma, así que siguen casando con las reglas.
const PROTEGIDAS = [
  /^EDM[12]B0|^AP[A-Z]{2}3T0|^WQ\d|^0CMA|^PG3S0|^US000/, // modelos reconocibles (EQT)
  /^REM20\d\d|^0V1?20\d\d/, // remisiones comerciales
  /^(T1CKET|CANT1DAD|REC1B1D0|B0TELLAS|MAN0METR0)$/, // encabezados y gases
];
const aDigitos = (c) => c.replace(/S/g, '5').replace(/T/g, '7').replace(/B/g, '8');
const esFechaLarga = (c) => /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(aDigitos(c));
const esFechaCorta = (d) => /^2\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(aDigitos(d));
const protegida = (c) => PROTEGIDAS.some((r) => r.test(c)) || esFechaLarga(c) || esFechaCorta(c);
/** Palabra del vocabulario escrita en clase OCR (METR0LAB0R → METROLABOR). */
const deVocabulario = (c) => VOCABULARIO.has(c) || VOCABULARIO.has(c.replace(/0/g, 'O').replace(/1/g, 'I'));
/** Prefijo de modelo GRIMM que se conserva. */
const prefijo = (c) => (/^1B[AB]|^2B0/.test(c) ? 3 : 0);
/**
 * Lo que las reglas miran en la FORMA de un código: serial GRIMM (EQT), modelo «AP..»,
 * «WQ», «EDM», «OCMA». Un valor sintético tiene que tener los mismos rasgos que el real:
 * si no, un número cualquiera podría volverse «serial GRIMM» y cambiar una regla.
 */
const RASGOS = [/^1B[AB][\dSTB]{5}$|^2B0[\dSTB]{5}$/, /^AP[A-Z]{2}/, /^WQ/, /^EDM/, /^0?CMA/];
const mismosRasgos = (a, b) => RASGOS.every((r) => r.test(a) === r.test(b));

/** Vocabulario del formato y de las reglas: se deja tal cual (en mayúsculas sin tildes). */
export const VOCABULARIO = new Set(
  (
    // palabras de STOPW (reglas.ts)
    'SERVICIO EQUIPO EQUIPOS OBSERVACIONES NOVEDADES REMISION FIRMA NOMBRE CEDULA CARGO APLICA ORIGEN DESTINO DIRECCION UNIDADES ' +
    'REMITENTE DESTINATARIO FACTURACION ORIGINAL COLOMBIA HORIBA BOGOTA CREDITO CONTENER DELICADO OPERATIVO CALIBRADO INFORMACION ' +
    'DESCRIPCION AMBIENTALIA ENVIRONICS CERTIFICATION BUREAU VERITAS DIAGNOSTICO MANTENIMIENTO REPARACION CALIBRACION OPTIMAS ' +
    'CONDICIONES ACCESORIO ACCESORIOS FUNCIONAL GENERALES CLIENTE TELEFONO EMPRESA CONTACTO SALIDA ENTRADA INCLUYE TRANSPORTE TARJETA ' +
    'POLIZA SINIESTRO SEGUROS RIESGOS VIGENCIA ADMISION DEVOLUCION INTENTO OFICINA REGISTRO POSTAL MERCANCIA ATLANTICO BARRANQUILLA ' +
    'LABORATORIO TECNICO TECNICA ESPECIALISTA OPERACIONES ' +
    // encabezados, partes, equipos principales, marcas y servicio externo
    'MARCA TICKET DEL SE OBSERVACION NOTA FECHA CANTIDAD RECIBIDO BOTELLAS MANOMETRO ' +
    'CABLE SENSOR CARGADOR ADAPTADOR BATERIA MANGUERA REPUESTO REPUESTOS BOMBA CABEZAL FILTRO KIT MODULO CELDA LAMPARA PANTALLA FUENTE ' +
    'PARTE PARTES TUBO ANTENA MONITOR ANALIZADOR EDM SONDA MEDIDOR ESTACION MUESTREADOR CONTADOR OCMA GRIMM KUNAK TELEDYNE THERMO ' +
    'DAVIS LENOVO MESA LABS TECNICAS OPERATIVA SHELTER DATALOGGER METROLOGICAL METROLABOR EXTERNO ' +
    // texto de entrega en comentarios
    'RECOGE RECOGEN RECOGIDO RECOGIDA RECOGIO RECOGIERON ADJUNTA ADJUNTAN ST ENTREGADO ENTREGADA ENTREGADOS ENTREGADAS ENTREGA ' +
    'ENTREGAN ENTREGARON DESPACHADO DESPACHADA ENVIADO ENVIADA ENVIADOS ENVIADAS CALIBRA FABRICA SENSORES ' +
    // palabras funcionales y del formato
    'DE LA EL LOS LAS Y O U A AL EN POR PARA CON SIN UN UNA UNO NO SI ES N S SN PDF CAJA PODER AIR PRO MODELO SERIAL CANT UNIDAD ' +
    'TOTAL ITEM VALOR'
  ).split(' '),
);
/** Códigos de modelo (no son seriales de nadie): se dejan tal cual. */
const MODELO = /^(EDM\d{0,3}[A-Z]?|AP[A-Z]{2}(-?\d{2,3})?|OCMA(-?\d{2,3})?|PG\d{2,3}|WQ\d{1,4}|US0{3}\d*)$/;

// ── Generador determinista (mulberry32): solo depende del contador ──────────
function hash32(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(semilla) {
  let a = hash32('equipos-anon|' + semilla);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const elegir = (r, s) => s[Math.floor(r() * s.length)];

/**
 * Estado de una anonimización. `evitar` son valores reales (clases y tickets) que
 * ningún valor sintético puede repetir, aunque aún no hayan salido.
 */
export function crearAnonimizador(evitar = new Set()) {
  let n = 0;
  const clases = new Map(); // clase real → clase sintética
  const usadas = new Set();
  const tickets = new Map();
  const numeros = new Map();
  const palabras = new Map(); // palabra real (key) → palabra sintética (key)
  const clientes = new Map(); // palabra real (key) → nombre sintético (mayúsculas)
  const NATO = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECO', 'FOXTROT', 'GOLF', 'HOTEL', 'JULIETT', 'KILO', 'LIMA', 'MIKE'];

  function clase(c) {
    // Menos de 4 caracteres no identifica a nadie, y no hay sitio para variar.
    if (c.length < 4 || protegida(c)) return c;
    const ya = clases.get(c);
    if (ya) return ya;
    for (let intento = 0; ; intento++) {
      if (intento > 500) throw new Error('No se encuentra una clase sintética libre (longitud ' + c.length + ')');
      const r = rng('clase|' + n++);
      const p = prefijo(c);
      const s = [...c].map((x, i) => {
        if (i < p) return x;
        if (i === 0 && x === '0') return '0'; // un cero a la izquierda (OCR) se conserva
        if (CONF_CLASES.includes(x)) return elegir(r, i === 0 ? CONF_CLASES.filter((k) => k !== '0') : CONF_CLASES);
        return /\d/.test(x) ? elegir(r, DIGITOS_PLANOS) : elegir(r, LETRAS_PLANAS);
      }).join('');
      if (s !== c && mismosRasgos(c, s) && !usadas.has(s) && !clases.has(s) && !evitar.has(s) && !protegida(s) && !deVocabulario(s)) {
        clases.set(c, s);
        usadas.add(s);
        return s;
      }
    }
  }

  /** Reescribe un serial tal como está escrito, con la clase sintética de su clase. */
  function serial(raw) {
    const c = cls(raw);
    if (!c || protegida(c)) return raw;
    const s = clase(c);
    const ceros = (nrm(raw).match(/^0+(?=.)/) || [''])[0].length;
    let j = 0;
    return [...raw].map((ch) => {
      if (!/[A-Za-z0-9]/.test(ch)) return ch;
      const i = j++ - ceros;
      if (i < 0) return ch;
      const x = s[i];
      const minuscula = ch !== ch.toUpperCase();
      const out = CONF[x] ? CONF[x][/\d/.test(ch) ? 0 : 1] : x;
      return minuscula ? out.toLowerCase() : out;
    }).join('');
  }

  function ticket(t) {
    const v = String(t);
    const ya = tickets.get(v);
    if (ya) return ya;
    for (;;) {
      const r = rng('ticket|' + n++);
      const s = String(700 + Math.floor(r() * 800));
      if (s !== v && !tickets.has(s) && !evitar.has(s) && ![...tickets.values()].includes(s)) {
        tickets.set(v, s);
        return s;
      }
    }
  }

  function numero(d) {
    const ya = numeros.get(d);
    if (ya) return ya;
    for (;;) {
      const r = rng('numero|' + n++);
      const s = [...d].map((x, i) => (i === 0 && x !== '0' ? elegir(r, '123456789') : elegir(r, '0123456789'))).join('');
      const v = Number(s);
      const enRango = (s.length === 3 || s.length === 4) && v >= 700 && v < 1500;
      if (s !== d && !enRango && !esFechaCorta(s) && ![...numeros.values()].includes(s)) {
        numeros.set(d, s);
        return s;
      }
    }
  }

  const conCaso = (modelo, s) =>
    modelo === modelo.toUpperCase() ? s : modelo === modelo.toLowerCase() ? s.toLowerCase() : s[0] + s.slice(1).toLowerCase();

  function cliente(real) {
    const k = key(real);
    const ya = clientes.get(k);
    if (ya) return ya;
    const s = NATO[clientes.size];
    if (!s) throw new Error('Demasiados clientes con rol: amplía la lista NATO');
    clientes.set(k, s);
    return s;
  }

  function palabra(w) {
    const k = key(w);
    let s = palabras.get(k);
    if (!s) {
      // O/I se quedan O/I (el OCR las lee como 0/1) y S/T/B, S/T/B: la palabra cuenta igual para las reglas.
      // Una palabra de hasta 3 letras hechas solo de esas se deja: no identifica a nadie.
      if (k.length <= 3 && !/[ACDEFGHJKLMNPQRUVWXYZ]/.test(k)) return w;
      for (let intento = 0; ; intento++) {
        if (intento > 500) throw new Error('No se encuentra una palabra sintética libre (longitud ' + k.length + ')');
        const r = rng('palabra|' + n++);
        s = [...k].map((x) => ('OI'.includes(x) ? elegir(r, 'OI') : 'STB'.includes(x) ? elegir(r, 'STB') : /\p{L}/u.test(x) ? elegir(r, LETRAS_PLANAS) : x)).join('');
        if (s !== k && mismosRasgos(nrm(k), nrm(s)) && !VOCABULARIO.has(s) && ![...palabras.values()].includes(s)) break;
      }
      palabras.set(k, s);
    }
    return [...s].map((x, i) => (w[i] && w[i] !== w[i].toUpperCase() ? x.toLowerCase() : x)).join('');
  }

  /** Una palabra o código suelto del texto. */
  function token(t) {
    const k = key(t);
    if (VOCABULARIO.has(k) || MODELO.test(k)) return t;
    if (clientes.has(k)) return conCaso(t, clientes.get(k));
    const c = cls(t);
    if (/\d/.test(t) || clases.has(c)) {
      if (/^\d+$/.test(t)) {
        if (t.length <= 2 || (t.length === 6 && esFechaCorta(t)) || (t.length === 8 && esFechaLarga(t))) return t;
        const v = Number(t);
        if ((t.length === 3 || t.length === 4) && v >= 700 && v < 1500) return ticket(t);
        if (clases.has(c)) return serial(t);
        return numero(t);
      }
      if (protegida(c)) return t;
      return serial(t);
    }
    return palabra(t);
  }

  const DEFORMADO = /\b(\d{2})(\s*[#\\/]+\s*)(\d{4,6})\b/g;
  /** Texto libre (OCR, descripción de un ítem, nombre de archivo). */
  function texto(s) {
    // Una sola pasada: el serial deformado «NN#NNNNN» (grupos 1–3) o una palabra o código suelto.
    return String(s).replace(new RegExp(DEFORMADO.source + '|[\\p{L}\\p{N}]+(?:[-/][\\p{L}\\p{N}]+)*', 'gu'), (t, a, sep, dg) => {
      if (dg) {
        const real = [...clases.keys()].find((c) => aDigitos(c).endsWith(dg));
        return a + sep + (real ? aDigitos(clases.get(real)).slice(-dg.length) : numero(dg));
      }
      // Con guion o barra: si lleva dígitos es un código (serial, fecha, teléfono) y va entero; si no, palabra a palabra.
      if (!/[-/]/.test(t) || /\d/.test(t)) return token(t);
      return t.split(/([-/])/).map((p) => (/^[-/]$/.test(p) ? p : token(p))).join('');
    });
  }

  return { clase, serial, ticket, cliente, texto, mapas: { clases, tickets, clientes } };
}

/** Clases OCR de los seriales de los tickets reales (tickets.json, opcional). */
const seriales = (tickets) =>
  (tickets || []).flatMap((t) => ['cf_serial', 'cf_serial1', 'cf_serial2', 'cf_serial3'].map((k) => cls(t?.cf?.[k] ?? ''))).filter((c) => c.length >= 5);

/** Anonimiza las fixtures. Devuelve los ficheros de salida, ya en texto. */
export function anonimizar(reales) {
  const { roles, remisiones, escaneos } = reales;
  // Ningún valor sintético puede coincidir con un serial o un ticket real conocido (los de los
  // roles y, si está, los de tickets.json), aunque no salgan en estas fixtures.
  const evitar = new Set([...Object.values(roles.seriales || {}).map(cls), ...Object.values(roles.tickets || {}).map(String), ...seriales(reales.tickets), ...(reales.tickets || []).map((t) => String(t.ticketNumber))]);
  const a = crearAnonimizador(evitar);
  const ordenadas = (o) => Object.keys(o || {}).sort();
  // 1) Los roles primero: así su valor sintético no depende del resto.
  const sintetico = { seriales: {}, tickets: {}, clientes: {} };
  for (const r of ordenadas(roles.seriales)) sintetico.seriales[r] = a.serial(roles.seriales[r]);
  for (const r of ordenadas(roles.tickets)) sintetico.tickets[r] = a.ticket(roles.tickets[r]);
  for (const r of ordenadas(roles.clientes)) sintetico.clientes[r] = a.cliente(roles.clientes[r]);
  // 2) Las remisiones (texto OCR), con su clave renombrada.
  const rem = {};
  const renombre = roles.remisiones || {};
  for (const k of Object.keys(renombre).sort((x, y) => renombre[x].localeCompare(renombre[y]))) {
    if (!(k in remisiones)) throw new Error('roles.remisiones nombra una clave que no está en remisiones.json');
    rem[renombre[k]] = a.texto(remisiones[k]);
  }
  for (const k of Object.keys(remisiones)) if (!(k in renombre)) throw new Error('remisiones.json tiene una clave sin rol: añádela a roles.remisiones');
  // 3) Los escaneos ya leídos (clases, ítems y nombres de archivo).
  const escaneo = (x) => {
    const it = {};
    for (const c of Object.keys(x.it || {})) it[a.clase(c)] = { e: a.texto(x.it[c].e || ''), k: x.it[c].k ? a.ticket(x.it[c].k) : '' };
    return { n: a.texto(x.n), d: x.d, t: (x.t || []).map((c) => a.clase(c)), it };
  };
  const esc = {
    _nota: 'Fixtures anonimizadas con apps/hub-api/scripts/equipos-anonimizar.mjs: clientes, seriales, tickets y textos sustituidos de forma determinista; se conservan las peculiaridades del OCR.',
    ilegibles: escaneos.ilegibles.map(escaneo),
    legibles: escaneos.legibles.map(escaneo),
    fechaErrada: escaneo(escaneos.fechaErrada),
  };
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  return { 'remisiones.json': json(rem), 'escaneos.json': json(esc), 'roles.json': json(sintetico) };
}

/**
 * Valores reales que no pueden aparecer en ningún fichero que vaya al repo, en CLASE
 * OCR (así se encuentran escritos de cualquier forma: «0» u «O», «5» o «S»…).
 */
export function valoresReales(reales) {
  const { roles, escaneos } = reales;
  const v = new Set();
  for (const s of Object.values(roles.seriales || {})) v.add(cls(s));
  for (const c of seriales(reales.tickets)) v.add(c);
  for (const c of Object.values(roles.clientes || {})) v.add(cls(key(c)));
  for (const k of Object.keys(roles.remisiones || {})) v.add(cls(key(k)));
  for (const x of [...escaneos.ilegibles, ...escaneos.legibles, escaneos.fechaErrada])
    for (const c of x.t || []) if (c.length >= 5 && !protegida(c) && !deVocabulario(c)) v.add(c);
  return [...v].filter((x) => x.length >= 4);
}
/** Un texto entero pasado a clase OCR, sin quitar separadores (los valores no los llevan). */
const claseTexto = (t) => key(t).replace(/O/g, '0').replace(/I/g, '1').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');

/** Busca valores reales en los ficheros dados. Devuelve «ruta: valor» por cada hallazgo. */
export function buscarFugas(reales, rutas) {
  const valores = valoresReales(reales);
  const tickets = Object.values(reales.roles.tickets || {}).map(String);
  const ficheros = [];
  const recorrer = (p) => {
    if (statSync(p).isDirectory()) { for (const h of readdirSync(p)) if (h !== 'node_modules' && h !== 'fixtures-reales') recorrer(join(p, h)); }
    else ficheros.push(p);
  };
  rutas.forEach(recorrer);
  const fugas = [];
  for (const f of ficheros) {
    const t = readFileSync(f, 'utf8');
    const c = claseTexto(t);
    // Nunca se devuelve el valor: solo el fichero y dónde está la coincidencia.
    for (const x of valores) {
      const pos = c.indexOf(x);
      if (pos >= 0) fugas.push(f + ': coincidencia en la posición ' + pos + ' (longitud ' + x.length + ')');
    }
    for (const x of tickets) {
      const m = new RegExp('(^|[^0-9])' + x + '([^0-9]|$)').exec(t);
      if (m) fugas.push(f + ': coincidencia de ticket en la posición ' + (m.index + m[1].length) + ' (longitud ' + x.length + ')');
    }
  }
  return fugas;
}

function leerReales(dir) {
  const leer = (n) => JSON.parse(readFileSync(join(dir, n), 'utf8'));
  return {
    roles: leer('roles.local.json'),
    remisiones: leer('remisiones.json'),
    escaneos: leer('escaneos-reales.json'),
    tickets: existsSync(join(dir, 'tickets.json')) ? leer('tickets.json') : [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [orden, dir, ...resto] = process.argv.slice(2);
  if (orden === 'generar' && dir && resto.length === 1) {
    const salida = anonimizar(leerReales(dir));
    mkdirSync(resto[0], { recursive: true });
    for (const [n, t] of Object.entries(salida)) writeFileSync(join(resto[0], n), t);
    const fugas = buscarFugas(leerReales(dir), [resto[0]]);
    if (fugas.length) { console.error('FUGA: la salida contiene valores reales:\n' + fugas.join('\n')); process.exit(1); }
    console.log('Fixtures anonimizadas en ' + resto[0]);
  } else if (orden === 'verificar' && dir && resto.length) {
    const fugas = buscarFugas(leerReales(dir), resto);
    if (fugas.length) { console.error('FUGA:\n' + fugas.join('\n')); process.exit(1); }
    console.log('Sin valores reales en: ' + resto.join(', '));
  } else {
    console.error('Uso: equipos-anonimizar.mjs generar <dir-reales> <dir-salida> | verificar <dir-reales> <ruta>…');
    process.exit(2);
  }
}
