import type { TableBooking } from './availability.js';
import type { Reservation, ReservationSettings, ReservationStatus } from './reservation.js';
import type {
  DiningTable,
  EntityStatus,
  EstablishmentSchedule,
  Floor,
  ScheduleException,
  ScheduleShift,
  Zone,
} from './entities.js';

export interface TableListFilters {
  floorId?: string;
  zoneId?: string;
  status?: EntityStatus;
}

export interface FloorRepository {
  findById(organizationId: string, floorId: string): Promise<Floor | null>;
  listByEstablishment(organizationId: string, establishmentId: string): Promise<Floor[]>;
  findFirstByEstablishment(organizationId: string, establishmentId: string): Promise<Floor | null>;
  existsByName(organizationId: string, establishmentId: string, name: string, excludeId?: string): Promise<boolean>;
  save(floor: Floor): Promise<void>;
}

export interface ZoneRepository {
  findById(organizationId: string, zoneId: string): Promise<Zone | null>;
  listByFloor(organizationId: string, floorId: string): Promise<Zone[]>;
  existsByName(organizationId: string, floorId: string, name: string, excludeId?: string): Promise<boolean>;
  save(zone: Zone): Promise<void>;
  saveMany(zones: Zone[]): Promise<void>;
}

export interface DiningTableRepository {
  findById(organizationId: string, tableId: string): Promise<DiningTable | null>;
  listByFloor(organizationId: string, floorId: string, filters?: TableListFilters): Promise<DiningTable[]>;
  listByEstablishment(organizationId: string, establishmentId: string, filters?: TableListFilters): Promise<DiningTable[]>;
  /** Solo entre mesas ACTIVAS: una mesa desactivada libera su nombre. */
  existsByName(organizationId: string, floorId: string, name: string, excludeId?: string): Promise<boolean>;
  save(table: DiningTable): Promise<void>;
  saveMany(tables: DiningTable[]): Promise<void>;
}

export interface ScheduleRepository {
  findByEstablishment(organizationId: string, establishmentId: string): Promise<EstablishmentSchedule | null>;
  /** Necesario para enlazar una excepción con su horario cuando la ruta de
   *  borrado no trae el establecimiento. */
  findById(organizationId: string, scheduleId: string): Promise<EstablishmentSchedule | null>;
  save(schedule: EstablishmentSchedule): Promise<void>;
  listShifts(organizationId: string, scheduleId: string): Promise<ScheduleShift[]>;
  /** Reemplaza TODOS los turnos del horario (borra e inserta en la misma transacción). */
  replaceShifts(organizationId: string, scheduleId: string, shifts: ScheduleShift[]): Promise<void>;
  listExceptions(organizationId: string, scheduleId: string): Promise<ScheduleException[]>;
  findExceptionById(organizationId: string, exceptionId: string): Promise<ScheduleException | null>;
  findExceptionByDate(organizationId: string, scheduleId: string, onDate: string): Promise<ScheduleException | null>;
  saveException(exception: ScheduleException): Promise<void>;
  deleteException(organizationId: string, exceptionId: string): Promise<void>;
}

export interface ReservationSettingsRepository {
  findByEstablishment(organizationId: string, establishmentId: string): Promise<ReservationSettings | null>;
  /** Pública: el enlace es único en todo el sistema, no por organización. */
  findBySlug(slug: string): Promise<ReservationSettings | null>;
  slugTaken(slug: string, excludeId?: string): Promise<boolean>;
  save(settings: ReservationSettings): Promise<void>;
}

export interface ReservationListFilters {
  statuses?: ReservationStatus[];
}

export interface ReservationRepository {
  /** Inserta o actualiza por clave primaria (nunca `upsert`: ver `persistence-guard.test.ts`). */
  save(reservation: Reservation): Promise<void>;
  findById(organizationId: string, reservationId: string): Promise<Reservation | null>;
  /** Pública: se busca por el hash del token del enlace, sin organización. */
  findByTokenHash(hash: string): Promise<Reservation | null>;
  /** Reservas cuyo inicio cae en [from, to). */
  listByRange(
    organizationId: string,
    establishmentId: string,
    from: Date,
    to: Date,
    filters?: ReservationListFilters,
  ): Promise<Reservation[]>;
  /** Mesas asignadas a cada reserva (aunque ya estén liberadas: es el historial). */
  tableIdsFor(organizationId: string, reservationIds: string[]): Promise<Map<string, string[]>>;
  /** Bloquea esas mesas en el intervalo de la reserva. */
  assignTables(reservation: Reservation, tableIds: string[]): Promise<void>;
  /** Libera las mesas (cancelada, terminada, no se presentó): la reserva conserva el historial. */
  releaseTables(reservationId: string): Promise<void>;
  /** Bloqueo pesimista de las mesas candidatas, en orden estable: serializa a quienes piden la misma mesa a la vez. */
  lockTables(organizationId: string, tableIds: string[]): Promise<void>;
  /** Ocupación activa de esas mesas que se cruza con [from, until). */
  activeBookings(organizationId: string, tableIds: string[], from: Date, until: Date): Promise<TableBooking[]>;
  /** Reservas vigentes (activas y por venir) de un mismo correo o teléfono en el local: freno contra reservas falsas. */
  countUpcomingByGuest(
    organizationId: string,
    establishmentId: string,
    guest: { email?: string | null; phone: string },
    now: Date,
  ): Promise<number>;
}

/** Evento de dominio saliente: se persiste en `outbox_messages` y el relay lo
 *  publica a RabbitMQ. El payload debe ser plano y serializable. */
export interface DomainEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface OutboxRepository {
  add(event: DomainEvent): Promise<void>;
}

/** Unidad de trabajo: todos los repositorios comparten la misma transacción. */
export interface UnitOfWork {
  floors: FloorRepository;
  zones: ZoneRepository;
  tables: DiningTableRepository;
  schedules: ScheduleRepository;
  reservationSettings: ReservationSettingsRepository;
  reservations: ReservationRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWorkFactory {
  begin(): Promise<UnitOfWork>;
}
