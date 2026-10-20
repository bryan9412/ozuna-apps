/* App de la vendedora: recibe la entrega, anota ventas sin conexión, pide devoluciones y manda el cierre. */
import * as C from '../shared/core.js';
import { h, montar, aviso, hoja, confirmar, campo, barraNav, registrarSW, selectorTema } from '../shared/ui.js';

const VERSION_APP = '0.2.0';
const BANDEJA = 'ozuna-bandeja-vendedor';
const db = new C.DB('ozuna-vendedor');
const raiz = document.getElementById('app');
let perfil, llaves, confianza, dia, pantalla = 'vender', cart = [], hayVersionNueva = null, ocupado = false;

const NAV = [['vender', '🛒', 'Vender'], ['ventas', '🧾', 'Ventas'], ['cierre', '✅', 'Cierre'], ['mas', '⚙️', 'Más']];
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
  await revisarBandeja();
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
function ir(p){ pantalla = p; pintar(); window.scrollTo(0, 0); }
function banner(){ return hayVersionNueva ? h('div', {class:'banner'}, 'Hay una versión nueva', h('button', {onclick:hayVersionNueva}, 'Actualizar')) : null; }
function sinEntrega(){
  montar(raiz, banner(), h('p', {class:'marca'}, perfil.nombre), h('h1', {}, 'Buenos días'), h('p', {class:'ayuda'}, 'Para empezar, carga la entrega que te mandó el dueño por WhatsApp.'), cajaCarga());
  return true;
}
function cajaCarga(){
  return h('div', {class:'card'}, h('h3', {}, 'Cargar un archivo del dueño'),
    h('button', {class:'btn', onclick:async () => { const t = await C.elegirArchivo(); if(t) await procesarTexto(t); }}, 'Elegir el archivo que llegó'),
    h('button', {class:'enlace', onclick:() => pegarTexto()}, 'Me llegó como mensaje: pegarlo'),
    h('p', {class:'ayuda'}, 'También puedes abrir el archivo en WhatsApp, tocar Compartir y elegir esta aplicación.'));
}
function pegarTexto(){
  hoja('Pegar el mensaje', cerrar => {
    const ta = h('textarea', {class:'bloque-codigo', 'aria-label':'Mensaje del dueño'});
    return h('div', {}, h('p', {class:'ayuda'}, 'En WhatsApp mantén el dedo sobre el mensaje, toca Copiar y pégalo aquí.'), ta,
      h('button', {class:'btn', onclick:async () => { cerrar(); await procesarTexto(ta.value); }}, 'Cargar'));
  });
}

/* ---------- recibir archivos ---------- */
async function revisarBandeja(){ const textos = await C.leerBandeja(BANDEJA); for(const t of textos) await procesarTexto(t); }
async function procesarTexto(txt){
  const env = C.leerTexto(txt);
  if(!env){ aviso('Eso no es un archivo de Ozuna. Revisa que sea el que te mandaron.', true); return; }
  const v = await C.verificarSobre(env, confianza ? confianza.pub : undefined);
  if(!v.ok){ aviso(v.motivo, true); return; }
  if(env.tipo === 'entrega') return cargarEntrega(env);
  if(env.tipo === 'reposicion') return cargarReposicion(env);
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
  if(dia && dia.contador > 0 && dia.enviadoHash !== dia.ultimoHash){
    const si = await confirmar('Todavía no mandaste el cierre', 'Tienes ventas del día anterior sin enviar. Si cargas esta entrega ahora, se quedan guardadas pero tendrás que mandar ese cierre después desde un teléfono con la copia.', 'Cargar la entrega igual', 'Primero el cierre');
    if(!si){ ir('cierre'); return; }
  }
  dia = {entregaId:p.entregaId, fecha:p.fecha, puesto:p.puesto, catalogo:p.catalogo, agregos:p.agregos || [], cantidades:p.cantidades || {}, fondoCents:p.fondoCents || 0,
    tasas:p.tasas || {}, clave:p.clave || null, listas:p.listas || [], mensajeros:p.mensajeros || [], traspasos:{}, ultimoHash:'GENESIS', contador:0, cierreVersion:0, enviadoHash:null, capturas:{}, contado:{}, duenoId:env.de.id};
  limpiarCarrito(); await guardarDia(); aviso('Entrega cargada: ' + p.puesto.nombre); ir('vender');
}
async function cargarReposicion(env){
  const p = env.payload;
  if(!dia || dia.entregaId !== p.entregaId){ aviso('Esta reposición es de otro día. Carga primero la entrega que corresponde.', true); return; }
  if(p.dispositivoId !== perfil.id){ aviso('Esta reposición es para otro teléfono.', true); return; }
  if(dia.reposiciones && dia.reposiciones[env.id]){ aviso('Esa reposición ya está cargada.'); return; }
  for(const [id, q] of Object.entries(p.cantidades || {})) dia.cantidades[id] = (dia.cantidades[id] || 0) + q;
  for(const n of p.catalogo || []){ const i = dia.catalogo.findIndex(x => x.id === n.id); if(i >= 0) dia.catalogo[i] = n; else dia.catalogo.push(n); }
  for(const n of p.agregos || []){ const i = dia.agregos.findIndex(x => x.id === n.id); if(i >= 0) dia.agregos[i] = n; else dia.agregos.push(n); }
  if(p.tasas) dia.tasas = p.tasas;
  if(p.listas) dia.listas = p.listas;
  if(p.mensajeros) dia.mensajeros = p.mensajeros;
  dia.reposiciones = dia.reposiciones || {}; dia.reposiciones[env.id] = Date.now();
  await guardarDia(); aviso('Reposición cargada'); ir('vender');
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
function limpiarCarrito(){ cart = []; cartLista = null; cartAuth = false; }
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

async function vVender(){
  if(!dia) return sinEntrega();
  const ventas = await ventasDia(); const vend = vendidoMilli(ventas);
  const tiles = dia.catalogo.map(p => {
    const rest = (dia.cantidades[p.id] || 0) - (vend[p.id] || 0);
    const cls = 'prod' + (p.controlStock && rest <= 0 ? ' agotado' : p.controlStock && rest < 3000 ? ' poco' : '');
    return h('button', {class:cls, onclick:() => tocarProducto(p, rest)},
      h('b', {}, p.nombre), h('span', {class:'pr num'}, C.dinero(p.precioCents) + ' la ' + C.nombreMedida(p.medida, 1000)),
      p.controlStock ? h('span', {class:'qd'}, 'Quedan ' + textoCantidad(p, Math.max(rest, 0))) : null);
  });
  const neto = ventas.reduce((s, v) => s + v.totalCents, 0);
  montar(raiz, banner(), h('p', {class:'marca'}, dia.puesto.nombre + ' · ' + C.fechaBonita(dia.fecha)), h('h1', {}, '¿Qué se vendió?'),
    dia.catalogo.length ? h('div', {class:'rejilla'}, tiles) : h('div', {class:'card aviso-c'}, 'El dueño todavía no puso productos en la entrega.'),
    h('div', {class:'total'}, h('span', {}, 'Llevas vendido'), h('b', {class:'num'}, C.dinero(neto))));
}
function tocarProducto(p, rest){
  const peso = C.MEDIDAS[p.medida] && C.MEDIDAS[p.medida].peso;
  if(!peso){ añadir(p, 1000); return; }
  hoja(p.nombre, cerrar => {
    const q = h('input', {inputmode:'decimal', placeholder:'0', 'aria-label':'Cantidad en ' + C.nombreMedida(p.medida, 2000)});
    const info = h('p', {class:'ayuda'}); const imp = h('div', {class:'total'}, h('span', {}, 'Cobrar'), h('b', {class:'num'}, '0'));
    const act = () => { const m = C.aMilesimas(q.value); const ok = !isNaN(m) && m > 0;
      imp.lastChild.textContent = ok ? C.dinero(C.importeLinea(p.precioCents, m)) : '0';
      info.textContent = ok && p.controlStock && m > rest ? 'Ojo: solo quedan ' + textoCantidad(p, Math.max(rest, 0)) + '.' : C.dinero(p.precioCents) + ' la ' + C.nombreMedida(p.medida, 1000) + (p.controlStock ? ' · quedan ' + textoCantidad(p, Math.max(rest, 0)) : ''); };
    q.addEventListener('input', act); act();
    const rap = h('div', {class:'rapidos'}, ['0,5', '1', '1,5', '2', '3', '5'].map(x => h('button', {onclick:() => { q.value = x; act(); }}, x)));
    return h('div', {}, info, campo('¿Cuánto? (' + C.nombreMedida(p.medida, 2000) + ')', q), rap, imp,
      h('button', {class:'btn', onclick:() => { const m = C.aMilesimas(q.value); if(isNaN(m) || m <= 0){ aviso('Pon cuánto vendiste', true); q.focus(); return; } añadir(p, m); cerrar(); }}, 'Añadir al pedido'));
  });
}
function añadir(p, qty){
  const peso = C.MEDIDAS[p.medida] && C.MEDIDAS[p.medida].peso;
  const l = !peso && cart.find(x => x.pid === p.id);
  if(l) l.qty += qty; else cart.push({pid:p.id, qty, ag:{}});
  pintarCarrito(); aviso(p.nombre + ' añadido');
}
function pintarCarrito(){
  const c = document.getElementById('carrito');
  if(!cart.length || pantalla !== 'vender' || !dia){ montar(c); return; }
  const n = cart.length;
  montar(c, h('div', {class:'barra-carrito'}, h('div', {class:'in'},
    h('button', {style:'background:none;color:inherit;font-size:16px;text-align:left;min-height:50px', onclick:abrirCarrito}, h('span', {class:'num'}, n + (n === 1 ? ' producto' : ' productos')), h('br'), h('b', {class:'num'}, C.dinero(totalCarrito()))),
    h('button', {onclick:abrirCobro}, 'Cobrar'))));
}
function abrirCarrito(){
  hoja('Pedido', cerrar => {
    const cuerpo = h('div');
    const repinta = () => { draw(); pintarCarrito(); };
    const draw = () => {
      if(!cart.length){ cerrar(); pintarCarrito(); return; }
      const especial = !cartAuth
        ? h('button', {class:'btn suave', onclick:async () => { if(await pedirClave('Solo el dueño puede dar un precio especial.')){ cartAuth = true; draw(); } }}, 'Precio especial (clave del dueño)')
        : h('div', {class:'card'}, h('b', {}, 'Precio especial autorizado'),
            dia.listas.length ? h('div', {class:'opts'}, h('button', {class:'op', 'aria-pressed':!cartLista, onclick:() => { cartLista = null; cart.forEach(l => delete l.precio); repinta(); }}, 'Precio normal'),
              dia.listas.map(x => h('button', {class:'op', 'aria-pressed':!!cartLista && cartLista.id === x.id, onclick:() => { cartLista = x; cart.forEach(l => delete l.precio); repinta(); }}, x.nombre + ' −' + x.pct + ' %'))) : null,
            h('p', {class:'ayuda'}, 'También puedes cambiar el precio de cada producto aquí abajo.'));
      cuerpo.replaceChildren(...cart.map((l, i) => {
        const p = prod(l.pid); const peso = C.MEDIDAS[p.medida].peso;
        const ags = p.admiteAgregos ? dia.agregos.map(a => h('div', {class:'lin'}, h('span', {}, a.nombre + ' ', h('span', {class:'d num'}, '+' + C.dinero(a.precioCents))),
          h('div', {class:'paso'}, h('button', {'aria-label':'Quitar ' + a.nombre, onclick:() => { const c = (l.ag[a.id] || 0) - 1; if(c > 0) l.ag[a.id] = c; else delete l.ag[a.id]; repinta(); }}, '−'),
            h('output', {}, l.ag[a.id] || 0), h('button', {class:'mas', 'aria-label':'Añadir ' + a.nombre, onclick:() => { l.ag[a.id] = (l.ag[a.id] || 0) + 1; repinta(); }}, '+')))) : [];
        return h('div', {class:'card'}, h('div', {class:'fila'}, h('div', {}, h('b', {}, p.nombre), h('div', {class:'d ayuda num'}, textoCantidad(p, l.qty) + ' × ' + C.dinero(precioUnit(l)) + (precioUnit(l) !== p.precioCents ? ' (precio especial)' : ''))),
          h('b', {class:'num'}, C.dinero(totalLinea(l)))),
          cartAuth ? campo('Precio de ' + C.nombreMedida(p.medida, 1000), h('input', {inputmode:'decimal', value:String(precioUnit(l) / 100), onchange:e => { const c = C.aCentavos(e.target.value); if(!isNaN(c) && c >= 0){ l.precio = c; repinta(); } else aviso('Revisa el precio', true); }})) : null,
          peso ? null : h('div', {class:'paso', style:'margin-top:8px'}, h('button', {'aria-label':'Quitar uno', onclick:() => { if(l.qty > 1000) l.qty -= 1000; else cart.splice(i, 1); repinta(); }}, '−'), h('output', {}, C.cantidad(l.qty)), h('button', {class:'mas', 'aria-label':'Añadir uno', onclick:() => { l.qty += 1000; repinta(); }}, '+')),
          ags, h('button', {class:'enlace', onclick:() => { cart.splice(i, 1); repinta(); }}, 'Quitar del pedido'));
      }), especial, h('div', {class:'total'}, h('span', {}, 'Total'), h('b', {class:'num'}, C.dinero(totalCarrito()))),
        h('button', {class:'btn', onclick:() => { cerrar(); abrirCobro(); }}, 'Cobrar'));
    };
    draw(); return cuerpo;
  });
}

/* ---------- cobrar ---------- */
function abrirCobro(){
  const base = totalCarrito(); if(!base) return;
  const monedas = Object.keys(dia.tasas || {}).filter(m => m !== 'CUP');
  let pagos = [{metodo:'efectivo', moneda:'CUP', monto:''}];
  const dom = {on:false, direccion:'', envio:'', mensajero:''};
  const envioCents = () => { if(!dom.on) return 0; const e = C.aCentavos(dom.envio); return isNaN(e) || e < 0 ? 0 : e; };
  const total = () => base + envioCents();
  hoja('Cobrar', cerrar => {
    const cuerpo = h('div'); const resumen = h('div', {class:'total'});
    const calc = () => {
      let efectivo = 0, otros = 0;
      for(const p of pagos){ const m = C.aCentavos(p.monto); p._m = isNaN(m) ? 0 : m; p._cup = C.aCup(p._m, tasaDe(p.moneda)); if(p.metodo === 'efectivo') efectivo += p._cup; else otros += p._cup; }
      const t = total();
      return {efectivo, otros, suma:efectivo + otros, falta:Math.max(0, t - efectivo - otros), vuelto:Math.max(0, efectivo + otros - t)};
    };
    const pintaResumen = () => { const c = calc();
      resumen.replaceChildren(h('span', {}, c.falta ? 'Falta' : 'Vuelto'), h('b', {class:'num'}, c.falta ? C.dinero(c.falta) : C.dinero(c.vuelto))); };
    const etiqueta = p => p.metodo === 'efectivo' ? 'Efectivo ' + p.moneda : p.metodo === 'transferencia' ? 'Transferencia' : p.metodo === 'qr' ? 'QR (Transfermóvil / EnZona)' : 'Fiado';
    const draw = () => {
      const t = total();
      const redondos = [100, 500, 1000, 2000, 5000].map(x => Math.ceil(t / (x * 100)) * x * 100).filter((x, i, a) => a.indexOf(x) === i && x >= t);
      cuerpo.replaceChildren(
        h('div', {class:'total'}, h('span', {}, 'Total'), h('b', {class:'num'}, C.dinero(t))),
        h('button', {class:'btn', onclick:() => guardar([{metodo:'efectivo', moneda:'CUP', monto:String(t / 100)}])}, 'Cobrar exacto en efectivo (' + C.dinero(t) + ')'),
        h('label', {class:'lin', style:'cursor:pointer;margin-top:8px'}, h('span', {}, 'Es un pedido a domicilio'), h('input', {type:'checkbox', style:'width:26px;min-height:26px', checked:dom.on, onchange:e => { dom.on = e.target.checked; draw(); }})),
        dom.on ? h('div', {class:'card'}, campo('Dirección', h('input', {value:dom.direccion, oninput:e => dom.direccion = e.target.value, placeholder:'¿A dónde va?'})),
          campo('Cobro del envío (pesos)', h('input', {inputmode:'decimal', value:dom.envio, placeholder:'0', onchange:e => { dom.envio = e.target.value; draw(); }})),
          (dia.mensajeros || []).length ? campo('Mensajero', h('select', {onchange:e => dom.mensajero = e.target.value}, h('option', {value:''}, 'Elige…'), dia.mensajeros.map(m => h('option', {value:m, selected:m === dom.mensajero}, m)))) : null) : null,
        h('p', {class:'ayuda', style:'margin-top:14px'}, 'O elige cómo pagó el cliente:'),
        ...pagos.map((p, i) => {
          const inp = h('input', {inputmode:'decimal', placeholder:'0', value:p.monto, 'aria-label':'Monto en ' + p.moneda, oninput:e => { p.monto = e.target.value; pintaResumen(); }});
          const ex = h('button', {class:'btn chico suave', onclick:() => { const c = calc(); const falta = Math.max(0, total() - (c.suma - p._cup)); p.monto = String(Math.ceil(falta * 100 / tasaDe(p.moneda)) / 100); draw(); }}, 'Lo que falta');
          return h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, etiqueta(p)), pagos.length > 1 ? h('button', {class:'x', 'aria-label':'Quitar este pago', onclick:() => { pagos.splice(i, 1); draw(); }}, '✕') : null),
            h('div', {class:'fila', style:'margin-top:8px'}, inp, ex),
            p.metodo === 'efectivo' && p.moneda === 'CUP' && i === 0 ? h('div', {class:'rapidos'}, redondos.map(x => h('button', {onclick:() => { p.monto = String(x / 100); draw(); }}, C.dinero(x)))) : null,
            p.metodo === 'fiado' ? [campo('Nombre del cliente', h('input', {value:p.cliente || '', placeholder:'¿A quién se le fía?', oninput:e => { p.cliente = e.target.value; }})),
              campo('Clave del dueño', h('input', {type:'password', inputmode:'numeric', placeholder:'Solo el dueño la sabe', oninput:e => { p.pin = e.target.value; }}))] : null);
        }),
        h('div', {class:'opts'},
          h('button', {class:'op', onclick:() => { pagos.push({metodo:'efectivo', moneda:'CUP', monto:''}); draw(); }}, '+ Efectivo'),
          h('button', {class:'op', onclick:() => { pagos.push({metodo:'transferencia', moneda:'CUP', monto:''}); draw(); }}, '+ Transferencia'),
          h('button', {class:'op', onclick:() => { pagos.push({metodo:'qr', moneda:'CUP', monto:''}); draw(); }}, '+ QR'),
          monedas.map(m => h('button', {class:'op', onclick:() => { pagos.push({metodo:'efectivo', moneda:m, monto:''}); draw(); }}, '+ ' + m)),
          dia.clave ? h('button', {class:'op', onclick:() => { pagos.push({metodo:'fiado', moneda:'CUP', monto:'', cliente:'', pin:''}); draw(); }}, '+ Fiado') : null),
        resumen, h('button', {class:'btn', onclick:() => guardar(pagos)}, 'Anotar venta'));
      pintaResumen();
    };
    async function guardar(lista){
      if(ocupado) return; ocupado = true;
      try {
        const tot = total();
        if(dom.on && !dom.direccion.trim()){ aviso('Escribe la dirección del pedido.', true); return; }
        let efectivo = 0, otros = 0; const pg = [];
        for(const p of lista){
          const m = C.aCentavos(p.monto); if(isNaN(m) || m <= 0) { if(lista.length > 1 && (p.monto === '' || p.monto === undefined)) continue; aviso('Revisa el monto de ' + etiqueta(p), true); return; }
          const tasa = tasaDe(p.moneda); if(!tasa){ aviso('No hay cambio para ' + p.moneda + '. Pídele al dueño que lo ponga.', true); return; }
          const cup = C.aCup(m, tasa);
          if(p.metodo === 'fiado'){
            if(!(p.cliente || '').trim()){ aviso('Escribe a quién se le fía.', true); return; }
            const hh = await C.hashClave(String(p.pin || ''), dia.clave.sal);
            if(hh !== dia.clave.hash){ aviso('La clave del dueño no es correcta.', true); return; }
          }
          pg.push({metodo:p.metodo, moneda:p.moneda, monto:m, tasa, cup, cliente:p.metodo === 'fiado' ? p.cliente.trim() : undefined});
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
        hoja('Venta ' + ticket(venta.num), c2 => h('div', {}, h('div', {class:'total'}, h('span', {}, 'Total'), h('b', {class:'num'}, C.dinero(tot))),
          vuelto ? h('div', {class:'card', style:'margin-top:10px'}, h('div', {class:'fila'}, h('b', {}, 'Dale de vuelto'), h('b', {class:'num bien', style:'font-size:30px'}, C.dinero(vuelto)))) : null,
          h('button', {class:'btn', onclick:c2}, 'Siguiente venta')));
      } finally { ocupado = false; }
    }
    draw(); return cuerpo;
  });
}

/* ---------- ventas del día, devoluciones y transferencias ---------- */
async function vVentas(){
  if(!dia) return sinEntrega();
  const ventas = await ventasDia(), sol = await solicitudesDia(); const q = C.calcularCuadre(ventas, sol, dia.fondoCents);
  const lista = ventas.slice().reverse().map(v => {
    const s = sol.filter(x => x.ventaId === v.id);
    return h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, ticket(v.num) + ' · ' + C.horaDe(v.ts)),
        h('div', {class:'ayuda'}, v.lineas.map(l => l.nombre + ' ×' + C.cantidad(l.qtyMilli)).join(', ')),
        v.domicilio ? h('div', {class:'etq'}, 'Domicilio · ' + v.domicilio.direccion) : null,
        h('div', {class:'ayuda'}, v.pagos.map(p => (p.metodo === 'efectivo' ? 'Efectivo ' + p.moneda : p.metodo === 'qr' ? 'QR' : p.metodo === 'fiado' ? 'Fiado (' + p.cliente + ')' : 'Transferencia')).join(' + '))),
        h('b', {class:'num'}, C.dinero(v.totalCents))),
      s.map(x => h('div', {class:'etq warn', style:'margin-top:6px'}, (x.tipo === 'devolucion' ? 'Devolución pedida' : 'Anulación pedida') + ' · ' + C.dinero(x.efectivoDevueltoCents) + ' devueltos')),
      h('button', {class:'enlace', onclick:() => pedirDevolucion(v)}, 'Devolver o anular esta venta'));
  });
  const trans = q.transferencias.map(t => h('label', {class:'lin', style:'cursor:pointer'}, h('span', {}, ticket(t.num) + ' · ' + C.horaDe(t.hora) + ' · ' + (t.metodo === 'qr' ? 'QR' : 'Transferencia'), h('div', {class:'d num'}, C.dinero(t.cup))),
    h('span', {}, 'Ya mandé la captura ', h('input', {type:'checkbox', style:'width:26px;min-height:26px;vertical-align:middle', checked:!!dia.capturas[t.ventaId], onchange:async e => { dia.capturas[t.ventaId] = e.target.checked; await guardarDia(); }}))));
  montar(raiz, banner(), h('p', {class:'marca'}, dia.puesto.nombre), h('h1', {}, 'Ventas de hoy'),
    h('div', {class:'total'}, h('span', {}, ventas.length + (ventas.length === 1 ? ' venta' : ' ventas')), h('b', {class:'num'}, C.dinero(q.netoCup))),
    trans.length ? h('div', {class:'card'}, h('h3', {}, 'Transferencias y QR'), h('p', {class:'ayuda'}, 'Manda la captura de cada una al dueño por WhatsApp y márcala.'), trans) : null,
    h('h2', {}, 'Cada venta'), lista.length ? lista : h('div', {class:'card'}, 'Todavía no has anotado ventas.'));
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
    h('button', {class:'btn', onclick:enviarCierre}, dia.enviadoHash ? 'Mandar el cierre otra vez' : 'Mandar el cierre al dueño'));
}
async function enviarCierre(){
  if(!confianza){ aviso('Primero carga una entrega del dueño.', true); return; }
  const ventas = await ventasDia(), sol = await solicitudesDia();
  if(dia.contado.CUP == null){
    const si = await confirmar('No pusiste el efectivo contado', 'El cierre irá sin el efectivo de la caja y el dueño no podrá ver si cuadra.', 'Mandarlo así', 'Voltear y contar'); if(!si) return;
  }
  const restante = {}; const vend = vendidoMilli(ventas); for(const p of dia.catalogo) if(p.controlStock) restante[p.id] = {entregado:dia.cantidades[p.id] || 0, vendido:vend[p.id] || 0};
  const version = dia.cierreVersion + 1;
  const env = await C.firmarSobre('cierre', perfil, dia.duenoId, {entregaId:dia.entregaId, fecha:dia.fecha, puesto:dia.puesto, vendedorId:perfil.id, vendedorNombre:perfil.nombre, version,
    cerradoEn:Date.now(), fondoCents:dia.fondoCents, ventas, solicitudes:sol, traspasos:Object.values(dia.traspasos || {}), contado:dia.contado, restante, capturas:dia.capturas, ultimoHash:dia.ultimoHash}, llaves.privateKey);
  const nombre = 'cierre-' + dia.puesto.nombre.replace(/[^\wáéíóúñ]+/gi, '-').toLowerCase() + '-' + dia.fecha + '-v' + version + '.txt';
  const r = await C.enviarArchivo(nombre, C.sobreATexto(env));
  if(r === 'cancelado') return;
  dia.cierreVersion = version; dia.enviadoHash = dia.ultimoHash; await guardarDia();
  aviso(r === 'compartido' ? 'Listo. Si lo mandaste por WhatsApp, ya llegó.' : 'Se guardó en Descargas. En WhatsApp: clip, Documento, y elígelo.');
  pintar();
}

/* ---------- más: enlace, copia, ajustes ---------- */
async function vMas(){
  const enlaceTxt = async () => C.sobreATexto(await C.firmarSobre('enlace', perfil, null, {nombre:perfil.nombre}, llaves.privateKey));
  montar(raiz, banner(), h('h1', {}, 'Más'),
    h('div', {class:'card'}, h('h3', {}, perfil.nombre), h('p', {class:'ayuda'}, 'Mi huella: ', h('b', {id:'mi-huella'}, '…'), ' (el dueño te la pide para comprobar que eres tú)'), h('p', {class:'ayuda'}, confianza ? 'Enlazada con el dueño «' + confianza.nombre + '» (huella ' + confianza.huella + ').' : 'Todavía no estás enlazada con ningún dueño.'),
      h('button', {class:'btn', onclick:async () => { const r = await C.enviarArchivo('enlace-' + perfil.nombre.toLowerCase().replace(/\W+/g, '-') + '.txt', await enlaceTxt()); if(r === 'descargado') aviso('Se guardó en Descargas. Mándaselo al dueño por WhatsApp.'); }}, 'Mandar mi código de enlace al dueño'),
      h('p', {class:'ayuda'}, 'Solo hace falta una vez. El dueño lo carga en su teléfono y te manda la primera entrega.')),
    cajaCarga(), selectorTema(),
    h('div', {class:'card'}, h('h3', {}, 'Copia de seguridad'), h('p', {class:'ayuda'}, 'Guarda tus ventas por si se borra el navegador. La copia no incluye tu llave: si recuperas, hay que volver a enlazar con el dueño.'),
      h('button', {class:'btn suave', onclick:async () => { const t = JSON.stringify({ozunaCopia:1, v:1, perfil:{id:perfil.id, nombre:perfil.nombre}, confianza, dia, ventas:await db.todos('ventas'), eventos:await db.todos('eventos')});
        const r = await C.enviarArchivo('copia-vendedor-' + C.hoy() + '.txt', t); if(r === 'descargado') aviso('Se guardó en Descargas.'); }}, 'Guardar o mandar una copia'),
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
