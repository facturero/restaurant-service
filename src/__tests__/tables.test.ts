import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BulkCreateTablesUseCase, MAX_BULK_TABLES } from '../application/use-cases/bulk-create-tables.js';
import { CreateTableUseCase, ListTablesUseCase, UpdateTableUseCase } from '../application/use-cases/table-use-cases.js';
import { FloorNotFoundError, TableNameExistsError, TableNotFoundError, ValidationError, ZoneNotFoundError } from '../domain/errors.js';
import { InMemoryUnitOfWork, UUID, inMemoryGateway, seedFloor, seedTable } from './helpers.js';

function montar() {
  const uow = new InMemoryUnitOfWork();
  seedFloor(uow);
  const gateway = inMemoryGateway(uow);
  return {
    uow,
    create: new CreateTableUseCase(gateway),
    update: new UpdateTableUseCase(gateway),
    bulk: new BulkCreateTablesUseCase(gateway),
    list: new ListTablesUseCase(uow),
  };
}

const base = { organizationId: UUID.ORG, floorId: UUID.FLOOR, name: 'Mesa 1', capacityMin: 2, capacityMax: 4 };

describe('mesas · creación', () => {
  it('una capacidad máxima menor que la mínima es un error de validación', async () => {
    const { create } = montar();
    await expect(create.execute({ ...base, capacityMin: 4, capacityMax: 2 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('un nombre repetido en la planta responde 409', async () => {
    const { create } = montar();
    await create.execute(base);
    await expect(create.execute(base)).rejects.toBeInstanceOf(TableNameExistsError);
  });

  it('una zona que no es de la planta responde 404', async () => {
    const { create } = montar();
    await expect(create.execute({ ...base, zoneId: UUID.ZONE })).rejects.toBeInstanceOf(ZoneNotFoundError);
  });

  it('una planta inexistente responde 404', async () => {
    const { create } = montar();
    await expect(create.execute({ ...base, floorId: UUID.FLOOR2 })).rejects.toBeInstanceOf(FloorNotFoundError);
  });
});

describe('mesas · desactivar libera el nombre', () => {
  it('tras desactivar, puede volver a usarse el mismo nombre y la mesa vieja sigue existiendo con su id', async () => {
    const { uow, create, update } = montar();
    const original = await create.execute(base);
    await update.execute({ organizationId: UUID.ORG, tableId: original.id, status: 'inactive' });

    const reutilizada = await create.execute(base);
    expect(reutilizada.id).not.toBe(original.id);

    const vieja = await uow.tables.findById(UUID.ORG, original.id);
    expect(vieja?.status).toBe('inactive');
    expect(vieja?.name).toBe('Mesa 1');
  });

  it('renombrar a un nombre de una mesa inactiva sí se permite', async () => {
    const { create, update } = montar();
    const vieja = await create.execute({ ...base, name: 'Mesa vieja' });
    await update.execute({ organizationId: UUID.ORG, tableId: vieja.id, status: 'inactive' });
    const nueva = await create.execute({ ...base, name: 'Mesa nueva' });
    await expect(update.execute({ organizationId: UUID.ORG, tableId: nueva.id, name: 'Mesa vieja' })).resolves.toMatchObject({
      name: 'Mesa vieja',
    });
  });

  it('actualizar una mesa inexistente responde 404', async () => {
    const { update } = montar();
    await expect(update.execute({ organizationId: UUID.ORG, tableId: UUID.TABLE2, name: 'x' })).rejects.toBeInstanceOf(TableNotFoundError);
  });
});

describe('mesas · creación masiva', () => {
  it('continúa la numeración desde la última mesa existente', async () => {
    const { create, bulk } = montar();
    await create.execute({ ...base, name: 'Mesa 1' });
    await create.execute({ ...base, name: 'Mesa 5' });

    const creadas = await bulk.execute({ organizationId: UUID.ORG, floorId: UUID.FLOOR, count: 3, capacityMin: 2, capacityMax: 4 });
    expect(creadas.map((t) => t.name)).toEqual(['Mesa 6', 'Mesa 7', 'Mesa 8']);
  });

  it('usa el prefijo indicado', async () => {
    const { bulk } = montar();
    const creadas = await bulk.execute({
      organizationId: UUID.ORG,
      floorId: UUID.FLOOR,
      count: 2,
      capacityMin: 1,
      capacityMax: 2,
      prefix: 'Terraza',
    });
    expect(creadas.map((t) => t.name)).toEqual(['Terraza 1', 'Terraza 2']);
  });

  it('rechaza cantidades fuera de rango', async () => {
    const { bulk } = montar();
    await expect(
      bulk.execute({ organizationId: UUID.ORG, floorId: UUID.FLOOR, count: 0, capacityMin: 1, capacityMax: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      bulk.execute({ organizationId: UUID.ORG, floorId: UUID.FLOOR, count: MAX_BULK_TABLES + 1, capacityMin: 1, capacityMax: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('una planta inexistente responde 404 y no crea nada', async () => {
    const { uow, bulk } = montar();
    await expect(
      bulk.execute({ organizationId: UUID.ORG, floorId: UUID.FLOOR2, count: 3, capacityMin: 1, capacityMax: 2 }),
    ).rejects.toBeInstanceOf(FloorNotFoundError);
    expect(await uow.tables.listByFloor(UUID.ORG, UUID.FLOOR)).toHaveLength(0);
  });
});

describe('mesas · nunca se borran', () => {
  it('la API de mesas no expone ninguna ruta DELETE', () => {
    const routes = readFileSync(join(process.cwd(), 'src', 'interface', 'http', 'routes.ts'), 'utf8');
    const deleteRoutes = routes.match(/r\.delete\([^)]*\)/g) ?? [];
    expect(deleteRoutes.every((line) => !line.includes('/tables'))).toBe(true);
  });

  it('una mesa desactivada se conserva para las reservas del entregable 2', async () => {
    const { uow } = montar();
    const table = seedTable(uow, { id: UUID.TABLE, name: 'Mesa 9' });
    table.deactivate();
    await uow.tables.save(table);
    expect(await uow.tables.findById(UUID.ORG, UUID.TABLE)).not.toBeNull();
  });
});
