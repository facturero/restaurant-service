import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guardia del guardado.
 *
 * En MySQL, `INSERT … ON DUPLICATE KEY UPDATE` —lo que Sequelize genera con
 * `upsert`— reacciona a CUALQUIER índice único, no solo a la clave primaria. Un
 * nombre de mesa repetido no daría 409: actualizaría en silencio la fila ajena.
 * Se comprobó contra MySQL 9.0 antes de cambiarlo. Por eso los repositorios
 * deciden por `findByPk` + `update`/`create`, y esta prueba impide que el
 * `upsert` vuelva sin que nadie se dé cuenta.
 *
 * Es una revisión por heurística, como la de la bitácora: no sustituye a la
 * comprobación contra una base real, la protege.
 */
function leerCodigo(ruta: string): string {
  return readFileSync(ruta, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('los repositorios guardan por clave primaria', () => {
  it('`repositories.ts` no usa `upsert`', () => {
    const codigo = leerCodigo(join(process.cwd(), 'src', 'infrastructure', 'persistence', 'repositories.ts'));
    expect(
      /.upsert\(/.test(codigo),
      'hay un `upsert` en los repositorios: chocaría con un índice único secundario y pisaría la fila en silencio',
    ).toBe(false);
  });
});

/**
 * Guardia de la carrera de mesas. Bajo REPEATABLE READ, una lectura normal dentro de la transacción ve la «foto» de cuando
 * empezó, no lo que otra transacción confirmó mientras esta esperaba el bloqueo de las mesas. Con una lectura normal, 12
 * reservas simultáneas para 3 mesas salían las 12 (se comprobó contra MySQL). Las dos lecturas que deciden si se acepta una
 * reserva —la ocupación de las mesas y las reservas vigentes del cliente— tienen que ser lecturas con bloqueo.
 */
describe('las lecturas que deciden una reserva son lecturas actuales', () => {
  const codigo = leerCodigo(join(process.cwd(), 'src', 'infrastructure', 'persistence', 'repositories.ts'));

  function cuerpo(metodo: string): string {
    const inicio = codigo.indexOf(`async ${metodo}(`);
    expect(inicio, `no se encontró ${metodo}`).toBeGreaterThan(-1);
    const fin = codigo.indexOf('\n    async ', inicio + 10);
    return codigo.slice(inicio, fin === -1 ? undefined : fin);
  }

  it.each(['activeBookings', 'countUpcomingByGuest'])('%s usa `lock` dentro de la transacción', (metodo) => {
    expect(/lock:\s*tx\.LOCK\./.test(cuerpo(metodo))).toBe(true);
  });

  it('las mesas se bloquean con FOR UPDATE y siempre en el mismo orden', () => {
    const lock = cuerpo('lockTables');
    expect(lock).toMatch(/LOCK\.UPDATE/);
    expect(lock).toMatch(/order:\s*\[\['id', 'ASC'\]\]/);
  });
});
