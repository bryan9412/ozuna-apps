/* Historial, comparativas y reportes para Yelenis (Excel, CSV y resumen de texto). */
import * as C from '../shared/core.js';
import { crearXlsx, crearCsv } from '../shared/xlsx.js';
import { h, montar, aviso, campo } from '../shared/ui.js';
import { cierresUltimos, eventos, ganancia, casaSaldos, sumaDias, lunesDe, inicioMes, finMes } from './datos.js';

const atras = ctx => h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más');
const peso = c => Math.round(c) / 100;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const pct = (a, b) => b ? (a >= b ? '+' : '') + Math.round((a - b) / b * 100) + ' %' : '';

/* ---------- los datos de un reporte, en hojas listas para Excel ---------- */
export async function tablasReporte(ctx, desde, hasta){
  const N = ctx.N; const cierres = await cierresUltimos(ctx.db, desde, hasta);
  const R = [['Fecha', 'Puesto', 'Vendedora', 'Versión del cierre', 'Ventas brutas', 'Devoluciones', 'Ventas netas', 'Efectivo', 'Transferencia y QR', 'Fiado', 'Efectivo esperado CUP', 'Efectivo contado CUP', 'Diferencia CUP', 'Comisiones', 'Costo de lo vendido', 'Ganancia aproximada']];
  const V = [['Fecha', 'Hora', 'Puesto', 'Ticket', 'Vendedora', 'Producto', 'Cantidad', 'Unidad', 'Precio', 'Importe', 'Agregos', 'Precio especial', 'Domicilio']];
  const P = [['Fecha', 'Puesto', 'Ticket', 'Método', 'Moneda', 'Monto', 'Tasa', 'Equivale en CUP', 'Cliente (fiado)']];
  const D = [['Fecha', 'Puesto', 'Ticket', 'Tipo', 'Motivo', 'Efectivo devuelto', 'Decisión del dueño']];
  const T = [['Fecha', 'Puesto', 'Ticket', 'Método', 'Monto CUP', 'Código del SMS', 'La vendedora mandó captura', 'Llegó a la cuenta']];
  const K = [['Fecha', 'Puesto', 'Persona', 'Porciento', 'Comisión']];
  for(const c of cierres){
    const q = C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents), g = ganancia(N, c); const cont = c.contado.CUP;
    R.push([c.fecha, c.puestoNombre, c.vendedora, c.version, peso(q.ventasCup), peso(q.devueltoCup), peso(q.netoCup), peso(q.porMetodo.efectivo || 0), peso((q.porMetodo.transferencia || 0) + (q.porMetodo.qr || 0)), peso(q.porMetodo.fiado || 0),
      peso(q.esperado.CUP), cont != null ? peso(cont) : '', cont != null ? peso(cont - q.esperado.CUP) : '', peso(g.comisiones), peso(g.costo), peso(g.ganancia)]);
    for(const v of c.ventas){
      const tk = 'T-' + String(v.num).padStart(3, '0');
      for(const l of v.lineas) V.push([c.fecha, C.horaDe(v.ts), c.puestoNombre, tk, c.vendedora, l.nombre, l.qtyMilli / 1000, C.MEDIDAS[l.medida] ? C.MEDIDAS[l.medida].s : l.medida, peso(l.precioCents), peso(l.importeCents), (l.agregos || []).map(a => a.nombre + ' x' + a.cant).join(', '), l.lista || '', v.domicilio ? v.domicilio.direccion : '']);
      for(const p of v.pagos) P.push([c.fecha, c.puestoNombre, tk, p.metodo === 'efectivo' ? 'Efectivo' : p.metodo === 'qr' ? 'QR' : p.metodo === 'fiado' ? 'Fiado' : 'Transferencia', p.moneda, peso(p.monto), peso(p.tasa), peso(p.cup), p.cliente || '']);
    }
    for(const s of c.solicitudes || []) D.push([c.fecha, c.puestoNombre, 'T-' + String(s.num).padStart(3, '0'), s.tipo === 'devolucion' ? 'Devolución' : 'Anulación', s.motivo, peso(s.efectivoDevueltoCents), (c.decisiones || {})[s.id] || 'pendiente']);
    for(const t of q.transferencias) T.push([c.fecha, c.puestoNombre, 'T-' + String(t.num).padStart(3, '0'), t.metodo === 'qr' ? 'QR' : 'Transferencia', peso(t.cup), t.codigo || '', c.capturas[t.ventaId] ? 'Sí' : 'No', (c.transfOk || {})[t.ventaId] ? 'Sí' : 'No']);
    for(const x of C.comisiones(N.personas, c.puestoId, q.netoCup)) K.push([c.fecha, c.puestoNombre, x.nombre, x.pct, peso(x.cup)]);
  }
  const Co = [['Fecha', 'Proveedor', 'Artículo', 'Cantidad', 'Unidad', 'Costo', 'Moneda', 'Tasa', 'Costo en CUP']];
  for(const e of await eventos(ctx.db, 'compra', desde, hasta)) for(const l of e.lineas) Co.push([e.fecha, e.proveedor || '', l.nombre, l.qtyMilli / 1000, C.MEDIDAS[l.medida] ? C.MEDIDAS[l.medida].s : l.medida, peso(l.costoCents), e.moneda, peso(e.tasaCents), peso(C.aCup(l.costoCents, e.tasaCents))]);
  const G = [['Fecha', 'Concepto', 'Monto', 'Puesto']];
  for(const e of await eventos(ctx.db, 'gasto', desde, hasta)) G.push([e.fecha, e.concepto, peso(e.montoCents), e.puestoId ? ctx.nomPuesto(e.puestoId) : 'Todo el negocio']);
  const F = [['Gasto fijo', 'Monto al mes', 'Por día (entre 30)', 'De quién es', 'Puesto']];
  for(const g of N.gastos) F.push([g.nombre, peso(g.montoCents), peso(g.montoCents / 30), g.ambito || '', g.puestoId ? ctx.nomPuesto(g.puestoId) : '']);
  const M = [['Fecha', 'Dónde', 'Artículo', 'Cantidad', 'Unidad', 'Motivo']];
  for(const e of await eventos(ctx.db, 'merma', desde, hasta)) M.push([e.fecha, e.donde === 'casa' ? 'Casa' : ctx.nomPuesto(e.donde), e.nombre, e.qtyMilli / 1000, C.MEDIDAS[e.medida] ? C.MEDIDAS[e.medida].s : e.medida, e.motivo]);
  const Tr = [['Fecha', 'Sale de', 'Va para', 'Artículo', 'Cantidad', 'Unidad']];
  for(const e of await eventos(ctx.db, 'traspaso', desde, hasta)) for(const i of e.items) Tr.push([e.fecha, ctx.nomPuesto(e.origenId), ctx.nomPuesto(e.destinoId), i.nombre, i.qtyMilli / 1000, C.MEDIDAS[i.medida] ? C.MEDIDAS[i.medida].s : i.medida]);
  const Ca = [['Artículo', 'Unidad', 'Compró', 'Entregó', 'Merma', 'Ajuste', 'Hay ahora']];
  for(const x of await casaSaldos(ctx.db, N)) Ca.push([x.nombre, C.MEDIDAS[x.medida] ? C.MEDIDAS[x.medida].s : x.medida, x.entra / 1000, x.sale / 1000, x.merma / 1000, x.ajuste / 1000, x.saldo / 1000]);
  return [{nombre:'Resumen', filas:R}, {nombre:'Ventas', filas:V}, {nombre:'Pagos', filas:P}, {nombre:'Devoluciones', filas:D}, {nombre:'Transferencias', filas:T}, {nombre:'Comisiones', filas:K},
    {nombre:'Compras', filas:Co}, {nombre:'Gastos del día', filas:G}, {nombre:'Gastos fijos', filas:F}, {nombre:'Merma', filas:M}, {nombre:'Traspasos', filas:Tr}, {nombre:'Almacén de casa', filas:Ca}];
}
export async function textoResumen(ctx, desde, hasta){
  const N = ctx.N; const cierres = await cierresUltimos(ctx.db, desde, hasta);
  const titulo = desde === hasta ? C.fechaBonita(desde) : C.fechaBonita(desde) + ' al ' + C.fechaBonita(hasta);
  const L = [(N.nombre || 'Ozuna') + ' · ' + titulo];
  let neto = 0, gan = 0;
  for(const c of cierres){
    const q = C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents), g = ganancia(N, c); neto += q.netoCup; gan += g.ganancia;
    const cont = c.contado.CUP; const caja = cont == null ? 'caja sin contar' : cont === q.esperado.CUP ? 'caja cuadra' : (cont < q.esperado.CUP ? 'faltan ' : 'sobran ') + C.dinero(Math.abs(cont - q.esperado.CUP));
    L.push('• ' + (desde === hasta ? '' : C.fechaBonita(c.fecha) + ' ') + c.puestoNombre + ': ' + C.dinero(q.netoCup) + ' netas (efectivo ' + C.dinero(q.porMetodo.efectivo || 0) + ', transf. ' + C.dinero((q.porMetodo.transferencia || 0) + (q.porMetodo.qr || 0)) + (q.porMetodo.fiado ? ', fiado ' + C.dinero(q.porMetodo.fiado) : '') + '), ' + caja);
  }
  if(!cierres.length) L.push('Sin cierres recibidos.');
  else { L.push('Total neto: ' + C.dinero(neto)); L.push('Ganancia aproximada: ' + C.dinero(gan)); }
  const compras = await eventos(ctx.db, 'compra', desde, hasta); if(compras.length) L.push('Compras: ' + C.dinero(compras.reduce((s, c) => s + c.totalCup, 0)));
  const gastos = await eventos(ctx.db, 'gasto', desde, hasta); if(gastos.length) L.push('Gastos del día: ' + C.dinero(gastos.reduce((s, c) => s + c.montoCents, 0)));
  return L.join('\n');
}
export async function exportarExcel(ctx, desde, hasta){
  const hojas = await tablasReporte(ctx, desde, hasta); const bytes = crearXlsx(hojas);
  const nombre = 'Ozuna_' + desde + (desde === hasta ? '' : '_a_' + hasta) + '.xlsx';
  const r = await C.enviarBlob(nombre, bytes, XLSX_MIME);
  if(r !== 'cancelado') aviso(r === 'compartido' ? 'Listo para mandar' : 'Se guardó «' + nombre + '» en Descargas. En WhatsApp: clip, Documento.');
  return r;
}

/* ---------- pantalla de reportes ---------- */
const stR = {rango:'hoy', desde:C.hoy(), hasta:C.hoy()};
function fechasRango(){
  const hoy = C.hoy();
  if(stR.rango === 'hoy') return [hoy, hoy]; if(stR.rango === 'ayer'){ const a = sumaDias(hoy, -1); return [a, a]; }
  if(stR.rango === 'semana') return [lunesDe(hoy), hoy]; if(stR.rango === 'mes') return [inicioMes(hoy), hoy];
  if(stR.rango === 'mespasado'){ const u = sumaDias(inicioMes(hoy), -1); return [inicioMes(u), finMes(u)]; }
  return [stR.desde, stR.hasta];
}
export async function vReportes(ctx){
  const [desde, hasta] = fechasRango(); const cierres = await cierresUltimos(ctx.db, desde, hasta);
  const ops = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mespasado', 'Mes pasado'], ['otro', 'Otras fechas']];
  const texto = await textoResumen(ctx, desde, hasta);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Reportes'), h('p', {class:'ayuda'}, 'Para Yelenis: un Excel con todo el detalle, listo para mandar por WhatsApp.'),
    h('div', {class:'opts'}, ops.map(([v, t]) => h('button', {class:'op', 'aria-pressed':stR.rango === v, onclick:() => { stR.rango = v; ctx.pintar(); }}, t))),
    stR.rango === 'otro' ? h('div', {class:'fila', style:'margin-top:10px'}, campo('Desde', h('input', {type:'date', value:stR.desde, onchange:e => { stR.desde = e.target.value || C.hoy(); ctx.pintar(); }})), campo('Hasta', h('input', {type:'date', value:stR.hasta, onchange:e => { stR.hasta = e.target.value || C.hoy(); ctx.pintar(); }}))) : null,
    h('p', {class:'ayuda'}, C.fechaBonita(desde) + (desde === hasta ? '' : ' al ' + C.fechaBonita(hasta)) + ' · ' + cierres.length + (cierres.length === 1 ? ' cierre' : ' cierres')),
    h('button', {class:'btn', onclick:() => exportarExcel(ctx, desde, hasta)}, 'Mandar el Excel'),
    h('button', {class:'btn suave', onclick:async () => { const ok = await C.copiarTexto(texto); aviso(ok ? 'Resumen copiado. Pégalo en WhatsApp.' : 'No se pudo copiar. Selecciona el texto de abajo.', !ok); }}, 'Copiar el resumen para WhatsApp'),
    h('button', {class:'btn suave', onclick:async () => { const hojas = await tablasReporte(ctx, desde, hasta); for(const n of ['Resumen', 'Ventas']){ const f = hojas.find(x => x.nombre === n); const r = await C.enviarBlob('Ozuna_' + n + '_' + desde + '.csv', new TextEncoder().encode(crearCsv(f.filas)), 'text/csv'); if(r === 'cancelado') break; } }}, 'CSV (Resumen y Ventas)'),
    h('div', {class:'card', style:'margin-top:12px'}, h('h3', {}, 'Así se vería el resumen'), h('pre', {style:'white-space:pre-wrap;font:15px/1.4 inherit;margin:8px 0 0'}, texto)));
}

/* ---------- historial y comparativas ---------- */
const stH = {dias:30};
export async function vHistorial(ctx){
  const N = ctx.N; const hoy = C.hoy(); const desde = sumaDias(hoy, -(stH.dias - 1)); const pDesde = sumaDias(desde, -stH.dias), pHasta = sumaDias(desde, -1);
  const cierres = await cierresUltimos(ctx.db, desde, hoy), previos = await cierresUltimos(ctx.db, pDesde, pHasta);
  const q = c => C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents);
  const porDia = {}, porPuesto = {}, prods = {}; let tickets = 0, gan = 0;
  for(const c of cierres){
    const x = q(c); porDia[c.fecha] = (porDia[c.fecha] || 0) + x.netoCup; porPuesto[c.puestoNombre] = (porPuesto[c.puestoNombre] || 0) + x.netoCup; tickets += c.ventas.length; gan += ganancia(N, c).ganancia;
    for(const v of c.ventas) for(const l of v.lineas) if(l.productoId !== 'envio'){ const p = (prods[l.nombre] = prods[l.nombre] || {nombre:l.nombre, importe:0, qty:0, medida:l.medida}); p.importe += l.importeCents; p.qty += l.qtyMilli; }
  }
  const total = Object.values(porDia).reduce((s, v) => s + v, 0); const totPrev = previos.reduce((s, c) => s + q(c).netoCup, 0);
  const dias = Object.keys(porDia).sort(); const max = Math.max(1, ...Object.values(porDia));
  const mejor = dias.reduce((b, d) => !b || porDia[d] > porDia[b] ? d : b, null);
  const semana = async (ini, fin) => (await cierresUltimos(ctx.db, ini, fin)).reduce((s, c) => s + q(c).netoCup, 0);
  const lunes = lunesDe(hoy), sEsta = await semana(lunes, hoy), sPasada = await semana(sumaDias(lunes, -7), sumaDias(hoy, -7));
  const mEste = await semana(inicioMes(hoy), hoy), mPrevIni = inicioMes(sumaDias(inicioMes(hoy), -1)); const mPrevFin = mPrevIni.slice(0, 8) + String(Math.min(+hoy.slice(8), +finMes(mPrevIni).slice(8))).padStart(2, '0'); const mPasado = await semana(mPrevIni, mPrevFin);
  const top = Object.values(prods).sort((a, b) => b.importe - a.importe).slice(0, 8);
  montar(ctx.raiz, ctx.banner(), atras(ctx), h('h1', {}, 'Historial'),
    h('div', {class:'opts'}, [7, 30, 90].map(d => h('button', {class:'op', 'aria-pressed':stH.dias === d, onclick:() => { stH.dias = d; ctx.pintar(); }}, 'Últimos ' + d + ' días'))),
    !cierres.length ? h('div', {class:'card', style:'margin-top:12px'}, 'Todavía no hay cierres en este período.') : [
      h('div', {class:'total', style:'margin-top:12px'}, h('span', {}, 'Vendido (neto)'), h('b', {class:'num'}, C.dinero(total))),
      h('div', {class:'card'}, h('div', {class:'lin'}, h('span', {}, 'Contra los ' + stH.dias + ' días anteriores'), h('b', {class:'num'}, totPrev ? pct(total, totPrev) : 'sin datos antes')),
        h('div', {class:'lin'}, h('span', {}, 'Promedio por día con ventas'), h('b', {class:'num'}, C.dinero(Math.round(total / dias.length)))),
        h('div', {class:'lin'}, h('span', {}, 'Mejor día'), h('b', {class:'num'}, C.fechaBonita(mejor) + ' · ' + C.dinero(porDia[mejor]))),
        h('div', {class:'lin'}, h('span', {}, 'Ticket promedio'), h('b', {class:'num'}, tickets ? C.dinero(Math.round(total / tickets)) : '—')),
        h('div', {class:'lin'}, h('span', {}, 'Ganancia aproximada'), h('b', {class:'num ' + (gan < 0 ? 'mal' : 'bien')}, C.dinero(gan)))),
      h('div', {class:'card'}, h('h3', {}, 'Esta semana y este mes'), h('div', {class:'lin'}, h('span', {}, 'Esta semana'), h('b', {class:'num'}, C.dinero(sEsta) + (sPasada ? ' (' + pct(sEsta, sPasada) + ' vs la pasada)' : ''))),
        h('div', {class:'lin'}, h('span', {}, 'Este mes'), h('b', {class:'num'}, C.dinero(mEste) + (mPasado ? ' (' + pct(mEste, mPasado) + ' vs el pasado)' : '')))),
      h('h2', {}, 'Por puesto'), h('div', {class:'card'}, Object.entries(porPuesto).sort((a, b) => b[1] - a[1]).map(([n, v]) => h('div', {class:'lin'}, h('span', {}, n), h('b', {class:'num'}, C.dinero(v) + ' · ' + Math.round(v / total * 100) + ' %')))),
      h('h2', {}, 'Lo que más se vende'), h('div', {class:'card'}, top.map(p => h('div', {class:'lin'}, h('span', {}, p.nombre, h('div', {class:'d'}, C.cantidad(p.qty) + ' ' + C.nombreMedida(p.medida, p.qty))), h('b', {class:'num'}, C.dinero(p.importe))))),
      h('h2', {}, 'Día por día'), h('div', {class:'card'}, dias.slice().reverse().map(d => h('div', {style:'margin:8px 0'}, h('div', {class:'fila'}, h('span', {}, C.fechaBonita(d)), h('b', {class:'num'}, C.dinero(porDia[d]))),
        h('div', {style:'height:10px;border-radius:99px;background:var(--line);margin-top:4px;overflow:hidden'}, h('div', {style:'height:100%;border-radius:99px;background:var(--acc);width:' + Math.max(2, Math.round(porDia[d] / max * 100)) + '%'})))))]);
}
