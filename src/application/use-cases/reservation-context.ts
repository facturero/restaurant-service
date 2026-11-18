import type { AssignableTable } from '../../domain/availability.js';
import { addDays, localToUtc } from '../../domain/availability.js';
import type { DiningTable, EstablishmentSchedule, ScheduleException, ScheduleShift } from '../../domain/entities.js';
import { RestaurantNotFoundError, ScheduleNotFoundError } from '../../domain/errors.js';
import type { ReservationSettings } from '../../domain/reservation.js';
import type { DiningTableRepository, ReservationSettingsRepository, ScheduleRepository } from '../../domain/repositories.js';
import type { ExceptionInput, ShiftInput } from '../../domain/schedule.js';
import { toExceptionInput, toShiftInput } from '../schedule-inputs.js';
import type { PluginGate } from '../ports.js';

export const RESERVATIONS_PLUGIN = 'restaurant.reservations';

/** Todo lo que hace falta saber de un local para decidir qué se puede reservar. */
export interface BookingContext {
  settings: ReservationSettings;
  schedule: EstablishmentSchedule;
  shifts: ShiftInput[];
  exceptions: ExceptionInput[];
  /** Mesas activas, listas para asignar. */
  tables: AssignableTable[];
  /** Nombre de TODAS las mesas (también inactivas) para mostrar reservas viejas. */
  tableNames: Map<string, string>;
}

export function toAssignable(table: DiningTable): AssignableTable {
  return {
    id: table.id,
    name: table.name,
    floorId: table.floorId,
    zoneId: table.zoneId,
    capacityMin: table.capacityMin,
    capacityMax: table.capacityMax,
    xCm: table.xCm,
    yCm: table.yCm,
  };
}

interface ContextRepos {
  schedules: Pick<ScheduleRepository, 'findByEstablishment' | 'listShifts' | 'listExceptions'>;
  tables: Pick<DiningTableRepository, 'listByEstablishment'>;
}

/** Horario, mesas y ajustes de un local. `settings` ya viene cargado por quien llama (por id de local o por enlace). */
export async function loadBookingContext(
  repos: ContextRepos,
  settings: ReservationSettings,
): Promise<BookingContext> {
  const { organizationId, establishmentId } = settings;
  const schedule = await repos.schedules.findByEstablishment(organizationId, establishmentId);
  if (!schedule) throw new ScheduleNotFoundError();

  const [shifts, exceptions, allTables] = await Promise.all([
    repos.schedules.listShifts(organizationId, schedule.id),
    repos.schedules.listExceptions(organizationId, schedule.id),
    repos.tables.listByEstablishment(organizationId, establishmentId),
  ]);

  return {
    settings,
    schedule,
    shifts: shifts.map((s: ScheduleShift) => toShiftInput(s)),
    exceptions: exceptions.map((e: ScheduleException) => toExceptionInput(e)),
    tables: allTables.filter((t) => t.status === 'active').map(toAssignable),
    tableNames: new Map(allTables.map((t) => [t.id, t.name])),
  };
}

/**
 * Resuelve un restaurante por su enlace público. Cualquier razón para que no esté abierto
 * (no existe, está apagado, el módulo no está contratado) responde igual, «no encontrado»:
 * desde fuera no se debe poder averiguar qué locales existen ni qué módulos tienen.
 */
export async function resolvePublicRestaurant(
  repos: { reservationSettings: Pick<ReservationSettingsRepository, 'findBySlug'> },
  plugins: PluginGate,
  slug: string,
): Promise<ReservationSettings> {
  const settings = await repos.reservationSettings.findBySlug(slug.trim().toLowerCase());
  if (!settings || !settings.enabled) throw new RestaurantNotFoundError();
  if (!(await plugins.isActive(settings.organizationId, RESERVATIONS_PLUGIN))) throw new RestaurantNotFoundError();
  return settings;
}

/** Rango UTC [inicio, fin) de un día LOCAL del restaurante. */
export function localDayRange(date: string, timezone: string): { from: Date; to: Date } {
  return { from: localToUtc(date, '00:00', timezone), to: localToUtc(addDays(date, 1), '00:00', timezone) };
}
