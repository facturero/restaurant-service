import { describe, expect, it } from 'vitest';
import { SetupEstablishmentUseCase } from '../application/use-cases/setup-establishment.js';
import { EstablishmentNotFoundError } from '../domain/errors.js';
import { InMemoryUnitOfWork, UUID, fixedEstablishmentChecker, inMemoryGateway } from './helpers.js';

function montar(check: 'exists' | 'missing' | 'unchecked' = 'exists') {
  const uow = new InMemoryUnitOfWork();
  const useCase = new SetupEstablishmentUseCase(inMemoryGateway(uow), fixedEstablishmentChecker(check));
  return { uow, useCase };
}

describe('setup del establecimiento', () => {
  it('la primera llamada deja una planta «Salón principal» y un horario por defecto', async () => {
    const { uow, useCase } = montar();
    const { floor, schedule } = await useCase.execute({ organizationId: UUID.ORG, establishmentId: UUID.ESTABLISHMENT });

    expect(floor.name).toBe('Salón principal');
    expect(schedule.timezone).toBe('America/Guayaquil');
    expect(await uow.floors.listByEstablishment(UUID.ORG, UUID.ESTABLISHMENT)).toHaveLength(1);
    expect(await uow.schedules.findByEstablishment(UUID.ORG, UUID.ESTABLISHMENT)).not.toBeNull();
  });

  it('es idempotente: dos llamadas siguen dejando una planta y un horario', async () => {
    const { uow, useCase } = montar();
    const first = await useCase.execute({ organizationId: UUID.ORG, establishmentId: UUID.ESTABLISHMENT });
    const second = await useCase.execute({ organizationId: UUID.ORG, establishmentId: UUID.ESTABLISHMENT });

    expect(second.floor.id).toBe(first.floor.id);
    expect(second.schedule.id).toBe(first.schedule.id);
    expect(await uow.floors.listByEstablishment(UUID.ORG, UUID.ESTABLISHMENT)).toHaveLength(1);
    // La segunda llamada no publica nada: no hubo nada que crear.
    expect(uow.outboxEvents).toHaveLength(2);
    expect(uow.outboxEvents.map((e) => e.type).sort()).toEqual(['restaurant.floor.created', 'restaurant.schedule.updated']);
  });

  it('un establecimiento inexistente responde 404 y no escribe nada', async () => {
    const { uow, useCase } = montar('missing');
    await expect(useCase.execute({ organizationId: UUID.ORG, establishmentId: UUID.ESTABLISHMENT })).rejects.toBeInstanceOf(
      EstablishmentNotFoundError,
    );
    expect(await uow.floors.listByEstablishment(UUID.ORG, UUID.ESTABLISHMENT)).toHaveLength(0);
    expect(uow.outboxEvents).toHaveLength(0);
  });

  it('sin servicio de organizaciones (`unchecked`) el setup sigue adelante', async () => {
    const { uow, useCase } = montar('unchecked');
    const { floor } = await useCase.execute({ organizationId: UUID.ORG, establishmentId: UUID.ESTABLISHMENT });
    expect(floor.id).toBeTruthy();
    expect(await uow.floors.listByEstablishment(UUID.ORG, UUID.ESTABLISHMENT)).toHaveLength(1);
  });
});
