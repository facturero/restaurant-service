import { DiningTable } from '../../domain/entities.js';
import { FloorNotFoundError, ValidationError } from '../../domain/errors.js';
import { tableUpsertedEvent } from '../events.js';
import type { UnitOfWorkGateway } from '../ports.js';

export const MAX_BULK_TABLES = 100;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * «¿Cuántas mesas tienes?». Nombra las nuevas `Mesa 1…N` continuando desde la
 * última ya existente, para que añadir 3 mesas a un local con 5 no repita
 * nombres ni reinicie la numeración.
 */
export class BulkCreateTablesUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    floorId: string;
    count: number;
    capacityMin: number;
    capacityMax: number;
    prefix?: string;
  }): Promise<DiningTable[]> {
    const prefix = (input.prefix ?? 'Mesa').trim() || 'Mesa';
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BULK_TABLES) {
      throw new ValidationError([{ field: 'count', message: `La cantidad de mesas debe estar entre 1 y ${MAX_BULK_TABLES}.` }]);
    }

    const uow = await this.uow.begin();
    try {
      const floor = await uow.floors.findById(input.organizationId, input.floorId);
      if (!floor) throw new FloorNotFoundError();

      const existing = await uow.tables.listByFloor(input.organizationId, input.floorId);
      const numbering = new RegExp(`^${escapeRegExp(prefix)}\\s+(\\d+)$`, 'i');
      let last = 0;
      for (const table of existing) {
        const match = numbering.exec(table.name);
        if (match) last = Math.max(last, Number(match[1]));
      }

      const created: DiningTable[] = [];
      for (let i = 1; i <= input.count; i += 1) {
        created.push(
          DiningTable.create({
            organizationId: input.organizationId,
            floorId: input.floorId,
            name: `${prefix} ${last + i}`,
            capacityMin: input.capacityMin,
            capacityMax: input.capacityMax,
          }),
        );
      }

      await uow.tables.saveMany(created);
      for (const table of created) await uow.outbox.add(tableUpsertedEvent(table, floor.establishmentId));

      await uow.commit();
      return created;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
