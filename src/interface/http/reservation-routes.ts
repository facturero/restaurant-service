import { Hono } from 'hono';
import type {
  GetPublicAvailabilityUseCase,
  GetPublicRestaurantUseCase,
  GetStaffAvailabilityUseCase,
} from '../../application/use-cases/availability-use-cases.js';
import type { CreatePublicReservationUseCase, CreateStaffReservationUseCase } from '../../application/use-cases/create-reservation.js';
import type {
  CancelReservationByTokenUseCase,
  CancelReservationUseCase,
  ChangeReservationStatusUseCase,
  GetReservationByTokenUseCase,
  GetReservationUseCase,
  ListReservationsUseCase,
} from '../../application/use-cases/reservation-management.js';
import type {
  GetReservationSettingsUseCase,
  SaveReservationSettingsUseCase,
} from '../../application/use-cases/reservation-settings-use-cases.js';
import {
  cancelReservationController,
  changeReservationStatusController,
  createStaffReservationController,
  getReservationController,
  getReservationSettingsController,
  listReservationsController,
  publicAvailabilityController,
  publicCancelReservationController,
  publicCreateReservationController,
  publicGetReservationController,
  publicRestaurantController,
  saveReservationSettingsController,
  staffAvailabilityController,
} from './reservation-controllers.js';
import {
  cancelReservationSchema,
  changeReservationStatusSchema,
  publicCreateReservationSchema,
  reservationSettingsSchema,
  staffCreateReservationSchema,
} from './reservation-validators.js';
import { validateJson } from './validators.js';
import { type ContextVariables, requireOrganization, requirePermission } from './middlewares.js';

type Vars = { Variables: ContextVariables };

export interface ReservationUseCases {
  getReservationSettings: GetReservationSettingsUseCase;
  saveReservationSettings: SaveReservationSettingsUseCase;
  staffAvailability: GetStaffAvailabilityUseCase;
  listReservations: ListReservationsUseCase;
  createStaffReservation: CreateStaffReservationUseCase;
  getReservation: GetReservationUseCase;
  changeReservationStatus: ChangeReservationStatusUseCase;
  cancelReservation: CancelReservationUseCase;
  publicRestaurant: GetPublicRestaurantUseCase;
  publicAvailability: GetPublicAvailabilityUseCase;
  createPublicReservation: CreatePublicReservationUseCase;
  getReservationByToken: GetReservationByTokenUseCase;
  cancelReservationByToken: CancelReservationByTokenUseCase;
}

/** Rutas del personal: llevan sesión, el gateway ya comprobó el módulo y cada una pide su permiso. */
export function reservationRoutes(useCases: ReservationUseCases): Hono<Vars> {
  const r = new Hono<Vars>();

  r.get(
    '/restaurant/establishments/:establishmentId/reservation-settings',
    requireOrganization(),
    requirePermission('reservation:read'),
    getReservationSettingsController(useCases.getReservationSettings),
  );
  r.put(
    '/restaurant/establishments/:establishmentId/reservation-settings',
    requireOrganization(),
    requirePermission('reservation:manage'),
    validateJson(reservationSettingsSchema),
    saveReservationSettingsController(useCases.saveReservationSettings),
  );
  r.get(
    '/restaurant/establishments/:establishmentId/availability',
    requireOrganization(),
    requirePermission('reservation:read'),
    staffAvailabilityController(useCases.staffAvailability),
  );
  r.get(
    '/restaurant/establishments/:establishmentId/reservations',
    requireOrganization(),
    requirePermission('reservation:read'),
    listReservationsController(useCases.listReservations),
  );
  r.post(
    '/restaurant/establishments/:establishmentId/reservations',
    requireOrganization(),
    requirePermission('reservation:manage'),
    validateJson(staffCreateReservationSchema),
    createStaffReservationController(useCases.createStaffReservation),
  );
  r.get(
    '/restaurant/reservations/:id',
    requireOrganization(),
    requirePermission('reservation:read'),
    getReservationController(useCases.getReservation),
  );
  r.patch(
    '/restaurant/reservations/:id/status',
    requireOrganization(),
    requirePermission('reservation:manage'),
    validateJson(changeReservationStatusSchema),
    changeReservationStatusController(useCases.changeReservationStatus),
  );
  r.post(
    '/restaurant/reservations/:id/cancel',
    requireOrganization(),
    requirePermission('reservation:manage'),
    validateJson(cancelReservationSchema),
    cancelReservationController(useCases.cancelReservation),
  );

  return r;
}

/**
 * Rutas PÚBLICAS: sin sesión, sin permisos. La organización la resuelve el propio servicio a partir del enlace del restaurante
 * (o del token de la reserva). El gateway las deja pasar con límite de peticiones por IP; aquí no hay nada que dependa de las
 * cabeceras de contexto.
 */
export function publicReservationRoutes(useCases: ReservationUseCases): Hono {
  const r = new Hono();

  r.get('/public/restaurants/:slug', publicRestaurantController(useCases.publicRestaurant));
  r.get('/public/restaurants/:slug/availability', publicAvailabilityController(useCases.publicAvailability));
  r.post(
    '/public/restaurants/:slug/reservations',
    validateJson(publicCreateReservationSchema),
    publicCreateReservationController(useCases.createPublicReservation),
  );
  r.get('/public/reservations/:token', publicGetReservationController(useCases.getReservationByToken));
  r.post('/public/reservations/:token/cancel', publicCancelReservationController(useCases.cancelReservationByToken));

  return r;
}
