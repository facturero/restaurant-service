import './infrastructure/telemetry/otel.js';
import { serve } from '@hono/node-server';
import { OutboxRelay } from '@facturero/outbox-relay';
import { config } from './infrastructure/config.js';
import { sequelize } from './infrastructure/persistence/sequelize.js';
import './infrastructure/persistence/models.js';
import { readOnlyRepositories, SequelizeUnitOfWorkFactory } from './infrastructure/persistence/repositories.js';
import { HttpEstablishmentChecker } from './infrastructure/org/establishment-check.js';
import { SetupEstablishmentUseCase } from './application/use-cases/setup-establishment.js';
import { GetFloorPlanUseCase, ListFloorsUseCase } from './application/use-cases/floor-queries.js';
import { UpdateFloorUseCase } from './application/use-cases/update-floor.js';
import { BulkCreateTablesUseCase } from './application/use-cases/bulk-create-tables.js';
import { CreateTableUseCase, ListTablesUseCase, UpdateTableUseCase } from './application/use-cases/table-use-cases.js';
import { SaveFloorPlanUseCase } from './application/use-cases/save-floor-plan.js';
import { CreateZoneUseCase, ListZonesUseCase, UpdateZoneUseCase } from './application/use-cases/zone-use-cases.js';
import {
  AddScheduleExceptionUseCase,
  GetScheduleUseCase,
  RemoveScheduleExceptionUseCase,
  SaveScheduleUseCase,
} from './application/use-cases/schedule-use-cases.js';
import { PreviewSlotsUseCase } from './application/use-cases/preview-slots.js';
import { GetReservationSettingsUseCase, SaveReservationSettingsUseCase } from './application/use-cases/reservation-settings-use-cases.js';
import {
  GetPublicAvailabilityUseCase,
  GetPublicRestaurantUseCase,
  GetStaffAvailabilityUseCase,
} from './application/use-cases/availability-use-cases.js';
import {
  CreatePublicReservationUseCase,
  CreateStaffReservationUseCase,
  ReservationBooker,
} from './application/use-cases/create-reservation.js';
import {
  CancelReservationByTokenUseCase,
  CancelReservationUseCase,
  ChangeReservationStatusUseCase,
  GetReservationByTokenUseCase,
  GetReservationUseCase,
  ListReservationsUseCase,
} from './application/use-cases/reservation-management.js';
import { HttpPluginGate } from './infrastructure/plugins/plugin-gate.js';
import { createApp } from './interface/http/app.js';

async function main(): Promise<void> {
  // NO se llama a `sequelize.sync()`: la migración (initContainer
  // restaurant-migrate) es la fuente de verdad del esquema. Un sync() en
  // producción crearía tablas por su cuenta y divergiría de las migraciones.
  await sequelize.authenticate();

  let relay: OutboxRelay | undefined;
  const uowGateway = new SequelizeUnitOfWorkFactory((tx) => relay?.attachToTransaction(tx));
  const repos = readOnlyRepositories;
  const establishmentChecker = new HttpEstablishmentChecker(config.ORG_SERVICE_URL, config.INTERNAL_USER_ID);
  const plugins = new HttpPluginGate(config.PLUGIN_CATALOG_SERVICE_URL);
  const clock = () => new Date();
  const booker = new ReservationBooker(uowGateway, { manageUrl: (token) => `${config.PUBLIC_RESERVATIONS_URL}/r/${token}` }, clock);

  const app = createApp({
    useCases: {
      setupEstablishment: new SetupEstablishmentUseCase(uowGateway, establishmentChecker),
      listFloors: new ListFloorsUseCase(repos),
      getFloorPlan: new GetFloorPlanUseCase(repos),
      saveFloorPlan: new SaveFloorPlanUseCase(uowGateway),
      updateFloor: new UpdateFloorUseCase(uowGateway),
      listTables: new ListTablesUseCase(repos),
      createTable: new CreateTableUseCase(uowGateway),
      bulkCreateTables: new BulkCreateTablesUseCase(uowGateway),
      updateTable: new UpdateTableUseCase(uowGateway),
      listZones: new ListZonesUseCase(repos),
      createZone: new CreateZoneUseCase(uowGateway),
      updateZone: new UpdateZoneUseCase(uowGateway),
      getSchedule: new GetScheduleUseCase(repos),
      saveSchedule: new SaveScheduleUseCase(uowGateway),
      addScheduleException: new AddScheduleExceptionUseCase(uowGateway),
      removeScheduleException: new RemoveScheduleExceptionUseCase(uowGateway),
      previewSlots: new PreviewSlotsUseCase(repos),
      getReservationSettings: new GetReservationSettingsUseCase(repos),
      saveReservationSettings: new SaveReservationSettingsUseCase(uowGateway, establishmentChecker),
      staffAvailability: new GetStaffAvailabilityUseCase(repos, clock),
      listReservations: new ListReservationsUseCase(repos),
      createStaffReservation: new CreateStaffReservationUseCase(repos, booker),
      getReservation: new GetReservationUseCase(repos),
      changeReservationStatus: new ChangeReservationStatusUseCase(uowGateway, repos),
      cancelReservation: new CancelReservationUseCase(uowGateway, repos, clock),
      publicRestaurant: new GetPublicRestaurantUseCase(repos, plugins),
      publicAvailability: new GetPublicAvailabilityUseCase(repos, plugins, clock),
      createPublicReservation: new CreatePublicReservationUseCase(repos, plugins, booker),
      getReservationByToken: new GetReservationByTokenUseCase(repos, clock),
      cancelReservationByToken: new CancelReservationByTokenUseCase(uowGateway, repos, clock),
    },
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: app.fetch, port: config.PORT });
  console.log(`[restaurant-service] corriendo en puerto ${config.PORT}`);

  if (config.RABBITMQ_URL) {
    relay = new OutboxRelay({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
    });
    await relay.start();
    console.log('[restaurant-service] outbox relay activo (este servicio no consume eventos; solo los publica)');
  } else {
    console.warn('[restaurant-service] RABBITMQ_URL no configurado: los eventos NO se publican');
  }
}

main().catch((err) => {
  console.error('[restaurant-service] error al iniciar:', err);
  process.exit(1);
});
