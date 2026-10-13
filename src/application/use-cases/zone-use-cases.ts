import { Zone, type EntityStatus, type ZoneColor } from '../../domain/entities.js';
import { FloorNotFoundError, ZoneNameExistsError, ZoneNotFoundError } from '../../domain/errors.js';
import type { ZoneRepository } from '../../domain/repositories.js';
import { zoneUpsertedEvent } from '../events.js';
import type { UnitOfWorkGateway } from '../ports.js';

export class ListZonesUseCase {
  constructor(private readonly repos: { zones: Pick<ZoneRepository, 'listByFloor'> }) {}

  async execute(organizationId: string, floorId: string): Promise<Zone[]> {
    return this.repos.zones.listByFloor(organizationId, floorId);
  }
}

export class CreateZoneUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    floorId: string;
    name: string;
    color?: ZoneColor;
  }): Promise<Zone> {
    const uow = await this.uow.begin();
    try {
      const floor = await uow.floors.findById(input.organizationId, input.floorId);
      if (!floor) throw new FloorNotFoundError();

      if (await uow.zones.existsByName(input.organizationId, input.floorId, input.name)) {
        throw new ZoneNameExistsError();
      }

      const zone = Zone.create({
        organizationId: input.organizationId,
        floorId: input.floorId,
        name: input.name,
        color: input.color,
      });
      await uow.zones.save(zone);
      await uow.outbox.add(zoneUpsertedEvent(zone));

      await uow.commit();
      return zone;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

export class UpdateZoneUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    zoneId: string;
    name?: string;
    color?: ZoneColor;
    status?: EntityStatus;
  }): Promise<Zone> {
    const uow = await this.uow.begin();
    try {
      const zone = await uow.zones.findById(input.organizationId, input.zoneId);
      if (!zone) throw new ZoneNotFoundError();

      if (input.name !== undefined && input.name.trim() !== zone.name) {
        if (await uow.zones.existsByName(input.organizationId, zone.floorId, input.name, zone.id)) {
          throw new ZoneNameExistsError();
        }
      }

      zone.update({ name: input.name, color: input.color, status: input.status });
      await uow.zones.save(zone);
      await uow.outbox.add(zoneUpsertedEvent(zone));

      await uow.commit();
      return zone;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
