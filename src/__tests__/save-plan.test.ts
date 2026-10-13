import { describe, expect, it } from 'vitest';
import { SaveFloorPlanUseCase, type SaveFloorPlanInput } from '../application/use-cases/save-floor-plan.js';
import { Zone } from '../domain/entities.js';
import { InvalidPlanError, PlanVersionConflictError, ZoneNameExistsError } from '../domain/errors.js';
import { InMemoryUnitOfWork, UUID, inMemoryGateway, seedFloor, seedTable } from './helpers.js';

const ZONE2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbcb';

function montar() {
  const uow = new InMemoryUnitOfWork();
  const floor = seedFloor(uow);
  const useCase = new SaveFloorPlanUseCase(inMemoryGateway(uow));
  return { uow, floor, useCase };
}

function plan(overrides: Partial<SaveFloorPlanInput> = {}): SaveFloorPlanInput {
  return {
    organizationId: UUID.ORG,
    floorId: UUID.FLOOR,
    expectedVersion: 0,
    floor: { widthCm: 1000, heightCm: 800 },
    zones: [],
    tables: [],
    elements: [],
    ...overrides,
  };
}

const mesa = (overrides: Record<string, unknown> = {}) => ({
  id: UUID.TABLE,
  name: 'Mesa 1',
  capacityMin: 2,
  capacityMax: 4,
  xCm: 10,
  yCm: 20,
  widthCm: 80,
  heightCm: 80,
  rotationDeg: 0,
  ...overrides,
});

describe('guardar el plano', () => {
  it('crea zonas y mesas y sube la versión de uno en uno', async () => {
    const { uow, floor, useCase } = montar();
    await useCase.execute(
      plan({
        zones: [{ id: UUID.ZONE, name: 'Ventana', color: 'info' }],
        tables: [mesa({ zoneId: UUID.ZONE })],
        elements: [{ id: 'w1', type: 'wall', x1: 0, y1: 0, x2: 400, y2: 0 }],
      }),
    );

    expect(floor.layoutVersion).toBe(1);
    expect(floor.widthCm).toBe(1000);
    expect(await uow.zones.listByFloor(UUID.ORG, UUID.FLOOR)).toHaveLength(1);
    const table = await uow.tables.findById(UUID.ORG, UUID.TABLE);
    expect(table).toMatchObject({ name: 'Mesa 1', zoneId: UUID.ZONE, status: 'active' });
    expect(uow.outboxEvents.map((e) => e.type).sort()).toEqual(['restaurant.floor_plan.saved', 'restaurant.table.upserted', 'restaurant.zone.upserted']);
    expect(uow.outboxEvents.find((e) => e.type === 'restaurant.floor_plan.saved')?.payload).toMatchObject({
      version: 1,
      tableCount: 1,
      wallCount: 1,
      elementCount: 1,
    });
  });

  it('volver a guardar lo mismo es idempotente: ni duplica ni vuelve a publicar la mesa', async () => {
    const { uow, useCase } = montar();
    const first = plan({ zones: [{ id: UUID.ZONE, name: 'Ventana' }], tables: [mesa({ zoneId: UUID.ZONE })] });
    await useCase.execute(first);
    const eventsAfterFirst = uow.outboxEvents.length;

    await useCase.execute({ ...first, expectedVersion: 1 });

    expect(await uow.zones.listByFloor(UUID.ORG, UUID.FLOOR)).toHaveLength(1);
    expect(await uow.tables.listByFloor(UUID.ORG, UUID.FLOOR)).toHaveLength(1);
    // Solo se publica el guardado del plano: la mesa no cambió.
    expect(uow.outboxEvents.slice(eventsAfterFirst).map((e) => e.type)).toEqual(['restaurant.floor_plan.saved']);
  });

  it('las zonas dejan rastro en la bitácora: se publica al crear, al renombrar y al quitarlas, y solo entonces', async () => {
    const { uow, useCase } = montar();
    const zoneEvents = (from: number) => uow.outboxEvents.slice(from).filter((e) => e.type === 'restaurant.zone.upserted');

    await useCase.execute(plan({ zones: [{ id: UUID.ZONE, name: 'Ventana' }], tables: [mesa({ zoneId: UUID.ZONE })] }));
    expect(zoneEvents(0)).toHaveLength(1);

    let mark = uow.outboxEvents.length;
    await useCase.execute(plan({ expectedVersion: 1, zones: [{ id: UUID.ZONE, name: 'Ventana' }], tables: [mesa({ zoneId: UUID.ZONE })] }));
    expect(zoneEvents(mark)).toHaveLength(0);

    mark = uow.outboxEvents.length;
    await useCase.execute(plan({ expectedVersion: 2, zones: [{ id: UUID.ZONE, name: 'Terraza' }], tables: [mesa({ zoneId: UUID.ZONE })] }));
    expect(zoneEvents(mark)).toHaveLength(1);

    mark = uow.outboxEvents.length;
    await useCase.execute(plan({ expectedVersion: 3, zones: [], tables: [mesa()] }));
    expect(zoneEvents(mark)).toHaveLength(1);
    expect(zoneEvents(mark)[0].payload).toMatchObject({ status: 'inactive' });
  });

  it('una mesa que ya no viene queda inactiva y conserva su id', async () => {
    const { uow, useCase } = montar();
    await useCase.execute(plan({ tables: [mesa()] }));
    await useCase.execute(plan({ expectedVersion: 1, tables: [] }));

    const table = await uow.tables.findById(UUID.ORG, UUID.TABLE);
    expect(table?.status).toBe('inactive');
    expect(table?.id).toBe(UUID.TABLE);
  });

  it('una mesa que apunta a una zona que ya no está en el plano se queda sin zona', async () => {
    const { uow, useCase } = montar();
    await useCase.execute(plan({ zones: [{ id: UUID.ZONE, name: 'Ventana' }], tables: [mesa({ zoneId: UUID.ZONE })] }));
    await useCase.execute(plan({ expectedVersion: 1, zones: [], tables: [mesa({ zoneId: UUID.ZONE })] }));
    expect((await uow.tables.findById(UUID.ORG, UUID.TABLE))?.zoneId).toBeNull();
  });

  it('una `expectedVersion` vieja responde 409 con la versión actual', async () => {
    const { useCase } = montar();
    await useCase.execute(plan());
    await expect(useCase.execute(plan({ expectedVersion: 0 }))).rejects.toMatchObject({
      code: 'PLAN_VERSION_CONFLICT',
      currentVersion: 1,
    });
    await expect(useCase.execute(plan({ expectedVersion: 0 }))).rejects.toBeInstanceOf(PlanVersionConflictError);
  });

  it('un elemento inválido no deja nada a medias (una sola transacción)', async () => {
    const { uow, useCase } = montar();
    seedTable(uow, { id: UUID.TABLE, name: 'Mesa existente' });

    await expect(
      useCase.execute(
        plan({
          tables: [mesa({ id: UUID.TABLE2, name: 'Mesa nueva' })],
          elements: [
            { id: 'dup', type: 'wall', x1: 0, y1: 0, x2: 100, y2: 0 },
            { id: 'dup', type: 'wall', x1: 0, y1: 100, x2: 100, y2: 100 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidPlanError);

    expect(await uow.tables.findById(UUID.ORG, UUID.TABLE2)).toBeNull();
    expect((await uow.tables.findById(UUID.ORG, UUID.TABLE))?.status).toBe('active');
    expect(uow.outboxEvents).toHaveLength(0);
  });

  it('el rollback deshace también las escrituras hechas antes del fallo', async () => {
    const { uow, floor, useCase } = montar();
    // Una mesa activa que el guardado desactivará primero…
    seedTable(uow, { id: UUID.TABLE, name: 'Mesa existente' });
    // …y una zona cuyo nombre chocará con la que trae el plano (id distinto ⇒ 409).
    await uow.zones.save(Zone.create({ organizationId: UUID.ORG, floorId: UUID.FLOOR, name: 'Ventana' }));

    await expect(
      useCase.execute(
        plan({
          zones: [{ id: ZONE2, name: 'Ventana' }],
          tables: [mesa({ id: UUID.TABLE2, name: 'Mesa nueva' })],
        }),
      ),
    ).rejects.toBeInstanceOf(ZoneNameExistsError);

    // Nada quedó a medias: la mesa volvió a estar activa, la nueva no existe y la versión no subió.
    expect((await uow.tables.findById(UUID.ORG, UUID.TABLE))?.status).toBe('active');
    expect(await uow.tables.findById(UUID.ORG, UUID.TABLE2)).toBeNull();
    expect(await uow.zones.listByFloor(UUID.ORG, UUID.FLOOR)).toHaveLength(1);
    expect(floor.layoutVersion).toBe(0);
    expect(uow.outboxEvents).toHaveLength(0);
  });

  it('rechaza dos mesas con el mismo nombre dentro del plano (ignorando mayúsculas)', async () => {
    const { useCase } = montar();
    await expect(
      useCase.execute(
        plan({
          tables: [mesa({ id: UUID.TABLE, name: 'Mesa 1' }), mesa({ id: UUID.TABLE2, name: 'mesa 1' })],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('una planta de otra organización responde 404', async () => {
    const { useCase } = montar();
    await expect(useCase.execute(plan({ organizationId: UUID.OTHER_ORG }))).rejects.toMatchObject({ code: 'FLOOR_NOT_FOUND' });
  });
});
