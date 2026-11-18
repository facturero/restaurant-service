import { describe, expect, it } from 'vitest';
import {
  addDays,
  assignTables,
  computeAvailability,
  couldEverFit,
  localToUtc,
  reservationWindow,
  utcToLocal,
  type AssignableTable,
  type TableBooking,
} from '../domain/availability.js';
import { DEFAULT_DURATION_BY_PARTY_SIZE } from '../domain/schedule.js';

const t = (id: string, capacityMin: number, capacityMax: number, extra: Partial<AssignableTable> = {}): AssignableTable => ({
  id,
  name: extra.name ?? id,
  floorId: 'f1',
  zoneId: null,
  capacityMin,
  capacityMax,
  xCm: null,
  yCm: null,
  ...extra,
});

const HOUR = 3_600_000;

describe('zona horaria', () => {
  it('Guayaquil está a UTC-5 todo el año', () => {
    expect(localToUtc('2026-10-17', '19:30', 'America/Guayaquil').toISOString()).toBe('2026-10-18T00:30:00.000Z');
    expect(utcToLocal(new Date('2026-10-18T00:30:00Z'), 'America/Guayaquil')).toEqual({ date: '2026-10-17', time: '19:30' });
  });

  it('respeta el horario de verano de otras zonas (Madrid: UTC+2 en verano, UTC+1 en invierno)', () => {
    expect(localToUtc('2026-07-15', '21:00', 'Europe/Madrid').toISOString()).toBe('2026-07-15T19:00:00.000Z');
    expect(localToUtc('2026-12-15', '21:00', 'Europe/Madrid').toISOString()).toBe('2026-12-15T20:00:00.000Z');
  });

  it('ida y vuelta devuelve lo mismo, incluso el día del cambio de hora', () => {
    for (const [date, time, tz] of [
      ['2026-03-29', '10:00', 'Europe/Madrid'],
      ['2026-10-25', '10:00', 'Europe/Madrid'],
      ['2026-11-01', '20:00', 'America/New_York'],
    ] as const) {
      expect(utcToLocal(localToUtc(date, time, tz), tz)).toEqual({ date, time });
    }
  });

  it('suma días sin depender de la zona del servidor', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('asignación de mesas', () => {
  const base = { bookings: [] as TableBooking[], from: 0, until: HOUR, maxTables: 3 };

  it('toma la mesa más ajustada en la que cabe el grupo', () => {
    const tables = [t('grande', 4, 8), t('mediana', 2, 4), t('chica', 1, 2)];
    expect(assignTables({ ...base, tables, partySize: 2 })?.map((x) => x.id)).toEqual(['chica']);
    expect(assignTables({ ...base, tables, partySize: 3 })?.map((x) => x.id)).toEqual(['mediana']);
    expect(assignTables({ ...base, tables, partySize: 6 })?.map((x) => x.id)).toEqual(['grande']);
  });

  it('respeta la capacidad mínima de cada mesa', () => {
    // Un grupo de 2 no se sienta en una mesa que pide 4 o más.
    expect(assignTables({ ...base, tables: [t('seis', 4, 6)], partySize: 2 })).toBeNull();
    expect(assignTables({ ...base, tables: [t('seis', 4, 6), t('dos', 1, 2)], partySize: 2 })?.map((x) => x.id)).toEqual(['dos']);
  });

  it('une mesas sueltas solo cuando ninguna alcanza, con la menor cantidad posible', () => {
    const tables = [t('a', 1, 4), t('b', 1, 4), t('c', 1, 4), t('d', 1, 2)];
    expect(assignTables({ ...base, tables, partySize: 7 })?.map((x) => x.id)).toEqual(['a', 'b']);
    // 10 personas necesitan tres mesas: 4 + 4 + 2.
    expect(assignTables({ ...base, tables, partySize: 10 })).toHaveLength(3);
  });

  it('el máximo de mesas por reserva lo pone el dueño', () => {
    const tables = [t('a', 1, 4), t('b', 1, 4), t('c', 1, 4)];
    expect(assignTables({ ...base, tables, partySize: 12, maxTables: 3 })).toHaveLength(3);
    expect(assignTables({ ...base, tables, partySize: 12, maxTables: 2 })).toBeNull();
  });

  it('en un grupo de varias mesas la suma de mínimos no puede pasar del grupo', () => {
    // 5 personas en dos mesas de mínimo 4 sería dejar a cada mesa a medias.
    expect(assignTables({ ...base, tables: [t('a', 4, 6), t('b', 4, 6)], partySize: 5 })?.map((x) => x.id)).toEqual(['a']);
    expect(assignTables({ ...base, tables: [t('a', 4, 4), t('b', 4, 4)], partySize: 5 })).toBeNull();
  });

  it('prefiere mesas de la misma zona', () => {
    const tables = [
      t('terraza-1', 1, 4, { zoneId: 'terraza' }),
      t('salon-1', 1, 4, { zoneId: 'salon' }),
      t('salon-2', 1, 4, { zoneId: 'salon' }),
    ];
    expect(assignTables({ ...base, tables, partySize: 8 })?.map((x) => x.id)).toEqual(['salon-1', 'salon-2']);
  });

  it('a igual zona y sobrante, prefiere las mesas más juntas en el plano', () => {
    const tables = [
      t('lejos', 1, 4, { xCm: 2000, yCm: 0 }),
      t('cerca-a', 1, 4, { xCm: 0, yCm: 0 }),
      t('cerca-b', 1, 4, { xCm: 100, yCm: 0 }),
    ];
    expect(assignTables({ ...base, tables, partySize: 8 })?.map((x) => x.id)).toEqual(['cerca-a', 'cerca-b']);
  });

  it('no usa mesas ocupadas en ese rato, pero sí las que se liberan antes o empiezan después', () => {
    const tables = [t('a', 1, 4), t('b', 1, 4)];
    const bookings: TableBooking[] = [{ tableId: 'a', from: 2 * HOUR, until: 4 * HOUR }];
    // Choca: empieza dentro de la reserva de la mesa a.
    expect(assignTables({ ...base, tables, bookings, partySize: 3, from: 3 * HOUR, until: 5 * HOUR })?.map((x) => x.id)).toEqual(['b']);
    // Justo cuando termina la otra: libre (los intervalos son [desde, hasta)).
    expect(assignTables({ ...base, tables: [t('a', 1, 4)], bookings, partySize: 3, from: 4 * HOUR, until: 6 * HOUR })).not.toBeNull();
    expect(assignTables({ ...base, tables: [t('a', 1, 4)], bookings, partySize: 3, from: 0, until: 2 * HOUR })).not.toBeNull();
    expect(assignTables({ ...base, tables: [t('a', 1, 4)], bookings, partySize: 3, from: HOUR, until: 3 * HOUR })).toBeNull();
  });

  it('la elección es estable: mismas mesas, mismo resultado, sin importar el orden de entrada', () => {
    const tables = [t('Mesa 2', 1, 4), t('Mesa 10', 1, 4), t('Mesa 1', 1, 4)];
    const a = assignTables({ ...base, tables, partySize: 8 })?.map((x) => x.name);
    const b = assignTables({ ...base, tables: [...tables].reverse(), partySize: 8 })?.map((x) => x.name);
    expect(a).toEqual(b);
  });

  it('con muchas mesas no se cuelga (la búsqueda tiene tope)', () => {
    const tables = Array.from({ length: 60 }, (_, i) => t(`m${i}`, 1, 2));
    const started = Date.now();
    // 60 mesas de 2 y un grupo de 20 con hasta 10 mesas.
    assignTables({ ...base, tables, partySize: 20, maxTables: 10 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('distingue «hoy no hay lugar» de «nunca cabría»', () => {
    const tables = [t('a', 1, 4), t('b', 1, 4)];
    expect(couldEverFit(tables, 8, 2)).toBe(true);
    expect(couldEverFit(tables, 9, 2)).toBe(false);
    expect(couldEverFit([], 2, 2)).toBe(false);
  });
});

describe('disponibilidad de un día', () => {
  const settings = {
    timezone: 'America/Guayaquil',
    slotMinutes: 30,
    cleanupMinutes: 15,
    durationByPartySize: DEFAULT_DURATION_BY_PARTY_SIZE,
  };
  // Sábado 17 de octubre de 2026: cenas de 19:00 a 21:00 (inicios 19:00, 19:30, 20:00, 20:30).
  const shifts = [{ weekday: 6, opensAt: '19:00', closesAt: '21:00', label: 'Cena' }];
  const tables = [t('a', 1, 4)];
  const limits = { maxDaysAhead: 30, minNoticeMinutes: 60 };
  // «Ahora» = jueves 15 de octubre, 12:00 hora de Guayaquil.
  const now = localToUtc('2026-10-15', '12:00', settings.timezone);
  const call = (over: Partial<Parameters<typeof computeAvailability>[0]> = {}) =>
    computeAvailability({ settings, shifts, exceptions: [], date: '2026-10-17', partySize: 2, tables, bookings: [], maxTables: 3, limits, now, ...over });

  it('un día con turnos ofrece todos sus inicios libres', () => {
    const day = call();
    expect(day.status).toBe('open');
    expect(day.slots.map((s) => [s.time, s.available])).toEqual([
      ['19:00', true],
      ['19:30', true],
      ['20:00', true],
      ['20:30', true],
    ]);
    expect(day.slots[0]?.startsAt.toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it('una reserva bloquea su duración MÁS el margen de limpieza', () => {
    // Grupo de 2 = 60 min + 15 de limpieza: la mesa está ocupada de 19:00 a 20:15.
    const from = localToUtc('2026-10-17', '19:00', settings.timezone).getTime();
    const bookings: TableBooking[] = [{ tableId: 'a', from, until: from + 75 * 60_000 }];
    const day = call({ bookings });
    expect(day.slots.map((s) => [s.time, s.available])).toEqual([
      ['19:00', false],
      ['19:30', false],
      ['20:00', false],
      ['20:30', true],
    ]);
    expect(day.slots[0]?.reason).toBe('full');
  });

  it('un grupo más grande dura más: ocupa la mesa más rato', () => {
    const { endsAt, blockedUntil } = reservationWindow(settings, new Date('2026-10-18T00:00:00Z'), 4);
    expect(endsAt.toISOString()).toBe('2026-10-18T01:30:00.000Z');
    expect(blockedUntil.toISOString()).toBe('2026-10-18T01:45:00.000Z');
  });

  it('un día sin turnos o con cierre está «closed»', () => {
    expect(call({ date: '2026-10-16' }).status).toBe('closed');
    expect(call({ exceptions: [{ onDate: '2026-10-17', kind: 'closed', reason: 'Feriado' }] }).status).toBe('closed');
  });

  it('un día pasado o fuera de la ventana no ofrece nada', () => {
    expect(call({ date: '2026-10-10' })).toMatchObject({ status: 'past', slots: [] });
    // 30 días desde el 15 de octubre = hasta el 14 de noviembre incluido.
    expect(call({ date: '2026-11-14' }).status).not.toBe('too_far');
    expect(call({ date: '2026-11-21' })).toMatchObject({ status: 'too_far', slots: [] });
  });

  it('la antelación mínima descuenta los inicios demasiado cercanos', () => {
    // Son las 18:30 del propio sábado y se pide una hora de antelación: el 19:00 ya no; el 19:30 queda justo (>= ahora + 60 min).
    const sabado = localToUtc('2026-10-17', '18:30', settings.timezone);
    const day = call({ now: sabado });
    expect(day.slots.map((s) => [s.time, s.available])).toEqual([
      ['19:00', false],
      ['19:30', true],
      ['20:00', true],
      ['20:30', true],
    ]);
    expect(day.slots[0]?.reason).toBe('notice');
  });

  it('el personal salta la antelación y el tope de días, pero nunca reserva en el pasado', () => {
    const sabado = localToUtc('2026-10-17', '18:30', settings.timezone);
    expect(call({ now: sabado, ignoreLimits: true }).slots.map((s) => s.available)).toEqual([true, true, true, true]);
    // Pero una hora que ya pasó no se ofrece ni al personal.
    const tarde = localToUtc('2026-10-17', '19:10', settings.timezone);
    expect(call({ now: tarde, ignoreLimits: true }).slots.map((s) => s.available)).toEqual([false, true, true, true]);
    expect(call({ date: '2026-12-26', ignoreLimits: true, shifts: [{ weekday: 6, opensAt: '19:00', closesAt: '21:00' }] }).status).toBe('open');
  });

  it('sin mesa para ese tamaño de grupo todo queda «full»', () => {
    const day = call({ partySize: 6 });
    expect(day.slots.every((s) => !s.available && s.reason === 'full')).toBe(true);
  });
});
