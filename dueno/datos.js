/* Cálculos del dueño sobre lo guardado: cierres vigentes, almacén de casa, ganancia aproximada, fiado. Sin pantallas. */
import * as C from '../shared/core.js';

export const clave = (nombre, medida) => String(nombre || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + (medida || 'unidad');

/* Un cierre por entrega: el de versión más alta. */
export async function cierresUltimos(db, desde, hasta){
  const m = {};
  for(const c of await db.todos('cierres')){
    if(desde && c.fecha < desde) continue; if(hasta && c.fecha > hasta) continue;
    if(!m[c.entregaId] || c.version > m[c.entregaId].version) m[c.entregaId] = c;
  }
  return Object.values(m).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.puestoNombre.localeCompare(b.puestoNombre));
}
export async function eventos(db, clase, desde, hasta){
  return (await db.todos('eventos')).filter(e => e.clase === clase && (!desde || e.fecha >= desde) && (!hasta || e.fecha <= hasta)).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.ts - b.ts);
}
export function costoCup(N, p){
  if(p.costoCents == null) return null; const m = p.costoMoneda || 'CUP'; if(m === 'CUP') return p.costoCents;
  const t = N.tasas[m]; return t ? C.aCup(p.costoCents, t) : null;
}
/* Ganancia aproximada de un cierre: ventas netas − costo de lo vendido − comisiones. Avisa qué productos no tienen costo. */
export function ganancia(N, cierre){
  const q = C.calcularCuadre(cierre.ventas, cierre.solicitudes, cierre.fondoCents);
  let costo = 0; const sinCosto = new Set();
  for(const v of cierre.ventas) for(const l of v.lineas){
    if(l.productoId === 'envio') continue;
    const p = N.productos.find(x => x.id === l.productoId); const c = p ? costoCup(N, p) : null;
    if(c == null){ sinCosto.add(l.nombre); continue; }
    costo += Math.round(c * l.qtyMilli / 1000);
  }
  const com = C.comisiones(N.personas, cierre.puestoId, q.netoCup).reduce((s, x) => s + x.cup, 0);
  return {neto:q.netoCup, costo, comisiones:com, ganancia:q.netoCup - costo - com, sinCosto:[...sinCosto], q};
}
/* Almacén de casa: lo comprado menos lo entregado a los puestos, la merma de casa y los ajustes de conteo.
   Además lleva el costo PROMEDIO de cada artículo: cada compra se mezcla con lo que todavía hay, así que si hoy compras a 500 y mañana a 600
   (con lo de hoy ya vendido) el costo es 600; si todavía quedaba, es el punto medio ponderado por cantidades.
   El costo es en pesos por 1 unidad de la medida del artículo (por libra, por kilo, por unidad). */
export async function casaSaldos(db, N){
  const ev = [];
  for(const e of await eventos(db, 'compra')) for(const l of e.lineas){
    const unit = l.qtyMilli > 0 ? Math.round(C.aCup(l.costoCents, e.tasaCents) * 1000 / l.qtyMilli) : 0;
    ev.push({f:e.fecha || '', ts:e.ts, tipo:'compra', k:clave(l.nombre, l.medida), n:l.nombre, m:l.medida, q:l.qtyMilli, unit});
  }
  for(const en of await db.todos('entregas')) for(const [pid, q] of Object.entries(en.cantidades || {})){
    const p = N.productos.find(x => x.id === pid); if(p) ev.push({f:en.fecha || '', ts:en.ts, tipo:'sale', k:clave(p.nombre, p.medida), n:p.nombre, m:p.medida, q});
  }
  for(const e of await eventos(db, 'merma')) if(e.donde === 'casa') ev.push({f:e.fecha || '', ts:e.ts, tipo:'merma', k:clave(e.nombre, e.medida), n:e.nombre, m:e.medida, q:e.qtyMilli});
  for(const e of await eventos(db, 'ajusteCasa')) ev.push({f:e.fecha || '', ts:e.ts, tipo:'ajuste', k:e.clave, n:e.nombre, m:e.medida, q:e.difMilli, unit:e.costoUnitCents});
  ev.sort((a, b) => a.f.localeCompare(b.f) || a.ts - b.ts);
  const s = {};
  const mezclar = (x, q, unit) => { const base = Math.max(0, x.saldo); x.avg = base > 0 ? Math.round((base * x.avg + q * unit) / (base + q)) : unit; };
  for(const e of ev){
    const x = (s[e.k] = s[e.k] || {clave:e.k, nombre:e.n, medida:e.m, entra:0, sale:0, merma:0, ajuste:0, saldo:0, avg:0});
    if(e.tipo === 'compra'){ x.entra += e.q; mezclar(x, e.q, e.unit); x.saldo += e.q; }
    else if(e.tipo === 'sale'){ x.sale += e.q; x.saldo -= e.q; }
    else if(e.tipo === 'merma'){ x.merma += e.q; x.saldo -= e.q; }
    else { x.ajuste += e.q; if(e.q > 0 && e.unit != null) mezclar(x, e.q, e.unit); x.saldo += e.q; }
  }
  return Object.values(s).map(x => Object.assign(x, {saldo:x.entra - x.sale - x.merma + x.ajuste})).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
/* Busca el costo promedio de un ingrediente por su nombre, sin importar en qué medida lo compras. */
export function buscarCosto(saldos, nombre){
  const n = String(nombre || '').trim().toLowerCase().replace(/\s+/g, ' '); if(!n) return null;
  return saldos.find(x => x.nombre.trim().toLowerCase().replace(/\s+/g, ' ') === n && x.avg > 0) || null;
}
/* Después de una compra o un conteo: el costo de cada producto pasa a ser el costo promedio de su artículo. Devuelve los que cambiaron. */
export async function actualizarCostos(db, N, guardar){
  const saldos = await casaSaldos(db, N); const cambios = [];
  for(const p of N.productos){
    const x = saldos.find(y => y.clave === clave(p.nombre, p.medida)); if(!x || !(x.avg > 0)) continue;
    const antes = costoCup(N, p); if(antes === x.avg && (p.costoMoneda || 'CUP') === 'CUP') continue;
    p.costoCents = x.avg; p.costoMoneda = 'CUP'; cambios.push({producto:p, antes, despues:x.avg});
  }
  if(cambios.length && guardar) await guardar();
  return cambios;
}
/* Fiado pendiente por cliente: lo fiado en los cierres menos los pagos que anotó el dueño. */
export async function fiadoPendiente(db){
  const m = {}; const k = n => String(n || 'sin nombre').trim().toLowerCase();
  for(const c of await cierresUltimos(db)) for(const v of c.ventas) for(const p of v.pagos) if(p.metodo === 'fiado'){
    const x = (m[k(p.cliente)] = m[k(p.cliente)] || {clave:k(p.cliente), nombre:p.cliente || 'Sin nombre', fiado:0, pagado:0, mov:[]});
    x.fiado += p.cup; x.mov.push({fecha:c.fecha, tipo:'fiado', cup:p.cup, detalle:c.puestoNombre + ' · T-' + String(v.num).padStart(3, '0')});
  }
  for(const e of await eventos(db, 'abono')){
    const x = (m[e.clave] = m[e.clave] || {clave:e.clave, nombre:e.nombre, fiado:0, pagado:0, mov:[]});
    x.pagado += e.montoCents; x.mov.push({fecha:e.fecha, tipo:'pago', cup:e.montoCents, detalle:'Pago'});
  }
  return Object.values(m).map(x => Object.assign(x, {debe:x.fiado - x.pagado})).sort((a, b) => b.debe - a.debe);
}
export function sumaDias(iso, n){
  const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8) + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function lunesDe(iso){ const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8)); const w = (d.getDay() + 6) % 7; return sumaDias(iso, -w); }
export function inicioMes(iso){ return iso.slice(0, 8) + '01'; }
export function finMes(iso){ const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0); return iso.slice(0, 8) + String(d.getDate()).padStart(2, '0'); }
