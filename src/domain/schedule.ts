import { InvalidScheduleError, type ErrorDetail } from './errors.js';

/**
 * Horarios en dominio puro: nada de base de datos ni de reloj implícito. Todo lo
 * que necesita saber cuándo se ofrece un turno entra por parámetro.
 *
 * Se trabaja SIEMPRE con fechas locales `YYYY-MM-DD` y horas `HH:mm`. Convertir
 * a UTC es cosa del entregable 2 (al guardar una reserva), no de aquí.
 */

export interface PartyDuration {
  /** `null` en la última fila = "y todos los grupos mayores". */
  upTo: number | null;
  minutes: number;
}

export interface ScheduleSettings {
  timezone: string;
  /** Cada cuántos minutos se ofrece un turno. */
  slotMinutes: number;
  cleanupMinutes: number;
  durationByPartySize: PartyDuration[];
}

export interface ShiftInput {
  /** 0 = domingo … 6 = sábado (como `Date#getDay`). */
  weekday: number;
  opensAt: string;
  closesAt: string;
  label?: string | null;
}

export interface ExceptionInput {
  onDate: string;
  kind: 'closed' | 'special_hours';
  opensAt?: string | null;
  closesAt?: string | null;
  reason?: string | null;
}

export interface Slot {
  startsAt: string;
  shiftLabel: string | null;
}

export const ALLOWED_SLOT_MINUTES = [5, 10, 15, 20, 30, 60] as const;
export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_CLEANUP_MINUTES = 15;
export const DEFAULT_TIMEZONE = 'America/Guayaquil';

export const DEFAULT_DURATION_BY_PARTY_SIZE: PartyDuration[] = [
  { upTo: 2, minutes: 60 },
  { upTo: 4, minutes: 90 },
  { upTo: null, minutes: 120 },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function isLocalDate(value: string): boolean {
  return DATE_RE.test(value);
}

/** IANA válida si `Intl` la reconoce; intentarlo es la única comprobación fiable. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('es', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Día de la semana LOCAL de una fecha `YYYY-MM-DD`, sin pasar por UTC. */
export function localWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

/**
 * Valida ajustes y turnos. Lanza `InvalidScheduleError` con todos los problemas
 * juntos (no solo el primero) para que la pantalla de horarios pueda señalarlos.
 */
export function validateSchedule(settings: ScheduleSettings, shifts: ShiftInput[]): void {
  const details: ErrorDetail[] = [];

  if (!(ALLOWED_SLOT_MINUTES as readonly number[]).includes(settings.slotMinutes)) {
    details.push({
      field: 'slotMinutes',
      message: `Los minutos entre turnos deben ser uno de: ${ALLOWED_SLOT_MINUTES.join(', ')}.`,
    });
  }

  if (!Number.isInteger(settings.cleanupMinutes) || settings.cleanupMinutes < 0 || settings.cleanupMinutes > 120) {
    details.push({ field: 'cleanupMinutes', message: 'El margen de limpieza debe estar entre 0 y 120 minutos.' });
  }

  if (!isValidTimezone(settings.timezone)) {
    details.push({ field: 'timezone', message: `Zona horaria no reconocida: ${settings.timezone}.` });
  }

  details.push(...validateDurationTable(settings.durationByPartySize));

  shifts.forEach((shift, index) => {
    if (!Number.isInteger(shift.weekday) || shift.weekday < 0 || shift.weekday > 6) {
      details.push({ field: `shifts.${index}.weekday`, message: 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado).' });
      return;
    }
    if (!isTime(shift.opensAt) || !isTime(shift.closesAt)) {
      details.push({ field: `shifts.${index}`, message: 'Las horas deben venir en formato HH:mm.' });
      return;
    }
    if (toMinutes(shift.opensAt) >= toMinutes(shift.closesAt)) {
      details.push({
        field: `shifts.${index}`,
        message: 'La hora de cierre debe ser posterior a la de apertura (esta versión no admite turnos que crucen la medianoche).',
      });
    }
  });

  // Solapes dentro del mismo día.
  const byWeekday = new Map<number, ShiftInput[]>();
  for (const shift of shifts) {
    if (!isTime(shift.opensAt) || !isTime(shift.closesAt)) continue;
    const list = byWeekday.get(shift.weekday) ?? [];
    list.push(shift);
    byWeekday.set(shift.weekday, list);
  }
  for (const [weekday, list] of byWeekday) {
    const sorted = [...list].sort((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const current = sorted[i]!;
      if (toMinutes(current.opensAt) < toMinutes(prev.closesAt)) {
        details.push({
          field: 'shifts',
          message: `Los turnos del día ${weekday} se solapan (${prev.opensAt}-${prev.closesAt} y ${current.opensAt}-${current.closesAt}).`,
        });
      }
    }
  }

  if (details.length > 0) throw new InvalidScheduleError(details);
}

function validateDurationTable(rows: PartyDuration[]): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    details.push({ field: 'durationByPartySize', message: 'Falta la tabla de duración por tamaño de grupo.' });
    return details;
  }
  let previousUpTo = 0;
  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    if (isLast) {
      if (row.upTo !== null) {
        details.push({ field: `durationByPartySize.${index}.upTo`, message: 'La última fila debe quedar abierta (upTo = null).' });
      }
    } else if (!Number.isInteger(row.upTo) || row.upTo === null || row.upTo <= previousUpTo) {
      details.push({
        field: `durationByPartySize.${index}.upTo`,
        message: 'Cada fila debe cubrir una cantidad mayor que la anterior.',
      });
    } else {
      previousUpTo = row.upTo;
    }
    if (!Number.isInteger(row.minutes) || row.minutes < 15 || row.minutes > 480) {
      details.push({ field: `durationByPartySize.${index}.minutes`, message: 'La duración debe estar entre 15 y 480 minutos.' });
    }
  });
  return details;
}

/** Minutos que dura una comida de ese tamaño. */
export function durationFor(settings: ScheduleSettings, partySize: number): number {
  for (const row of settings.durationByPartySize) {
    if (row.upTo === null || partySize <= row.upTo) return row.minutes;
  }
  // La tabla siempre termina en fila abierta; si no, el mayor tramo es el techo.
  return settings.durationByPartySize[settings.durationByPartySize.length - 1]?.minutes ?? 60;
}

/**
 * Inicios de turno que se ofrecerían una fecha local. Es la base del entregable 2
 * y lo que muestra la vista previa del dueño.
 *
 * Regla del producto: el último turno empieza como muy tarde `slotMinutes` antes
 * del cierre (12:00-15:00 con huecos de 30 ⇒ 12:00 … 14:30).
 */
export function computeSlots(
  settings: ScheduleSettings,
  shifts: ShiftInput[],
  exceptions: ExceptionInput[],
  date: string,
): Slot[] {
  if (!isLocalDate(date)) return [];

  const exception = exceptions.find((e) => e.onDate === date);
  if (exception?.kind === 'closed') return [];

  const effective: ShiftInput[] =
    exception?.kind === 'special_hours'
      ? specialHoursAsShift(exception, date)
      : shifts.filter((s) => s.weekday === localWeekday(date));

  const slots: Slot[] = [];
  for (const shift of effective) {
    if (!isTime(shift.opensAt) || !isTime(shift.closesAt)) continue;
    const step = settings.slotMinutes;
    const start = toMinutes(shift.opensAt);
    const end = toMinutes(shift.closesAt);
    for (let minute = start; minute + step <= end; minute += step) {
      slots.push({ startsAt: fromMinutes(minute), shiftLabel: shift.label ?? null });
    }
  }
  return slots;
}

function specialHoursAsShift(exception: ExceptionInput, date: string): ShiftInput[] {
  if (!exception.opensAt || !exception.closesAt) return [];
  return [
    {
      weekday: localWeekday(date),
      opensAt: exception.opensAt,
      closesAt: exception.closesAt,
      label: exception.reason ?? 'Horario especial',
    },
  ];
}
