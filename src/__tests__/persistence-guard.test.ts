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
