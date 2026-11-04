((root, factory) => {
  const tools = factory();
  if (typeof module === 'object' && module.exports) module.exports = tools;
  else root.CsvTools = tools;
})(globalThis, () => {
  function detectarDelimitador(texto) {
    const firstLine = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let quoted = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const char = firstLine[i];
      if (char === '"' && firstLine[i + 1] === '"' && quoted) { i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (!quoted && Object.hasOwn(counts, char)) counts[char] += 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parse(texto, delimiter = detectarDelimitador(texto)) {
    const text = String(texto || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field.length === 0) quoted = true;
      else if (char === delimiter) { row.push(field); field = ''; }
      else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function stringify(rows, delimiter = ';') {
    const encode = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    return `\uFEFF${rows.map(row => row.map(encode).join(delimiter)).join('\r\n')}`;
  }

  return { detectarDelimitador, parse, stringify };
});
