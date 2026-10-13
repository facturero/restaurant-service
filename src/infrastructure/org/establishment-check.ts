import type { EstablishmentCheckResult, EstablishmentChecker } from '../../application/ports.js';

interface EstablishmentResponse {
  id: string;
  status?: 'active' | 'inactive';
}

/**
 * Comprueba contra organization-service que el establecimiento es de la
 * organización (una id adivinada no debe dejar filas huérfanas). Mismo patrón
 * servicio-a-servicio que product-service: cabeceras de contexto, sin gateway.
 *
 * Si el servicio no responde o no hay URL configurada se devuelve `unchecked`
 * (no se bloquea el alta por una dependencia transversal ausente); si responde
 * y el establecimiento no está, se devuelve `missing` para responder 404.
 */
export class HttpEstablishmentChecker implements EstablishmentChecker {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly systemUserId: string,
  ) {}

  async check(organizationId: string, establishmentId: string): Promise<EstablishmentCheckResult> {
    if (!this.baseUrl) {
      console.warn('[restaurant-service] ORG_SERVICE_URL no configurado: se omite la comprobación del establecimiento');
      return 'unchecked';
    }

    try {
      const res = await fetch(`${this.baseUrl}/establishments`, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-User-Id': this.systemUserId,
          'X-Permissions': 'establishment:read',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        console.warn(`[restaurant-service] organization-service respondió ${res.status}: se omite la comprobación del establecimiento`);
        return 'unchecked';
      }
      const rows = (await res.json()) as EstablishmentResponse[];
      // Solo cuentan los activos: un establecimiento desactivado no debe poder
      // inicializar el plugin de restaurante.
      return rows.some((row) => row.id === establishmentId && row.status !== 'inactive') ? 'exists' : 'missing';
    } catch (err) {
      console.warn('[restaurant-service] no se pudo comprobar el establecimiento:', err);
      return 'unchecked';
    }
  }
}
