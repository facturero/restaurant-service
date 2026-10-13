import type { EntityStatus, Floor } from '../../domain/entities.js';
import { FloorNameExistsError, FloorNotFoundError } from '../../domain/errors.js';
import { floorUpdatedEvent } from '../events.js';
import type { UnitOfWorkGateway } from '../ports.js';

export class UpdateFloorUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    floorId: string;
    name?: string;
    widthCm?: number | null;
    heightCm?: number | null;
    sortOrder?: number;
    status?: EntityStatus;
  }): Promise<Floor> {
    const uow = await this.uow.begin();
    try {
      const floor = await uow.floors.findById(input.organizationId, input.floorId);
      if (!floor) throw new FloorNotFoundError();

      if (input.name !== undefined && input.name.trim() !== floor.name) {
        if (await uow.floors.existsByName(input.organizationId, floor.establishmentId, input.name, floor.id)) {
          throw new FloorNameExistsError();
        }
      }

      const before = { name: floor.name, status: floor.status };
      floor.update({
        name: input.name,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        sortOrder: input.sortOrder,
        status: input.status,
      });
      await uow.floors.save(floor);
      await uow.outbox.add(floorUpdatedEvent(floor, before));

      await uow.commit();
      return floor;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
