import { EstablishmentSchedule, Floor } from '../../domain/entities.js';
import { EstablishmentNotFoundError } from '../../domain/errors.js';
import { floorCreatedEvent, scheduleUpdatedEvent } from '../events.js';
import type { EstablishmentChecker, UnitOfWorkGateway } from '../ports.js';

/**
 * "Inicializar" un establecimiento. Es idempotente: se llama cada vez que el
 * dueño abre las pantallas del plugin y no debe duplicar nada. Deja una planta
 * («Salón principal») y un horario por defecto listos para editarse.
 */
export class SetupEstablishmentUseCase {
  constructor(
    private readonly uow: UnitOfWorkGateway,
    private readonly establishmentChecker: EstablishmentChecker,
  ) {}

  async execute(input: { organizationId: string; establishmentId: string }): Promise<{ floor: Floor; schedule: EstablishmentSchedule }> {
    // Comprobar primero que el establecimiento es de la organización: sin esto,
    // una id adivinada dejaría filas huérfanas.
    const check = await this.establishmentChecker.check(input.organizationId, input.establishmentId);
    if (check === 'missing') throw new EstablishmentNotFoundError();

    const uow = await this.uow.begin();
    try {
      let floor = await uow.floors.findFirstByEstablishment(input.organizationId, input.establishmentId);
      if (!floor) {
        floor = Floor.create({
          organizationId: input.organizationId,
          establishmentId: input.establishmentId,
          name: 'Salón principal',
        });
        await uow.floors.save(floor);
        await uow.outbox.add(floorCreatedEvent(floor));
      }

      let schedule = await uow.schedules.findByEstablishment(input.organizationId, input.establishmentId);
      if (!schedule) {
        // Los valores por defecto del dominio ya son los que pide el documento
        // (America/Guayaquil, turnos de 30 min, limpieza 15, 60/90/120 por tamaño).
        schedule = EstablishmentSchedule.create({
          organizationId: input.organizationId,
          establishmentId: input.establishmentId,
        });
        await uow.schedules.save(schedule);
        await uow.outbox.add(scheduleUpdatedEvent(schedule, 0));
      }

      await uow.commit();
      return { floor, schedule };
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
