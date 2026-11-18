import type { PluginGate } from '../../application/ports.js';

const TTL_MS = 60_000;
const TIMEOUT_MS = 4_000;

interface Entry {
  codes: Set<string>;
  expiresAt: number;
}

interface OrganizationPluginRow {
  pluginCode?: string;
  status: 'active' | 'disabled';
}

/**
 * Pregunta al catálogo qué módulos tiene activos una organización (el mismo endpoint que usa el gateway), con una caché corta.
 *
 * Es la defensa de las rutas públicas de reserva, que no pasan por la comprobación de módulos del gateway porque no llevan
 * sesión. Si el catálogo no responde se sirve la última respuesta conocida y, si no la hay, se deja pasar: una caída del
 * catálogo no debe dejar a los clientes de un restaurante sin poder reservar (el costo de equivocarse es una reserva de más).
 */
export class HttpPluginGate implements PluginGate {
  private readonly entries = new Map<string, Entry>();
  private warnedMissingUrl = false;

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly ttlMs = TTL_MS,
  ) {}

  async isActive(organizationId: string, pluginCode: string): Promise<boolean> {
    if (!this.baseUrl) {
      if (!this.warnedMissingUrl) {
        console.warn('[restaurant-service] PLUGIN_CATALOG_SERVICE_URL no configurado: se da por activo el módulo de reservas');
        this.warnedMissingUrl = true;
      }
      return true;
    }

    const cached = this.entries.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.codes.has(pluginCode);

    try {
      const res = await fetch(`${this.baseUrl}/organizations/me/plugins`, {
        headers: { Accept: 'application/json', 'X-Organization-Id': organizationId },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as OrganizationPluginRow[];
      const codes = new Set(rows.filter((r) => r.status === 'active' && r.pluginCode).map((r) => r.pluginCode as string));
      this.entries.set(organizationId, { codes, expiresAt: Date.now() + this.ttlMs });
      return codes.has(pluginCode);
    } catch (err) {
      console.warn(`[restaurant-service] no se pudo consultar el catálogo de módulos (${organizationId}):`, err);
      return cached ? cached.codes.has(pluginCode) : true;
    }
  }
}
