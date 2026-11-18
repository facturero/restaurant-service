import { ReservationSettings, type ReservationSettingsPatch } from '../../domain/reservation.js';
import { EstablishmentNotFoundError, SlugTakenError } from '../../domain/errors.js';
import type { ReservationSettingsRepository } from '../../domain/repositories.js';
import { reservationSettingsUpdatedEvent } from '../events.js';
import type { EstablishmentChecker, UnitOfWorkGateway } from '../ports.js';

/**
 * Ajustes del local, o los valores por defecto (sin guardarlos) si nunca los configuró. El personal puede anotar reservas
 * por teléfono sin haber encendido la página pública, así que «no hay fila» no es un error.
 */
export async function settingsOrDefault(
  repo: Pick<ReservationSettingsRepository, 'findByEstablishment'>,
  organizationId: string,
  establishmentId: string,
): Promise<ReservationSettings> {
  return (await repo.findByEstablishment(organizationId, establishmentId)) ?? ReservationSettings.create({ organizationId, establishmentId });
}

export class GetReservationSettingsUseCase {
  constructor(private readonly repos: { reservationSettings: Pick<ReservationSettingsRepository, 'findByEstablishment'> }) {}

  execute(organizationId: string, establishmentId: string): Promise<ReservationSettings> {
    return settingsOrDefault(this.repos.reservationSettings, organizationId, establishmentId);
  }
}

export class SaveReservationSettingsUseCase {
  constructor(
    private readonly uow: UnitOfWorkGateway,
    private readonly establishmentChecker: EstablishmentChecker,
  ) {}

  async execute(input: { organizationId: string; establishmentId: string; patch: ReservationSettingsPatch }): Promise<ReservationSettings> {
    const check = await this.establishmentChecker.check(input.organizationId, input.establishmentId);
    if (check === 'missing') throw new EstablishmentNotFoundError();

    const uow = await this.uow.begin();
    try {
      const settings = await settingsOrDefault(uow.reservationSettings, input.organizationId, input.establishmentId);
      settings.update(input.patch);

      // El enlace es único en todo el sistema. El índice único de la base es la última palabra, pero se avisa antes con un mensaje claro.
      if (settings.publicSlug && (await uow.reservationSettings.slugTaken(settings.publicSlug, settings.id))) {
        throw new SlugTakenError();
      }

      await uow.reservationSettings.save(settings);
      await uow.outbox.add(reservationSettingsUpdatedEvent(settings));
      await uow.commit();
      return settings;
    } catch (err) {
      await uow.rollback();
      throw err;
    }
  }
}
