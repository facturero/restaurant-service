export interface ErrorDetail {
  field: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 422;
  constructor(details: ErrorDetail[], message = 'La petición no es válida.') {
    super(message, details);
  }
}

export class OrganizationContextRequiredError extends AppError {
  readonly code = 'ORG_CONTEXT_REQUIRED';
  readonly httpStatus = 401;
  constructor(message = 'Falta el contexto de organización.') { super(message); }
}

export class UserContextRequiredError extends AppError {
  readonly code = 'USER_CONTEXT_REQUIRED';
  readonly httpStatus = 401;
  constructor(message = 'Falta el contexto de usuario.') { super(message); }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;
  constructor(message = 'Permiso insuficiente.') { super(message); }
}

export class EstablishmentNotFoundError extends AppError {
  readonly code = 'ESTABLISHMENT_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Establecimiento no encontrado.') { super(message); }
}

export class FloorNotFoundError extends AppError {
  readonly code = 'FLOOR_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Planta no encontrada.') { super(message); }
}

export class TableNotFoundError extends AppError {
  readonly code = 'TABLE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Mesa no encontrada.') { super(message); }
}

export class ZoneNotFoundError extends AppError {
  readonly code = 'ZONE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Zona no encontrada.') { super(message); }
}

/** Se añade al listado del documento: el horario existe tras `setup`, pero una
 *  organización recién migrada puede consultarlo antes de inicializar. */
export class ScheduleNotFoundError extends AppError {
  readonly code = 'SCHEDULE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Horario no encontrado. Inicializa el establecimiento primero.') { super(message); }
}

/** Añadido al documento: `floors` tiene UNIQUE (establishment_id, name). */
export class FloorNameExistsError extends AppError {
  readonly code = 'FLOOR_NAME_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'Ya existe una planta con ese nombre en el establecimiento.') { super(message); }
}

export class TableNameExistsError extends AppError {
  readonly code = 'TABLE_NAME_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'Ya existe una mesa activa con ese nombre en la planta.') { super(message); }
}

export class ZoneNameExistsError extends AppError {
  readonly code = 'ZONE_NAME_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'Ya existe una zona con ese nombre en la planta.') { super(message); }
}

/** El editor guarda con control de versión: si otro usuario guardó antes, la
 *  versión esperada no es la actual y hay que avisar sin pisar su trabajo. */
export class PlanVersionConflictError extends AppError {
  readonly code = 'PLAN_VERSION_CONFLICT';
  readonly httpStatus = 409;
  constructor(readonly currentVersion: number) {
    super('Otra persona modificó el plano.', [
      { field: 'expectedVersion', message: `La versión del plano ha cambiado (ahora es la ${currentVersion}).` },
      { field: 'currentVersion', message: String(currentVersion) },
    ]);
  }
}

export class InvalidPlanError extends AppError {
  readonly code = 'INVALID_PLAN';
  readonly httpStatus = 422;
  constructor(details: ErrorDetail[], message = 'El plano no es válido.') {
    super(message, details);
  }
}

export class InvalidScheduleError extends AppError {
  readonly code = 'INVALID_SCHEDULE';
  readonly httpStatus = 422;
  constructor(details: ErrorDetail[], message = 'El horario no es válido.') {
    super(message, details);
  }
}

/** Añadido al documento: `schedule_exceptions` tiene UNIQUE (schedule_id, on_date). */
export class ScheduleExceptionExistsError extends AppError {
  readonly code = 'SCHEDULE_EXCEPTION_EXISTS';
  readonly httpStatus = 409;
  constructor(message = 'Ya hay una excepción para esa fecha.') { super(message); }
}

/** Añadido al documento: la ruta de borrado no lleva el establecimiento en el
 *  path, así que una excepción inexistente necesita su propio 404. */
export class ScheduleExceptionNotFoundError extends AppError {
  readonly code = 'SCHEDULE_EXCEPTION_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Excepción de horario no encontrada.') { super(message); }
}

// ── Reservas (entregable 2) ─────────────────────────────────────────────────

/** Nunca se distingue «no existe» de «no está abierto al público» en las rutas públicas: no se filtra qué locales existen. */
export class RestaurantNotFoundError extends AppError {
  readonly code = 'RESTAURANT_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Restaurante no encontrado.') { super(message); }
}

export class ReservationSettingsNotFoundError extends AppError {
  readonly code = 'RESERVATION_SETTINGS_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Las reservas de este local aún no están configuradas.') { super(message); }
}

export class ReservationNotFoundError extends AppError {
  readonly code = 'RESERVATION_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(message = 'Reserva no encontrada.') { super(message); }
}

export class SlugTakenError extends AppError {
  readonly code = 'SLUG_TAKEN';
  readonly httpStatus = 409;
  constructor(message = 'Ese nombre de enlace ya lo usa otro restaurante. Elige otro.') { super(message); }
}

export class ReservationsNotAvailableError extends AppError {
  readonly code = 'RESERVATIONS_NOT_AVAILABLE';
  readonly httpStatus = 403;
  constructor(message = 'Este restaurante no está recibiendo reservas en línea.') { super(message); }
}

export class PartySizeError extends AppError {
  readonly code = 'PARTY_SIZE_NOT_ALLOWED';
  readonly httpStatus = 422;
  constructor(message: string) { super(message, [{ field: 'partySize', message }]); }
}

export class SlotNotOfferedError extends AppError {
  readonly code = 'SLOT_NOT_OFFERED';
  readonly httpStatus = 422;
  constructor(message = 'Esa hora no está disponible para reservar.') { super(message, [{ field: 'time', message }]); }
}

/** El hueco se llenó entre que el cliente lo vio y confirmó (o dos personas pidieron la misma mesa a la vez). */
export class SlotTakenError extends AppError {
  readonly code = 'SLOT_TAKEN';
  readonly httpStatus = 409;
  constructor(message = 'Justo se ocupó esa hora. Elige otra, por favor.') { super(message); }
}

export class TooManyReservationsError extends AppError {
  readonly code = 'TOO_MANY_RESERVATIONS';
  readonly httpStatus = 429;
  constructor(message = 'Ya tienes varias reservas activas en este restaurante. Cancela alguna o llámalos.') { super(message); }
}

export class InvalidReservationTransitionError extends AppError {
  readonly code = 'INVALID_RESERVATION_TRANSITION';
  readonly httpStatus = 409;
  constructor(message = 'Esa reserva ya no admite ese cambio.') { super(message); }
}

export class TablesUnavailableError extends AppError {
  readonly code = 'TABLES_UNAVAILABLE';
  readonly httpStatus = 409;
  constructor(message = 'Alguna de las mesas elegidas ya está ocupada a esa hora.') { super(message); }
}
