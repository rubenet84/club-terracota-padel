const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, toDisponibilidades } = require('../app/static/whatsapp_parser.js');

const screenshotText = `Ruben Rebollo
Nv 2.5
📞 600123456
🕒 Lunes: 18:00–21:00 · Fijo
🕒 Miércoles: 10:00–13:00 · Fijo
🕒 Viernes: 17:00–20:00 · Rotativo
🕒 Sábado: 10:00–13:00 · Fijo`;

test('agrupa todos los horarios de la ficha de WhatsApp bajo un solo cliente', () => {
  const [player, ...unexpectedPlayers] = parse(screenshotText);
  assert.equal(unexpectedPlayers.length, 0);
  assert.equal(player.nombre, 'Ruben Rebollo');
  assert.equal(player.telefono, '600123456');
  assert.equal(player.nivel, 2.5);
  assert.deepEqual(player.horarios, [
    { dia: 'L', inicio: '18:00', fin: '21:00', tipo: 'fijo' },
    { dia: 'X', inicio: '10:00', fin: '13:00', tipo: 'fijo' },
    { dia: 'V', inicio: '17:00', fin: '20:00', tipo: 'rotativo' },
    { dia: 'S', inicio: '10:00', fin: '13:00', tipo: 'fijo' }
  ]);
});

test('conserva las disponibilidades separadas al preparar los datos para guardar', () => {
  const [player] = parse(screenshotText);
  assert.deepEqual(toDisponibilidades(player.horarios), [
    { dia_semana: 1, hora_inicio: '18:00', hora_fin: '21:00', modalidad_horario: 'fijo', tipo: 'habitual', fecha_especifica: null },
    { dia_semana: 3, hora_inicio: '10:00', hora_fin: '13:00', modalidad_horario: 'fijo', tipo: 'habitual', fecha_especifica: null },
    { dia_semana: 5, hora_inicio: '17:00', hora_fin: '20:00', modalidad_horario: 'rotativo', tipo: 'habitual', fecha_especifica: null },
    { dia_semana: 6, hora_inicio: '10:00', hora_fin: '13:00', modalidad_horario: 'fijo', tipo: 'habitual', fecha_especifica: null }
  ]);
});

test('agrupa dos remitentes diferentes en clientes separados', () => {
  const players = parse(`Ana: Teléfono 612345678, nivel 3
🕒 Lunes: 09:00–12:00 · Fijo
Carlos: Teléfono 655111222, nivel 4
🕒 Martes: 16:00–18:00 · Rotativo`);
  assert.equal(players.length, 2);
  assert.equal(players[0].nombre, 'Ana');
  assert.deepEqual(players[0].horarios, [{ dia: 'L', inicio: '09:00', fin: '12:00', tipo: 'fijo' }]);
  assert.equal(players[1].nombre, 'Carlos');
  assert.deepEqual(players[1].horarios, [{ dia: 'M', inicio: '16:00', fin: '18:00', tipo: 'rotativo' }]);
});

test('mantiene varias franjas del mismo día sin mezclarlas', () => {
  const [player] = parse(`Lucía
Lunes: 09:00–12:00 · Fijo
Lunes: 16:00–18:00 · Rotativo`);
  assert.equal(player.horarios.length, 2);
  assert.deepEqual(player.horarios.map(({ inicio, fin, tipo }) => ({ inicio, fin, tipo })), [
    { inicio: '09:00', fin: '12:00', tipo: 'fijo' },
    { inicio: '16:00', fin: '18:00', tipo: 'rotativo' }
  ]);
});

test('interpreta el ejemplo de texto libre con dos días y un horario compartido', () => {
  const [player, ...unexpectedPlayers] = parse(`Carlos Pérez
600123456
Nivel 3.25
Puedo jugar lunes y miércoles
por la mañana, de 10 a 12.`);
  assert.equal(unexpectedPlayers.length, 0);
  assert.equal(player.nombre, 'Carlos Pérez');
  assert.equal(player.telefono, '600123456');
  assert.equal(player.nivel, 3.25);
  assert.deepEqual(player.horarios, [
    { dia: 'L', inicio: '10:00', fin: '12:00', tipo: 'fijo' },
    { dia: 'X', inicio: '10:00', fin: '12:00', tipo: 'fijo' }
  ]);
});
