import { describe, expect, it } from 'vitest';
import {
  MAX_PLAN_BYTES,
  MAX_PLAN_ELEMENTS,
  parsePlanElements,
  type PlanElement,
} from '../domain/plan-schema.js';
import { InvalidPlanError } from '../domain/errors.js';

function wall(overrides: Partial<Extract<PlanElement, { type: 'wall' }>> = {}): PlanElement {
  return { id: 'w1', type: 'wall', x1: 0, y1: 0, x2: 400, y2: 0, thicknessCm: 10, ...overrides };
}

describe('esquema del plano', () => {
  it('acepta un plano válido con pared, puerta y objeto', () => {
    const elements = parsePlanElements([
      wall(),
      { id: 'd1', type: 'door', x: 200, y: 0, widthCm: 90, rotationDeg: 0 },
      { id: 'o1', type: 'object', kind: 'bar', x: 100, y: 100, widthCm: 200, heightCm: 80, rotationDeg: 90, label: 'Barra' },
    ]);
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ type: 'wall' });
  });

  it('rechaza un tipo de elemento desconocido', () => {
    expect(() => parsePlanElements([{ id: 'x', type: 'sofa', x: 0, y: 0 }])).toThrow(InvalidPlanError);
  });

  it('rechaza una coordenada fuera de rango', () => {
    expect(() => parsePlanElements([wall({ x1: 100_001 })])).toThrow(InvalidPlanError);
    expect(() => parsePlanElements([wall({ y2: -1 })])).toThrow(InvalidPlanError);
  });

  it('rechaza una pared de longitud cero (mismo punto de inicio y fin)', () => {
    expect(() => parsePlanElements([wall({ x1: 50, y1: 50, x2: 50, y2: 50 })])).toThrow(InvalidPlanError);
  });

  it('rechaza ids repetidos', () => {
    expect(() => parsePlanElements([wall({ id: 'dup' }), wall({ id: 'dup', x2: 100 })])).toThrow(InvalidPlanError);
  });

  it('rechaza más de 500 elementos', () => {
    const elements = Array.from({ length: MAX_PLAN_ELEMENTS + 1 }, (_, i) => wall({ id: `w${i}`, x2: i % 100 }));
    // El tamaño en bytes debe seguir por debajo del límite: lo que salta es el máximo de elementos.
    expect(Buffer.byteLength(JSON.stringify(elements), 'utf8')).toBeLessThan(MAX_PLAN_BYTES);
    expect(() => parsePlanElements(elements)).toThrow(InvalidPlanError);
  });

  it('rechaza un JSON de plano de más de 256 KB (antes de recorrerlo)', () => {
    const elements = Array.from({ length: 4000 }, (_, i) => wall({ id: `w${i}`, x2: i % 1000 }));
    expect(Buffer.byteLength(JSON.stringify(elements), 'utf8')).toBeGreaterThan(MAX_PLAN_BYTES);
    try {
      parsePlanElements(elements);
      expect.unreachable('debía lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPlanError);
      expect((err as InvalidPlanError).details?.some((d) => /KB/.test(d.message))).toBe(true);
    }
  });

  it('rechaza un cuerpo que no es una lista', () => {
    expect(() => parsePlanElements({ elements: [] })).toThrow(InvalidPlanError);
  });

  it('aplica los valores por defecto del esquema (grosor de pared)', () => {
    const [element] = parsePlanElements([{ id: 'w1', type: 'wall', x1: 0, y1: 0, x2: 10, y2: 0 }]);
    expect(element).toMatchObject({ thicknessCm: 10 });
  });
});
