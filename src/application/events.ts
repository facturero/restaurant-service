import { randomUUID } from 'node:crypto';
import type { DiningTable, EstablishmentSchedule, Floor, ScheduleException, Zone } from '../domain/entities.js';
import type { DomainEvent } from '../domain/repositories.js';

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
