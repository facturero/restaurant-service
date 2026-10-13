import type { DiningTable, EstablishmentSchedule, Floor, ScheduleException, ScheduleShift, Zone } from '../../domain/entities.js';
import type { ScheduleView } from '../../application/use-cases/schedule-use-cases.js';
import type { FloorPlan } from '../../application/use-cases/floor-queries.js';
import type { SlotsPreview } from '../../application/use-cases/preview-slots.js';

/** Entidad → JSON del openapi. Serializar aquí mantiene el contrato fuera del
 *  dominio. Las fechas salen como ISO y las horas como 'HH:mm'. */

export function toFloorJSON(f: Floor) {
  return {
    id: f.id,
    organizationId: f.organizationId,
    establishmentId: f.establishmentId,
    name: f.name,
    widthCm: f.widthCm,
    heightCm: f.heightCm,
    sortOrder: f.sortOrder,
    status: f.status,
    layoutVersion: f.layoutVersion,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function toZoneJSON(z: Zone) {
  return {
    id: z.id,
    organizationId: z.organizationId,
    floorId: z.floorId,
    name: z.name,
    color: z.color,
    status: z.status,
    createdAt: z.createdAt.toISOString(),
    updatedAt: z.updatedAt.toISOString(),
  };
}

export function toTableJSON(t: DiningTable) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    floorId: t.floorId,
    zoneId: t.zoneId,
    name: t.name,
    capacityMin: t.capacityMin,
    capacityMax: t.capacityMax,
    xCm: t.xCm,
    yCm: t.yCm,
    widthCm: t.widthCm,
    heightCm: t.heightCm,
    shape: t.shape,
    rotationDeg: t.rotationDeg,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toFloorPlanJSON(plan: FloorPlan) {
  return {
    floor: toFloorJSON(plan.floor),
    zones: plan.zones.map(toZoneJSON),
    tables: plan.tables.map(toTableJSON),
    layout: { version: plan.layout.version, elements: plan.layout.elements },
  };
}

export function toScheduleJSON(s: EstablishmentSchedule) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    establishmentId: s.establishmentId,
    timezone: s.timezone,
    slotMinutes: s.slotMinutes,
    cleanupMinutes: s.cleanupMinutes,
    durationByPartySize: s.durationByPartySize,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toShiftJSON(s: ScheduleShift) {
  return {
    id: s.id,
    weekday: s.weekday,
    opensAt: s.opensAt,
    closesAt: s.closesAt,
    label: s.label,
  };
}

export function toExceptionJSON(e: ScheduleException) {
  return {
    id: e.id,
    onDate: e.onDate,
    kind: e.kind,
    opensAt: e.opensAt,
    closesAt: e.closesAt,
    reason: e.reason,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toScheduleViewJSON(view: ScheduleView) {
  return {
    schedule: toScheduleJSON(view.schedule),
    shifts: view.shifts.map(toShiftJSON),
    exceptions: view.exceptions.map(toExceptionJSON),
  };
}

export function toSlotsPreviewJSON(preview: SlotsPreview) {
  return { date: preview.date, timezone: preview.timezone, slots: preview.slots };
}
