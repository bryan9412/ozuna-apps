/* Quién hizo qué (20/10/2026): cada registro lleva el nombre de quien lo hizo (DB.put, campo «por»);
   los cambios de catálogo, precios y personas, que no son registros sueltos, se anotan aquí como eventos «bitacora». */
import * as C from '../shared/core.js';
import { h, montar } from '../shared/ui.js';

const dinero = (c, m) => C.dinero(c) + (m && m !== 'CUP' ? ' ' + m : '');
/* Foto de lo que se vigila de la configuración. El costo promedio NO entra: lo recalcula la app sola, no una persona. */
export function resumenN(N){
  const mapa = (lista, f) => { const o = {}; for(const x of lista || []) o[x.id] = f(x); return o; };
  return {prod:mapa(N.productos, p => ({n:p.nombre, pr:p.precioCents, m:p.moneda, a:p.activo !== false})), per:mapa(N.personas, p => ({n:p.nombre, pct:p.pct, base:p.base})),
    pue:mapa(N.puestos, p => ({n:p.nombre})), ag:mapa(N.agregos, a => ({n:a.nombre, pr:a.precioCents})), tasas:Object.assign({}, N.tasas), gas:mapa(N.gastos, g => ({n:g.nombre, m:g.montoCents}))};
}
export function describirCambios(a, b){
  const t = [];
  const comparar = (ant, nue, f) => {
    for(const id of Object.keys(nue)){ if(!ant[id]) t.push(f.nuevo(nue[id])); else { const x = f.cambio(ant[id], nue[id]); if(x) t.push(x); } }
    for(const id of Object.keys(ant)) if(!nue[id]) t.push(f.quitado(ant[id]));
  };
  comparar(a.prod, b.prod, {nuevo:p => 'Producto nuevo: ' + p.n + ' a ' + dinero(p.pr, p.m), quitado:p => 'Quitó el producto ' + p.n,
    cambio:(x, y) => x.pr !== y.pr ? 'Precio de ' + y.n + ': ' + dinero(x.pr, x.m) + ' → ' + dinero(y.pr, y.m) : x.a !== y.a ? (y.a ? 'Activó ' : 'Desactivó ') + y.n : x.n !== y.n ? 'Renombró ' + x.n + ' → ' + y.n : null});
  comparar(a.per, b.per, {nuevo:p => 'Persona nueva: ' + p.n, quitado:p => 'Quitó a ' + p.n, cambio:(x, y) => x.pct !== y.pct || x.base !== y.base ? 'Cambió lo que cobra ' + y.n : x.n !== y.n ? 'Renombró a ' + x.n + ' → ' + y.n : null});
  comparar(a.pue, b.pue, {nuevo:p => 'Puesto nuevo: ' + p.n, quitado:p => 'Quitó el puesto ' + p.n, cambio:(x, y) => x.n !== y.n ? 'Renombró el puesto ' + x.n + ' → ' + y.n : null});
  comparar(a.ag, b.ag, {nuevo:p => 'Agrego nuevo: ' + p.n, quitado:p => 'Quitó el agrego ' + p.n, cambio:(x, y) => x.pr !== y.pr ? 'Precio del agrego ' + y.n + ': ' + C.dinero(x.pr) + ' → ' + C.dinero(y.pr) : null});
  comparar(a.gas, b.gas, {nuevo:p => 'Gasto fijo nuevo: ' + p.n, quitado:p => 'Quitó el gasto fijo ' + p.n, cambio:(x, y) => x.m !== y.m ? 'Gasto fijo ' + y.n + ': ' + C.dinero(x.m) + ' → ' + C.dinero(y.m) : null});
  for(const m of new Set([...Object.keys(a.tasas || {}), ...Object.keys(b.tasas || {})])) if((a.tasas || {})[m] !== (b.tasas || {})[m]) t.push('Cambio de ' + m + ': ' + C.dinero((a.tasas || {})[m] || 0) + ' → ' + C.dinero((b.tasas || {})[m] || 0));
  return t;
}
const TEXTO = {
  compra:e => 'Compra' + (e.proveedor ? ' a ' + e.proveedor : '') + ' · ' + C.dinero(e.totalCup),
  gasto:e => 'Gasto: ' + e.concepto + ' · ' + C.dinero(e.montoCents),
  merma:e => 'Merma: ' + e.nombre + ' ' + C.cantidad(e.qtyMilli),
  abono:e => 'Pago de fiado: ' + e.nombre + ' · ' + C.dinero(e.montoCents),
  ajusteCasa:e => 'Ajuste de casa: ' + e.nombre + ' ' + (e.difMilli > 0 ? '+' : '') + C.cantidad(e.difMilli) + ' (' + e.motivo + ')',
  ajusteEntrega:e => 'Ajuste de entrega: ' + (e.motivo || ''),
  traspaso:() => 'Traspaso de mercancía',
  conteo:e => 'Conteo de ' + (e.donde === 'casa' ? 'la casa' : 'un puesto'),
  bitacora:e => e.texto,
  borrado:() => 'Quitó un registro'
};
export async function vActividad(ctx){
  const todos = (await ctx.db.todos('eventos')).filter(e => TEXTO[e.clase] && (e.por || e.modPor)).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 120);
  const quienes = [...new Set(todos.map(e => e.por || e.modPor))];
  montar(ctx.raiz, ctx.banner(), h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más'), h('h1', {}, 'Quién hizo qué'),
    h('p', {class:'ayuda'}, 'Compras, gastos, mermas, ajustes y cambios de precios, con el nombre de quien los hizo desde su teléfono. Lo anotado antes de esta versión no trae nombre. Teléfonos con movimientos: ' + (quienes.join(', ') || 'ninguno todavía') + '.'),
    todos.length ? todos.map(e => h('div', {class:'lin'}, h('span', {}, TEXTO[e.clase](e), h('div', {class:'d'}, C.fechaBonita(new Date(e.ts).toISOString().slice(0, 10)) + ' · ' + C.horaDe(e.ts))), h('b', {}, e.por || e.modPor))) : h('div', {class:'card'}, 'Todavía no hay movimientos con nombre.'));
}
