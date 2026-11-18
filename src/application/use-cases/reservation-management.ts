import { addDays } from '../../domain/availability.js';
import { ReservationNotFoundError, ValidationError } from '../../domain/errors.js';
import {
  hashCancelToken,
  RESERVATION_STATUSES,
  type Reservation,
  type ReservationStatus,
} from '../../domain/reservation.js';
import type {
  DiningTableRepository,
  ReservationRepository,
  ReservationSettingsRepository,
  ScheduleRepository,
} from '../../domain/repositories.js';
import { reservationCancelledEvent, reservationStatusChangedEvent } from '../events.js';
import type { Clock, UnitOfWorkGateway } from '../ports.js';
import { noticeContext } from './create-reservation.js';
import { loadBookingContext, localDayRange, type BookingContext } from './reservation-context.js';
import { settingsOrDefault } from './reservation-settings-use-cases.js';

export interface ReservationView {
  reservation: Reservation;
  tables: Array<{ id: string; name: string }>;
  /** Zona del local: la hora de la reserva se muestra siempre en la hora del restaurante, no en la del servidor ni la del navegador. */
  timezone: string;
}

interface ReadRepos {
  reservationSettings: ReservationSettingsRepository;
  reservations: ReservationRepository;
  schedules: Pick<ScheduleRepository, 'findByEstablishment' | 'listShifts' | 'listExceptions'>;
  tables: Pick<DiningTableRepository, 'listByEstablishment'>;
}

async function withTables(
  repos: Pick<ReadRepos, 'reservations'>,
  ctx: BookingContext,
  reservations: Reservation[],
): Promise<ReservationView[]> {
  if (reservations.length === 0) return [];
  const byReservation = await repos.reservations.tableIdsFor(
    ctx.settings.organizationId,
    reservations.map((r) => r.id),
  );
  return reservations.map((reservation) => ({
    reservation,
    tables: (byReservation.get(reservation.id) ?? []).map((id) => ({ id, name: ctx.tableNames.get(id) ?? '—' })),
    timezone: ctx.schedule.timezone,
  }));
}

const MAX_RANGE_DAYS = 31;

/** Las reservas de un día (o de los siguientes `days`), por hora de inicio. */
export class ListReservationsUseCase {
  constructor(private readonly repos: ReadRepos) {}

  async execute(input: {
    organizationId: string;
    establishmentId: string;
    /** Día LOCAL del restaurante, `YYYY-MM-DD`. */
    date: string;
    days?: number;
    statuses?: ReservationStatus[];
  }): Promise<ReservationView[]> {
    const days = Math.min(Math.max(input.days ?? 1, 1), MAX_RANGE_DAYS);
    const settings = await settingsOrDefault(this.repos.reservationSettings, input.organizationId, input.establishmentId);
    const ctx = await loadBookingContext(this.repos, settings);
    const first = localDayRange(input.date, ctx.schedule.timezone).from;
    const last = localDayRange(addDays(input.date, days - 1), ctx.schedule.timezone).to;
    const list = await this.repos.reservations.listByRange(input.organizationId, input.establishmentId, first, last, {
      statuses: input.statuses,
    });
    return withTables(this.repos, ctx, list);
  }
}

async function contextFor(repos: ReadRepos, reservation: Reservation): Promise<BookingContext> {
  const settings = await settingsOrDefault(repos.reservationSettings, reservation.organizationId, reservation.establishmentId);
  return loadBookingContext(repos, settings);
}

export class GetReservationUseCase {
  constructor(private readonly repos: ReadRepos) {}

  async execute(organizationId: string, reservationId: string): Promise<ReservationView> {
    const reservation = await this.repos.reservations.findById(organizationId, reservationId);
    if (!reservation) throw new ReservationNotFoundError();
    const ctx = await contextFor(this.repos, reservation);
    return (await withTables(this.repos, ctx, [reservation]))[0]!;
  }
}

/** Cambios de estado del personal que no son cancelar: sentar, terminar, «no se presentó». */
export class ChangeReservationStatusUseCase {
  constructor(
    private readonly uow: UnitOfWorkGateway,
    private readonly repos: ReadRepos,
  ) {}

  async execute(input: { organizationId: string; reservationId: string; status: ReservationStatus }): Promise<ReservationView> {
    if (!RESERVATION_STATUSES.includes(input.status)) {
      throw new ValidationError([{ field: 'status', message: 'Estado de reserva no válido.' }]);
    }

    const uow = await this.uow.begin();
    try {
      const reservation = await uow.reservations.findById(input.organizationId, input.reservationId);
      if (!reservation) throw new ReservationNotFoundError();

      const previous = reservation.status;
      reservation.changeStatus(input.status);
      await uow.reservations.save(reservation);
      // Al terminar o no presentarse, las mesas quedan libres para la siguiente reserva.
      if (!reservation.isActive()) await uow.reservations.releaseTables(reservation.id);
      await uow.outbox.add(reservationStatusChangedEvent(reservation, previous));

      await uow.commit();
      const ctx = await contextFor(this.repos, reservation);
      return (await withTables(this.repos, ctx, [reservation]))[0]!;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

/** Cancela una reserva y libera sus mesas. Lo usan el personal (por id) y el cliente (por el token de su enlace). */
class Canceller {
  constructor(
    private readonly uow: UnitOfWorkGateway,
    private readonly repos: ReadRepos,
    private readonly clock: Clock,
  ) {}

  async cancel(
    find: (uow: Awaited<ReturnType<UnitOfWorkGateway['begin']>>) => Promise<Reservation | null>,
    by: 'guest' | 'staff',
    reason: string | null,
  ): Promise<ReservationView> {
    const uow = await this.uow.begin();
    try {
      const reservation = await find(uow);
      if (!reservation) throw new ReservationNotFoundError();

      reservation.cancel(by, reason, this.clock());
      await uow.reservations.save(reservation);
      await uow.reservations.releaseTables(reservation.id);

      const ctx = await contextFor(this.repos, reservation);
      const views = await withTables(this.repos, ctx, [reservation]);
      await uow.outbox.add(reservationCancelledEvent(reservation, noticeContext(ctx, views[0]!.tables.map((t) => t.name))));

      await uow.commit();
      return views[0]!;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}

export class CancelReservationUseCase {
  private readonly canceller: Canceller;

  constructor(uow: UnitOfWorkGateway, repos: ReadRepos, clock: Clock) {
    this.canceller = new Canceller(uow, repos, clock);
  }

  execute(input: { organizationId: string; reservationId: string; reason?: string | null }): Promise<ReservationView> {
    return this.canceller.cancel((uow) => uow.reservations.findById(input.organizationId, input.reservationId), 'staff', input.reason ?? null);
  }
}

/** Lo que ve el cliente en la página de su reserva (enlace del correo). */
export interface PublicReservationView {
  view: ReservationView;
  restaurantName: string;
  restaurantPhone: string | null;
  /** Enlace público del restaurante: para ofrecer «reservar de nuevo» desde la página de la reserva. */
  restaurantSlug: string | null;
  timezone: string;
  /** ¿Puede cancelar todavía? (vigente y antes de la hora). */
  canCancel: boolean;
}

async function publicView(repos: ReadRepos, reservation: Reservation, now: Date): Promise<PublicReservationView> {
  const ctx = await contextFor(repos, reservation);
  const [view] = await withTables(repos, ctx, [reservation]);
  return {
    view: view!,
    restaurantName: ctx.settings.displayName ?? '',
    restaurantPhone: ctx.settings.contactPhone,
    restaurantSlug: ctx.settings.publicSlug,
    timezone: ctx.schedule.timezone,
    canCancel: reservation.canTransitionTo('cancelled') && reservation.startsAt.getTime() > now.getTime(),
  };
}

export class GetReservationByTokenUseCase {
  constructor(
    private readonly repos: ReadRepos,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<PublicReservationView> {
    const reservation = await this.repos.reservations.findByTokenHash(hashCancelToken(token));
    if (!reservation) throw new ReservationNotFoundError();
    return publicView(this.repos, reservation, this.clock());
  }
}

export class CancelReservationByTokenUseCase {
  private readonly canceller: Canceller;

  constructor(
    uow: UnitOfWorkGateway,
    private readonly repos: ReadRepos,
    private readonly clock: Clock,
  ) {
    this.canceller = new Canceller(uow, repos, clock);
  }

  async execute(input: { token: string; reason?: string | null }): Promise<PublicReservationView> {
    const hash = hashCancelToken(input.token);
    const cancelled = await this.canceller.cancel((uow) => uow.reservations.findByTokenHash(hash), 'guest', input.reason ?? null);
    return publicView(this.repos, cancelled.reservation, this.clock());
  }
}
