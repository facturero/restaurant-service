import type { DiningTable, Floor, Zone } from '../../domain/entities.js';
import { FloorNotFoundError } from '../../domain/errors.js';
import type { DiningTableRepository, FloorRepository, ZoneRepository } from '../../domain/repositories.js';

export class ListFloorsUseCase {
  constructor(private readonly repos: { floors: Pick<FloorRepository, 'listByEstablishment'> }) {}

  async execute(organizationId: string, establishmentId: string): Promise<Floor[]> {
    return this.repos.floors.listByEstablishment(organizationId, establishmentId);
  }
}

export interface FloorPlan {
  floor: Floor;
  zones: Zone[];
  tables: DiningTable[];
  layout: { version: number; elements: unknown[] };
}

/** Todo lo que el editor necesita para pintar el local en una sola petición. */
export class GetFloorPlanUseCase {
  constructor(
    private readonly repos: {
      floors: Pick<FloorRepository, 'findById'>;
      zones: Pick<ZoneRepository, 'listByFloor'>;
      tables: Pick<DiningTableRepository, 'listByFloor'>;
    },
  ) {}

  async execute(organizationId: string, floorId: string): Promise<FloorPlan> {
    const floor = await this.repos.floors.findById(organizationId, floorId);
    if (!floor) throw new FloorNotFoundError();

    const [zones, tables] = await Promise.all([
      this.repos.zones.listByFloor(organizationId, floorId),
      this.repos.tables.listByFloor(organizationId, floorId),
    ]);

    return {
      floor,
      zones,
      tables,
      layout: { version: floor.layoutVersion, elements: floor.layoutElements ?? [] },
    };
  }
}
