const { test } = require('node:test');
const assert = require('node:assert/strict');
const { intervalosCoinciden } = require('../app/static/filter_rules.js');

test('incluye disponibilidad que cubre por completo el rango seleccionado', () => {
  assert.equal(intervalosCoinciden('09:00', '12:00', 9, 11), true);
});

test('incluye disponibilidad que se solapa parcialmente con el rango', () => {
  assert.equal(intervalosCoinciden('10:00', '12:00', 9, 11), true);
  assert.equal(intervalosCoinciden('08:00', '10:00', 9, 11), true);
});

test('excluye disponibilidad que termina justo al iniciar el rango', () => {
  assert.equal(intervalosCoinciden('08:00', '09:00', 9, 11), false);
});

test('excluye disponibilidad que empieza justo al terminar el rango', () => {
  assert.equal(intervalosCoinciden('11:00', '12:00', 9, 11), false);
});

test('rechaza horas ausentes, inválidas y rangos invertidos', () => {
  assert.equal(intervalosCoinciden('', '', 9, 11), false);
  assert.equal(intervalosCoinciden('26:00', '27:00', 9, 11), false);
  assert.equal(intervalosCoinciden('11:00', '09:00', 9, 11), false);
  assert.equal(intervalosCoinciden('09:00', '12:00', 11, 9), false);
});
