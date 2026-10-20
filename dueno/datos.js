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
/* Almacén de casa: lo comprado menos lo entregado a los puestos, la merma de casa y los ajustes de conteo. */
export async function casaSaldos(db, N){
  const s = {}; const get = (k, n, m) => (s[k] = s[k] || {clave:k, nombre:n, medida:m, entra:0, sale:0, merma:0, ajuste:0});
  for(const e of await eventos(db, 'compra')) for(const l of e.lineas) get(clave(l.nombre, l.medida), l.nombre, l.medida).entra += l.qtyMilli;
  for(const en of await db.todos('entregas')) for(const [pid, q] of Object.entries(en.cantidades || {})){ const p = N.productos.find(x => x.id === pid); if(p) get(clave(p.nombre, p.medida), p.nombre, p.medida).sale += q; }
  for(const e of await eventos(db, 'merma')) if(e.donde === 'casa') get(clave(e.nombre, e.medida), e.nombre, e.medida).merma += e.qtyMilli;
  for(const e of await eventos(db, 'ajusteCasa')) get(e.clave, e.nombre, e.medida).ajuste += e.difMilli;
  return Object.values(s).map(x => Object.assign(x, {saldo:x.entra - x.sale - x.merma + x.ajuste})).sort((a, b) => a.nombre.localeCompare(b.nombre));
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
