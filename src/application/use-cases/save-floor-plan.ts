import {
  DiningTable,
  Zone,
  type DiningTableProps,
  type Floor,
  type TableShape,
  type ZoneColor,
} from '../../domain/entities.js';
import {
  FloorNotFoundError,
  PlanVersionConflictError,
  ValidationError,
  ZoneNameExistsError,
} from '../../domain/errors.js';
import { parsePlanElements } from '../../domain/plan-schema.js';
import { floorPlanSavedEvent, tableUpsertedEvent, zoneUpsertedEvent } from '../events.js';
import type { UnitOfWorkGateway } from '../ports.js';

export interface PlanZonePayload {
  id: string;
  name: string;
  color?: ZoneColor;
}

export interface PlanTablePayload {
  id: string;
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
}

export interface SaveFloorPlanInput {
  organizationId: string;
  floorId: string;
  /** Versión que el editor tenía al abrir; si no coincide, otra persona guardó. */
  expectedVersion: number;
  floor: { widthCm?: number | null; heightCm?: number | null };
  zones: PlanZonePayload[];
  tables: PlanTablePayload[];
  elements: unknown;
}

function assertUniqueTableNames(tables: PlanTablePayload[]): void {
  const seen = new Set<string>();
  for (const table of tables) {
    // La colación de MySQL (utf8mb4_unicode_ci) ignora mayúsculas, así que la
    // comprobación previa también las ignora: «Mesa 1» y «mesa 1» chocarían igual.
    const key = table.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError([{ field: 'tables', message: `Hay mesas con el mismo nombre en el plano: ${table.name}.` }]);
    }
    seen.add(key);
  }
}

function assertUniqueZoneNames(zones: PlanZonePayload[]): void {
  const seen = new Set<string>();
  for (const zone of zones) {
    const key = zone.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new ValidationError([{ field: 'zones', message: `Hay zonas con el mismo nombre en el plano: ${zone.name}.` }]);
    }
    seen.add(key);
  }
}

function tableChanged(before: DiningTableProps, table: DiningTable): boolean {
  const now = table.toPersistence();
  return (
    before.name !== now.name ||
    before.capacityMin !== now.capacityMin ||
    before.capacityMax !== now.capacityMax ||
    before.zoneId !== now.zoneId ||
    before.xCm !== now.xCm ||
    before.yCm !== now.yCm ||
    before.widthCm !== now.widthCm ||
    before.heightCm !== now.heightCm ||
    before.shape !== now.shape ||
    before.rotationDeg !== now.rotationDeg ||
    before.status !== now.status
  );
}

/**
 * El corazón del editor. Recibe el plano completo y lo aplica en UNA sola
 * transacción: o queda todo o no queda nada. Las mesas y zonas que ya no vienen
 * se desactivan (jamás se borran: el entregable 2 ata reservas a sus ids).
 */
export class SaveFloorPlanUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: SaveFloorPlanInput): Promise<Floor> {
    const uow = await this.uow.begin();
    try {
      const floor = await uow.floors.findById(input.organizationId, input.floorId);
      if (!floor) throw new FloorNotFoundError();

      // El control de versión va antes de tocar la base: si otra persona guardó,
      // no gastamos trabajo ni escribimos nada.
      if (input.expectedVersion !== floor.layoutVersion) {
        throw new PlanVersionConflictError(floor.layoutVersion);
      }

      const elements = parsePlanElements(input.elements);
      assertUniqueZoneNames(input.zones);
      assertUniqueTableNames(input.tables);

      const [existingZones, existingTables] = await Promise.all([
        uow.zones.listByFloor(input.organizationId, input.floorId),
        uow.tables.listByFloor(input.organizationId, input.floorId),
      ]);

      // Las zonas van ANTES que las mesas: `dining_tables.zone_id` tiene llave foránea a `zones`, y una mesa que
      // apunta a una zona nueva no se puede insertar hasta que la zona exista. Los repositorios en memoria de las
      // pruebas no lo sabían, así que esto solo falló contra MySQL real.
      // ── Zonas ────────────────────────────────────────────────────────────
      // `zones` tiene UNIQUE(floor_id, name) SIN condición de estado: una zona
      // desactivada conserva su nombre, así que renombrar es actualizar la misma
      // fila; crear otra con el nombre de una zona vieja daría 409.
      const zoneBefore = new Map(existingZones.map((z) => [z.id, z.toPersistence()]));
      const zonesById = new Map(existingZones.map((z) => [z.id, z]));
      const zonesByName = new Map(existingZones.map((z) => [z.name.trim().toLowerCase(), z]));
      const finalZones: Zone[] = [];
      for (const payload of input.zones) {
        const byName = zonesByName.get(payload.name.trim().toLowerCase());
        if (byName && byName.id !== payload.id) throw new ZoneNameExistsError();

        const existing = zonesById.get(payload.id);
        if (existing) {
          existing.update({ name: payload.name, color: payload.color, status: 'active' });
          finalZones.push(existing);
        } else {
          const clash = await uow.zones.findById(input.organizationId, payload.id);
          if (clash) {
            throw new ValidationError([{ field: 'zones', message: `La zona ${payload.id} ya existe en otra planta.` }]);
          }
          finalZones.push(
            Zone.create({
              id: payload.id,
              organizationId: input.organizationId,
              floorId: input.floorId,
              name: payload.name,
              color: payload.color,
            }),
          );
        }
      }
      if (finalZones.length > 0) await uow.zones.saveMany(finalZones);

      // ── Mesas ────────────────────────────────────────────────────────────
      // Desactivar primero TODAS las activas libera sus nombres (la columna
      // generada `active_name` deja de contar) para que un nombre pueda mudarse
      // de una mesa a otra dentro del mismo guardado sin chocar con el UNIQUE.
      const beforeById = new Map(existingTables.map((t) => [t.id, t.toPersistence()]));
      const activeBefore = existingTables.filter((t) => t.status === 'active');
      if (activeBefore.length > 0) {
        for (const table of activeBefore) table.deactivate();
        await uow.tables.saveMany(activeBefore);
      }

      const tablesById = new Map(existingTables.map((t) => [t.id, t]));
      const incomingTableIds = new Set(input.tables.map((t) => t.id));
      const incomingZoneIds = new Set(input.zones.map((z) => z.id));
      const finalTables: DiningTable[] = [];
      for (const payload of input.tables) {
        // Una mesa que apunta a una zona que ya no está en el plano se queda sin zona.
        const zoneId = payload.zoneId && incomingZoneIds.has(payload.zoneId) ? payload.zoneId : null;
        const existing = tablesById.get(payload.id);
        if (existing) {
          existing.update({
            name: payload.name,
            capacityMin: payload.capacityMin,
            capacityMax: payload.capacityMax,
            zoneId,
            xCm: payload.xCm ?? null,
            yCm: payload.yCm ?? null,
            ...(payload.widthCm !== undefined ? { widthCm: payload.widthCm } : {}),
            ...(payload.heightCm !== undefined ? { heightCm: payload.heightCm } : {}),
            ...(payload.shape !== undefined ? { shape: payload.shape } : {}),
            ...(payload.rotationDeg !== undefined ? { rotationDeg: payload.rotationDeg } : {}),
            status: 'active',
          });
          finalTables.push(existing);
        } else {
          const clash = await uow.tables.findById(input.organizationId, payload.id);
          if (clash) {
            throw new ValidationError([{ field: 'tables', message: `La mesa ${payload.id} ya existe en otra planta.` }]);
          }
          finalTables.push(
            DiningTable.create({
              id: payload.id,
              organizationId: input.organizationId,
              floorId: input.floorId,
              name: payload.name,
              capacityMin: payload.capacityMin,
              capacityMax: payload.capacityMax,
              zoneId,
              xCm: payload.xCm ?? null,
              yCm: payload.yCm ?? null,
              widthCm: payload.widthCm,
              heightCm: payload.heightCm,
              shape: payload.shape,
              rotationDeg: payload.rotationDeg,
            }),
          );
        }
      }
      await uow.tables.saveMany(finalTables);

      const keptZoneIds = new Set(finalZones.map((z) => z.id));
      const zonesToDeactivate = existingZones.filter((z) => z.status === 'active' && !keptZoneIds.has(z.id));
      for (const zone of zonesToDeactivate) zone.deactivate();
      if (zonesToDeactivate.length > 0) await uow.zones.saveMany(zonesToDeactivate);

      // ── Planta ───────────────────────────────────────────────────────────
      if (input.floor.widthCm !== undefined || input.floor.heightCm !== undefined) {
        floor.update({
          widthCm: input.floor.widthCm ?? floor.widthCm,
          heightCm: input.floor.heightCm ?? floor.heightCm,
        });
      }
      floor.recordLayout(elements);
      await uow.floors.save(floor);

      // ── Eventos (dentro de la transacción: si el commit falla, no hay evento) ──
      const wallCount = elements.filter((element) => element.type === 'wall').length;
      await uow.outbox.add(
        floorPlanSavedEvent(floor, { tableCount: finalTables.length, wallCount, elementCount: elements.length }),
      );
      // Las zonas también dejan rastro en la bitácora: sin esto, crear o quitar una zona desde el editor sería invisible.
      for (const zone of finalZones) {
        const before = zoneBefore.get(zone.id);
        const now = zone.toPersistence();
        if (!before || before.name !== now.name || before.color !== now.color || before.status !== now.status) {
          await uow.outbox.add(zoneUpsertedEvent(zone));
        }
      }
      for (const zone of zonesToDeactivate) await uow.outbox.add(zoneUpsertedEvent(zone));
      for (const table of finalTables) {
        const before = beforeById.get(table.id);
        if (!before || tableChanged(before, table)) {
          await uow.outbox.add(tableUpsertedEvent(table, floor.establishmentId));
        }
      }
      for (const table of activeBefore) {
        if (!incomingTableIds.has(table.id)) {
          await uow.outbox.add(tableUpsertedEvent(table, floor.establishmentId));
        }
      }

      await uow.commit();
      return floor;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
