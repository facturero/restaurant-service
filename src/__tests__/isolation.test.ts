import { describe, expect, it } from 'vitest';
import { GetFloorPlanUseCase, ListFloorsUseCase } from '../application/use-cases/floor-queries.js';
import { UpdateFloorUseCase } from '../application/use-cases/update-floor.js';
import { CreateTableUseCase, UpdateTableUseCase } from '../application/use-cases/table-use-cases.js';
import { CreateZoneUseCase, UpdateZoneUseCase } from '../application/use-cases/zone-use-cases.js';
import { GetScheduleUseCase, RemoveScheduleExceptionUseCase } from '../application/use-cases/schedule-use-cases.js';
import { SaveFloorPlanUseCase } from '../application/use-cases/save-floor-plan.js';
import { ScheduleException } from '../domain/entities.js';
import { InMemoryUnitOfWork, UUID, inMemoryGateway, seedFloor, seedSchedule, seedTable } from './helpers.js';

/** Todo lo de la organización A; la B (OTHER_ORG) no debe verlo ni tocarlo. */
function montar() {
  const uow = new InMemoryUnitOfWork();
  seedFloor(uow);
  seedTable(uow, { id: UUID.TABLE, name: 'Mesa 1' });
  seedSchedule(uow);
  const exception = ScheduleException.create({
    organizationId: UUID.ORG,
    scheduleId: UUID.SCHEDULE,
    onDate: '2026-12-25',
    kind: 'closed',
  });
  void uow.schedules.saveException(exception);
  const gateway = inMemoryGateway(uow);
  return {
    uow,
    exception,
    listFloors: new ListFloorsUseCase(uow),
    getFloorPlan: new GetFloorPlanUseCase(uow),
    updateFloor: new UpdateFloorUseCase(gateway),
    createTable: new CreateTableUseCase(gateway),
    updateTable: new UpdateTableUseCase(gateway),
    createZone: new CreateZoneUseCase(gateway),
    updateZone: new UpdateZoneUseCase(gateway),
    getSchedule: new GetScheduleUseCase(uow),
    removeException: new RemoveScheduleExceptionUseCase(gateway),
    saveFloorPlan: new SaveFloorPlanUseCase(gateway),
  };
}

describe('aislamiento entre organizaciones', () => {
  it('la organización B no lista las plantas de la A', async () => {
    const { listFloors } = montar();
    expect(await listFloors.execute(UUID.OTHER_ORG, UUID.ESTABLISHMENT)).toEqual([]);
  });

  it('la organización B no abre el plano de la A ni adivinando el id', async () => {
    const { getFloorPlan } = montar();
    await expect(getFloorPlan.execute(UUID.OTHER_ORG, UUID.FLOOR)).rejects.toMatchObject({ code: 'FLOOR_NOT_FOUND' });
  });

  it('la organización B no modifica la planta de la A', async () => {
    const { updateFloor } = montar();
    await expect(updateFloor.execute({ organizationId: UUID.OTHER_ORG, floorId: UUID.FLOOR, name: 'Robada' })).rejects.toMatchObject({
      code: 'FLOOR_NOT_FOUND',
    });
  });

  it('la organización B no crea mesas en la planta de la A', async () => {
    const { createTable } = montar();
    await expect(
      createTable.execute({ organizationId: UUID.OTHER_ORG, floorId: UUID.FLOOR, name: 'Mesa B', capacityMin: 2, capacityMax: 4 }),
    ).rejects.toMatchObject({ code: 'FLOOR_NOT_FOUND' });
  });

  it('la organización B no modifica mesas ni zonas de la A', async () => {
    const { updateTable, updateZone } = montar();
    await expect(updateTable.execute({ organizationId: UUID.OTHER_ORG, tableId: UUID.TABLE, name: 'x' })).rejects.toMatchObject({
      code: 'TABLE_NOT_FOUND',
    });
    await expect(updateZone.execute({ organizationId: UUID.OTHER_ORG, zoneId: UUID.ZONE, name: 'x' })).rejects.toMatchObject({
      code: 'ZONE_NOT_FOUND',
    });
  });

  it('la organización B no crea zonas en la planta de la A', async () => {
    const { createZone } = montar();
    await expect(createZone.execute({ organizationId: UUID.OTHER_ORG, floorId: UUID.FLOOR, name: 'Zona B' })).rejects.toMatchObject({
      code: 'FLOOR_NOT_FOUND',
    });
  });

  it('la organización B no ve el horario de la A', async () => {
    const { getSchedule } = montar();
    await expect(getSchedule.execute(UUID.OTHER_ORG, UUID.ESTABLISHMENT)).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
  });

  it('la organización B no borra excepciones de la A', async () => {
    const { uow, exception, removeException } = montar();
    await expect(removeException.execute({ organizationId: UUID.OTHER_ORG, exceptionId: exception.id })).rejects.toMatchObject({
      code: 'SCHEDULE_EXCEPTION_NOT_FOUND',
    });
    expect(await uow.schedules.findExceptionById(UUID.ORG, exception.id)).not.toBeNull();
  });

  it('la organización B no guarda el plano de la A', async () => {
    const { saveFloorPlan } = montar();
    await expect(
      saveFloorPlan.execute({
        organizationId: UUID.OTHER_ORG,
        floorId: UUID.FLOOR,
        expectedVersion: 0,
        floor: {},
        zones: [],
        tables: [],
        elements: [],
      }),
    ).rejects.toMatchObject({ code: 'FLOOR_NOT_FOUND' });
  });
});
