import { Op, Transaction } from 'sequelize';
import { withActor } from '@facturero/outbox-relay';
import { sequelize } from './sequelize.js';
import {
  DiningTableModel,
  EstablishmentScheduleModel,
  FloorModel,
  OutboxModel,
  ScheduleExceptionModel,
  ScheduleShiftModel,
  ZoneModel,
} from './models.js';
import {
  DiningTable,
  EstablishmentSchedule,
  Floor,
  ScheduleException,
  ScheduleShift,
  Zone,
} from '../../domain/entities.js';
import type {
  DiningTableRepository,
  DomainEvent,
  FloorRepository,
  OutboxRepository,
  ScheduleRepository,
  UnitOfWork,
  ZoneRepository,
} from '../../domain/repositories.js';
import type { WriteUnitOfWork } from '../../application/ports.js';

// ── Mappers ─────────────────────────────────────────────────────────────────

// MySQL devuelve TIME como 'HH:mm:ss'; el dominio trabaja en 'HH:mm'. Se
// normaliza al leer para que `isTime`/`computeSlots` no vean los segundos.
function toHhMm(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

function toFloor(m: FloorModel): Floor {
  return Floor.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    establishmentId: m.establishment_id,
    name: m.name,
    widthCm: m.width_cm,
    heightCm: m.height_cm,
    sortOrder: m.sort_order,
    status: m.status,
    layoutVersion: m.layout_version,
    layoutElements: m.layout_elements,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toZone(m: ZoneModel): Zone {
  return Zone.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    floorId: m.floor_id,
    name: m.name,
    color: m.color,
    status: m.status,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toDiningTable(m: DiningTableModel): DiningTable {
  return DiningTable.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    floorId: m.floor_id,
    zoneId: m.zone_id,
    name: m.name,
    capacityMin: Number(m.capacity_min),
    capacityMax: Number(m.capacity_max),
    xCm: m.x_cm,
    yCm: m.y_cm,
    widthCm: Number(m.width_cm),
    heightCm: Number(m.height_cm),
    shape: m.shape,
    rotationDeg: Number(m.rotation_deg),
    status: m.status,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toSchedule(m: EstablishmentScheduleModel): EstablishmentSchedule {
  return EstablishmentSchedule.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    establishmentId: m.establishment_id,
    timezone: m.timezone,
    slotMinutes: Number(m.slot_minutes),
    cleanupMinutes: Number(m.cleanup_minutes),
    durationByPartySize: m.duration_by_party_size ?? [],
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  });
}

function toShift(m: ScheduleShiftModel): ScheduleShift {
  return ScheduleShift.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    scheduleId: m.schedule_id,
    weekday: Number(m.weekday),
    opensAt: toHhMm(m.opens_at) ?? '00:00',
    closesAt: toHhMm(m.closes_at) ?? '00:00',
    label: m.label,
    createdAt: m.created_at,
  });
}

function toException(m: ScheduleExceptionModel): ScheduleException {
  return ScheduleException.fromPersistence({
    id: m.id,
    organizationId: m.organization_id,
    scheduleId: m.schedule_id,
    onDate: m.on_date,
    kind: m.kind,
    opensAt: toHhMm(m.opens_at),
    closesAt: toHhMm(m.closes_at),
    reason: m.reason,
    createdAt: m.created_at,
  });
}

// ── Factories de repositorios (comparten la transacción del UnitOfWork) ─────

function floorRepository(tx?: Transaction): FloorRepository {
  return {
    async findById(organizationId, floorId) {
      const m = await FloorModel.findOne({
        where: { id: floorId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toFloor(m) : null;
    },
    async listByEstablishment(organizationId, establishmentId) {
      const rows = await FloorModel.findAll({
        where: { organization_id: organizationId, establishment_id: establishmentId },
        transaction: tx,
        order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      });
      return rows.map(toFloor);
    },
    async findFirstByEstablishment(organizationId, establishmentId) {
      const m = await FloorModel.findOne({
        where: { organization_id: organizationId, establishment_id: establishmentId },
        transaction: tx,
        order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
      });
      return m ? toFloor(m) : null;
    },
    async existsByName(organizationId, establishmentId, name, excludeId) {
      const where: Record<string, unknown> = {
        organization_id: organizationId,
        establishment_id: establishmentId,
        name,
      };
      if (excludeId) where.id = { [Op.ne]: excludeId };
      return (await FloorModel.count({ where, transaction: tx })) > 0;
    },
    async save(floor) {
      const p = floor.toPersistence();
      const values = {
        id: p.id,
        organization_id: p.organizationId,
        establishment_id: p.establishmentId,
        name: p.name,
        width_cm: p.widthCm,
        height_cm: p.heightCm,
        sort_order: p.sortOrder,
        status: p.status,
        layout_version: p.layoutVersion,
        layout_elements: p.layoutElements,
        updated_at: new Date(),
      };
      // Nada de `upsert`: en MySQL el `INSERT … ON DUPLICATE KEY UPDATE`
      // reacciona a CUALQUIER índice único, así que guardar una planta con un
      // nombre ya usado pisaría la otra fila en silencio en lugar de devolver
      // 409. Se decide por la clave primaria y se deja que el índice haga su
      // trabajo. Lo mismo en el resto de `save` de este archivo.
      if (await FloorModel.findByPk(p.id, { attributes: ['id'], transaction: tx })) {
        await FloorModel.update(values, { where: { id: p.id }, transaction: tx });
      } else {
        await FloorModel.create({ ...values, created_at: p.createdAt }, { transaction: tx });
      }
    },
  };
}

function zoneRepository(tx?: Transaction): ZoneRepository {
  return {
    async findById(organizationId, zoneId) {
      const m = await ZoneModel.findOne({
        where: { id: zoneId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toZone(m) : null;
    },
    async listByFloor(organizationId, floorId) {
      const rows = await ZoneModel.findAll({
        where: { organization_id: organizationId, floor_id: floorId },
        transaction: tx,
        order: [['created_at', 'ASC']],
      });
      return rows.map(toZone);
    },
    async existsByName(organizationId, floorId, name, excludeId) {
      const where: Record<string, unknown> = { organization_id: organizationId, floor_id: floorId, name };
      if (excludeId) where.id = { [Op.ne]: excludeId };
      return (await ZoneModel.count({ where, transaction: tx })) > 0;
    },
    async save(zone) {
      const p = zone.toPersistence();
      const values = {
        id: p.id,
        organization_id: p.organizationId,
        floor_id: p.floorId,
        name: p.name,
        color: p.color,
        status: p.status,
        updated_at: new Date(),
      };
      if (await ZoneModel.findByPk(p.id, { attributes: ['id'], transaction: tx })) {
        await ZoneModel.update(values, { where: { id: p.id }, transaction: tx });
      } else {
        await ZoneModel.create({ ...values, created_at: p.createdAt }, { transaction: tx });
      }
    },
    async saveMany(zones) {
      for (const zone of zones) await this.save(zone);
    },
  };
}

function diningTableRepository(tx?: Transaction): DiningTableRepository {
  async function list(where: Record<string, unknown>): Promise<DiningTable[]> {
    const rows = await DiningTableModel.findAll({
      where,
      transaction: tx,
      order: [['created_at', 'ASC'], ['name', 'ASC']],
    });
    return rows.map(toDiningTable);
  }

  return {
    async findById(organizationId, tableId) {
      const m = await DiningTableModel.findOne({
        where: { id: tableId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toDiningTable(m) : null;
    },
    async listByFloor(organizationId, floorId, filters) {
      const where: Record<string, unknown> = { organization_id: organizationId, floor_id: floorId };
      if (filters?.zoneId) where.zone_id = filters.zoneId;
      if (filters?.status) where.status = filters.status;
      return list(where);
    },
    async listByEstablishment(organizationId, establishmentId, filters) {
      const floorRows = await FloorModel.findAll({
        where: { organization_id: organizationId, establishment_id: establishmentId },
        attributes: ['id'],
        transaction: tx,
      });
      const floorIds = floorRows.map((f) => f.id);
      if (floorIds.length === 0) return [];
      const where: Record<string, unknown> = { organization_id: organizationId, floor_id: { [Op.in]: floorIds } };
      if (filters?.floorId) where.floor_id = filters.floorId;
      if (filters?.zoneId) where.zone_id = filters.zoneId;
      if (filters?.status) where.status = filters.status;
      return list(where);
    },
    async existsByName(organizationId, floorId, name, excludeId) {
      // Solo entre ACTIVAS: el UNIQUE es sobre la columna generada active_name.
      const where: Record<string, unknown> = { organization_id: organizationId, floor_id: floorId, name, status: 'active' };
      if (excludeId) where.id = { [Op.ne]: excludeId };
      return (await DiningTableModel.count({ where, transaction: tx })) > 0;
    },
    async save(table) {
      const p = table.toPersistence();
      const values = {
        id: p.id,
        organization_id: p.organizationId,
        floor_id: p.floorId,
        zone_id: p.zoneId,
        name: p.name,
        capacity_min: p.capacityMin,
        capacity_max: p.capacityMax,
        x_cm: p.xCm,
        y_cm: p.yCm,
        width_cm: p.widthCm,
        height_cm: p.heightCm,
        shape: p.shape,
        rotation_deg: p.rotationDeg,
        status: p.status,
        updated_at: new Date(),
      };
      // Ver la nota de `floorRepository.save`: aquí el índice único es sobre la
      // columna generada `active_name`, y un `upsert` la habría ignorado.
      if (await DiningTableModel.findByPk(p.id, { attributes: ['id'], transaction: tx })) {
        await DiningTableModel.update(values, { where: { id: p.id }, transaction: tx });
      } else {
        await DiningTableModel.create({ ...values, created_at: p.createdAt }, { transaction: tx });
      }
    },
    async saveMany(tables) {
      for (const table of tables) await this.save(table);
    },
  };
}

function scheduleRepository(tx?: Transaction): ScheduleRepository {
  return {
    async findByEstablishment(organizationId, establishmentId) {
      const m = await EstablishmentScheduleModel.findOne({
        where: { organization_id: organizationId, establishment_id: establishmentId },
        transaction: tx,
      });
      return m ? toSchedule(m) : null;
    },
    async findById(organizationId, scheduleId) {
      const m = await EstablishmentScheduleModel.findOne({
        where: { id: scheduleId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toSchedule(m) : null;
    },
    async save(schedule) {
      const p = schedule.toPersistence();
      const values = {
        id: p.id,
        organization_id: p.organizationId,
        establishment_id: p.establishmentId,
        timezone: p.timezone,
        slot_minutes: p.slotMinutes,
        cleanup_minutes: p.cleanupMinutes,
        duration_by_party_size: p.durationByPartySize,
        updated_at: new Date(),
      };
      if (await EstablishmentScheduleModel.findByPk(p.id, { attributes: ['id'], transaction: tx })) {
        await EstablishmentScheduleModel.update(values, { where: { id: p.id }, transaction: tx });
      } else {
        await EstablishmentScheduleModel.create({ ...values, created_at: p.createdAt }, { transaction: tx });
      }
    },
    async listShifts(organizationId, scheduleId) {
      const rows = await ScheduleShiftModel.findAll({
        where: { organization_id: organizationId, schedule_id: scheduleId },
        transaction: tx,
        order: [['weekday', 'ASC'], ['opens_at', 'ASC']],
      });
      return rows.map(toShift);
    },
    async replaceShifts(organizationId, scheduleId, shifts) {
      await ScheduleShiftModel.destroy({
        where: { organization_id: organizationId, schedule_id: scheduleId },
        transaction: tx,
      });
      if (shifts.length === 0) return;
      await ScheduleShiftModel.bulkCreate(
        shifts.map((shift) => {
          const p = shift.toPersistence();
          return {
            id: p.id,
            organization_id: p.organizationId,
            schedule_id: p.scheduleId,
            weekday: p.weekday,
            opens_at: p.opensAt,
            closes_at: p.closesAt,
            label: p.label,
            created_at: p.createdAt,
          };
        }),
        { transaction: tx },
      );
    },
    async listExceptions(organizationId, scheduleId) {
      const rows = await ScheduleExceptionModel.findAll({
        where: { organization_id: organizationId, schedule_id: scheduleId },
        transaction: tx,
        order: [['on_date', 'ASC']],
      });
      return rows.map(toException);
    },
    async findExceptionById(organizationId, exceptionId) {
      const m = await ScheduleExceptionModel.findOne({
        where: { id: exceptionId, organization_id: organizationId },
        transaction: tx,
      });
      return m ? toException(m) : null;
    },
    async findExceptionByDate(organizationId, scheduleId, onDate) {
      const m = await ScheduleExceptionModel.findOne({
        where: { organization_id: organizationId, schedule_id: scheduleId, on_date: onDate },
        transaction: tx,
      });
      return m ? toException(m) : null;
    },
    async saveException(exception) {
      const p = exception.toPersistence();
      const values = {
        id: p.id,
        organization_id: p.organizationId,
        schedule_id: p.scheduleId,
        on_date: p.onDate,
        kind: p.kind,
        opens_at: p.opensAt,
        closes_at: p.closesAt,
        reason: p.reason,
      };
      if (await ScheduleExceptionModel.findByPk(p.id, { attributes: ['id'], transaction: tx })) {
        await ScheduleExceptionModel.update(values, { where: { id: p.id }, transaction: tx });
      } else {
        await ScheduleExceptionModel.create({ ...values, created_at: p.createdAt }, { transaction: tx });
      }
    },
    async deleteException(organizationId, exceptionId) {
      await ScheduleExceptionModel.destroy({
        where: { id: exceptionId, organization_id: organizationId },
        transaction: tx,
      });
    },
  };
}

function outboxRepository(tx?: Transaction): OutboxRepository {
  return {
    async add(event: DomainEvent) {
      await OutboxModel.create(
        {
          id: event.eventId,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          type: event.type,
          // El actor/IP/request-id viajan en el contexto de la petición para que
          // la bitácora sepa QUIÉN hizo cada cosa (mismo patrón que inventory).
          payload: withActor(event.payload),
          occurred_at: event.occurredAt,
          processed_at: null,
        },
        { transaction: tx },
      );
    },
  };
}

// ── Ensamblaje ──────────────────────────────────────────────────────────────

export function buildRepositories(tx?: Transaction): UnitOfWork {
  return {
    floors: floorRepository(tx),
    zones: zoneRepository(tx),
    tables: diningTableRepository(tx),
    schedules: scheduleRepository(tx),
    outbox: outboxRepository(tx),
  };
}

/** UnitOfWork de lectura directa, sin transacción (listados, consultas). */
export const readOnlyRepositories: UnitOfWork = buildRepositories(undefined);

export class SequelizeUnitOfWork implements WriteUnitOfWork {
  readonly floors: FloorRepository;
  readonly zones: ZoneRepository;
  readonly tables: DiningTableRepository;
  readonly schedules: ScheduleRepository;
  readonly outbox: OutboxRepository;

  constructor(readonly tx: Transaction) {
    const repos = buildRepositories(tx);
    this.floors = repos.floors;
    this.zones = repos.zones;
    this.tables = repos.tables;
    this.schedules = repos.schedules;
    this.outbox = repos.outbox;
  }

  async commit(): Promise<void> {
    await this.tx.commit();
  }

  async rollback(): Promise<void> {
    await this.tx.rollback();
  }
}

export class SequelizeUnitOfWorkFactory {
  constructor(private readonly onCommit?: (tx: Transaction) => void) {}

  async begin(): Promise<SequelizeUnitOfWork> {
    const tx = await sequelize.transaction();
    // El relay publica el outbox justo tras el commit; sin este enganche los
    // eventos esperan los 30s del timer de respaldo del relay.
    this.onCommit?.(tx);
    return new SequelizeUnitOfWork(tx);
  }
}
