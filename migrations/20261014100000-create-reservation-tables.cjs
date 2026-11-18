/**
 * Reservas del cliente (entregable 2) — restaurant_db.
 *
 * - reservation_settings: una fila por establecimiento con lo que decide el dueño (enlace público, límites de la reserva, a dónde
 *   avisar). `public_slug` es ÚNICO en todo el sistema: es la dirección que ve el cliente. MySQL permite varios NULL en un
 *   índice único, así que un local sin enlace no choca con otro sin enlace.
 * - reservations: una reserva. Las horas van en UTC; `on_date` es la fecha LOCAL del restaurante (así el listado de «hoy» no
 *   depende de convertir zonas en la consulta). Del enlace de cancelación solo se guarda el HASH del token, como una contraseña.
 * - reservation_tables: qué mesas ocupa y hasta cuándo (incluye el margen de limpieza). `active = 0` libera la mesa sin perder el
 *   historial de dónde se sentó cada reserva. Las mesas nunca se borran, así que las FK son RESTRICT.
 *
 * Sin FOREIGN KEY hacia otros servicios (establishment_id es referencia lógica a organization-service).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reservation_settings', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      establishment_id: { type: Sequelize.CHAR(36), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      public_slug: { type: Sequelize.STRING(60), allowNull: true },
      display_name: { type: Sequelize.STRING(120), allowNull: true },
      public_note: { type: Sequelize.STRING(500), allowNull: true },
      contact_phone: { type: Sequelize.STRING(40), allowNull: true },
      notify_email: { type: Sequelize.STRING(160), allowNull: true },
      max_days_ahead: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 30 },
      min_notice_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      max_party_size: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 10 },
      max_tables_per_reservation: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 3 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('reservation_settings', ['establishment_id'], { unique: true, name: 'uq_reservation_settings_establishment' });
    await queryInterface.addIndex('reservation_settings', ['public_slug'], { unique: true, name: 'uq_reservation_settings_slug' });
    await queryInterface.addIndex('reservation_settings', ['organization_id']);

    await queryInterface.createTable('reservations', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      establishment_id: { type: Sequelize.CHAR(36), allowNull: false },
      code: { type: Sequelize.CHAR(8), allowNull: false },
      guest_name: { type: Sequelize.STRING(120), allowNull: false },
      guest_email: { type: Sequelize.STRING(160), allowNull: true },
      guest_phone: { type: Sequelize.STRING(40), allowNull: false },
      party_size: { type: Sequelize.SMALLINT, allowNull: false },
      on_date: { type: Sequelize.DATEONLY, allowNull: false },
      starts_at: { type: Sequelize.DATE, allowNull: false },
      ends_at: { type: Sequelize.DATE, allowNull: false },
      blocked_until: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'),
        allowNull: false,
        defaultValue: 'confirmed',
      },
      source: { type: Sequelize.ENUM('online', 'staff'), allowNull: false },
      notes: { type: Sequelize.STRING(500), allowNull: true },
      cancel_token_hash: { type: Sequelize.CHAR(64), allowNull: false },
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
      cancelled_by: { type: Sequelize.ENUM('guest', 'staff'), allowNull: true },
      cancel_reason: { type: Sequelize.STRING(300), allowNull: true },
      created_by: { type: Sequelize.CHAR(36), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('reservations', ['code'], { unique: true, name: 'uq_reservations_code' });
    await queryInterface.addIndex('reservations', ['cancel_token_hash'], { unique: true, name: 'uq_reservations_token' });
    await queryInterface.addIndex('reservations', ['organization_id', 'establishment_id', 'starts_at'], { name: 'idx_reservations_day' });
    await queryInterface.addIndex('reservations', ['organization_id', 'establishment_id', 'guest_email'], { name: 'idx_reservations_email' });
    await queryInterface.addIndex('reservations', ['organization_id', 'establishment_id', 'guest_phone'], { name: 'idx_reservations_phone' });

    await queryInterface.createTable('reservation_tables', {
      reservation_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
        references: { model: 'reservations', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      table_id: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        primaryKey: true,
        references: { model: 'dining_tables', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      blocked_from: { type: Sequelize.DATE, allowNull: false },
      blocked_until: { type: Sequelize.DATE, allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    });
    // La consulta caliente: «¿qué se cruza con este intervalo en estas mesas?»
    await queryInterface.addIndex('reservation_tables', ['table_id', 'active', 'blocked_from', 'blocked_until'], { name: 'idx_reservation_tables_overlap' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reservation_tables');
    await queryInterface.dropTable('reservations');
    await queryInterface.dropTable('reservation_settings');
  },
};
