import { zValidator } from '@hono/zod-validator';
import { z, type ZodSchema } from 'zod';
import { ValidationError } from '../../domain/errors.js';

const COLOR = z.enum(['primary', 'secondary', 'success', 'info', 'warning', 'error']);
const SHAPE = z.enum(['rect', 'round']);
const ROTATION = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:mm.');
const LOCAL_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.');

const capacityMin = z.number().int('La capacidad mínima debe ser un entero.').min(1, 'La capacidad mínima debe ser al menos 1.').max(50);
const capacityMax = z.number().int('La capacidad máxima debe ser un entero.').min(1, 'La capacidad máxima debe ser al menos 1.').max(50, 'La capacidad máxima son 50 personas.');
const floorDimension = z.number().int('La medida debe ir en centímetros enteros.').min(300, 'La medida mínima es 3 m.').max(100_000, 'La medida máxima es 1000 m.').nullable();
const tableDimension = z.number().int('La medida debe ir en centímetros enteros.').min(30, 'La medida mínima es 30 cm.').max(600, 'La medida máxima es 6 m.');
const position = z.number().int('La posición va en centímetros enteros.').min(0).max(100_000).nullable();

export const updateFloorSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio.').max(80),
    widthCm: floorDimension,
    heightCm: floorDimension,
    sortOrder: z.number().int().min(0),
    status: z.enum(['active', 'inactive']),
  })
  .partial()
  .strict();

export const createZoneSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio.').max(60),
    color: COLOR,
  })
  .strict();

export const updateZoneSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio.').max(60),
    color: COLOR,
    status: z.enum(['active', 'inactive']),
  })
  .partial()
  .strict();

export const createTableSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio.').max(60),
    capacityMin,
    capacityMax,
    zoneId: z.string().uuid('La zona no es válida.').nullable().optional(),
    xCm: position.optional(),
    yCm: position.optional(),
    widthCm: tableDimension.optional(),
    heightCm: tableDimension.optional(),
    shape: SHAPE.optional(),
    rotationDeg: ROTATION.optional(),
  })
  .strict()
  .refine((v) => v.capacityMax >= v.capacityMin, {
    message: 'La capacidad máxima no puede ser menor que la mínima.',
    path: ['capacityMax'],
  });

export const updateTableSchema = z
  .object({
    name: z.string().min(1, 'El nombre es obligatorio.').max(60),
    capacityMin,
    capacityMax,
    zoneId: z.string().uuid('La zona no es válida.').nullable(),
    xCm: position,
    yCm: position,
    widthCm: tableDimension,
    heightCm: tableDimension,
    shape: SHAPE,
    rotationDeg: ROTATION,
    status: z.enum(['active', 'inactive']),
  })
  .partial()
  .strict();

export const bulkCreateTablesSchema = z
  .object({
    count: z.number().int('La cantidad debe ser un número entero.').min(1, 'Como mínimo una mesa.').max(100, 'Como máximo 100 mesas por vez.'),
    capacityMin,
    capacityMax,
    prefix: z.string().min(1).max(30).optional(),
  })
  .strict()
  .refine((v) => v.capacityMax >= v.capacityMin, {
    message: 'La capacidad máxima no puede ser menor que la mínima.',
    path: ['capacityMax'],
  });

const planZone = z
  .object({
    id: z.string().uuid('El id de la zona no es válido.'),
    name: z.string().min(1, 'El nombre de la zona es obligatorio.').max(60),
    color: COLOR.optional(),
  })
  .strict();

const planTable = z
  .object({
    id: z.string().uuid('El id de la mesa no es válido.'),
    name: z.string().min(1, 'El nombre de la mesa es obligatorio.').max(60),
    capacityMin,
    capacityMax,
    zoneId: z.string().uuid('La zona no es válida.').nullable().optional(),
    xCm: position.optional(),
    yCm: position.optional(),
    widthCm: tableDimension.optional(),
    heightCm: tableDimension.optional(),
    shape: SHAPE.optional(),
    rotationDeg: ROTATION.optional(),
  })
  .strict();

export const saveFloorPlanSchema = z
  .object({
    expectedVersion: z.number().int('La versión esperada debe ser un entero.').min(0),
    floor: z
      .object({
        widthCm: floorDimension.optional(),
        heightCm: floorDimension.optional(),
      })
      .strict(),
    zones: z.array(planZone).max(200, 'Demasiadas zonas para un plano.').default([]),
    tables: z.array(planTable).max(500, 'Demasiadas mesas para un plano.').default([]),
    // La forma real de los elementos la valida `domain/plan-schema.ts`; aquí solo
    // se comprueba que sea una lista para no recorrerla dos veces con Zod.
    elements: z.array(z.unknown()).default([]),
  })
  .strict();

const shiftSchema = z
  .object({
    weekday: z.number().int().min(0, 'El día va de 0 (domingo) a 6 (sábado).').max(6, 'El día va de 0 (domingo) a 6 (sábado).'),
    opensAt: TIME,
    closesAt: TIME,
    label: z.string().max(40).nullable().optional(),
  })
  .strict();

export const saveScheduleSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    slotMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).optional(),
    cleanupMinutes: z.number().int().min(0).max(120).optional(),
    durationByPartySize: z
      .array(
        z
          .object({
            upTo: z.number().int().min(1).nullable(),
            minutes: z.number().int().min(15).max(480),
          })
          .strict(),
      )
      .optional(),
    shifts: z.array(shiftSchema),
  })
  .strict();

export const addScheduleExceptionSchema = z
  .object({
    onDate: LOCAL_DATE,
    kind: z.enum(['closed', 'special_hours']),
    opensAt: TIME.nullable().optional(),
    closesAt: TIME.nullable().optional(),
    reason: z.string().max(120).nullable().optional(),
  })
  .strict();

export function validateJson<T extends ZodSchema>(schema: T) {
  return zValidator('json', schema, (result) => {
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw new ValidationError(details);
    }
  });
}
