# restaurant-service — Guía de implementación (para opencode)

> **Objetivo.** Primer entregable del plugin de restaurantes: **mapa del restaurante**. Que el dueño liste sus **mesas**, dibuje
> su local en un **plano opcional** (paredes, puertas, mesas, zonas, con medidas en metros) y configure sus **horarios**.
> **Las reservas NO se construyen aquí** (entregable 2), pero el modelo y los contratos de este entregable están pensados para que
> añadirlas no obligue a migrar ni a reescribir nada.
>
> **Stack:** Node 20 + TypeScript + Hono + Sequelize + MySQL, **misma plantilla que `../inventory-service/`** (léela entera antes de
> escribir una línea: estructura, UoW, outbox, telemetría, CI, k8s, pruebas). Donde este documento no dice otra cosa, **copia el patrón
> de inventory-service**, no inventes uno.
>
> **Diseño de fondo (leer primero):** `C:\Users\sansh\Documents\sg-obs\crm-proyect\servicios\restaurant-service.md`. Este documento es el
> encargo; la nota es el porqué. Si chocan, manda este (la nota tiene un punto simplificado, ver «Decisiones cerradas», fila *Borrador*).

---

## Estado (2026-10-13)

**Entregable 1 construido y verificado.** Lo hizo opencode (fases 0 a 9) y se revisó y terminó después. Lo verificado contra **MySQL 9 real**
(contenedor `cmr-mysql-verify`, puerto 3307, bases de prueba que se borraron): `db:migrate` / `undo` / `migrate` del servicio, de auth y del
catálogo; y el flujo HTTP completo (`setup` → `PUT plan` → 409 por versión vieja → `GET plan` → mesas, zonas, `bulk`, horarios, excepción, vista
previa, aislamiento entre organizaciones y permisos).

| Pieza | Estado |
|---|---|
| `restaurant-service` | 90 pruebas, `typecheck` y `build` limpios; migración probada; flujo real probado |
| auth (permisos) · catálogo · gateway | Migraciones probadas contra MySQL; pruebas en verde |
| Frontend | `vue-tsc`, `lint:ui`, pruebas y `build` limpios; capturas en claro, oscuro y móvil con la API simulada |

### Lo que NO se ha verificado
- La cadena completa **gateway → servicio con un JWT real** y los permisos recién sembrados (necesita desplegar).
- El editor con un backend real (solo con la API simulada).
- `RABBITMQ_URL`: el servicio se probó sin él, así que **la publicación real de eventos del outbox no se ha ejercitado**. Las filas del outbox sí se escriben
  (comprobado en la tabla `outbox_messages`).

### Bugs que las pruebas en memoria NO vieron (y por qué importan)
1. **Orden de escritura en `SaveFloorPlan`:** guardaba las mesas antes que las zonas y MySQL rechazaba la llave foránea `dining_tables.zone_id`
   (500 en cualquier plano con zonas). Arreglado (zonas primero) y el repositorio en memoria de las pruebas ahora **simula esa llave**.
2. **`upsert` en los repositorios:** `INSERT … ON DUPLICATE KEY` reacciona a **cualquier** índice único, no solo a la clave primaria; un nombre de mesa repetido
   pisaba la fila ajena en silencio. Opencode lo detectó contra MySQL; `persistence-guard.test.ts` impide que vuelva.
3. **Zonas sin evento de auditoría:** el guardado del plano creaba y quitaba zonas sin publicar `restaurant.zone.upserted` (el guardia de auditoría es una
   heurística y no lo vio). Arreglado, con prueba.
4. **Frontend — paredes y zonas negras:** `rgb(var(--v-theme-x) / a)` es sintaxis inválida con las variables de Vuetify (llevan comas). Ver `docs/UI-UX.md`.
5. **Frontend — avisos del inspector:** un `v-alert` directo en una columna flex se estiraba a todo el alto. Y las medidas del local salían en 0 m porque el
   inspector solo miraba la selección.

**Lección:** una prueba con repositorios en memoria no prueba nada sobre llaves foráneas, índices únicos ni columnas generadas. Hay que correr el flujo contra MySQL.

---

## 0. Reglas antes de empezar (obligatorias)

- **No hagas commit ni push.** El dueño crea el repo `facturero/restaurant-service` (rama `main`, como `notification-service`,
  `plugin-catalog-service` y `audit-log-service`) y sube él. Un push a la rama principal de un servicio **despliega a producción**.
- **Esta carpeta aún no es un repo git.** Los demás servicios sí lo son y cada uno es independiente: `cd` al servicio antes de usar git
  en ellos. No hagas `git init` aquí.
- **Opencode trabaja en paralelo con otros agentes sobre el mismo árbol.** Antes de crear un archivo, lista la carpeta y lee lo que
  haya; **nunca sobrescribas** una ruta que no hayas leído. Si ves trabajo reciente sin commitear que no es tuyo (en cualquier repo),
  no lo toques y avisa.
- **No toques secretos ni infraestructura real:** ni `config/secrets.production.enc`, ni el clúster, ni Cloudflare, ni bases de
  producción. Lo que necesita el dueño está en la sección 12.
- Los comentarios explican **por qué**, no qué (mira cómo comenta `inventory-service`).
- **Verifica antes de afirmar.** Corre las pruebas y los chequeos; si algo no se pudo ejecutar, dilo en el informe, no lo des por hecho.
- Frontend del CRM: lee `frontend/docs/UI-UX.md` **antes de tocar UI** y cierra con `npm run lint:ui`, `npx vue-tsc --noEmit`,
  `npm test` y `npm run build` en verde. Si tocas un default o una decisión central, actualiza `UI-UX.md` en el mismo cambio.
- Escribe en español (código en inglés, comentarios y textos de usuario en español; i18n es/en/fr).
- Windows + Git Bash: los argumentos que empiezan por `/` se convierten en rutas; usa `MSYS_NO_PATHCONV=1`.

## 1. Qué se quiere (y qué no)

**Entra (entregable 1):**
1. **Lista de mesas** por establecimiento: nombre, capacidad mínima y máxima, zona. Funciona **sin plano**.
2. **Plano opcional** de cada planta: paredes, puertas, objetos decorativos, mesas colocadas, zonas. Medidas reales (metros en la
   interfaz, **centímetros enteros** en los datos).
3. **Horarios:** turnos por día de la semana, excepciones (feriados, cierres), duración de la comida según el grupo, margen de
   limpieza, cada cuántos minutos se ofrece un turno.
4. Plugin vendible `restaurant.floorplan` en el catálogo, permisos, gateway, pantallas del CRM, auditoría, observabilidad, k8s y CI.

**NO entra (no lo construyas ni lo dejes a medias):**
- Reservas, página pública, correos, garantía con tarjeta → entregables 2 a 4.
- **Varias plantas en la interfaz** (entregable 5). **Sí** el modelo: la tabla `floors` existe y cada establecimiento tiene una planta
  creada sola; la interfaz no ofrece crear más.
- Paredes en diagonal o curvas, importar una imagen de plano, 3D.
- Unir mesas. (En el entregable 2 una reserva podrá ocupar **varias mesas sueltas**; no hay mesa combinada.)

## 2. Decisiones cerradas

| Tema | Decisión |
|---|---|
| Plano | **Opcional.** Una mesa existe aunque no tenga posición (`x_cm`, `y_cm` nulos) |
| Unidad | **Centímetros enteros** en base de datos, API y estado del editor. La interfaz muestra metros (`320` → «3,2 m») |
| Plantas | Tabla `floors` desde ya; una planta por establecimiento, creada sola al «inicializar» |
| Borrador | **Simplificado respecto a la nota:** el borrador vive **en el navegador** (autoguardado en `localStorage`) y «Guardar» envía el plano completo en **una sola petición atómica** con control de versión. No hay estado `draft/published` en el servidor |
| Mesas | Con **id estable**: nunca se borran, se **desactivan** (`status = inactive`). En el entregable 2 las reservas apuntarán a ellas |
| Plugin apagado | Es un módulo de pago. El gateway corta el HTTP con `requiresPlugin`; este servicio **no consume eventos** en el entregable 1, así que no hace falta el read-model de activación de inventory |
| Dinero | No hay dinero en este servicio |
| Zona horaria | Cada horario guarda su zona IANA (por defecto `America/Guayaquil`). Hoy no hay horario de verano en Ecuador, pero la organización puede ser de otro país |
| Reservas (futuro) | Límites configurables por el dueño: días de anticipación, personas máximas, mesas máximas por reserva. **Se construyen en el entregable 2**, no ahora |

## 3. Mapa de fases

| Fase | Qué | Tipo |
|---|---|---|
| 0 | Permisos en auth-service · catálogo de plugins · base y `docker-compose` | **Bloqueante** (sin esto no hay nada que probar) |
| 1 | Bootstrap de la carpeta (plantilla de inventory) | Servicio |
| 2 | Migración | Servicio |
| 3 | Dominio | Servicio |
| 4 | Persistencia y unidad de trabajo | Servicio |
| 5 | Casos de uso | Servicio |
| 6 | HTTP (controladores, validadores, `openapi.yaml`) | Servicio |
| 7 | Eventos (`asyncapi.yaml`) y cableado `main.ts` | Servicio |
| 8 | Pruebas | Servicio |
| 9 | Gateway · frontend (lista, editor, horarios) · docs | Fuera del servicio, **necesario para que llegue al usuario** |

Haz las fases en orden y **verifica cada una** (`npm run typecheck && npm test`) antes de pasar a la siguiente.

---

## Fase 0 — Permisos, catálogo y entorno local

### 0.1 Permisos en auth-service

Migración nueva en `backend/auth-service/migrations/` (mira la fecha del último archivo y usa una posterior). **Copia el patrón de
`20260910130000-add-inventory-permissions.js`** (mismo `uuidFromCode`, mismo bump de `permissions_version`, mismo `down`).

```js
const GRANTS = {
  'restaurant:read':   ['Administrador', 'Supervisor', 'Vendedor', 'Solo lectura'],
  'restaurant:manage': ['Administrador'],
};
```

Sin estas filas todas las rutas responden 403 aunque el servicio esté sano (así pasó con inventory). Los permisos de reservas
(`reservation:*`) **no** se siembran ahora: se siembran en el entregable 2.

### 0.2 Catálogo de plugins (`backend/plugin-catalog-service`)

Lee primero cómo se hizo el cambio anterior del catálogo: el commit `fe78792` y la migración
`migrations/20261011100000-remove-redundant-modules.cjs`. **Un cambio de catálogo son dos cosas: la semilla JSON y una migración
que lo aplica en producción.** La semilla sola no basta en una base que ya existe. Y ojo con la trampa conocida: el seeder de perfiles
**no es idempotente** (revienta con «Validation error» si ya hay datos); por eso la migración es el camino para producción.

Añade, en `seed/plugins-dependencias.json`:

- `restaurant.floorplan` — «Mapa del restaurante (mesas, plano y horarios)». Categoría nueva **«Restaurantes y Reservas»**. `status`:
  empieza en `parcial` y pasa a `hecho` **solo al final**, cuando todo lo de abajo esté verificado. `service: "restaurant-service"`,
  `phase: 3`, `depends_on: ["org.establishments"]` (confirma el id con `grep '"id": "org.establishments"'`).
- `restaurant.reservations` — «Reservas de mesas». `status: "falta"`, `service: null`, `depends_on: ["restaurant.floorplan"]`. Aparece
  como «Pronto»; **no se puede activar**.
- Actualiza `meta.total_modulos`, `hechos`, `parciales` y `faltan` (hay pruebas que comprueban que cuadran).

Y en los otros archivos de `seed/`:
- `plugins-i18n.json`: `en` y `fr` de los dos módulos (mira el formato de `inventory.kardex`).
- `plugins-precios.json`: precios **provisionales** `restaurant.floorplan: 599` y `restaurant.reservations: 699` (centavos; 599 = 5,99
  USD). **El dueño aún no decidió el precio**: dilo explícitamente en tu informe final.
- `perfiles-negocio.json`: en `food.restaurant` añade `restaurant.floorplan` como `suggested` (`sort_order` siguiente al último).

Escribe la **migración** que inserte los dos módulos (con sus dependencias, traducciones y precio) y el vínculo con el perfil, **idempotente**
(mira las existentes: `ON DUPLICATE KEY`/comprobación previa). Corre las pruebas del servicio.

### 0.3 Base de datos y compose

- `docker/mysql/init.sql`: añade `CREATE DATABASE IF NOT EXISTS restaurant_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;` junto a las demás.
- `docker-compose.yml` (raíz de `cmr-proyect/`): añade el par `restaurant-migrate` / `restaurant-service` **copiando el bloque de
  `inventory-*`** (≈ línea 623). Puerto **3015** (3013 inventory y 3014 assistant ya están ocupados; **comprueba con
  `grep -rn "3015" backend/*/k8s docker-compose.yml`** que sigue libre). Variables: las de inventory **sin** `PLUGIN_CATALOG_SERVICE_URL`;
  añade `ORG_SERVICE_URL: http://organization-service:3002` (como en el resto del compose). En el servicio `api-gateway`
  añade `RESTAURANT_SERVICE_URL: http://restaurant-service:3015`. Comenta en el sitio por qué 3015.
- El compose raíz **no es un repo git**: edítalo con cuidado y lee el archivo completo de la sección antes de insertar.

---

## Fase 1 — Bootstrap de la carpeta

Crea en `backend/restaurant-service/` (que ya existe y está vacía salvo este documento), **copiando de `../inventory-service/` y
renombrando**: `package.json`, `package-lock.json` (corre `npm install`, no copies el lock), `tsconfig.json`, `vitest.config.ts`,
`.npmrc`, `.sequelizerc`, `sequelize.config.cjs` (`restaurant_db` por defecto), `.gitignore`, `.dockerignore`, `Dockerfile`
(`EXPOSE 3015`), `.env.example` (`PORT=3015`, `restaurant_user`/`restaurant_db`), `.sops.yaml`, `.github/workflows/deploy.yml`,
`k8s/deployment.yaml`, `k8s/service.yaml`.

Diferencias que importan (no copies a ciegas):

| Archivo | Cambio |
|---|---|
| `package.json` | `name: restaurant-service`; quita `decimal.js` y `dinero.js` (no hay dinero ni cantidades); quita dependencias que no uses |
| `.github/workflows/deploy.yml` | Rama **`main`**; nombres `restaurant-service`; secretos `restaurant-db` y `restaurant-rabbitmq` |
| `k8s/deployment.yaml` | Nombre `restaurant-service-node`, initContainer `restaurant-migrate`, puerto **3015**, `CORS_ORIGIN: "https://crm.noahsolution.com"` (**no** copies el ngrok viejo de inventory), sin `PLUGIN_CATALOG_SERVICE_URL`, añade `ORG_SERVICE_URL: "http://organization-service:3002"` (el Service se llama `organization-service`, puerto 3002; confírmalo en `backend/organization-service/k8s/service.yaml`), conserva las variables `OTEL_*` y la nota de «sin limits» |
| `k8s/service.yaml` | Nombre `restaurant-service-node`, puerto 3015 |
| `src/infrastructure/telemetry/otel.ts` | `serviceName` por defecto `restaurant-service`. Los 4xx de negocio **no** deben marcarse como error (mira cómo lo resolvió `billing-service`, en `src/interface/http/app.ts`: se limpia `c.error` para 4xx antes de que lo marque `@hono/otel`; `inventory-service` aún no lo tiene) |
| `config/` | **No crees** `secrets.production.enc`: lo hace el dueño |

`src/infrastructure/config.ts`: como el de inventory, **sin** `PLUGIN_CATALOG_SERVICE_URL` y **con** `ORG_SERVICE_URL` opcional
(`z.string().optional()`). Úsalo así: si falta, la comprobación de que el establecimiento existe se **omite con una advertencia en el
log** (desarrollo local sin organization-service); si está y responde que el establecimiento no existe → 404.

Estructura de `src/` (misma Clean Architecture que inventory):

```
src/
  domain/          entities.ts, errors.ts, repositories.ts, schedule.ts (puro), plan-schema.ts (puro)
  application/     events.ts, ports.ts, use-cases/*
  infrastructure/  config.ts, persistence/{models,repositories,sequelize}.ts, telemetry/otel.ts, org/establishment-check.ts
  interface/http/  app.ts, routes.ts, controllers.ts, validators.ts, serializers.ts, middlewares.ts
  main.ts
```

`middlewares.ts` es **copia literal** del de inventory (contexto por cabeceras `X-Organization-Id`, `X-User-Id`, `X-Permissions`,
`runWithActor` para que cada evento lleve actor/IP/request-id, `requirePermission`, `errorHandler`). Cambia solo el texto del log.

---

## Fase 2 — Migración

Un solo archivo: `migrations/<fecha>-create-restaurant-tables.cjs` (fecha = hoy en el formato de las demás). Convención: `snake_case`,
`underscored`, `char(36)` para ids, `organization_id` en **todas** las tablas con índice, `created_at`/`updated_at`. Incluye `down`
que borra en orden inverso. **No dejes que `sequelize.sync()` cree tablas por su cuenta en producción**: la migración es la fuente de verdad.

| Tabla | Columnas clave | Restricciones |
|---|---|---|
| `floors` | `id`, `organization_id`, `establishment_id`, `name` (80), `width_cm` INT NULL, `height_cm` INT NULL, `sort_order` INT, `status` ENUM(active, inactive), `layout_version` INT NOT NULL DEFAULT 0, `layout_elements` JSON NULL | UNIQUE `(establishment_id, name)`; índice `(organization_id, establishment_id)` |
| `zones` | `id`, `organization_id`, `floor_id`, `name` (60), `color` (20) token del tema, `status` | UNIQUE `(floor_id, name)` |
| `dining_tables` | `id`, `organization_id`, `floor_id`, `zone_id` NULL, `name` (60), `capacity_min` TINYINT, `capacity_max` TINYINT, `x_cm` INT NULL, `y_cm` INT NULL, `width_cm` INT, `height_cm` INT, `shape` ENUM(rect, round), `rotation_deg` SMALLINT, `status` ENUM(active, inactive) | UNIQUE `(floor_id, name)` **solo entre activas** (ver nota); FK lógicas sin `FOREIGN KEY` cruzando servicios; dentro del servicio sí `floor_id`→`floors` |
| `establishment_schedules` | `id`, `organization_id`, `establishment_id` UNIQUE, `timezone` (64), `slot_minutes` SMALLINT, `cleanup_minutes` SMALLINT, `duration_by_party_size` JSON | — |
| `schedule_shifts` | `id`, `organization_id`, `schedule_id`, `weekday` TINYINT (0 = domingo … 6), `opens_at` TIME, `closes_at` TIME, `label` (40) | índice `(schedule_id, weekday)` |
| `schedule_exceptions` | `id`, `organization_id`, `schedule_id`, `on_date` DATE, `kind` ENUM(closed, special_hours), `opens_at` TIME NULL, `closes_at` TIME NULL, `reason` (120) NULL | UNIQUE `(schedule_id, on_date)` |
| `outbox_messages` / `processed_events` | **exactamente** como en `20260910000000-create-inventory-tables.cjs` (esquema de `@facturero/outbox-relay` 0.2.x) | — |

> **Nota sobre `dining_tables`:** la unicidad del nombre «solo entre activas» no se puede expresar con un índice normal en MySQL. Usa una
> **columna generada** `active_name` = `IF(status = 'active', name, NULL)` con UNIQUE `(floor_id, active_name)` (los `NULL` no chocan). Es
> el mismo recurso que usa inventory; **pruébalo contra un MySQL real** (ver sección 11): compila en el papel y falla en el motor.
> Se llama `dining_tables` y no `tables` para no chocar con palabras de SQL ni con el vocabulario de Sequelize.

---

## Fase 3 — Dominio

Entidades con **constructor privado y `create/restore`**, como las de inventory. Reglas que el dominio (no el controlador) hace cumplir:

- **`Floor`:** nombre 1–80; `widthCm`/`heightCm`, si existen, entre 300 y 100 000. `layoutVersion` solo sube de uno en uno.
- **`DiningTable`:** `capacityMin ≥ 1`, `capacityMax ≥ capacityMin`, `capacityMax ≤ 50`. `rotationDeg ∈ {0, 90, 180, 270}`. Medidas 30–600 cm.
  `shape = round` ⇒ `heightCm = widthCm` (diámetro). `x/y` ambos nulos o ambos presentes. Desactivar es `deactivate()`, **no hay `delete`**.
- **`Zone`:** `color` ∈ `primary | secondary | success | info | warning | error` (**tokens del tema, nunca hexadecimales**).
- **`dominio/plan-schema.ts` (puro, con Zod):** valida `layout_elements`. Unión discriminada por `type`:
  - `wall`: `{ id, type, x1, y1, x2, y2, thicknessCm? (def. 10) }` — longitud > 0.
  - `door`: `{ id, type, x, y, widthCm, rotationDeg }`.
  - `object`: `{ id, type, kind: 'bar'|'column'|'restroom'|'kitchen'|'plant'|'stairs'|'entrance', x, y, widthCm, heightCm, rotationDeg, label? }` (decoración **no reservable**).
  - Coordenadas enteras 0–100 000; **máximo 500 elementos**; el JSON serializado **≤ 256 KB**; ids únicos dentro del plano.
- **`dominio/schedule.ts` (puro, sin base de datos ni reloj implícito):**
  - Valida turnos: `opensAt < closesAt` (**sin turnos que crucen la medianoche** en esta versión: dilo en el mensaje de error), sin solapar
    dentro del mismo día. `slotMinutes ∈ {5, 10, 15, 20, 30, 60}`; `cleanupMinutes` 0–120; `timezone` IANA válida (compruébala con
    `new Intl.DateTimeFormat('es', { timeZone })` en un `try`); `durationByPartySize` = lista ordenada `[{ upTo: 2, minutes: 60 }, …]` con la
    **última fila sin tope** (`upTo: null`) y `minutes` 15–480.
  - **`computeSlots(schedule, shifts, exceptions, date): Slot[]`** — para una fecha local devuelve los inicios de turno ofrecidos
    (`{ startsAt: 'HH:mm', shiftLabel }`), aplicando excepciones (`closed` ⇒ vacío; `special_hours` ⇒ reemplaza los turnos de ese día) y
    `slotMinutes`. Es **la base del entregable 2** y lo que muestra la vista previa del dueño. No toca la base: recibe todo por parámetro.
  - **`durationFor(schedule, partySize): number`** — minutos que dura una comida de ese tamaño.
- **Errores** (`errors.ts`, todos con `code` y `httpStatus`): `FloorNotFoundError` (404), `TableNotFoundError` (404), `ZoneNotFoundError` (404),
  `EstablishmentNotFoundError` (404), `TableNameExistsError` (409), `ZoneNameExistsError` (409), `PlanVersionConflictError` (409, devuelve la versión
  actual en `details`), `InvalidPlanError` (422, con `details`), `InvalidScheduleError` (422, con `details`), `ForbiddenError`,
  `OrganizationContextRequiredError`, `UserContextRequiredError` (copia de inventory).

---

## Fase 4 — Persistencia

`models.ts` (Sequelize) y `repositories.ts` con **`SequelizeUnitOfWork`** y **`SequelizeUnitOfWorkFactory`** copiados del de inventory
(`begin()` abre la transacción y llama a `onCommit(tx)` para que el relay publique justo tras el commit). Repositorios: `floors`, `zones`,
`tables`, `schedules` (incluye turnos y excepciones), `outbox`. Reglas:

- **Toda consulta filtra por `organization_id`.** Un id de otra organización es «no encontrado» (404), nunca 403.
- Lecturas sin transacción vía `readOnlyRepositories`, igual que inventory.
- **Toda escritura va dentro de una unidad de trabajo y publica su evento en la MISMA transacción** (`uow.outbox.add(...)` antes de
  `commit`). Esto no es opcional: hay un guardia (`audit-coverage.test.ts`, ver fase 8) que falla si una escritura no publica.

---

## Fase 5 — Casos de uso

Cada uno recibe `UnitOfWorkGateway`, abre la unidad, hace `try { … commit } catch { rollback; throw }` (como `CreateWarehouseUseCase`).

| Caso de uso | Qué hace |
|---|---|
| `SetupEstablishment` | **Idempotente.** Comprueba que el establecimiento existe en la organización (`org/establishment-check.ts`, sección «Fase 1»). Si no hay planta, crea «Salón principal»; si no hay horario, crea uno por defecto (`America/Guayaquil`, `slot 30`, `cleanup 15`, duración 60/90/120 por tamaño 2/4/resto, sin turnos). Devuelve lo que hay. Publica solo si creó algo |
| `ListFloors` / `GetFloorPlan` | `GetFloorPlan` devuelve `{ floor, zones, tables, layout: { version, elements } }` |
| `UpdateFloor` | Renombrar, dimensiones, `sort_order`, desactivar |
| `CreateZone` / `UpdateZone` | Con nombre único por planta |
| `CreateTable` / `UpdateTable` | Una mesa suelta (modo lista, sin plano) |
| `BulkCreateTables` | «¿Cuántas mesas tienes?»: `count` (1–100), `capacityMin`, `capacityMax`, prefijo (`Mesa`); las nombra `Mesa 1…N` **continuando desde la última** si ya hay; sin posición |
| `SaveFloorPlan` | **El corazón del editor.** Recibe `{ expectedVersion, floor: { widthCm, heightCm }, zones[], tables[], elements[] }`. En **una transacción**: valida el plano con `plan-schema`; si `expectedVersion ≠ layout_version` → `PlanVersionConflictError`; crea las mesas y zonas con id nuevo (el cliente las manda con un uuid), actualiza las que ya existen y **desactiva** las que ya no vienen (jamás las borra); guarda `layout_elements`; sube `layout_version`; publica **un** evento `restaurant.floor_plan.saved` más uno `restaurant.table.upserted` por cada mesa creada o cambiada |
| `GetSchedule` | Horario + turnos + excepciones del establecimiento |
| `SaveSchedule` | Reemplaza atómicamente ajustes y turnos (valida con `domain/schedule.ts`) |
| `AddScheduleException` / `RemoveScheduleException` | Una por fecha; evento en ambos |
| `PreviewSlots` | Solo lectura: `computeSlots` para una fecha, para que el dueño vea lo que verá el cliente |

---

## Fase 6 — HTTP

El gateway reenvía `ANY /restaurant/*` **sin quitar el prefijo** (`stripPrefix: ''`): el servicio sirve las rutas con `/restaurant`.
Contexto por cabeceras (`X-Organization-Id`, `X-User-Id`, `X-Permissions`). `GET /health` sin prefijo ni autenticación (como inventory).

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `POST /restaurant/establishments/:establishmentId/setup` | `restaurant:manage` | Inicializa (idempotente) |
| `GET /restaurant/establishments/:establishmentId/floors` | `restaurant:read` | Plantas |
| `GET /restaurant/floors/:floorId/plan` | `restaurant:read` | Plano completo |
| `PUT /restaurant/floors/:floorId/plan` | `restaurant:manage` | **Guardar el plano** (atómico, con `expectedVersion`) |
| `PATCH /restaurant/floors/:floorId` | `restaurant:manage` | Nombre, medidas, estado |
| `GET /restaurant/establishments/:establishmentId/tables` | `restaurant:read` | Mesas (filtros `floorId`, `zoneId`, `status`) |
| `POST /restaurant/floors/:floorId/tables` | `restaurant:manage` | Una mesa |
| `POST /restaurant/floors/:floorId/tables/bulk` | `restaurant:manage` | Varias mesas |
| `PATCH /restaurant/tables/:id` | `restaurant:manage` | Editar o desactivar/reactivar |
| `GET /restaurant/floors/:floorId/zones` · `POST …/zones` · `PATCH /restaurant/zones/:id` | read / manage | Zonas |
| `GET /restaurant/establishments/:id/schedule` | `restaurant:read` | Horario completo |
| `PUT /restaurant/establishments/:id/schedule` | `restaurant:manage` | Reemplaza ajustes y turnos |
| `POST /restaurant/establishments/:id/schedule/exceptions` | `restaurant:manage` | Añade excepción |
| `DELETE /restaurant/schedule/exceptions/:id` | `restaurant:manage` | Quita excepción |
| `GET /restaurant/establishments/:id/schedule/preview?date=YYYY-MM-DD` | `restaurant:read` | Turnos que se ofrecerían ese día |

- **Validación con Zod** en `validators.ts` (`@hono/zod-validator`), con mensajes en español. Rechaza campos desconocidos.
- **Respuestas:** mismas formas que inventory (`code`, `message`, `details`). Listas sin paginar (una planta tiene decenas de mesas).
- **Orden de rutas de Hono:** rutas fijas (`/tables/bulk`) **antes** que las de parámetro (`/tables/:id`).
- **`maxBodyBytes`:** el plano puede pesar hasta ~256 KB; el cuerpo de `PUT …/plan` debe permitir 512 KB (revisa el límite por ruta del
  gateway en la fase 9; el servicio no debe limitar por debajo).
- **Contratos:** `openapi.yaml` completo (mira el de inventory). Es fuente de verdad: si el código y el YAML difieren, está mal uno de los dos.

---

## Fase 7 — Eventos y arranque

Publica por outbox (exchange `crm.events`). **`organizationId` va en el payload de todo evento** (`domainEvent()` de inventory ya lo hace).
`audit-log-service` consume `#`, así que **cada tipo nuevo aparece solo en la bitácora**; aun así revisa si el frontend tiene un mapa de
etiquetas por tipo de evento (`frontend/src/views/audit/`, `i18n`) y añade los nuevos.

| Tipo | Agregado | Cuándo | Payload (además de `organizationId`) |
|---|---|---|---|
| `restaurant.floor.created` / `restaurant.floor.updated` | floor | Alta (setup) y cambios | `floorId`, `establishmentId`, `name`, `status` |
| `restaurant.floor_plan.saved` | floor | Cada `PUT …/plan` | `floorId`, `establishmentId`, `version`, `tableCount`, `wallCount`, `elementCount` |
| `restaurant.table.upserted` | table | Alta, cambio, desactivación | `tableId`, `floorId`, `establishmentId`, `name`, `capacityMin`, `capacityMax`, `zoneId`, `status` |
| `restaurant.zone.upserted` | zone | Alta o cambio | `zoneId`, `floorId`, `name`, `color`, `status` |
| `restaurant.schedule.updated` | schedule | `SaveSchedule` y alta inicial | `establishmentId`, `timezone`, `slotMinutes`, `shiftCount` |
| `restaurant.schedule_exception.created` / `.deleted` | schedule | Excepciones | `establishmentId`, `onDate`, `kind` |

`asyncapi.yaml` los declara (mira el de inventory). **El servicio no consume eventos en este entregable.**

`main.ts`: como el de inventory pero **sin** `startEventConsumers` ni read-model de plugin; con `OutboxRelay` si hay `RABBITMQ_URL`
(y la misma advertencia si falta) y `relay?.attachToTransaction(tx)` en la fábrica de la unidad de trabajo.

---

## Fase 8 — Pruebas

`vitest`, en `src/__tests__/` (**está excluido del `tsconfig.json`**: un `typecheck` verde no dice nada sobre las pruebas; corre
`npm test`). Copia el estilo de `helpers.ts` de inventory (repositorios en memoria + app de prueba).

**Obligatorias:**
1. `audit-coverage.test.ts` — **cópialo de `../customer-service/src/__tests__/audit-coverage.test.ts`** (o inventory). Falla si una escritura no
   publica evento; no añadas exenciones.
2. `plan-schema.test.ts` — acepta un plano válido; rechaza: elemento desconocido, coordenada fuera de rango, pared de longitud 0,
   ids repetidos, más de 500 elementos, JSON de más de 256 KB.
3. `schedule.test.ts` — **la más importante en dominio puro.** `computeSlots`: sin turnos ⇒ vacío; un turno de 12:00–15:00 con `slot 30` ⇒
   12:00…14:30; excepción `closed` ⇒ vacío; `special_hours` reemplaza; dos turnos el mismo día; la fecha cae en el día de semana correcto
   (cuidado con la zona horaria: usa fechas locales `YYYY-MM-DD`, no `Date` en UTC). Validación: turno invertido, solapados, `slotMinutes`
   inválido, zona horaria inventada, tabla de duración sin fila final abierta. `durationFor` en los bordes (2, 3, 4, 5, 20).
4. `setup.test.ts` — idempotente: dos llamadas = una planta y un horario; establecimiento inexistente ⇒ 404; sin `ORG_SERVICE_URL` omite la comprobación.
5. `tables.test.ts` — capacidad inválida ⇒ 422; nombre repetido ⇒ 409; **desactivar libera el nombre**; `bulk` continúa la numeración; nunca hay `DELETE`.
6. `save-plan.test.ts` — guardar crea mesas y zonas; volver a guardar con las mismas es idempotente; una mesa que ya no viene queda **inactiva y
   conserva su id**; `expectedVersion` viejo ⇒ 409 con la versión actual; la versión sube de uno en uno; **una sola transacción** (si un elemento
   es inválido no queda nada a medias); los eventos se publican **dentro** de la transacción.
7. `isolation.test.ts` — la organización B no ve, ni modifica, ni adivina por id lo de la A (siempre 404).
8. `permissions.test.ts` — sin `restaurant:read` ⇒ 403 en lecturas; sin `restaurant:manage` ⇒ 403 en escrituras; sin organización ⇒ error de contexto.
9. `http.test.ts` — contrato de cada ruta (estado y forma), orden de rutas (`/tables/bulk`), cuerpo grande (~200 KB) del plano aceptado.

---

## Fase 9 — Fuera del servicio

### 9.1 Gateway (`backend/api-gateway-node`)

- `src/config/gateway.config.ts`: `if (env.RESTAURANT_SERVICE_URL) services.push({ name: 'restaurant-service', url: env.RESTAURANT_SERVICE_URL })`,
  la variable en el esquema de entorno, y la ruta
  `{ method: 'ANY', path: '/restaurant/*', service: 'restaurant-service', stripPrefix: '', requiresPlugin: 'restaurant.floorplan' }`.
  Sigue el lugar y el estilo de `/warehouses/*`. Comenta que esto corta el HTTP, y que el servicio no consume eventos.
- **`maxBodyBytes`** específico para `PUT /restaurant/floors/*/plan` (512 KB) si el gateway tiene el límite por ruta (mira `maxBodyBytes: 256 * 1024`
  en `gateway.config.ts`, ruta de telemetría, para el ejemplo).
- `k8s/deployment.yaml`: `RESTAURANT_SERVICE_URL: "http://restaurant-service-node:3015"`.
- Añade pruebas en el estilo de las existentes (la ruta exige el plugin; sin el plugin ⇒ `403 PLUGIN_NOT_ACTIVE`).
- **Orden de despliegue (dilo en tu informe):** `auth-service` (permisos) → `plugin-catalog-service` (módulos) → `restaurant-service` → `api-gateway-node` → `frontend`.

### 9.2 Frontend (`frontend/`) — lee `docs/UI-UX.md` primero

**Archivos** (patrón de inventory: `src/api/inventory.ts`, `src/stores/inventory.ts`, `src/views/inventory/`, `src/types/`):
`src/types/restaurant.ts`, `src/api/restaurant.ts`, `src/stores/restaurant.ts`, `src/views/restaurant/{TablesView,FloorPlanView,ScheduleView}.vue`,
`src/components/restaurant/…`, rutas en `src/router/index.ts` (`meta: { requiresAuth: true, requiredPlugin: 'restaurant.floorplan' }`),
ítem de menú en `src/menus/navigation.ts` (`permission: 'restaurant:read'`, `plugin: 'restaurant.floorplan'`, icono `mdi-silverware-fork-knife`),
textos en `src/i18n/{es,en,fr}.json` (**los tres idiomas**; los parámetros `{x}` iguales en los tres).

**Pantallas.** Toda vista empieza con `<PageHeader>`; usa los defaults de `plugins/vuetify.ts`, los tokens del tema, **ningún hexadecimal**,
sin `<style>` en vistas.

1. **Mesas (`/restaurant/tables`)** — la pantalla por defecto. Primera vez (sin mesas): *«¿Cuántas mesas tienes?»* con cantidad y capacidad ⇒
   `bulk`. Después, una tabla editable (nombre, capacidad mín/máx, zona, activa) con «Añadir mesa». Un botón **«Dibujar mi local»** lleva al plano.
   Al abrir el establecimiento por primera vez se llama a `setup` (idempotente). Si la organización tiene varios establecimientos, un selector arriba.
2. **Plano (`/restaurant/plan`)** — el editor (sección siguiente).
3. **Horarios (`/restaurant/schedule`)** — por día de la semana, uno o más turnos (hora de apertura y cierre, etiqueta); «copiar a todos los
   días»; ajustes (cada cuántos minutos se ofrece un turno, margen de limpieza, duración por tamaño de grupo en una tabla pequeña, zona horaria);
   lista de **excepciones** (fecha, cerrado u horario especial, motivo); y una **vista previa**: elige una fecha y muestra los turnos que verá
   el cliente (`schedule/preview`). Es la prueba de que quedó bien configurado.

**El editor del plano (`components/restaurant/floorplan/`).** Es la pieza más delicada. Principios: mínimo de herramientas, medidas siempre a la
vista, nada que exija leer un manual.

- **SVG con Vue, sin librería gráfica.** Un `viewBox` en **centímetros**; el zoom y el arrastre cambian el `viewBox`. Estado en un store de Pinia
  con **comandos** (`do/undo/redo`): deshacer y rehacer ilimitados (pila en memoria). Los elementos se pintan con **tokens del tema vía CSS
  variables de Vuetify** (`rgb(var(--v-theme-...))`) — **ningún hexadecimal**; el modo oscuro tiene que verse bien.
- **Cuadrícula:** líneas cada 1 m (más fuertes) y, al acercar, cada 10 cm. **Imán a 10 cm** (50 cm con una tecla mientras se arrastra).
  Las coordenadas se redondean a enteros de centímetro **al crear**, nunca después.
- **Herramientas** (barra lateral, atajos de teclado, tooltips): **Seleccionar/mover**, **Pared**, **Puerta**, **Mesa**, **Zona**, **Objeto**
  (barra, columna, baño, cocina, planta, escalera, entrada), **Borrar**.
- **Pared:** clic–clic encadenado; **ángulos rectos por defecto** (mantener Shift permite libre solo si el producto lo decide más adelante: en este
  entregable **solo ortogonal**); etiqueta viva con la longitud («3,2 m»); **al escribir un número mientras se dibuja, se fija esa medida exacta**
  (en metros, admite coma y punto). Doble clic o Esc termina.
- **Atajo «Salón»:** el botón «Salón 8 × 6 m» pide ancho y largo y crea las cuatro paredes de una vez. Cubre la mayoría de los locales.
- **Puerta:** se coloca sobre una pared y se ajusta a ella.
- **Mesa:** paleta (2, 4, 6 personas, redonda de 4; medidas sensatas por defecto: 80×80 cm para 2, 120×80 para 4, 180×80 para 6, Ø100 redonda).
  Giro de 90° en 90° (tecla R). **Duplicar en fila:** «5 mesas separadas 1 m» (cantidad, dirección, separación). Panel de propiedades: nombre,
  capacidad mín/máx, zona.
- **Zona:** rectángulo semitransparente con nombre y color de una paleta de **tokens** (`primary`, `secondary`, `success`, `info`, `warning`, `error`).
- **Avisos suaves (no bloquean):** mesas que se solapan, pasillos de menos de 60 cm entre mesas, mesas sin capacidad, mesa fuera del salón.
- **Guardado:** el **borrador se autoguarda en `localStorage`** (clave por usuario y organización, como el borrador de la caja web en
  `stores/pos.ts`); el botón **«Guardar»** envía todo con `PUT …/plan` y `expectedVersion`. Si el servidor responde **409**, avisa
  («Otra persona modificó el plano») y ofrece **recargar** descartando el borrador, o **copiar el suyo** antes de recargar. Al salir con cambios sin
  guardar, confirma.
- **Tablet:** mover y colocar mesas debe funcionar **con el dedo** (eventos de puntero, no solo ratón). Dibujar paredes se puede dejar
  para pantalla grande: en pantallas estrechas oculta esas herramientas y dilo.
- **Componente de solo lectura** (`FloorPlanViewer.vue`) que pinte el mismo plano sin herramientas: lo reutilizará el entregable 2 para que el
  cliente elija mesa. Pruébalo en la vista de horarios o de mesas si hay sitio; si no, déjalo hecho y probado.
- **Pruebas (`vitest`):** el store del editor (comandos, deshacer/rehacer, imán a 10 cm, redondeo a enteros, conversión cm↔m, duplicar en fila,
  detección de solapes y pasillos, serialización a `PUT`) y las utilidades puras. **Verifica en el navegador** (`preview_start` / Playwright,
  que ya está instalado en `frontend/`) con la API simulada, como se hizo con la caja web: dibujar un salón, colocar mesas, guardar, recargar, el
  conflicto 409. Haz capturas en modo claro y oscuro y en móvil.

### 9.3 Documentos

- `frontend/docs/UI-UX.md`: si el editor introduce una excepción al sistema de UI (lo probable: SVG con CSS variables), documéntala como se hizo
  con la caja web y `PosThemePreview`.
- `C:\Users\sansh\Documents\sg-obs\crm-proyect\servicios\restaurant-service.md`: pasa su **Estado** de «solo análisis» a lo que sea verdad y
  corrige la fila de *borrador/publicar* (ahora: borrador en el navegador, guardado atómico con versión).
- `AGENTS.md`/`COSAS-POR-HACER.md` (raíz): añade el servicio al mapa y los pendientes del dueño (sección 12).

---

## 10. Trampas conocidas del proyecto (que ya costaron tiempo)

1. **`src/__tests__` está excluido de `tsconfig.json`:** `typecheck` verde ≠ pruebas verdes. Corre las dos.
2. **La columna generada de MySQL y los índices** compilan en el papel y fallan en el motor: pruébalos de verdad (sección 11).
3. **`@hono/otel` marca como error todo lo que llega a `onError`:** hay que limpiar `c.error` en los 4xx de negocio.
4. **Los eventos en la misma transacción:** publicar el evento después del `commit` rompe la bitácora si el proceso cae entre medias. Siempre `uow.outbox.add` antes de `commit`.
5. **No dupliques el corte por plugin** entre gateway y servicio: dos comprobaciones con dos cachés acaban discrepando.
6. **Windows/Git Bash:** `MSYS_NO_PATHCONV=1` para argumentos con `/`; el `heredoc` se come las barras invertidas (usa archivos).
7. **Vite solo lee variables de `.env`**; `VITE_X=… npm run dev` no funciona.
8. **Frontend: nunca un hexadecimal** y casi nunca un `<style>`; el guardián `npm run lint:ui` solo mira archivos **registrados en git** (`git add -N` los archivos nuevos para que los vea).
9. **Fechas y zonas horarias:** trabaja con fechas locales `YYYY-MM-DD` y horas `HH:mm`; convertir a UTC solo en el entregable 2, en el momento de guardar una reserva.

## 11. Definición de hecho

- [ ] Fases 0 a 9 completas; `npm run typecheck`, `npm test` y `npm run build` en verde en `restaurant-service`.
- [ ] Cambios del gateway, catálogo y auth con sus pruebas en verde (`npm test` en cada uno).
- [ ] Frontend: `npx vue-tsc --noEmit`, `npm run lint:ui`, `npm test`, `npm run build` en verde, y **capturas** del editor, mesas y horarios (claro, oscuro, móvil).
- [ ] **Contra una base real:** levantar MySQL (`docker compose up mysql`), correr `db:migrate`, `db:migrate:undo` y `db:migrate` otra vez, y una
      petición real de `setup` → `PUT plan` → `GET plan`. Si **no** se pudo hacer, escríbelo en el informe en una sección «Sin verificar»: es
      la parte que más falla (columna generada, JSON, TIME).
- [ ] `openapi.yaml` y `asyncapi.yaml` coinciden con el código.
- [ ] `restaurant.floorplan` pasa a `hecho` en el catálogo **solo si todo lo anterior está verificado**.
- [ ] Informe final con: qué hiciste, qué **no** verificaste, el precio provisional, y las decisiones que tomaste fuera de este documento.

## 12. Lo que tiene que hacer el dueño (no lo hagas tú)

1. Crear el repo `facturero/restaurant-service` (rama `main`), con el secreto `NODE_AUTH_TOKEN` (como `assistant-service`) y los de SOPS.
2. Crear `restaurant_db` y el usuario `restaurant_user` en el MySQL del clúster con sus `GRANT`, y `config/secrets.production.enc` (SOPS) con
   `DB_*` y `RABBITMQ_URL`.
3. Decidir el precio de los dos plugins (hoy provisional).
4. Subir en orden: `auth-service` → `plugin-catalog-service` → `restaurant-service` → `api-gateway-node` → `frontend`.

## 13. Entregable 2 (solo para que el diseño de ahora lo permita; NO lo construyas)

- Tablas `reservations`, `reservation_tables` (una reserva ocupa **varias** mesas sueltas), `reservation_settings` (límites del dueño).
- Disponibilidad = mesas activas sin otra reserva solapada (duración + margen). **Bloqueo de las mesas dentro de una transacción de MySQL** para
  que dos clientes no tomen la misma mesa a la vez.
- Asignación: la mesa más pequeña en la que cabe el grupo; si ninguna, varias libres cuya capacidad sume, preferiblemente de la misma zona.
- Eventos `restaurant.reservation.*` que consume `notification-service` (correo al cliente, correo + campana del CRM al restaurante).
- Página pública: **decisión del dueño aún pendiente** (dónde vive y cómo se llama).
- Lo que ya deja listo este entregable: `computeSlots`, `durationFor`, mesas con id estable, `FloorPlanViewer`, y el patrón de eventos.
