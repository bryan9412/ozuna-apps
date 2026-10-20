/* App de la vendedora: recibe la entrega, anota ventas sin conexión, pide devoluciones y manda el cierre. */
import * as C from '../shared/core.js';
import { h, montar, aviso, hoja, confirmar, campo, barraNav, registrarSW, selectorTema, tarjetaActualizar, icono, avisoAccion } from '../shared/ui.js';

const VERSION_APP = '0.4.5';
const BANDEJA = 'ozuna-bandeja-vendedor';
const db = new C.DB('ozuna-vendedor');
const raiz = document.getElementById('app');
let perfil, llaves, confianza, dia, pantalla = 'vender', cart = [], hayVersionNueva = null, ocupado = false;

const NAV = [['vender', 'carrito', 'Vender'], ['ventas', 'recibo', 'Ventas'], ['cierre', 'check', 'Cierre'], ['mas', 'ajustes', 'Más']];
const ticket = n => 'T-' + String(n).padStart(3, '0');
const guardarDia = () => db.kvSet('dia', dia);

/* ---------- datos del día ---------- */
async function ventasDia(){ if(!dia) return []; return (await db.todos('ventas')).filter(v => v.diaId === dia.entregaId).sort((a, b) => a.num - b.num); }
async function solicitudesDia(){ if(!dia) return []; return (await db.todos('eventos')).filter(e => e.diaId === dia.entregaId && e.clase === 'solicitud').sort((a, b) => a.ts - b.ts); }
function prod(id){ return dia && dia.catalogo.find(p => p.id === id); }
function vendidoMilli(ventas){ const m = {}; for(const v of ventas) for(const l of v.lineas) m[l.productoId] = (m[l.productoId] || 0) + l.qtyMilli; return m; }
function tasaDe(m){ return m === 'CUP' ? 100 : (dia && dia.tasas && dia.tasas[m]) || 0; }

/* ---------- arranque ---------- */
async function iniciar(){
  perfil = await db.kv('perfil'); llaves = await db.kv('llaves'); confianza = await db.kv('confianza'); dia = await db.kv('dia');
  registrarSW('./sw.js', aplicar => { hayVersionNueva = aplicar; pintar(); });
  if(!perfil || !llaves) return bienvenida();
  C.pedirPersistencia();
  await restaurarCarrito();
  await revisarBandeja();
  window.addEventListener('online', () => { if(pantalla === 'vender') pintar(); }); window.addEventListener('offline', () => { if(pantalla === 'vender') pintar(); });
  pintar();
}
function bienvenida(){
  const nombre = h('input', {placeholder:'Tu nombre', autocomplete:'off', 'aria-label':'Tu nombre'});
  montar(raiz, h('h1', {}, 'Bienvenida a Ozuna'), h('p', {class:'ayuda'}, 'Esta aplicación funciona sin internet. Primero dinos cómo te llamas.'),
    campo('Tu nombre', nombre),
    h('button', {class:'btn', onclick:async () => {
      const n = nombre.value.trim(); if(!n){ aviso('Escribe tu nombre', true); nombre.focus(); return; }
      llaves = await C.nuevasLlaves(false);
      perfil = {id:C.uid(), nombre:n, pub:llaves.pub};
      await db.kvSet('llaves', llaves); await db.kvSet('perfil', perfil); C.pedirPersistencia();
      pantalla = 'mas'; pintar(); aviso('Listo. Ahora manda el código de enlace al dueño.');
    }}, 'Seguir'));
  montar(document.getElementById('navbox')); montar(document.getElementById('carrito'));
}

/* ---------- pintado general ---------- */
function pintar(){
  const vistas = {vender:vVender, ventas:vVentas, cierre:vCierre, mas:vMas};
  (vistas[pantalla] || vVender)();
  montar(document.getElementById('navbox'), barraNav(NAV, pantalla, ir));
  pintarCarrito();
}
/* Al cambiar de pestaña se recuerda dónde estabas en Vender y en Ventas, para volver al mismo punto. */
function ir(p){
  memoriaScroll[pantalla] = window.scrollY; pantalla = p;
  if(p === 'vender' || p === 'ventas') pendienteScroll = memoriaScroll[p] || 0; else { pendienteScroll = null; window.scrollTo(0, 0); }
  pintar();
}
function banner(){ return hayVersionNueva ? h('div', {class:'banner'}, 'Hay una versión nueva', h('button', {onclick:hayVersionNueva}, 'Actualizar')) : null; }
function sinEntrega(){
  montar(raiz, banner(), h('p', {class:'marca'}, perfil.nombre), h('h1', {}, 'Buenos días'), h('p', {class:'ayuda'}, 'Para empezar, carga la entrega que te mandó el dueño por WhatsApp.'), cajaCarga());
  return true;
}
function cajaCarga(){
  return h('div', {class:'card'}, h('h3', {}, 'Cargar lo que mandó el dueño'),
    h('button', {class:'btn', onclick:pegarCopiado}, 'Pegar lo que copié de WhatsApp'),
    h('button', {class:'btn suave', onclick:async () => { const a = await C.elegirArchivos(); if(a.length) await procesarVarios(a.map(x => x.texto)); }}, 'Elegir archivo(s) de Descargas'),
    h('p', {class:'ayuda'}, 'Lo más rápido: en WhatsApp toca el archivo, elige Compartir y escoge «Ozuna». Si abres el selector de archivos, mira en «Recientes»: ahí sale lo último que bajó WhatsApp. Puedes elegir varios a la vez.'));
}
async function pegarCopiado(){ const t = await C.leerPortapapeles(); if(t && C.leerTexto(t)) await procesarTexto(t); else pegarTexto(); }
function pegarTexto(){
  hoja('Pegar el mensaje', cerrar => {
    const ta = h('textarea', {class:'bloque-codigo', 'aria-label':'Mensaje del dueño'});
    return h('div', {}, h('p', {class:'ayuda'}, 'En WhatsApp mantén el dedo sobre el mensaje, toca Copiar y pégalo aquí.'), ta,
      h('button', {class:'btn', onclick:async () => { cerrar(); await procesarTexto(ta.value); }}, 'Cargar'));
  });
}
/* Varios archivos a la vez: se cargan en el orden en que se crearon, no en el orden en que se eligieron. */
async function procesarVarios(textos){
  aviso("Leyendo "+textos.length+(textos.length===1?" archivo…":" archivos…"));
  const lista = []; for(const t of textos){ const e = C.leerTexto(t); if(e) lista.push({e, t}); else aviso('Un archivo no es de Ozuna y se saltó.', true); }
  lista.sort((a, b) => String(a.e.creado).localeCompare(String(b.e.creado)));
  for(const x of lista) await procesarTexto(x.t);
}

/* ---------- recibir archivos ---------- */
async function revisarBandeja(){ const textos = await C.leerBandeja(BANDEJA); if(textos.length) await procesarVarios(textos); }
async function procesarTexto(txt){
  const env = C.leerTexto(txt);
  if(!env){ aviso('Eso no es un archivo de Ozuna. Revisa que sea el que te mandaron.', true); return; }
  const v = await C.verificarSobre(env, confianza ? confianza.pub : undefined);
  if(!v.ok){ aviso(v.motivo, true); return; }
  if(env.tipo === 'entrega') return cargarEntrega(env);
  if(env.tipo === 'reposicion') return cargarReposicion(env);
  if(env.tipo === 'ajuste') return cargarAjuste(env);
  if(env.tipo === 'traspaso-salida' || env.tipo === 'traspaso-entrada') return cargarTraspaso(env);
  aviso(env.tipo === 'enlace' || env.tipo === 'cierre' ? 'Ese archivo es para el dueño, no para ti.' : 'Ese archivo no es una entrega.', true);
}
async function asegurarConfianza(env){
  if(confianza) return true;
  const f = await C.huella(env.de.pub);
  const si = await confirmar('¿Es este tu dueño?', 'El archivo viene de «' + env.de.nombre + '» (huella ' + f + '). Solo acepta si es quien te da la mercancía. Después solo se aceptarán archivos de él.', 'Sí, es mi dueño', 'No');
  if(!si) return false;
  confianza = {pub:env.de.pub, id:env.de.id, nombre:env.de.nombre, huella:f}; await db.kvSet('confianza', confianza); return true;
}
async function cargarEntrega(env){
  const p = env.payload;
  if(p.dispositivoId !== perfil.id){ aviso('Esta entrega es para otro teléfono.', true); return; }
  if(dia && dia.entregaId === p.entregaId){ aviso('Esa entrega ya está cargada.'); return; }
  if(!(await asegurarConfianza(env))) return;
  if(dia && dia.creadaEn && env.creado < dia.creadaEn){
    const si = await confirmar('Esta entrega es más vieja que la que ya tienes', 'La que tienes cargada se creó después. Cargar esta borraría la más nueva.', 'Cargar la vieja igual', 'No, dejar la nueva'); if(!si) return;
  }
  if(dia && dia.contador > 0 && dia.enviadoHash !== dia.ultimoHash){
    const si = await confirmar('Todavía no mandaste el cierre', 'Tienes ventas del día anterior sin enviar. Si cargas esta entrega ahora, se quedan guardadas pero tendrás que mandar ese cierre después desde un teléfono con la copia.', 'Cargar la entrega igual', 'Primero el cierre');
    if(!si){ ir('cierre'); return; }
  }
  dia = {entregaId:p.entregaId, fecha:p.fecha, puesto:p.puesto, catalogo:p.catalogo, agregos:p.agregos || [], cantidades:p.cantidades || {}, fondoCents:p.fondoCents || 0,
    tasas:p.tasas || {}, clave:p.clave || null, listas:p.listas || [], mensajeros:p.mensajeros || [], creadaEn:env.creado, ajustes:[], aplicados:{}, traspasos:{}, ultimoHash:'GENESIS', contador:0, cierreVersion:0, enviadoHash:null, capturas:{}, contado:{}, duenoId:env.de.id};
  limpiarCarrito(); await guardarDia(); aviso('Entrega cargada: ' + p.puesto.nombre); ir('vender');
}
async function cargarReposicion(env){
  const p = env.payload;
  if(!dia || dia.entregaId !== p.entregaId){ aviso('Esto es de otro día. Carga primero la entrega que corresponde.', true); return; }
  if(p.dispositivoId !== perfil.id){ aviso('Esto es para otro teléfono.', true); return; }
  if(dia.reposiciones && dia.reposiciones[env.id]){ aviso('Eso ya está cargado.'); return; }
  const soloPrecios = !Object.keys(p.cantidades || {}).length;
  for(const [id, q] of Object.entries(p.cantidades || {})) dia.cantidades[id] = (dia.cantidades[id] || 0) + q;
  if(p.catalogoCompleto && p.catalogo) dia.catalogo = p.catalogo;
  else for(const n of p.catalogo || []){ const i = dia.catalogo.findIndex(x => x.id === n.id); if(i >= 0) dia.catalogo[i] = n; else dia.catalogo.push(n); }
  for(const n of p.agregos || []){ const i = dia.agregos.findIndex(x => x.id === n.id); if(i >= 0) dia.agregos[i] = n; else dia.agregos.push(n); }
  if(p.tasas) dia.tasas = p.tasas;
  if(p.listas) dia.listas = p.listas;
  if(p.mensajeros) dia.mensajeros = p.mensajeros;
  dia.reposiciones = dia.reposiciones || {}; dia.reposiciones[env.id] = Date.now();
  limpiarCarrito(); await guardarDia(); aviso(soloPrecios ? 'Precios actualizados' : 'Reposición cargada'); ir('vender');
}
/* El dueño corrige lo que había mandado (por ejemplo, «eran 4 paquetes pero no había»). Queda anotado y viaja en el cierre. */
async function cargarAjuste(env){
  const p = env.payload;
  if(!dia || dia.entregaId !== p.entregaId){ aviso('Esta corrección es de otro día. Carga primero la entrega que corresponde.', true); return; }
  if(p.dispositivoId !== perfil.id){ aviso('Esta corrección es para otro teléfono.', true); return; }
  dia.aplicados = dia.aplicados || {}; if(dia.aplicados[env.id]){ aviso('Esa corrección ya está aplicada.'); return; }
  dia.ajustes = dia.ajustes || []; const nombres = [];
  for(const a of p.ajustes){ dia.cantidades[a.productoId] = (dia.cantidades[a.productoId] || 0) + a.deltaMilli; dia.ajustes.push({id:C.uid(), productoId:a.productoId, deltaMilli:a.deltaMilli, motivo:a.motivo || '', por:'dueño', ts:Date.now()}); nombres.push((prod(a.productoId) || {nombre:'un producto'}).nombre); }
  dia.aplicados[env.id] = Date.now(); await guardarDia(); aviso('El dueño corrigió la existencia de ' + nombres.join(', ') + '.'); pintar();
}

/* Traspaso entre puestos: el dueño manda una salida al puesto que da y una entrada al que recibe. Cada vendedora confirma la suya al cargarla. */
async function cargarTraspaso(env){
  const p = env.payload, salida = env.tipo === 'traspaso-salida';
  if(!dia || dia.entregaId !== p.entregaId){ aviso('Este traspaso es de otro día. Carga primero la entrega que corresponde.', true); return; }
  if(p.dispositivoId !== perfil.id){ aviso('Este traspaso es para otro teléfono.', true); return; }
  dia.traspasos = dia.traspasos || {};
  if(dia.traspasos[p.traspasoId] && dia.traspasos[p.traspasoId].sentido === (salida ? 'salida' : 'entrada')){ aviso('Ese traspaso ya está anotado.'); return; }
  for(const n of p.catalogo || []){ const i = dia.catalogo.findIndex(x => x.id === n.id); if(i >= 0) dia.catalogo[i] = n; else dia.catalogo.push(n); }
  const faltan = [];
  for(const it of p.items){ const antes = dia.cantidades[it.productoId] || 0; dia.cantidades[it.productoId] = antes + (salida ? -it.qtyMilli : it.qtyMilli); if(salida && antes < it.qtyMilli) faltan.push((prod(it.productoId) || {nombre:'un producto'}).nombre); }
  dia.traspasos[p.traspasoId] = {id:p.traspasoId, sentido:salida ? 'salida' : 'entrada', contra:p.contra, items:p.items, ts:Date.now()};
  await guardarDia();
  aviso((salida ? 'Salida anotada hacia ' : 'Entrada anotada desde ') + p.contra + (faltan.length ? '. Ojo: te quedaba menos de ' + faltan.join(', ') : '.'), faltan.length > 0);
  pintar();
}

/* ---------- vender ---------- */
let cartLista = null, cartAuth = false;
function precioUnit(l){
  const p = prod(l.pid); if(!p) return 0;
  if(l.precio != null) return l.precio;
  if(cartLista) return Math.round(p.precioCents * (100 - cartLista.pct) / 100 / 100) * 100;
  return p.precioCents;
}
function totalLinea(l){
  const p = prod(l.pid); if(!p) return 0;
  let t = C.importeLinea(precioUnit(l), l.qty);
  for(const [id, c] of Object.entries(l.ag || {})){ const a = dia.agregos.find(x => x.id === id); if(a) t += a.precioCents * c; }
  return t;
}
const totalCarrito = () => cart.reduce((s, l) => s + totalLinea(l), 0);
function limpiarCarrito(){ cart = []; cartLista = null; cartAuth = false; guardarCarrito(); }
function textoCantidad(p, q){ return C.cantidad(q) + ' ' + C.nombreMedida(p.medida, q); }

/* Pide la clave del dueño (fiado, precios especiales). Devuelve true o false. */
function pedirClave(motivo){
  return new Promise(res => {
    if(!dia.clave){ aviso('El dueño no activó la clave en esta entrega.', true); return res(false); }
    let listo = false;
    hoja('Clave del dueño', cerrar => {
      const pin = h('input', {type:'password', inputmode:'numeric', placeholder:'Clave', autocomplete:'off', 'aria-label':'Clave del dueño'});
      const ok = async () => { if(await C.hashClave(pin.value, dia.clave.sal) === dia.clave.hash){ listo = true; cerrar(); res(true); } else { aviso('Esa no es la clave.', true); pin.value = ''; pin.focus(); } };
      pin.addEventListener('keydown', e => { if(e.key === 'Enter') ok(); }); setTimeout(() => pin.focus(), 50);
      return h('div', {}, h('p', {class:'ayuda'}, motivo), campo('Clave', pin), h('button', {class:'btn', onclick:ok}, 'Confirmar'));
    }, () => { if(!listo) res(false); });
  });
}

/* Catálogo: búsqueda local, categorías derivadas de los datos recibidos (sin tocar el catálogo del dueño) y favoritos a partir de las ventas guardadas en este teléfono. */
let busqueda = '', categoria = 'todo', verAgotados = false, refrescarGrid = null, pendienteScroll = null;
const memoriaScroll = {};
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const CATEGORIAS = [['favoritos', 'Favoritos'], ['pizzas', 'Pizzas'], ['bebidas', 'Bebidas'], ['carnicos', 'Cárnicos'], ['otros', 'Otros']];
function categoriaDe(p){
  const n = sinAcentos(p.nombre); const m = C.MEDIDAS[p.medida];
  if(/pizza/.test(n)) return 'pizzas';
  if(/refresco|jugo|batido|agua|malta|cerveza|limonada|bebida|cafe|\bte\b/.test(n)) return 'bebidas';
  if((m && m.peso) || p.medida === 'paquete' || /pollo|cerdo|carne|res\b|picadillo|salchicha|hamburguesa|chorizo|costilla|bistec/.test(n)) return 'carnicos';
  return 'otros';
}
/* Los 6 productos más vendidos en este teléfono (mínimo 3 ventas). Si todavía no hay historia, no hay favoritos: no se inventa nada. */
async function favoritosIds(){
  const cuenta = {}; for(const v of await db.todos('ventas')) for(const l of v.lineas) if(l.productoId !== 'envio') cuenta[l.productoId] = (cuenta[l.productoId] || 0) + 1;
  return Object.entries(cuenta).filter(([id, n]) => n >= 3 && prod(id)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
}
const enCarrito = pid => cart.filter(l => l.pid === pid).reduce((s, l) => s + l.qty, 0);

async function vVender(){
  if(!dia) return sinEntrega();
  const y = pendienteScroll != null ? pendienteScroll : window.scrollY; pendienteScroll = null;
  const ventas = await ventasDia(); const vend = vendidoMilli(ventas); const favs = await favoritosIds();
  const info = dia.catalogo.map(p => ({p, rest:(dia.cantidades[p.id] || 0) - (vend[p.id] || 0), cat:categoriaDe(p), fav:favs.includes(p.id)}));
  const agotado = x => x.p.controlStock && x.rest <= 0;
  const cats = [['todo', 'Todo'], ...CATEGORIAS.filter(([id]) => id === 'favoritos' ? favs.length : info.some(x => x.cat === id))];
  if(!cats.some(c => c[0] === categoria)) categoria = 'todo';
  const rejilla = h('div', {class:'rejilla2'}); const chips = h('div', {class:'chips', role:'group', 'aria-label':'Categorías'});
  const tile = x => {
    const p = x.p, q = enCarrito(p.id), peso = C.MEDIDAS[p.medida] && C.MEDIDAS[p.medida].peso;
    const pocas = p.controlStock && !agotado(x) && x.rest < 3000;
    return h('button', {class:'pt' + (q ? ' en' : '') + (pocas ? ' poco' : '') + (agotado(x) ? ' agotado' : ''), 'aria-label':p.nombre + ', ' + C.dinero(p.precioCents) + (q ? ', en el pedido ' + C.cantidad(q) : ''),
      onclick:() => agotado(x) ? aviso(p.nombre + ' está agotado. Si crees que hay, avisa en «Ver existencia y corregir».', true) : tocarProducto(p, x.rest)},
      q ? h('span', {class:'pt-n'}, C.cantidad(q) + (peso ? ' ' + (p.medida === 'kilo' ? 'kg' : 'lb') : '')) : null,
      h('b', {}, p.nombre), h('span', {class:'pp num'}, C.dinero(p.precioCents) + (peso ? ' / ' + C.MEDIDAS[p.medida].s : '')),
      agotado(x) ? h('span', {class:'ps'}, 'Agotado') : pocas ? h('span', {class:'ps'}, icono('alerta', 14), ' Quedan pocas: ' + C.cantidad(x.rest)) : p.controlStock ? h('span', {class:'ps'}, 'Quedan ' + textoCantidad(p, x.rest)) : null);
  };
  const pintaGrid = () => {
    const q = sinAcentos(busqueda);
    const filtrados = info.filter(x => (!q || sinAcentos(x.p.nombre).includes(q)) && (categoria === 'todo' || (categoria === 'favoritos' ? x.fav : x.cat === categoria)));
    const ordenados = categoria === 'todo' ? [...filtrados.filter(x => x.fav), ...filtrados.filter(x => !x.fav)] : filtrados;
    const visibles = ordenados.filter(x => !agotado(x)), ocultos = ordenados.filter(agotado);
    rejilla.replaceChildren(...(visibles.length ? visibles.map(tile) : [h('div', {class:'card aviso-c', style:'grid-column:1/-1'}, !dia.catalogo.length ? 'El dueño todavía no puso productos en la entrega.' : q ? 'No hay productos que se llamen así.' : 'No hay productos disponibles aquí.')]),
      ...(ocultos.length ? [h('button', {class:'enlace', style:'grid-column:1/-1;text-align:left', onclick:() => { verAgotados = !verAgotados; pintaGrid(); }}, (verAgotados ? 'Ocultar' : 'Ver') + ' agotados (' + ocultos.length + ')')] : []),
      ...(verAgotados ? ocultos.map(tile) : []));
    chips.replaceChildren(...cats.map(([id, nombre]) => h('button', {class:'op', 'aria-pressed':categoria === id, onclick:() => { categoria = id; pintaGrid(); }}, nombre)));
  };
  refrescarGrid = pintaGrid;
  const neto = ventas.reduce((s, v) => s + v.totalCents, 0);
  const buscador = h('input', {type:'search', placeholder:'Buscar producto', value:busqueda, 'aria-label':'Buscar producto', autocomplete:'off', oninput:e => { busqueda = e.target.value; limpiar.hidden = !busqueda; pintaGrid(); }});
  const limpiar = h('button', {class:'x', 'aria-label':'Borrar la búsqueda', hidden:!busqueda, onclick:() => { busqueda = ''; buscador.value = ''; limpiar.hidden = true; pintaGrid(); buscador.focus(); }}, icono('cerrar', 20));
  pintaGrid();
  montar(raiz, banner(),
    h('div', {class:'cab'}, h('div', {}, h('b', {}, dia.puesto.nombre), h('span', {class:'ayuda'}, ' · ' + C.fechaBonita(dia.fecha))), !navigator.onLine ? h('span', {class:'etq warn'}, 'Sin internet · funciona igual') : h('span', {class:'ayuda num'}, 'Vendido ' + C.dinero(neto))),
    h('div', {class:'buscar'}, icono('buscar', 20), buscador, limpiar), chips, rejilla,
    dia.catalogo.some(p => p.controlStock) ? h('button', {class:'enlace', onclick:abrirExistencia}, 'Ver existencia y corregir') : null);
  window.scrollTo(0, y);
}


/* Existencia: lo que te dieron, lo vendido y lo que queda. Si hay menos de lo anotado, se corrige aquí y el dueño lo ve en el cierre. */
async function abrirExistencia(){
  const ventas = await ventasDia(); const vend = vendidoMilli(ventas);
  hoja('Existencia', cerrar => {
    const filas = dia.catalogo.filter(p => p.controlStock).map(p => {
      const ent = dia.cantidades[p.id] || 0, vd = vend[p.id] || 0, rest = ent - vd;
      return h('div', {class:'card'}, h('div', {class:'fila'}, h('div', {}, h('b', {}, p.nombre), h('div', {class:'ayuda num'}, 'Te dieron ' + C.cantidad(ent) + ' · vendiste ' + C.cantidad(vd))), h('b', {class:'num ' + (rest <= 0 ? 'mal' : '')}, C.cantidad(rest))),
        h('button', {class:'enlace', onclick:() => { cerrar(); corregirExistencia(p, rest); }}, 'No hay tanto'));
    });
    return h('div', {}, h('p', {class:'ayuda'}, 'Si de verdad hay menos de lo que dice aquí, toca «No hay tanto». Queda anotado para el dueño.'), filas);
  });
}
function corregirExistencia(p, rest){
  hoja('Corregir ' + p.nombre, cerrar => {
    const q = h('input', {inputmode:'decimal', placeholder:'0', 'aria-label':'Cuánto hay de verdad'});
    const motivo = h('select', {}, ['No había tanto desde el principio', 'Se echó a perder', 'Se rompió o se cayó', 'Otro'].map(m => h('option', {}, m)));
    return h('div', {}, h('p', {class:'ayuda'}, 'Dice que quedan ' + textoCantidad(p, rest) + '.'), campo('¿Cuánto hay de verdad ahora? (' + C.nombreMedida(p.medida, 2000) + ')', q), campo('¿Por qué?', motivo),
      h('button', {class:'btn', onclick:async () => {
        const m = C.aMilesimas(q.value); if(isNaN(m) || m < 0){ aviso('Pon cuánto hay de verdad', true); return; }
        if(m >= rest){ aviso('Aquí solo se puede bajar. Si falta mercancía, pídesela al dueño.', true); return; }
        dia.cantidades[p.id] = (dia.cantidades[p.id] || 0) + (m - rest); dia.ajustes = dia.ajustes || [];
        dia.ajustes.push({id:C.uid(), productoId:p.id, deltaMilli:m - rest, motivo:motivo.value, por:'vendedora', ts:Date.now()}); await guardarDia(); cerrar(); aviso('Anotado. El dueño lo verá en tu cierre.'); pintar();
      }}, 'Guardar'));
  });
}
/* El pedido vive en memoria y también en este teléfono (sin precios especiales ni autorizaciones): si la página se recarga, no se pierde. */
let guardandoCarrito = null;
function guardarCarrito(){
  clearTimeout(guardandoCarrito);
  guardandoCarrito = setTimeout(() => { if(dia) db.kvSet('carrito', {id:'carrito', diaId:dia.entregaId, lineas:cart.map(l => ({pid:l.pid, qty:l.qty, ag:l.ag || {}}))}).catch(() => {}); }, 150);
}
async function restaurarCarrito(){
  const c = await db.kv('carrito'); if(!c || !dia || c.diaId !== dia.entregaId) return;
  cart = (c.lineas || []).filter(l => prod(l.pid)).map(l => ({pid:l.pid, qty:l.qty, ag:l.ag || {}}));
}
function cambioCarrito(){ guardarCarrito(); pintarCarrito(); if(refrescarGrid) refrescarGrid(); }

/* Producto por peso: elegir la cantidad (o corregir la de una línea que ya está en el pedido). */
function tocarProducto(p, rest){
  const peso = C.MEDIDAS[p.medida] && C.MEDIDAS[p.medida].peso;
  if(!peso){ añadir(p, 1000); return; }
  abrirPeso(p, rest, null);
}
function abrirPeso(p, rest, linea){
  hoja(p.nombre, cerrar => {
    const q = h('input', {inputmode:'decimal', placeholder:'0', value:linea ? C.cantidad(linea.qty).replace('.', ',') : '', 'aria-label':'Cantidad en ' + C.nombreMedida(p.medida, 2000)});
    const info = h('p', {class:'ayuda'}); const imp = h('div', {class:'total'}, h('span', {}, 'Cobrar'), h('b', {class:'num'}, '0'));
    const act = () => { const m = C.aMilesimas(q.value); const ok = !isNaN(m) && m > 0;
      imp.lastChild.textContent = ok ? C.dinero(C.importeLinea(precioUnit(linea || {pid:p.id}), m)) : '0';
      const hayStock = p.controlStock && isFinite(rest);
      info.textContent = ok && hayStock && m > rest ? 'Ojo: solo quedan ' + textoCantidad(p, Math.max(rest, 0)) + '.' : C.dinero(p.precioCents) + ' la ' + C.nombreMedida(p.medida, 1000) + (hayStock ? ' · quedan ' + textoCantidad(p, Math.max(rest, 0)) : ''); };
    q.addEventListener('input', act); act(); setTimeout(() => q.focus(), 80);
    const rap = h('div', {class:'rapidos'}, ['0,5', '1', '1,5', '2', '3', '5'].map(x => h('button', {onclick:() => { q.value = x; act(); }}, x)));
    return h('div', {}, info, campo('¿Cuánto? (' + C.nombreMedida(p.medida, 2000) + ')', q), rap, imp,
      h('button', {class:'btn', onclick:() => { const m = C.aMilesimas(q.value); if(isNaN(m) || m <= 0){ aviso('Pon cuánto vendiste', true); q.focus(); return; }
        if(linea) linea.qty = m; else cart.push({pid:p.id, qty:m, ag:{}}); cerrar(); cambioCarrito(); if(linea && document.querySelector('.hoja-fondo')) abrirCarrito(); }}, linea ? 'Cambiar la cantidad' : 'Añadir al pedido'),
      h('button', {class:'btn suave', onclick:cerrar}, 'Cancelar'));
  });
}
function añadir(p, qty){
  const peso = C.MEDIDAS[p.medida] && C.MEDIDAS[p.medida].peso;
  const l = !peso && cart.find(x => x.pid === p.id);
  if(l) l.qty += qty; else cart.push({pid:p.id, qty, ag:{}});
  cambioCarrito();
}
function resumenCarrito(){
  const lineas = cart.length; const unidades = cart.reduce((s, l) => s + (C.MEDIDAS[(prod(l.pid) || {}).medida] && C.MEDIDAS[prod(l.pid).medida].peso ? 1 : l.qty / 1000), 0);
  return {lineas, unidades:Math.round(unidades * 10) / 10};
}
/* Barra fija sobre la navegación: aparece solo cuando hay algo en el pedido. */
function pintarCarrito(){
  const c = document.getElementById('carrito'); const mostrar = cart.length && pantalla === 'vender' && dia;
  raiz.classList.toggle('con-barra', !!mostrar);
  if(!mostrar){ montar(c); return; }
  const r = resumenCarrito();
  montar(c, h('div', {class:'barra-carrito'}, h('div', {class:'in'},
    h('button', {class:'cb-pedido', onclick:abrirCarrito, 'aria-label':'Ver el pedido: ' + r.lineas + ' productos, ' + C.dinero(totalCarrito())}, icono('carrito', 24),
      h('span', {class:'cb-txt'}, h('b', {class:'num'}, C.dinero(totalCarrito())), h('span', {}, r.lineas + (r.lineas === 1 ? ' producto' : ' productos') + ' · Ver pedido'))),
    h('button', {class:'cb-cobrar', onclick:abrirCobro}, 'Cobrar'))));
}
/* Hoja «Tu pedido»: todas las líneas con su cantidad y subtotal; el total y el cobro siempre a la vista. */
function abrirCarrito(){
  document.querySelectorAll('.hoja-fondo').forEach(e => e.remove());
  hoja('Tu pedido', cerrar => {
    const lista = h('div'), pie = h('div', {class:'hoja-pie'}), sub = h('p', {class:'ayuda', style:'margin:0 0 8px'});
    const repinta = () => { cambioCarrito(); draw(); };
    const quitar = i => { const l = cart.splice(i, 1)[0]; const p = prod(l.pid); cambioCarrito(); draw();
      avisoAccion('Quitaste ' + (p ? p.nombre : 'un producto'), 'Deshacer', () => { cart.splice(Math.min(i, cart.length), 0, l); cambioCarrito(); if(document.querySelector('.hoja-fondo')) draw(); else abrirCarrito(); }); };
    const draw = () => {
      if(!cart.length){ cerrar(); pintarCarrito(); return; }
      const r = resumenCarrito(); sub.textContent = r.lineas + (r.lineas === 1 ? ' línea' : ' líneas') + ' · ' + C.dinero(totalCarrito());
      const especial = !cartAuth
        ? h('button', {class:'btn suave', onclick:async () => { if(await pedirClave('Solo el dueño puede dar un precio especial.')){ cartAuth = true; draw(); } }}, 'Precio especial (clave del dueño)')
        : h('div', {class:'card'}, h('b', {}, 'Precio especial autorizado'),
            (dia.listas || []).length ? h('div', {class:'opts'}, h('button', {class:'op', 'aria-pressed':!cartLista, onclick:() => { cartLista = null; cart.forEach(l => delete l.precio); repinta(); }}, 'Precio normal'),
              (dia.listas || []).map(x => h('button', {class:'op', 'aria-pressed':!!cartLista && cartLista.id === x.id, onclick:() => { cartLista = x; cart.forEach(l => delete l.precio); repinta(); }}, x.nombre + ' −' + x.pct + ' %'))) : null,
            h('p', {class:'ayuda'}, 'También puedes cambiar el precio de cada producto abajo.'));
      lista.replaceChildren(...cart.map((l, i) => {
        const p = prod(l.pid); const peso = C.MEDIDAS[p.medida].peso; const esp = precioUnit(l) !== p.precioCents;
        const ags = p.admiteAgregos && (dia.agregos || []).length ? h('div', {class:'lc-ag'}, dia.agregos.map(a => h('div', {class:'lc-agr'},
          h('span', {}, a.nombre + ' ', h('span', {class:'ayuda num'}, '+' + C.dinero(a.precioCents))),
          h('div', {class:'paso chico'}, h('button', {'aria-label':'Quitar ' + a.nombre, onclick:() => { const c = (l.ag[a.id] || 0) - 1; if(c > 0) l.ag[a.id] = c; else delete l.ag[a.id]; repinta(); }}, icono('menos', 18)),
            h('output', {}, l.ag[a.id] || 0), h('button', {class:'mas', 'aria-label':'Añadir ' + a.nombre, onclick:() => { l.ag[a.id] = (l.ag[a.id] || 0) + 1; repinta(); }}, icono('mas', 18)))))) : null;
        return h('div', {class:'lc'}, h('div', {class:'lc-top'}, h('div', {class:'lc-n'}, h('b', {}, p.nombre), h('div', {class:'ayuda num'}, textoCantidad(p, l.qty) + ' × ' + C.dinero(precioUnit(l)) + (esp ? ' · precio especial' : ''))), h('b', {class:'num lc-sub'}, C.dinero(totalLinea(l)))),
          h('div', {class:'lc-ctl'},
            peso ? h('button', {class:'btn chico suave', onclick:() => abrirPeso(p, Infinity, l)}, 'Cambiar cantidad')
              : h('div', {class:'paso'}, h('button', {'aria-label':'Quitar uno de ' + p.nombre, onclick:() => { if(l.qty > 1000){ l.qty -= 1000; repinta(); } else quitar(i); }}, icono('menos', 22)), h('output', {'aria-live':'polite'}, C.cantidad(l.qty)), h('button', {class:'mas', 'aria-label':'Añadir uno de ' + p.nombre, onclick:() => { l.qty += 1000; repinta(); }}, icono('mas', 22))),
            h('button', {class:'icon-btn', 'aria-label':'Quitar ' + p.nombre + ' del pedido', onclick:() => quitar(i)}, icono('papelera', 22))),
          cartAuth ? campo('Precio de ' + C.nombreMedida(p.medida, 1000), h('input', {inputmode:'decimal', value:String(precioUnit(l) / 100), onchange:e => { const c = C.aCentavos(e.target.value); if(!isNaN(c) && c >= 0){ l.precio = c; repinta(); } else aviso('Revisa el precio', true); }})) : null, ags);
      }), especial);
      pie.replaceChildren(h('div', {class:'total'}, h('span', {}, 'Total'), h('b', {class:'num'}, C.dinero(totalCarrito()))),
        h('div', {class:'dos'}, h('button', {class:'btn suave', onclick:cerrar}, 'Seguir añadiendo'), h('button', {class:'btn', onclick:() => { cerrar(); abrirCobro(); }}, 'Cobrar')));
    };
    draw(); return h('div', {}, sub, lista, pie);
  });
}


/* ---------- cobrar ----------
   De arriba abajo: total, cómo paga (ya viene «Efectivo» por el total exacto), lo que el cliente da, domicilio, y al fondo —siempre a la vista— Falta/Vuelto y «Anotar venta».
   Una venta sencilla en efectivo: producto, producto, Cobrar, Anotar venta. Nada se registra hasta tocar «Anotar venta». */
function abrirCobro(){
  const base = totalCarrito(); if(!base) return;
  document.querySelectorAll('.hoja-fondo').forEach(e => e.remove());
  const monedas = Object.keys(dia.tasas || {}).filter(m => m !== 'CUP' && dia.tasas[m]);
  const dom = {on:false, direccion:'', envio:'', mensajero:''};
  const envioCents = () => { if(!dom.on) return 0; const e = C.aCentavos(dom.envio); return isNaN(e) || e < 0 ? 0 : e; };
  const total = () => base + envioCents();
  const modos = [['efectivo', 'Efectivo', 'efectivo'], ['transferencia', 'Transferencia', 'tarjeta'], ['qr', 'QR', 'qr'], ...monedas.map(m => ['usd:' + m, m === 'USD' ? 'Dólares' : m, 'dolar']), ...(dia.clave ? [['fiado', 'Fiado', 'libreta']] : []), ['mixto', 'Varios pagos', 'mas']];
  const st = {modo:'efectivo', pagos:[]};
  const etiqueta = p => p.metodo === 'efectivo' ? 'Efectivo ' + p.moneda : p.metodo === 'transferencia' ? 'Transferencia' : p.metodo === 'qr' ? 'QR (Transfermóvil / EnZona)' : 'Fiado';
  /* Cada forma de pago propone el importe exacto; si la vendedora ya escribió otro, se respeta. */
  const fijar = modo => {
    const t = total(), previo = st.pagos[0], conservar = previo && previo._editado && st.modo === modo && modo !== 'mixto';
    st.modo = modo; if(conservar) return;
    if(modo === 'efectivo') st.pagos = [{metodo:'efectivo', moneda:'CUP', monto:String(t / 100)}];
    else if(modo === 'transferencia' || modo === 'qr') st.pagos = [{metodo:modo, moneda:'CUP', monto:String(t / 100)}];
    else if(modo.startsWith('usd:')){ const m = modo.slice(4); st.pagos = [{metodo:'efectivo', moneda:m, monto:String(Math.ceil(t / tasaDe(m)))}]; }
    else if(modo === 'fiado') st.pagos = [{metodo:'fiado', moneda:'CUP', monto:String(t / 100), cliente:'', pin:''}];
    else if(!st.pagos.length || st.pagos.length === 1) st.pagos = [{metodo:'efectivo', moneda:'CUP', monto:''}];
  };
  fijar('efectivo');
  hoja('Cobrar', cerrar => {
    const cuerpo = h('div'), pie = h('div', {class:'hoja-pie'}), resumen = h('div', {class:'total'}), btnAnotar = h('button', {class:'btn', onclick:() => guardar(st.pagos)}, 'Anotar venta');
    const calc = () => {
      let efectivo = 0, otros = 0;
      for(const p of st.pagos){ const m = C.aCentavos(p.monto); p._m = isNaN(m) ? 0 : m; p._cup = C.aCup(p._m, tasaDe(p.moneda)); if(p.metodo === 'efectivo') efectivo += p._cup; else otros += p._cup; }
      const t = total(); return {efectivo, otros, suma:efectivo + otros, falta:Math.max(0, t - efectivo - otros), vuelto:Math.max(0, efectivo + otros - t)};
    };
    const pintaResumen = () => { const c = calc();
      resumen.className = 'total' + (c.falta ? ' falta' : '');
      resumen.replaceChildren(h('span', {}, c.falta ? 'Falta por pagar' : c.vuelto ? 'Dale de vuelto' : 'Pago completo'), h('b', {class:'num'}, c.falta ? C.dinero(c.falta) : C.dinero(c.vuelto))); };
    const montoInput = (p, ph) => h('input', {inputmode:'decimal', placeholder:ph || '0', value:p.monto, 'aria-label':'Monto en ' + p.moneda, oninput:e => { p.monto = e.target.value; p._editado = true; pintaResumen(); }});
    /* El banco manda un código al cliente por SMS; sin él no se cierra la venta (20/10/2026, a pedido del dueño). */
    const campoCodigo = p => campo('Código de la transferencia (el que le llegó al cliente por SMS)', h('input', {value:p.codigo || '', placeholder:'Ej. TM8F3K21', autocapitalize:'characters', autocomplete:'off', 'aria-label':'Código de la transferencia', oninput:e => { p.codigo = e.target.value; }}));
    const panel = () => {
      const t = total(), p = st.pagos[0];
      if(st.modo === 'efectivo'){
        const redondos = [100, 500, 1000, 2000, 5000].map(x => Math.ceil(t / (x * 100)) * x * 100).filter((x, i, a) => a.indexOf(x) === i && x > t);
        return h('div', {class:'card'}, campo('El cliente da (pesos)', montoInput(p)),
          h('div', {class:'rapidos'}, h('button', {onclick:() => { p.monto = String(t / 100); p._editado = false; draw(); }}, 'Exacto'), redondos.map(x => h('button', {onclick:() => { p.monto = String(x / 100); p._editado = true; draw(); }}, C.dinero(x)))));
      }
      if(st.modo === 'transferencia' || st.modo === 'qr') return h('div', {class:'card'}, campo('Monto recibido por ' + (st.modo === 'qr' ? 'QR' : 'transferencia') + ' (pesos)', montoInput(p)), campoCodigo(p), h('p', {class:'ayuda'}, 'Pídele al cliente que te enseñe el SMS y copia el código. Después manda la captura al dueño desde «Ventas».'));
      if(st.modo.startsWith('usd:')){ const m = st.modo.slice(4); return h('div', {class:'card'}, campo('El cliente da (' + m + ')', montoInput(p)), h('p', {class:'ayuda num'}, '1 ' + m + ' = ' + C.dinero(tasaDe(m)) + ' CUP · equivale a ' + C.dinero(C.aCup(C.aCentavos(p.monto) || 0, tasaDe(m))) + ' CUP. El vuelto se da en pesos.')); }
      if(st.modo === 'fiado') return h('div', {class:'card'}, campo('Nombre del cliente', h('input', {value:p.cliente || '', placeholder:'¿A quién se le fía?', oninput:e => { p.cliente = e.target.value; }})),
        campo('Clave del dueño', h('input', {type:'password', inputmode:'numeric', placeholder:'Solo el dueño la sabe', oninput:e => { p.pin = e.target.value; }}), 'Un fiado necesita que el dueño lo autorice con su clave.'));
      return h('div', {}, ...st.pagos.map((q, i) => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, etiqueta(q)), st.pagos.length > 1 ? h('button', {class:'icon-btn', 'aria-label':'Quitar este pago', onclick:() => { st.pagos.splice(i, 1); draw(); }}, icono('cerrar', 22)) : null),
          h('div', {class:'fila', style:'margin-top:8px'}, montoInput(q), h('button', {class:'btn chico suave', onclick:() => { const c = calc(); const falta = Math.max(0, total() - (c.suma - q._cup)); q.monto = String(Math.ceil(falta * 100 / tasaDe(q.moneda)) / 100); q._editado = true; draw(); }}, 'Lo que falta')),
          q.metodo === 'fiado' ? [campo('Nombre del cliente', h('input', {value:q.cliente || '', placeholder:'¿A quién se le fía?', oninput:e => { q.cliente = e.target.value; }})), campo('Clave del dueño', h('input', {type:'password', inputmode:'numeric', placeholder:'Solo el dueño la sabe', oninput:e => { q.pin = e.target.value; }}))] : null, q.metodo === 'transferencia' || q.metodo === 'qr' ? campoCodigo(q) : null)),
        h('div', {class:'opts'}, h('button', {class:'op', onclick:() => { st.pagos.push({metodo:'efectivo', moneda:'CUP', monto:''}); draw(); }}, '+ Efectivo'), h('button', {class:'op', onclick:() => { st.pagos.push({metodo:'transferencia', moneda:'CUP', monto:''}); draw(); }}, '+ Transferencia'),
          h('button', {class:'op', onclick:() => { st.pagos.push({metodo:'qr', moneda:'CUP', monto:''}); draw(); }}, '+ QR'), monedas.map(m => h('button', {class:'op', onclick:() => { st.pagos.push({metodo:'efectivo', moneda:m, monto:''}); draw(); }}, '+ ' + m)),
          dia.clave ? h('button', {class:'op', onclick:() => { st.pagos.push({metodo:'fiado', moneda:'CUP', monto:'', cliente:'', pin:''}); draw(); }}, '+ Fiado') : null));
    };
    const draw = () => {
      cuerpo.replaceChildren(...[
        h('div', {class:'total grande'}, h('span', {}, 'Total a cobrar'), h('b', {class:'num'}, C.dinero(total()))),
        h('p', {class:'marca', style:'margin:12px 0 6px'}, 'Cómo paga'),
        h('div', {class:'opts', role:'group', 'aria-label':'Cómo paga'}, modos.map(([id, nombre, ico]) => h('button', {class:'op con-ico', 'aria-pressed':st.modo === id, onclick:() => { fijar(id); draw(); }}, icono(ico, 20), nombre))),
        panel(),
        h('label', {class:'lin', style:'cursor:pointer;margin-top:6px'}, h('span', {}, 'Es un pedido a domicilio'), h('input', {type:'checkbox', style:'width:26px;min-height:26px', checked:dom.on, onchange:e => { dom.on = e.target.checked; fijar(st.modo); draw(); }})),
        dom.on ? h('div', {class:'card'}, campo('Dirección', h('input', {value:dom.direccion, oninput:e => dom.direccion = e.target.value, placeholder:'¿A dónde va?'})),
          campo('Cobro del envío (pesos)', h('input', {inputmode:'decimal', value:dom.envio, placeholder:'0', onchange:e => { dom.envio = e.target.value; fijar(st.modo); draw(); }})),
          (dia.mensajeros || []).length ? campo('Mensajero', h('select', {onchange:e => dom.mensajero = e.target.value}, h('option', {value:''}, 'Elige…'), dia.mensajeros.map(m => h('option', {value:m, selected:m === dom.mensajero}, m)))) : null) : null].filter(Boolean));
      pintaResumen();
    };
    async function guardar(lista){
      if(ocupado) return; ocupado = true; btnAnotar.disabled = true;
      try {
        const tot = total();
        if(dom.on && !dom.direccion.trim()){ aviso('Escribe la dirección del pedido.', true); return; }
        let efectivo = 0, otros = 0; const pg = [];
        const usados = new Set((await ventasDia()).flatMap(v => v.pagos.map(x => x.codigo).filter(Boolean)));
        for(const p of lista){
          const m = C.aCentavos(p.monto); if(isNaN(m) || m <= 0){ if(lista.length > 1 && (p.monto === '' || p.monto === undefined)) continue; aviso('Revisa el monto de ' + etiqueta(p), true); return; }
          const tasa = tasaDe(p.moneda); if(!tasa){ aviso('No hay cambio para ' + p.moneda + '. Pídele al dueño que lo ponga.', true); return; }
          const cup = C.aCup(m, tasa);
          if(p.metodo === 'fiado'){
            if(!(p.cliente || '').trim()){ aviso('Escribe a quién se le fía.', true); return; }
            const hh = await C.hashClave(String(p.pin || ''), dia.clave.sal);
            if(hh !== dia.clave.hash){ aviso('La clave del dueño no es correcta.', true); return; }
          }
          let codigo;
          if(p.metodo === 'transferencia' || p.metodo === 'qr'){
            codigo = (p.codigo || '').trim().toUpperCase().replace(/s+/g, '');
            if(codigo.length < 4){ aviso('Escribe el código de la transferencia (el del SMS del cliente).', true); return; }
            if(usados.has(codigo)){ aviso('Ese código ya se usó en otra venta. Revisa el SMS.', true); return; }
            usados.add(codigo);
          }
          pg.push({metodo:p.metodo, moneda:p.moneda, monto:m, tasa, cup, cliente:p.metodo === 'fiado' ? p.cliente.trim() : undefined, codigo});
          if(p.metodo === 'efectivo') efectivo += cup; else otros += cup;
        }
        if(!pg.length){ aviso('Pon cómo pagó el cliente.', true); return; }
        if(efectivo + otros < tot){ aviso('Todavía falta ' + C.dinero(tot - efectivo - otros) + '.', true); return; }
        if(otros > tot){ aviso('La transferencia, el QR o el fiado no pueden pasar del total.', true); return; }
        const vuelto = efectivo + otros - tot;
        if(vuelto > efectivo){ aviso('Solo se da vuelto de lo que pagaron en efectivo.', true); return; }
        const lineas = cart.map(l => { const p = prod(l.pid); const pu = precioUnit(l); return {productoId:p.id, nombre:p.nombre, medida:p.medida, qtyMilli:l.qty, precioCents:pu, precioBaseCents:p.precioCents,
          lista:pu !== p.precioCents ? (cartLista && l.precio == null ? cartLista.nombre : 'manual') : undefined, importeCents:C.importeLinea(pu, l.qty),
          agregos:Object.entries(l.ag).map(([id, c]) => { const a = dia.agregos.find(x => x.id === id); return {id, nombre:a.nombre, precioCents:a.precioCents, cant:c}; })}; });
        const env = envioCents(); if(env > 0) lineas.push({productoId:'envio', nombre:'Envío a domicilio', medida:'unidad', qtyMilli:1000, precioCents:env, importeCents:env, agregos:[]});
        const venta = {id:C.uid(), diaId:dia.entregaId, num:dia.contador + 1, ts:Date.now(), fecha:dia.fecha, puestoId:dia.puesto.id, vendedorId:perfil.id, lineas, totalCents:tot, pagos:pg, vueltoCents:vuelto,
          domicilio:dom.on ? {direccion:dom.direccion.trim(), mensajero:dom.mensajero || undefined} : undefined};
        await C.sellarVenta(venta, dia.ultimoHash);
        await db.put('ventas', venta); dia.ultimoHash = venta.hash; dia.contador = venta.num; await guardarDia();
        limpiarCarrito(); cerrar(); pintarCarrito(); pintar();
        hoja('Venta ' + ticket(venta.num) + ' registrada ✓', c2 => h('div', {}, h('div', {class:'total'}, h('span', {}, 'Total cobrado'), h('b', {class:'num'}, C.dinero(tot))),
          vuelto ? h('div', {class:'card', style:'margin-top:10px'}, h('div', {class:'fila'}, h('b', {}, 'Dale de vuelto'), h('b', {class:'num bien', style:'font-size:32px'}, C.dinero(vuelto)))) : null,
          h('button', {class:'btn', onclick:c2}, 'Siguiente venta')));
      } finally { ocupado = false; btnAnotar.disabled = false; }
    }
    pie.append(resumen, btnAnotar);
    draw(); return h('div', {}, cuerpo, pie);
  });
}


/* ---------- ventas del día ----------
   Herramienta de trabajo, no de estadística: franja de total compacta, búsqueda, filtros y la lista lo más arriba posible, agrupada por hora.
   El detalle sale en una hoja; la búsqueda, el filtro y la posición se conservan al volver. */
let filtroV = 'todas', busquedaV = '';
const NOMBRE_PAGO = {efectivo:'Efectivo', transferencia:'Transferencia', qr:'QR', fiado:'Fiado'};
const ICONO_PAGO = {efectivo:'efectivo', transferencia:'tarjeta', qr:'qr', fiado:'libreta'};
async function vVentas(){
  if(!dia) return sinEntrega();
  const y = pendienteScroll != null ? pendienteScroll : window.scrollY; pendienteScroll = null;
  const ventas = await ventasDia(), sol = await solicitudesDia(); const q = C.calcularCuadre(ventas, sol, dia.fondoCents);
  const tiene = (v, ...ms) => v.pagos.some(p => ms.includes(p.metodo));
  const sinCap = v => v.pagos.some(p => (p.metodo === 'transferencia' || p.metodo === 'qr')) && !dia.capturas[v.id];
  const conPedido = v => sol.some(s => s.ventaId === v.id);
  const metodoCorto = v => { const ms = [...new Set(v.pagos.map(p => p.metodo))]; return ms.length > 1 ? 'Mixto' : ms[0] === 'transferencia' ? 'Transf.' : NOMBRE_PAGO[ms[0]]; };
  const iconoMetodo = v => { const ms = [...new Set(v.pagos.map(p => p.metodo))]; return icono(ms.length > 1 ? 'mas' : ICONO_PAGO[ms[0]] || 'efectivo', 16); };
  const filtros = [['todas', 'Todas', () => true], ['efectivo', 'Efectivo', v => tiene(v, 'efectivo')], ['transf', 'Transf. y QR', v => tiene(v, 'transferencia', 'qr')], ['fiado', 'Fiado', v => tiene(v, 'fiado')], ['pedidos', 'Con pedido', conPedido]]
    .filter(f => f[0] === 'todas' || ventas.some(f[2]));
  if(!filtros.some(f => f[0] === filtroV)) filtroV = 'todas';
  const sinCaptura = ventas.filter(sinCap).length;
  const resumenProductos = v => { const n = v.lineas.map(l => l.nombre + (l.qtyMilli === 1000 ? '' : ' ×' + C.cantidad(l.qtyMilli))); return n.length > 2 ? n.slice(0, 2).join(', ') + ' +' + (n.length - 2) : n.join(', '); };
  /* Búsqueda local por ticket (T-005, 5), importe (1050 ó 1 050) o nombre de producto. */
  const coincide = v => {
    const t = sinAcentos(busquedaV); if(!t) return true;
    const soloNum = t.replace(/^t-?/, '').replace(/\s/g, ''); const imp = C.num(t.replace(/\s/g, ''));
    if(/^\d+$/.test(soloNum) && (String(v.num) === String(+soloNum) || ticket(v.num).toLowerCase().includes(t))) return true;
    if(!isNaN(imp) && (Math.abs(v.totalCents / 100 - imp) < 0.005 || String(v.totalCents / 100).startsWith(String(imp)))) return true;
    return v.lineas.some(l => sinAcentos(l.nombre).includes(t));
  };
  const fila = v => {
    const atencion = sinCap(v) || conPedido(v);
    return h('button', {class:'vrow' + (atencion ? ' atencion' : ''), onclick:() => detalleVenta(v, sol)},
      h('div', {class:'vt'}, h('b', {}, ticket(v.num)), h('span', {class:'ayuda'}, C.horaDe(v.ts))),
      h('div', {class:'vd'}, h('span', {}, resumenProductos(v)), h('span', {class:'vtags'},
        sinCap(v) ? h('span', {class:'etq warn'}, 'Falta captura') : null, conPedido(v) ? h('span', {class:'etq warn'}, 'Pedido de devolución') : null,
        tiene(v, 'fiado') ? h('span', {class:'etq n'}, 'Fiado') : null, v.domicilio ? h('span', {class:'etq n'}, 'Domicilio') : null, v.lineas.some(l => l.lista) ? h('span', {class:'etq n'}, 'Precio especial') : null)),
      h('div', {class:'vm'}, h('b', {class:'num'}, C.dinero(v.totalCents)), h('span', {class:'ayuda mp'}, iconoMetodo(v), ' ', metodoCorto(v))));
  };
  const lista = h('div'), conteo = h('p', {class:'ayuda', style:'margin:0 0 6px'});
  const pintaLista = () => {
    const activo = filtros.find(f => f[0] === filtroV)[2];
    const res = ventas.filter(activo).filter(coincide).slice().reverse();
    conteo.textContent = busquedaV || filtroV !== 'todas' ? res.length + (res.length === 1 ? ' venta' : ' ventas') + ' encontradas' : '';
    if(!res.length){ lista.replaceChildren(h('div', {class:'card'}, ventas.length ? 'No hay ventas con eso. Prueba con otro filtro o borra la búsqueda.' : 'Todavía no has anotado ventas.')); return; }
    const grupos = []; for(const v of res){ const hr = C.horaDe(v.ts).slice(0, 2); const g = grupos[grupos.length - 1]; if(g && g.hr === hr) g.items.push(v); else grupos.push({hr, items:[v]}); }
    lista.replaceChildren(...grupos.map(g => h('div', {}, h('div', {class:'gh'}, h('span', {}, g.hr + ':00'), h('span', {}, g.items.length + (g.items.length === 1 ? ' venta' : ' ventas') + ' · ' + C.dinero(g.items.reduce((s, v) => s + v.totalCents, 0)))), h('div', {class:'vlista'}, g.items.map(fila)))));
  };
  const chips = h('div', {class:'chips', role:'group', 'aria-label':'Filtros'});
  const pintaChips = () => chips.replaceChildren(...filtros.map(f => h('button', {class:'op', 'aria-pressed':filtroV === f[0], onclick:() => { filtroV = f[0]; pintaChips(); pintaLista(); }}, f[1])));
  const buscador = h('input', {type:'search', placeholder:'Buscar ticket, importe o producto', value:busquedaV, 'aria-label':'Buscar una venta', autocomplete:'off', oninput:e => { busquedaV = e.target.value; limpiar.hidden = !busquedaV; pintaLista(); }});
  const limpiar = h('button', {class:'x', 'aria-label':'Borrar la búsqueda', hidden:!busquedaV, onclick:() => { busquedaV = ''; buscador.value = ''; limpiar.hidden = true; pintaLista(); buscador.focus(); }}, icono('cerrar', 20));
  pintaChips(); pintaLista();
  const partes = [['Efectivo', q.porMetodo.efectivo || 0], ['Transf. y QR', (q.porMetodo.transferencia || 0) + (q.porMetodo.qr || 0)], ['Fiado', q.porMetodo.fiado || 0], ['Devuelto', q.devueltoCup]].filter(x => x[1]);
  montar(raiz, banner(), h('div', {class:'cab'}, h('div', {}, h('b', {}, 'Ventas de hoy'), h('span', {class:'ayuda'}, ' · ' + dia.puesto.nombre + ' · ' + C.fechaBonita(dia.fecha)))),
    h('div', {class:'resumen'}, h('div', {}, h('span', {class:'r-et'}, 'Llevas'), h('div', {class:'r-sub num'}, ventas.length + (ventas.length === 1 ? ' venta' : ' ventas') + (ventas.length ? ' · promedio ' + C.dinero(Math.round(q.ventasCup / ventas.length)) : ''))), h('b', {class:'num r-tot'}, C.dinero(q.netoCup))),
    partes.length ? h('p', {class:'ayuda num', style:'margin:6px 2px 8px'}, partes.map(x => x[0] + ' ' + C.dinero(x[1])).join(' · ')) : null,
    sinCaptura ? h('button', {class:'aviso-pill', onclick:() => { filtroV = 'transf'; pintaChips(); pintaLista(); }}, icono('alerta', 18), ' ' + sinCaptura + (sinCaptura === 1 ? ' transferencia sin captura' : ' transferencias sin captura') + ' · ver') : null,
    h('div', {class:'buscar'}, icono('buscar', 20), buscador, limpiar), filtros.length > 1 ? chips : null, conteo, lista);
  window.scrollTo(0, y);
}
function detalleVenta(v, sol){
  hoja(ticket(v.num) + ' · ' + C.horaDe(v.ts), cerrar => {
    const pedidos = sol.filter(s => s.ventaId === v.id); const trans = v.pagos.some(p => p.metodo === 'transferencia' || p.metodo === 'qr');
    return h('div', {},
      h('div', {class:'card'}, v.lineas.map(l => h('div', {class:'lin'}, h('span', {}, l.nombre, h('div', {class:'d num'}, C.cantidad(l.qtyMilli) + ' × ' + C.dinero(l.precioCents) + (l.lista ? ' · precio especial' : '') + (l.agregos && l.agregos.length ? ' · ' + l.agregos.map(a => a.nombre + ' ×' + a.cant).join(', ') : ''))), h('b', {class:'num'}, C.dinero(l.importeCents + (l.agregos || []).reduce((s, a) => s + a.precioCents * a.cant, 0))))),
        h('div', {class:'lin'}, h('b', {}, 'Total'), h('b', {class:'num'}, C.dinero(v.totalCents)))),
      h('div', {class:'card'}, h('h3', {}, 'Cómo pagó'), v.pagos.map(p => h('div', {class:'lin'}, h('span', {}, (NOMBRE_PAGO[p.metodo] || p.metodo) + (p.metodo === 'efectivo' ? ' ' + p.moneda : '') + (p.cliente ? ' · ' + p.cliente : ''), p.codigo ? h('div', {class:'d num'}, 'Código ' + p.codigo) : null), h('b', {class:'num'}, C.dinero(p.monto) + (p.moneda !== 'CUP' ? ' ' + p.moneda : '')))),
        v.vueltoCents ? h('div', {class:'lin'}, h('span', {}, 'Vuelto'), h('b', {class:'num'}, C.dinero(v.vueltoCents))) : null),
      v.domicilio ? h('div', {class:'card'}, h('h3', {}, 'Domicilio'), h('p', {}, v.domicilio.direccion), v.domicilio.mensajero ? h('p', {class:'ayuda'}, 'Mensajero: ' + v.domicilio.mensajero) : null) : null,
      pedidos.map(s => h('div', {class:'card aviso-c'}, h('b', {}, (s.tipo === 'devolucion' ? 'Devolución' : 'Anulación') + ' pedida'), h('div', {}, s.motivo + ' · devolviste ' + C.dinero(s.efectivoDevueltoCents)))),
      trans ? h('label', {class:'lin', style:'cursor:pointer'}, h('span', {}, 'Ya mandé la captura al dueño'), h('input', {type:'checkbox', style:'width:26px;min-height:26px', checked:!!dia.capturas[v.id], onchange:async e => { dia.capturas[v.id] = e.target.checked; await guardarDia(); pintar(); }})) : null,
      h('button', {class:'btn', onclick:() => { cerrar(); repetirVenta(v); }}, h('span', {class:'con-ico-b'}, icono('repetir', 20), 'Repetir esta venta')),
      h('button', {class:'btn suave', onclick:() => { cerrar(); pedirDevolucion(v); }}, 'Devolver o anular esta venta'));
  });
}
/* Repetir: arma un pedido nuevo con los productos de esa venta a los precios de hoy. No copia pagos ni autorizaciones y no registra nada hasta que se cobre. */
async function repetirVenta(v){
  if(cart.length && !(await confirmar('Ya tienes un pedido en curso', 'Repetir esta venta lo reemplaza.', 'Reemplazar', 'Dejarlo'))) return;
  const ventas = await ventasDia(); const vend = vendidoMilli(ventas); const nuevas = [], omitidos = [];
  for(const l of v.lineas){
    if(l.productoId === 'envio') continue; const p = prod(l.productoId);
    if(!p){ omitidos.push(l.nombre + ' (ya no está)'); continue; }
    if(p.controlStock && (dia.cantidades[p.id] || 0) - (vend[p.id] || 0) <= 0){ omitidos.push(l.nombre + ' (agotado)'); continue; }
    const ag = {}; for(const a of l.agregos || []) if((dia.agregos || []).some(x => x.id === a.id)) ag[a.id] = a.cant;
    nuevas.push({pid:p.id, qty:l.qtyMilli, ag});
  }
  if(!nuevas.length){ aviso('No se puede repetir: esos productos ya no están disponibles.', true); return; }
  cartLista = null; cartAuth = false; cart = nuevas; guardarCarrito(); ir('vender'); setTimeout(abrirCarrito, 150);
  if(omitidos.length) aviso('No se añadió: ' + omitidos.join(', '), true);
}

function pedirDevolucion(v){
  hoja('Devolver o anular ' + ticket(v.num), cerrar => {
    let tipo = 'devolucion'; const efectivoPagado = v.pagos.some(p => p.metodo === 'efectivo');
    const motivo = h('input', {placeholder:'¿Qué pasó?', 'aria-label':'Motivo'});
    const dev = h('input', {inputmode:'decimal', value:efectivoPagado ? String(v.totalCents / 100) : '0', 'aria-label':'Efectivo devuelto'});
    const ops = h('div', {class:'opts'});
    const pintaOps = () => ops.replaceChildren(
      h('button', {class:'op', 'aria-pressed':tipo === 'devolucion', onclick:() => { tipo = 'devolucion'; pintaOps(); }}, 'Devolución (el cliente devuelve)'),
      h('button', {class:'op', 'aria-pressed':tipo === 'anulacion', onclick:() => { tipo = 'anulacion'; pintaOps(); }}, 'Anular (me equivoqué)'));
    pintaOps();
    return h('div', {}, h('p', {class:'ayuda'}, 'La venta no se borra: queda anotada y el dueño decide. Si ya devolviste dinero del cajón, ponlo abajo.'), ops,
      campo('Motivo', motivo), campo('Efectivo que devolviste del cajón (pesos)', dev),
      h('button', {class:'btn', onclick:async () => {
        const m = C.aCentavos(dev.value); if(isNaN(m) || m < 0){ aviso('Revisa el efectivo devuelto', true); return; }
        if(!motivo.value.trim()){ aviso('Escribe el motivo', true); motivo.focus(); return; }
        await db.put('eventos', {id:C.uid(), clase:'solicitud', diaId:dia.entregaId, ventaId:v.id, num:v.num, tipo, motivo:motivo.value.trim(), efectivoDevueltoCents:m, ts:Date.now()});
        cerrar(); aviso('Quedó pedido. El dueño lo verá en tu cierre.'); pintar();
      }}, 'Guardar el pedido'));
  });
}

/* ---------- cierre ---------- */
async function vCierre(){
  if(!dia) return sinEntrega();
  const ventas = await ventasDia(), sol = await solicitudesDia(); const q = C.calcularCuadre(ventas, sol, dia.fondoCents);
  const vend = vendidoMilli(ventas);
  const monedas = Object.keys(q.esperado);
  const cajas = monedas.map(m => {
    const esp = q.esperado[m]; const salida = h('div', {class:'ayuda'});
    const inp = h('input', {inputmode:'decimal', placeholder:'0', value:dia.contado[m] != null ? String(dia.contado[m] / 100) : '', 'aria-label':'Efectivo contado en ' + m});
    const act = () => { const c = C.aCentavos(inp.value);
      if(inp.value.trim() === '' || isNaN(c)){ salida.textContent = ''; return; }
      const d = c - esp; salida.textContent = d === 0 ? 'La caja cuadra' : d < 0 ? 'Faltan ' + C.dinero(-d, m) : 'Sobran ' + C.dinero(d, m); salida.className = 'ayuda ' + (d === 0 ? 'bien' : 'mal'); };
    inp.addEventListener('input', async () => { const c = C.aCentavos(inp.value); if(inp.value.trim() === '') delete dia.contado[m]; else if(!isNaN(c)) dia.contado[m] = c; await guardarDia(); act(); }); act();
    return h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, 'Efectivo en ' + m), h('span', {class:'ayuda num'}, 'Debe haber ' + C.dinero(esp, m))), campo('Lo que cuentas en la caja', inp), salida);
  });
  const stock = dia.catalogo.filter(p => p.controlStock).map(p => { const ent = dia.cantidades[p.id] || 0, vd = vend[p.id] || 0;
    return h('tr', {}, h('td', {}, p.nombre), h('td', {class:'num'}, C.cantidad(ent)), h('td', {class:'num'}, C.cantidad(vd)), h('td', {class:'num ' + (ent - vd < 0 ? 'mal' : '')}, C.cantidad(ent - vd))); });
  const cambiado = dia.enviadoHash && dia.enviadoHash !== dia.ultimoHash;
  montar(raiz, banner(), h('p', {class:'marca'}, dia.puesto.nombre + ' · ' + C.fechaBonita(dia.fecha)), h('h1', {}, 'Cerrar el día'),
    h('div', {class:'card'}, h('div', {class:'lin'}, h('span', {}, 'Vendiste'), h('b', {class:'num'}, C.dinero(q.ventasCup))),
      q.devueltoCup ? h('div', {class:'lin'}, h('span', {}, 'Devuelto'), h('b', {class:'num'}, '-' + C.dinero(q.devueltoCup))) : null,
      h('div', {class:'lin'}, h('span', {}, 'Efectivo'), h('b', {class:'num'}, C.dinero(q.porMetodo.efectivo || 0))),
      h('div', {class:'lin'}, h('span', {}, 'Transferencia y QR'), h('b', {class:'num'}, C.dinero((q.porMetodo.transferencia || 0) + (q.porMetodo.qr || 0)))),
      q.porMetodo.fiado ? h('div', {class:'lin'}, h('span', {}, 'Fiado'), h('b', {class:'num'}, C.dinero(q.porMetodo.fiado))) : null),
    cajas, stock.length ? h('div', {class:'card tabla'}, h('h3', {}, 'Lo que queda'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Producto'), h('th', {}, 'Entregado'), h('th', {}, 'Vendido'), h('th', {}, 'Queda'))), h('tbody', {}, stock))) : null,
    dia.enviadoHash ? h('div', {class:'card ' + (cambiado ? 'aviso-c' : '')}, h('b', {}, cambiado ? 'Anotaste ventas después de mandar el cierre. Mándalo otra vez.' : 'Cierre mandado ✓ (versión ' + dia.cierreVersion + ')')) : null,
    (dia.ajustes || []).length ? h('div', {class:'card'}, h('h3', {}, 'Correcciones de existencia'), dia.ajustes.map(a => { const p = prod(a.productoId); return h('div', {class:'lin'}, h('span', {}, (p ? p.nombre : 'Producto'), h('div', {class:'d'}, a.por + ' · ' + a.motivo)), h('b', {class:'num ' + (a.deltaMilli < 0 ? 'mal' : 'bien')}, (a.deltaMilli > 0 ? '+' : '') + C.cantidad(a.deltaMilli))); })) : null,
    h('button', {class:'btn', onclick:() => enviarCierre(false)}, dia.enviadoHash ? 'Mandar el cierre otra vez' : 'Mandar el cierre al dueño'),
    h('button', {class:'enlace', onclick:() => enviarCierre(true)}, 'o copiarlo como mensaje para pegarlo en el chat'));
}
async function enviarCierre(comoMensaje){
  if(!confianza){ aviso('Primero carga una entrega del dueño.', true); return; }
  const ventas = await ventasDia(), sol = await solicitudesDia();
  if(dia.contado.CUP == null){
    const si = await confirmar('No pusiste el efectivo contado', 'El cierre irá sin el efectivo de la caja y el dueño no podrá ver si cuadra.', 'Mandarlo así', 'Voltear y contar'); if(!si) return;
  }
  const restante = {}; const vend = vendidoMilli(ventas); for(const p of dia.catalogo) if(p.controlStock) restante[p.id] = {entregado:dia.cantidades[p.id] || 0, vendido:vend[p.id] || 0};
  const version = dia.cierreVersion + 1;
  const env = await C.firmarSobre('cierre', perfil, dia.duenoId, {entregaId:dia.entregaId, fecha:dia.fecha, puesto:dia.puesto, vendedorId:perfil.id, vendedorNombre:perfil.nombre, version,
    cerradoEn:Date.now(), fondoCents:dia.fondoCents, ventas, solicitudes:sol, traspasos:Object.values(dia.traspasos || {}), ajustes:dia.ajustes || [], contado:dia.contado, restante, capturas:dia.capturas, ultimoHash:dia.ultimoHash}, llaves.privateKey);
  const nombre = C.nombreArchivo('cierre', dia.puesto.nombre, dia.fecha === C.hoy() ? '' : 'del-' + dia.fecha, 'v' + version);
  let r;
  if(comoMensaje){ r = (await C.copiarTexto(C.sobreATexto(env))) ? 'copiado' : 'cancelado'; if(r === 'cancelado'){ aviso('No se pudo copiar. Usa el botón de arriba para mandarlo como archivo.', true); return; } }
  else r = await C.enviarArchivo(nombre, C.sobreATexto(env));
  if(r === 'cancelado') return;
  dia.cierreVersion = version; dia.enviadoHash = dia.ultimoHash; await guardarDia();
  aviso(r === 'compartido' ? 'Listo. Si lo mandaste por WhatsApp, ya llegó.' : r === 'copiado' ? 'Copiado. Abre el chat del dueño, toca Pegar y envía.' : 'Se guardó en Descargas como «' + nombre + '». En WhatsApp: clip, Documento, y elige el de la hora más reciente.');
  pintar();
}

/* ---------- más: enlace, copia, ajustes ---------- */
async function vMas(){
  const enlaceTxt = async () => C.sobreATexto(await C.firmarSobre('enlace', perfil, null, {nombre:perfil.nombre}, llaves.privateKey));
  montar(raiz, banner(), h('h1', {}, 'Más'),
    h('div', {class:'card'}, h('h3', {}, perfil.nombre), h('p', {class:'ayuda'}, 'Mi huella: ', h('b', {id:'mi-huella'}, '…'), ' (el dueño te la pide para comprobar que eres tú)'), h('p', {class:'ayuda'}, confianza ? 'Enlazada con el dueño «' + confianza.nombre + '» (huella ' + confianza.huella + ').' : 'Todavía no estás enlazada con ningún dueño.'),
      h('button', {class:'btn', onclick:async () => { const r = await C.enviarArchivo(C.nombreArchivo('enlace', perfil.nombre), await enlaceTxt()); if(r === 'descargado') aviso('Se guardó en Descargas. Mándaselo al dueño por WhatsApp.'); }}, 'Mandar mi código de enlace al dueño'),
      h('p', {class:'ayuda'}, 'Solo hace falta una vez. El dueño lo carga en su teléfono y te manda la primera entrega.')),
    cajaCarga(), selectorTema(), tarjetaActualizar(VERSION_APP),
    h('div', {class:'card'}, h('h3', {}, 'Copia de seguridad'), h('p', {class:'ayuda'}, 'Guarda tus ventas por si se borra el navegador. La copia no incluye tu llave: si recuperas, hay que volver a enlazar con el dueño.'),
      h('button', {class:'btn suave', onclick:async () => { const t = JSON.stringify({ozunaCopia:1, v:1, perfil:{id:perfil.id, nombre:perfil.nombre}, confianza, dia, ventas:await db.todos('ventas'), eventos:await db.todos('eventos')});
        const r = await C.enviarArchivo(C.nombreArchivo('copia-vendedora', perfil.nombre), t); if(r === 'descargado') aviso('Se guardó en Descargas.'); }}, 'Guardar o mandar una copia'),
      h('button', {class:'btn suave', onclick:restaurar}, 'Recuperar una copia')),
    h('p', {class:'ayuda'}, 'Ozuna Vendedora · versión ' + VERSION_APP));
  C.huella(perfil.pub).then(f => { const e = document.getElementById('mi-huella'); if(e) e.textContent = f; });
}
async function restaurar(){
  const t = await C.elegirArchivo(); if(!t) return;
  let d; try { d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch(e){}
  if(!d || d.ozunaCopia !== 1){ aviso('Ese archivo no es una copia de la vendedora.', true); return; }
  const si = await confirmar('Esto reemplaza lo que hay ahora', 'Se cargan las ventas de la copia. Tendrás que volver a enlazarte con el dueño porque la llave no viaja en la copia.', 'Recuperar', 'Cancelar'); if(!si) return;
  llaves = await C.nuevasLlaves(false); perfil = {id:d.perfil.id, nombre:d.perfil.nombre, pub:llaves.pub}; confianza = d.confianza || undefined; dia = d.dia || undefined;
  await db.kvSet('llaves', llaves); await db.kvSet('perfil', perfil); if(confianza) await db.kvSet('confianza', confianza); if(dia) await db.kvSet('dia', dia);
  await db.vaciar('ventas'); await db.vaciar('eventos'); for(const v of d.ventas || []) await db.put('ventas', v); for(const e of d.eventos || []) await db.put('eventos', e);
  aviso('Copia recuperada. Manda de nuevo tu código de enlace al dueño.'); pintar();
}

iniciar();
