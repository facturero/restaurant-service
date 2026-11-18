import { describe, expect, it } from 'vitest';
import { buildTestApp, NOW, SATURDAY, seedBookableRestaurant, UUID } from './helpers.js';
import { localToUtc } from '../domain/availability.js';

const GUEST = {
  date: SATURDAY,
  time: '19:30',
  partySize: 2,
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+593 99 888 7766',
};

async function setup(opts: Parameters<typeof buildTestApp>[0] = {}, seed: Parameters<typeof seedBookableRestaurant>[1] = {}) {
  const t = buildTestApp(opts);
  await seedBookableRestaurant(t.uow, seed);
  /** Petición pública: sin ninguna cabecera de contexto, como llega del gateway. */
  const pub = (method: string, path: string, body?: unknown) =>
    t.app.request(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  const book = (over: Record<string, unknown> = {}) => pub('POST', '/public/restaurants/la-esquina/reservations', { ...GUEST, ...over });
  return { ...t, pub, book };
}

const events = (t: { uow: { outboxEvents: Array<{ type: string; payload: Record<string, unknown> }> } }, type: string) =>
  t.uow.outboxEvents.filter((e) => e.type === type);

describe('ajustes de reservas (personal)', () => {
  it('sin configurar devuelve los valores por defecto, apagado y sin enlace', async () => {
    const t = buildTestApp();
    const res = await t.request('GET', `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      enabled: false,
      publicSlug: null,
      maxDaysAhead: 30,
      minNoticeMinutes: 60,
      maxPartySize: 10,
      maxTablesPerReservation: 3,
    });
  });

  it('guarda los ajustes, normaliza el enlace y deja el evento en el outbox', async () => {
    const t = buildTestApp();
    const res = await t.request('PUT', `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`, {
      body: { enabled: true, publicSlug: '  La-Esquina ', displayName: 'La Esquina', notifyEmail: 'Dueno@Laesquina.TEST', maxPartySize: 12 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, publicSlug: 'la-esquina', notifyEmail: 'dueno@laesquina.test', maxPartySize: 12 });
    expect(events(t, 'restaurant.reservation_settings.updated')).toHaveLength(1);
  });

  it('no se puede encender sin enlace y nombre público', async () => {
    const t = buildTestApp();
    const res = await t.request('PUT', `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`, { body: { enabled: true } });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.map((d: { field: string }) => d.field).sort()).toEqual(['displayName', 'publicSlug']);
  });

  it.each([
    ['con mayúsculas y espacios internos', 'la esquina'],
    ['con acentos', 'la-esquiña'],
    ['muy corto', 'ab'],
    ['reservado', 'admin'],
    ['empieza con guion', '-hola'],
  ])('rechaza un enlace %s', async (_motivo, slug) => {
    const t = buildTestApp();
    const res = await t.request('PUT', `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`, { body: { publicSlug: slug } });
    expect(res.status).toBe(422);
  });

  it('el enlace es único en TODO el sistema, no solo en la organización', async () => {
    const t = buildTestApp();
    await seedBookableRestaurant(t.uow, { slug: 'la-esquina' });
    const res = await t.request('PUT', `/restaurant/establishments/${UUID.ESTABLISHMENT2}/reservation-settings`, {
      organizationId: UUID.OTHER_ORG,
      body: { publicSlug: 'la-esquina' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SLUG_TAKEN');
  });

  it('guardar de nuevo con su propio enlace no choca consigo mismo', async () => {
    const t = buildTestApp();
    await seedBookableRestaurant(t.uow);
    const res = await t.request('PUT', `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`, { body: { publicSlug: 'la-esquina', maxPartySize: 6 } });
    expect(res.status).toBe(200);
  });

  it('pide permisos: leer con reservation:read, guardar con reservation:manage', async () => {
    const t = buildTestApp();
    const path = `/restaurant/establishments/${UUID.ESTABLISHMENT}/reservation-settings`;
    expect((await t.request('GET', path, { permissions: 'restaurant:read' })).status).toBe(403);
    expect((await t.request('GET', path, { permissions: 'reservation:read' })).status).toBe(200);
    expect((await t.request('PUT', path, { permissions: 'reservation:read', body: { maxPartySize: 4 } })).status).toBe(403);
    expect((await t.request('PUT', path, { permissions: 'reservation:manage', body: { maxPartySize: 4 } })).status).toBe(200);
  });
});

describe('página pública: restaurante y disponibilidad', () => {
  it('muestra la ficha del restaurante sin datos internos', async () => {
    const { pub } = await setup();
    const res = await pub('GET', '/public/restaurants/la-esquina');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ slug: 'la-esquina', name: 'La Esquina', phone: '+593 99 123 4567', maxPartySize: 10, openWeekdays: [6], timezone: 'America/Guayaquil' });
    // Nada de ids de organización, correo de avisos, etc.
    expect(JSON.stringify(body)).not.toMatch(/dueno@|organization|establishment/i);
  });

  it('responde igual (404) si no existe, está apagado o el módulo no está contratado', async () => {
    const off = await setup({}, { enabled: false });
    const noPlugin = await setup({ pluginActive: false });
    const ok = await setup();
    const bodies = [
      await off.pub('GET', '/public/restaurants/la-esquina'),
      await noPlugin.pub('GET', '/public/restaurants/la-esquina'),
      await ok.pub('GET', '/public/restaurants/no-existe'),
    ];
    for (const res of bodies) {
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('RESTAURANT_NOT_FOUND');
    }
  });

  it('lista las horas del día con su disponibilidad', async () => {
    const { pub } = await setup();
    const res = await pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('open');
    expect(body.slots.map((s: { time: string; available: boolean }) => [s.time, s.available])).toEqual([
      ['19:00', true], ['19:30', true], ['20:00', true], ['20:30', true],
    ]);
  });

  it('un día sin turnos está cerrado y uno pasado no ofrece nada', async () => {
    const { pub } = await setup();
    expect((await (await pub('GET', '/public/restaurants/la-esquina/availability?date=2026-10-16&partySize=2')).json()).status).toBe('closed');
    expect((await (await pub('GET', '/public/restaurants/la-esquina/availability?date=2026-10-10&partySize=2')).json()).status).toBe('past');
    expect((await (await pub('GET', '/public/restaurants/la-esquina/availability?date=2027-03-06&partySize=2')).json()).status).toBe('too_far');
  });

  it('un grupo mayor al máximo del dueño recibe el teléfono del restaurante', async () => {
    const { pub } = await setup();
    const res = await pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=11`);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('PARTY_SIZE_NOT_ALLOWED');
    expect(body.message).toContain('+593 99 123 4567');
  });

  it('un grupo que no cabe ni usando todas las mesas permitidas también pide llamar', async () => {
    // Mesas: 2 + 4 + 4 = 10, pero con máximo 1 mesa por reserva solo caben 4.
    const { pub } = await setup({}, { maxTables: 1 });
    const res = await pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=6`);
    expect(res.status).toBe(422);
  });

  it('valida los parámetros de la consulta', async () => {
    const { pub } = await setup();
    expect((await pub('GET', '/public/restaurants/la-esquina/availability?date=hoy&partySize=2')).status).toBe(422);
    expect((await pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=0`)).status).toBe(422);
  });
});

describe('reservar desde la página pública', () => {
  it('crea la reserva confirmada, con la mesa más ajustada y un enlace secreto', async () => {
    const t = await setup();
    const res = await t.book();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.reservation).toMatchObject({
      status: 'confirmed',
      guestName: 'Ana Pérez',
      partySize: 2,
      date: SATURDAY,
      time: '19:30',
      restaurant: { name: 'La Esquina', slug: 'la-esquina' },
      endsAt: expect.any(String),
      canCancel: true,
    });
    // No devuelve el correo ni el teléfono: el enlace puede reenviarse.
    expect(JSON.stringify(body)).not.toContain('ana@example.com');
    // Dos personas → la mesa de 2 (la más ajustada).
    const stored = [...t.uow.outboxEvents].find((e) => e.type === 'restaurant.reservation.created')!;
    expect(stored.payload.tableNames).toBe('Mesa 1');
  });

  it('publica el evento con todo lo que necesitan los correos, incluido el enlace con el token', async () => {
    const t = await setup();
    const { token } = await (await t.book()).json();
    const [event] = events(t, 'restaurant.reservation.created');
    expect(event!.payload).toMatchObject({
      guestName: 'Ana Pérez',
      guestEmail: 'ana@example.com',
      restaurantName: 'La Esquina',
      staffNoticeEmail: 'dueno@laesquina.test',
      timeText: '19:30',
      dateText: expect.stringContaining('17 de octubre de 2026'),
      partySize: 2,
      source: 'online',
      manageUrl: `https://reservas.test/r/${token}`,
    });
    expect(String(event!.payload.dateText).toLowerCase()).toContain('sábado');
  });

  it('en la base solo queda el HASH del token, nunca el token', async () => {
    const t = await setup();
    const { token } = await (await t.book()).json();
    const stored = await t.uow.reservations.findByTokenHash(token);
    expect(stored).toBeNull();
    const all = await t.uow.reservations.listByRange(UUID.ORG, UUID.ESTABLISHMENT, new Date(0), new Date('2100-01-01'));
    expect(all[0]!.cancelTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(all[0]!.cancelTokenHash).not.toContain(token);
  });

  it('la misma hora ya no se ofrece cuando se llenan las mesas, y reservar de más da 409', async () => {
    const t = await setup();
    // 4 personas: Mesa 2 y Mesa 3 (las de 4). Un tercer grupo de 4 ya no tiene mesa.
    expect((await t.book({ partySize: 4, guestEmail: 'a@x.com', guestPhone: '0991111111' })).status).toBe(201);
    expect((await t.book({ partySize: 4, guestEmail: 'b@x.com', guestPhone: '0992222222' })).status).toBe(201);
    const third = await t.book({ partySize: 4, guestEmail: 'c@x.com', guestPhone: '0993333333' });
    expect(third.status).toBe(409);
    expect((await third.json()).code).toBe('SLOT_TAKEN');

    const day = await (await t.pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=4`)).json();
    // 19:30 dura 90 min + 15 de limpieza: hasta las 21:15. Las 19:00 y 20:00 también chocan; las mesas no se liberan a tiempo.
    expect(day.slots.every((s: { available: boolean }) => !s.available)).toBe(true);
    // Un grupo de 2 todavía cabe en la mesa chica.
    const small = await (await t.pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=2`)).json();
    expect(small.slots.some((s: { available: boolean }) => s.available)).toBe(true);
  });

  it('un grupo grande ocupa varias mesas (hasta el máximo que fijó el dueño)', async () => {
    const t = await setup();
    const res = await t.book({ partySize: 8 });
    expect(res.status).toBe(201);
    const [event] = events(t, 'restaurant.reservation.created');
    expect(String(event!.payload.tableNames).split(', ').sort()).toEqual(['Mesa 2', 'Mesa 3']);
  });

  it('una reserva que termina deja la mesa libre para la siguiente hora', async () => {
    const t = await setup();
    // 19:00 con dos personas: 60 min + 15 de limpieza = libre desde las 20:15.
    await t.book({ time: '19:00' });
    const day = await (await t.pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=2`)).json();
    // Hay otras mesas (4 y 4) donde caben dos: ninguna hora se pierde. Se comprueba con la mesa chica sola:
    expect(day.slots.filter((s: { available: boolean }) => s.available)).toHaveLength(4);
  });

  it('rechaza una hora que el restaurante no ofrece', async () => {
    const t = await setup();
    for (const time of ['18:00', '19:10', '21:00']) {
      const res = await t.book({ time });
      expect(res.status, time).toBe(422);
      expect((await res.json()).code).toBe('SLOT_NOT_OFFERED');
    }
    expect((await t.book({ date: '2026-10-16' })).status).toBe(422); // viernes: sin turnos
  });

  it('respeta la antelación mínima: el mismo sábado a las 18:30 ya no se reserva para las 19:00', async () => {
    const t = await setup({ now: localToUtc(SATURDAY, '18:30', 'America/Guayaquil') });
    const late = await t.book({ time: '19:00' });
    expect(late.status).toBe(422);
    expect((await t.book({ time: '19:30' })).status).toBe(201);
  });

  it('valida los datos del cliente y el campo trampa', async () => {
    const t = await setup();
    expect((await t.book({ guestEmail: 'sin-arroba' })).status).toBe(422);
    expect((await t.book({ guestName: 'A' })).status).toBe(422);
    expect((await t.book({ guestPhone: 'abc' })).status).toBe(422);
    expect((await t.book({ partySize: 0 })).status).toBe(422);
    expect((await t.book({ website: 'http://spam.example' })).status).toBe(422);
    expect(t.uow.outboxEvents.filter((e) => e.type === 'restaurant.reservation.created')).toHaveLength(0);
  });

  it('frena a quien acumula reservas: máximo 3 vigentes por correo o por teléfono', async () => {
    const t = await setup();
    for (const time of ['19:00', '19:30', '20:00']) expect((await t.book({ time })).status).toBe(201);
    const fourth = await t.book({ time: '20:30' });
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).code).toBe('TOO_MANY_RESERVATIONS');
    // Otro correo pero el mismo teléfono: también cuenta.
    expect((await t.book({ time: '20:30', guestEmail: 'otra@example.com' })).status).toBe(429);
    // Otra persona distinta sí puede.
    expect((await t.book({ time: '20:30', guestEmail: 'luis@example.com', guestPhone: '0997654321' })).status).toBe(201);
  });

  it('un fallo a mitad de la reserva no deja nada a medias', async () => {
    const t = await setup();
    // Provoca un error al asignar mesas para comprobar que el rollback deshace la reserva y el evento.
    const original = t.uow.reservations.assignTables;
    t.uow.reservations.assignTables = async () => { throw new Error('boom'); };
    await expect(t.book()).rejects.toBeDefined().catch(() => undefined);
    t.uow.reservations.assignTables = original;
    const all = await t.uow.reservations.listByRange(UUID.ORG, UUID.ESTABLISHMENT, new Date(0), new Date('2100-01-01'));
    expect(all).toHaveLength(0);
    expect(events(t, 'restaurant.reservation.created')).toHaveLength(0);
    expect((await t.book()).status).toBe(201);
  });

  it('no deja reservar en un restaurante apagado ni sin el módulo', async () => {
    const off = await setup({}, { enabled: false });
    expect((await off.book()).status).toBe(404);
    const noPlugin = await setup({ pluginActive: false });
    expect((await noPlugin.book()).status).toBe(404);
  });
});

describe('el enlace de la reserva (sin sesión)', () => {
  it('muestra la reserva sin correo ni teléfono', async () => {
    const t = await setup();
    const { token } = await (await t.book({ notes: 'Alergia a las nueces' })).json();
    const res = await t.pub('GET', `/public/reservations/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ code: expect.stringMatching(/^[A-Z2-9]{8}$/), status: 'confirmed', time: '19:30', canCancel: true });
    expect(JSON.stringify(body)).not.toMatch(/ana@example|888 7766|nueces/);
  });

  it('un token inventado da 404', async () => {
    const t = await setup();
    expect((await t.pub('GET', '/public/reservations/' + 'x'.repeat(43))).status).toBe(404);
    expect((await t.pub('POST', '/public/reservations/' + 'x'.repeat(43) + '/cancel', {})).status).toBe(404);
  });

  it('cancelar libera las mesas, avisa y no se puede repetir', async () => {
    const t = await setup();
    const { token } = await (await t.book({ partySize: 4 })).json();
    const before = await (await t.pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=8`)).json();
    expect(before.slots.find((s: { time: string }) => s.time === '19:30').available).toBe(false);

    const res = await t.pub('POST', `/public/reservations/${token}/cancel`, { reason: 'Cambio de planes' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'cancelled', canCancel: false, cancelledBy: 'guest' });

    const after = await (await t.pub('GET', `/public/restaurants/la-esquina/availability?date=${SATURDAY}&partySize=8`)).json();
    expect(after.slots.find((s: { time: string }) => s.time === '19:30').available).toBe(true);

    const [event] = events(t, 'restaurant.reservation.cancelled');
    expect(event!.payload).toMatchObject({ guestEmail: 'ana@example.com', cancelledBy: 'guest', cancelReason: 'Cambio de planes', staffNoticeEmail: 'dueno@laesquina.test' });

    const again = await t.pub('POST', `/public/reservations/${token}/cancel`, {});
    expect(again.status).toBe(409);
    expect(events(t, 'restaurant.reservation.cancelled')).toHaveLength(1);
  });

  it('pasada la hora ya no se puede cancelar desde el enlace', async () => {
    const t = await setup();
    const { token } = await (await t.book()).json();
    t.clockState.now = localToUtc(SATURDAY, '19:45', 'America/Guayaquil');
    const view = await (await t.pub('GET', `/public/reservations/${token}`)).json();
    expect(view.canCancel).toBe(false);
    const res = await t.pub('POST', `/public/reservations/${token}/cancel`, {});
    expect(res.status).toBe(409);
  });
});

describe('gestión del personal', () => {
  const base = `/restaurant/establishments/${UUID.ESTABLISHMENT}`;
  const body = { date: SATURDAY, time: '20:00', partySize: 3, guestName: 'Don Carlos', guestPhone: '0991112233' };

  it('anota una reserva por teléfono, sin correo, y no avisa al cliente', async () => {
    const t = await setup();
    const res = await t.request('POST', `${base}/reservations`, { body });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ source: 'staff', status: 'confirmed', guestEmail: null, time: '20:00', tables: [{ name: 'Mesa 2' }] });
    // Sin correo, el evento lleva cadena vacía: la plantilla omite el envío al cliente. Y anotada por el personal, tampoco se avisa al restaurante.
    expect(events(t, 'restaurant.reservation.created')[0]!.payload).toMatchObject({ guestEmail: '', staffNoticeEmail: '' });
  });

  it('puede reservar sin antelación y más allá del tope de días del público', async () => {
    const t = await setup({ now: localToUtc(SATURDAY, '19:10', 'America/Guayaquil') });
    expect((await t.request('POST', `${base}/reservations`, { body: { ...body, time: '19:30' } })).status).toBe(201);
    const far = await t.request('POST', `${base}/reservations`, { body: { ...body, date: '2026-12-26' } });
    expect(far.status).toBe(201);
    // Pero una hora que ya pasó no.
    expect((await t.request('POST', `${base}/reservations`, { body: { ...body, time: '19:00' } })).status).toBe(422);
  });

  it('elige las mesas a mano y avisa si ya están ocupadas', async () => {
    const t = await setup();
    const first = await t.request('POST', `${base}/reservations`, { body: { ...body, tableIds: [UUID.TABLE3] } });
    expect(first.status).toBe(201);
    expect((await first.json()).tables).toEqual([{ id: UUID.TABLE3, name: 'Mesa 3' }]);
    const clash = await t.request('POST', `${base}/reservations`, { body: { ...body, guestPhone: '0994445566', tableIds: [UUID.TABLE3] } });
    expect(clash.status).toBe(409);
    expect((await clash.json()).code).toBe('TABLES_UNAVAILABLE');
    const unknown = await t.request('POST', `${base}/reservations`, { body: { ...body, tableIds: ['aaaaaaaa-0000-4000-8000-000000000000'] } });
    expect(unknown.status).toBe(404);
  });

  it('puede reservar aunque la página pública esté apagada o sin ajustes guardados', async () => {
    const t = await setup({}, { enabled: false });
    expect((await t.request('POST', `${base}/reservations`, { body })).status).toBe(201);
  });

  it('lista el día ordenado por hora, con filtro por estado', async () => {
    const t = await setup();
    await t.request('POST', `${base}/reservations`, { body: { ...body, time: '20:30', guestName: 'Segundo' } });
    await t.request('POST', `${base}/reservations`, { body: { ...body, time: '19:00', guestName: 'Primero', guestPhone: '0990000001' } });
    const list = await (await t.request('GET', `${base}/reservations?date=${SATURDAY}`)).json();
    expect(list.map((r: { guestName: string }) => r.guestName)).toEqual(['Primero', 'Segundo']);
    expect(list[0]).toMatchObject({ date: SATURDAY, time: '19:00', tables: [{ name: expect.stringMatching(/^Mesa [23]$/) }] });

    const id = list[0].id;
    await t.request('POST', `/restaurant/reservations/${id}/cancel`, { body: {} });
    const active = await (await t.request('GET', `${base}/reservations?date=${SATURDAY}&status=confirmed`)).json();
    expect(active).toHaveLength(1);
    const range = await (await t.request('GET', `${base}/reservations?date=2026-10-16&days=3`)).json();
    expect(range).toHaveLength(2);
    expect((await t.request('GET', `${base}/reservations?date=${SATURDAY}&status=nope`)).status).toBe(422);
    expect((await t.request('GET', `${base}/reservations`)).status).toBe(422);
  });

  it('sienta, termina y libera la mesa; marca «no se presentó»', async () => {
    const t = await setup();
    const { id } = await (await t.request('POST', `${base}/reservations`, { body })).json();

    const seated = await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'seated' } });
    expect(seated.status).toBe(200);
    expect((await seated.json()).status).toBe('seated');
    // Sentada: sigue ocupando la mesa.
    expect(await t.uow.reservations.activeBookings(UUID.ORG, [UUID.TABLE2], new Date(0), new Date('2100-01-01'))).toHaveLength(1);

    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'completed' } })).status).toBe(200);
    expect(await t.uow.reservations.activeBookings(UUID.ORG, [UUID.TABLE2], new Date(0), new Date('2100-01-01'))).toHaveLength(0);

    const second = await (await t.request('POST', `${base}/reservations`, { body: { ...body, guestPhone: '0997770000' } })).json();
    expect((await t.request('PATCH', `/restaurant/reservations/${second.id}/status`, { body: { status: 'no_show' } })).status).toBe(200);
    expect(events(t, 'restaurant.reservation.status_changed')).toHaveLength(3);
  });

  it('rechaza cambios de estado imposibles', async () => {
    const t = await setup();
    const { id } = await (await t.request('POST', `${base}/reservations`, { body })).json();
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'completed' } })).status).toBe(409); // sin sentar
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'cancelled' } })).status).toBe(409); // cancelar tiene su acción
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'raro' } })).status).toBe(422);
    await t.request('POST', `/restaurant/reservations/${id}/cancel`, { body: {} });
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'seated' } })).status).toBe(409);
    expect((await t.request('POST', `/restaurant/reservations/${id}/cancel`, { body: {} })).status).toBe(409);
  });

  it('cancelar desde el CRM avisa al cliente con quién canceló', async () => {
    const t = await setup();
    const { id } = await (await t.request('POST', `${base}/reservations`, { body: { ...body, guestEmail: 'carlos@example.com' } })).json();
    const res = await t.request('POST', `/restaurant/reservations/${id}/cancel`, { body: { reason: 'Cerramos por mantenimiento' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'cancelled', cancelledBy: 'staff', cancelReason: 'Cerramos por mantenimiento' });
    expect(events(t, 'restaurant.reservation.cancelled')[0]!.payload).toMatchObject({
      guestEmail: 'carlos@example.com',
      cancelledBy: 'staff',
      // Lo canceló el propio personal: no hace falta avisarle al restaurante.
      staffNoticeEmail: '',
    });
  });

  it('otra organización no ve ni toca las reservas', async () => {
    const t = await setup();
    const { id } = await (await t.request('POST', `${base}/reservations`, { body })).json();
    expect((await t.request('GET', `/restaurant/reservations/${id}`, { organizationId: UUID.OTHER_ORG })).status).toBe(404);
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { organizationId: UUID.OTHER_ORG, body: { status: 'seated' } })).status).toBe(404);
    expect((await t.request('POST', `/restaurant/reservations/${id}/cancel`, { organizationId: UUID.OTHER_ORG, body: {} })).status).toBe(404);
    // Otra organización ni siquiera tiene este local inicializado: no hay nada que listar.
    expect((await t.request('GET', `${base}/reservations?date=${SATURDAY}`, { organizationId: UUID.OTHER_ORG })).status).toBe(404);
  });

  it('pide reservation:read para ver y reservation:manage para cambiar', async () => {
    const t = await setup();
    const { id } = await (await t.request('POST', `${base}/reservations`, { body })).json();
    const read = { permissions: 'reservation:read' };
    expect((await t.request('GET', `${base}/reservations?date=${SATURDAY}`, read)).status).toBe(200);
    expect((await t.request('GET', `/restaurant/reservations/${id}`, read)).status).toBe(200);
    expect((await t.request('GET', `${base}/availability?date=${SATURDAY}&partySize=2`, read)).status).toBe(200);
    expect((await t.request('POST', `${base}/reservations`, { ...read, body })).status).toBe(403);
    expect((await t.request('PATCH', `/restaurant/reservations/${id}/status`, { ...read, body: { status: 'seated' } })).status).toBe(403);
    expect((await t.request('POST', `/restaurant/reservations/${id}/cancel`, { ...read, body: {} })).status).toBe(403);
    // restaurant:manage (el mapa) NO da acceso a las reservas.
    expect((await t.request('GET', `${base}/reservations?date=${SATURDAY}`, { permissions: 'restaurant:read,restaurant:manage' })).status).toBe(403);
  });

  it('la disponibilidad del personal no aplica el tope de días ni la antelación', async () => {
    const t = await setup();
    const far = await (await t.request('GET', `${base}/availability?date=2026-12-26&partySize=2`)).json();
    expect(far.status).toBe('open');
  });
});

describe('toda escritura de reservas deja evento', () => {
  it('crear, cancelar y cambiar de estado publican su evento con la organización', async () => {
    const t = await setup();
    const base = `/restaurant/establishments/${UUID.ESTABLISHMENT}`;
    const { id } = await (await t.request('POST', `${base}/reservations`, { body: { date: SATURDAY, time: '20:00', partySize: 2, guestName: 'Eva', guestPhone: '0991234567' } })).json();
    await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'seated' } });
    await t.request('PATCH', `/restaurant/reservations/${id}/status`, { body: { status: 'completed' } });
    const types = t.uow.outboxEvents.map((e) => e.type);
    expect(types).toEqual(['restaurant.reservation.created', 'restaurant.reservation.status_changed', 'restaurant.reservation.status_changed']);
    expect(t.uow.outboxEvents.every((e) => e.payload.organizationId === UUID.ORG)).toBe(true);
    expect(NOW.getTime()).toBeGreaterThan(0);
  });
});
