/* Ficha de costo de un producto (por ejemplo la pizza): solo lo que lleva TODA unidad. Lo opcional (jamón, queso extra…) se cobra aparte como agrego y no entra aquí.
   Cada ingrediente puede calcularse de dos formas y puede tener varios tipos (por ejemplo, varios quesos). El costo sale de tus compras si las hay. Sin impuestos. */
import * as C from '../shared/core.js';
import { h, aviso, hoja, campo } from '../shared/ui.js';
import { casaSaldos, buscarCosto } from './datos.js';

const UN = {gramo:{t:'m', f:1}, onza:{t:'m', f:28.3495}, libra:{t:'m', f:453.592}, kilo:{t:'m', f:1000}, ml:{t:'v', f:1}, litro:{t:'v', f:1000}, unidad:{t:'n', f:1}, lata:{t:'n', f:1}, paquete:{t:'n', f:1}};
const USO = {m:['gramo', 'onza', 'libra', 'kilo'], v:['ml', 'litro'], n:['unidad', 'lata', 'paquete']};
const NOMBRE = {gramo:'gramos', onza:'onzas', libra:'libras', kilo:'kilos', ml:'mililitros', litro:'litros', unidad:'unidades', lata:'latas', paquete:'paquetes'};
const unidadDe = m => ({libra:'libra', kilo:'kilo', unidad:'unidad', paquete:'paquete', porcion:'unidad', vaso:'unidad'}[m] || 'unidad');

/* Precio por unidad base (gramo, ml o unidad) en centavos de CUP. Si la fuente usa tus compras, sale del costo promedio. */
function precioBase(N, saldos, s, nombre){
  const manual = C.aCentavos(s.pago); const quiereAuto = s.usaCompras === true || (s.usaCompras === undefined && (isNaN(manual) || manual <= 0));
  if(quiereAuto){
    const x = buscarCosto(saldos, s.nombre || nombre);
    if(x){ const u = UN[unidadDe(x.medida)]; return {p:x.avg / u.f, t:u.t, auto:true, texto:'por ' + C.MEDIDAS[x.medida].s + ' según tus compras', porCompra:x.avg, medida:x.medida}; }
    if(s.usaCompras === true && (isNaN(manual) || manual <= 0)) return {err:'Todavía no hay compras de «' + (s.nombre || nombre || 'este ingrediente') + '»'};
  }
  const cq = C.num(s.compraQty); const a = UN[s.compraUnit];
  if(isNaN(manual) || manual <= 0) return {err:'Falta lo que pagaste'}; if(!(cq > 0) || !a) return {err:'Falta la cantidad comprada'};
  let cup = manual; if(s.moneda && s.moneda !== 'CUP'){ const t = N.tasas[s.moneda]; if(!t) return {err:'Falta el cambio de ' + s.moneda}; cup = C.aCup(manual, t); }
  return {p:cup / (cq * a.f), t:a.t, auto:false, unidadCompra:{cq, f:a.f}, cup};
}
/* Costo en centavos de CUP de lo que lleva UNA unidad del producto por este ingrediente. */
function costoIngrediente(N, saldos, i){
  const fuentes = (i.tipos && i.tipos.length) ? i.tipos : [i];
  const tot = fuentes.reduce((s, f) => s + (C.num(f.pct) > 0 ? C.num(f.pct) : 0), 0);
  let costo = 0, errores = [];
  fuentes.forEach(f => {
    const peso = i.tipos && i.tipos.length ? (tot > 0 ? (C.num(f.pct) > 0 ? C.num(f.pct) : 0) / tot : 1 / fuentes.length) : 1;
    const pb = precioBase(N, saldos, f, i.nombre); if(pb.err){ errores.push(pb.err); return; }
    let c;
    if(i.modo === 'rinde'){
      const r = C.num(i.rinde), cq = C.num(i.compraQty || f.compraQty), u = UN[i.compraUnit || f.compraUnit];
      if(!(r > 0)){ errores.push('Falta para cuántas alcanza'); return; } if(!(cq > 0) || !u){ errores.push('Falta de cuánto es una compra'); return; } if(u.t !== pb.t){ errores.push('Las medidas no se pueden comparar'); return; }
      c = pb.p * cq * u.f / r;
    } else {
      const uq = C.num(i.usoQty), b = UN[i.usoUnit]; if(!(uq > 0) || !b){ errores.push('Falta cuánto lleva'); return; } if(b.t !== pb.t){ errores.push('Las medidas no se pueden comparar'); return; }
      c = pb.p * uq * b.f;
    }
    costo += c * peso;
  });
  return {c:costo, err:errores[0]};
}

export async function abrirFicha(ctx, p, alGuardar){
  const N = ctx.N; const saldos = await casaSaldos(ctx.db, N);
  const pp = N.personas.filter(x => x.puestoId === p.puestoId && /porciento/.test(x.base || 'porciento')).reduce((s, x) => s + (C.num(x.pct) || 0), 0);
  const gastosMes = N.gastos.filter(g => !g.puestoId || g.puestoId === p.puestoId).reduce((s, g) => s + (g.montoCents || 0), 0);
  const f = Object.assign({ings:[], merma:'5', unidadesMes:'', gastosMes:String(gastosMes / 100), comision:String(pp), margen:'30'}, JSON.parse(JSON.stringify(p.ficha || {})));
  f.ings.forEach(i => { if(!i.modo) i.modo = 'lleva'; });
  hoja('Ficha de costo · ' + p.nombre, cerrar => {
    const cuerpo = h('div'); const res = h('div');
    const calc = () => {
      let directo = 0, errores = 0; for(const i of f.ings){ const r = costoIngrediente(N, saldos, i); if(r.err) errores++; directo += r.c || 0; }
      const conMerma = directo * (1 + (C.num(f.merma) || 0) / 100);
      const um = C.num(f.unidadesMes), gm = C.aCentavos(f.gastosMes);
      const indirecto = um > 0 && !isNaN(gm) ? gm / um : 0; const com = C.num(f.comision) || 0, mar = C.num(f.margen) || 0;
      const base = conMerma + indirecto, den = 1 - com / 100 - mar / 100;
      const r = (N.redondeo || 500); const sug = den > 0 ? Math.ceil(base / den / r) * r : NaN;
      return {directo, conMerma, indirecto, com, mar, base, sug, errores};
    };
    const pinta = () => { salidas.forEach(fn => fn()); const x = calc(); const actual = C.precioEnCup(p, N.tasas, N.redondeo);
      res.replaceChildren(h('div', {class:'card'}, h('h3', {}, 'Cuentas por cada ' + C.MEDIDAS[p.medida].s),
        [['Ingredientes', x.directo], ['Con lo que se pierde (' + (f.merma || 0) + ' %)', x.conMerma], ['Gastos del mes repartidos', x.indirecto]].map(([t, v]) => h('div', {class:'lin'}, h('span', {}, t), h('b', {class:'num'}, C.dinero(Math.round(v))))),
        h('div', {class:'lin'}, h('span', {}, 'Cuesta hacerla'), h('b', {class:'num'}, C.dinero(Math.round(x.base)))),
        h('div', {class:'lin'}, h('span', {}, 'Comisión del trabajador (' + x.com + ' % del precio)'), h('b', {class:'num'}, isNaN(x.sug) ? '—' : C.dinero(Math.round(x.sug * x.com / 100)))),
        h('div', {class:'lin'}, h('span', {}, 'Precio sugerido (' + x.mar + ' % de ganancia)'), h('b', {class:'num bien'}, isNaN(x.sug) ? 'Revisa los porcientos' : C.dinero(x.sug))),
        actual && !isNaN(x.sug) ? h('div', {class:'lin'}, h('span', {}, 'Hoy lo vendes a ' + C.dinero(actual)), h('b', {class:'num ' + (actual >= x.sug ? 'bien' : 'mal')}, actual >= x.sug ? 'Alcanza' : 'Te falta ' + C.dinero(x.sug - actual))) : null,
        x.errores ? h('p', {class:'mal'}, 'Hay ' + x.errores + (x.errores === 1 ? ' ingrediente incompleto' : ' ingredientes incompletos') + ': no se están contando bien.') : null));
    };
    const sel = (ops, v, fn, redraw) => { const s = h('select', {onchange:e => { fn(e.target.value); redraw ? draw() : pinta(); }}, ops.map(o => h('option', {value:Array.isArray(o) ? o[0] : o, selected:(Array.isArray(o) ? o[0] : o) === v}, Array.isArray(o) ? o[1] : o))); s.value = v; return s; };
    const num = (v, fn, ph) => h('input', {inputmode:'decimal', value:v == null ? '' : v, placeholder:ph || '', oninput:e => { fn(e.target.value); pinta(); }});
    const salidas = [];
    /* El bloque de precio de un ingrediente o de uno de sus tipos. */
    const bloquePrecio = (s, i) => {
      const x = buscarCosto(saldos, s.nombre || i.nombre); const auto = x && (s.usaCompras === true || (s.usaCompras === undefined && !(C.aCentavos(s.pago) > 0)));
      const usar = h('label', {class:'lin', style:'cursor:pointer'}, h('span', {}, x ? 'Usar el costo de mis compras (' + C.dinero(x.avg) + ' por ' + C.MEDIDAS[x.medida].s + ')' : 'Todavía no hay compras con este nombre'),
        h('input', {type:'checkbox', style:'width:26px;min-height:26px', disabled:!x, checked:!!auto, onchange:e => { s.usaCompras = e.target.checked; draw(); }}));
      return h('div', {}, usar, auto ? null : h('div', {},
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Pagaste', num(s.pago, v => s.pago = v, '0'))), h('div', {style:'width:96px'}, campo('Moneda', sel(['CUP', ...Object.keys(N.tasas)], s.moneda || 'CUP', v => s.moneda = v)))),
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Por cuánto', num(s.compraQty, v => s.compraQty = v, '1'))), h('div', {style:'flex:1'}, campo('Medida', sel(Object.keys(UN).map(u => [u, NOMBRE[u]]), s.compraUnit || 'kilo', v => s.compraUnit = v))))));
    };
    const draw = () => {
      salidas.length = 0;
      cuerpo.replaceChildren(
        h('div', {class:'card aviso-c'}, h('b', {}, 'Qué poner aquí'), h('p', {style:'margin:4px 0 0'}, 'Solo lo que lleva TODA ' + p.nombre.toLowerCase() + '. Lo opcional (jamón, queso extra…) se cobra aparte como agrego y no entra en esta cuenta. Si un ingrediente tiene varios tipos, como el queso, ponlos dentro del mismo ingrediente.')),
        ...f.ings.map((i, k) => {
          const rinde = i.modo === 'rinde'; const salida = h('div', {class:'ayuda'});
          const act = () => { const r = costoIngrediente(N, saldos, i); salida.textContent = r.err ? '⚠ ' + r.err : '= ' + C.dinero(Math.round(r.c)) + ' por ' + C.MEDIDAS[p.medida].s; salida.className = 'ayuda ' + (r.err ? 'mal' : 'bien'); };
          salidas.push(act); const refrescar = act;
          const usoOps = USO[(UN[i.usoUnit] || UN.gramo).t];
          return h('div', {class:'card'}, h('div', {class:'fila'}, h('input', {value:i.nombre, placeholder:'Ingrediente (harina, queso…)', style:'font-weight:700', oninput:e => { i.nombre = e.target.value; refrescar(); pinta(); }}), h('button', {class:'x', 'aria-label':'Quitar', onclick:() => { f.ings.splice(k, 1); draw(); }}, '✕')),
            h('div', {class:'opts'}, h('button', {class:'op', 'aria-pressed':!rinde, onclick:() => { i.modo = 'lleva'; draw(); }}, 'Sé cuánto lleva cada una'), h('button', {class:'op', 'aria-pressed':rinde, onclick:() => { i.modo = 'rinde'; draw(); }}, 'Sé para cuántas alcanza una compra')),
            rinde ? h('div', {}, h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Una compra es de', num(i.compraQty, v => i.compraQty = v, '1'))), h('div', {style:'flex:1'}, campo('Medida', sel(Object.keys(UN).map(u => [u, NOMBRE[u]]), i.compraUnit || 'lata', v => i.compraUnit = v)))),
                campo('Y alcanza para cuántas ' + p.nombre.toLowerCase(), num(i.rinde, v => i.rinde = v, 'Por ejemplo 35')))
              : h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Cada una lleva', num(i.usoQty, v => i.usoQty = v, '0'))), h('div', {style:'flex:1'}, campo('Medida', sel(usoOps.map(u => [u, NOMBRE[u]]), i.usoUnit || 'gramo', v => i.usoUnit = v)))),
            (i.tipos && i.tipos.length) ? h('div', {}, h('p', {class:'marca', style:'margin-top:12px'}, 'Tipos (por ejemplo, varios quesos). Pon cuánto se usa de cada uno; se promedian.'),
                ...i.tipos.map((t, j) => h('div', {class:'row'}, h('div', {class:'fila'}, h('input', {value:t.nombre, placeholder:'Nombre del tipo', style:'font-weight:700', oninput:e => { t.nombre = e.target.value; pinta(); }}), h('button', {class:'x', 'aria-label':'Quitar tipo', onclick:() => { i.tipos.splice(j, 1); draw(); }}, '✕')),
                  campo('Cuánto se usa de este tipo (%)', num(t.pct, v => t.pct = v, 'Si no pones nada, todos por igual')), bloquePrecio(t, i))),
                h('button', {class:'btn suave', onclick:() => { i.tipos.push({id:C.uid(), nombre:'', pct:'', usaCompras:true, pago:'', moneda:'CUP', compraQty:'1', compraUnit:'kilo'}); draw(); }}, '+ Otro tipo'))
              : h('div', {}, bloquePrecio(i, i), h('button', {class:'enlace', onclick:() => { i.tipos = [{id:C.uid(), nombre:i.nombre, pct:'', usaCompras:i.usaCompras, pago:i.pago || '', moneda:i.moneda || 'CUP', compraQty:i.compraQty || '1', compraUnit:i.compraUnit || 'kilo'}, {id:C.uid(), nombre:'', pct:'', usaCompras:true, pago:'', moneda:'CUP', compraQty:'1', compraUnit:'kilo'}]; draw(); }}, 'Este ingrediente tiene varios tipos (por ejemplo, varios quesos)')),
            salida);
        }),
        h('button', {class:'btn suave', onclick:() => { f.ings.push({id:C.uid(), nombre:'', modo:'lleva', usaCompras:true, pago:'', moneda:'CUP', compraQty:'1', compraUnit:'kilo', usoQty:'', usoUnit:'gramo', rinde:''}); draw(); }}, '+ Ingrediente'),
        h('h3', {style:'margin-top:16px'}, 'Lo demás'),
        h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Se pierde (%)', h('input', {inputmode:'decimal', value:f.merma, oninput:e => { f.merma = e.target.value; pinta(); }}))), h('div', {style:'flex:1'}, campo('Quieres ganar (%)', h('input', {inputmode:'decimal', value:f.margen, oninput:e => { f.margen = e.target.value; pinta(); }})))),
        campo('Cuántas haces al mes', h('input', {inputmode:'decimal', value:f.unidadesMes, placeholder:'Por ejemplo 1500', oninput:e => { f.unidadesMes = e.target.value; pinta(); }}), 'Con eso se reparten los gastos del mes entre cada una.'),
        campo('Gastos del mes que le tocan (pesos)', h('input', {inputmode:'decimal', value:f.gastosMes, oninput:e => { f.gastosMes = e.target.value; pinta(); }})),
        campo('Comisión del trabajador (% de la venta)', h('input', {inputmode:'decimal', value:f.comision, oninput:e => { f.comision = e.target.value; pinta(); }}), 'Se calculó con las personas de este puesto.'),
        res,
        h('button', {class:'btn', onclick:async () => { p.ficha = f; await ctx.guardarN(); cerrar(); aviso('Ficha guardada'); if(alGuardar) alGuardar(); }}, 'Guardar la ficha'),
        h('button', {class:'btn suave', onclick:async () => { const x = calc(); if(!(x.conMerma > 0)){ aviso('Completa los ingredientes primero.', true); return; } p.ficha = f; p.costoCents = Math.round(x.conMerma); p.costoMoneda = 'CUP'; await ctx.guardarN(); cerrar(); aviso('Ahora «lo que te cuesta» es ' + C.dinero(p.costoCents)); if(alGuardar) alGuardar(); }}, 'Guardar y usar como lo que me cuesta'));
      pinta();
    };
    draw(); return cuerpo;
  });
}
