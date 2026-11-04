((root, factory) => {
  const parser = factory();
  if (typeof module === 'object' && module.exports) module.exports = parser;
  else root.WhatsAppParser = parser;
})(globalThis, () => {
  const dayPatterns = [
    ['L', /\blunes\b|\blun\.?\b/], ['M', /\bmartes\b|\bmar\.?\b/],
    ['X', /\bmiércoles\b|\bmiercoles\b|\bmié\.?\b|\bmie\.?\b/],
    ['J', /\bjueves\b|\bjue\.?\b/], ['V', /\bviernes\b|\bvie\.?\b/],
    ['S', /\bsábado\b|\bsabado\b|\bsáb\.?\b|\bsab\.?\b/], ['D', /\bdomingo\b|\bdom\.?\b/]
  ];

  function cleanLine(line) {
    return String(line || '')
      .replace(/^\[\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '')
      .replace(/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*-\s*/, '')
      .trim();
  }

  function extractDays(text) {
    const normalized = String(text || '').toLocaleLowerCase('es');
    const found = [];
    if (/\bentre semana\b|\bdías? laborables\b|\bde lunes a viernes\b/.test(normalized)) found.push('L', 'M', 'X', 'J', 'V');
    if (/\bcualquier día\b/.test(normalized) && !/\bfin de semana\b/.test(normalized)) found.push('L', 'M', 'X', 'J', 'V');
    for (const [day, pattern] of dayPatterns) if (pattern.test(normalized) && !found.includes(day)) found.push(day);
    const initials = String(text || '').match(/(?:^|[\s,;\/])([LMXJVSD])(?=$|[\s,;\/])/gi) || [];
    for (const token of initials) {
      const day = token.trim().toUpperCase();
      if (!found.includes(day)) found.push(day);
    }
    return ['L', 'M', 'X', 'J', 'V', 'S', 'D'].filter(day => found.includes(day));
  }

  function extractTime(text) {
    const normalized = String(text || '').toLocaleLowerCase('es');
    const format = (hour, minute = '00') => `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
    let match = normalized.match(/\b(?:de|desde|entre)\s*(?:las?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h(?:oras?)?\s*)?(?:a|hasta|y|[-–])\s*(?:las?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h(?:oras?)?)?\b/);
    if (match) return { inicio: format(match[1], match[2]), fin: format(match[3], match[4]) };
    match = normalized.match(/\b(\d{1,2}):(\d{2})\s*(?:-|–|a|hasta|y)\s*(\d{1,2}):(\d{2})\b/);
    if (match) return { inicio: format(match[1], match[2]), fin: format(match[3], match[4]) };
    let inicio = '';
    let fin = '';
    match = normalized.match(/\b(?:a partir de|desde|a las|desde las)\s*(?:las?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\b/);
    if (match) inicio = format(match[1], match[2]);
    match = normalized.match(/\bhasta\s+(?:las?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h|horas)?\b/);
    if (match) fin = format(match[1], match[2]);
    return { inicio, fin };
  }

  function timeType(text) {
    return /\brotativ[oa]s?\b/i.test(text) ? 'rotativo' : 'fijo';
  }

  function isWeekdayLabel(text) {
    const normalized = String(text || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    return /^(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|lun\.?|mar\.?|mié\.?|mie\.?|jue\.?|vie\.?|sáb\.?|sab\.?|dom\.?)(?:\b|\s+y\b)/i.test(normalized);
  }

  function extractSender(line) {
    const text = cleanLine(line);
    const match = text.match(/^([^:]{1,60}):\s*(.*)$/);
    if (match) {
      const sender = match[1].trim().replace(/^~\s*/, '').replace(/\s*\([^)]*\)\s*$/, '');
      if (isWeekdayLabel(sender) || /^(tú|you|sistema|nivel|nv\.?|teléfono|telefono|nombre|email|correo)$/i.test(sender)) return null;
      if (sender) return { nombre: sender, mensaje: match[2].trim() };
    }
    const separated = text.match(/^([^—–|]{2,60})\s*[—–|]\s*(.+)$/);
    if (separated && !isWeekdayLabel(separated[1])) return { nombre: separated[1].trim(), mensaje: separated[2].trim() };
    return null;
  }

  function isProfileHeader(line, nextLines) {
    const text = line.trim();
    if (!text || text.length > 60 || /^\d+$/.test(text) || /\d{6,}/.test(text) || /[:.!?]/.test(text) || /[—–|]/.test(text)) return false;
    if (/^(nivel|nv\.?|teléfono|telefono|email|correo|nombre|puedo|busco|disponibilidad|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i.test(text)) return false;
    if (text.split(/\s+/).length > 5) return false;
    const context = nextLines.join(' ').toLowerCase();
    return /\b(?:nivel|nv\.?|tel[eé]fono|puedo jugar|puedo|disponible|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i.test(context)
      || /(?:^|\s)[6789]\d{8}(?:\s|$)/.test(context);
  }

  function splitBlocks(text) {
    const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
    const blocks = [];
    let current = null;
    const close = () => { if (current && current.lines.length) blocks.push(current); current = null; };
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const sender = extractSender(line);
      if (sender) {
        close();
        current = { nombre: sender.nombre, lines: sender.mensaje ? [sender.mensaje] : [] };
        continue;
      }
      if (isWeekdayLabel(line) && !current) current = { nombre: '', lines: [] };
      if (isProfileHeader(line, lines.slice(index + 1, index + 5))) {
        close();
        current = { nombre: line, lines: [] };
        continue;
      }
      if (!current) current = { nombre: '', lines: [] };
      current.lines.push(line);
    }
    close();
    return blocks;
  }

  function extractSchedules(lines, allText) {
    const schedules = [];
    for (const line of lines) {
      const days = extractDays(line);
      const time = extractTime(line);
      if (!days.length || (!time.inicio && !time.fin)) continue;
      for (const day of days) schedules.push({ dia: day, ...time, tipo: timeType(line) });
    }

    const allDays = extractDays(allText);
    const generalTime = extractTime(allText);
    if (!schedules.length) {
      for (const day of allDays) schedules.push({ dia: day, ...generalTime, tipo: timeType(allText) });
    } else {
      const scheduledDays = new Set(schedules.map(schedule => schedule.dia));
      for (const day of allDays) {
        if (!scheduledDays.has(day)) schedules.push({ dia: day, inicio: '', fin: '', tipo: timeType(allText) });
      }
    }

    const unique = new Map();
    for (const schedule of schedules) {
      unique.set([schedule.dia, schedule.inicio, schedule.fin, schedule.tipo].join('|'), schedule);
    }
    return [...unique.values()];
  }

  function parse(text) {
    const candidates = [];
    for (const block of splitBlocks(text)) {
      const allText = [block.nombre, ...block.lines].join(' ').trim();
      if (!allText) continue;
      const phoneMatch = allText.match(/(?:\+34\s*)?(?:[6789]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}|[6789]\d{8})/);
      const telefono = phoneMatch ? phoneMatch[0].replace(/\D/g, '').slice(-9) : '';
      const levelMatch = allText.match(/\b(?:nivel(?:\s+es)?(?:\s+de)?|niv\.?|nv\.?)\s*(?:(?:más|mas)\s+o\s+menos\s*)?[:=]?\s*([1-5](?:[.,]\d{1,2})?)\b/i);
      let nivel = null;
      if (levelMatch) {
        const value = Number(levelMatch[1].replace(',', '.'));
        if (value >= 1 && value <= 5 && Math.abs(value * 4 - Math.round(value * 4)) < 0.001) nivel = Math.round(value * 4) / 4;
      }
      const horarios = extractSchedules(block.lines, allText);
      if (!block.nombre && !telefono && nivel === null && !horarios.length) continue;
      candidates.push({
        sel: true,
        nombre: String(block.nombre || '').replace(/^~+/, '').trim().slice(0, 60),
        telefono,
        nivel,
        horarios
      });
    }
    return candidates;
  }

  function toDisponibilidades(horarios) {
    const dayNumbers = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 7 };
    return horarios.map(schedule => ({
      dia_semana: dayNumbers[schedule.dia],
      hora_inicio: schedule.inicio || null,
      hora_fin: schedule.fin || null,
      modalidad_horario: schedule.tipo,
      tipo: 'habitual',
      fecha_especifica: null
    }));
  }

  return { parse, toDisponibilidades };
});
