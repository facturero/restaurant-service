import { DiningTable, type EntityStatus, type TableShape } from '../../domain/entities.js';
import { FloorNotFoundError, TableNameExistsError, TableNotFoundError, ZoneNotFoundError } from '../../domain/errors.js';
import type { DiningTableRepository, TableListFilters } from '../../domain/repositories.js';
import { tableUpsertedEvent } from '../events.js';
import type { UnitOfWorkGateway, WriteUnitOfWork } from '../ports.js';

export class ListTablesUseCase {
  constructor(private readonly repos: { tables: Pick<DiningTableRepository, 'listByEstablishment'> }) {}

  async execute(organizationId: string, establishmentId: string, filters?: TableListFilters): Promise<DiningTable[]> {
    return this.repos.tables.listByEstablishment(organizationId, establishmentId, filters);
  }
}

/** Una zona solo vale si es de la misma planta: si no, una mesa podría quedar
 *  apuntando a una zona de otro salón. */
async function assertZoneInFloor(
  uow: WriteUnitOfWork,
  organizationId: string,
  floorId: string,
  zoneId: string,
): Promise<void> {
  const zone = await uow.zones.findById(organizationId, zoneId);
  if (!zone || zone.floorId !== floorId) throw new ZoneNotFoundError();
}

export class CreateTableUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    floorId: string;
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
  }): Promise<DiningTable> {
    const uow = await this.uow.begin();
    try {
      const floor = await uow.floors.findById(input.organizationId, input.floorId);
      if (!floor) throw new FloorNotFoundError();

      if (input.zoneId) await assertZoneInFloor(uow, input.organizationId, input.floorId, input.zoneId);
      if (await uow.tables.existsByName(input.organizationId, input.floorId, input.name)) {
        throw new TableNameExistsError();
      }

      const table = DiningTable.create({
        organizationId: input.organizationId,
        floorId: input.floorId,
        name: input.name,
        capacityMin: input.capacityMin,
        capacityMax: input.capacityMax,
        zoneId: input.zoneId ?? null,
        xCm: input.xCm ?? null,
        yCm: input.yCm ?? null,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        shape: input.shape,
        rotationDeg: input.rotationDeg,
      });
      await uow.tables.save(table);
      await uow.outbox.add(tableUpsertedEvent(table, floor.establishmentId));

      await uow.commit();
      return table;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

export class UpdateTableUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    tableId: string;
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
  }): Promise<DiningTable> {
    const uow = await this.uow.begin();
    try {
      const table = await uow.tables.findById(input.organizationId, input.tableId);
      if (!table) throw new TableNotFoundError();

      const floor = await uow.floors.findById(input.organizationId, table.floorId);
      if (!floor) throw new FloorNotFoundError();

      if (input.zoneId) await assertZoneInFloor(uow, input.organizationId, table.floorId, input.zoneId);
      if (input.name !== undefined && input.name.trim() !== table.name) {
        if (await uow.tables.existsByName(input.organizationId, table.floorId, input.name, table.id)) {
          throw new TableNameExistsError();
        }
      }

      table.update({
        name: input.name,
        capacityMin: input.capacityMin,
        capacityMax: input.capacityMax,
        zoneId: input.zoneId,
        xCm: input.xCm,
        yCm: input.yCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        shape: input.shape,
        rotationDeg: input.rotationDeg,
        status: input.status,
      });
      await uow.tables.save(table);
      await uow.outbox.add(tableUpsertedEvent(table, floor.establishmentId));

      await uow.commit();
      return table;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
