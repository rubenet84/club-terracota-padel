const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectarDelimitador, parse, stringify } = require('../app/static/csv_tools.js');

test('exports UTF-8 CSV with semicolons for Spanish Excel settings', () => {
  const csv = stringify([
    ['nombre', 'telefono', 'disponibilidades', 'observaciones'],
    ['Carlos Pérez', '600123456', '[{"dia_semana":1,"hora_inicio":"10:00","hora_fin":"12:00"}]', 'Texto, con coma; punto y coma y "comillas"']
  ]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(detectarDelimitador(csv), ';');
  const rows = parse(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 4);
  assert.equal(rows[1][0], 'Carlos Pérez');
  assert.equal(rows[1][2], '[{"dia_semana":1,"hora_inicio":"10:00","hora_fin":"12:00"}]');
  assert.equal(rows[1][3], 'Texto, con coma; punto y coma y "comillas"');
});

test('reads legacy comma-delimited exports and embedded JSON commas', () => {
  const legacyCsv = '\uFEFFnombre,telefono,disponibilidades\r\n"Ana García","611111111","[{""dia_semana"":1,""hora_inicio"":""09:00""}]"';
  assert.equal(detectarDelimitador(legacyCsv), ',');
  const rows = parse(legacyCsv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 3);
  assert.equal(rows[1][2], '[{"dia_semana":1,"hora_inicio":"09:00"}]');
  assert.doesNotThrow(() => JSON.parse(rows[1][2]));
});

test('preserves multiline quoted cells as one field', () => {
  const rows = parse(stringify([['nombre', 'observaciones'], ['Cliente', 'Primera línea\r\nSegunda línea']]));
  assert.equal(rows[1][1], 'Primera línea\r\nSegunda línea');
});
