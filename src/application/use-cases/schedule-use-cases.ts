import {
  EstablishmentSchedule,
  ScheduleException,
  ScheduleShift,
  type ScheduleExceptionKind,
} from '../../domain/entities.js';
import {
  ScheduleExceptionExistsError,
  ScheduleExceptionNotFoundError,
  ScheduleNotFoundError,
} from '../../domain/errors.js';
import type { ScheduleRepository } from '../../domain/repositories.js';
import { validateSchedule, type PartyDuration, type ShiftInput } from '../../domain/schedule.js';
import { scheduleExceptionCreatedEvent, scheduleExceptionDeletedEvent, scheduleUpdatedEvent } from '../events.js';
import type { UnitOfWorkGateway } from '../ports.js';

export interface ScheduleView {
  schedule: EstablishmentSchedule;
  shifts: ScheduleShift[];
  exceptions: ScheduleException[];
}

type ScheduleReadRepos = Pick<ScheduleRepository, 'findByEstablishment' | 'listShifts' | 'listExceptions'>;

export class GetScheduleUseCase {
  constructor(private readonly repos: { schedules: ScheduleReadRepos }) {}

  async execute(organizationId: string, establishmentId: string): Promise<ScheduleView> {
    const schedule = await this.repos.schedules.findByEstablishment(organizationId, establishmentId);
    if (!schedule) throw new ScheduleNotFoundError();

    const [shifts, exceptions] = await Promise.all([
      this.repos.schedules.listShifts(organizationId, schedule.id),
      this.repos.schedules.listExceptions(organizationId, schedule.id),
    ]);
    return { schedule, shifts, exceptions };
  }
}

export interface SaveScheduleResult {
  schedule: EstablishmentSchedule;
  shifts: ScheduleShift[];
}

export class SaveScheduleUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  /** Reemplaza ajustes y turnos de una vez: un horario a medias (turnos nuevos
   *  con ajustes viejos) sería peor que no guardar. */
  async execute(input: {
    organizationId: string;
    establishmentId: string;
    timezone?: string;
    slotMinutes?: number;
    cleanupMinutes?: number;
    durationByPartySize?: PartyDuration[];
    shifts: ShiftInput[];
  }): Promise<SaveScheduleResult> {
    const uow = await this.uow.begin();
    try {
      const schedule = await uow.schedules.findByEstablishment(input.organizationId, input.establishmentId);
      if (!schedule) throw new ScheduleNotFoundError();

      const settings = {
        timezone: input.timezone ?? schedule.timezone,
        slotMinutes: input.slotMinutes ?? schedule.slotMinutes,
        cleanupMinutes: input.cleanupMinutes ?? schedule.cleanupMinutes,
        durationByPartySize: input.durationByPartySize ?? schedule.durationByPartySize,
      };
      // Valida ajustes y turnos juntos: el error trae TODOS los problemas.
      validateSchedule(settings, input.shifts);

      schedule.update(settings);
      await uow.schedules.save(schedule);

      const shifts = input.shifts.map((shift) =>
        ScheduleShift.create({
          organizationId: input.organizationId,
          scheduleId: schedule.id,
          weekday: shift.weekday,
          opensAt: shift.opensAt,
          closesAt: shift.closesAt,
          label: shift.label,
        }),
      );
      await uow.schedules.replaceShifts(input.organizationId, schedule.id, shifts);
      await uow.outbox.add(scheduleUpdatedEvent(schedule, shifts.length));

      await uow.commit();
      return { schedule, shifts };
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

export class AddScheduleExceptionUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: {
    organizationId: string;
    establishmentId: string;
    onDate: string;
    kind: ScheduleExceptionKind;
    opensAt?: string | null;
    closesAt?: string | null;
    reason?: string | null;
  }): Promise<ScheduleException> {
    const uow = await this.uow.begin();
    try {
      const schedule = await uow.schedules.findByEstablishment(input.organizationId, input.establishmentId);
      if (!schedule) throw new ScheduleNotFoundError();

      if (await uow.schedules.findExceptionByDate(input.organizationId, schedule.id, input.onDate)) {
        throw new ScheduleExceptionExistsError();
      }

      const exception = ScheduleException.create({
        organizationId: input.organizationId,
        scheduleId: schedule.id,
        onDate: input.onDate,
        kind: input.kind,
        opensAt: input.opensAt,
        closesAt: input.closesAt,
        reason: input.reason,
      });
      await uow.schedules.saveException(exception);
      await uow.outbox.add(scheduleExceptionCreatedEvent(exception, schedule.establishmentId));

      await uow.commit();
      return exception;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

export class RemoveScheduleExceptionUseCase {
  constructor(private readonly uow: UnitOfWorkGateway) {}

  async execute(input: { organizationId: string; exceptionId: string }): Promise<void> {
    const uow = await this.uow.begin();
    try {
      const exception = await uow.schedules.findExceptionById(input.organizationId, input.exceptionId);
      if (!exception) throw new ScheduleExceptionNotFoundError();

      // La ruta de borrado no trae el establecimiento: hay que resolverlo por el
      // horario para que el evento lleve establishmentId.
      const schedule = await uow.schedules.findById(input.organizationId, exception.scheduleId);
      if (!schedule) throw new ScheduleNotFoundError();

      await uow.schedules.deleteException(input.organizationId, input.exceptionId);
      await uow.outbox.add(scheduleExceptionDeletedEvent(exception, schedule.establishmentId));

      await uow.commit();
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
