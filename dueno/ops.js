/* Operación del dueño: traspasos, compras, gastos, almacén de casa, merma, conteo y fiado. */
import * as C from '../shared/core.js';
import { h, montar, aviso, hoja, confirmar, campo } from '../shared/ui.js';
import { clave, cierresUltimos, eventos, casaSaldos, fiadoPendiente } from './datos.js';

const atras = ctx => h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más');
const mes = iso => iso.slice(0, 7);
const sel = (ctx, ops, valor, cambio, vacio) => ctx.selector(ops, valor, cambio, vacio);
const limpia = s => s.replace(/[^\wáéíóúñ]+/gi, '-').toLowerCase();

/* ================= TRASPASOS ================= */
const stT = {origen:'', destino:'', fecha:C.hoy(), cant:{}};
export async function vTraspasos(ctx){
  const N = ctx.N; const conTel = N.puestos.filter(p => N.dispositivos.some(d => d.puestoId === p.id));
  if(conTel.length < 2){ montar(ctx.raiz, atras(ctx), h('h1', {}, 'Traspasos'), h('div', {class:'card aviso-c'}, 'Hacen falta dos puestos con teléfono enlazado para pasar mercancía de uno a otro.')); return; }
  if(!conTel.some(p => p.id === stT.origen)) stT.origen = conTel[0].id;
  if(!conTel.some(p => p.id === stT.destino) || stT.destino === stT.origen) stT.destino = (conTel.find(p => p.id !== stT.origen) || conTel[1]).id;
  const prods = N.productos.filter(p => p.puestoId === stT.origen && p.activo !== false && p.controlStock);
  const hist = (await eventos(ctx.db, 'traspaso')).slice(-15).reverse();
  const cierres = await ctx.db.todos('cierres'); const conf = {};
  for(const c of cierres) for(const t of c.traspasos || []) conf[t.id + ':' + t.sentido] = true;
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Traspasos'), h('p', {class:'ayuda'}, 'Pasas mercancía de un puesto a otro. Cada vendedora recibe su archivo y lo anota; los dos quedan registrados.'),
    campo('Sale de', sel(ctx, conTel.map(p => [p.id, p.nombre]), stT.origen, v => { stT.origen = v; stT.cant = {}; ctx.pintar(); })),
    campo('Va para', sel(ctx, conTel.filter(p => p.id !== stT.origen).map(p => [p.id, p.nombre]), stT.destino, v => { stT.destino = v; ctx.pintar(); })),
    campo('Fecha', h('input', {type:'date', value:stT.fecha, onchange:e => { stT.fecha = e.target.value || C.hoy(); }})),
    h('h2', {}, 'Qué pasa'), prods.length ? prods.map(p => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, p.nombre), h('input', {inputmode:'decimal', placeholder:'0', style:'max-width:120px;text-align:right', value:stT.cant[p.id] || '', 'aria-label':'Cantidad de ' + p.nombre, oninput:e => { stT.cant[p.id] = e.target.value; }})), h('div', {class:'ayuda'}, 'en ' + C.nombreMedida(p.medida, 2000)))) : h('p', {class:'ayuda'}, 'Este puesto no tiene productos con cantidad.'),
    h('button', {class:'btn', onclick:() => generarTraspaso(ctx, prods)}, 'Generar y mandar los dos archivos'),
    h('h2', {}, 'Últimos traspasos'), hist.length ? hist.map(t => h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, C.fechaBonita(t.fecha) + ' · ' + ctx.nomPuesto(t.origenId) + ' → ' + ctx.nomPuesto(t.destinoId)), h('div', {class:'ayuda'}, t.items.map(i => i.nombre + ' ' + C.cantidad(i.qtyMilli)).join(', '))),
      h('div', {}, h('span', {class:'etq ' + (conf[t.id + ':salida'] ? '' : 'warn')}, conf[t.id + ':salida'] ? 'Salida ✓' : 'Salida pendiente'), ' ', h('span', {class:'etq ' + (conf[t.id + ':entrada'] ? '' : 'warn')}, conf[t.id + ':entrada'] ? 'Entrada ✓' : 'Entrada pendiente'))))) : h('div', {class:'card'}, 'Todavía no hay traspasos.'));
}
async function generarTraspaso(ctx, prods){
  const N = ctx.N; const o = ctx.puesto(stT.origen), d = ctx.puesto(stT.destino);
  const items = []; for(const p of prods){ const raw = stT.cant[p.id]; if(!raw) continue; const m = C.aMilesimas(raw); if(isNaN(m) || m <= 0){ aviso('Revisa la cantidad de ' + p.nombre, true); return; } items.push({p, m}); }
  if(!items.length){ aviso('Pon al menos una cantidad.', true); return; }
  const dO = N.dispositivos.find(x => x.puestoId === o.id), dD = N.dispositivos.find(x => x.puestoId === d.id);
  const ents = await ctx.db.todos('entregas'); const ult = id => ents.filter(e => e.dispositivoId === id && e.fecha === stT.fecha).sort((a, b) => b.ts - a.ts)[0];
  const eO = ult(dO.id), eD = ult(dD.id);
  if(!eO || !eD){ aviso('Falta la entrega del día de ' + (!eO ? o.nombre : d.nombre) + ' en esa fecha.', true); return; }
  const creados = [], mapeo = [];
  for(const it of items){
    let pd = N.productos.find(x => x.puestoId === d.id && clave(x.nombre, x.medida) === clave(it.p.nombre, it.p.medida));
    if(!pd){ pd = {id:C.uid(), puestoId:d.id, nombre:it.p.nombre, medida:it.p.medida, precioCents:it.p.precioCents, moneda:it.p.moneda, costoCents:it.p.costoCents, costoMoneda:it.p.costoMoneda || 'CUP', admiteAgregos:false, controlStock:true, activo:true}; creados.push(pd); }
    mapeo.push({o:it.p, d:pd, m:it.m});
  }
  if(creados.length){
    const si = await confirmar('Productos nuevos en ' + d.nombre, creados.map(x => x.nombre).join(', ') + ' no existían ahí. Se crean con el mismo precio que en ' + o.nombre + '.', 'Crear y seguir', 'Cancelar');
    if(!si) return;
    N.productos.push(...creados);
  }
  await ctx.guardarN();
  const id = C.uid(); const catD = mapeo.map(x => ({id:x.d.id, nombre:x.d.nombre, medida:x.d.medida, precioCents:C.precioEnCup(x.d, N.tasas, N.redondeo), admiteAgregos:!!x.d.admiteAgregos, controlStock:true}));
  const sal = await C.firmarSobre('traspaso-salida', ctx.perfil, dO.id, {traspasoId:id, entregaId:eO.id, dispositivoId:dO.id, items:mapeo.map(x => ({productoId:x.o.id, qtyMilli:x.m})), contra:d.nombre}, ctx.llaves.privateKey);
  const ent = await C.firmarSobre('traspaso-entrada', ctx.perfil, dD.id, {traspasoId:id, entregaId:eD.id, dispositivoId:dD.id, items:mapeo.map(x => ({productoId:x.d.id, qtyMilli:x.m})), contra:o.nombre, catalogo:catD}, ctx.llaves.privateKey);
  for(const x of mapeo){ eO.cantidades[x.o.id] = (eO.cantidades[x.o.id] || 0) - x.m; eD.cantidades[x.d.id] = (eD.cantidades[x.d.id] || 0) + x.m; }
  await ctx.db.put('entregas', eO); await ctx.db.put('entregas', eD);
  await ctx.db.put('eventos', {id, clase:'traspaso', fecha:stT.fecha, origenId:o.id, destinoId:d.id, items:mapeo.map(x => ({nombre:x.o.nombre, medida:x.o.medida, qtyMilli:x.m})), ts:Date.now()});
  const r1 = await C.enviarArchivo('traspaso-sale-' + limpia(o.nombre) + '-' + C.horaDe(Date.now()).replace(':', '') + '.txt', C.sobreATexto(sal));
  const r2 = await C.enviarArchivo('traspaso-entra-' + limpia(d.nombre) + '-' + C.horaDe(Date.now()).replace(':', '') + '.txt', C.sobreATexto(ent));
  aviso(r1 === 'cancelado' || r2 === 'cancelado' ? 'Se registró, pero no mandaste los dos archivos. Búscalos en Descargas.' : 'Listo: salida de ' + o.nombre + ' y entrada a ' + d.nombre + '.', r1 === 'cancelado' || r2 === 'cancelado');
  stT.cant = {}; ctx.pintar();
}

/* ================= COMPRAS ================= */
export async function vCompras(ctx){
  const N = ctx.N; const todas = (await eventos(ctx.db, 'compra')).reverse(); const m = mes(C.hoy()); const delMes = todas.filter(c => mes(c.fecha) === m);
  const totalMes = delMes.reduce((s, c) => s + c.totalCup, 0);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Compras'), h('div', {class:'total'}, h('span', {}, 'Comprado este mes'), h('b', {class:'num'}, C.dinero(totalMes))),
    h('button', {class:'btn', onclick:() => nuevaCompra(ctx)}, '+ Registrar una compra'),
    h('h2', {}, 'Últimas compras'), todas.length ? todas.slice(0, 30).map(c => h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, C.fechaBonita(c.fecha) + (c.proveedor ? ' · ' + c.proveedor : '')),
        h('div', {class:'ayuda'}, c.lineas.map(l => l.nombre + ' ' + C.cantidad(l.qtyMilli)).join(', ')), c.moneda !== 'CUP' ? h('div', {class:'ayuda num'}, C.dinero(c.totalCents) + ' ' + c.moneda + ' a ' + C.dinero(c.tasaCents)) : null),
      h('b', {class:'num'}, C.dinero(c.totalCup))), h('button', {class:'enlace', onclick:async () => { if(await confirmar('¿Quitar esta compra?', 'Se descuenta del almacén de casa y de los totales.', 'Quitar', 'No')){ await ctx.db.del('eventos', c.id); ctx.pintar(); } }}, 'Quitar'))) : h('div', {class:'card'}, 'Todavía no registraste compras.'));
}
function nuevaCompra(ctx){
  const N = ctx.N; const st = {fecha:C.hoy(), proveedor:'', moneda:'CUP', tasa:'', lineas:[{nombre:'', medida:'libra', qty:'', costo:''}], actualizar:true};
  const nombres = [...new Set([...N.productos.map(p => p.nombre)])];
  hoja('Nueva compra', cerrar => {
    const cuerpo = h('div'); const dl = h('datalist', {id:'lista-art'}, nombres.map(n => h('option', {value:n})));
    const total = () => st.lineas.reduce((s, l) => { const c = C.aCentavos(l.costo); return s + (isNaN(c) ? 0 : c); }, 0);
    const draw = () => {
      const monedas = ['CUP', ...Object.keys(N.tasas)]; const t = () => st.moneda === 'CUP' ? 100 : (C.aCentavos(st.tasa) || N.tasas[st.moneda] || 0);
      cuerpo.replaceChildren(dl,
        campo('Fecha', h('input', {type:'date', value:st.fecha, onchange:e => st.fecha = e.target.value || C.hoy()})),
        campo('¿Dónde compraste?', h('input', {value:st.proveedor, placeholder:'Opcional', oninput:e => st.proveedor = e.target.value})),
        campo('Pagaste en', sel(ctx, monedas, st.moneda, v => { st.moneda = v; st.tasa = ''; draw(); })),
        st.moneda !== 'CUP' ? campo('Pesos por cada ' + st.moneda, h('input', {inputmode:'decimal', value:st.tasa || (N.tasas[st.moneda] ? String(N.tasas[st.moneda] / 100) : ''), oninput:e => st.tasa = e.target.value}), 'Se usa para pasar el gasto a pesos.') : null,
        h('h3', {style:'margin-top:14px'}, 'Qué compraste'),
        ...st.lineas.map((l, i) => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, 'Artículo ' + (i + 1)), st.lineas.length > 1 ? h('button', {class:'x', 'aria-label':'Quitar', onclick:() => { st.lineas.splice(i, 1); draw(); }}, '✕') : null),
          campo('Nombre', h('input', {value:l.nombre, list:'lista-art', oninput:e => l.nombre = e.target.value, onchange:e => { const p = N.productos.find(x => x.nombre.toLowerCase() === e.target.value.trim().toLowerCase()); if(p){ l.medida = p.medida; draw(); } }, placeholder:'Pollo, harina…'})),
          h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cantidad', h('input', {inputmode:'decimal', value:l.qty, oninput:e => l.qty = e.target.value}))), h('div', {style:'flex:1'}, campo('Medida', sel(ctx, Object.keys(C.MEDIDAS).map(k => [k, C.MEDIDAS[k].p]), l.medida, v => l.medida = v)))),
          campo('Lo que pagaste por esto (en ' + st.moneda + ')', h('input', {inputmode:'decimal', value:l.costo, oninput:e => { l.costo = e.target.value; tot.textContent = C.dinero(total(), st.moneda); }})))),
        h('button', {class:'btn suave', onclick:() => { st.lineas.push({nombre:'', medida:'libra', qty:'', costo:''}); draw(); }}, '+ Otro artículo'),
        h('label', {class:'lin', style:'cursor:pointer;margin-top:10px'}, h('span', {}, 'Actualizar el costo de los productos con esta compra'), h('input', {type:'checkbox', style:'width:26px;min-height:26px', checked:st.actualizar, onchange:e => st.actualizar = e.target.checked})),
        h('div', {class:'total'}, h('span', {}, 'Total'), tot), h('button', {class:'btn', onclick:guardar}, 'Guardar la compra'));
      tot.textContent = C.dinero(total(), st.moneda);
    };
    const tot = h('b', {class:'num'});
    async function guardar(){
      const lineas = []; for(const l of st.lineas){
        if(!l.nombre.trim() && !l.qty && !l.costo) continue;
        const q = C.aMilesimas(l.qty), c = C.aCentavos(l.costo);
        if(!l.nombre.trim() || isNaN(q) || q <= 0 || isNaN(c) || c < 0){ aviso('Revisa el nombre, la cantidad y lo pagado de «' + (l.nombre || 'un artículo') + '».', true); return; }
        lineas.push({nombre:l.nombre.trim(), medida:l.medida, qtyMilli:q, costoCents:c});
      }
      if(!lineas.length){ aviso('Añade al menos un artículo.', true); return; }
      let tasa = st.moneda === 'CUP' ? 100 : C.aCentavos(st.tasa || (N.tasas[st.moneda] ? String(N.tasas[st.moneda] / 100) : ''));
      if(!tasa || isNaN(tasa)){ aviso('Pon cuántos pesos vale 1 ' + st.moneda + '.', true); return; }
      const totalC = lineas.reduce((s, l) => s + l.costoCents, 0);
      await ctx.db.put('eventos', {id:C.uid(), clase:'compra', fecha:st.fecha, proveedor:st.proveedor.trim(), moneda:st.moneda, tasaCents:tasa, lineas, totalCents:totalC, totalCup:C.aCup(totalC, tasa), ts:Date.now()});
      let act = 0;
      if(st.actualizar) for(const l of lineas){ for(const p of N.productos) if(clave(p.nombre, p.medida) === clave(l.nombre, l.medida) && l.costoCents > 0){ p.costoCents = Math.round(l.costoCents * 1000 / l.qtyMilli); p.costoMoneda = st.moneda; act++; } }
      if(act) await ctx.guardarN();
      cerrar(); aviso('Compra guardada' + (act ? ' y costo de ' + act + ' producto' + (act > 1 ? 's' : '') + ' actualizado' : '')); ctx.pintar();
    }
    draw(); return cuerpo;
  });
}

/* ================= GASTOS ================= */
export async function vGastos(ctx){
  const N = ctx.N; const m = mes(C.hoy()); const pun = (await eventos(ctx.db, 'gasto')).filter(g => mes(g.fecha) === m).reverse();
  const fijos = N.gastos.reduce((s, g) => s + (g.montoCents || 0), 0); const totPun = pun.reduce((s, g) => s + g.montoCents, 0);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Gastos'),
    h('div', {class:'card'}, h('h3', {}, 'Gastos fijos del mes'), h('p', {class:'ayuda'}, 'Lo que se paga aunque no se venda nada.'),
      N.gastos.map(g => h('div', {class:'lin'}, h('span', {}, h('b', {}, g.nombre), h('div', {class:'d'}, (g.ambito || 'sin decir de quién es') + (g.puestoId ? ' · ' + ctx.nomPuesto(g.puestoId) : ''))), h('span', {}, h('b', {class:'num'}, C.dinero(g.montoCents)), ' ', h('button', {class:'enlace', onclick:() => editarGasto(ctx, g)}, 'Editar')))),
      h('div', {class:'lin'}, h('b', {}, 'Suman al mes'), h('b', {class:'num'}, C.dinero(fijos))), h('div', {class:'lin'}, h('span', {}, 'Por día (entre 30)'), h('b', {class:'num'}, C.dinero(Math.round(fijos / 30)))),
      h('button', {class:'btn suave', onclick:() => editarGasto(ctx, {id:C.uid(), nombre:'', montoCents:0, ambito:'', puestoId:''}, true)}, '+ Gasto fijo')),
    h('div', {class:'card'}, h('h3', {}, 'Gastos de este mes'), h('p', {class:'ayuda'}, 'Hielo, bolsas, arreglos, mensajero… lo que sale en el día.'),
      pun.map(g => h('div', {class:'lin'}, h('span', {}, h('b', {}, g.concepto), h('div', {class:'d'}, C.fechaBonita(g.fecha) + (g.puestoId ? ' · ' + ctx.nomPuesto(g.puestoId) : ''))), h('span', {}, h('b', {class:'num'}, C.dinero(g.montoCents)), ' ', h('button', {class:'enlace', onclick:async () => { await ctx.db.del('eventos', g.id); ctx.pintar(); }}, 'Quitar')))),
      pun.length ? h('div', {class:'lin'}, h('b', {}, 'Suman'), h('b', {class:'num'}, C.dinero(totPun))) : h('p', {class:'ayuda'}, 'Todavía no hay gastos este mes.'),
      h('button', {class:'btn', onclick:() => nuevoGastoDia(ctx)}, '+ Anotar un gasto')));
}
function editarGasto(ctx, g, nuevo){
  const N = ctx.N; const e = Object.assign({}, g); const AMB = ['De todo el local', 'De cada puesto', 'De un solo puesto'];
  hoja(nuevo ? 'Nuevo gasto fijo' : g.nombre, cerrar => h('div', {}, campo('Gasto', h('input', {value:e.nombre, oninput:x => e.nombre = x.target.value})),
    campo('Pesos al mes', h('input', {inputmode:'decimal', value:e.montoCents ? String(e.montoCents / 100) : '', oninput:x => e.__m = x.target.value})),
    campo('¿De quién es?', sel(ctx, AMB, e.ambito, v => e.ambito = v, 'No sé')), campo('Si es de un solo puesto, ¿cuál?', sel(ctx, N.puestos.map(p => [p.id, p.nombre]), e.puestoId, v => e.puestoId = v, '—')),
    h('button', {class:'btn', onclick:async () => { const m = e.__m != null ? C.aCentavos(e.__m) : e.montoCents; if(!e.nombre.trim() || isNaN(m) || m < 0){ aviso('Revisa el nombre y el monto', true); return; }
      e.nombre = e.nombre.trim(); e.montoCents = m; delete e.__m; const i = N.gastos.findIndex(x => x.id === e.id); if(i >= 0) N.gastos[i] = e; else N.gastos.push(e); await ctx.guardarN(); cerrar(); ctx.pintar(); }}, 'Guardar'),
    nuevo ? null : h('button', {class:'btn suave', onclick:async () => { N.gastos = N.gastos.filter(x => x.id !== g.id); await ctx.guardarN(); cerrar(); ctx.pintar(); }}, 'Quitar')));
}
function nuevoGastoDia(ctx){
  const N = ctx.N; const e = {fecha:C.hoy(), concepto:'', monto:'', puestoId:''};
  hoja('Nuevo gasto', cerrar => h('div', {}, campo('Fecha', h('input', {type:'date', value:e.fecha, onchange:x => e.fecha = x.target.value || C.hoy()})), campo('¿En qué?', h('input', {placeholder:'Hielo, bolsas, mensajero…', oninput:x => e.concepto = x.target.value})),
    campo('Pesos', h('input', {inputmode:'decimal', placeholder:'0', oninput:x => e.monto = x.target.value})), campo('¿De qué puesto?', sel(ctx, N.puestos.map(p => [p.id, p.nombre]), e.puestoId, v => e.puestoId = v, 'De todo el negocio')),
    h('button', {class:'btn', onclick:async () => { const m = C.aCentavos(e.monto); if(!e.concepto.trim() || isNaN(m) || m <= 0){ aviso('Revisa en qué fue y cuánto', true); return; }
      await ctx.db.put('eventos', {id:C.uid(), clase:'gasto', fecha:e.fecha, concepto:e.concepto.trim(), montoCents:m, puestoId:e.puestoId, ts:Date.now()}); cerrar(); ctx.pintar(); }}, 'Guardar')));
}

/* ================= ALMACÉN DE CASA ================= */
export async function vCasa(ctx){
  const sal = await casaSaldos(ctx.db, ctx.N);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Almacén de casa'), h('p', {class:'ayuda'}, 'Lo que compras menos lo que entregas a los puestos, la merma y los ajustes del conteo.'),
    sal.length ? h('div', {class:'card tabla'}, h('table', {}, h('thead', {}, h('tr', {}, ['Artículo', 'Compró', 'Entregó', 'Merma', 'Ajuste', 'Hay'].map(t => h('th', {}, t)))),
      h('tbody', {}, sal.map(x => h('tr', {}, h('td', {}, x.nombre + ' (' + C.MEDIDAS[x.medida].p + ')'), h('td', {class:'num'}, C.cantidad(x.entra)), h('td', {class:'num'}, C.cantidad(x.sale)), h('td', {class:'num'}, C.cantidad(x.merma)), h('td', {class:'num'}, C.cantidad(x.ajuste)), h('td', {class:'num ' + (x.saldo < 0 ? 'mal' : '')}, C.cantidad(x.saldo))))))) : h('div', {class:'card'}, 'Todavía no hay nada. Registra compras o pon lo que ya tienes.'),
    sal.some(x => x.saldo < 0) ? h('div', {class:'card aviso-c'}, 'Hay artículos en negativo: entregaste más de lo que anotaste como comprado. Registra la compra que falta o pon lo que ya tenías.') : null,
    h('button', {class:'btn', onclick:() => ctx.ir('conteo')}, 'Contar el almacén (sábado)'), h('button', {class:'btn suave', onclick:() => existenciaInicial(ctx)}, '+ Poner lo que ya tengo'));
}
function existenciaInicial(ctx){
  const e = {nombre:'', medida:'libra', qty:''};
  hoja('Lo que ya tengo', cerrar => h('div', {}, campo('Artículo', h('input', {placeholder:'Pollo, harina…', oninput:x => e.nombre = x.target.value})), h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cantidad', h('input', {inputmode:'decimal', oninput:x => e.qty = x.target.value}))),
    h('div', {style:'flex:1'}, campo('Medida', sel(ctx, Object.keys(C.MEDIDAS).map(k => [k, C.MEDIDAS[k].p]), e.medida, v => e.medida = v)))),
    h('button', {class:'btn', onclick:async () => { const q = C.aMilesimas(e.qty); if(!e.nombre.trim() || isNaN(q) || q <= 0){ aviso('Revisa el nombre y la cantidad', true); return; }
      await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:C.hoy(), clave:clave(e.nombre, e.medida), nombre:e.nombre.trim(), medida:e.medida, difMilli:q, motivo:'Existencia inicial', ts:Date.now()}); cerrar(); ctx.pintar(); }}, 'Guardar')));
}

/* ================= CONTEO (casa y puestos) ================= */
const stC = {donde:'casa', cont:{}};
export async function vConteo(ctx){
  const N = ctx.N; const opciones = [['casa', 'Casa'], ...N.puestos.map(p => [p.id, p.nombre])];
  let filas = [];
  if(stC.donde === 'casa'){ const s = await casaSaldos(ctx.db, N); filas = s.map(x => ({id:x.clave, nombre:x.nombre, medida:x.medida, esperado:x.saldo})); }
  else {
    const cs = (await cierresUltimos(ctx.db)).filter(c => c.puestoId === stC.donde).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    if(cs) filas = Object.entries(cs.restante || {}).map(([id, r]) => { const p = N.productos.find(x => x.id === id); return p ? {id, nombre:p.nombre, medida:p.medida, esperado:r.entregado - r.vendido} : null; }).filter(Boolean);
  }
  const ultimos = (await eventos(ctx.db, 'conteo')).slice(-5).reverse();
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Conteo'), h('p', {class:'ayuda'}, 'Cuenta lo que hay de verdad y la aplicación te dice qué falta o qué sobra. En los puestos se compara con el último cierre.'),
    h('div', {class:'opts'}, opciones.map(([v, t]) => h('button', {class:'op', 'aria-pressed':stC.donde === v, onclick:() => { stC.donde = v; stC.cont = {}; ctx.pintar(); }}, t))),
    filas.length ? filas.map(f => h('div', {class:'card'}, h('div', {class:'fila'}, h('div', {}, h('b', {}, f.nombre), h('div', {class:'ayuda num'}, 'Debería haber ' + C.cantidad(f.esperado) + ' ' + C.nombreMedida(f.medida, f.esperado))),
      h('input', {inputmode:'decimal', placeholder:'Hay', style:'max-width:110px;text-align:right', value:stC.cont[f.id] || '', 'aria-label':'Cuántos hay de ' + f.nombre, oninput:e => { stC.cont[f.id] = e.target.value; }})))) : h('div', {class:'card'}, stC.donde === 'casa' ? 'No hay artículos en el almacén todavía.' : 'Este puesto no tiene un cierre con cantidades.'),
    filas.length ? h('button', {class:'btn', onclick:() => guardarConteo(ctx, filas)}, 'Guardar el conteo') : null,
    h('h2', {}, 'Últimos conteos'), ultimos.length ? ultimos.map(c => h('div', {class:'card'}, h('b', {}, C.fechaBonita(c.fecha) + ' · ' + (c.donde === 'casa' ? 'Casa' : ctx.nomPuesto(c.donde))),
      c.items.map(i => h('div', {class:'lin'}, h('span', {}, i.nombre), h('b', {class:'num ' + (i.dif === 0 ? 'bien' : 'mal')}, i.dif === 0 ? 'Cuadra' : (i.dif < 0 ? 'Faltan ' : 'Sobran ') + C.cantidad(Math.abs(i.dif))))))) : h('div', {class:'card'}, 'Todavía no hay conteos.'));
}
async function guardarConteo(ctx, filas){
  const items = []; for(const f of filas){ const raw = stC.cont[f.id]; if(raw === undefined || raw === '') continue; const m = C.aMilesimas(raw); if(isNaN(m) || m < 0){ aviso('Revisa la cantidad de ' + f.nombre, true); return; } items.push({id:f.id, nombre:f.nombre, medida:f.medida, esperado:f.esperado, contado:m, dif:m - f.esperado}); }
  if(!items.length){ aviso('Pon al menos una cantidad.', true); return; }
  await ctx.db.put('eventos', {id:C.uid(), clase:'conteo', fecha:C.hoy(), donde:stC.donde, items, ts:Date.now()});
  if(stC.donde === 'casa') for(const i of items) if(i.dif !== 0) await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:C.hoy(), clave:i.id, nombre:i.nombre, medida:i.medida, difMilli:i.dif, motivo:'Conteo', ts:Date.now()});
  const malos = items.filter(i => i.dif !== 0).length; stC.cont = {};
  aviso(malos ? malos + ' diferencia' + (malos > 1 ? 's' : '') + ' anotada' + (malos > 1 ? 's' : '') + (stC.donde === 'casa' ? ' y el almacén quedó ajustado' : '') : 'Todo cuadra', malos > 0); ctx.pintar();
}

/* ================= MERMA ================= */
export async function vMerma(ctx){
  const lista = (await eventos(ctx.db, 'merma')).slice(-30).reverse();
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Merma'), h('p', {class:'ayuda'}, 'Lo que se echa a perder, se rompe o se pierde. Solo lo anotas tú.'),
    h('button', {class:'btn', onclick:() => nuevaMerma(ctx)}, '+ Anotar merma'),
    h('h2', {}, 'Últimas'), lista.length ? lista.map(m => h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, m.nombre + ' · ' + C.cantidad(m.qtyMilli) + ' ' + C.nombreMedida(m.medida, m.qtyMilli)), h('div', {class:'ayuda'}, C.fechaBonita(m.fecha) + ' · ' + (m.donde === 'casa' ? 'Casa' : ctx.nomPuesto(m.donde)) + ' · ' + m.motivo)),
      h('button', {class:'enlace', onclick:async () => { await ctx.db.del('eventos', m.id); ctx.pintar(); }}, 'Quitar')))) : h('div', {class:'card'}, 'Todavía no hay merma anotada.'));
}
function nuevaMerma(ctx){
  const N = ctx.N; const st = {fecha:C.hoy(), donde:'casa', art:'', nombre:'', medida:'libra', qty:'', motivo:'Se echó a perder'};
  hoja('Anotar merma', cerrar => {
    const cuerpo = h('div');
    const draw = () => {
      const arts = st.donde === 'casa' ? [...new Map(N.productos.map(p => [clave(p.nombre, p.medida), p])).values()] : N.productos.filter(p => p.puestoId === st.donde);
      cuerpo.replaceChildren(campo('Fecha', h('input', {type:'date', value:st.fecha, onchange:e => st.fecha = e.target.value || C.hoy()})),
        campo('¿Dónde pasó?', sel(ctx, [['casa', 'En la casa'], ...N.puestos.map(p => [p.id, p.nombre])], st.donde, v => { st.donde = v; st.art = ''; draw(); })),
        campo('¿Qué se perdió?', sel(ctx, arts.map(p => [p.id, p.nombre + ' (' + C.MEDIDAS[p.medida].p + ')']), st.art, v => { const p = arts.find(x => x.id === v); st.art = v; if(p){ st.nombre = p.nombre; st.medida = p.medida; } }, 'Elige…')),
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cantidad', h('input', {inputmode:'decimal', value:st.qty, oninput:e => st.qty = e.target.value}))), h('div', {style:'flex:1'}, campo('Motivo', sel(ctx, ['Se echó a perder', 'Se rompió', 'Se cayó', 'Se perdió', 'Otro'], st.motivo, v => st.motivo = v)))),
        h('button', {class:'btn', onclick:async () => { const q = C.aMilesimas(st.qty); if(!st.art){ aviso('Elige qué se perdió', true); return; } if(isNaN(q) || q <= 0){ aviso('Revisa la cantidad', true); return; }
          await ctx.db.put('eventos', {id:C.uid(), clase:'merma', fecha:st.fecha, donde:st.donde, nombre:st.nombre, medida:st.medida, qtyMilli:q, motivo:st.motivo, ts:Date.now()}); cerrar(); aviso('Merma anotada'); ctx.pintar(); }}, 'Guardar'));
    };
    draw(); return cuerpo;
  });
}

/* ================= FIADO ================= */
export async function vFiado(ctx){
  const lista = await fiadoPendiente(ctx.db); const total = lista.reduce((s, x) => s + Math.max(0, x.debe), 0);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Fiado'), h('div', {class:'total'}, h('span', {}, 'Te deben'), h('b', {class:'num'}, C.dinero(total))),
    lista.length ? lista.map(x => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, x.nombre), h('b', {class:'num ' + (x.debe > 0 ? 'mal' : 'bien')}, x.debe > 0 ? 'Debe ' + C.dinero(x.debe) : 'Al día')),
      h('div', {class:'ayuda'}, 'Fiado ' + C.dinero(x.fiado) + ' · pagado ' + C.dinero(x.pagado)),
      h('button', {class:'enlace', onclick:() => detalleFiado(ctx, x)}, 'Ver movimientos'), ctx.SOLO ? null : h('button', {class:'btn chico', style:'margin-left:10px', onclick:() => pagoFiado(ctx, x)}, 'Registrar un pago'))) : h('div', {class:'card'}, 'Nadie debe nada: no hay ventas fiadas en los cierres recibidos.'));
}
function detalleFiado(ctx, x){ hoja(x.nombre, () => h('div', {}, x.mov.sort((a, b) => a.fecha.localeCompare(b.fecha)).map(m => h('div', {class:'lin'}, h('span', {}, C.fechaBonita(m.fecha), h('div', {class:'d'}, m.detalle)), h('b', {class:'num ' + (m.tipo === 'pago' ? 'bien' : '')}, (m.tipo === 'pago' ? '-' : '') + C.dinero(m.cup)))))); }
function pagoFiado(ctx, x){
  const e = {monto:''};
  hoja('Pago de ' + x.nombre, cerrar => h('div', {}, h('p', {class:'ayuda'}, 'Debe ' + C.dinero(x.debe) + '.'), campo('Cuánto pagó (pesos)', h('input', {inputmode:'decimal', placeholder:String(Math.max(0, x.debe) / 100), oninput:v => e.monto = v.target.value})),
    h('button', {class:'btn', onclick:async () => { const m = C.aCentavos(e.monto); if(isNaN(m) || m <= 0){ aviso('Revisa el monto', true); return; }
      if(m > x.debe && !(await confirmar('Pagó más de lo que debía', 'Debía ' + C.dinero(x.debe) + ' y anotas ' + C.dinero(m) + '.', 'Anotar igual', 'Corregir'))) return;
      await ctx.db.put('eventos', {id:C.uid(), clase:'abono', fecha:C.hoy(), clave:x.clave, nombre:x.nombre, montoCents:m, ts:Date.now()}); cerrar(); aviso('Pago anotado'); ctx.pintar(); }}, 'Guardar')));
}
