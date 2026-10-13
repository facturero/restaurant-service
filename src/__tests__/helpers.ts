import type {
  DiningTableRepository,
  DomainEvent,
  FloorRepository,
  OutboxRepository,
  ScheduleRepository,
  TableListFilters,
  UnitOfWork,
  ZoneRepository,
} from '../domain/repositories.js';
import type { WriteUnitOfWork } from '../application/ports.js';
import {
  DiningTable,
  EstablishmentSchedule,
  Floor,
  ScheduleException,
  ScheduleShift,
  Zone,
} from '../domain/entities.js';
import { SetupEstablishmentUseCase } from '../application/use-cases/setup-establishment.js';
import { GetFloorPlanUseCase, ListFloorsUseCase } from '../application/use-cases/floor-queries.js';
import { UpdateFloorUseCase } from '../application/use-cases/update-floor.js';
import { BulkCreateTablesUseCase } from '../application/use-cases/bulk-create-tables.js';
import { CreateTableUseCase, ListTablesUseCase, UpdateTableUseCase } from '../application/use-cases/table-use-cases.js';
import { SaveFloorPlanUseCase } from '../application/use-cases/save-floor-plan.js';
import { CreateZoneUseCase, ListZonesUseCase, UpdateZoneUseCase } from '../application/use-cases/zone-use-cases.js';
import {
  AddScheduleExceptionUseCase,
  GetScheduleUseCase,
  RemoveScheduleExceptionUseCase,
  SaveScheduleUseCase,
} from '../application/use-cases/schedule-use-cases.js';
import { PreviewSlotsUseCase } from '../application/use-cases/preview-slots.js';
import { createApp } from '../interface/http/app.js';
import type { AppDependencies } from '../interface/http/routes.js';

// Las entidades son MUTABLES (update/deactivate), así que una copia superficial
// no basta para simular el rollback de una transacción: hay que clonarlas.
function cloneFloor(f: Floor): Floor {
  return Floor.fromPersistence({ ...f.toPersistence() });
}
function cloneZone(z: Zone): Zone {
  return Zone.fromPersistence({ ...z.toPersistence() });
}
function cloneTable(t: DiningTable): DiningTable {
  return DiningTable.fromPersistence({ ...t.toPersistence() });
}
function cloneSchedule(s: EstablishmentSchedule): EstablishmentSchedule {
  return EstablishmentSchedule.fromPersistence({ ...s.toPersistence() });
}
function cloneMap<T>(src: Map<string, T>, clone: (v: T) => T): Map<string, T> {
  const out = new Map<string, T>();
  for (const [k, v] of src) out.set(k, clone(v));
  return out;
}

interface Snapshot {
  floors: Map<string, Floor>;
  zones: Map<string, Zone>;
  tables: Map<string, DiningTable>;
  schedules: Map<string, EstablishmentSchedule>;
  shifts: Map<string, ScheduleShift>;
  exceptions: Map<string, ScheduleException>;
  outboxLength: number;
}

/** Unit of Work en memoria: cada test crea uno fresco y los repos comparten el
 *  mismo store (simula una transacción única). `snapshot()` + `rollback()` prueban
 *  la atomicidad. */
export class InMemoryUnitOfWork implements WriteUnitOfWork {
  private floorMap = new Map<string, Floor>();
  private zoneMap = new Map<string, Zone>();
  private tableMap = new Map<string, DiningTable>();
  private scheduleMap = new Map<string, EstablishmentSchedule>();
  private shiftMap = new Map<string, ScheduleShift>();
  private exceptionMap = new Map<string, ScheduleException>();
  private snapshotStore: Snapshot | null = null;

  readonly outboxEvents: DomainEvent[] = [];

  snapshot(): void {
    this.snapshotStore = {
      floors: cloneMap(this.floorMap, cloneFloor),
      zones: cloneMap(this.zoneMap, cloneZone),
      tables: cloneMap(this.tableMap, cloneTable),
      schedules: cloneMap(this.scheduleMap, cloneSchedule),
      shifts: new Map(this.shiftMap),
      exceptions: new Map(this.exceptionMap),
      outboxLength: this.outboxEvents.length,
    };
  }

  async commit(): Promise<void> {
    this.snapshotStore = null;
  }

  async rollback(): Promise<void> {
    if (!this.snapshotStore) return;
    this.floorMap = this.snapshotStore.floors;
    this.zoneMap = this.snapshotStore.zones;
    this.tableMap = this.snapshotStore.tables;
    this.scheduleMap = this.snapshotStore.schedules;
    this.shiftMap = this.snapshotStore.shifts;
    this.exceptionMap = this.snapshotStore.exceptions;
    this.outboxEvents.length = this.snapshotStore.outboxLength;
    this.snapshotStore = null;
  }

  readonly floors: FloorRepository = {
    findById: async (orgId, floorId) => {
      const f = this.floorMap.get(floorId);
      return f && f.organizationId === orgId ? f : null;
    },
    listByEstablishment: async (orgId, estId) =>
      [...this.floorMap.values()]
        .filter((f) => f.organizationId === orgId && f.establishmentId === estId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()),
    findFirstByEstablishment: async (orgId, estId) =>
      [...this.floorMap.values()]
        .filter((f) => f.organizationId === orgId && f.establishmentId === estId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null,
    existsByName: async (orgId, estId, name, excludeId) =>
      [...this.floorMap.values()].some(
        (f) => f.organizationId === orgId && f.establishmentId === estId && f.name === name && f.id !== excludeId,
      ),
    save: async (floor) => { this.floorMap.set(floor.id, floor); },
  };

  readonly zones: ZoneRepository = {
    findById: async (orgId, zoneId) => {
      const z = this.zoneMap.get(zoneId);
      return z && z.organizationId === orgId ? z : null;
    },
    listByFloor: async (orgId, floorId) =>
      [...this.zoneMap.values()].filter((z) => z.organizationId === orgId && z.floorId === floorId),
    existsByName: async (orgId, floorId, name, excludeId) =>
      [...this.zoneMap.values()].some(
        (z) => z.organizationId === orgId && z.floorId === floorId && z.name === name && z.id !== excludeId,
      ),
    save: async (zone) => { this.zoneMap.set(zone.id, zone); },
    saveMany: async (zones) => { for (const z of zones) this.zoneMap.set(z.id, z); },
  };

  readonly tables: DiningTableRepository = {
    findById: async (orgId, tableId) => {
      const t = this.tableMap.get(tableId);
      return t && t.organizationId === orgId ? t : null;
    },
    listByFloor: async (orgId, floorId, filters?: TableListFilters) =>
      [...this.tableMap.values()]
        .filter((t) => t.organizationId === orgId && t.floorId === floorId)
        .filter((t) => (filters?.zoneId ? t.zoneId === filters.zoneId : true))
        .filter((t) => (filters?.status ? t.status === filters.status : true)),
    listByEstablishment: async (orgId, estId, filters?: TableListFilters) => {
      const floorIds = new Set(
        [...this.floorMap.values()]
          .filter((f) => f.organizationId === orgId && f.establishmentId === estId)
          .map((f) => f.id),
      );
      return [...this.tableMap.values()]
        .filter((t) => t.organizationId === orgId && floorIds.has(t.floorId))
        .filter((t) => (filters?.floorId ? t.floorId === filters.floorId : true))
        .filter((t) => (filters?.zoneId ? t.zoneId === filters.zoneId : true))
        .filter((t) => (filters?.status ? t.status === filters.status : true));
    },
    existsByName: async (orgId, floorId, name, excludeId) =>
      [...this.tableMap.values()].some(
        (t) =>
          t.organizationId === orgId &&
          t.floorId === floorId &&
          t.name === name &&
          t.status === 'active' &&
          t.id !== excludeId,
      ),
    save: async (table) => { this.tableMap.set(table.id, table); },
    // MySQL exige que la zona exista al insertar la mesa (FK dining_tables.zone_id → zones.id). Se simula aquí para que
    // un orden de escritura equivocado falle en las pruebas y no solo contra una base real.
    saveMany: async (tables) => {
      for (const t of tables) {
        const zoneId = t.toPersistence().zoneId;
        if (zoneId && !this.zoneMap.has(zoneId)) throw new Error(`FK dining_tables.zone_id: la zona ${zoneId} no existe`);
        this.tableMap.set(t.id, t);
      }
    },
  };

  readonly schedules: ScheduleRepository = {
    findByEstablishment: async (orgId, estId) =>
      [...this.scheduleMap.values()].find((s) => s.organizationId === orgId && s.establishmentId === estId) ?? null,
    findById: async (orgId, scheduleId) => {
      const s = this.scheduleMap.get(scheduleId);
      return s && s.organizationId === orgId ? s : null;
    },
    save: async (schedule) => { this.scheduleMap.set(schedule.id, schedule); },
    listShifts: async (orgId, scheduleId) =>
      [...this.shiftMap.values()]
        .filter((s) => s.organizationId === orgId && s.scheduleId === scheduleId)
        .sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt)),
    replaceShifts: async (orgId, scheduleId, shifts) => {
      for (const [id, s] of [...this.shiftMap]) {
        if (s.organizationId === orgId && s.scheduleId === scheduleId) this.shiftMap.delete(id);
      }
      for (const s of shifts) this.shiftMap.set(s.id, s);
    },
    listExceptions: async (orgId, scheduleId) =>
      [...this.exceptionMap.values()]
        .filter((e) => e.organizationId === orgId && e.scheduleId === scheduleId)
        .sort((a, b) => a.onDate.localeCompare(b.onDate)),
    findExceptionById: async (orgId, exceptionId) => {
      const e = this.exceptionMap.get(exceptionId);
      return e && e.organizationId === orgId ? e : null;
    },
    findExceptionByDate: async (orgId, scheduleId, onDate) =>
      [...this.exceptionMap.values()].find(
        (e) => e.organizationId === orgId && e.scheduleId === scheduleId && e.onDate === onDate,
      ) ?? null,
    saveException: async (exception) => { this.exceptionMap.set(exception.id, exception); },
    deleteException: async (orgId, exceptionId) => {
      const e = this.exceptionMap.get(exceptionId);
      if (e && e.organizationId === orgId) this.exceptionMap.delete(exceptionId);
    },
  };

  readonly outbox: OutboxRepository = {
    add: async (event) => { this.outboxEvents.push(event); },
  };
}

/** Gateway que devuelve SIEMPRE el mismo store en memoria: `begin` toma snapshot
 *  y `rollback` lo restaura (simula una transacción por caso de uso). */
export function inMemoryGateway(uow: InMemoryUnitOfWork) {
  return {
    begin: async (): Promise<WriteUnitOfWork> => {
      uow.snapshot();
      return uow;
    },
  };
}

export const UUID = {
  ORG: '11111111-1111-1111-1111-111111111111',
  OTHER_ORG: '22222222-2222-2222-2222-222222222222',
  ESTABLISHMENT: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  ESTABLISHMENT2: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
  FLOOR: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  FLOOR2: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
  TABLE: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  TABLE2: 'abababab-abab-4bab-8bab-abababababab',
  ZONE: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  SCHEDULE: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  USER: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
};

export function seedFloor(
  uow: InMemoryUnitOfWork,
  params: { id?: string; organizationId?: string; establishmentId?: string; name?: string; layoutVersion?: number } = {},
): Floor {
  const floor = Floor.fromPersistence({
    id: params.id ?? UUID.FLOOR,
    organizationId: params.organizationId ?? UUID.ORG,
    establishmentId: params.establishmentId ?? UUID.ESTABLISHMENT,
    name: params.name ?? 'Salón principal',
    widthCm: null,
    heightCm: null,
    sortOrder: 0,
    status: 'active',
    layoutVersion: params.layoutVersion ?? 0,
    layoutElements: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  void uow.floors.save(floor);
  return floor;
}

export function seedSchedule(
  uow: InMemoryUnitOfWork,
  params: { id?: string; organizationId?: string; establishmentId?: string } = {},
): EstablishmentSchedule {
  const schedule = EstablishmentSchedule.create({
    id: params.id ?? UUID.SCHEDULE,
    organizationId: params.organizationId ?? UUID.ORG,
    establishmentId: params.establishmentId ?? UUID.ESTABLISHMENT,
  });
  void uow.schedules.save(schedule);
  return schedule;
}

export function seedTable(
  uow: InMemoryUnitOfWork,
  params: {
    id?: string;
    organizationId?: string;
    floorId?: string;
    zoneId?: string | null;
    name?: string;
    capacityMin?: number;
    capacityMax?: number;
    status?: 'active' | 'inactive';
  } = {},
): DiningTable {
  const table = DiningTable.create({
    id: params.id ?? UUID.TABLE,
    organizationId: params.organizationId ?? UUID.ORG,
    floorId: params.floorId ?? UUID.FLOOR,
    zoneId: params.zoneId ?? null,
    name: params.name ?? 'Mesa 1',
    capacityMin: params.capacityMin ?? 2,
    capacityMax: params.capacityMax ?? 4,
  });
  if (params.status === 'inactive') table.deactivate();
  void uow.tables.save(table);
  return table;
}

/** Checker configurable: por defecto el establecimiento existe. */
export function fixedEstablishmentChecker(result: 'exists' | 'missing' | 'unchecked' = 'exists') {
  return { check: async (): Promise<'exists' | 'missing' | 'unchecked'> => result };
}

export interface TestRequestOptions {
  /** Permisos del header `X-Permissions`; por defecto lectura + gestión. */
  permissions?: string;
  /** `null` omite el header de organización (para probar el 401 de contexto). */
  organizationId?: string | null;
  userId?: string;
  body?: unknown;
}

/**
 * App Hono completa montada sobre repositorios en memoria. Todas las rutas y sus
 * middlewares reales (permisos, contexto, errores) se ejercitan igual que en
 * producción; solo cambia de dónde salen los datos.
 */
export function buildTestApp(params: { establishment?: 'exists' | 'missing' | 'unchecked' } = {}) {
  const uow = new InMemoryUnitOfWork();
  const gateway = inMemoryGateway(uow);
  const repos = { floors: uow.floors, zones: uow.zones, tables: uow.tables, schedules: uow.schedules };

  const deps: AppDependencies = {
    useCases: {
      setupEstablishment: new SetupEstablishmentUseCase(gateway, fixedEstablishmentChecker(params.establishment ?? 'exists')),
      listFloors: new ListFloorsUseCase(repos),
      getFloorPlan: new GetFloorPlanUseCase(repos),
      saveFloorPlan: new SaveFloorPlanUseCase(gateway),
      updateFloor: new UpdateFloorUseCase(gateway),
      listTables: new ListTablesUseCase(repos),
      createTable: new CreateTableUseCase(gateway),
      bulkCreateTables: new BulkCreateTablesUseCase(gateway),
      updateTable: new UpdateTableUseCase(gateway),
      listZones: new ListZonesUseCase(repos),
      createZone: new CreateZoneUseCase(gateway),
      updateZone: new UpdateZoneUseCase(gateway),
      getSchedule: new GetScheduleUseCase(repos),
      saveSchedule: new SaveScheduleUseCase(gateway),
      addScheduleException: new AddScheduleExceptionUseCase(gateway),
      removeScheduleException: new RemoveScheduleExceptionUseCase(gateway),
      previewSlots: new PreviewSlotsUseCase(repos),
    },
    corsOrigin: '*',
  };
  const app = createApp(deps);

  function request(method: string, path: string, opts: TestRequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'X-User-Id': opts.userId ?? UUID.USER,
      'X-Permissions': opts.permissions ?? 'restaurant:read,restaurant:manage',
    };
    if (opts.organizationId !== null) headers['X-Organization-Id'] = opts.organizationId ?? UUID.ORG;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  }

  return { uow, app, request };
}
