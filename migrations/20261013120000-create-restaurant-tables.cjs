/**
 * Tablas de restaurant-service (restaurant_db) — entregable 1 (mapa del restaurante).
 *
 * - floors: una planta por establecimiento (el modelo admite varias; la interfaz
 *   del entregable 1 no). `layout_elements` guarda paredes/puertas/decoración en
 *   JSON versionado (`layout_version`): nada de eso lo referencia nadie, así que
 *   no se normaliza. Mesas y zonas SÍ se normalizan porque en el entregable 2 las
 *   reservas apuntarán a ellas.
 * - zones / dining_tables: lo reservable. Las mesas tienen id estable: se
 *   desactivan (`status = inactive`), nunca se borran, para no romper reservas
 *   pasadas.
 * - establishment_schedules / schedule_shifts / schedule_exceptions: turnos por
 *   día de la semana y excepciones (feriados, cierres). El horario guarda su zona
 *   IANA porque la organización puede ser de otro país.
 * - outbox_messages / processed_events: patrón Outbox, esquema de
 *   @facturero/outbox-relay 0.2.x (idéntico al de inventory-service).
 *
 * Unidad: centímetros enteros. La interfaz muestra metros.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. floors
    await queryInterface.createTable('floors', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      // Referencia lógica a organization-service: sin FOREIGN KEY cruzando servicios.
      establishment_id: { type: Sequelize.CHAR(36), allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false },
      width_cm: { type: Sequelize.INTEGER, allowNull: true },
      height_cm: { type: Sequelize.INTEGER, allowNull: true },
      sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      layout_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      layout_elements: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('floors', ['establishment_id', 'name'], { unique: true });
    await queryInterface.addIndex('floors', ['organization_id', 'establishment_id']);

    // 2. zones
    await queryInterface.createTable('zones', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      floor_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'floors', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      name: { type: Sequelize.STRING(60), allowNull: false },
      // Token del tema ('primary', 'error'…), nunca un hexadecimal: el frontend
      // pinta `rgb(var(--v-theme-<color>))`.
      color: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'primary' },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('zones', ['floor_id', 'name'], { unique: true });

    // 3. dining_tables (se llama así para no chocar con palabras de SQL ni con el
    //    vocabulario de Sequelize)
    await queryInterface.createTable('dining_tables', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      floor_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'floors', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      zone_id: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: { model: 'zones', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      name: { type: Sequelize.STRING(60), allowNull: false },
      capacity_min: { type: Sequelize.TINYINT, allowNull: false },
      capacity_max: { type: Sequelize.TINYINT, allowNull: false },
      // Sin plano: x_cm e y_cm nulos y la mesa existe igual.
      x_cm: { type: Sequelize.INTEGER, allowNull: true },
      y_cm: { type: Sequelize.INTEGER, allowNull: true },
      width_cm: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 80 },
      height_cm: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 80 },
      shape: { type: Sequelize.ENUM('rect', 'round'), allowNull: false, defaultValue: 'rect' },
      rotation_deg: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    // Unicidad del nombre SOLO entre activas: MySQL no tiene índices parciales,
    // así que se usa una columna generada (los NULL no colisionan entre sí).
    await queryInterface.sequelize.query(
      `ALTER TABLE dining_tables
         ADD COLUMN active_name VARCHAR(60)
         GENERATED ALWAYS AS (IF(status = 'active', name, NULL)) STORED,
       ADD UNIQUE INDEX dining_tables_floor_active_name_uq (floor_id, active_name)`,
    );
    await queryInterface.addIndex('dining_tables', ['organization_id', 'floor_id']);

    // 4. establishment_schedules
    await queryInterface.createTable('establishment_schedules', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      establishment_id: { type: Sequelize.CHAR(36), allowNull: false },
      timezone: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'America/Guayaquil' },
      slot_minutes: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 30 },
      cleanup_minutes: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 15 },
      duration_by_party_size: { type: Sequelize.JSON, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('establishment_schedules', ['establishment_id'], { unique: true });

    // 5. schedule_shifts
    await queryInterface.createTable('schedule_shifts', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      schedule_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'establishment_schedules', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // 0 = domingo … 6 = sábado (como Date#getDay)
      weekday: { type: Sequelize.TINYINT, allowNull: false },
      opens_at: { type: Sequelize.TIME, allowNull: false },
      closes_at: { type: Sequelize.TIME, allowNull: false },
      label: { type: Sequelize.STRING(40), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('schedule_shifts', ['schedule_id', 'weekday']);

    // 6. schedule_exceptions
    await queryInterface.createTable('schedule_exceptions', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      schedule_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: { model: 'establishment_schedules', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      on_date: { type: Sequelize.DATEONLY, allowNull: false },
      kind: { type: Sequelize.ENUM('closed', 'special_hours'), allowNull: false },
      opens_at: { type: Sequelize.TIME, allowNull: true },
      closes_at: { type: Sequelize.TIME, allowNull: true },
      reason: { type: Sequelize.STRING(120), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('schedule_exceptions', ['schedule_id', 'on_date'], { unique: true });

    // 7. outbox_messages
    await queryInterface.createTable('outbox_messages', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      aggregate_type: { type: Sequelize.STRING(50), allowNull: false },
      aggregate_id: { type: Sequelize.CHAR(36), allowNull: false },
      type: { type: Sequelize.STRING(100), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      processed_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('outbox_messages', ['processed_at']);

    // 8. processed_events (esquema de @facturero/outbox-relay 0.2.x)
    await queryInterface.createTable('processed_events', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      event_type: { type: Sequelize.STRING(100), allowNull: false },
      routing_key: { type: Sequelize.STRING(200), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'processed' },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      processed_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('processed_events');
    await queryInterface.dropTable('outbox_messages');
    await queryInterface.dropTable('schedule_exceptions');
    await queryInterface.dropTable('schedule_shifts');
    await queryInterface.dropTable('establishment_schedules');
    await queryInterface.dropTable('dining_tables');
    await queryInterface.dropTable('zones');
    await queryInterface.dropTable('floors');
  },
};
