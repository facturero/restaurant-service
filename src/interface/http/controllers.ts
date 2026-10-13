import type { Context } from 'hono';
import type { TableShape, ZoneColor } from '../../domain/entities.js';
import type { PartyDuration, ShiftInput } from '../../domain/schedule.js';
import type { EntityStatus } from '../../domain/entities.js';
import type { SetupEstablishmentUseCase } from '../../application/use-cases/setup-establishment.js';
import type { GetFloorPlanUseCase, ListFloorsUseCase } from '../../application/use-cases/floor-queries.js';
import type { UpdateFloorUseCase } from '../../application/use-cases/update-floor.js';
import type { ListTablesUseCase, CreateTableUseCase, UpdateTableUseCase } from '../../application/use-cases/table-use-cases.js';
import type { BulkCreateTablesUseCase } from '../../application/use-cases/bulk-create-tables.js';
import type { SaveFloorPlanUseCase, SaveFloorPlanInput } from '../../application/use-cases/save-floor-plan.js';
import type { ListZonesUseCase, CreateZoneUseCase, UpdateZoneUseCase } from '../../application/use-cases/zone-use-cases.js';
import type {
  AddScheduleExceptionUseCase,
  GetScheduleUseCase,
  RemoveScheduleExceptionUseCase,
  SaveScheduleUseCase,
} from '../../application/use-cases/schedule-use-cases.js';
import type { PreviewSlotsUseCase } from '../../application/use-cases/preview-slots.js';
import type { ContextVariables } from './middlewares.js';
import {
  toExceptionJSON,
  toFloorJSON,
  toFloorPlanJSON,
  toScheduleJSON,
  toScheduleViewJSON,
  toShiftJSON,
  toSlotsPreviewJSON,
  toTableJSON,
  toZoneJSON,
} from './serializers.js';

type Ctx = Context<{ Variables: ContextVariables }>;

// ── Setup / plantas ─────────────────────────────────────────────────────────

export function setupController(useCase: SetupEstablishmentUseCase) {
  return async (c: Ctx) => {
    const result = await useCase.execute({
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
    });
    return c.json({ floor: toFloorJSON(result.floor), schedule: toScheduleJSON(result.schedule) }, 200);
  };
}

export function listFloorsController(useCase: ListFloorsUseCase) {
  return async (c: Ctx) => {
    const floors = await useCase.execute(c.get('organizationId'), c.req.param('establishmentId') ?? '');
    return c.json(floors.map(toFloorJSON), 200);
  };
}

export function getFloorPlanController(useCase: GetFloorPlanUseCase) {
  return async (c: Ctx) => {
    const plan = await useCase.execute(c.get('organizationId'), c.req.param('floorId') ?? '');
    return c.json(toFloorPlanJSON(plan), 200);
  };
}

export function saveFloorPlanController(useCase: SaveFloorPlanUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as Omit<SaveFloorPlanInput, 'organizationId' | 'floorId'>;
    const floor = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      floorId: c.req.param('floorId') ?? '',
    });
    return c.json(toFloorJSON(floor), 200);
  };
}

export function updateFloorController(useCase: UpdateFloorUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      name?: string;
      widthCm?: number | null;
      heightCm?: number | null;
      sortOrder?: number;
      status?: EntityStatus;
    };
    const floor = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      floorId: c.req.param('floorId') ?? '',
    });
    return c.json(toFloorJSON(floor), 200);
  };
}

// ── Mesas ───────────────────────────────────────────────────────────────────

export function listTablesController(useCase: ListTablesUseCase) {
  return async (c: Ctx) => {
    const status = c.req.query('status');
    const tables = await useCase.execute(c.get('organizationId'), c.req.param('establishmentId') ?? '', {
      floorId: c.req.query('floorId') || undefined,
      zoneId: c.req.query('zoneId') || undefined,
      status: status === 'active' || status === 'inactive' ? status : undefined,
    });
    return c.json(tables.map(toTableJSON), 200);
  };
}

export function createTableController(useCase: CreateTableUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      name: string;
      capacityMin: number;
      capacityMax: number;
      zoneId?: string | null;
      xCm?: number | null;
      yCm?: number | null;
      widthCm?: number;
      heightCm?: number;
      shape?: TableShape;
      rotationDeg?: number;
    };
    const table = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      floorId: c.req.param('floorId') ?? '',
    });
    return c.json(toTableJSON(table), 201);
  };
}

export function bulkCreateTablesController(useCase: BulkCreateTablesUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      count: number;
      capacityMin: number;
      capacityMax: number;
      prefix?: string;
    };
    const tables = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      floorId: c.req.param('floorId') ?? '',
    });
    return c.json(tables.map(toTableJSON), 201);
  };
}

export function updateTableController(useCase: UpdateTableUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      name?: string;
      capacityMin?: number;
      capacityMax?: number;
      zoneId?: string | null;
      xCm?: number | null;
      yCm?: number | null;
      widthCm?: number;
      heightCm?: number;
      shape?: TableShape;
      rotationDeg?: number;
      status?: EntityStatus;
    };
    const table = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      tableId: c.req.param('id') ?? '',
    });
    return c.json(toTableJSON(table), 200);
  };
}

// ── Zonas ───────────────────────────────────────────────────────────────────

export function listZonesController(useCase: ListZonesUseCase) {
  return async (c: Ctx) => {
    const zones = await useCase.execute(c.get('organizationId'), c.req.param('floorId') ?? '');
    return c.json(zones.map(toZoneJSON), 200);
  };
}

export function createZoneController(useCase: CreateZoneUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as { name: string; color?: ZoneColor };
    const zone = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      floorId: c.req.param('floorId') ?? '',
    });
    return c.json(toZoneJSON(zone), 201);
  };
}

export function updateZoneController(useCase: UpdateZoneUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as { name?: string; color?: ZoneColor; status?: EntityStatus };
    const zone = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      zoneId: c.req.param('id') ?? '',
    });
    return c.json(toZoneJSON(zone), 200);
  };
}

// ── Horarios ────────────────────────────────────────────────────────────────

export function getScheduleController(useCase: GetScheduleUseCase) {
  return async (c: Ctx) => {
    const view = await useCase.execute(c.get('organizationId'), c.req.param('establishmentId') ?? '');
    return c.json(toScheduleViewJSON(view), 200);
  };
}

export function saveScheduleController(useCase: SaveScheduleUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      timezone?: string;
      slotMinutes?: number;
      cleanupMinutes?: number;
      durationByPartySize?: PartyDuration[];
      shifts: ShiftInput[];
    };
    const result = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
    });
    return c.json({ schedule: toScheduleJSON(result.schedule), shifts: result.shifts.map(toShiftJSON) }, 200);
  };
}

export function addScheduleExceptionController(useCase: AddScheduleExceptionUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      onDate: string;
      kind: 'closed' | 'special_hours';
      opensAt?: string | null;
      closesAt?: string | null;
      reason?: string | null;
    };
    const exception = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
    });
    return c.json(toExceptionJSON(exception), 201);
  };
}

export function removeScheduleExceptionController(useCase: RemoveScheduleExceptionUseCase) {
  return async (c: Ctx) => {
    await useCase.execute({
      organizationId: c.get('organizationId'),
      exceptionId: c.req.param('id') ?? '',
    });
    return c.body(null, 204);
  };
}

export function previewSlotsController(useCase: PreviewSlotsUseCase) {
  return async (c: Ctx) => {
    const date = c.req.query('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ code: 'VALIDATION_ERROR', message: 'El parámetro date es obligatorio (YYYY-MM-DD).' }, 422);
    }
    const preview = await useCase.execute({
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
      date,
    });
    return c.json(toSlotsPreviewJSON(preview), 200);
  };
}
