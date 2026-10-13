import { describe, expect, it } from 'vitest';
import { UUID, buildTestApp } from './helpers.js';

async function montar() {
  const { uow, request } = buildTestApp();
  const res = await request('POST', `/restaurant/establishments/${UUID.ESTABLISHMENT}/setup`);
  const body = (await res.json()) as { floor: { id: string }; schedule: { id: string } };
  return { uow, request, floorId: body.floor.id, scheduleId: body.schedule.id };
}

const base = `/restaurant/establishments/${UUID.ESTABLISHMENT}`;

describe('HTTP · inicialización y lectura', () => {
  it('el setup responde 200 con la planta y el horario', async () => {
    const { request } = buildTestApp();
    const res = await request('POST', `${base}/setup`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      floor: { name: 'Salón principal', layoutVersion: 0, status: 'active' },
      schedule: { timezone: 'America/Guayaquil', slotMinutes: 30 },
    });
  });

  it('el setup con un establecimiento inexistente responde 404', async () => {
    const { request } = buildTestApp({ establishment: 'missing' });
    const res = await request('POST', `${base}/setup`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND' });
  });

  it('listar plantas y abrir el plano devuelven la forma esperada', async () => {
    const { request, floorId } = await montar();

    const floors = await request('GET', `${base}/floors`);
    expect(floors.status).toBe(200);
    expect(((await floors.json()) as unknown[]).length).toBe(1);

    const plan = await request('GET', `/restaurant/floors/${floorId}/plan`);
    expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject({ floor: { id: floorId }, zones: [], tables: [], layout: { version: 0, elements: [] } });
  });

  it('una planta inexistente en el plano responde 404', async () => {
    const { request } = await montar();
    const res = await request('GET', `/restaurant/floors/${UUID.FLOOR2}/plan`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'FLOOR_NOT_FOUND' });
  });

  it('una ruta desconocida responde 404 con código NOT_FOUND', async () => {
    const { request } = buildTestApp();
    const res = await request('GET', '/restaurant/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('HTTP · mesas y zonas', () => {
  it('crear zona (201), crear mesa (201), listarlas y actualizarlas (200)', async () => {
    const { request, floorId } = await montar();

    const zona = await request('POST', `/restaurant/floors/${floorId}/zones`, { body: { name: 'Ventana', color: 'info' } });
    expect(zona.status).toBe(201);
    const zone = (await zona.json()) as { id: string };
    expect(zone).toMatchObject({ name: 'Ventana', color: 'info', status: 'active' });

    const mesa = await request('POST', `/restaurant/floors/${floorId}/tables`, {
      body: { name: 'Mesa 1', capacityMin: 2, capacityMax: 4, zoneId: zone.id },
    });
    expect(mesa.status).toBe(201);
    const table = (await mesa.json()) as { id: string };
    expect(table).toMatchObject({ name: 'Mesa 1', zoneId: zone.id, status: 'active', shape: 'rect' });

    const listado = await request('GET', `${base}/tables?floorId=${floorId}`);
    expect(listado.status).toBe(200);
    expect(((await listado.json()) as unknown[]).length).toBe(1);

    const patch = await request('PATCH', `/restaurant/tables/${table.id}`, { body: { name: 'Mesa 11', capacityMax: 6 } });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ name: 'Mesa 11', capacityMax: 6 });
  });

  it('la ruta fija `/tables/bulk` no la intercepta la ruta de mesa', async () => {
    const { request, floorId } = await montar();
    const res = await request('POST', `/restaurant/floors/${floorId}/tables/bulk`, {
      body: { count: 3, capacityMin: 2, capacityMax: 4 },
    });
    expect(res.status).toBe(201);
    const creadas = (await res.json()) as Array<{ name: string }>;
    expect(Array.isArray(creadas)).toBe(true);
    expect(creadas.map((t) => t.name)).toEqual(['Mesa 1', 'Mesa 2', 'Mesa 3']);
  });

  it('un nombre de mesa repetido responde 409 y una capacidad inválida, 422', async () => {
    const { request, floorId } = await montar();
    const body = { name: 'Mesa 1', capacityMin: 2, capacityMax: 4 };
    await request('POST', `/restaurant/floors/${floorId}/tables`, { body });
    const repetida = await request('POST', `/restaurant/floors/${floorId}/tables`, { body });
    expect(repetida.status).toBe(409);
    expect(await repetida.json()).toMatchObject({ code: 'TABLE_NAME_EXISTS' });

    const invalida = await request('POST', `/restaurant/floors/${floorId}/tables`, {
      body: { name: 'Mesa 2', capacityMin: 6, capacityMax: 2 },
    });
    expect(invalida.status).toBe(422);
    expect(await invalida.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('el cuerpo inválido de un PATCH de zona responde 422 con detalles', async () => {
    const { request, floorId } = await montar();
    const creada = await request('POST', `/restaurant/floors/${floorId}/zones`, { body: { name: 'Ventana' } });
    const zone = (await creada.json()) as { id: string };
    const res = await request('PATCH', `/restaurant/zones/${zone.id}`, { body: { color: 'morado' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('HTTP · horarios', () => {
  it('leer (200), guardar (200) y previsualizar turnos', async () => {
    const { request } = await montar();

    const antes = await request('GET', `${base}/schedule`);
    expect(antes.status).toBe(200);
    expect(await antes.json()).toMatchObject({ schedule: { slotMinutes: 30 }, shifts: [], exceptions: [] });

    const guardado = await request('PUT', `${base}/schedule`, {
      body: {
        slotMinutes: 30,
        shifts: [{ weekday: 2, opensAt: '12:00', closesAt: '15:00', label: 'Almuerzo' }],
      },
    });
    expect(guardado.status).toBe(200);
    expect(await guardado.json()).toMatchObject({ shifts: [{ weekday: 2, opensAt: '12:00', closesAt: '15:00', label: 'Almuerzo' }] });

    // 2026-10-13 es martes.
    const preview = await request('GET', `${base}/schedule/preview?date=2026-10-13`);
    expect(preview.status).toBe(200);
    const { slots } = (await preview.json()) as { slots: Array<{ startsAt: string }> };
    expect(slots.map((s) => s.startsAt)).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30']);
  });

  it('la vista previa exige el parámetro date', async () => {
    const { request } = await montar();
    const res = await request('GET', `${base}/schedule/preview`);
    expect(res.status).toBe(422);
  });

  it('un horario inválido responde 422 y no guarda nada', async () => {
    const { request } = await montar();
    const res = await request('PUT', `${base}/schedule`, {
      body: { shifts: [{ weekday: 2, opensAt: '15:00', closesAt: '12:00' }] },
    });
    expect(res.status).toBe(422);
    const detalle = await request('GET', `${base}/schedule`);
    expect(await detalle.json()).toMatchObject({ shifts: [] });
  });

  it('crea (201) y borra (204) una excepción; repetir la fecha responde 409', async () => {
    const { request } = await montar();
    const body = { onDate: '2026-12-25', kind: 'closed', reason: 'Navidad' };

    const creada = await request('POST', `${base}/schedule/exceptions`, { body });
    expect(creada.status).toBe(201);
    const exception = (await creada.json()) as { id: string };
    expect(exception).toMatchObject({ onDate: '2026-12-25', kind: 'closed', reason: 'Navidad' });

    const repetida = await request('POST', `${base}/schedule/exceptions`, { body });
    expect(repetida.status).toBe(409);
    expect(await repetida.json()).toMatchObject({ code: 'SCHEDULE_EXCEPTION_EXISTS' });

    const borrada = await request('DELETE', `/restaurant/schedule/exceptions/${exception.id}`);
    expect(borrada.status).toBe(204);

    const otraVez = await request('DELETE', `/restaurant/schedule/exceptions/${exception.id}`);
    expect(otraVez.status).toBe(404);
  });
});

describe('HTTP · guardar el plano completo', () => {
  it('guarda plano, zonas y mesas, y sube la versión', async () => {
    const { request, floorId } = await montar();
    const res = await request('PUT', `/restaurant/floors/${floorId}/plan`, {
      body: {
        expectedVersion: 0,
        floor: { widthCm: 1200, heightCm: 900 },
        zones: [{ id: UUID.ZONE, name: 'Ventana', color: 'info' }],
        tables: [{ id: UUID.TABLE, name: 'Mesa 1', capacityMin: 2, capacityMax: 4, zoneId: UUID.ZONE, xCm: 100, yCm: 100 }],
        elements: [{ id: 'w1', type: 'wall', x1: 0, y1: 0, x2: 1200, y2: 0 }],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: floorId, layoutVersion: 1, widthCm: 1200 });

    const conflicto = await request('PUT', `/restaurant/floors/${floorId}/plan`, {
      body: { expectedVersion: 0, floor: {}, zones: [], tables: [], elements: [] },
    });
    expect(conflicto.status).toBe(409);
    expect(await conflicto.json()).toMatchObject({ code: 'PLAN_VERSION_CONFLICT' });
  });

  it('acepta un cuerpo de plano grande (~200 KB) sin cortarlo', async () => {
    const { request, floorId } = await montar();
    const long = (char: string, n: number) => char.repeat(n);

    const elements = Array.from({ length: 500 }, (_, i) => ({
      id: long('e', 40) + String(i).padStart(20, '0'),
      type: 'object',
      kind: 'plant',
      x: 0,
      y: 0,
      widthCm: 10,
      heightCm: 10,
      rotationDeg: 0,
      label: long('p', 60),
    }));
    const tables = Array.from({ length: 500 }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
      name: long('M', 40) + String(i).padStart(19, '0'),
      capacityMin: 2,
      capacityMax: 4,
      xCm: 0,
      yCm: 0,
    }));

    const body = { expectedVersion: 0, floor: {}, zones: [], tables, elements };
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    expect(bytes).toBeGreaterThan(150 * 1024);
    expect(Buffer.byteLength(JSON.stringify(elements), 'utf8')).toBeLessThan(256 * 1024);

    const res = await request('PUT', `/restaurant/floors/${floorId}/plan`, { body });
    expect(res.status).toBe(200);
  });
});
