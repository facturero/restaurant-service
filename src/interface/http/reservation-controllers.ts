import type { Context } from 'hono';
import { ValidationError } from '../../domain/errors.js';
import type { ReservationSettingsPatch, ReservationStatus } from '../../domain/reservation.js';
import { RESERVATION_STATUSES } from '../../domain/reservation.js';
import type {
  GetPublicAvailabilityUseCase,
  GetPublicRestaurantUseCase,
  GetStaffAvailabilityUseCase,
} from '../../application/use-cases/availability-use-cases.js';
import type { CreatePublicReservationUseCase, CreateStaffReservationUseCase } from '../../application/use-cases/create-reservation.js';
import type {
  CancelReservationByTokenUseCase,
  CancelReservationUseCase,
  ChangeReservationStatusUseCase,
  GetReservationByTokenUseCase,
  GetReservationUseCase,
  ListReservationsUseCase,
} from '../../application/use-cases/reservation-management.js';
import type {
  GetReservationSettingsUseCase,
  SaveReservationSettingsUseCase,
} from '../../application/use-cases/reservation-settings-use-cases.js';
import type { ContextVariables } from './middlewares.js';
import { parseAvailabilityQuery } from './reservation-validators.js';
import {
  toAvailabilityJSON,
  toPublicReservationJSON,
  toPublicRestaurantJSON,
  toReservationJSON,
  toReservationSettingsJSON,
} from './reservation-serializers.js';

type Ctx = Context<{ Variables: ContextVariables }>;

// ── Personal (con sesión) ───────────────────────────────────────────────────

export function getReservationSettingsController(useCase: GetReservationSettingsUseCase) {
  return async (c: Ctx) => {
    const settings = await useCase.execute(c.get('organizationId'), c.req.param('establishmentId') ?? '');
    return c.json(toReservationSettingsJSON(settings), 200);
  };
}

export function saveReservationSettingsController(useCase: SaveReservationSettingsUseCase) {
  return async (c: Ctx) => {
    const patch = c.req.valid('json' as never) as ReservationSettingsPatch;
    const settings = await useCase.execute({
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
      patch,
    });
    return c.json(toReservationSettingsJSON(settings), 200);
  };
}

export function staffAvailabilityController(useCase: GetStaffAvailabilityUseCase) {
  return async (c: Ctx) => {
    const { date, partySize } = parseAvailabilityQuery({ date: c.req.query('date'), partySize: c.req.query('partySize') });
    const day = await useCase.execute({
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
      date,
      partySize,
    });
    return c.json(toAvailabilityJSON(day), 200);
  };
}

export function listReservationsController(useCase: ListReservationsUseCase) {
  return async (c: Ctx) => {
    const date = c.req.query('date') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ValidationError([{ field: 'date', message: 'La fecha debe tener el formato YYYY-MM-DD.' }]);
    }
    const days = c.req.query('days') ? Number(c.req.query('days')) : 1;
    if (!Number.isInteger(days) || days < 1) {
      throw new ValidationError([{ field: 'days', message: 'Los días deben ser un entero mayor que 0.' }]);
    }
    const statuses = (c.req.query('status') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = statuses.find((s) => !RESERVATION_STATUSES.includes(s as ReservationStatus));
    if (invalid) throw new ValidationError([{ field: 'status', message: `Estado no válido: ${invalid}.` }]);

    const views = await useCase.execute({
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
      date,
      days,
      statuses: statuses.length ? (statuses as ReservationStatus[]) : undefined,
    });
    return c.json(views.map(toReservationJSON), 200);
  };
}

export function createStaffReservationController(useCase: CreateStaffReservationUseCase) {
  return async (c: Ctx) => {
    const body = c.req.valid('json' as never) as {
      date: string;
      time: string;
      partySize: number;
      guestName: string;
      guestEmail?: string | null;
      guestPhone: string;
      notes?: string | null;
      tableIds?: string[];
    };
    const booked = await useCase.execute({
      ...body,
      organizationId: c.get('organizationId'),
      establishmentId: c.req.param('establishmentId') ?? '',
      userId: c.get('userId'),
    });
    return c.json(
      toReservationJSON({ reservation: booked.reservation, tables: booked.tables, timezone: booked.timezone }),
      201,
    );
  };
}

export function getReservationController(useCase: GetReservationUseCase) {
  return async (c: Ctx) => {
    const view = await useCase.execute(c.get('organizationId'), c.req.param('id') ?? '');
    return c.json(toReservationJSON(view), 200);
  };
}

export function changeReservationStatusController(useCase: ChangeReservationStatusUseCase) {
  return async (c: Ctx) => {
    const { status } = c.req.valid('json' as never) as { status: ReservationStatus };
    const view = await useCase.execute({
      organizationId: c.get('organizationId'),
      reservationId: c.req.param('id') ?? '',
      status,
    });
    return c.json(toReservationJSON(view), 200);
  };
}

export function cancelReservationController(useCase: CancelReservationUseCase) {
  return async (c: Ctx) => {
    const { reason } = c.req.valid('json' as never) as { reason?: string | null };
    const view = await useCase.execute({
      organizationId: c.get('organizationId'),
      reservationId: c.req.param('id') ?? '',
      reason,
    });
    return c.json(toReservationJSON(view), 200);
  };
}

// ── Público (sin sesión) ────────────────────────────────────────────────────
// Nada de esto lee el contexto de organización: la organización sale del enlace del restaurante o del token de la reserva.

function noStore(c: Context): void {
  // Disponibilidad y reservas cambian al instante: nada de cachés intermedias.
  c.header('Cache-Control', 'no-store');
}

export function publicRestaurantController(useCase: GetPublicRestaurantUseCase) {
  return async (c: Context) => {
    noStore(c);
    return c.json(toPublicRestaurantJSON(await useCase.execute(c.req.param('slug') ?? '')), 200);
  };
}

export function publicAvailabilityController(useCase: GetPublicAvailabilityUseCase) {
  return async (c: Context) => {
    noStore(c);
    const { date, partySize } = parseAvailabilityQuery({ date: c.req.query('date'), partySize: c.req.query('partySize') });
    const day = await useCase.execute({ slug: c.req.param('slug') ?? '', date, partySize });
    return c.json(toAvailabilityJSON(day), 200);
  };
}

export function publicCreateReservationController(useCase: CreatePublicReservationUseCase) {
  return async (c: Context) => {
    noStore(c);
    const body = c.req.valid('json' as never) as {
      date: string;
      time: string;
      partySize: number;
      guestName: string;
      guestEmail: string;
      guestPhone: string;
      notes?: string | null;
      website?: string;
    };
    // Campo trampa llenado: un robot. Se rechaza sin pistas sobre el motivo.
    if (body.website) throw new ValidationError([{ field: 'request', message: 'No se pudo procesar la solicitud.' }]);

    const booked = await useCase.execute({
      slug: c.req.param('slug') ?? '',
      date: body.date,
      time: body.time,
      partySize: body.partySize,
      guestName: body.guestName,
      guestEmail: body.guestEmail,
      guestPhone: body.guestPhone,
      notes: body.notes,
    });
    return c.json(
      {
        // El token es el "secreto" del enlace de la reserva: la página redirige a /r/<token>.
        token: booked.token,
        reservation: toPublicReservationJSON({
          view: { reservation: booked.reservation, tables: booked.tables, timezone: booked.timezone },
          restaurantName: booked.settings.displayName ?? '',
          restaurantPhone: booked.settings.contactPhone,
          restaurantSlug: booked.settings.publicSlug,
          timezone: booked.timezone,
          canCancel: true,
        }),
      },
      201,
    );
  };
}

export function publicGetReservationController(useCase: GetReservationByTokenUseCase) {
  return async (c: Context) => {
    noStore(c);
    return c.json(toPublicReservationJSON(await useCase.execute(c.req.param('token') ?? '')), 200);
  };
}

export function publicCancelReservationController(useCase: CancelReservationByTokenUseCase) {
  return async (c: Context) => {
    noStore(c);
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : null;
    return c.json(toPublicReservationJSON(await useCase.execute({ token: c.req.param('token') ?? '', reason })), 200);
  };
}
