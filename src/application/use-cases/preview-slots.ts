import { ScheduleNotFoundError } from '../../domain/errors.js';
import type { ScheduleRepository } from '../../domain/repositories.js';
import { computeSlots, type Slot } from '../../domain/schedule.js';
import { toExceptionInput, toShiftInput } from '../schedule-inputs.js';

export interface SlotsPreview {
  date: string;
  timezone: string;
  slots: Slot[];
}

/**
 * Vista previa de solo lectura: los inicios de turno que verá el cliente una
 * fecha dada. Es la prueba de que el horario quedó bien configurado.
 */
export class PreviewSlotsUseCase {
  constructor(
    private readonly repos: {
      schedules: Pick<ScheduleRepository, 'findByEstablishment' | 'listShifts' | 'listExceptions'>;
    },
  ) {}

  async execute(input: { organizationId: string; establishmentId: string; date: string }): Promise<SlotsPreview> {
    const schedule = await this.repos.schedules.findByEstablishment(input.organizationId, input.establishmentId);
    if (!schedule) throw new ScheduleNotFoundError();

    const [shifts, exceptions] = await Promise.all([
      this.repos.schedules.listShifts(input.organizationId, schedule.id),
      this.repos.schedules.listExceptions(input.organizationId, schedule.id),
    ]);

    const slots = computeSlots(
      schedule.toSettings(),
      shifts.map(toShiftInput),
      exceptions.map(toExceptionInput),
      input.date,
    );
    return { date: input.date, timezone: schedule.timezone, slots };
  }
}
