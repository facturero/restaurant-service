import { z } from 'zod';
import { RESERVATION_STATUSES } from '../../domain/reservation.js';
import { ValidationError } from '../../domain/errors.js';

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:mm.');
const LOCAL_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.');
const nullableText = (max: number) => z.string().max(max).nullable();

export const reservationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    publicSlug: nullableText(60),
    displayName: nullableText(120),
    publicNote: nullableText(500),
    contactPhone: nullableText(40),
    notifyEmail: nullableText(160),
    maxDaysAhead: z.number().int(),
    minNoticeMinutes: z.number().int(),
    maxPartySize: z.number().int(),
    maxTablesPerReservation: z.number().int(),
  })
  .partial()
  .strict();

const guest = {
  date: LOCAL_DATE,
  time: TIME,
  partySize: z.number().int('Indica cuántas personas son.').min(1, 'Indica cuántas personas son.').max(500),
  guestName: z.string().trim().min(2, 'Escribe tu nombre.').max(120),
  guestPhone: z.string().trim().min(7, 'El teléfono no es válido.').max(40),
  notes: z.string().max(500).nullable().optional(),
};

/**
 * Reserva desde la página pública. `website` es un campo trampa: la página lo oculta y una persona nunca lo llena, un robot de
 * formularios sí. Si llega con algo se rechaza sin explicar por qué.
 */
export const publicCreateReservationSchema = z
  .object({
    ...guest,
    guestEmail: z.string().trim().min(3, 'El correo es obligatorio.').max(160),
    website: z.string().max(200).optional(),
  })
  .strict();

export const staffCreateReservationSchema = z
  .object({
    ...guest,
    // Por teléfono no siempre hay correo: sin él la reserva queda igual, solo que sin enlace ni aviso al cliente.
    guestEmail: z.string().trim().max(160).nullable().optional(),
    tableIds: z.array(z.string().uuid('La mesa no es válida.')).max(10).optional(),
  })
  .strict();

export const changeReservationStatusSchema = z
  .object({ status: z.enum(RESERVATION_STATUSES as [string, ...string[]]) })
  .strict();

export const cancelReservationSchema = z.object({ reason: z.string().max(300).nullable().optional() }).strict();

/** Lee `date` y `partySize` de la query. Se valida a mano para dar el mismo formato de error que el resto de la API. */
export function parseAvailabilityQuery(query: { date?: string; partySize?: string }): { date: string; partySize: number } {
  const details = [];
  const date = query.date ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) details.push({ field: 'date', message: 'La fecha debe tener el formato YYYY-MM-DD.' });
  const partySize = Number(query.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 500) {
    details.push({ field: 'partySize', message: 'Indica cuántas personas son.' });
  }
  if (details.length > 0) throw new ValidationError(details);
  return { date, partySize };
}
