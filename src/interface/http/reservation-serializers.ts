import type { DayAvailability } from '../../domain/availability.js';
import { utcToLocal } from '../../domain/availability.js';
import type { ReservationSettings } from '../../domain/reservation.js';
import type { PublicRestaurantInfo } from '../../application/use-cases/availability-use-cases.js';
import type { PublicReservationView, ReservationView } from '../../application/use-cases/reservation-management.js';

export function toReservationSettingsJSON(s: ReservationSettings) {
  return {
    id: s.id,
    establishmentId: s.establishmentId,
    enabled: s.enabled,
    publicSlug: s.publicSlug,
    displayName: s.displayName,
    publicNote: s.publicNote,
    contactPhone: s.contactPhone,
    notifyEmail: s.notifyEmail,
    maxDaysAhead: s.maxDaysAhead,
    minNoticeMinutes: s.minNoticeMinutes,
    maxPartySize: s.maxPartySize,
    maxTablesPerReservation: s.maxTablesPerReservation,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Vista del personal: lleva todo, incluidos contacto y notas. */
export function toReservationJSON(view: ReservationView) {
  const r = view.reservation;
  return {
    id: r.id,
    establishmentId: r.establishmentId,
    code: r.code,
    status: r.status,
    source: r.source,
    guestName: r.guestName,
    guestEmail: r.guestEmail,
    guestPhone: r.guestPhone,
    partySize: r.partySize,
    date: r.onDate,
    time: utcToLocal(r.startsAt, view.timezone).time,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    notes: r.notes,
    tables: view.tables,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelledBy: r.cancelledBy,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toAvailabilityJSON(day: DayAvailability) {
  return {
    date: day.date,
    status: day.status,
    slots: day.slots.map((s) => ({
      time: s.time,
      startsAt: s.startsAt.toISOString(),
      shiftLabel: s.shiftLabel,
      available: s.available,
      ...(s.reason ? { reason: s.reason } : {}),
    })),
  };
}

export function toPublicRestaurantJSON(info: PublicRestaurantInfo) {
  return info;
}

/**
 * Lo único que ve alguien con el enlace de una reserva. No lleva el correo, el teléfono ni las notas internas: si el enlace se
 * reenvía o se filtra, no debe regalar datos de contacto de nadie.
 */
export function toPublicReservationJSON(v: PublicReservationView) {
  const r = v.view.reservation;
  return {
    code: r.code,
    status: r.status,
    guestName: r.guestName,
    partySize: r.partySize,
    date: r.onDate,
    time: utcToLocal(r.startsAt, v.timezone).time,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    timezone: v.timezone,
    restaurant: { name: v.restaurantName, phone: v.restaurantPhone, slug: v.restaurantSlug },
    canCancel: v.canCancel,
    cancelledBy: r.cancelledBy,
  };
}
