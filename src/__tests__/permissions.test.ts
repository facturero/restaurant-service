import { describe, expect, it } from 'vitest';
import { UUID, buildTestApp } from './helpers.js';

const EST = UUID.ESTABLISHMENT;
const FLOOR = UUID.FLOOR;
const READ = ['restaurant:read'];
const MANAGE = ['restaurant:manage'];

const LECTURAS: Array<[string, string]> = [
  ['GET', `/restaurant/establishments/${EST}/floors`],
  ['GET', `/restaurant/floors/${FLOOR}/plan`],
  ['GET', `/restaurant/establishments/${EST}/tables`],
  ['GET', `/restaurant/floors/${FLOOR}/zones`],
  ['GET', `/restaurant/establishments/${EST}/schedule`],
  ['GET', `/restaurant/establishments/${EST}/schedule/preview?date=2026-10-20`],
];

const ESCRITURAS: Array<[string, string, unknown]> = [
  ['POST', `/restaurant/establishments/${EST}/setup`, undefined],
  ['PUT', `/restaurant/floors/${FLOOR}/plan`, { expectedVersion: 0, floor: {}, zones: [], tables: [], elements: [] }],
  ['PATCH', `/restaurant/floors/${FLOOR}`, { name: 'Otro nombre' }],
  ['POST', `/restaurant/floors/${FLOOR}/tables/bulk`, { count: 1, capacityMin: 1, capacityMax: 2 }],
  ['POST', `/restaurant/floors/${FLOOR}/tables`, { name: 'Mesa 1', capacityMin: 2, capacityMax: 4 }],
  ['PATCH', `/restaurant/tables/${UUID.TABLE}`, { name: 'Mesa 2' }],
  ['POST', `/restaurant/floors/${FLOOR}/zones`, { name: 'Ventana' }],
  ['PATCH', `/restaurant/zones/${UUID.ZONE}`, { name: 'Terraza' }],
  ['PUT', `/restaurant/establishments/${EST}/schedule`, { shifts: [] }],
  ['POST', `/restaurant/establishments/${EST}/schedule/exceptions`, { onDate: '2026-12-25', kind: 'closed' }],
  ['DELETE', `/restaurant/schedule/exceptions/${UUID.TABLE2}`, undefined],
];

describe('permisos', () => {
  it('sin `restaurant:read`, todas las lecturas responden 403', async () => {
    const { request } = buildTestApp();
    for (const [method, path] of LECTURAS) {
      const res = await request(method, path, { permissions: 'otro:permiso' });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('con `restaurant:read` las lecturas pasan el control de permisos', async () => {
    const { request } = buildTestApp();
    for (const [method, path] of LECTURAS) {
      const res = await request(method, path, { permissions: READ.join(',') });
      expect(res.status, `${method} ${path}`).not.toBe(403);
    }
  });

  it('sin `restaurant:manage`, todas las escrituras responden 403', async () => {
    const { request } = buildTestApp();
    for (const [method, path, body] of ESCRITURAS) {
      const res = await request(method, path, { permissions: READ.join(','), body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('con `restaurant:manage` las escrituras pasan el control de permisos', async () => {
    const { request } = buildTestApp();
    for (const [method, path, body] of ESCRITURAS) {
      const res = await request(method, path, { permissions: MANAGE.join(','), body });
      expect(res.status, `${method} ${path}`).not.toBe(403);
    }
  });

  it('sin organización en la cabecera responde 401 de contexto (antes que el permiso)', async () => {
    const { request } = buildTestApp();
    const res = await request('GET', `/restaurant/floors/${FLOOR}/plan`, { organizationId: null, permissions: READ.join(',') });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'ORG_CONTEXT_REQUIRED' });
  });

  it('un token sin permisos tampoco es un 500: es 403 con código FORBIDDEN', async () => {
    const { request } = buildTestApp();
    const res = await request('GET', `/restaurant/floors/${FLOOR}/plan`, { permissions: '' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});
