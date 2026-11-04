((root, factory) => {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.PadelFilterRules = rules;
})(globalThis, () => {
  function minutes(value) {
    if (typeof value !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  }

  function intervalosCoinciden(inicio, fin, desdeHora, hastaHora) {
    const inicioMin = minutes(inicio);
    const finMin = minutes(fin);
    const desdeMin = Number(desdeHora) * 60;
    const hastaMin = Number(hastaHora) * 60;
    if (inicioMin === null || finMin === null || finMin <= inicioMin || hastaMin <= desdeMin) return false;
    return inicioMin < hastaMin && finMin > desdeMin;
  }

  return { intervalosCoinciden };
});
