import { DataTypes, type InferAttributes, type InferCreationAttributes, Model } from 'sequelize';
import type { ScheduleExceptionKind, TableShape, ZoneColor } from '../../domain/entities.js';
import type { PartyDuration } from '../../domain/schedule.js';
import { sequelize } from './sequelize.js';

// Nota: `active_name` de dining_tables es una columna GENERADA (IF(status='active',
// name, NULL)) con UNIQUE (floor_id, active_name): garantiza nombre único SOLO
// entre mesas activas. No se declara aquí para que Sequelize jamás la escriba.

export class FloorModel extends Model<InferAttributes<FloorModel>, InferCreationAttributes<FloorModel>> {
  declare id: string;
  declare organization_id: string;
  declare establishment_id: string;
  declare name: string;
  declare width_cm: number | null;
  declare height_cm: number | null;
  declare sort_order: number;
  declare status: 'active' | 'inactive';
  declare layout_version: number;
  declare layout_elements: unknown[] | null;
  declare created_at: Date;
  declare updated_at: Date;
}

FloorModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    establishment_id: { type: DataTypes.CHAR(36), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    width_cm: { type: DataTypes.INTEGER, allowNull: true },
    height_cm: { type: DataTypes.INTEGER, allowNull: true },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    layout_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    layout_elements: { type: DataTypes.JSON, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'floors', timestamps: false },
);

export class ZoneModel extends Model<InferAttributes<ZoneModel>, InferCreationAttributes<ZoneModel>> {
  declare id: string;
  declare organization_id: string;
  declare floor_id: string;
  declare name: string;
  declare color: ZoneColor;
  declare status: 'active' | 'inactive';
  declare created_at: Date;
  declare updated_at: Date;
}

ZoneModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    floor_id: { type: DataTypes.CHAR(36), allowNull: false },
    name: { type: DataTypes.STRING(60), allowNull: false },
    color: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'primary' },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'zones', timestamps: false },
);

export class DiningTableModel extends Model<
  InferAttributes<DiningTableModel>,
  InferCreationAttributes<DiningTableModel>
> {
  declare id: string;
  declare organization_id: string;
  declare floor_id: string;
  declare zone_id: string | null;
  declare name: string;
  declare capacity_min: number;
  declare capacity_max: number;
  declare x_cm: number | null;
  declare y_cm: number | null;
  declare width_cm: number;
  declare height_cm: number;
  declare shape: TableShape;
  declare rotation_deg: number;
  declare status: 'active' | 'inactive';
  declare created_at: Date;
  declare updated_at: Date;
}

DiningTableModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    floor_id: { type: DataTypes.CHAR(36), allowNull: false },
    zone_id: { type: DataTypes.CHAR(36), allowNull: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    capacity_min: { type: DataTypes.TINYINT, allowNull: false },
    capacity_max: { type: DataTypes.TINYINT, allowNull: false },
    x_cm: { type: DataTypes.INTEGER, allowNull: true },
    y_cm: { type: DataTypes.INTEGER, allowNull: true },
    width_cm: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 80 },
    height_cm: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 80 },
    shape: { type: DataTypes.ENUM('rect', 'round'), allowNull: false, defaultValue: 'rect' },
    rotation_deg: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'dining_tables', timestamps: false },
);

export class EstablishmentScheduleModel extends Model<
  InferAttributes<EstablishmentScheduleModel>,
  InferCreationAttributes<EstablishmentScheduleModel>
> {
  declare id: string;
  declare organization_id: string;
  declare establishment_id: string;
  declare timezone: string;
  declare slot_minutes: number;
  declare cleanup_minutes: number;
  declare duration_by_party_size: PartyDuration[] | null;
  declare created_at: Date;
  declare updated_at: Date;
}

EstablishmentScheduleModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    establishment_id: { type: DataTypes.CHAR(36), allowNull: false },
    timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'America/Guayaquil' },
    slot_minutes: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 30 },
    cleanup_minutes: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 15 },
    duration_by_party_size: { type: DataTypes.JSON, allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'establishment_schedules', timestamps: false },
);

export class ScheduleShiftModel extends Model<
  InferAttributes<ScheduleShiftModel>,
  InferCreationAttributes<ScheduleShiftModel>
> {
  declare id: string;
  declare organization_id: string;
  declare schedule_id: string;
  declare weekday: number;
  declare opens_at: string;
  declare closes_at: string;
  declare label: string | null;
  declare created_at: Date;
}

ScheduleShiftModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    schedule_id: { type: DataTypes.CHAR(36), allowNull: false },
    weekday: { type: DataTypes.TINYINT, allowNull: false },
    opens_at: { type: DataTypes.TIME, allowNull: false },
    closes_at: { type: DataTypes.TIME, allowNull: false },
    label: { type: DataTypes.STRING(40), allowNull: true },
    created_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'schedule_shifts', timestamps: false },
);

export class ScheduleExceptionModel extends Model<
  InferAttributes<ScheduleExceptionModel>,
  InferCreationAttributes<ScheduleExceptionModel>
> {
  declare id: string;
  declare organization_id: string;
  declare schedule_id: string;
  declare on_date: string;
  declare kind: ScheduleExceptionKind;
  declare opens_at: string | null;
  declare closes_at: string | null;
  declare reason: string | null;
  declare created_at: Date;
}

ScheduleExceptionModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    schedule_id: { type: DataTypes.CHAR(36), allowNull: false },
    on_date: { type: DataTypes.DATEONLY, allowNull: false },
    kind: { type: DataTypes.ENUM('closed', 'special_hours'), allowNull: false },
    opens_at: { type: DataTypes.TIME, allowNull: true },
    closes_at: { type: DataTypes.TIME, allowNull: true },
    reason: { type: DataTypes.STRING(120), allowNull: true },
    created_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'schedule_exceptions', timestamps: false },
);

export class OutboxModel extends Model<InferAttributes<OutboxModel>, InferCreationAttributes<OutboxModel>> {
  declare id: string;
  declare aggregate_type: string;
  declare aggregate_id: string;
  declare type: string;
  declare payload: unknown;
  declare occurred_at: Date;
  declare processed_at: Date | null;
}

OutboxModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    aggregate_type: { type: DataTypes.STRING(50), allowNull: false },
    aggregate_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(100), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'outbox_messages', timestamps: false },
);

export class ProcessedEventModel extends Model<
  InferAttributes<ProcessedEventModel>,
  InferCreationAttributes<ProcessedEventModel>
> {
  declare id: string;
  declare event_type: string;
  declare routing_key: string;
  declare payload: unknown;
  declare status: string;
  declare last_error: string | null;
  declare processed_at: Date;
}

ProcessedEventModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    event_type: { type: DataTypes.STRING(100), allowNull: false },
    routing_key: { type: DataTypes.STRING(200), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'processed' },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    processed_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: 'processed_events', timestamps: false },
);

// Asociaciones (solo para consultas; las FK reales viven en la migración).
FloorModel.hasMany(ZoneModel, { foreignKey: 'floor_id', as: 'zones' });
ZoneModel.belongsTo(FloorModel, { foreignKey: 'floor_id' });
FloorModel.hasMany(DiningTableModel, { foreignKey: 'floor_id', as: 'tables' });
DiningTableModel.belongsTo(FloorModel, { foreignKey: 'floor_id' });
ZoneModel.hasMany(DiningTableModel, { foreignKey: 'zone_id', as: 'tables' });
DiningTableModel.belongsTo(ZoneModel, { foreignKey: 'zone_id' });
EstablishmentScheduleModel.hasMany(ScheduleShiftModel, { foreignKey: 'schedule_id', as: 'shifts' });
ScheduleShiftModel.belongsTo(EstablishmentScheduleModel, { foreignKey: 'schedule_id' });
EstablishmentScheduleModel.hasMany(ScheduleExceptionModel, { foreignKey: 'schedule_id', as: 'exceptions' });
ScheduleExceptionModel.belongsTo(EstablishmentScheduleModel, { foreignKey: 'schedule_id' });
