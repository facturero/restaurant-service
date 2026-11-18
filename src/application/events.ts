import { randomUUID } from 'node:crypto';
import type { DiningTable, EstablishmentSchedule, Floor, ScheduleException, Zone } from '../domain/entities.js';
import type { DomainEvent } from '../domain/repositories.js';
import type { Reservation, ReservationSettings, ReservationStatus } from '../domain/reservation.js';
import { utcToLocal } from '../domain/availability.js';

/** Construye un DomainEvent con el envelope de bitácora (eventId/type/occurredAt). */
export function domainEvent(params: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    eventId: randomUUID(),
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    type: params.type,
    payload: {
      ...params.payload,
      // La bitácora exige organizationId en el payload de todo mensaje.
      organizationId: params.organizationId,
    },
    occurredAt: new Date(),
  };
}

export function floorCreatedEvent(floor: Floor): DomainEvent {
  return floorEvent('restaurant.floor.created', floor);
}

export function floorUpdatedEvent(floor: Floor, previous: { name: string; status: string }): DomainEvent {
  return floorEvent('restaurant.floor.updated', floor, { previous });
}

function floorEvent(type: string, floor: Floor, extra: Record<string, unknown> = {}): DomainEvent {
  return domainEvent({
    type,
    aggregateType: 'floor',
    aggregateId: floor.id,
    organizationId: floor.organizationId,
    payload: {
      floorId: floor.id,
      establishmentId: floor.establishmentId,
      name: floor.name,
      status: floor.status,
      ...extra,
    },
  });
}

export function floorPlanSavedEvent(
  floor: Floor,
  counts: { tableCount: number; wallCount: number; elementCount: number },
): DomainEvent {
  return domainEvent({
    type: 'restaurant.floor_plan.saved',
    aggregateType: 'floor',
    aggregateId: floor.id,
    organizationId: floor.organizationId,
    payload: {
      floorId: floor.id,
      establishmentId: floor.establishmentId,
      version: floor.layoutVersion,
      ...counts,
    },
  });
}

export function tableUpsertedEvent(table: DiningTable, establishmentId: string): DomainEvent {
  return domainEvent({
    type: 'restaurant.table.upserted',
    aggregateType: 'table',
    aggregateId: table.id,
    organizationId: table.organizationId,
    payload: {
      tableId: table.id,
      floorId: table.floorId,
      establishmentId,
      name: table.name,
      capacityMin: table.capacityMin,
      capacityMax: table.capacityMax,
      zoneId: table.zoneId,
      status: table.status,
    },
  });
}

export function zoneUpsertedEvent(zone: Zone): DomainEvent {
  return domainEvent({
    type: 'restaurant.zone.upserted',
    aggregateType: 'zone',
    aggregateId: zone.id,
    organizationId: zone.organizationId,
    payload: {
      zoneId: zone.id,
      floorId: zone.floorId,
      name: zone.name,
      color: zone.color,
      status: zone.status,
    },
  });
}

export function scheduleUpdatedEvent(schedule: EstablishmentSchedule, shiftCount: number): DomainEvent {
  return domainEvent({
    type: 'restaurant.schedule.updated',
    aggregateType: 'schedule',
    aggregateId: schedule.id,
    organizationId: schedule.organizationId,
    payload: {
      establishmentId: schedule.establishmentId,
      timezone: schedule.timezone,
      slotMinutes: schedule.slotMinutes,
      shiftCount,
    },
  });
}

export function scheduleExceptionCreatedEvent(exception: ScheduleException, establishmentId: string): DomainEvent {
  return exceptionEvent('restaurant.schedule_exception.created', exception, establishmentId);
}

export function scheduleExceptionDeletedEvent(exception: ScheduleException, establishmentId: string): DomainEvent {
  return exceptionEvent('restaurant.schedule_exception.deleted', exception, establishmentId);
}

function exceptionEvent(type: string, exception: ScheduleException, establishmentId: string): DomainEvent {
  return domainEvent({
    type,
    aggregateType: 'schedule',
    aggregateId: exception.scheduleId,
    organizationId: exception.organizationId,
    payload: {
      establishmentId,
      exceptionId: exception.id,
      onDate: exception.onDate,
      kind: exception.kind,
    },
  });
}

// ── Reservas ────────────────────────────────────────────────────────────────

export function reservationSettingsUpdatedEvent(settings: ReservationSettings): DomainEvent {
  return domainEvent({
    type: 'restaurant.reservation_settings.updated',
    aggregateType: 'reservation_settings',
    aggregateId: settings.id,
    organizationId: settings.organizationId,
    payload: {
      establishmentId: settings.establishmentId,
      enabled: settings.enabled,
      publicSlug: settings.publicSlug,
      maxDaysAhead: settings.maxDaysAhead,
      minNoticeMinutes: settings.minNoticeMinutes,
      maxPartySize: settings.maxPartySize,
      maxTablesPerReservation: settings.maxTablesPerReservation,
    },
  });
}

/** Lo que el correo necesita saber y la reserva sola no dice: el local, las mesas y los enlaces. */
export interface ReservationNoticeContext {
  restaurantName: string;
  restaurantPhone: string | null;
  /** Dónde se avisa al restaurante (correo de avisos del local). */
  notifyEmail: string | null;
  timezone: string;
  tableNames: string[];
  /** Enlace para ver o cancelar sin iniciar sesión. Solo existe en el momento de crear (el token no se guarda). */
  manageUrl?: string;
}

function noticePayload(reservation: Reservation, ctx: ReservationNoticeContext, noticeStaff: boolean): Record<string, unknown> {
  const local = utcToLocal(reservation.startsAt, ctx.timezone);
  const dateText = new Intl.DateTimeFormat('es-EC', {
    timeZone: ctx.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(reservation.startsAt);
  return {
    reservationId: reservation.id,
    establishmentId: reservation.establishmentId,
    code: reservation.code,
    status: reservation.status,
    source: reservation.source,
    guestName: reservation.guestName,
    // Cadena vacía (no null): la plantilla de correo la trata como «sin destinatario» y omite el envío al cliente.
    guestEmail: reservation.guestEmail ?? '',
    guestPhone: reservation.guestPhone,
    partySize: reservation.partySize,
    notes: reservation.notes ?? '',
    onDate: reservation.onDate,
    startsAt: reservation.startsAt.toISOString(),
    timeText: local.time,
    dateText,
    restaurantName: ctx.restaurantName,
    restaurantPhone: ctx.restaurantPhone ?? '',
    // Solo se avisa al restaurante de lo que NO hizo su propio personal: lo anotado por teléfono o cancelado desde el CRM ya lo sabe.
    staffNoticeEmail: noticeStaff ? (ctx.notifyEmail ?? '') : '',
    tableNames: ctx.tableNames.join(', '),
    manageUrl: ctx.manageUrl ?? '',
  };
}

export function reservationCreatedEvent(reservation: Reservation, ctx: ReservationNoticeContext): DomainEvent {
  return domainEvent({
    type: 'restaurant.reservation.created',
    aggregateType: 'reservation',
    aggregateId: reservation.id,
    organizationId: reservation.organizationId,
    payload: noticePayload(reservation, ctx, reservation.source === 'online'),
  });
}

export function reservationCancelledEvent(reservation: Reservation, ctx: ReservationNoticeContext): DomainEvent {
  return domainEvent({
    type: 'restaurant.reservation.cancelled',
    aggregateType: 'reservation',
    aggregateId: reservation.id,
    organizationId: reservation.organizationId,
    payload: {
      ...noticePayload(reservation, ctx, reservation.cancelledBy === 'guest'),
      cancelledBy: reservation.cancelledBy,
      cancelReason: reservation.cancelReason ?? '',
    },
  });
}

export function reservationStatusChangedEvent(reservation: Reservation, previous: ReservationStatus): DomainEvent {
  return domainEvent({
    type: 'restaurant.reservation.status_changed',
    aggregateType: 'reservation',
    aggregateId: reservation.id,
    organizationId: reservation.organizationId,
    payload: {
      reservationId: reservation.id,
      establishmentId: reservation.establishmentId,
      code: reservation.code,
      previous,
      status: reservation.status,
    },
  });
}
