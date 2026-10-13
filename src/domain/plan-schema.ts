import { z } from 'zod';
import { InvalidPlanError, type ErrorDetail } from './errors.js';

/**
 * Esquema puro de `floors.layout_elements`: paredes, puertas y objetos
 * decorativos. Es un documento (nadie los referencia desde otra tabla), por eso
 * vive en JSON y se versiona con `layout_version`.
 *
 * Coordenadas en centímetros enteros (0–100 000 = hasta 1 km de local).
 */

export const MAX_PLAN_ELEMENTS = 500;
export const MAX_PLAN_BYTES = 256 * 1024;
export const MAX_COORD = 100_000;

const coordinate = z.number().int().min(0).max(MAX_COORD);
const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const elementId = z.string().min(1).max(64);

const wallSchema = z
  .object({
    id: elementId,
    type: z.literal('wall'),
    x1: coordinate,
    y1: coordinate,
    x2: coordinate,
    y2: coordinate,
    thicknessCm: z.number().int().min(1).max(100).default(10),
  })
  .strict();

const doorSchema = z
  .object({
    id: elementId,
    type: z.literal('door'),
    x: coordinate,
    y: coordinate,
    widthCm: z.number().int().min(20).max(2000),
    rotationDeg: rotation,
  })
  .strict();

export const OBJECT_KINDS = ['bar', 'column', 'restroom', 'kitchen', 'plant', 'stairs', 'entrance'] as const;

const objectSchema = z
  .object({
    id: elementId,
    type: z.literal('object'),
    kind: z.enum(OBJECT_KINDS),
    x: coordinate,
    y: coordinate,
    widthCm: z.number().int().min(10).max(MAX_COORD),
    heightCm: z.number().int().min(10).max(MAX_COORD),
    rotationDeg: rotation,
    label: z.string().max(60).optional(),
  })
  .strict();

export const planElementSchema = z.discriminatedUnion('type', [wallSchema, doorSchema, objectSchema]);
export type PlanElement = z.infer<typeof planElementSchema>;

export function emptyPlan(): PlanElement[] {
  return [];
}

/**
 * Valida y normaliza los elementos del plano. El chequeo de tamaño va PRIMERO:
 * un cuerpo enorme se descarta antes de recorrerlo con Zod.
 */
export function parsePlanElements(input: unknown): PlanElement[] {
  if (!Array.isArray(input)) {
    throw new InvalidPlanError([{ field: 'elements', message: 'Los elementos del plano deben ser una lista.' }]);
  }

  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > MAX_PLAN_BYTES) {
    throw new InvalidPlanError([
      { field: 'elements', message: `El plano ocupa ${Math.ceil(bytes / 1024)} KB y el máximo son 256 KB.` },
    ]);
  }

  const parsed = z.array(planElementSchema).max(MAX_PLAN_ELEMENTS).safeParse(input);
  if (!parsed.success) {
    throw new InvalidPlanError(
      parsed.error.issues.map((issue) => ({
        field: `elements.${issue.path.join('.')}` || 'elements',
        message: issue.message,
      })),
    );
  }

  const elements = parsed.data;

  const details: ErrorDetail[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (seen.has(element.id)) {
      details.push({ field: 'elements', message: `Hay ids repetidos en el plano: ${element.id}.` });
    }
    seen.add(element.id);
    if (element.type === 'wall' && element.x1 === element.x2 && element.y1 === element.y2) {
      details.push({ field: `elements.${element.id}`, message: 'La pared debe tener longitud mayor que cero.' });
    }
  }
  if (details.length > 0) throw new InvalidPlanError(details);

  return elements;
}
