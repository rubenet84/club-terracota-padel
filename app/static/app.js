/* ══════════════════════ CONSTANTES Y ESTADO ══════════════════════ */
const LS_KEY = 'padelclub_jugadores_v1';
const DAYS = ['L','M','X','J','V','S','D'];
const DAY_FULL = {L:'Lunes',M:'Martes',X:'Miércoles',J:'Jueves',V:'Viernes',S:'Sábado',D:'Domingo'};
const FRANJAS = { 'M1 🌅':[8,10], 'M2 🌤️':[10,13], 'T1 ☀️':[13,16], 'T2 🌇':[16,19], 'N1 🌙':[19,23] };
const TIPOS = [ ['fijo','📌 Fijo'], ['rotativo','🔁 Rotativo'] ];
const TIPO_LABEL = Object.fromEntries(TIPOS);

const EJEMPLOS = [
  { id:'e1', nombre:'Ana García',     telefono:'612345678', nivel:3.5, dias:['L','X','V'], inicio:'18:30', fin:'21:00', tipo:'fijo',     notas:'Preferencia revés. Es zurda.' },
  { id:'e2', nombre:'Carlos Ruiz',    telefono:'655111222', nivel:4.0, dias:['M','J'],       inicio:'19:00', fin:'22:00', tipo:'rotativo', notas:'Subiendo de nivel, pronto 4.25.' },
  { id:'e3', nombre:'Marta López',    telefono:'699333444', nivel:2.5, dias:['S','D'],       inicio:'09:00', fin:'12:00', tipo:'mananas',  notas:'Disponible también festivos.' },
  { id:'e4', nombre:'Javier Méndez',  telefono:'610555666', nivel:5.0, dias:['L','M','X','J','V'], inicio:'07:00', fin:'10:00', tipo:'fijo', notas:'Monitor del club.' },
  { id:'e5', nombre:'Lucía Fernández',telefono:'622777888', nivel:3.0, dias:['X'],           inicio:'13:00', fin:'16:00', tipo:'tardes',   notas:'Quiere partidas femeninas.' },
  { id:'e6', nombre:'Diego Torres',   telefono:'688999000', nivel:1.5, dias:['V','S'],       inicio:'21:00', fin:'23:00', tipo:'noches',   notas:'Principiante entusiasta.' },
];

let players = [];
let inactivePlayers = [];
let editandoId = null;
let candidatos = [];
const filtros = { niveles:new Set(), dias:new Set(), franjas:new Set(), tipo:null, hMin:8, hMax:23 };

/* ══════════════════════ UTILIDADES ══════════════════════ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aMin = h => { const [a,b] = (h||'0:0').split(':'); return (+a)*60 + (+b||0); };
const aHoras = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const soloDigitos = t => String(t||'').replace(/\D/g,'');
const nivelTxt = n => (+n).toFixed(2).replace(/0+$/,'').replace(/\.$/,'.0');

async function api(url, options={}) {
  const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
  const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', 'X-CSRF-Token':csrfToken, ...(options.headers||{}) } });
  let data={}; try { data=await response.json(); } catch(e) {}
  if(response.status===401){ location.href='/login'; throw new Error('Sesión caducada'); }
  if(!response.ok){
    const detail=data.detail;
    const validationErrors=Array.isArray(detail) ? detail.map(item=>({loc:item.loc||[],message:item.msg||'Revisa este dato.'})) : [];
    const duplicatePhone=response.status===409 && /tel[eé]fono/i.test(String(detail||'')) && !url.endsWith('/lote');
    if(duplicatePhone) validationErrors.push({loc:['body','telefono'],message:String(detail)});
    const message=Array.isArray(detail)
      ? detail.map(item=>{const field=nombreCampoError(item.loc||[]);return `${field ? field+': ' : ''}${item.msg||'Revisa este dato.'}`;}).join(' ')
      : (typeof detail==='string' ? detail : 'Error de comunicación con el servidor');
    const error=new Error(message || 'Revisa los datos introducidos.');
    error.validationErrors=validationErrors;
    throw error;
  }
  return data;
}
function nombreCampoError(loc){
  const parts=Array.isArray(loc)?loc.map(String):[];
  const availabilityIndex=parts.indexOf('disponibilidades');
  if(availabilityIndex>=0) return `Disponibilidad ${Number(parts[availabilityIndex+1])+1 || ''}`.trim();
  const names={nombre:'Nombre',telefono:'Teléfono',correo_electronico:'Correo electrónico',nivel:'Nivel',observaciones:'Observaciones',lado_preferido:'Lado preferido',busca_partidas:'Busca partidas',hora_inicio:'Hora de inicio',hora_fin:'Hora de fin',dia_semana:'Día',fecha_especifica:'Fecha'};
  return names[parts[parts.length-1]]||'';
}
async function cargarDesdeApi(){
  players = await api('/api/jugadores');
  players = players.map(p => ({...p, observaciones:p.observaciones || ''}));
  renderBusqueda();
  renderLista();
}

async function cargarInactivosDesdeApi(){
  inactivePlayers = await api('/api/jugadores/inactivos');
  inactivePlayers = inactivePlayers.map(p => ({...p, observaciones:p.observaciones || ''}));
  renderInactivos();
}

function diaANumero(dia){
  if(Number.isInteger(dia) && dia >= 1 && dia <= 7) return dia;
  const indice = DAYS.indexOf(String(dia || '').toUpperCase());
  return indice >= 0 ? indice + 1 : null;
}
function numeroADia(numero){ return DAYS[Number(numero) - 1] || ''; }
function horaCorta(hora){ return String(hora || '').slice(0,5); }
function normalizarDisponibilidad(d){
  return {
    dia_semana: diaANumero(d.dia_semana ?? d.dia),
    hora_inicio: horaCorta(d.hora_inicio ?? d.inicio ?? ''),
    hora_fin: horaCorta(d.hora_fin ?? d.fin ?? ''),
    modalidad_horario: d.modalidad_horario ?? d.modalidad ?? 'fijo',
    tipo: d.tipo || 'habitual',
    fecha_especifica: d.fecha_especifica || null
  };
}
function payloadJugador(d){
  let disponibilidades = Array.isArray(d.disponibilidades) ? d.disponibilidades : [];
  if(!disponibilidades.length && Array.isArray(d.dias) && d.dias.length){
    disponibilidades = d.dias.map(dia => ({
      dia_semana: diaANumero(dia),
      hora_inicio: d.inicio || null,
      hora_fin: d.fin || null,
      modalidad_horario: ['fijo','rotativo'].includes(d.tipo) ? d.tipo : 'fijo',
      tipo: 'habitual',
      fecha_especifica: null
    }));
  }
  return {
    nombre:d.nombre,
    telefono:d.telefono,
    correo_electronico:d.correo_electronico || null,
    nivel:d.nivel === '' ? null : d.nivel,
    disponibilidades: disponibilidades.map(item => {
      const n = normalizarDisponibilidad(item);
      return {...n, hora_inicio:n.hora_inicio || null, hora_fin:n.hora_fin || null};
    }),
    observaciones:d.observaciones ?? d.notas ?? '',
    lado_preferido:d.lado_preferido || 'indiferente',
    busca_partidas:d.busca_partidas !== false
  };
}

function toast(msg, ok=true){
  const t = document.createElement('div');
  t.className = `toast px-4 py-3 rounded-xl text-sm font-bold shadow-xl border ${ok?'bg-lima text-carbono-950 border-lima-dark':'bg-red-500 text-white border-red-600'}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 2600);
}

const FIELD_INPUTS={nombre:'#fNombre',telefono:'#fTelefono',correo_electronico:'#fEmail',nivel:'#fNivel',observaciones:'#fNotas'};
function limpiarErroresFormulario(){
  $$('#formJugador [data-field-error], #formJugador .availability-error').forEach(el=>{el.textContent='';el.classList.add('hidden');});
  $$('#formJugador [aria-invalid="true"]').forEach(el=>{el.removeAttribute('aria-invalid');el.classList.remove('border-red-500');});
}
function mostrarErroresFormulario(errors){
  const agrupados=new Map();
  for(const item of errors||[]){
    const loc=Array.isArray(item.loc)?item.loc.map(String):[];
    const disponibilidadAt=loc.indexOf('disponibilidades');
    const index=disponibilidadAt>=0 && /^\d+$/.test(loc[disponibilidadAt+1]||'') ? Number(loc[disponibilidadAt+1]) : null;
    const field=disponibilidadAt>=0?'disponibilidades':(loc[loc.length-1]||'');
    const key=index===null?field:`disponibilidades-${index}`;
    const current=agrupados.get(key)||{field,index,messages:[]};
    if(item.message && !current.messages.includes(item.message)) current.messages.push(item.message);
    agrupados.set(key,current);
  }
  let firstInvalid=null;
  for(const item of agrupados.values()){
    let input=null, display=null;
    if(item.field==='disponibilidades' && item.index!==null){
      const row=$$('#fDisponibilidades .availability-row')[item.index];
      if(row){input=row.querySelector('select,input');display=row.querySelector('.availability-error');}
    } else {
      input=FIELD_INPUTS[item.field]?$(FIELD_INPUTS[item.field]):null;
      display=$$('#formJugador [data-field-error]').find(el=>el.dataset.fieldError===item.field);
    }
    if(!display) continue;
    display.textContent=item.messages.join(' ');
    display.classList.remove('hidden');
    if(input){input.setAttribute('aria-invalid','true');input.classList.add('border-red-500');firstInvalid ||= input;}
  }
  firstInvalid?.focus();
}
function validarFormulario(datos){
  const errors=[];
  const add=(field,message,index=null)=>errors.push({loc:index===null?[field]:['disponibilidades',String(index)],message});
  const nombre=datos.nombre.normalize('NFC').trim().replace(/\s+/g,' ');
  if(nombre.length<2) add('nombre','Escribe el nombre completo (mínimo 2 caracteres).');
  else if(nombre.length>120) add('nombre','El nombre no puede superar los 120 caracteres.');
  else if(!/^[\p{L}\p{M}]+(?:[ .’'-][\p{L}\p{M}]+)*$/u.test(nombre))
    add('nombre','El nombre solo puede contener letras, espacios, puntos, apóstrofos o guiones; no se admiten números ni símbolos.');
  const digits=soloDigitos(datos.telefono);
  if(datos.telefono.length>25 || !/^\+?[0-9](?:[0-9().\-\s]*[0-9])$/.test(datos.telefono) || digits.length<9 || digits.length>15 || (datos.telefono.match(/\+/g)||[]).length>1 || (datos.telefono.includes('(')!==datos.telefono.includes(')')))
    add('telefono','Formato no válido. Usa entre 9 y 15 dígitos y, opcionalmente, un + inicial, espacios, paréntesis, puntos o guiones.');
  if(datos.correo_electronico && !/^(?=.{1,64}@)[A-Za-z0-9]+(?:[._+-][A-Za-z0-9]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(datos.correo_electronico))
    add('correo_electronico','Formato de correo electrónico no válido.');
  if(datos.nivel===null || !Number.isFinite(datos.nivel)) add('nivel','Selecciona el nivel del club.');
  else if(datos.nivel<1 || datos.nivel>5 || Math.abs(datos.nivel*4-Math.round(datos.nivel*4))>1e-6)
    add('nivel','El nivel debe estar entre 1,00 y 5,00 en intervalos de 0,25.');
  if(datos.observaciones.length>2000) add('observaciones','Las observaciones no pueden superar los 2.000 caracteres.');
  datos.disponibilidades.forEach((d,index)=>{
    if(Boolean(d.hora_inicio)!==Boolean(d.hora_fin)) add('disponibilidades','Rellena ambas horas o deja ambas vacías.',index);
    else if(d.hora_inicio && aMin(d.hora_inicio)>=aMin(d.hora_fin)) add('disponibilidades','La hora final debe ser posterior a la inicial.',index);
    if(d.tipo==='puntual' && !d.fecha_especifica) add('disponibilidades','Indica la fecha de esta disponibilidad puntual.',index);
  });
  return errors;
}
function limpiarErrorCampo(target){
  if(!(target instanceof HTMLElement)) return;
  const row=target.closest('.availability-row');
  if(row){
    const error=row.querySelector('.availability-error');
    if(error){error.textContent='';error.classList.add('hidden');}
    row.querySelectorAll('[aria-invalid="true"]').forEach(el=>{el.removeAttribute('aria-invalid');el.classList.remove('border-red-500');});
    return;
  }
  const field=Object.keys(FIELD_INPUTS).find(key=>FIELD_INPUTS[key]===`#${target.id}`);
  if(!field) return;
  const error=$(`[data-field-error="${field}"]`);
  if(error){error.textContent='';error.classList.add('hidden');}
  target.removeAttribute('aria-invalid');
  target.classList.remove('border-red-500');
}

/* ══════════════════════ PESTAÑAS ══════════════════════ */
function mostrarTab(id){
  $$('[id^="tab-"]').forEach(el => el.classList.add('hidden'));
  $('#tab-'+id).classList.remove('hidden');
  $$('.tab-btn').forEach(b => b.classList.toggle('on', b.dataset.tab===id));
  if(id==='jugadores') renderLista();
  if(id==='inactivos') cargarInactivosDesdeApi().catch(error=>toast(error.message,false));
}

/* ══════════════════════ CONSTRUCCIÓN DE FILTROS ══════════════════════ */
function construirFiltros(){
  const niveles = Array.from({length:17}, (_,i) => Number((1 + i * 0.25).toFixed(2)));
  $('#fNiveles').innerHTML = niveles.map(n =>
    `<button class="chip px-3 py-1.5 rounded-lg bg-carbono-800 border border-carbono-700 text-xs" data-action="filter" data-group="niveles" data-value="${n}" data-nivel="${n}">${nivelTxt(n)}</button>`).join('');
  $('#fDias').innerHTML = DAYS.map(d =>
    `<button class="chip px-3 py-1.5 rounded-lg bg-carbono-800 border border-carbono-700 text-xs" data-action="filter" data-group="dias" data-value="${d}" data-dia="${d}" title="${DAY_FULL[d]}">${d}</button>`).join('');
  $('#fFranjas').innerHTML = Object.entries(FRANJAS).map(([f, [desde, hasta]]) =>
    `<button class="chip px-3 py-1.5 rounded-lg bg-carbono-800 border border-carbono-700 text-xs" data-action="filter" data-group="franjas" data-value="${esc(f)}" data-franja="${esc(f)}" title="${aHoras(desde*60)}–${aHoras(hasta*60)}">${esc(f)} <span class="text-zinc-400">${aHoras(desde*60)}–${aHoras(hasta*60)}</span></button>`).join('');
  $('#fTipos').innerHTML = `<button class="chip on px-3 py-1.5 rounded-lg bg-carbono-800 border border-carbono-700 text-xs" data-action="set-type" data-value="" data-tipo="">Todos</button>` +
    TIPOS.map(([v,l]) => `<button class="chip px-3 py-1.5 rounded-lg bg-carbono-800 border border-carbono-700 text-xs" data-action="set-type" data-value="${v}" data-tipo="${v}">${l}</button>`).join('');
}
function toggleFiltro(grupo, valor, btn){
  const set = filtros[grupo];
  set.has(valor) ? set.delete(valor) : set.add(valor);
  btn.classList.toggle('on');
  renderBusqueda();
}
function setTipo(v, btn){
  filtros.tipo = v || null;
  $$('#fTipos .chip').forEach(b => b.classList.toggle('on', b.dataset.tipo===v));
  renderBusqueda();
}
function cambiarRango(e){
  let a = +$('#hMin').value, b = +$('#hMax').value;
  if(a > b){ if(e && e.target.id==='hMin'){ b=a; $('#hMax').value=a; } else { a=b; $('#hMin').value=b; } }
  filtros.hMin = a; filtros.hMax = b;
  $('#rangoLabel').textContent = `${aHoras(a*60)} – ${aHoras(b*60)}`;
  renderBusqueda();
}
function limpiarFiltros(){
  filtros.niveles.clear(); filtros.dias.clear(); filtros.franjas.clear(); filtros.tipo=null;
  filtros.hMin=8; filtros.hMax=23;
  $('#hMin').value=8; $('#hMax').value=23; $('#rangoLabel').textContent='08:00 – 23:00';
  $$('.chip').forEach(b => b.classList.remove('on'));
  $('#fTipos .chip').classList.add('on');
  renderBusqueda();
}

/* ══════════════════════ FILTRADO Y RENDER DE BÚSQUEDA ══════════════════════ */
function disponibilidadesDe(p){
  if(Array.isArray(p.disponibilidades) && p.disponibilidades.length){
    return p.disponibilidades.map(d => {
      const n = normalizarDisponibilidad(d);
      return {...n, dia:numeroADia(n.dia_semana), inicio:n.hora_inicio, fin:n.hora_fin, modalidad:n.modalidad_horario};
    });
  }
  return (p.dias||[]).map(dia=>({dia, dia_semana:diaANumero(dia), inicio:p.inicio||'', fin:p.fin||'', hora_inicio:p.inicio||'', hora_fin:p.fin||'', modalidad:p.tipo||'fijo', modalidad_horario:p.tipo||'fijo', tipo:'habitual'}));
}

function pasaFiltros(p){
  if(filtros.niveles.size && ![...filtros.niveles].some(n => Math.abs(Number(n) - Number(p.nivel)) < 0.001)) return false;
  const disponibilidades=disponibilidadesDe(p);
  if(filtros.dias.size && ![...filtros.dias].some(d => disponibilidades.some(a=>a.dia===d))) return false;
  if(filtros.tipo && !disponibilidades.some(a => a.modalidad===filtros.tipo)) return false;
  const rangoActivo=filtros.hMin>8 || filtros.hMax<23;
  if(rangoActivo || filtros.franjas.size){
    const coincide=disponibilidades.some(a=>{
      const ini=aMin(a.inicio), fin=aMin(a.fin);
      if(rangoActivo && !PadelFilterRules.intervalosCoinciden(a.inicio,a.fin,filtros.hMin,filtros.hMax)) return false;
      if(filtros.franjas.size && ![...filtros.franjas].some(f=>{const [i,fm]=FRANJAS[f];return ini<fm*60 && fin>i*60;})) return false;
      return true;
    });
    if(!coincide) return false;
  }
  return true;
}

function tarjetaJugador(p){
  const disponibilidades = disponibilidadesDe(p);
  const dias = [...new Set(disponibilidades.map(a=>a.dia).filter(Boolean))];
  const diasTxt = dias.map(d => `<span class="inline-flex w-6 h-6 items-center justify-center rounded-md bg-carbono-700 text-[11px] font-bold ${filtros.dias.has(d)?'text-lima':''}">${d}</span>`).join(' ');
  return `
  <article class="card-hover bg-carbono-900 border border-carbono-700 rounded-2xl p-4 flex flex-col gap-3">
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-bold leading-tight">${esc(p.nombre)}</h3>
      <span class="shrink-0 bg-lima/15 text-lima border border-lima/30 font-extrabold text-sm px-2.5 py-1 rounded-lg">Nv ${p.nivel == null ? '—' : nivelTxt(p.nivel)}</span>
    </div>
    <div class="flex items-center gap-2 text-sm">
      <span class="text-zinc-300 font-mono tracking-wide">📞 ${esc(p.telefono)}</span>
      <button data-action="copy-phone" data-phone="${soloDigitos(p.telefono)}" class="text-[11px] bg-carbono-700 hover:bg-carbono-600 px-2 py-1 rounded-md" title="Copiar teléfono">📋 Copiar</button>
    </div>
    <div>
      <div class="flex flex-wrap gap-1 mb-1.5">${diasTxt || '<span class="text-xs text-zinc-500">Sin días definidos</span>'}</div>
      <div class="space-y-1">${disponibilidades.map(a=>`<p class="text-xs text-zinc-300">🕒 ${DAY_FULL[a.dia]||a.dia}: ${esc(a.inicio)}–${esc(a.fin)} · <span class="text-lima">${a.modalidad==='rotativo'?'Rotativo':'Fijo'}</span>${a.tipo==='puntual'?' · '+esc(a.fecha_especifica||'Puntual'):''}</p>`).join('') || '<p class="text-xs text-zinc-500">Sin horarios definidos</p>'}</div>
    </div>
    ${p.observaciones ? `<p class="text-xs text-zinc-400 bg-carbono-800 rounded-lg px-3 py-2 leading-relaxed">📝 ${esc(p.observaciones)}</p>` : ''}
    <div class="flex gap-2 mt-auto pt-1">
      <a href="https://wa.me/${soloDigitos(p.telefono)}" target="_blank" rel="noopener" class="flex-1 text-center bg-[#25D366] hover:bg-[#1ebe5b] text-carbono-950 font-bold text-sm py-2.5 rounded-xl transition">💬 WhatsApp</a>
      <button data-action="edit-player" data-id="${esc(p.id)}" class="bg-carbono-700 hover:bg-carbono-600 px-3.5 rounded-xl" title="Editar">✏️</button>
      <button data-action="deactivate-player" data-id="${esc(p.id)}" class="bg-carbono-700 hover:bg-red-500/80 px-3.5 rounded-xl" title="Desactivar">⏸️</button>
      <button data-action="delete-player" data-id="${esc(p.id)}" data-name="${esc(p.nombre)}" class="bg-red-950/60 hover:bg-red-800 text-red-200 px-3.5 rounded-xl" title="Eliminar definitivamente" aria-label="Eliminar definitivamente a ${esc(p.nombre)}">🗑️</button>
    </div>
  </article>`;
}

function renderBusqueda(){
  const res = players.filter(pasaFiltros);
  $('#contador').textContent = `(${res.length})`;
  $('#contadorTotal').textContent = `(${players.length})`;
  $('#resultados').innerHTML = res.map(tarjetaJugador).join('');
  $('#sinResultados').classList.toggle('hidden', res.length>0);
}

/* ══════════════════════ LISTA COMPLETA ══════════════════════ */
function renderLista(){
  const q = ($('#buscadorGlobal').value||'').toLowerCase();
  const res = players.filter(p => !q || (p.nombre+' '+p.telefono+' '+(p.observaciones||'')).toLowerCase().includes(q));
  $('#contadorTotal').textContent = `(${players.length})`;
  $('#tablaJugadores').innerHTML = res.length ? res.map(p => {
    const av = disponibilidadesDe(p);
    const dias = [...new Set(av.map(a=>a.dia).filter(Boolean))].join(' ');
    const horarios = av.map(a=>`${a.dia} ${esc(a.inicio)}–${esc(a.fin)}`).join('<br>');
    const modalidad = av.length ? [...new Set(av.map(a=>a.modalidad))].map(x=>TIPO_LABEL[x]||x).join(', ') : '—';
    return `
    <tr class="hover:bg-carbono-800/60">
      <td class="px-4 py-3 font-bold">${esc(p.nombre)}</td>
      <td class="px-4 py-3"><span class="bg-lima/15 text-lima px-2 py-0.5 rounded-md text-xs font-bold">${p.nivel == null ? '—' : nivelTxt(p.nivel)}</span></td>
      <td class="px-4 py-3 font-mono text-xs">${esc(p.telefono)}</td>
      <td class="px-4 py-3 text-xs">${dias||'—'}</td>
      <td class="px-4 py-3 text-xs">${horarios||'—'}</td>
      <td class="px-4 py-3 text-xs">${esc(modalidad)}</td>
      <td class="px-4 py-3 text-xs text-zinc-400 max-w-[180px] truncate" title="${esc(p.observaciones)}">${esc(p.observaciones)||'—'}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap">
        <button data-action="copy-phone" data-phone="${soloDigitos(p.telefono)}" class="bg-carbono-700 hover:bg-carbono-600 px-2 py-1 rounded-md text-xs" title="Copiar teléfono">📋</button>
        <a href="https://wa.me/${soloDigitos(p.telefono)}" target="_blank" rel="noopener" class="inline-block bg-[#25D366]/20 text-[#4ceb8a] hover:bg-[#25D366] hover:text-carbono-950 px-2 py-1 rounded-md text-xs font-bold ml-1">💬</a>
        <button data-action="edit-player" data-id="${esc(p.id)}" class="bg-carbono-700 hover:bg-carbono-600 px-2 py-1 rounded-md text-xs ml-1">✏️</button>
        <button data-action="deactivate-player" data-id="${esc(p.id)}" class="bg-carbono-700 hover:bg-red-500/80 px-2 py-1 rounded-md text-xs ml-1" title="Desactivar">⏸️</button>
        <button data-action="delete-player" data-id="${esc(p.id)}" data-name="${esc(p.nombre)}" class="bg-red-950/60 hover:bg-red-800 text-red-200 px-2 py-1 rounded-md text-xs ml-1" title="Eliminar definitivamente">🗑️</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" class="px-4 py-10 text-center text-zinc-500">Sin resultados</td></tr>`;
}

function renderInactivos(){
  const input = $('#buscadorInactivos');
  if(!input) return;
  const q = (input.value||'').toLowerCase();
  const res = inactivePlayers.filter(p => !q || (p.nombre+' '+p.telefono+' '+(p.observaciones||'')).toLowerCase().includes(q));
  $('#contadorInactivos').textContent = `(${inactivePlayers.length})`;
  $('#tablaInactivos').innerHTML = res.length ? res.map(p => {
    const av = disponibilidadesDe(p);
    const resumen = av.map(a=>`${a.dia} ${esc(a.inicio)}–${esc(a.fin)}`).join('<br>') || '—';
    return `<tr class="hover:bg-carbono-800/60">
      <td class="px-4 py-3 font-bold">${esc(p.nombre)}</td>
      <td class="px-4 py-3">${p.nivel == null ? '—' : nivelTxt(p.nivel)}</td>
      <td class="px-4 py-3 font-mono text-xs">${esc(p.telefono)}</td>
      <td class="px-4 py-3 text-xs">${resumen}</td>
      <td class="px-4 py-3 text-right whitespace-nowrap"><button data-action="reactivate-player" data-id="${esc(p.id)}" class="bg-lima hover:bg-lima-dark text-carbono-950 font-bold px-3 py-2 rounded-lg text-xs">↩ Reactivar</button> <button data-action="delete-player" data-id="${esc(p.id)}" data-name="${esc(p.nombre)}" class="bg-red-950/60 hover:bg-red-800 text-red-200 px-3 py-2 rounded-lg text-xs" title="Eliminar definitivamente">🗑️</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="px-4 py-10 text-center text-zinc-500">No hay jugadores inactivos que coincidan</td></tr>`;
}

/* ══════════════════════ CRUD ══════════════════════ */
function construirFormulario(){
  $('#fNivel').innerHTML = '<option value="" disabled selected>Selecciona un nivel</option>' + Array.from({length:17},(_,i)=>(1+i*0.25)).map(n =>
    `<option value="${n.toFixed(2)}">${nivelTxt(n)}</option>`).join('');
}
function anadirDisponibilidad(data={}){
  const d = normalizarDisponibilidad(data);
  const row=document.createElement('div');
  row.className='availability-row bg-carbono-800/70 border border-carbono-700 rounded-xl p-3';
  row.innerHTML=`
    <div class="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
      <label class="block text-xs text-zinc-400">Día
        <select class="av-dia mt-1 w-full bg-carbono-900 border border-carbono-700 rounded-lg px-2 py-2 text-sm">
          ${DAYS.map((dia,i)=>`<option value="${i+1}" ${d.dia_semana===i+1?'selected':''}>${DAY_FULL[dia]}</option>`).join('')}
        </select>
      </label>
      <label class="block text-xs text-zinc-400">Desde
        <input type="time" class="av-inicio mt-1 w-full bg-carbono-900 border border-carbono-700 rounded-lg px-2 py-2 text-sm" value="${d.hora_inicio}">
      </label>
      <label class="block text-xs text-zinc-400">Hasta
        <input type="time" class="av-fin mt-1 w-full bg-carbono-900 border border-carbono-700 rounded-lg px-2 py-2 text-sm" value="${d.hora_fin}">
      </label>
      <label class="block text-xs text-zinc-400">Modalidad
        <select class="av-modalidad mt-1 w-full bg-carbono-900 border border-carbono-700 rounded-lg px-2 py-2 text-sm">
          <option value="fijo" ${d.modalidad_horario==='fijo'?'selected':''}>Fijo</option>
          <option value="rotativo" ${d.modalidad_horario==='rotativo'?'selected':''}>Rotativo</option>
        </select>
      </label>
      <label class="block text-xs text-zinc-400">Tipo
        <select class="av-tipo mt-1 w-full bg-carbono-900 border border-carbono-700 rounded-lg px-2 py-2 text-sm" data-change="availability-type">
          <option value="habitual" ${d.tipo==='habitual'?'selected':''}>Habitual</option>
          <option value="puntual" ${d.tipo==='puntual'?'selected':''}>Puntual</option>
        </select>
      </label>
      <button type="button" data-action="remove-availability" class="bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-900 rounded-lg px-2 py-2 text-xs">✕ Quitar</button>
    </div>
    <div class="av-fecha-wrap ${d.tipo==='puntual'?'':'hidden'} mt-2">
      <label class="block text-xs text-zinc-400">Fecha de la disponibilidad puntual *
        <input type="date" class="av-fecha mt-1 bg-carbono-900 border border-carbono-700 rounded-lg px-3 py-2 text-sm" value="${d.fecha_especifica||''}">
      </label>
    </div>`;
  row.insertAdjacentHTML('beforeend','<p class="availability-error hidden mt-1 text-xs text-red-300" aria-live="polite"></p>');
  $('#fDisponibilidades').appendChild(row);
}
function cambiarTipoDisponibilidad(select){
  const wrap=select.closest('.availability-row').querySelector('.av-fecha-wrap');
  wrap.classList.toggle('hidden',select.value!=='puntual');
}
function leerDisponibilidades(){
  return $$('#fDisponibilidades .availability-row').map(row=>({
    dia_semana:Number(row.querySelector('.av-dia').value),
    hora_inicio:row.querySelector('.av-inicio').value,
    hora_fin:row.querySelector('.av-fin').value,
    modalidad_horario:row.querySelector('.av-modalidad').value,
    tipo:row.querySelector('.av-tipo').value,
    fecha_especifica:row.querySelector('.av-tipo').value==='puntual' ? row.querySelector('.av-fecha').value : null
  }));
}

function abrirModal(id=null){
  editandoId = id;
  limpiarErroresFormulario();
  const f = $('#formJugador'); f.reset();
  $('#fDisponibilidades').innerHTML='';
  $('#modalTitulo').textContent = id ? '✏️ Editar jugador' : '➕ Nuevo jugador';
  if(id){
    const p = players.find(x => x.id===id); if(!p) return;
    $('#fNombre').value=p.nombre;
    $('#fTelefono').value=p.telefono;
    $('#fNivel').value=p.nivel == null ? '' : (+p.nivel).toFixed(2);
    $('#fEmail').value=p.correo_electronico || '';
    $('#fLado').value=p.lado_preferido || 'indiferente';
    $('#fBuscaPartidas').checked=p.busca_partidas !== false;
    $('#fNotas').value=p.observaciones || '';
    (p.disponibilidades||[]).forEach(d=>anadirDisponibilidad(d));
    // Compatibilidad con jugadores cargados desde una versión anterior.
    if(!(p.disponibilidades||[]).length && p.dias?.length){
      p.dias.forEach(dia=>anadirDisponibilidad({dia_semana:diaANumero(dia),hora_inicio:p.inicio,hora_fin:p.fin,modalidad_horario:['fijo','rotativo'].includes(p.tipo)?p.tipo:'fijo'}));
    }
  }
  $('#modal').classList.remove('hidden');
  setTimeout(()=>$('#fNombre').focus(), 50);
}
function cerrarModal(){ $('#modal').classList.add('hidden'); editandoId=null; limpiarErroresFormulario(); }

async function guardarJugador(ev){
  ev.preventDefault();
  limpiarErroresFormulario();
  const disponibilidades=leerDisponibilidades();
  const datos={
    nombre:$('#fNombre').value.normalize('NFC').trim().replace(/\s+/g,' '),
    telefono:$('#fTelefono').value.trim(),
    correo_electronico:$('#fEmail').value.trim() || null,
    nivel:$('#fNivel').value===''?null:parseFloat($('#fNivel').value),
    disponibilidades,
    lado_preferido:$('#fLado').value,
    busca_partidas:$('#fBuscaPartidas').checked,
    observaciones:$('#fNotas').value.trim()
  };
  const validationErrors=validarFormulario(datos);
  if(validationErrors.length){
    mostrarErroresFormulario(validationErrors);
    toast('Revisa los campos marcados en rojo.',false);
    return;
  }
  try {
    const payload=payloadJugador(datos);
    if(editandoId) await api('/api/jugadores/'+editandoId,{method:'PUT',body:JSON.stringify(payload)});
    else await api('/api/jugadores',{method:'POST',body:JSON.stringify(payload)});
    await cargarDesdeApi(); cerrarModal(); toast(editandoId?'✅ Jugador actualizado':'✅ Jugador guardado en Supabase');
  } catch(error){
    if(error.validationErrors?.length){
      mostrarErroresFormulario(error.validationErrors);
      toast('Revisa los campos marcados en rojo.',false);
    } else toast(error.message,false);
  }
}
async function eliminarJugador(id){
  const p=players.find(x=>x.id===id); if(!p)return;
  if(!confirm(`¿Desactivar a ${p.nombre}? El contacto no se borrará físicamente.`))return;
  try{await api('/api/jugadores/'+id,{method:'DELETE'});await cargarDesdeApi();toast('🗑️ Jugador desactivado');}
  catch(error){toast(error.message,false);}
}
async function eliminarJugadorDefinitivamente(id,nombre){
  if(!confirm(`¿Eliminar definitivamente a ${nombre}? Se borrarán su ficha, contacto y disponibilidades. Esta acción no se puede deshacer.`))return;
  try{
    await api('/api/jugadores/'+encodeURIComponent(id)+'/permanente',{method:'DELETE'});
    await Promise.all([cargarDesdeApi(),cargarInactivosDesdeApi()]);
    toast('🗑️ Jugador eliminado definitivamente');
  }catch(error){toast(error.message,false);}
}
async function reactivarJugador(id){
  const p=inactivePlayers.find(x=>x.id===id);
  if(!p) return;
  if(!confirm(`¿Reactivar a ${p.nombre}? Volverá a aparecer entre los jugadores activos.`)) return;
  try{
    await api('/api/jugadores/'+id+'/reactivar',{method:'POST'});
    await Promise.all([cargarDesdeApi(),cargarInactivosDesdeApi()]);
    toast('✅ Jugador reactivado');
  }catch(error){toast(error.message,false);}
}

/* ══════════════════════ COPIAR / EXPORTAR / IMPORTAR ══════════════════════ */
async function copiarTelefono(num, btn){
  try{ await navigator.clipboard.writeText(num); }
  catch(e){ const t=document.createElement('textarea'); t.value=num; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  const prev = btn.innerHTML; btn.innerHTML='✔ Copiado';
  toast('📋 Teléfono copiado: '+num);
  setTimeout(()=>btn.innerHTML=prev, 1200);
}
function toggleMenuExport(){ $('#menuExport').classList.toggle('hidden'); }
document.addEventListener('click', e => { if(!e.target.closest('#menuExport') && !e.target.closest('[onclick*="toggleMenuExport"]')) $('#menuExport').classList.add('hidden'); });

function descargar(nombre, contenido, tipo){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenido], {type:tipo}));
  a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
}
function exportar(formato){
  $('#menuExport').classList.add('hidden');
  const fecha = new Date().toISOString().slice(0,10);
  if(formato==='json'){
    descargar(`jugadores-padel-${fecha}.json`, JSON.stringify(players, null, 2), 'application/json');
  } else {
    const cabecera = ['nombre','telefono','correo_electronico','nivel','disponibilidades','observaciones','lado_preferido','busca_partidas'];
    const filas = players.map(p => [p.nombre,p.telefono,p.correo_electronico,p.nivel,JSON.stringify((p.disponibilidades||[]).map(normalizarDisponibilidad)),p.observaciones,p.lado_preferido,p.busca_partidas]);
    descargar(`jugadores-padel-${fecha}.csv`, CsvTools.stringify([cabecera,...filas], ';'), 'text/csv;charset=utf-8');
  }
  toast('📤 Archivo descargado');
}

async function importarArchivo(ev){
  const file=ev.target.files[0]; if(!file)return;
  try {
    const txt=(await file.text()).trim(); let nuevos;
    if(file.name.endsWith('.json') || txt.startsWith('[') || txt.startsWith('{')){
      const d=JSON.parse(txt); nuevos=(Array.isArray(d)?d:d.jugadores||[]).map(normalizarJugador).filter(Boolean);
    } else {
      const [cabecera,...registros]=CsvTools.parse(txt);
      const cabeceras=cabecera.map(x=>x.trim().toLowerCase());
      nuevos=registros.filter(row=>row.some(value=>value.trim())).map(c=>{
        const fila=Object.fromEntries(cabeceras.map((h,i)=>[h,c[i]||'']));
        let disponibilidades = [];
        if(fila.disponibilidades){ try { disponibilidades = JSON.parse(fila.disponibilidades); } catch(e) {} }
        return normalizarJugador({nombre:fila.nombre,telefono:fila.telefono,nivel:fila.nivel,disponibilidades,dias:(fila.dias||'').split(/\s+/),inicio:fila.inicio,fin:fila.fin,tipo:fila.tipo,observaciones:fila.observaciones||fila.notas,correo_electronico:fila.correo_electronico||fila.email,lado_preferido:fila.lado_preferido,busca_partidas:fila.busca_partidas});
      }).filter(Boolean);
    }
    if(!nuevos.length)throw new Error('No se encontraron filas válidas');
    if(!confirm(`Se enviarán ${nuevos.length} jugadores a Supabase. ¿Continuar?`))return;
    const result=await api('/api/jugadores/lote',{method:'POST',body:JSON.stringify(nuevos.map(payloadJugador))});
    await cargarDesdeApi(); toast(`✅ ${result.length} jugadores importados`);
  } catch(error){toast(error.message,false);} finally {ev.target.value='';}
}
function normalizarJugador(d){
  if(!d || !d.nombre || !d.telefono) return null;
  let disponibilidades = Array.isArray(d.disponibilidades) ? d.disponibilidades.map(normalizarDisponibilidad) : [];
  if(!disponibilidades.length){
    const dias = Array.isArray(d.dias) ? d.dias : String(d.dias||'').split(/[\s,;]+/);
    disponibilidades = dias.map(x=>x.trim().toUpperCase().slice(0,1)).filter(x=>DAYS.includes(x)).map(dia=>({
      dia_semana:diaANumero(dia),
      hora_inicio:/^\d{1,2}:\d{2}$/.test(d.inicio||'') ? d.inicio : '',
      hora_fin:/^\d{1,2}:\d{2}$/.test(d.fin||'') ? d.fin : '',
      modalidad_horario:['fijo','rotativo'].includes(d.tipo) ? d.tipo : 'fijo',
      tipo:'habitual',fecha_especifica:null
    }));
  }
  return {
    id:d.id || 'p'+Date.now()+Math.random().toString(36).slice(2,6),
    correo_electronico:String(d.correo_electronico || d.email || '').trim(),
    nombre:String(d.nombre).trim(),
    telefono:String(d.telefono).trim(),
    nivel:d.nivel === '' || d.nivel == null ? null : Math.min(5, Math.max(1, Math.round(parseFloat(String(d.nivel).replace(',','.'))*4)/4)),
    disponibilidades,
    observaciones:String(d.observaciones || d.notas || '').trim(),
    lado_preferido:d.lado_preferido || 'indiferente',
    busca_partidas:d.busca_partidas !== false && d.busca_partidas !== 'false'
  };
}

/* ══════════════════════ PARSER WHATSAPP POR BLOQUES ══════════════════════ */
function analizarTexto(){
  const texto=$('#textoWhatsapp').value.trim();
  if(!texto){toast('❌ Pega primero los mensajes de WhatsApp',false);return;}
  candidatos=WhatsAppParser.parse(texto);
  if(!candidatos.length){toast('❌ No se detectaron jugadores con datos reconocibles',false);return;}
  renderCandidatos();
  const sinTelefono=candidatos.filter(c=>!c.telefono).length;
  const sinNombre=candidatos.filter(c=>!c.nombre).length;
  toast(`🔍 ${candidatos.length} jugadores detectados. ${sinNombre} sin nombre y ${sinTelefono} sin teléfono. Revisa antes de guardar.`);
}
function renderCandidatos(){
  $('#zonaCandidatos').classList.remove('hidden');
  $('#contadorCandidatos').textContent = `(${candidatos.length})`;
  $('#tablaCandidatos').innerHTML = candidatos.map((c,i) => `
    <tr class="${c.sel?'':'opacity-50'}">
      <td class="px-2 py-2"><input type="checkbox" ${c.sel?'checked':''} data-candidate-index="${i}" data-candidate-field="sel" class="w-4 h-4 accent-lima"></td>
      <td class="px-2 py-1"><input value="${esc(c.nombre)}" data-candidate-index="${i}" data-candidate-field="nombre" class="w-full bg-carbono-800 border border-carbono-700 rounded-lg px-2 py-1.5 text-xs focus:border-lima focus:outline-none"></td>
      <td class="px-2 py-1"><input value="${esc(c.telefono)}" data-candidate-index="${i}" data-candidate-field="telefono" class="w-28 bg-carbono-800 border border-carbono-700 rounded-lg px-2 py-1.5 text-xs font-mono focus:border-lima focus:outline-none"></td>
      <td class="px-2 py-1"><select data-candidate-index="${i}" data-candidate-field="nivel" class="bg-carbono-800 border border-carbono-700 rounded-lg px-1 py-1.5 text-xs focus:border-lima focus:outline-none">
        <option value="" ${c.nivel===null?'selected':''}>Sin nivel</option>${Array.from({length:17},(_,j)=>1+j*.25).map(n=>`<option value="${n}" ${c.nivel!==null && Math.abs(n-c.nivel)<0.01?'selected':''}>${nivelTxt(n)}</option>`).join('')}</select></td>
      <td class="px-2 py-1">
        <div class="space-y-1.5">
          ${c.horarios.map((h,j)=>`<div class="flex flex-wrap items-center gap-1.5">
            <select aria-label="Día del horario ${j+1}" data-candidate-index="${i}" data-schedule-index="${j}" data-schedule-field="dia" class="bg-carbono-800 border border-carbono-700 rounded-lg px-1.5 py-1.5 text-xs">
              ${DAYS.map((d,k)=>`<option value="${d}" ${h.dia===d?'selected':''}>${DAY_FULL[d]}</option>`).join('')}
            </select>
            <input aria-label="Hora de inicio del horario ${j+1}" type="time" value="${esc(h.inicio||'')}" data-candidate-index="${i}" data-schedule-index="${j}" data-schedule-field="inicio" class="bg-carbono-800 border border-carbono-700 rounded-lg px-1 py-1 text-xs">
            <span class="text-zinc-500">a</span>
            <input aria-label="Hora de fin del horario ${j+1}" type="time" value="${esc(h.fin||'')}" data-candidate-index="${i}" data-schedule-index="${j}" data-schedule-field="fin" class="bg-carbono-800 border border-carbono-700 rounded-lg px-1 py-1 text-xs">
            <select aria-label="Tipo del horario ${j+1}" data-candidate-index="${i}" data-schedule-index="${j}" data-schedule-field="tipo" class="bg-carbono-800 border border-carbono-700 rounded-lg px-1 py-1.5 text-xs">
              ${TIPOS.map(([v,l])=>`<option value="${v}" ${h.tipo===v?'selected':''}>${esc(l.split(' ')[1])}</option>`).join('')}
            </select>
            <button type="button" data-action="remove-candidate-schedule" data-index="${i}" data-schedule-index="${j}" class="text-red-300 hover:text-red-100 px-1" aria-label="Quitar horario ${j+1}">✕</button>
          </div>`).join('') || '<span class="text-xs text-zinc-500">Sin horarios detectados</span>'}
          <button type="button" data-action="add-candidate-schedule" data-index="${i}" class="text-xs text-lima hover:underline">＋ Añadir horario</button>
        </div>
      </td>
    </tr>`).join('');
  $('#zonaCandidatos').scrollIntoView({behavior:'smooth', block:'start'});
}
function añadirHorarioCandidato(i){ candidatos[i]?.horarios.push({dia:'L',inicio:'',fin:'',tipo:'fijo'}); renderCandidatos(); }
function quitarHorarioCandidato(i,j){ if(candidatos[i]?.horarios[j]){candidatos[i].horarios.splice(j,1);renderCandidatos();} }
function marcarTodos(v){ candidatos.forEach(c => c.sel=v); renderCandidatos(); }
async function añadirCandidatos(){
  const seleccionados=candidatos.filter(c=>c.sel);
  if(!seleccionados.length){toast('❌ Selecciona al menos un candidato',false);return;}
  const incompletos=seleccionados.filter(c=>!c.nombre.trim()||soloDigitos(c.telefono).length<9||c.nivel===null||!c.horarios.length||c.horarios.some(h=>!DAYS.includes(h.dia)));
  if(incompletos.length){toast('❌ Cada jugador necesita nombre, teléfono válido, nivel y al menos un horario con día.',false);return;}
  const horarioInvalido=seleccionados.some(c=>c.horarios.some(h=>(Boolean(h.inicio)!==Boolean(h.fin))||(h.inicio&&h.fin&&h.fin<=h.inicio)));
  if(horarioInvalido){toast('❌ Cada horario debe tener ambas horas o dejarlas vacías; la hora final debe ser posterior a la inicial.',false);return;}
  const payloads=seleccionados.map(c=>payloadJugador({nombre:c.nombre,telefono:c.telefono,nivel:c.nivel,disponibilidades:WhatsAppParser.toDisponibilidades(c.horarios),observaciones:''}));
  try{
    const result=await api('/api/jugadores/lote',{method:'POST',body:JSON.stringify(payloads)});
    await cargarDesdeApi(); toast(`✅ ${result.length} jugadores guardados en Supabase`);
    $('#zonaCandidatos').classList.add('hidden'); $('#textoWhatsapp').value='';
  }catch(error){toast(error.message,false);}
}

/* ══════════════════════ ARRANQUE ══════════════════════ */
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  if (target.id === 'modal') { cerrarModal(); return; }
  const button = target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'new-player') abrirModal();
  else if (action === 'import-file') $('#importFile').click();
  else if (action === 'toggle-export') toggleMenuExport();
  else if (action === 'export') exportar(button.dataset.format);
  else if (action === 'tab') mostrarTab(button.dataset.tab);
  else if (action === 'clear-filters') limpiarFiltros();
  else if (action === 'analyze-text') analizarTexto();
  else if (action === 'clear-whatsapp') $('#textoWhatsapp').value = '';
  else if (action === 'select-all-candidates') marcarTodos(true);
  else if (action === 'select-no-candidates') marcarTodos(false);
  else if (action === 'add-candidates') añadirCandidatos();
  else if (action === 'close-modal') cerrarModal();
  else if (action === 'add-availability') anadirDisponibilidad();
  else if (action === 'remove-availability') button.closest('.availability-row')?.remove();
  else if (action === 'filter') toggleFiltro(button.dataset.group, button.dataset.value, button);
  else if (action === 'set-type') setTipo(button.dataset.value, button);
  else if (action === 'copy-phone') copiarTelefono(button.dataset.phone, button);
  else if (action === 'edit-player') abrirModal(button.dataset.id);
  else if (action === 'deactivate-player') eliminarJugador(button.dataset.id);
  else if (action === 'delete-player') eliminarJugadorDefinitivamente(button.dataset.id,button.dataset.name);
  else if (action === 'reactivate-player') reactivarJugador(button.dataset.id);
  else if (action === 'add-candidate-schedule') añadirHorarioCandidato(Number(button.dataset.index));
  else if (action === 'remove-candidate-schedule') quitarHorarioCandidato(Number(button.dataset.index), Number(button.dataset.scheduleIndex));
});

document.addEventListener('input', event => {
  const target = event.target;
  if(target instanceof HTMLElement && target.closest('#formJugador')) limpiarErrorCampo(target);
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === 'hMin' || target.id === 'hMax') cambiarRango(event);
  else if (target.id === 'buscadorGlobal') renderLista();
  else if (target.id === 'buscadorInactivos') renderInactivos();
  else if (target.dataset.candidateIndex !== undefined) {
    const candidate = candidatos[Number(target.dataset.candidateIndex)];
    if (candidate && target.dataset.scheduleIndex !== undefined) {
      const schedule = candidate.horarios[Number(target.dataset.scheduleIndex)];
      if (schedule) schedule[target.dataset.scheduleField] = target.value;
    } else if (candidate) candidate[target.dataset.candidateField] = target.value;
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if(target.closest('#formJugador')) limpiarErrorCampo(target);
  if (target.id === 'importFile') importarArchivo(event);
  else if (target.matches('[data-change="availability-type"]')) cambiarTipoDisponibilidad(target);
  else if (target.dataset.candidateIndex !== undefined) {
    const candidate = candidatos[Number(target.dataset.candidateIndex)];
    if (!candidate) return;
    if (target.dataset.scheduleIndex !== undefined) {
      const schedule = candidate.horarios[Number(target.dataset.scheduleIndex)];
      if (schedule) schedule[target.dataset.scheduleField] = target.value;
      return;
    }
    const field = target.dataset.candidateField;
    if (field === 'sel') {
      candidate.sel = target.checked;
      target.closest('tr')?.classList.toggle('opacity-50', !candidate.sel);
    } else if (field === 'nivel') {
      candidate.nivel = target.value === '' ? null : parseFloat(target.value);
    } else if (field) candidate[field] = target.value;
  }
});

document.addEventListener('submit', event => {
  if (event.target instanceof HTMLFormElement && event.target.id === 'formJugador') {
    event.preventDefault();
    guardarJugador(event);
  }
});

construirFiltros();
construirFormulario();
cargarDesdeApi().catch(error=>toast(error.message,false));
