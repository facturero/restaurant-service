import {
  assignTables,
  couldEverFit,
  freeTables,
  reservationWindow,
  type AssignableTable,
} from '../../domain/availability.js';
import {
  PartySizeError,
  SlotNotOfferedError,
  SlotTakenError,
  TableNotFoundError,
  TablesUnavailableError,
  TooManyReservationsError,
} from '../../domain/errors.js';
import {
  generateCancelToken,
  Reservation,
  type ReservationSettings,
  type ReservationSource,
} from '../../domain/reservation.js';
import type { ReservationSettingsRepository } from '../../domain/repositories.js';
import { reservationCreatedEvent, type ReservationNoticeContext } from '../events.js';
import type { Clock, PluginGate, ReservationLinks, UnitOfWorkGateway } from '../ports.js';
import { assertPublicPartyAllowed, dayAvailability } from './availability-use-cases.js';
import { loadBookingContext, resolvePublicRestaurant, type BookingContext } from './reservation-context.js';
import { settingsOrDefault } from './reservation-settings-use-cases.js';

/** Tope de reservas vigentes por correo o teléfono en un mismo local: frena a quien intente bloquear mesas con reservas falsas. */
export const MAX_UPCOMING_PER_GUEST = 3;

export interface BookInput {
  source: ReservationSource;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestEmail?: string | null;
  guestPhone: string;
  notes?: string | null;
  /** Solo el personal: sentar a esta gente en estas mesas en vez de dejar que el sistema elija. */
  tableIds?: string[];
  createdBy?: string | null;
}

export interface BookedReservation {
  reservation: Reservation;
  /** El token del enlace de cancelación: solo existe ahora, en la base queda su hash. */
  token: string;
  tables: Array<{ id: string; name: string }>;
  timezone: string;
}

export function noticeContext(ctx: BookingContext, tableNames: string[], manageUrl?: string): ReservationNoticeContext {
  return {
    restaurantName: ctx.settings.displayName ?? 'El restaurante',
    restaurantPhone: ctx.settings.contactPhone,
    notifyEmail: ctx.settings.notifyEmail,
    timezone: ctx.schedule.timezone,
    tableNames,
    manageUrl,
  };
}

/**
 * El corazón de las reservas: decidir mesas y guardar, sin que dos personas puedan quedarse con la misma.
 *
 * Todo ocurre en UNA transacción: se bloquean (con `SELECT … FOR UPDATE`) las mesas activas del local, se lee la ocupación
 * ya con el bloqueo puesto, se eligen mesas libres y se escribe. Quien pida a la vez espera su turno y, cuando le toca,
 * ve las mesas ya ocupadas. Bloquear primero y leer después es lo que cierra la carrera; elegir primero y bloquear después
 * dejaría una ventana en la que ambos ven libre la misma mesa.
 */
export class ReservationBooker {
  constructor(
    private readonly uow: UnitOfWorkGateway,
    private readonly links: ReservationLinks,
    private readonly clock: Clock,
  ) {}

  async book(settings: ReservationSettings, input: BookInput): Promise<BookedReservation> {
    const uow = await this.uow.begin();
    try {
      const now = this.clock();
      const ctx = await loadBookingContext(uow, settings);
      const manual = input.source === 'staff' && (input.tableIds?.length ?? 0) > 0;

      if (input.source === 'online') {
        assertPublicPartyAllowed(ctx, input.partySize);
      } else if (!Number.isInteger(input.partySize) || input.partySize < 1) {
        throw new PartySizeError('Indica cuántas personas son.');
      } else if (!manual && !couldEverFit(ctx.tables, input.partySize, settings.maxTablesPerReservation)) {
        throw new PartySizeError('Con las mesas del local no se alcanza esa cantidad de personas. Elige las mesas a mano o ajusta el máximo de mesas por reserva.');
      }

      // ¿Se ofrece esa hora? (con el local vacío: aquí solo importa el horario, la antelación y la ventana de días)
      const day = await dayAvailability(uow, ctx, {
        date: input.date,
        partySize: input.partySize,
        now,
        ignoreLimits: input.source === 'staff',
        bookingsOverride: [],
      });
      const slot = day.status === 'open' ? day.slots.find((s) => s.time === input.time) : undefined;
      if (!slot || slot.reason === 'notice') {
        throw new SlotNotOfferedError(
          slot?.reason === 'notice'
            ? 'Esa hora ya no admite reservas por falta de antelación. Elige una más tarde.'
            : 'Esa hora no está disponible para reservar.',
        );
      }

      const { token, hash } = generateCancelToken();
      const window = reservationWindow(ctx.schedule.toSettings(), slot.startsAt, input.partySize);
      // Se crea antes de bloquear: si los datos del cliente no sirven, se falla sin haber tomado ningún bloqueo.
      const reservation = Reservation.create({
        organizationId: settings.organizationId,
        establishmentId: settings.establishmentId,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        guestPhone: input.guestPhone,
        partySize: input.partySize,
        onDate: input.date,
        startsAt: slot.startsAt,
        endsAt: window.endsAt,
        blockedUntil: window.blockedUntil,
        source: input.source,
        notes: input.notes,
        cancelTokenHash: hash,
        createdBy: input.createdBy,
      });

      await uow.reservations.lockTables(settings.organizationId, ctx.tables.map((t) => t.id));

      // Después del bloqueo, no antes: con el bloqueo puesto las reservas simultáneas del mismo cliente hacen fila y cada una ve
      // las anteriores. Contar antes dejaba pasar 12 peticiones en paralelo con el mismo correo.
      if (input.source === 'online') {
        const upcoming = await uow.reservations.countUpcomingByGuest(
          settings.organizationId,
          settings.establishmentId,
          { email: reservation.guestEmail, phone: reservation.guestPhone },
          now,
        );
        if (upcoming >= MAX_UPCOMING_PER_GUEST) throw new TooManyReservationsError();
      }

      const bookings = await uow.reservations.activeBookings(
        settings.organizationId,
        ctx.tables.map((t) => t.id),
        slot.startsAt,
        window.blockedUntil,
      );

      const chosen = manual
        ? this.validateManual(ctx.tables, input.tableIds ?? [], bookings, slot.startsAt.getTime(), window.blockedUntil.getTime())
        : assignTables({
            tables: ctx.tables,
            bookings,
            partySize: input.partySize,
            from: slot.startsAt.getTime(),
            until: window.blockedUntil.getTime(),
            maxTables: settings.maxTablesPerReservation,
          });
      if (!chosen) throw new SlotTakenError();

      await uow.reservations.save(reservation);
      await uow.reservations.assignTables(reservation, chosen.map((t) => t.id));
      const names = chosen.map((t) => t.name);
      await uow.outbox.add(reservationCreatedEvent(reservation, noticeContext(ctx, names, this.links.manageUrl(token))));

      await uow.commit();
      return { reservation, token, tables: chosen.map((t) => ({ id: t.id, name: t.name })), timezone: ctx.schedule.timezone };
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }

  private validateManual(
    active: AssignableTable[],
    ids: string[],
    bookings: Parameters<typeof freeTables>[1],
    from: number,
    until: number,
  ): AssignableTable[] {
    const byId = new Map(active.map((t) => [t.id, t]));
    const unique = [...new Set(ids)];
    const picked = unique.map((id) => {
      const table = byId.get(id);
      if (!table) throw new TableNotFoundError('Alguna de las mesas elegidas no existe o está desactivada.');
      return table;
    });
    if (freeTables(picked, bookings, from, until).length !== picked.length) throw new TablesUnavailableError();
    return picked;
  }
}

export interface PublicBookInput {
  slug: string;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  notes?: string | null;
}

/** Reserva del cliente final desde la página pública. */
export class CreatePublicReservationUseCase {
  constructor(
    private readonly repos: { reservationSettings: Pick<ReservationSettingsRepository, 'findBySlug'> },
    private readonly plugins: PluginGate,
    private readonly booker: ReservationBooker,
  ) {}

  async execute(input: PublicBookInput): Promise<BookedReservation & { settings: ReservationSettings }> {
    const settings = await resolvePublicRestaurant(this.repos, this.plugins, input.slug);
    const booked = await this.booker.book(settings, {
      source: 'online',
      date: input.date,
      time: input.time,
      partySize: input.partySize,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      notes: input.notes,
    });
    return { ...booked, settings };
  }
}

export interface StaffBookInput {
  organizationId: string;
  establishmentId: string;
  userId: string;
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestEmail?: string | null;
  guestPhone: string;
  notes?: string | null;
  tableIds?: string[];
}

/** Reserva anotada por el personal (por teléfono o en persona). No exige que la página pública esté encendida. */
export class CreateStaffReservationUseCase {
  constructor(
    private readonly repos: { reservationSettings: Pick<ReservationSettingsRepository, 'findByEstablishment'> },
    private readonly booker: ReservationBooker,
  ) {}

  async execute(input: StaffBookInput): Promise<BookedReservation> {
    const settings = await settingsOrDefault(this.repos.reservationSettings, input.organizationId, input.establishmentId);
    return this.booker.book(settings, {
      source: 'staff',
      date: input.date,
      time: input.time,
      partySize: input.partySize,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      notes: input.notes,
      tableIds: input.tableIds,
      createdBy: input.userId,
    });
  }
}
