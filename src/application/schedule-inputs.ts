import type { ScheduleException, ScheduleShift } from '../domain/entities.js';
import type { ExceptionInput, ShiftInput } from '../domain/schedule.js';

/** Puente entidad → entrada del dominio puro. Lo usan las consultas que llaman
 *  a `computeSlots`, para no repetir el mapeo en cada sitio. */
export function toShiftInput(shift: ScheduleShift): ShiftInput {
  return { weekday: shift.weekday, opensAt: shift.opensAt, closesAt: shift.closesAt, label: shift.label };
}

export function toExceptionInput(exception: ScheduleException): ExceptionInput {
  return {
    onDate: exception.onDate,
    kind: exception.kind,
    opensAt: exception.opensAt,
    closesAt: exception.closesAt,
    reason: exception.reason,
  };
}
