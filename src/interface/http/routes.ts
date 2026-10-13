import { Hono } from 'hono';
import type { SetupEstablishmentUseCase } from '../../application/use-cases/setup-establishment.js';
import type { GetFloorPlanUseCase, ListFloorsUseCase } from '../../application/use-cases/floor-queries.js';
import type { UpdateFloorUseCase } from '../../application/use-cases/update-floor.js';
import type { BulkCreateTablesUseCase } from '../../application/use-cases/bulk-create-tables.js';
import type { CreateTableUseCase, ListTablesUseCase, UpdateTableUseCase } from '../../application/use-cases/table-use-cases.js';
import type { SaveFloorPlanUseCase } from '../../application/use-cases/save-floor-plan.js';
import type { CreateZoneUseCase, ListZonesUseCase, UpdateZoneUseCase } from '../../application/use-cases/zone-use-cases.js';
import type {
  AddScheduleExceptionUseCase,
  GetScheduleUseCase,
  RemoveScheduleExceptionUseCase,
  SaveScheduleUseCase,
} from '../../application/use-cases/schedule-use-cases.js';
import type { PreviewSlotsUseCase } from '../../application/use-cases/preview-slots.js';
import {
  addScheduleExceptionController,
  bulkCreateTablesController,
  createTableController,
  createZoneController,
  getFloorPlanController,
  getScheduleController,
  listFloorsController,
  listTablesController,
  listZonesController,
  previewSlotsController,
  removeScheduleExceptionController,
  saveFloorPlanController,
  saveScheduleController,
  setupController,
  updateFloorController,
  updateTableController,
  updateZoneController,
} from './controllers.js';
import {
  addScheduleExceptionSchema,
  bulkCreateTablesSchema,
  createTableSchema,
  createZoneSchema,
  saveFloorPlanSchema,
  saveScheduleSchema,
  updateFloorSchema,
  updateTableSchema,
  updateZoneSchema,
  validateJson,
} from './validators.js';
import { type ContextVariables, requireOrganization, requirePermission } from './middlewares.js';

type Vars = { Variables: ContextVariables };

export interface AppDependencies {
  useCases: {
    setupEstablishment: SetupEstablishmentUseCase;
    listFloors: ListFloorsUseCase;
    getFloorPlan: GetFloorPlanUseCase;
    saveFloorPlan: SaveFloorPlanUseCase;
    updateFloor: UpdateFloorUseCase;
    listTables: ListTablesUseCase;
    createTable: CreateTableUseCase;
    bulkCreateTables: BulkCreateTablesUseCase;
    updateTable: UpdateTableUseCase;
    listZones: ListZonesUseCase;
    createZone: CreateZoneUseCase;
    updateZone: UpdateZoneUseCase;
    getSchedule: GetScheduleUseCase;
    saveSchedule: SaveScheduleUseCase;
    addScheduleException: AddScheduleExceptionUseCase;
    removeScheduleException: RemoveScheduleExceptionUseCase;
    previewSlots: PreviewSlotsUseCase;
  };
  corsOrigin: string;
}

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}

/**
 * El gateway reenvía `ANY /restaurant/*` SIN quitar el prefijo, así que las rutas
 * se sirven con `/restaurant` delante. El health no lleva prefijo.
 */
export function restaurantRoutes(deps: AppDependencies): Hono<Vars> {
  const r = new Hono<Vars>();
  const { useCases } = deps;

  // ── Inicialización / plantas ──────────────────────────────────────────────
  r.post(
    '/restaurant/establishments/:establishmentId/setup',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    setupController(useCases.setupEstablishment),
  );
  r.get(
    '/restaurant/establishments/:establishmentId/floors',
    requireOrganization(),
    requirePermission('restaurant:read'),
    listFloorsController(useCases.listFloors),
  );
  r.get(
    '/restaurant/floors/:floorId/plan',
    requireOrganization(),
    requirePermission('restaurant:read'),
    getFloorPlanController(useCases.getFloorPlan),
  );
  r.put(
    '/restaurant/floors/:floorId/plan',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(saveFloorPlanSchema),
    saveFloorPlanController(useCases.saveFloorPlan),
  );
  r.patch(
    '/restaurant/floors/:floorId',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(updateFloorSchema),
    updateFloorController(useCases.updateFloor),
  );

  // ── Mesas ─────────────────────────────────────────────────────────────────
  // La ruta fija `/tables/bulk` va antes que la de parámetro, por si añadimos
  // `PATCH /restaurant/floors/:floorId/tables/:id` en el futuro.
  r.get(
    '/restaurant/establishments/:establishmentId/tables',
    requireOrganization(),
    requirePermission('restaurant:read'),
    listTablesController(useCases.listTables),
  );
  r.post(
    '/restaurant/floors/:floorId/tables/bulk',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(bulkCreateTablesSchema),
    bulkCreateTablesController(useCases.bulkCreateTables),
  );
  r.post(
    '/restaurant/floors/:floorId/tables',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(createTableSchema),
    createTableController(useCases.createTable),
  );
  r.patch(
    '/restaurant/tables/:id',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(updateTableSchema),
    updateTableController(useCases.updateTable),
  );

  // ── Zonas ─────────────────────────────────────────────────────────────────
  r.get(
    '/restaurant/floors/:floorId/zones',
    requireOrganization(),
    requirePermission('restaurant:read'),
    listZonesController(useCases.listZones),
  );
  r.post(
    '/restaurant/floors/:floorId/zones',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(createZoneSchema),
    createZoneController(useCases.createZone),
  );
  r.patch(
    '/restaurant/zones/:id',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(updateZoneSchema),
    updateZoneController(useCases.updateZone),
  );

  // ── Horarios ──────────────────────────────────────────────────────────────
  r.get(
    '/restaurant/establishments/:establishmentId/schedule/preview',
    requireOrganization(),
    requirePermission('restaurant:read'),
    previewSlotsController(useCases.previewSlots),
  );
  r.get(
    '/restaurant/establishments/:establishmentId/schedule',
    requireOrganization(),
    requirePermission('restaurant:read'),
    getScheduleController(useCases.getSchedule),
  );
  r.put(
    '/restaurant/establishments/:establishmentId/schedule',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(saveScheduleSchema),
    saveScheduleController(useCases.saveSchedule),
  );
  r.post(
    '/restaurant/establishments/:establishmentId/schedule/exceptions',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    validateJson(addScheduleExceptionSchema),
    addScheduleExceptionController(useCases.addScheduleException),
  );
  r.delete(
    '/restaurant/schedule/exceptions/:id',
    requireOrganization(),
    requirePermission('restaurant:manage'),
    removeScheduleExceptionController(useCases.removeScheduleException),
  );

  return r;
}
