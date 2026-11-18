import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  InvalidReservationTransitionError,
  ValidationError,
  type ErrorDetail,
} from './errors.js';

// ── Ajustes de reservas de un local ─────────────────────────────────────────

/** Nombres que no se pueden usar como enlace público: chocarían con rutas del sitio de reservas o con palabras de sistema. */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'r', 'reserva', 'reservas', 'reservar', 'www', 'health', 'static', 'assets',
  'login', 'registro', 'soporte', 'ayuda', 'terminos', 'privacidad', 'public', 'null', 'undefined',
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+]?[0-9 ()\-.]{7,25}$/;

export const RESERVATION_LIMITS = {
  maxDaysAhead: { min: 1, max: 365, default: 30 },
  minNoticeMinutes: { min: 0, max: 10_080, default: 60 },
  maxPartySize: { min: 1, max: 100, default: 10 },
  maxTablesPerReservation: { min: 1, max: 10, default: 3 },
} as const;

/** Convierte un nombre en un enlace posible («La Esquina Ñandú» → «la-esquina-nandu»). Solo sugiere: el dueño lo confirma. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function isValidEmail(value: string): boolean {
  return value.length <= 160 && EMAIL_RE.test(value);
}

export interface ReservationSettingsProps {
  id: string;
  organizationId: string;
  establishmentId: string;
  /** Interruptor del dueño: apagado, la página pública responde como si el local no existiera. */
  enabled: boolean;
  publicSlug: string | null;
  displayName: string | null;
  publicNote: string | null;
  contactPhone: string | null;
  /** A dónde llega el aviso de cada reserva nueva o cancelada. */
  notifyEmail: string | null;
  maxDaysAhead: number;
  minNoticeMinutes: number;
  maxPartySize: number;
  maxTablesPerReservation: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ReservationSettingsPatch = Partial<
  Pick<
    ReservationSettingsProps,
    | 'enabled' | 'publicSlug' | 'displayName' | 'publicNote' | 'contactPhone' | 'notifyEmail'
    | 'maxDaysAhead' | 'minNoticeMinutes' | 'maxPartySize' | 'maxTablesPerReservation'
  >
>;

function blankToNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

export class ReservationSettings {
  private constructor(private props: ReservationSettingsProps) {}

  static create(params: { id?: string; organizationId: string; establishmentId: string }): ReservationSettings {
    const now = new Date();
    return new ReservationSettings({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      enabled: false,
      publicSlug: null,
      displayName: null,
      publicNote: null,
      contactPhone: null,
      notifyEmail: null,
      maxDaysAhead: RESERVATION_LIMITS.maxDaysAhead.default,
      minNoticeMinutes: RESERVATION_LIMITS.minNoticeMinutes.default,
      maxPartySize: RESERVATION_LIMITS.maxPartySize.default,
      maxTablesPerReservation: RESERVATION_LIMITS.maxTablesPerReservation.default,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: ReservationSettingsProps): ReservationSettings {
    return new ReservationSettings({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get establishmentId(): string { return this.props.establishmentId; }
  get enabled(): boolean { return this.props.enabled; }
  get publicSlug(): string | null { return this.props.publicSlug; }
  get displayName(): string | null { return this.props.displayName; }
  get publicNote(): string | null { return this.props.publicNote; }
  get contactPhone(): string | null { return this.props.contactPhone; }
  get notifyEmail(): string | null { return this.props.notifyEmail; }
  get maxDaysAhead(): number { return this.props.maxDaysAhead; }
  get minNoticeMinutes(): number { return this.props.minNoticeMinutes; }
  get maxPartySize(): number { return this.props.maxPartySize; }
  get maxTablesPerReservation(): number { return this.props.maxTablesPerReservation; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  /** Aplica el cambio y valida el resultado completo: no se puede encender sin enlace ni nombre. */
  update(patch: ReservationSettingsPatch): void {
    const next = { ...this.props };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.publicSlug !== undefined) next.publicSlug = blankToNull(patch.publicSlug)?.toLowerCase() ?? null;
    if (patch.displayName !== undefined) next.displayName = blankToNull(patch.displayName);
    if (patch.publicNote !== undefined) next.publicNote = blankToNull(patch.publicNote);
    if (patch.contactPhone !== undefined) next.contactPhone = blankToNull(patch.contactPhone);
    if (patch.notifyEmail !== undefined) next.notifyEmail = blankToNull(patch.notifyEmail)?.toLowerCase() ?? null;
    if (patch.maxDaysAhead !== undefined) next.maxDaysAhead = patch.maxDaysAhead;
    if (patch.minNoticeMinutes !== undefined) next.minNoticeMinutes = patch.minNoticeMinutes;
    if (patch.maxPartySize !== undefined) next.maxPartySize = patch.maxPartySize;
    if (patch.maxTablesPerReservation !== undefined) next.maxTablesPerReservation = patch.maxTablesPerReservation;

    validateSettings(next);
    this.props = { ...next, updatedAt: new Date() };
  }

  toPersistence(): ReservationSettingsProps {
    return { ...this.props };
  }
}

function validateSettings(p: ReservationSettingsProps): void {
  const details: ErrorDetail[] = [];
  const range = (field: keyof typeof RESERVATION_LIMITS, label: string, unit: string) => {
    const { min, max } = RESERVATION_LIMITS[field];
    const value = p[field];
    if (!Number.isInteger(value) || value < min || value > max) {
      details.push({ field, message: `${label} debe estar entre ${min} y ${max} ${unit}.` });
    }
  };
  range('maxDaysAhead', 'La anticipación máxima', 'días');
  range('minNoticeMinutes', 'La antelación mínima', 'minutos');
  range('maxPartySize', 'El máximo de personas', 'personas');
  range('maxTablesPerReservation', 'El máximo de mesas por reserva', 'mesas');

  if (p.publicSlug !== null) {
    if (p.publicSlug.length < 3 || p.publicSlug.length > 60 || !SLUG_RE.test(p.publicSlug)) {
      details.push({ field: 'publicSlug', message: 'El enlace usa de 3 a 60 letras minúsculas, números y guiones (sin espacios ni acentos).' });
    } else if (RESERVED_SLUGS.has(p.publicSlug)) {
      details.push({ field: 'publicSlug', message: 'Ese nombre de enlace está reservado. Elige otro.' });
    }
  }
  if (p.displayName !== null && p.displayName.length > 120) {
    details.push({ field: 'displayName', message: 'El nombre público no puede superar 120 caracteres.' });
  }
  if (p.publicNote !== null && p.publicNote.length > 500) {
    details.push({ field: 'publicNote', message: 'La nota para los clientes no puede superar 500 caracteres.' });
  }
  if (p.contactPhone !== null && !PHONE_RE.test(p.contactPhone)) {
    details.push({ field: 'contactPhone', message: 'El teléfono no es válido.' });
  }
  if (p.notifyEmail !== null && !isValidEmail(p.notifyEmail)) {
    details.push({ field: 'notifyEmail', message: 'El correo de avisos no es válido.' });
  }
  if (p.enabled) {
    if (!p.publicSlug) details.push({ field: 'publicSlug', message: 'Para recibir reservas en línea, define el enlace de tu página.' });
    if (!p.displayName) details.push({ field: 'displayName', message: 'Para recibir reservas en línea, define el nombre que verán tus clientes.' });
  }
  if (details.length > 0) throw new ValidationError(details);
}

// ── Reserva ─────────────────────────────────────────────────────────────────

export type ReservationStatus = 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';
export type ReservationSource = 'online' | 'staff';
export type CancelledBy = 'guest' | 'staff';

export const RESERVATION_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];

/** Estados en los que la reserva sigue ocupando sus mesas. */
export const ACTIVE_STATUSES: ReservationStatus[] = ['pending', 'confirmed', 'seated'];

/** Qué cambios de estado se admiten desde cada estado. Cancelada, no-show y completada son finales. */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show'],
  seated: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L: se dicta por teléfono

export function generateReservationCode(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** El enlace de cancelación lleva el token; en la base solo queda su hash (como una contraseña), no el token. */
export function generateCancelToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashCancelToken(token) };
}

export function hashCancelToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ReservationProps {
  id: string;
  organizationId: string;
  establishmentId: string;
  code: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string;
  partySize: number;
  /** Fecha LOCAL del local (`YYYY-MM-DD`). */
  onDate: string;
  startsAt: Date;
  endsAt: Date;
  /** `endsAt` + margen de limpieza: hasta cuándo se bloquean las mesas. */
  blockedUntil: Date;
  status: ReservationStatus;
  source: ReservationSource;
  notes: string | null;
  cancelTokenHash: string;
  cancelledAt: Date | null;
  cancelledBy: CancelledBy | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Reservation {
  private constructor(private props: ReservationProps) {}

  static create(params: {
    id?: string;
    organizationId: string;
    establishmentId: string;
    guestName: string;
    guestEmail?: string | null;
    guestPhone: string;
    partySize: number;
    onDate: string;
    startsAt: Date;
    endsAt: Date;
    blockedUntil: Date;
    source: ReservationSource;
    notes?: string | null;
    cancelTokenHash: string;
    createdBy?: string | null;
    code?: string;
  }): Reservation {
    const now = new Date();
    const reservation = new Reservation({
      id: params.id ?? randomUUID(),
      organizationId: params.organizationId,
      establishmentId: params.establishmentId,
      code: params.code ?? generateReservationCode(),
      guestName: params.guestName.trim(),
      guestEmail: blankToNull(params.guestEmail)?.toLowerCase() ?? null,
      guestPhone: params.guestPhone.trim(),
      partySize: params.partySize,
      onDate: params.onDate,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      blockedUntil: params.blockedUntil,
      // Sin garantía con tarjeta (entregable 4) no hay nada que confirmar aparte: nace confirmada.
      status: 'confirmed',
      source: params.source,
      notes: blankToNull(params.notes),
      cancelTokenHash: params.cancelTokenHash,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdBy: params.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    });
    reservation.validate(params.source);
    return reservation;
  }

  static fromPersistence(props: ReservationProps): Reservation {
    return new Reservation({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get establishmentId(): string { return this.props.establishmentId; }
  get code(): string { return this.props.code; }
  get guestName(): string { return this.props.guestName; }
  get guestEmail(): string | null { return this.props.guestEmail; }
  get guestPhone(): string { return this.props.guestPhone; }
  get partySize(): number { return this.props.partySize; }
  get onDate(): string { return this.props.onDate; }
  get startsAt(): Date { return this.props.startsAt; }
  get endsAt(): Date { return this.props.endsAt; }
  get blockedUntil(): Date { return this.props.blockedUntil; }
  get status(): ReservationStatus { return this.props.status; }
  get source(): ReservationSource { return this.props.source; }
  get notes(): string | null { return this.props.notes; }
  get cancelTokenHash(): string { return this.props.cancelTokenHash; }
  get cancelledAt(): Date | null { return this.props.cancelledAt; }
  get cancelledBy(): CancelledBy | null { return this.props.cancelledBy; }
  get cancelReason(): string | null { return this.props.cancelReason; }
  get createdBy(): string | null { return this.props.createdBy; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  /** ¿Sigue ocupando mesas? */
  isActive(): boolean {
    return ACTIVE_STATUSES.includes(this.props.status);
  }

  canTransitionTo(next: ReservationStatus): boolean {
    return TRANSITIONS[this.props.status].includes(next);
  }

  /** Cambio de estado del personal (sentar, terminar, no se presentó…). Para cancelar usa `cancel`. */
  changeStatus(next: ReservationStatus): void {
    if (next === 'cancelled') throw new InvalidReservationTransitionError('Para cancelar una reserva usa la acción de cancelar.');
    if (!this.canTransitionTo(next)) {
      throw new InvalidReservationTransitionError(`Una reserva ${STATUS_LABEL[this.props.status]} no puede pasar a ${STATUS_LABEL[next]}.`);
    }
    this.props.status = next;
    this.props.updatedAt = new Date();
  }

  cancel(by: CancelledBy, reason: string | null, now: Date): void {
    if (!this.canTransitionTo('cancelled')) {
      throw new InvalidReservationTransitionError(
        this.props.status === 'cancelled' ? 'Esta reserva ya estaba cancelada.' : `Una reserva ${STATUS_LABEL[this.props.status]} ya no se puede cancelar.`,
      );
    }
    // Una vez pasó la hora ya no es una cancelación: el personal marca «no se presentó».
    if (by === 'guest' && this.props.startsAt.getTime() <= now.getTime()) {
      throw new InvalidReservationTransitionError('La hora de esta reserva ya pasó. Si no puedes asistir, llama al restaurante.');
    }
    this.props.status = 'cancelled';
    this.props.cancelledAt = now;
    this.props.cancelledBy = by;
    this.props.cancelReason = blankToNull(reason)?.slice(0, 300) ?? null;
    this.props.updatedAt = now;
  }

  toPersistence(): ReservationProps {
    return { ...this.props };
  }

  private validate(source: ReservationSource): void {
    const details: ErrorDetail[] = [];
    const p = this.props;
    if (p.guestName.length < 2 || p.guestName.length > 120) {
      details.push({ field: 'guestName', message: 'El nombre debe tener entre 2 y 120 caracteres.' });
    }
    if (!PHONE_RE.test(p.guestPhone)) {
      details.push({ field: 'guestPhone', message: 'El teléfono no es válido.' });
    }
    if (p.guestEmail !== null && !isValidEmail(p.guestEmail)) {
      details.push({ field: 'guestEmail', message: 'El correo no es válido.' });
    }
    // Las reservas en línea necesitan correo (ahí llega el enlace para cancelar); las que anota el personal por teléfono, no.
    if (source === 'online' && p.guestEmail === null) {
      details.push({ field: 'guestEmail', message: 'El correo es obligatorio.' });
    }
    if (!Number.isInteger(p.partySize) || p.partySize < 1) {
      details.push({ field: 'partySize', message: 'Indica cuántas personas son.' });
    }
    if (p.notes !== null && p.notes.length > 500) {
      details.push({ field: 'notes', message: 'Las notas no pueden superar 500 caracteres.' });
    }
    if (details.length > 0) throw new ValidationError(details);
  }
}

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'pendiente',
  confirmed: 'confirmada',
  seated: 'en mesa',
  completed: 'terminada',
  cancelled: 'cancelada',
  no_show: 'sin presentarse',
};
