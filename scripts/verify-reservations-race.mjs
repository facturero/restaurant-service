// Carreras repetidas contra restaurant-service REAL y MySQL REAL: 5 rondas de 16 reservas simultáneas para 3 mesas (deben entrar
// exactamente 3 en cada una) y un mismo cliente lanzando 12 en paralelo (tope: 3 vigentes). Corre DESPUÉS de verify-reservations.mjs,
// que deja preparado el local `verifica-esquina`. Ver el encabezado de aquel para levantar el servicio.
// Carrera repetida: varias rondas de reservas simultáneas, y un mismo cliente disparando en paralelo.
const BASE = process.env.BASE ?? 'http://localhost:3216';
const ORG = '11111111-1111-4111-8111-111111111111';
const EST = 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee';
let fallos = 0;
const ok = (c, m) => { console.log(`${c ? '  OK   ' : '  FALLO'} ${m}`); if (!c) fallos++; };
const staff = { 'Content-Type': 'application/json', 'X-Organization-Id': ORG, 'X-User-Id': '99999999-9999-4999-8999-999999999999', 'X-Permissions': 'restaurant:read,restaurant:manage,reservation:read,reservation:manage' };
const call = async (method, path, body, headers = staff) => {
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, json };
};
const pub = (method, path, body) => call(method, path, body, { 'Content-Type': 'application/json' });

await call('PUT', `/restaurant/establishments/${EST}/reservation-settings`, { maxDaysAhead: 120 });
const saturdays = [];
const d = new Date(); d.setUTCDate(d.getUTCDate() + 30);
while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
for (let i = 0; i < 5; i++) { saturdays.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }

let n = 1000;
for (const [round, date] of saturdays.entries()) {
  const results = await Promise.all(Array.from({ length: 16 }, () => {
    n += 1;
    return pub('POST', '/public/restaurants/verifica-esquina/reservations', {
      date, time: '19:00', partySize: 4, guestName: `Racer ${n}`, guestEmail: `r${n}@example.com`, guestPhone: `0988${String(n).padStart(6, '0')}`,
    });
  }));
  const created = results.filter((x) => x.status === 201).length;
  const errors = results.filter((x) => ![201, 409].includes(x.status));
  ok(created === 3 && errors.length === 0, `ronda ${round + 1} (${date}): 16 simultáneas → ${created} creadas, ${results.length - created - errors.length} SLOT_TAKEN, ${errors.length} errores`);
}

// Un mismo cliente, 12 en paralelo a horas distintas con mesas de sobra: el tope es 3 vigentes
const date = saturdays[0];
const same = await Promise.all(Array.from({ length: 12 }, (_, i) => pub('POST', '/public/restaurants/verifica-esquina/reservations', {
  date, time: ['20:30', '20:00', '19:30', '19:00'][i % 4], partySize: 1, guestName: 'Mismo Cliente', guestEmail: 'mismo@example.com', guestPhone: '0977777777',
})));
const okSame = same.filter((x) => x.status === 201).length;
console.log('   mismo cliente:', same.map((x) => x.status).join(' '));
ok(okSame <= 3, `el mismo cliente en paralelo no pasa de 3 reservas vigentes: ${okSame}`);

// Nadie quedó con la mesa doble en ningún sábado
for (const date of saturdays) {
  const r = await call('GET', `/restaurant/establishments/${EST}/reservations?date=${date}`);
  const byTable = new Map(); let doble = false;
  for (const res of r.json.filter((x) => x.status !== 'cancelled')) for (const t of res.tables) {
    const list = byTable.get(t.id) ?? [];
    if (list.some((o) => !(res.endsAt <= o.startsAt || res.startsAt >= o.endsAt))) doble = true;
    list.push(res); byTable.set(t.id, list);
  }
  ok(!doble, `${date}: sin mesas dobles (${r.json.length} reservas)`);
}
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
