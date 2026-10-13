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
  outbox: OutboxRepository;
}

export interface UnitOfWorkFactory {
  begin(): Promise<UnitOfWork>;
}
