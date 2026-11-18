import {
  computeSlots,
  durationFor,
  type ExceptionInput,
  type ScheduleSettings,
  type ShiftInput,
} from './schedule.js';

/**
 * Disponibilidad de mesas en dominio puro: sin base de datos y sin reloj implícito
 * (`now` entra por parámetro). Lo usan igual la página pública, la pantalla del
 * personal y la creación de la reserva, para que lo que se OFRECE sea exactamente
 * lo que luego se ACEPTA.
 */

// ── Zona horaria ────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;

/** Desfase (minutos) de la zona IANA respecto a UTC en ese instante. */
function offsetMinutes(instantMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / MINUTE_MS);
}

/** Fecha y hora locales de una zona → instante UTC. Dos pasadas por si el desfase cambia (horario de verano). */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const first = naive - offsetMinutes(naive, timezone) * MINUTE_MS;
  return new Date(naive - offsetMinutes(first, timezone) * MINUTE_MS);
}

/** Instante UTC → fecha `YYYY-MM-DD` y hora `HH:mm` locales de la zona. */
export function utcToLocal(instant: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Suma días a una fecha local sin pasar por la zona horaria del servidor. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return moved.toISOString().slice(0, 10);
}

// ── Asignación de mesas ─────────────────────────────────────────────────────

export interface AssignableTable {
  id: string;
  name: string;
  floorId: string;
  zoneId: string | null;
  capacityMin: number;
  capacityMax: number;
  xCm: number | null;
  yCm: number | null;
}

/** Una mesa ocupada de `from` a `until` (UTC, en milisegundos; `until` ya incluye el margen de limpieza). */
export interface TableBooking {
  tableId: string;
  from: number;
  until: number;
}

/** Tope de combinaciones evaluadas por búsqueda: acota el peor caso (muchas mesas y muchas por reserva). */
const SEARCH_BUDGET = 100_000;

function overlaps(booking: TableBooking, from: number, until: number): boolean {
  return booking.from < until && booking.until > from;
}

export function freeTables(tables: AssignableTable[], bookings: TableBooking[], from: number, until: number): AssignableTable[] {
  const busy = new Set(bookings.filter((b) => overlaps(b, from, until)).map((b) => b.tableId));
  return tables.filter((t) => !busy.has(t.id));
}

function spread(tables: AssignableTable[]): number {
  let total = 0;
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = tables[i]!;
      const b = tables[j]!;
      if (a.xCm === null || a.yCm === null || b.xCm === null || b.yCm === null) continue;
      total += Math.hypot(a.xCm - b.xCm, a.yCm - b.yCm);
    }
  }
  return Math.round(total);
}

interface Candidate {
  tables: AssignableTable[];
  zones: number;
  surplus: number;
  spread: number;
}

function better(a: Candidate, b: Candidate | null): boolean {
  if (!b) return true;
  if (a.zones !== b.zones) return a.zones < b.zones;
  if (a.surplus !== b.surplus) return a.surplus < b.surplus;
  return a.spread < b.spread;
}

/** Mejor grupo de exactamente `k` mesas del `pool` (ordenado de mayor a menor capacidad) para `partySize`. */
function bestOfSize(pool: AssignableTable[], partySize: number, k: number): Candidate | null {
  let best: Candidate | null = null;
  let evaluated = 0;
  const chosen: AssignableTable[] = [];

  const visit = (start: number, sumMax: number, sumMin: number): void => {
    if (evaluated >= SEARCH_BUDGET) return;
    // Los mínimos solo suben: si ya no cabe un grupo tan chico, ninguna ampliación lo arregla.
    if (sumMin > partySize) return;
    const left = k - chosen.length;
    if (left === 0) {
      evaluated += 1;
      if (sumMax < partySize) return;
      const candidate: Candidate = {
        tables: [...chosen],
        zones: new Set(chosen.map((t) => `${t.floorId}:${t.zoneId ?? '-'}`)).size,
        surplus: sumMax - partySize,
        spread: spread(chosen),
      };
      if (better(candidate, best)) best = candidate;
      return;
    }
    // Cota superior: aun tomando las `left` mesas más grandes que quedan, ¿se llega al grupo?
    let reachable = sumMax;
    for (let i = start; i < start + left && i < pool.length; i += 1) reachable += pool[i]!.capacityMax;
    if (reachable < partySize) return;
    for (let i = start; i <= pool.length - left; i += 1) {
      const table = pool[i]!;
      chosen.push(table);
      visit(i + 1, sumMax + table.capacityMax, sumMin + table.capacityMin);
      chosen.pop();
    }
  };

  visit(0, 0, 0);
  return best;
}

/**
 * Elige las mesas de una reserva, o `null` si no cabe.
 *
 * Primero la mesa más ajustada en la que cabe el grupo; si ninguna alcanza (o ninguna
 * admite un grupo tan chico/grande), la menor cantidad de mesas sueltas, hasta
 * `maxTables`, cuya capacidad sume lo necesario — preferiblemente de la misma zona,
 * con el menor sobrante y, a igualdad, más juntas en el plano.
 *
 * Para cada mesa se respeta su capacidad mínima: un grupo de 2 no ocupa una mesa de 6
 * pensada para 5 o más. En un grupo de varias mesas basta con que la SUMA de mínimos
 * no pase del grupo.
 */
export function assignTables(params: {
  tables: AssignableTable[];
  bookings: TableBooking[];
  partySize: number;
  from: number;
  until: number;
  maxTables: number;
}): AssignableTable[] | null {
  const free = freeTables(params.tables, params.bookings, params.from, params.until);
  // De mayor a menor capacidad (y por nombre, para que el resultado sea estable): permite podar por cota superior.
  const pool = [...free].sort((a, b) => b.capacityMax - a.capacityMax || a.name.localeCompare(b.name, 'es', { numeric: true }));

  for (let k = 1; k <= Math.min(params.maxTables, pool.length); k += 1) {
    const found = bestOfSize(pool, params.partySize, k);
    if (found) return found.tables.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }
  return null;
}

/** ¿Cabría este grupo en el local con TODAS las mesas libres? Distingue «hoy no hay lugar» de «nunca cabrá». */
export function couldEverFit(tables: AssignableTable[], partySize: number, maxTables: number): boolean {
  return assignTables({ tables, bookings: [], partySize, from: 0, until: 1, maxTables }) !== null;
}

// ── Disponibilidad de un día ────────────────────────────────────────────────

export interface AvailabilityLimits {
  /** Hasta cuántos días por delante se puede reservar (contando hoy, en hora local). */
  maxDaysAhead: number;
  /** Antelación mínima en minutos. */
  minNoticeMinutes: number;
}

export type SlotUnavailableReason = 'notice' | 'full';

export interface AvailabilitySlot {
  /** Hora local `HH:mm`. */
  time: string;
  startsAt: Date;
  shiftLabel: string | null;
  available: boolean;
  reason?: SlotUnavailableReason;
}

export type DayStatus = 'open' | 'closed' | 'past' | 'too_far';

export interface DayAvailability {
  date: string;
  status: DayStatus;
  slots: AvailabilitySlot[];
}

export function reservationWindow(settings: ScheduleSettings, startsAt: Date, partySize: number): { endsAt: Date; blockedUntil: Date } {
  const endsAt = new Date(startsAt.getTime() + durationFor(settings, partySize) * MINUTE_MS);
  return { endsAt, blockedUntil: new Date(endsAt.getTime() + settings.cleanupMinutes * MINUTE_MS) };
}

export function computeAvailability(params: {
  settings: ScheduleSettings;
  shifts: ShiftInput[];
  exceptions: ExceptionInput[];
  date: string;
  partySize: number;
  tables: AssignableTable[];
  bookings: TableBooking[];
  maxTables: number;
  limits: AvailabilityLimits;
  now: Date;
  /** El personal puede reservar con menos antelación y más allá del límite público. */
  ignoreLimits?: boolean;
}): DayAvailability {
  const { settings, date, now } = params;
  const today = utcToLocal(now, settings.timezone).date;

  if (date < today) return { date, status: 'past', slots: [] };
  if (!params.ignoreLimits && date > addDays(today, params.limits.maxDaysAhead)) {
    return { date, status: 'too_far', slots: [] };
  }

  const base = computeSlots(settings, params.shifts, params.exceptions, date);
  if (base.length === 0) return { date, status: 'closed', slots: [] };

  const earliest = now.getTime() + (params.ignoreLimits ? 0 : params.limits.minNoticeMinutes * MINUTE_MS);
  const slots: AvailabilitySlot[] = base.map((slot) => {
    const startsAt = localToUtc(date, slot.startsAt, settings.timezone);
    const common = { time: slot.startsAt, startsAt, shiftLabel: slot.shiftLabel };
    // Una hora pasada nunca se ofrece, ni al personal.
    if (startsAt.getTime() <= now.getTime() || startsAt.getTime() < earliest) {
      return { ...common, available: false, reason: 'notice' as const };
    }
    const { blockedUntil } = reservationWindow(settings, startsAt, params.partySize);
    const picked = assignTables({
      tables: params.tables,
      bookings: params.bookings,
      partySize: params.partySize,
      from: startsAt.getTime(),
      until: blockedUntil.getTime(),
      maxTables: params.maxTables,
    });
    return picked ? { ...common, available: true } : { ...common, available: false, reason: 'full' as const };
  });

  return { date, status: 'open', slots };
}
