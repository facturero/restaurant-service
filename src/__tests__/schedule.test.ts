import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  durationFor,
  isTime,
  isValidTimezone,
  localWeekday,
  validateSchedule,
  DEFAULT_CLEANUP_MINUTES,
  DEFAULT_DURATION_BY_PARTY_SIZE,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  type ScheduleSettings,
  type ShiftInput,
} from '../domain/schedule.js';
import { InvalidScheduleError } from '../domain/errors.js';

const settings = (overrides: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  timezone: DEFAULT_TIMEZONE,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  cleanupMinutes: DEFAULT_CLEANUP_MINUTES,
  durationByPartySize: DEFAULT_DURATION_BY_PARTY_SIZE.map((row) => ({ ...row })),
  ...overrides,
});

const shift = (overrides: Partial<ShiftInput> = {}): ShiftInput => ({
  weekday: 2,
  opensAt: '12:00',
  closesAt: '15:00',
  ...overrides,
});

// 2026-10-13 es martes (weekday 2); 2026-10-12, lunes (weekday 1).
const TUESDAY = '2026-10-13';
const MONDAY = '2026-10-12';

describe('computeSlots', () => {
  it('sin turnos, no hay turnos ofrecidos', () => {
    expect(computeSlots(settings(), [], [], TUESDAY)).toEqual([]);
  });

  it('un turno de 12:00 a 15:00 con huecos de 30 min ofrece 12:00 … 14:30', () => {
    const slots = computeSlots(settings(), [shift()], [], TUESDAY);
    expect(slots.map((s) => s.startsAt)).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30']);
  });

  it('el último turno empieza como muy tarde `slotMinutes` antes del cierre', () => {
    const slots = computeSlots(settings({ slotMinutes: 60 }), [shift()], [], TUESDAY);
    expect(slots.map((s) => s.startsAt)).toEqual(['12:00', '13:00', '14:00']);
  });

  it('la fecha cae en el día de la semana correcto (sin desfases de UTC)', () => {
    expect(localWeekday(TUESDAY)).toBe(2);
    expect(localWeekday(MONDAY)).toBe(1);
    expect(computeSlots(settings(), [shift({ weekday: 2 })], [], TUESDAY)).toHaveLength(6);
    expect(computeSlots(settings(), [shift({ weekday: 2 })], [], MONDAY)).toEqual([]);
  });

  it('una excepción `closed` cierra el día entero', () => {
    const slots = computeSlots(settings(), [shift()], [{ onDate: TUESDAY, kind: 'closed' }], TUESDAY);
    expect(slots).toEqual([]);
  });

  it('una excepción `special_hours` reemplaza los turnos de ese día', () => {
    const slots = computeSlots(
      settings(),
      [shift({ opensAt: '12:00', closesAt: '15:00' })],
      [{ onDate: TUESDAY, kind: 'special_hours', opensAt: '18:00', closesAt: '20:00', reason: 'Feriado' }],
      TUESDAY,
    );
    expect(slots.map((s) => s.startsAt)).toEqual(['18:00', '18:30', '19:00', '19:30']);
    expect(slots[0]?.shiftLabel).toBe('Feriado');
  });

  it('una excepción de otro día no afecta los turnos', () => {
    const slots = computeSlots(settings(), [shift()], [{ onDate: MONDAY, kind: 'closed' }], TUESDAY);
    expect(slots).toHaveLength(6);
  });

  it('varios turnos el mismo día se concatenan', () => {
    const slots = computeSlots(
      settings(),
      [shift({ opensAt: '12:00', closesAt: '13:00' }), shift({ opensAt: '20:00', closesAt: '21:00' })],
      [],
      TUESDAY,
    );
    expect(slots.map((s) => s.startsAt)).toEqual(['12:00', '12:30', '20:00', '20:30']);
  });

  it('una fecha con formato inválido no revienta: devuelve vacío', () => {
    expect(computeSlots(settings(), [shift()], [], '13/10/2026')).toEqual([]);
  });
});

describe('validateSchedule', () => {
  it('acepta los ajustes por defecto y un turno coherente', () => {
    expect(() => validateSchedule(settings(), [shift()])).not.toThrow();
  });

  it('rechaza un turno invertido (cierre antes de apertura)', () => {
    expect(() => validateSchedule(settings(), [shift({ opensAt: '15:00', closesAt: '12:00' })])).toThrow(InvalidScheduleError);
  });

  it('rechaza turnos solapados del mismo día', () => {
    try {
      validateSchedule(settings(), [shift({ opensAt: '12:00', closesAt: '15:00' }), shift({ opensAt: '14:00', closesAt: '18:00' })]);
      expect.unreachable('debía lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidScheduleError);
      expect((err as InvalidScheduleError).details?.some((d) => /solapan/.test(d.message))).toBe(true);
    }
  });

  it('dos turnos contiguos (sin solape) sí valen', () => {
    expect(() =>
      validateSchedule(settings(), [shift({ opensAt: '12:00', closesAt: '15:00' }), shift({ opensAt: '15:00', closesAt: '18:00' })]),
    ).not.toThrow();
  });

  it('rechaza un `slotMinutes` que no está permitido', () => {
    expect(() => validateSchedule(settings({ slotMinutes: 7 }), [])).toThrow(InvalidScheduleError);
  });

  it('rechaza una zona horaria inventada', () => {
    expect(isValidTimezone('Marte/Olympus')).toBe(false);
    expect(() => validateSchedule(settings({ timezone: 'Marte/Olympus' }), [])).toThrow(InvalidScheduleError);
  });

  it('rechaza una tabla de duración cuya última fila no queda abierta', () => {
    expect(() =>
      validateSchedule(settings({ durationByPartySize: [{ upTo: 2, minutes: 60 }, { upTo: 4, minutes: 90 }] }), []),
    ).toThrow(InvalidScheduleError);
  });

  it('el error trae todos los problemas juntos', () => {
    try {
      validateSchedule(settings({ slotMinutes: 7, timezone: 'Marte/Olympus' }), [shift({ opensAt: '15:00', closesAt: '12:00' })]);
      expect.unreachable('debía lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidScheduleError);
      expect((err as InvalidScheduleError).details?.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('durationFor', () => {
  it('resuelve los bordes de la tabla por defecto (2 → 60, 3 y 4 → 90, 5 y 20 → 120)', () => {
    const s = settings();
    expect(durationFor(s, 1)).toBe(60);
    expect(durationFor(s, 2)).toBe(60);
    expect(durationFor(s, 3)).toBe(90);
    expect(durationFor(s, 4)).toBe(90);
    expect(durationFor(s, 5)).toBe(120);
    expect(durationFor(s, 20)).toBe(120);
  });
});

describe('isTime', () => {
  it('solo acepta HH:mm de 00:00 a 23:59', () => {
    expect(isTime('00:00')).toBe(true);
    expect(isTime('23:59')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('12:60')).toBe(false);
    expect(isTime('9:00')).toBe(false);
  });
});
