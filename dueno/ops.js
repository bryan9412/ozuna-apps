/* Operación del dueño: traspasos, compras, gastos, almacén de casa, merma, conteo y fiado. */
import * as C from '../shared/core.js';
import { h, montar, aviso, hoja, confirmar, campo } from '../shared/ui.js';
import { clave, cierresUltimos, eventos, casaSaldos, fiadoPendiente, actualizarCostos } from './datos.js';

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
        h('div', {class:'ayuda'}, c.lineas.map(l => l.nombre + ' ' + C.cantidad(l.qtyMilli) + (l.paquetes ? ' (' + C.cantidad(l.paquetes) + ' paq.)' : '')).join(', ')), c.moneda !== 'CUP' ? h('div', {class:'ayuda num'}, C.dinero(c.totalCents) + ' ' + c.moneda + ' a ' + C.dinero(c.tasaCents)) : null),
      h('b', {class:'num'}, C.dinero(c.totalCup))), h('button', {class:'enlace', onclick:async () => { if(await confirmar('¿Quitar esta compra?', 'Se descuenta del almacén de casa y de los totales.', 'Quitar', 'No')){ await ctx.borrarEvento(c.id); await actualizarCostos(ctx.db, N, ctx.guardarN); ctx.pintar(); } }}, 'Quitar'))) : h('div', {class:'card'}, 'Todavía no registraste compras.'));
}
const lineaNueva = () => ({nombre:'', medida:'libra', qty:'', costo:'', paqLb:'', hay:''});
/* Resumen después de guardar: cómo cambió el costo promedio y si el precio de venta todavía alcanza. */
function resumenCostos(ctx, cambios){
  const N = ctx.N;
  hoja('Compra guardada', cerrar => {
    if(!cambios.length) return h('div', {}, h('p', {}, 'Listo. El costo de tus productos no cambió.'), h('button', {class:'btn', onclick:cerrar}, 'Seguir'));
    return h('div', {}, h('p', {class:'ayuda'}, 'El costo es el promedio de lo que compraste, mezclado con lo que todavía tienes en casa.'),
      cambios.map(c => {
        const p = c.producto; const precio = C.precioEnCup(p, N.tasas, N.redondeo); const com = N.personas.filter(x => x.puestoId === p.puestoId && /porciento/.test(x.base || 'porciento')).reduce((s, x) => s + (C.num(x.pct) || 0), 0);
        const gana = precio ? precio - c.despues : null; const pct = precio ? Math.round(gana / precio * 100) : null;
        const den = 1 - com / 100 - 0.30; const sug = den > 0 ? Math.ceil(c.despues / den / (N.redondeo || 500)) * (N.redondeo || 500) : null;
        return h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, p.nombre), h('div', {class:'ayuda'}, ctx.nomPuesto(p.puestoId) + ' · por ' + C.MEDIDAS[p.medida].s)),
            h('div', {style:'text-align:right'}, h('div', {class:'ayuda num'}, c.antes != null ? C.dinero(c.antes) + ' →' : 'nuevo →'), h('b', {class:'num'}, C.dinero(c.despues)))),
          precio ? h('div', {class:'lin'}, h('span', {}, 'Lo vendes a ' + C.dinero(precio)), h('b', {class:'num ' + (gana > 0 ? 'bien' : 'mal')}, 'ganas ' + C.dinero(gana) + ' (' + pct + ' %)')) : null,
          sug && precio && precio < sug ? h('div', {class:'aviso-c card', style:'margin:8px 0 0'}, 'Para ganar el 30 % que quieres, súbelo a ' + C.dinero(sug) + '.') : null,
          h('button', {class:'enlace', onclick:() => { cerrar(); ctx.editarProducto(p); }}, 'Cambiar el precio de venta'));
      }), h('button', {class:'btn', onclick:cerrar}, 'Seguir'));
  });
}
async function nuevaCompra(ctx){
  const N = ctx.N; const saldos = await casaSaldos(ctx.db, N);
  const st = {fecha:C.hoy(), proveedor:'', moneda:'CUP', tasa:'', lineas:[lineaNueva()]};
  const nombres = [...new Set([...N.productos.map(p => p.nombre), ...saldos.map(x => x.nombre)])];
  hoja('Nueva compra', cerrar => {
    const cuerpo = h('div'); const dl = h('datalist', {id:'lista-art'}, nombres.map(n => h('option', {value:n})));
    const total = () => st.lineas.reduce((s, l) => { const c = C.aCentavos(l.costo); return s + (isNaN(c) ? 0 : c); }, 0);
    const tot = h('b', {class:'num'});
    const draw = () => {
      const monedas = ['CUP', ...Object.keys(N.tasas)];
      cuerpo.replaceChildren(dl,
        campo('Fecha', h('input', {type:'date', value:st.fecha, onchange:e => st.fecha = e.target.value || C.hoy()})),
        campo('¿Dónde compraste?', h('input', {value:st.proveedor, placeholder:'Opcional', oninput:e => st.proveedor = e.target.value})),
        campo('Pagaste en', sel(ctx, monedas, st.moneda, v => { st.moneda = v; st.tasa = ''; draw(); })),
        st.moneda !== 'CUP' ? campo('Pesos por cada ' + st.moneda, h('input', {inputmode:'decimal', value:st.tasa || (N.tasas[st.moneda] ? String(N.tasas[st.moneda] / 100) : ''), oninput:e => st.tasa = e.target.value}), 'Se usa para pasar el gasto a pesos.') : null,
        h('h3', {style:'margin-top:14px'}, 'Qué compraste'),
        ...st.lineas.map((l, i) => {
          const x = saldos.find(y => y.clave === clave(l.nombre, l.medida) || (y.nombre.trim().toLowerCase() === l.nombre.trim().toLowerCase() && l.nombre.trim()));
          const info = h('div', {class:'ayuda'}); const act = () => { const y = saldos.find(z => z.nombre.trim().toLowerCase() === l.nombre.trim().toLowerCase() && l.nombre.trim()); info.textContent = y ? 'En casa hay ' + C.cantidad(y.saldo) + ' ' + C.nombreMedida(y.medida, y.saldo) + (y.avg ? ' · costo promedio ' + C.dinero(y.avg) + ' por ' + C.MEDIDAS[y.medida].s : '') : ''; }; act(); void x;
          return h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, 'Artículo ' + (i + 1)), st.lineas.length > 1 ? h('button', {class:'x', 'aria-label':'Quitar', onclick:() => { st.lineas.splice(i, 1); draw(); }}, '✕') : null),
            campo('Nombre', h('input', {value:l.nombre, list:'lista-art', oninput:e => { l.nombre = e.target.value; act(); }, onchange:e => { const p = N.productos.find(y => y.nombre.toLowerCase() === e.target.value.trim().toLowerCase()); if(p){ l.medida = p.medida; draw(); } }, placeholder:'Pollo, harina…'})), info,
            h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cantidad', h('input', {inputmode:'decimal', value:l.qty, oninput:e => l.qty = e.target.value}))), h('div', {style:'flex:1'}, campo('Medida', sel(ctx, Object.keys(C.MEDIDAS).map(k => [k, C.MEDIDAS[k].p]), l.medida, v => { l.medida = v; draw(); })))),
            l.medida === 'paquete' ? campo('Si lo abres y lo vendes por libras: ¿cuántas libras trae cada paquete?', h('input', {inputmode:'decimal', value:l.paqLb, placeholder:'Déjalo vacío si lo vendes por paquete', oninput:e => l.paqLb = e.target.value}), 'Entra al almacén ya en libras y el costo sale por libra.') : null,
            campo('Lo que pagaste por esto (en ' + st.moneda + ')', h('input', {inputmode:'decimal', value:l.costo, oninput:e => { l.costo = e.target.value; tot.textContent = C.dinero(total(), st.moneda); }})),
            campo('Hay en total ahora (opcional)', h('input', {inputmode:'decimal', value:l.hay, placeholder:'Cuenta y pon cuánto hay en casa', oninput:e => l.hay = e.target.value}), 'Si no coincide con lo que dice el sistema, se ajusta solo.'));
        }),
        h('button', {class:'btn suave', onclick:() => { st.lineas.push(lineaNueva()); draw(); }}, '+ Otro artículo'),
        h('div', {class:'total'}, h('span', {}, 'Total'), tot), h('button', {class:'btn', onclick:guardar}, 'Guardar la compra'));
      tot.textContent = C.dinero(total(), st.moneda);
    };
    async function guardar(){
      const lineas = []; const hay = [];
      for(const l of st.lineas){
        if(!l.nombre.trim() && !l.qty && !l.costo) continue;
        const q = C.aMilesimas(l.qty), c = C.aCentavos(l.costo);
        if(!l.nombre.trim() || isNaN(q) || q <= 0 || isNaN(c) || c < 0){ aviso('Revisa el nombre, la cantidad y lo pagado de «' + (l.nombre || 'un artículo') + '».', true); return; }
        let medida = l.medida, qtyMilli = q, paquetes = null;
        if(l.medida === 'paquete' && l.paqLb && l.paqLb.trim()){ const lb = C.num(l.paqLb); if(isNaN(lb) || lb <= 0){ aviso('Revisa las libras de cada paquete de «' + l.nombre + '».', true); return; } medida = 'libra'; paquetes = q; qtyMilli = Math.round(q * lb); }
        lineas.push({nombre:l.nombre.trim(), medida, qtyMilli, costoCents:c, paquetes:paquetes || undefined});
        if(l.hay && l.hay.trim()){ const h2 = C.aMilesimas(l.hay); if(isNaN(h2) || h2 < 0){ aviso('Revisa cuánto hay en total de «' + l.nombre + '».', true); return; } hay.push({nombre:l.nombre.trim(), medida, hay:h2}); }
      }
      if(!lineas.length){ aviso('Añade al menos un artículo.', true); return; }
      const tasa = st.moneda === 'CUP' ? 100 : C.aCentavos(st.tasa || (N.tasas[st.moneda] ? String(N.tasas[st.moneda] / 100) : ''));
      if(!tasa || isNaN(tasa)){ aviso('Pon cuántos pesos vale 1 ' + st.moneda + '.', true); return; }
      const totalC = lineas.reduce((s, l) => s + l.costoCents, 0);
      await ctx.db.put('eventos', {id:C.uid(), clase:'compra', fecha:st.fecha, proveedor:st.proveedor.trim(), moneda:st.moneda, tasaCents:tasa, lineas, totalCents:totalC, totalCup:C.aCup(totalC, tasa), ts:Date.now()});
      if(hay.length){
        const s2 = await casaSaldos(ctx.db, N);
        for(const x of hay){ const a = s2.find(y => y.clave === clave(x.nombre, x.medida)); const dif = x.hay - (a ? a.saldo : 0);
          if(dif !== 0) await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:st.fecha, clave:clave(x.nombre, x.medida), nombre:x.nombre, medida:x.medida, difMilli:dif, motivo:'Ajuste al comprar', ts:Date.now() + 1}); }
      }
      const cambios = await actualizarCostos(ctx.db, N, ctx.guardarN);
      cerrar(); ctx.pintar(); resumenCostos(ctx, cambios);
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
      pun.map(g => h('div', {class:'lin'}, h('span', {}, h('b', {}, g.concepto), h('div', {class:'d'}, C.fechaBonita(g.fecha) + (g.puestoId ? ' · ' + ctx.nomPuesto(g.puestoId) : ''))), h('span', {}, h('b', {class:'num'}, C.dinero(g.montoCents)), ' ', h('button', {class:'enlace', onclick:async () => { await ctx.borrarEvento(g.id); ctx.pintar(); }}, 'Quitar')))),
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
  const fila = x => h('button', {class:'vrow', style:'grid-template-columns:minmax(0,1fr) auto auto', onclick:() => detalleArticulo(ctx, x, sal)},
    h('div', {class:'vd'}, h('b', {}, x.nombre), h('span', {class:'ayuda'}, 'por ' + C.MEDIDAS[x.medida].s)),
    h('div', {class:'vm'}, h('b', {class:'num ' + (x.saldo < 0 ? 'mal' : '')}, C.cantidad(x.saldo)), h('span', {class:'ayuda'}, C.nombreMedida(x.medida, x.saldo))),
    h('div', {class:'vm', style:'min-width:70px'}, h('b', {class:'num'}, x.avg ? C.dinero(x.avg) : '—'), h('span', {class:'ayuda'}, 'costo prom.')));
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Almacén de casa'), h('p', {class:'ayuda'}, 'Lo que compras menos lo que entregas, la merma y los ajustes. Toca un artículo para corregirlo o abrirlo.'),
    sal.length ? h('div', {class:'vlista'}, sal.map(fila)) : h('div', {class:'card'}, 'Todavía no hay nada. Registra compras o pon lo que ya tienes.'),
    sal.some(x => x.saldo < 0) ? h('div', {class:'card aviso-c', style:'margin-top:12px'}, 'Hay artículos en negativo: entregaste más de lo que anotaste. Toca el artículo y corrige cuánto hay de verdad.') : null,
    h('button', {class:'btn', onclick:() => ctx.ir('conteo')}, 'Contar el almacén (sábado)'), h('button', {class:'btn suave', onclick:() => abrirPaquete(ctx, sal)}, 'Abrir un paquete (pasarlo a libras)'), h('button', {class:'btn suave', onclick:() => existenciaInicial(ctx)}, '+ Poner lo que ya tengo'));
}
function detalleArticulo(ctx, x, sal){
  hoja(x.nombre, cerrar => {
    const q = h('input', {inputmode:'decimal', placeholder:'Cuánto hay de verdad', 'aria-label':'Cuánto hay de verdad'});
    return h('div', {}, h('div', {class:'card'}, [['Compró', x.entra], ['Entregó a los puestos', x.sale], ['Merma', x.merma], ['Ajustes', x.ajuste]].map(([t, v]) => h('div', {class:'lin'}, h('span', {}, t), h('b', {class:'num'}, C.cantidad(v)))),
        h('div', {class:'lin'}, h('b', {}, 'Hay ahora'), h('b', {class:'num ' + (x.saldo < 0 ? 'mal' : '')}, C.cantidad(x.saldo) + ' ' + C.nombreMedida(x.medida, x.saldo))), x.avg ? h('div', {class:'lin'}, h('span', {}, 'Costo promedio'), h('b', {class:'num'}, C.dinero(x.avg) + ' por ' + C.MEDIDAS[x.medida].s)) : null),
      campo('Si no coincide, ¿cuánto hay de verdad? (' + C.nombreMedida(x.medida, 2000) + ')', q, 'El sistema se ajusta solo a lo que pongas.'),
      h('button', {class:'btn', onclick:async () => { const v = C.aMilesimas(q.value); if(isNaN(v) || v < 0){ aviso('Pon cuánto hay de verdad', true); return; }
        const dif = v - x.saldo; if(dif === 0){ aviso('Ya coincide.'); return; }
        await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:C.hoy(), clave:x.clave, nombre:x.nombre, medida:x.medida, difMilli:dif, motivo:'Corrección', ts:Date.now()}); cerrar(); aviso('Ajustado: ' + (dif > 0 ? '+' : '') + C.cantidad(dif)); ctx.pintar(); }}, 'Corregir la existencia'),
      h('button', {class:'btn suave', onclick:() => { cerrar(); abrirPaquete(ctx, sal, x); }}, 'Abrirlo / pasarlo a otra medida'));
  });
}
/* Abrir un paquete: lo que había en paquetes pasa a libras (o kilos…). El costo se traslada: lo que costaban los paquetes se reparte entre las libras que salen. */
function abrirPaquete(ctx, sal, origen){
  const e = {origen:origen ? origen.clave : '', n:'', cada:'', destMedida:'libra', destNombre:origen ? origen.nombre : '', pierde:''};
  hoja('Abrir un paquete', cerrar => {
    const cuerpo = h('div');
    const draw = () => {
      const o = sal.find(x => x.clave === e.origen);
      cuerpo.replaceChildren(h('p', {class:'ayuda'}, 'Por ejemplo: tienes 3 paquetes de pollo de 10 libras y los abres para venderlo por libras.'),
        campo('¿Qué abres?', sel(ctx, sal.filter(x => x.saldo > 0 || x.clave === e.origen).map(x => [x.clave, x.nombre + ' (' + C.cantidad(x.saldo) + ' ' + C.nombreMedida(x.medida, x.saldo) + ')']), e.origen, v => { e.origen = v; const y = sal.find(z => z.clave === v); if(y && !e.destNombre) e.destNombre = y.nombre; draw(); }, 'Elige…')),
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cuántos abres' + (o ? ' (' + C.nombreMedida(o.medida, 2000) + ')' : ''), h('input', {inputmode:'decimal', value:e.n, oninput:x => e.n = x.target.value}))), h('div', {style:'flex:1'}, campo('Cada uno trae', h('input', {inputmode:'decimal', value:e.cada, placeholder:'10', oninput:x => e.cada = x.target.value})))),
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Salen', sel(ctx, ['libra', 'kilo', 'unidad'].map(k => [k, C.MEDIDAS[k].p]), e.destMedida, v => e.destMedida = v))), h('div', {style:'flex:1'}, campo('Se pierde al abrir', h('input', {inputmode:'decimal', value:e.pierde, placeholder:'0', oninput:x => e.pierde = x.target.value})))),
        campo('Cómo se llama lo que sale', h('input', {value:e.destNombre, placeholder:'Pollo', oninput:x => e.destNombre = x.target.value}), 'Pon el mismo nombre del producto que vendes para que el costo le llegue.'),
        h('button', {class:'btn', onclick:guardar}, 'Abrir'));
    };
    async function guardar(){
      const o = sal.find(x => x.clave === e.origen); if(!o){ aviso('Elige qué abres.', true); return; }
      const n = C.aMilesimas(e.n), cada = C.num(e.cada), pierde = e.pierde.trim() ? C.num(e.pierde) : 0;
      if(isNaN(n) || n <= 0 || isNaN(cada) || cada <= 0 || isNaN(pierde) || pierde < 0 || !e.destNombre.trim()){ aviso('Revisa cuántos abres, cuánto trae cada uno y el nombre.', true); return; }
      const total = n / 1000 * cada - pierde; if(total <= 0){ aviso('Lo que se pierde no puede ser todo.', true); return; }
      if(n > o.saldo && !(await confirmar('Abres más de lo que dice el sistema', 'Dice que hay ' + C.cantidad(o.saldo) + ' y abres ' + C.cantidad(n) + '.', 'Abrir igual', 'Corregir'))) return;
      const costoTotal = (o.avg || 0) * n / 1000; const destMilli = Math.round(total * 1000); const unit = o.avg ? Math.round(costoTotal / total) : null;
      const f = C.hoy(), ts = Date.now(), claveD = clave(e.destNombre.trim(), e.destMedida);
      await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:f, clave:o.clave, nombre:o.nombre, medida:o.medida, difMilli:-n, motivo:'Abrir paquete', ts});
      await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:f, clave:claveD, nombre:e.destNombre.trim(), medida:e.destMedida, difMilli:destMilli, costoUnitCents:unit, motivo:'Abrir paquete', ts:ts + 1});
      const cambios = await actualizarCostos(ctx.db, ctx.N, ctx.guardarN);
      cerrar(); aviso('Listo: ' + C.cantidad(destMilli) + ' ' + C.nombreMedida(e.destMedida, destMilli) + ' de ' + e.destNombre.trim() + (unit ? ' a ' + C.dinero(unit) + ' cada una' : '')); ctx.pintar(); if(cambios.length) resumenCostos(ctx, cambios);
    }
    draw(); return cuerpo;
  });
}
function existenciaInicial(ctx){
  const e = {nombre:'', medida:'libra', qty:'', costo:''};
  hoja('Lo que ya tengo', cerrar => h('div', {}, campo('Artículo', h('input', {placeholder:'Pollo, harina…', oninput:x => e.nombre = x.target.value})), h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cantidad', h('input', {inputmode:'decimal', oninput:x => e.qty = x.target.value}))),
    h('div', {style:'flex:1'}, campo('Medida', sel(ctx, Object.keys(C.MEDIDAS).map(k => [k, C.MEDIDAS[k].p]), e.medida, v => e.medida = v)))),
    campo('Lo que te costó cada una (pesos, opcional)', h('input', {inputmode:'decimal', placeholder:'Si lo sabes', oninput:x => e.costo = x.target.value}), 'Sirve para calcular el costo promedio.'),
    h('button', {class:'btn', onclick:async () => { const q = C.aMilesimas(e.qty); const c = e.costo.trim() ? C.aCentavos(e.costo) : null; if(!e.nombre.trim() || isNaN(q) || q <= 0 || (c !== null && (isNaN(c) || c < 0))){ aviso('Revisa el nombre, la cantidad y el costo', true); return; }
      await ctx.db.put('eventos', {id:C.uid(), clase:'ajusteCasa', fecha:C.hoy(), clave:clave(e.nombre, e.medida), nombre:e.nombre.trim(), medida:e.medida, difMilli:q, costoUnitCents:c, motivo:'Existencia inicial', ts:Date.now()});
      await actualizarCostos(ctx.db, ctx.N, ctx.guardarN); cerrar(); ctx.pintar(); }}, 'Guardar')));
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
      h('button', {class:'enlace', onclick:async () => { await ctx.borrarEvento(m.id); ctx.pintar(); }}, 'Quitar')))) : h('div', {class:'card'}, 'Todavía no hay merma anotada.'));
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
