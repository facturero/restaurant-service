// Verificación de las reservas contra restaurant-service REAL y MySQL REAL (sin gateway: manda las cabeceras que pondría el gateway).
// Las pruebas en memoria no pueden ver carreras ni índices: este script sí. Incluye 12 reservas simultáneas para 3 mesas.
//
//   1. base nueva:   CREATE DATABASE resv_verify;  y  DB_NAME=resv_verify npx sequelize-cli db:migrate
//   2. servicio:     DB_NAME=resv_verify PORT=3216 NODE_ENV=production npx tsx src/main.ts
//   3. este script:  node scripts/verify-reservations.mjs        (espera «TODO OK»)
//   4. después:      node scripts/verify-reservations-race.mjs   (usa el local que dejó el anterior)
// BASE cambia la dirección del servicio (por defecto http://localhost:3216).
// Flujo completo de reservas contra restaurant-service real + MySQL real (sin gateway: se mandan las cabeceras que pondría el gateway).
const BASE = process.env.BASE ?? 'http://localhost:3216';
const ORG = '11111111-1111-4111-8111-111111111111';
const EST = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const EST2 = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee';
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? '  OK   ' : '  FALLO'} ${m}`); if (!c) fallos++; };

const staff = (org, perms = 'restaurant:read,restaurant:manage,reservation:read,reservation:manage') => ({
  'Content-Type': 'application/json', 'X-Organization-Id': org, 'X-User-Id': '99999999-9999-4999-8999-999999999999', 'X-Permissions': perms,
});
const call = async (method, path, { org = ORG, body, headers } = {}) => {
  const res = await fetch(BASE + path, { method, headers: headers ?? staff(org), body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
};
const pub = (method, path, body) => call(method, path, { headers: { 'Content-Type': 'application/json' }, body });

// Fecha del próximo sábado (de al menos 3 días adelante, dentro de 30)
function nextSaturday() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 3);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const SAT = nextSaturday();
const SAT2 = (() => { const d = new Date(SAT + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
console.log('Sábados de prueba:', SAT, SAT2);

// 1. Preparar el local: inicializar, mesas, turnos, ajustes
let r = await call('POST', `/restaurant/establishments/${EST}/setup`);
ok(r.status === 200, 'setup del local');
const floorId = r.json.floor.id;
for (const [name, min, max] of [['Mesa 1', 1, 2], ['Mesa 2', 1, 4], ['Mesa 3', 1, 4], ['Mesa 4', 1, 6]]) {
  r = await call('POST', `/restaurant/floors/${floorId}/tables`, { body: { name, capacityMin: min, capacityMax: max } });
  if (r.status !== 201) console.log('   mesa', name, r.status, JSON.stringify(r.json));
}
r = await call('GET', `/restaurant/establishments/${EST}/tables`);
ok(r.json.length === 4, '4 mesas creadas');
r = await call('PUT', `/restaurant/establishments/${EST}/schedule`, { body: { shifts: [{ weekday: 6, opensAt: '19:00', closesAt: '21:00', label: 'Cena' }] } });
ok(r.status === 200, 'horario con turno de cena el sábado');

r = await call('PUT', `/restaurant/establishments/${EST}/reservation-settings`, {
  body: { enabled: true, publicSlug: 'verifica-esquina', displayName: 'La Esquina (prueba)', contactPhone: '+593 99 123 4567', notifyEmail: 'dueno@example.com', maxTablesPerReservation: 3 },
});
ok(r.status === 200 && r.json.publicSlug === 'verifica-esquina', 'ajustes guardados');

// Otro local intenta el mismo enlace → 409 por el índice único + chequeo previo
await call('POST', `/restaurant/establishments/${EST2}/setup`, { org: ORG2 });
r = await call('PUT', `/restaurant/establishments/${EST2}/reservation-settings`, { org: ORG2, body: { publicSlug: 'verifica-esquina' } });
ok(r.status === 409 && r.json.code === 'SLUG_TAKEN', 'el enlace es único entre organizaciones');

// 2. Público
r = await pub('GET', '/public/restaurants/verifica-esquina');
ok(r.status === 200 && r.json.name.startsWith('La Esquina'), 'ficha pública');
r = await pub('GET', `/public/restaurants/verifica-esquina/availability?date=${SAT}&partySize=2`);
ok(r.status === 200 && r.json.status === 'open' && r.json.slots.length === 4, 'disponibilidad del sábado: 4 horas');

// 3. Reserva simple
const guest = (n, extra = {}) => ({ date: SAT, time: '19:30', partySize: 2, guestName: `Cliente ${n}`, guestEmail: `c${n}@example.com`, guestPhone: `09900000${String(n).padStart(2, '0')}`, ...extra });
r = await pub('POST', '/public/restaurants/verifica-esquina/reservations', guest(1));
ok(r.status === 201 && r.json.token, 'reserva creada en MySQL real');
const token = r.json.token;
r = await pub('GET', `/public/reservations/${token}`);
ok(r.status === 200 && r.json.status === 'confirmed' && r.json.time === '19:30', 'se consulta por el token');

// 4. CARRERA: 12 clientes distintos piden a la vez la misma hora para 4 personas. Hay dos mesas de 4 y una de 6: caben exactamente 3.
const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
  pub('POST', '/public/restaurants/verifica-esquina/reservations', guest(10 + i, { date: SAT2, partySize: 4, time: '20:00' }))));
const created = results.filter((x) => x.status === 201).length;
const taken = results.filter((x) => x.status === 409 && x.json.code === 'SLOT_TAKEN').length;
const other = results.filter((x) => ![201, 409].includes(x.status));
console.log('   reservas simultáneas:', results.map((x) => x.status).join(' '));
ok(created === 3, `de 12 pedidos a la vez para 4 personas se crearon exactamente 3 (mesas 2, 3 y 4): ${created}`);
ok(taken === 9, `los otros 9 recibieron SLOT_TAKEN: ${taken}`);
ok(other.length === 0, 'ningún 500 ni otro error: ' + JSON.stringify(other.map((x) => x.json)));

// Ninguna mesa quedó con dos reservas a la vez
r = await call('GET', `/restaurant/establishments/${EST}/reservations?date=${SAT2}`);
const ocupadas = new Map();
let doble = false;
for (const res of r.json.filter((x) => x.status !== 'cancelled')) {
  for (const t of res.tables) {
    const key = `${t.id}`;
    const list = ocupadas.get(key) ?? [];
    for (const o of list) { if (!(res.endsAt <= o.startsAt || res.startsAt >= o.endsAt)) doble = true; }
    list.push(res); ocupadas.set(key, list);
  }
}
ok(!doble, 'ninguna mesa tiene dos reservas que se pisen');

// 5. Cancelar libera
const victim = results.find((x) => x.status === 201);
r = await pub('POST', `/public/reservations/${victim.json.token}/cancel`, { reason: 'prueba' });
ok(r.status === 200 && r.json.status === 'cancelled', 'cancelada por el cliente');
r = await pub('POST', '/public/restaurants/verifica-esquina/reservations', guest(40, { date: SAT2, partySize: 4, time: '20:00' }));
ok(r.status === 201, 'la mesa liberada se puede volver a reservar');
r = await pub('POST', `/public/reservations/${victim.json.token}/cancel`, {});
ok(r.status === 409, 'no se cancela dos veces');

// 6. Grupo grande con varias mesas, y personal
r = await pub('POST', '/public/restaurants/verifica-esquina/reservations', guest(50, { partySize: 9, time: '19:00' }));
ok(r.status === 201, 'grupo de 9 (varias mesas) reservado');
r = await call('GET', `/restaurant/establishments/${EST}/reservations?date=${SAT}`);
const nueve = r.json.find((x) => x.partySize === 9);
ok(nueve && nueve.tables.length >= 2, 'el grupo de 9 ocupa varias mesas: ' + (nueve?.tables.map((t) => t.name).join(', ')));
r = await call('POST', `/restaurant/establishments/${EST}/reservations`, { body: { date: SAT, time: '20:30', partySize: 2, guestName: 'Por teléfono', guestPhone: '0991112233' } });
ok(r.status === 201 && r.json.source === 'staff', 'reserva anotada por el personal');
const sid = r.json.id;
r = await call('PATCH', `/restaurant/reservations/${sid}/status`, { body: { status: 'seated' } });
ok(r.status === 200, 'sentada');
r = await call('PATCH', `/restaurant/reservations/${sid}/status`, { body: { status: 'completed' } });
ok(r.status === 200, 'terminada');

// 7. Aislamiento y permisos
r = await call('GET', `/restaurant/reservations/${sid}`, { org: ORG2 });
ok(r.status === 404, 'otra organización no ve la reserva');
r = await call('GET', `/restaurant/establishments/${EST}/reservations?date=${SAT}`, { headers: staff(ORG, 'restaurant:read,restaurant:manage') });
ok(r.status === 403, 'sin reservation:read no entra');

// 8. Honeypot / validación
r = await pub('POST', '/public/restaurants/verifica-esquina/reservations', guest(60, { website: 'spam' }));
ok(r.status === 422, 'campo trampa rechazado');

// 9. Outbox
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
