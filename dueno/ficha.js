/* Ficha de costo de un producto (por ejemplo la pizza): ingredientes, merma, gastos indirectos, comisión y margen. Sin impuestos. */
import * as C from '../shared/core.js';
import { h, aviso, hoja, campo } from '../shared/ui.js';

const UN = {gramo:{t:'m', f:1}, onza:{t:'m', f:28.3495}, libra:{t:'m', f:453.592}, kilo:{t:'m', f:1000}, ml:{t:'v', f:1}, litro:{t:'v', f:1000}, unidad:{t:'n', f:1}, lata:{t:'n', f:1}, paquete:{t:'n', f:1}};
const USO = {m:['gramo', 'onza', 'libra', 'kilo'], v:['ml', 'litro'], n:['unidad', 'lata', 'paquete']};
const NOMBRE = {gramo:'gramos', onza:'onzas', libra:'libras', kilo:'kilos', ml:'mililitros', litro:'litros', unidad:'unidades', lata:'latas', paquete:'paquetes'};

/* Costo en centavos de CUP de lo que lleva una unidad del producto. Devuelve {c, err}. */
function costoIng(N, i){
  const pago = C.aCentavos(i.pago), cq = C.num(i.compraQty), uq = C.num(i.usoQty);
  if(isNaN(pago) || pago <= 0) return {c:0, err:'Falta lo que pagaste'}; if(!(cq > 0)) return {c:0, err:'Falta la cantidad comprada'}; if(!(uq > 0)) return {c:0, err:'Falta cuánto lleva'};
  const a = UN[i.compraUnit], b = UN[i.usoUnit]; if(!a || !b || a.t !== b.t) return {c:0, err:'Las medidas no se pueden comparar'};
  let cup = pago; if(i.moneda && i.moneda !== 'CUP'){ const t = N.tasas[i.moneda]; if(!t) return {c:0, err:'Falta el cambio de ' + i.moneda}; cup = C.aCup(pago, t); }
  return {c:cup / (cq * a.f) * (uq * b.f)};
}
export function abrirFicha(ctx, p, alGuardar){
  const N = ctx.N;
  const pp = N.personas.filter(x => x.puestoId === p.puestoId && /porciento/.test(x.base || 'porciento')).reduce((s, x) => s + (C.num(x.pct) || 0), 0);
  const gastosMes = N.gastos.filter(g => !g.puestoId || g.puestoId === p.puestoId).reduce((s, g) => s + (g.montoCents || 0), 0);
  const f = Object.assign({ings:[], merma:'5', unidadesMes:'', gastosMes:String(gastosMes / 100), comision:String(pp), margen:'30'}, JSON.parse(JSON.stringify(p.ficha || {})));
  hoja('Ficha de costo · ' + p.nombre, cerrar => {
    const cuerpo = h('div'); const res = h('div');
    const calc = () => {
      let directo = 0, errores = 0; for(const i of f.ings){ const r = costoIng(N, i); if(r.err) errores++; directo += r.c; }
      const conMerma = directo * (1 + (C.num(f.merma) || 0) / 100);
      const um = C.num(f.unidadesMes), gm = C.aCentavos(f.gastosMes);
      const indirecto = um > 0 && !isNaN(gm) ? gm / um : 0; const com = C.num(f.comision) || 0, mar = C.num(f.margen) || 0;
      const base = conMerma + indirecto, den = 1 - com / 100 - mar / 100;
      const r = (N.redondeo || 500); const sug = den > 0 ? Math.ceil(base / den / r) * r : NaN;
      return {directo, conMerma, indirecto, com, mar, base, sug, errores};
    };
    const pinta = () => { const x = calc(); const actual = C.precioEnCup(p, N.tasas, N.redondeo);
      res.replaceChildren(h('div', {class:'card'}, h('h3', {}, 'Cuentas por cada ' + C.MEDIDAS[p.medida].s),
        [['Ingredientes', x.directo], ['Con lo que se pierde (' + (f.merma || 0) + ' %)', x.conMerma], ['Gastos del mes repartidos', x.indirecto]].map(([t, v]) => h('div', {class:'lin'}, h('span', {}, t), h('b', {class:'num'}, C.dinero(Math.round(v))))),
        h('div', {class:'lin'}, h('span', {}, 'Cuesta hacerla'), h('b', {class:'num'}, C.dinero(Math.round(x.base)))),
        h('div', {class:'lin'}, h('span', {}, 'Comisión del trabajador (' + x.com + ' % del precio)'), h('b', {class:'num'}, isNaN(x.sug) ? '—' : C.dinero(Math.round(x.sug * x.com / 100)))),
        h('div', {class:'lin'}, h('span', {}, 'Precio sugerido (' + x.mar + ' % de ganancia)'), h('b', {class:'num bien'}, isNaN(x.sug) ? 'Revisa los porcientos' : C.dinero(x.sug))),
        actual && !isNaN(x.sug) ? h('div', {class:'lin'}, h('span', {}, 'Hoy lo vendes a ' + C.dinero(actual)), h('b', {class:'num ' + (actual >= x.sug ? 'bien' : 'mal')}, actual >= x.sug ? 'Alcanza' : 'Te falta ' + C.dinero(x.sug - actual))) : null,
        x.errores ? h('p', {class:'mal'}, 'Hay ' + x.errores + (x.errores === 1 ? ' ingrediente incompleto' : ' ingredientes incompletos') + '; no se están contando bien.') : null));
    };
    const draw = () => {
      cuerpo.replaceChildren(h('p', {class:'ayuda'}, 'Pon lo que lleva una unidad. Si compras la harina por kilo y cada pizza lleva 150 gramos, la aplicación hace la cuenta.'),
        ...f.ings.map((i, k) => {
          const tipo = UN[i.compraUnit].t; if(!USO[tipo].includes(i.usoUnit)) i.usoUnit = USO[tipo][0];
          const inp = (v, fn, ph) => h('input', {inputmode:'decimal', value:v, placeholder:ph || '', oninput:e => { fn(e.target.value); pinta(); }});
          const sel = (ops, v, fn, redraw) => { const s = h('select', {onchange:e => { fn(e.target.value); redraw ? draw() : pinta(); }}, ops.map(o => h('option', {value:Array.isArray(o) ? o[0] : o, selected:(Array.isArray(o) ? o[0] : o) === v}, Array.isArray(o) ? o[1] : o))); s.value = v; return s; };
          return h('div', {class:'card'}, h('div', {class:'fila'}, h('input', {value:i.nombre, placeholder:'Ingrediente', style:'font-weight:700', oninput:e => i.nombre = e.target.value}), h('button', {class:'x', 'aria-label':'Quitar', onclick:() => { f.ings.splice(k, 1); draw(); }}, '✕')),
            h('div', {class:'fila', style:'margin-top:6px'}, h('div', {style:'flex:1'}, campo('Pagaste', inp(i.pago, v => i.pago = v, '0'))), h('div', {style:'width:96px'}, campo('Moneda', sel(['CUP', ...Object.keys(N.tasas)], i.moneda || 'CUP', v => i.moneda = v)))),
            h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Por cuánto', inp(i.compraQty, v => i.compraQty = v, '1'))), h('div', {style:'flex:1'}, campo('Medida', sel(Object.keys(UN).map(u => [u, NOMBRE[u]]), i.compraUnit, v => i.compraUnit = v, true)))),
            h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Lleva cada una', inp(i.usoQty, v => i.usoQty = v, '0'))), h('div', {style:'flex:1'}, campo('Medida', sel(USO[tipo].map(u => [u, NOMBRE[u]]), i.usoUnit, v => i.usoUnit = v)))));
        }),
        h('button', {class:'btn suave', onclick:() => { f.ings.push({id:C.uid(), nombre:'', pago:'', moneda:'CUP', compraQty:'1', compraUnit:'kilo', usoQty:'', usoUnit:'gramo'}); draw(); }}, '+ Ingrediente'),
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
