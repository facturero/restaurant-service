import type { UnitOfWork } from '../domain/repositories.js';

/** UnitOfWork que además sabe cerrar su transacción. Los casos de uso de
 *  escritura lo obtienen del gateway y hacen commit explícito. */
export interface WriteUnitOfWork extends UnitOfWork {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Abre unidades de trabajo de escritura. La implementación real abre una
 *  transacción de Sequelize; en tests, repos en memoria con commit/rollback. */
export interface UnitOfWorkGateway {
  begin(): Promise<WriteUnitOfWork>;
}

export type EstablishmentCheckResult = 'exists' | 'missing' | 'unchecked';

/**
 * Comprueba que el establecimiento existe en la organización. Sin
 * `ORG_SERVICE_URL` devuelve `unchecked` (desarrollo local) y el caso de uso
 * sigue adelante: no se puede bloquear el alta de un local por una dependencia
 * transversal ausente.
 */
export interface EstablishmentChecker {
  check(organizationId: string, establishmentId: string): Promise<EstablishmentCheckResult>;
}

/**
 * ¿La organización tiene activo un módulo de pago? El gateway ya lo comprueba en las rutas
 * del CRM, pero las rutas PÚBLICAS de reserva no llevan sesión (no hay organización en el
 * token): el servicio la resuelve por el enlace del restaurante y tiene que preguntar él.
 */
export interface PluginGate {
  isActive(organizationId: string, pluginCode: string): Promise<boolean>;
}

/** Enlaces que viajan en los correos. Los resuelve la configuración (dónde vive el sitio de reservas). */
export interface ReservationLinks {
  manageUrl(token: string): string;
}

export type Clock = () => Date;
