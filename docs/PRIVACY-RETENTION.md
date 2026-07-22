# Privacidad, retención y borrado — antigravity-suite

> Cierra **PRIV-002** de la auditoría (retención/supresión). Ámbito: la réplica
> **zoho-hub** y las apps del portal que la leen. La política de tratamiento a
> nivel organizacional y el aviso de privacidad público (PRIV-003) son un asunto
> legal aparte; aquí se documenta la parte técnica y el proceso operativo.
>
> Campos marcados **`[Definir]`** son decisiones de negocio/legales que deben
> completar el responsable de tratamiento y el área legal — no se asumen aquí.

## 1. Marco legal

Ley 1581 de 2012 (Colombia) y Decreto 1074 de 2015. Derechos del titular
(art. 8): **conocer, actualizar, rectificar y suprimir** sus datos, y revocar la
autorización. Este documento define cómo se atienden **rectificación y
supresión** en esta capa técnica.

- **Responsable del tratamiento:** `[Definir: razón social + NIT de Ambientalia]`
- **Área/rol que atiende solicitudes de titulares:** `[Definir: p. ej. protecciondedatos@ambientalia.com.co]`
- **Plazo legal de respuesta:** consulta ≤ 10 días hábiles; reclamo ≤ 15 días
  hábiles (Ley 1581, arts. 14–15).

## 2. Inventario de datos en el hub

`zoho-hub` es una **réplica read-only** de Zoho (CRM/Books/Desk). El API
`hub-api` expone, de esa réplica:

- **`customer_name`** (razón social del cliente, campo "Cliente"), en las apps de
  datos y analítica. Para clientes persona natural puede constituir dato personal.
- **Cifras agregadas**: facturas, pagos, ítems/SKU, montos, fechas.
- **NIT** del cliente (`books.contacts.nit`), en:
  - **WO-sales** — columna obligatoria (`Encab: Tercero Externo`) del archivo plano
    que World Office importa para crear los pedidos: sin él la carga es imposible.
  - **Contabilidad** y **Conciliador de Pagos** — en el modal de *detalle* de una
    factura/OV (`/api/contabilidad/factura|ov/:numero` y
    `/api/invoices|sales-orders/:numero/detail`), junto al encabezado del documento.
- **Dirección** del cliente (`billing_address` → `address`, `city`), en el modal de
  *detalle* de factura/OV de **Contabilidad** y **Conciliador de Pagos**.

**Finalidad y base legal:** contable y de conciliación de cartera (identificar
inequívocamente al tercero de un documento y su domicilio fiscal); base legal en la
ejecución de la relación comercial y el cumplimiento de obligaciones contables/
tributarias. Para clientes persona natural, NIT y dirección constituyen dato
personal (Ley 1581 de 2012).

**No** se expone email, teléfono ni cédula por ninguna query del hub.

Medidas asociadas:

- **Acceso restringido por app en el servidor** (`requireApp`, no solo en el
  frontend): `/api/wo-sales/*` → `requireApp('WO-sales')`; `/api/contabilidad/*` →
  `requireApp('contabilidad')`; y los endpoints de datos/detalle de las demás apps
  (`payment-reconciliation`, `customer-profitability`, `inventory-optimization`,
  `customer-valuation`) exigen su `requireApp` correspondiente. Así, solo los
  usuarios con la app asignada acceden al NIT/dirección; un usuario sin la app
  recibe 403 (cierre de **SEC-210 / SEC-211 / PRIV-810**).
- **No se almacena ni se cachea el detalle**: NIT y dirección se leen bajo demanda
  de `books.contacts` / `books.*.raw` para el documento consultado; el archivo de
  WO-sales se genera bajo demanda y se descarga.

Los `query params` de estos endpoints son números de documento, fechas y un nombre
de cliente opcional.

**PRIV-815 — `customer_name` en `query params`** (p. ej. `/api/wo-sales/preview?cliente=…`):
la URL completa puede quedar registrada. Mitigación: Sentry **elimina la query string**
antes de enviar (PRIV-813, `scrubEvent`), así que no se transfiere a un tercero. El
vector residual es el **access-log del reverse-proxy de EasyPanel** — asunto de infra:
configurar el formato de log para no registrar la query, o restringir su acceso. No se
movió `cliente` a cabecera/cuerpo para no tocar el flujo crítico de generación de
archivos de World Office por un riesgo bajo ya mitigado en Sentry.

### 2.1 Log de auditoría de gestión de usuarios (usuarios INTERNOS) — PRIV-814

`AuditLogger` (`hub-api/src/users/audit.logger.ts`) escribe una línea JSON a stdout por
cada operación admin sobre usuarios, con `adminEmail`, `targetEmail` y `operation`
(Requisito 5.5). Son datos de **usuarios internos** (staff), no de clientes, y el email
es **necesario** para la finalidad del registro: trazabilidad/accountability de quién
realizó cada cambio (base legal: interés legítimo del responsable en la seguridad y el
control de accesos). No se sustituye por `user_id` porque perdería legibilidad y
rompería el requisito/su test.

- **Retención y acceso** `[Definir]`: fijar el periodo de conservación de estos logs en
  el agregador (p. ej. 90–180 días) y restringir su acceso al administrador.

## 3. Arquitectura del dato (clave para retención/borrado)

```
Zoho (FUENTE DE VERDAD)  ──sync (worker @algarpibe/zoho-sync, ~cada 3 min)──▶  zoho-hub (réplica read-only)  ──▶  hub-api  ──▶  portal
```

- **Sistema de registro = Zoho.** El hub es un derivado; **no** se edita ni se
  borra directamente en el hub (el usuario de DB solo tiene `SELECT`).
- Cualquier rectificación o supresión debe hacerse **en Zoho**, y **propagarse**
  al hub por el worker de sincronización.

## 4. Política de retención

- El hub **no define una retención propia**: refleja lo que exista en Zoho. El
  dato vive en el hub mientras exista en Zoho.
- **Retención en Zoho (fuente):** `[Definir: periodo de conservación de datos de
  clientes/facturación — típicamente ligado a obligaciones contables/tributarias,
  p. ej. conservación de soportes contables]`.
- Al vencer la retención (o ante una supresión aprobada) el registro se elimina
  o anonimiza **en Zoho**, y el cambio debe reflejarse en el hub (§5, §6).

## 5. Proceso de rectificación / supresión (paso a paso)

1. **Recepción**: la solicitud del titular llega al canal definido (`[Definir]`).
2. **Verificación de identidad** del solicitante: `[Definir método]`.
3. **Procedencia legal**: validar que no aplique una excepción (p. ej. deber
   legal de conservar soportes contables/tributarios). `[Legal]`.
4. **Acción en Zoho** (sistema de registro): rectificar o suprimir/anonimizar el
   registro del cliente.
5. **Propagación al hub**: asegurar que el cambio llegue a `zoho-hub` (ver §6 —
   hoy hay una brecha técnica a cerrar).
6. **Verificación**: confirmar que el hub ya no expone el dato (query de §7).
7. **Registro y respuesta**: documentar la solicitud y responder al titular
   dentro del plazo legal.

## 6. Brecha técnica a cerrar (propagación de borrados)

El worker de sync (`@algarpibe/zoho-sync`, **fuera de este repo**) sincroniza
Zoho → hub. **Requisito a verificar/implementar en el worker:**

- Si el worker solo hace **upsert** (insert/update) y **nunca borra**, un
  registro **eliminado en Zoho quedaría huérfano** en el hub indefinidamente —
  incumpliendo una supresión. Esto es lo que PRIV-002 marca como pendiente.
- **Recomendación para el worker** (elegir una):
  - **Reconciliación por barrido**: tras cada sync, borrar del hub las filas
    cuyo identificador ya no exista en el conjunto traído de Zoho (delete-by-diff).
  - **Tombstones**: que Zoho marque bajas y el worker propague el borrado.
  - Como mínimo, un **job periódico de reconciliación** (p. ej. diario) que
    elimine huérfanos.

> Acción: confirmar el comportamiento actual del worker y, si solo hace upsert,
> implementar el borrado propagado. Se rastrea como tarea del repo del worker.

## 7. Verificación / auditoría

Consulta de control para detectar si un cliente **suprimido en Zoho sigue en el
hub** (ejecutar en la DB `zoho-hub`, ajustando el nombre):

```sql
-- ¿El cliente "X" todavía aparece en la réplica?
SELECT 'invoices' AS origen, count(*) FROM books.invoices        WHERE customer_name ILIKE '%X%'
UNION ALL
SELECT 'payments',            count(*) FROM books.customer_payments WHERE customer_name ILIKE '%X%';
```

Si tras la supresión en Zoho + sync estas cuentas no llegan a 0, la propagación
de borrado (§6) no está funcionando.

## 8. Relacionados

- **PRIV-003** (aviso de privacidad público en el portal): pendiente, asunto
  legal — publicar la política de tratamiento y el canal de derechos del titular.
- **Minimización**: no añadir email/teléfono/cédula a las queries del hub. La PII
  vigente (NIT y dirección, ver §2) está limitada a WO-sales y a los modales de
  detalle de Contabilidad/Conciliador de Pagos, con finalidad contable y acceso
  restringido por app (`requireApp`). Cualquier otra ampliación de la superficie de
  PII debe decidirse de forma explícita y quedar documentada aquí, no colarse dentro
  de una query.
