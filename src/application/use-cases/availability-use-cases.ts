import {
  computeAvailability,
  couldEverFit,
  type DayAvailability,
  type TableBooking,
} from '../../domain/availability.js';
import { PartySizeError } from '../../domain/errors.js';
import type {
  DiningTableRepository,
  ReservationRepository,
  ReservationSettingsRepository,
  ScheduleRepository,
} from '../../domain/repositories.js';
import type { Clock, PluginGate } from '../ports.js';
import { loadBookingContext, localDayRange, resolvePublicRestaurant, type BookingContext } from './reservation-context.js';
import { settingsOrDefault } from './reservation-settings-use-cases.js';

type Repos = {
  reservationSettings: ReservationSettingsRepository;
  reservations: Pick<ReservationRepository, 'activeBookings'>;
  schedules: Pick<ScheduleRepository, 'findByEstablishment' | 'listShifts' | 'listExceptions'>;
  tables: Pick<DiningTableRepository, 'listByEstablishment'>;
};

/** Qué horas se ofrecen un día para un grupo. Lo comparten la página pública, el personal y la propia creación. */
export async function dayAvailability(
  repos: Pick<Repos, 'reservations'>,
  ctx: BookingContext,
  params: { date: string; partySize: number; now: Date; ignoreLimits?: boolean; bookingsOverride?: TableBooking[] },
): Promise<DayAvailability> {
  const { settings, schedule } = ctx;
  const { from, to } = localDayRange(params.date, schedule.timezone);
  // Una comida puede cruzar la medianoche: se miran también las ocupaciones que empezaron ese día y terminan tarde.
  const bookings =
    params.bookingsOverride ??
    (await repos.reservations.activeBookings(
      settings.organizationId,
      ctx.tables.map((t) => t.id),
      from,
      new Date(to.getTime() + 12 * 3_600_000),
    ));

  return computeAvailability({
    settings: schedule.toSettings(),
    shifts: ctx.shifts,
    exceptions: ctx.exceptions,
    date: params.date,
    partySize: params.partySize,
    tables: ctx.tables,
    bookings,
    maxTables: settings.maxTablesPerReservation,
    limits: { maxDaysAhead: settings.maxDaysAhead, minNoticeMinutes: settings.minNoticeMinutes },
    now: params.now,
    ignoreLimits: params.ignoreLimits,
  });
}

/** Lo que muestra la página pública del restaurante antes de elegir fecha. */
export interface PublicRestaurantInfo {
  slug: string;
  name: string;
  note: string | null;
  phone: string | null;
  timezone: string;
  maxPartySize: number;
  maxDaysAhead: number;
  minNoticeMinutes: number;
  /** Días de la semana (0 = domingo) en que el local tiene turnos: la página puede atenuar los demás. */
  openWeekdays: number[];
}

export class GetPublicRestaurantUseCase {
  constructor(
    private readonly repos: Repos,
    private readonly plugins: PluginGate,
  ) {}

  async execute(slug: string): Promise<PublicRestaurantInfo> {
    const settings = await resolvePublicRestaurant(this.repos, this.plugins, slug);
    const ctx = await loadBookingContext(this.repos, settings);
    return {
      slug: settings.publicSlug ?? slug,
      name: settings.displayName ?? '',
      note: settings.publicNote,
      phone: settings.contactPhone,
      timezone: ctx.schedule.timezone,
      maxPartySize: settings.maxPartySize,
      maxDaysAhead: settings.maxDaysAhead,
      minNoticeMinutes: settings.minNoticeMinutes,
      openWeekdays: [...new Set(ctx.shifts.map((s) => s.weekday))].sort((a, b) => a - b),
    };
  }
}

/** Mensaje cuando el grupo no cabe nunca en el local: lleva el teléfono si el dueño lo dejó. */
export function partyTooLargeError(phone: string | null): PartySizeError {
  return new PartySizeError(
    phone
      ? `Para un grupo de ese tamaño, llámanos al ${phone} y lo organizamos.`
      : 'Para un grupo de ese tamaño, contacta directamente al restaurante.',
  );
}

/** Reglas de tamaño de grupo de la reserva EN LÍNEA (el personal no tiene tope fijo: puede organizar lo que haga falta). */
export function assertPublicPartyAllowed(ctx: BookingContext, partySize: number): void {
  const { settings } = ctx;
  if (!Number.isInteger(partySize) || partySize < 1) throw new PartySizeError('Indica cuántas personas son.');
  if (partySize > settings.maxPartySize || !couldEverFit(ctx.tables, partySize, settings.maxTablesPerReservation)) {
    throw partyTooLargeError(settings.contactPhone);
  }
}

export class GetPublicAvailabilityUseCase {
  constructor(
    private readonly repos: Repos,
    private readonly plugins: PluginGate,
    private readonly clock: Clock,
  ) {}

  async execute(input: { slug: string; date: string; partySize: number }): Promise<DayAvailability> {
    const settings = await resolvePublicRestaurant(this.repos, this.plugins, input.slug);
    const ctx = await loadBookingContext(this.repos, settings);
    assertPublicPartyAllowed(ctx, input.partySize);
    return dayAvailability(this.repos, ctx, { date: input.date, partySize: input.partySize, now: this.clock() });
  }
}

/** Lo mismo para el personal: sin tope de días ni antelación (puede anotar una reserva de última hora o de dentro de un año). */
export class GetStaffAvailabilityUseCase {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
  ) {}

  async execute(input: { organizationId: string; establishmentId: string; date: string; partySize: number }): Promise<DayAvailability> {
    const settings = await settingsOrDefault(this.repos.reservationSettings, input.organizationId, input.establishmentId);
    const ctx = await loadBookingContext(this.repos, settings);
    return dayAvailability(this.repos, ctx, {
      date: input.date,
      partySize: input.partySize,
      now: this.clock(),
      ignoreLimits: true,
    });
  }
}
