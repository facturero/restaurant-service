import { randomUUID } from 'node:crypto';
import { ValidationError, type ErrorDetail } from './errors.js';
import {
  DEFAULT_CLEANUP_MINUTES,
  DEFAULT_DURATION_BY_PARTY_SIZE,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TIMEZONE,
  isTime,
  validateSchedule,
  type PartyDuration,
} from './schedule.js';

export type EntityStatus = 'active' | 'inactive';
export type TableShape = 'rect' | 'round';
export type ScheduleExceptionKind = 'closed' | 'special_hours';
export type ZoneColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error';

/** Tokens del tema, nunca hexadecimales: el frontend pinta `rgb(var(--v-theme-<token>))`. */
export const ZONE_COLORS: ZoneColor[] = ['primary', 'secondary', 'success', 'info', 'warning', 'error'];
export const TABLE_ROTATIONS = [0, 90, 180, 270];

const FLOOR_MIN_CM = 300;
const FLOOR_MAX_CM = 100_000;
const TABLE_MIN_CM = 30;
const TABLE_MAX_CM = 600;

function trimmed(value: string): string {
  return value.trim();
}

// ── Floor ───────────────────────────────────────────────────────────────────

export interface FloorProps {
  id: string;
  organizationId: string;
  establishmentId: string;
  name: string;
  widthCm: number | null;
  heightCm: number | null;
  sortOrder: number;
  status: EntityStatus;
  layoutVersion: number;
  layoutElements: unknown[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Floor {
  private constructor(private props: FloorProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    establishmentId: string;
    name: string;
    widthCm?: number | null;
    heightCm?: number | null;
    sortOrder?: number;
  }): Floor {
    const now = new Date();
    const floor = new Floor({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      name: trimmed(params.name),
      widthCm: params.widthCm ?? null,
      heightCm: params.heightCm ?? null,
      sortOrder: params.sortOrder ?? 0,
      status: 'active',
      layoutVersion: 0,
      layoutElements: null,
      createdAt: now,
      updatedAt: now,
    });
    floor.validate();
    return floor;
  }

  static fromPersistence(props: FloorProps): Floor {
    return new Floor({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get establishmentId(): string { return this.props.establishmentId; }
  get name(): string { return this.props.name; }
  get widthCm(): number | null { return this.props.widthCm; }
  get heightCm(): number | null { return this.props.heightCm; }
  get sortOrder(): number { return this.props.sortOrder; }
  get status(): EntityStatus { return this.props.status; }
  get layoutVersion(): number { return this.props.layoutVersion; }
  get layoutElements(): unknown[] | null { return this.props.layoutElements; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  update(params: { name?: string; widthCm?: number | null; heightCm?: number | null; sortOrder?: number; status?: EntityStatus }): void {
    if (params.name !== undefined) this.props.name = trimmed(params.name);
    if (params.widthCm !== undefined) this.props.widthCm = params.widthCm;
    if (params.heightCm !== undefined) this.props.heightCm = params.heightCm;
    if (params.sortOrder !== undefined) this.props.sortOrder = params.sortOrder;
    if (params.status !== undefined) this.props.status = params.status;
    this.validate();
    this.props.updatedAt = new Date();
  }

  deactivate(): void {
    this.props.status = 'inactive';
    this.props.updatedAt = new Date();
  }

  /** Guarda el dibujo y sube la versión de uno en uno (bloqueo optimista). */
  recordLayout(elements: unknown[]): void {
    this.props.layoutElements = elements;
    this.props.layoutVersion += 1;
    this.props.updatedAt = new Date();
  }

  toPersistence(): FloorProps {
    return { ...this.props };
  }

  private validate(): void {
    const details: ErrorDetail[] = [];
    if (this.props.name.length < 1 || this.props.name.length > 80) {
      details.push({ field: 'name', message: 'El nombre de la planta debe tener entre 1 y 80 caracteres.' });
    }
    for (const dimension of ['widthCm', 'heightCm'] as const) {
      const value = this.props[dimension];
      if (value !== null && (!Number.isInteger(value) || value < FLOOR_MIN_CM || value > FLOOR_MAX_CM)) {
        details.push({ field: dimension, message: `La medida debe estar entre ${FLOOR_MIN_CM / 100} y ${FLOOR_MAX_CM / 100} m.` });
      }
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}

// ── Zone ────────────────────────────────────────────────────────────────────

export interface ZoneProps {
  id: string;
  organizationId: string;
  floorId: string;
  name: string;
  color: ZoneColor;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Zone {
  private constructor(private props: ZoneProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    floorId: string;
    name: string;
    color?: ZoneColor;
  }): Zone {
    const now = new Date();
    const zone = new Zone({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      floorId: params.floorId,
      name: trimmed(params.name),
      color: params.color ?? 'primary',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    zone.validate();
    return zone;
  }

  static fromPersistence(props: ZoneProps): Zone {
    return new Zone({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get floorId(): string { return this.props.floorId; }
  get name(): string { return this.props.name; }
  get color(): ZoneColor { return this.props.color; }
  get status(): EntityStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  update(params: { name?: string; color?: ZoneColor; status?: EntityStatus }): void {
    if (params.name !== undefined) this.props.name = trimmed(params.name);
    if (params.color !== undefined) this.props.color = params.color;
    if (params.status !== undefined) this.props.status = params.status;
    this.validate();
    this.props.updatedAt = new Date();
  }

  deactivate(): void {
    this.props.status = 'inactive';
    this.props.updatedAt = new Date();
  }

  toPersistence(): ZoneProps {
    return { ...this.props };
  }

  private validate(): void {
    const details: ErrorDetail[] = [];
    if (this.props.name.length < 1 || this.props.name.length > 60) {
      details.push({ field: 'name', message: 'El nombre de la zona debe tener entre 1 y 60 caracteres.' });
    }
    if (!ZONE_COLORS.includes(this.props.color)) {
      details.push({ field: 'color', message: `El color debe ser un token del tema: ${ZONE_COLORS.join(', ')}.` });
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}

// ── DiningTable ─────────────────────────────────────────────────────────────

export interface DiningTableProps {
  id: string;
  organizationId: string;
  floorId: string;
  zoneId: string | null;
  name: string;
  capacityMin: number;
  capacityMax: number;
  xCm: number | null;
  yCm: number | null;
  widthCm: number;
  heightCm: number;
  shape: TableShape;
  rotationDeg: number;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class DiningTable {
  private constructor(private props: DiningTableProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    floorId: string;
    zoneId?: string | null;
    name: string;
    capacityMin: number;
    capacityMax: number;
    xCm?: number | null;
    yCm?: number | null;
    widthCm?: number;
    heightCm?: number;
    shape?: TableShape;
    rotationDeg?: number;
  }): DiningTable {
    const now = new Date();
    const shape = params.shape ?? 'rect';
    const widthCm = params.widthCm ?? (shape === 'round' ? 100 : 80);
    const table = new DiningTable({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      floorId: params.floorId,
      zoneId: params.zoneId ?? null,
      name: trimmed(params.name),
      capacityMin: params.capacityMin,
      capacityMax: params.capacityMax,
      xCm: params.xCm ?? null,
      yCm: params.yCm ?? null,
      widthCm,
      // Una mesa redonda tiene diámetro único: el alto sigue al ancho.
      heightCm: shape === 'round' ? widthCm : params.heightCm ?? 80,
      shape,
      rotationDeg: params.rotationDeg ?? 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    table.validate();
    return table;
  }

  static fromPersistence(props: DiningTableProps): DiningTable {
    return new DiningTable({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get floorId(): string { return this.props.floorId; }
  get zoneId(): string | null { return this.props.zoneId; }
  get name(): string { return this.props.name; }
  get capacityMin(): number { return this.props.capacityMin; }
  get capacityMax(): number { return this.props.capacityMax; }
  get xCm(): number | null { return this.props.xCm; }
  get yCm(): number | null { return this.props.yCm; }
  get widthCm(): number { return this.props.widthCm; }
  get heightCm(): number { return this.props.heightCm; }
  get shape(): TableShape { return this.props.shape; }
  get rotationDeg(): number { return this.props.rotationDeg; }
  get status(): EntityStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  update(params: {
    name?: string;
    capacityMin?: number;
    capacityMax?: number;
    zoneId?: string | null;
    xCm?: number | null;
    yCm?: number | null;
    widthCm?: number;
    heightCm?: number;
    shape?: TableShape;
    rotationDeg?: number;
    status?: EntityStatus;
  }): void {
    if (params.name !== undefined) this.props.name = trimmed(params.name);
    if (params.capacityMin !== undefined) this.props.capacityMin = params.capacityMin;
    if (params.capacityMax !== undefined) this.props.capacityMax = params.capacityMax;
    if (params.zoneId !== undefined) this.props.zoneId = params.zoneId;
    if (params.xCm !== undefined) this.props.xCm = params.xCm;
    if (params.yCm !== undefined) this.props.yCm = params.yCm;
    if (params.shape !== undefined) this.props.shape = params.shape;
    if (params.widthCm !== undefined) this.props.widthCm = params.widthCm;
    if (params.heightCm !== undefined) this.props.heightCm = params.heightCm;
    if (params.rotationDeg !== undefined) this.props.rotationDeg = params.rotationDeg;
    if (params.status !== undefined) this.props.status = params.status;
    if (this.props.shape === 'round') this.props.heightCm = this.props.widthCm;
    this.validate();
    this.props.updatedAt = new Date();
  }

  /** Las mesas NUNCA se borran: en el entregable 2 las reservas apuntan a ellas. */
  deactivate(): void {
    this.props.status = 'inactive';
    this.props.updatedAt = new Date();
  }

  activate(): void {
    this.props.status = 'active';
    this.props.updatedAt = new Date();
  }

  toPersistence(): DiningTableProps {
    return { ...this.props };
  }

  private validate(): void {
    const details: ErrorDetail[] = [];
    if (this.props.name.length < 1 || this.props.name.length > 60) {
      details.push({ field: 'name', message: 'El nombre de la mesa debe tener entre 1 y 60 caracteres.' });
    }
    if (!Number.isInteger(this.props.capacityMin) || this.props.capacityMin < 1) {
      details.push({ field: 'capacityMin', message: 'La capacidad mínima debe ser al menos 1.' });
    }
    if (!Number.isInteger(this.props.capacityMax) || this.props.capacityMax < this.props.capacityMin) {
      details.push({ field: 'capacityMax', message: 'La capacidad máxima no puede ser menor que la mínima.' });
    }
    if (this.props.capacityMax > 50) {
      details.push({ field: 'capacityMax', message: 'La capacidad máxima son 50 personas.' });
    }
    if (!TABLE_ROTATIONS.includes(this.props.rotationDeg)) {
      details.push({ field: 'rotationDeg', message: 'El giro solo puede ser 0, 90, 180 o 270 grados.' });
    }
    for (const dimension of ['widthCm', 'heightCm'] as const) {
      const value = this.props[dimension];
      if (!Number.isInteger(value) || value < TABLE_MIN_CM || value > TABLE_MAX_CM) {
        details.push({ field: dimension, message: `La medida debe estar entre ${TABLE_MIN_CM} y ${TABLE_MAX_CM} cm.` });
      }
    }
    if (this.props.shape === 'round' && this.props.heightCm !== this.props.widthCm) {
      details.push({ field: 'heightCm', message: 'Una mesa redonda tiene el mismo ancho y alto (diámetro).' });
    }
    if ((this.props.xCm === null) !== (this.props.yCm === null)) {
      details.push({ field: 'yCm', message: 'La posición debe tener x e y, o ninguna de las dos.' });
    }
    for (const axis of ['xCm', 'yCm'] as const) {
      const value = this.props[axis];
      if (value !== null && !Number.isInteger(value)) {
        details.push({ field: axis, message: 'La posición se expresa en centímetros enteros.' });
      }
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}

// ── EstablishmentSchedule ───────────────────────────────────────────────────

export interface EstablishmentScheduleProps {
  id: string;
  organizationId: string;
  establishmentId: string;
  timezone: string;
  slotMinutes: number;
  cleanupMinutes: number;
  durationByPartySize: PartyDuration[];
  createdAt: Date;
  updatedAt: Date;
}

export class EstablishmentSchedule {
  private constructor(private props: EstablishmentScheduleProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    establishmentId: string;
    timezone?: string;
    slotMinutes?: number;
    cleanupMinutes?: number;
    durationByPartySize?: PartyDuration[];
  }): EstablishmentSchedule {
    const now = new Date();
    const schedule = new EstablishmentSchedule({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      timezone: params.timezone ?? DEFAULT_TIMEZONE,
      slotMinutes: params.slotMinutes ?? DEFAULT_SLOT_MINUTES,
      cleanupMinutes: params.cleanupMinutes ?? DEFAULT_CLEANUP_MINUTES,
      durationByPartySize: params.durationByPartySize ?? DEFAULT_DURATION_BY_PARTY_SIZE.map((row) => ({ ...row })),
      createdAt: now,
      updatedAt: now,
    });
    schedule.validate();
    return schedule;
  }

  static fromPersistence(props: EstablishmentScheduleProps): EstablishmentSchedule {
    return new EstablishmentSchedule({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get establishmentId(): string { return this.props.establishmentId; }
  get timezone(): string { return this.props.timezone; }
  get slotMinutes(): number { return this.props.slotMinutes; }
  get cleanupMinutes(): number { return this.props.cleanupMinutes; }
  get durationByPartySize(): PartyDuration[] { return this.props.durationByPartySize; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  update(params: {
    timezone?: string;
    slotMinutes?: number;
    cleanupMinutes?: number;
    durationByPartySize?: PartyDuration[];
  }): void {
    if (params.timezone !== undefined) this.props.timezone = params.timezone;
    if (params.slotMinutes !== undefined) this.props.slotMinutes = params.slotMinutes;
    if (params.cleanupMinutes !== undefined) this.props.cleanupMinutes = params.cleanupMinutes;
    if (params.durationByPartySize !== undefined) this.props.durationByPartySize = params.durationByPartySize;
    this.validate();
    this.props.updatedAt = new Date();
  }

  /** Settings estructurales para `domain/schedule.ts` (puro). */
  toSettings(): { timezone: string; slotMinutes: number; cleanupMinutes: number; durationByPartySize: PartyDuration[] } {
    return {
      timezone: this.props.timezone,
      slotMinutes: this.props.slotMinutes,
      cleanupMinutes: this.props.cleanupMinutes,
      durationByPartySize: this.props.durationByPartySize,
    };
  }

  toPersistence(): EstablishmentScheduleProps {
    return { ...this.props };
  }

  private validate(): void {
    // Reutiliza el validador puro (mismos límites y mensajes en toda la app).
    validateSchedule(this.toSettings(), []);
  }
}

// ── ScheduleShift ───────────────────────────────────────────────────────────

export interface ScheduleShiftProps {
  id: string;
  organizationId: string;
  scheduleId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
  label: string | null;
  createdAt: Date;
}

function normalizeTime(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

export class ScheduleShift {
  private constructor(private props: ScheduleShiftProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    scheduleId: string;
    weekday: number;
    opensAt: string;
    closesAt: string;
    label?: string | null;
  }): ScheduleShift {
    const now = new Date();
    const shift = new ScheduleShift({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      scheduleId: params.scheduleId,
      weekday: params.weekday,
      opensAt: normalizeTime(params.opensAt),
      closesAt: normalizeTime(params.closesAt),
      label: params.label?.trim() ? params.label.trim() : null,
      createdAt: now,
    });
    shift.validate();
    return shift;
  }

  static fromPersistence(props: ScheduleShiftProps): ScheduleShift {
    return new ScheduleShift({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get scheduleId(): string { return this.props.scheduleId; }
  get weekday(): number { return this.props.weekday; }
  get opensAt(): string { return this.props.opensAt; }
  get closesAt(): string { return this.props.closesAt; }
  get label(): string | null { return this.props.label; }
  get createdAt(): Date { return this.props.createdAt; }

  toPersistence(): ScheduleShiftProps {
    return { ...this.props };
  }

  private validate(): void {
    const details: ErrorDetail[] = [];
    if (!Number.isInteger(this.props.weekday) || this.props.weekday < 0 || this.props.weekday > 6) {
      details.push({ field: 'weekday', message: 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado).' });
    }
    if (!isTime(this.props.opensAt) || !isTime(this.props.closesAt)) {
      details.push({ field: 'opensAt', message: 'Las horas deben venir en formato HH:mm.' });
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}

// ── ScheduleException ───────────────────────────────────────────────────────

export interface ScheduleExceptionProps {
  id: string;
  organizationId: string;
  scheduleId: string;
  onDate: string;
  kind: ScheduleExceptionKind;
  opensAt: string | null;
  closesAt: string | null;
  reason: string | null;
  createdAt: Date;
}

export class ScheduleException {
  private constructor(private props: ScheduleExceptionProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    scheduleId: string;
    onDate: string;
    kind: ScheduleExceptionKind;
    opensAt?: string | null;
    closesAt?: string | null;
    reason?: string | null;
  }): ScheduleException {
    const now = new Date();
    const exception = new ScheduleException({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      scheduleId: params.scheduleId,
      onDate: params.onDate,
      kind: params.kind,
      opensAt: params.kind === 'special_hours' && params.opensAt ? normalizeTime(params.opensAt) : null,
      closesAt: params.kind === 'special_hours' && params.closesAt ? normalizeTime(params.closesAt) : null,
      reason: params.reason?.trim() ? params.reason.trim() : null,
      createdAt: now,
    });
    exception.validate();
    return exception;
  }

  static fromPersistence(props: ScheduleExceptionProps): ScheduleException {
    return new ScheduleException({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get scheduleId(): string { return this.props.scheduleId; }
  get onDate(): string { return this.props.onDate; }
  get kind(): ScheduleExceptionKind { return this.props.kind; }
  get opensAt(): string | null { return this.props.opensAt; }
  get closesAt(): string | null { return this.props.closesAt; }
  get reason(): string | null { return this.props.reason; }
  get createdAt(): Date { return this.props.createdAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  toPersistence(): ScheduleExceptionProps {
    return { ...this.props };
  }

  private validate(): void {
    const details: ErrorDetail[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.props.onDate)) {
      details.push({ field: 'onDate', message: 'La fecha debe tener el formato YYYY-MM-DD.' });
    }
    if (this.props.reason !== null && this.props.reason.length > 120) {
      details.push({ field: 'reason', message: 'El motivo no puede superar 120 caracteres.' });
    }
    if (this.props.kind === 'special_hours') {
      if (!this.props.opensAt || !this.props.closesAt || !isTime(this.props.opensAt) || !isTime(this.props.closesAt)) {
        details.push({ field: 'opensAt', message: 'Un horario especial necesita hora de apertura y de cierre (HH:mm).' });
      } else if (this.props.opensAt >= this.props.closesAt) {
        details.push({ field: 'opensAt', message: 'La hora de cierre debe ser posterior a la de apertura.' });
      }
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}
