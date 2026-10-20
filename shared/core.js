/* Núcleo compartido de Ozuna: dinero, firmas, archivos de intercambio, almacenamiento y cuadre.
   Lo usan la app del dueño y la de la vendedora. Sin dependencias externas. */
export const VERSION = '0.1.0';

/* ---------- utilidades ---------- */
export function uid(){ const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
export function hoy(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function horaDe(ts){ const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
export function fechaBonita(iso){
  if(!iso) return ''; const p = iso.split('-'); const ds = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const d = new Date(+p[0], +p[1] - 1, +p[2]); return ds[d.getDay()] + ' ' + (+p[2]) + '/' + (+p[1]);
}
const te = new TextEncoder();
export function b64u(bytes){ let s = ''; for(const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64u(str){ const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4); const bin = atob(s); const out = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
/* JSON con llaves ordenadas: es lo que se firma y se hashea. */
export function stable(o){
  if(o === null || typeof o !== 'object') return JSON.stringify(o === undefined ? null : o);
  if(Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
export async function sha256(str){ const h = await crypto.subtle.digest('SHA-256', te.encode(str)); return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''); }
export async function huella(pub){ return (await sha256(pub)).slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-'); }

/* ---------- dinero: pesos y centavos en enteros; cantidades en milésimas ---------- */
/* Entiende 60000, 60 000, 60,000 (miles) y 1,5 (decimal). */
export function num(v){
  if(v === undefined || v === null) return NaN;
  let s = String(v).trim().replace(/\s/g, ''); if(!s) return NaN;
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); else s = s.replace(',', '.');
  if(!/^-?\d*\.?\d+$/.test(s)) return NaN;
  return parseFloat(s);
}
export function aCentavos(v){ const n = num(v); return isNaN(n) ? NaN : Math.round(n * 100); }
export function aMilesimas(v){ const n = num(v); return isNaN(n) ? NaN : Math.round(n * 1000); }
export function dinero(c, moneda){
  const neg = c < 0; c = Math.abs(Math.round(c)); const e = Math.floor(c / 100), d = c % 100;
  let s = String(e).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); if(d) s += ',' + String(d).padStart(2, '0');
  return (neg ? '-' : '') + s + (moneda ? ' ' + moneda : '');
}
export function cantidad(m){ return (Math.round(m) / 1000).toString().replace('.', ','); }
export function importeLinea(precioCents, qtyMilli){ return Math.round(precioCents * qtyMilli / 1000); }
export const MEDIDAS = {
  unidad:{s:'unidad', p:'unidades', peso:false}, libra:{s:'libra', p:'libras', peso:true}, kilo:{s:'kilo', p:'kilos', peso:true},
  paquete:{s:'paquete', p:'paquetes', peso:false}, porcion:{s:'porción', p:'porciones', peso:false}, vaso:{s:'vaso', p:'vasos', peso:false}
};
export function nombreMedida(m, q){ const x = MEDIDAS[m] || MEDIDAS.unidad; return q === 1000 ? x.s : x.p; }
/* Tasa: centavos de peso por 1 unidad de moneda extranjera (820 CUP/USD = 82000). CUP = 100. */
export function aCup(montoCents, tasaCents){ return Math.round(montoCents * tasaCents / 100); }
export function precioEnCup(prod, tasas, redondeo){
  if(!prod.moneda || prod.moneda === 'CUP') return prod.precioCents;
  const t = tasas[prod.moneda]; if(!t) return NaN;
  const bruto = aCup(prod.precioCents, t); const r = redondeo || 0;
  return r > 0 ? Math.round(bruto / r) * r : bruto;
}

/* ---------- firmas (ECDSA P-256 nativo; funciona en cualquier Chrome) ---------- */
const ALG = {name:'ECDSA', namedCurve:'P-256'};
export async function nuevasLlaves(extraible){
  const kp = await crypto.subtle.generateKey(ALG, !!extraible, ['sign', 'verify']);
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  return {privateKey:kp.privateKey, publicKey:kp.publicKey, pub};
}
export async function exportarPrivada(privateKey){ return await crypto.subtle.exportKey('jwk', privateKey); }
export async function importarPrivada(jwk){ return await crypto.subtle.importKey('jwk', jwk, ALG, true, ['sign']); }
async function importarPublica(pub){ return await crypto.subtle.importKey('raw', unb64u(pub), ALG, false, ['verify']); }

/* ---------- sobres de intercambio ---------- */
export async function firmarSobre(tipo, de, para, payload, privateKey){
  const env = {ozuna:1, v:1, tipo, id:uid(), creado:new Date().toISOString(), de:{id:de.id, nombre:de.nombre, pub:de.pub}, para:para || null, payload};
  const firma = new Uint8Array(await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, privateKey, te.encode(stable(env))));
  return Object.assign({}, env, {firma:b64u(firma)});
}
/* Devuelve {ok, motivo}. Si se da pubEsperada, el sobre debe venir de esa llave. */
export async function verificarSobre(env, pubEsperada){
  try {
    if(!env || env.ozuna !== 1 || !env.firma || !env.de || !env.de.pub || !env.tipo) return {ok:false, motivo:'No es un archivo de Ozuna.'};
    if(env.v !== 1) return {ok:false, motivo:'Es de una versión más nueva. Actualiza la aplicación.'};
    if(pubEsperada && env.de.pub !== pubEsperada) return {ok:false, motivo:'Este archivo no viene de quien está enlazado con este teléfono.'};
    const copia = Object.assign({}, env); delete copia.firma;
    const llave = await importarPublica(env.de.pub);
    const bien = await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, llave, unb64u(env.firma), te.encode(stable(copia)));
    return bien ? {ok:true} : {ok:false, motivo:'El archivo fue cambiado después de firmarlo, o está incompleto.'};
  } catch(e){ return {ok:false, motivo:'El archivo está dañado o incompleto.'}; }
}
export function sobreATexto(env){ return JSON.stringify(env); }
export function leerTexto(txt){
  const t = String(txt || '').trim(); const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if(i < 0 || j < i) return null;
  try { const o = JSON.parse(t.slice(i, j + 1)); return o && o.ozuna === 1 ? o : null; } catch(e){ return null; }
}

/* ---------- cadena de ventas: cada venta lleva el hash de la anterior ---------- */
export async function sellarVenta(venta, hashPrev){
  venta.hashPrev = hashPrev; delete venta.hash;
  venta.hash = await sha256(stable(venta)); return venta;
}
export async function verificarCadena(ventas){
  let prev = 'GENESIS';
  for(const v of ventas){
    if(v.hashPrev !== prev) return {ok:false, motivo:'Falta o sobra una venta antes del ticket ' + v.num + '.', en:v.num};
    const copia = Object.assign({}, v); delete copia.hash;
    if(await sha256(stable(copia)) !== v.hash) return {ok:false, motivo:'El ticket ' + v.num + ' fue modificado.', en:v.num};
    prev = v.hash;
  }
  return {ok:true};
}

/* ---------- cuadre (lo calculan las dos apps con la misma regla) ---------- */
export function calcularCuadre(ventas, solicitudes, fondoCents){
  const r = {ventasCup:0, devueltoCup:0, netoCup:0, porMetodo:{}, esperado:{CUP:fondoCents || 0}, transferencias:[], fiado:[], lineas:{}};
  for(const v of ventas){
    r.ventasCup += v.totalCents;
    for(const p of v.pagos){
      r.porMetodo[p.metodo] = (r.porMetodo[p.metodo] || 0) + p.cup;
      if(p.metodo === 'efectivo') r.esperado[p.moneda] = (r.esperado[p.moneda] || 0) + p.monto;
      if(p.metodo === 'transferencia' || p.metodo === 'qr') r.transferencias.push({ventaId:v.id, num:v.num, hora:v.ts, cup:p.cup, metodo:p.metodo});
      if(p.metodo === 'fiado') r.fiado.push({ventaId:v.id, num:v.num, cliente:p.cliente || '', cup:p.cup});
    }
    if(v.vueltoCents){ r.esperado.CUP -= v.vueltoCents; r.porMetodo.efectivo = (r.porMetodo.efectivo || 0) - v.vueltoCents; }
    for(const l of v.lineas){
      const k = l.productoId; r.lineas[k] = (r.lineas[k] || 0) + l.qtyMilli;
    }
  }
  for(const s of solicitudes || []){ r.devueltoCup += s.efectivoDevueltoCents || 0; r.esperado.CUP -= s.efectivoDevueltoCents || 0; }
  r.netoCup = r.ventasCup - r.devueltoCup;
  return r;
}
export function comisiones(personas, puestoId, netoCup){
  return (personas || []).filter(p => p.puestoId === puestoId && !isNaN(num(p.pct)) && num(p.pct) > 0 && /porciento/.test(p.base || 'porciento'))
    .map(p => ({id:p.id, nombre:p.nombre, pct:num(p.pct), cup:Math.round(netoCup * num(p.pct) / 100)}));
}

/* ---------- clave: PBKDF2 para que adivinar 4 dígitos no sea instantáneo ---------- */
export async function hashClave(clave, saltHex){
  const base = await crypto.subtle.importKey('raw', te.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:100000, hash:'SHA-256'}, base, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
export function nuevaSal(){ const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }

/* ---------- almacenamiento local (IndexedDB) ---------- */
const TIENDAS = ['kv', 'ventas', 'entregas', 'cierres', 'eventos'];
export class DB {
  constructor(nombre){ this.nombre = nombre; this.p = null; }
  abrir(){
    if(!this.p) this.p = new Promise((res, rej) => {
      const r = indexedDB.open(this.nombre, 1);
      r.onupgradeneeded = () => { for(const t of TIENDAS) if(!r.result.objectStoreNames.contains(t)) r.result.createObjectStore(t, {keyPath:'id'}); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.p;
  }
  async _tx(tienda, modo, fn){
    const db = await this.abrir();
    return new Promise((res, rej) => { const t = db.transaction(tienda, modo); const q = fn(t.objectStore(tienda)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  get(t, id){ return this._tx(t, 'readonly', s => s.get(id)); }
  put(t, obj){ return this._tx(t, 'readwrite', s => s.put(obj)); }
  del(t, id){ return this._tx(t, 'readwrite', s => s.delete(id)); }
  todos(t){ return this._tx(t, 'readonly', s => s.getAll()); }
  vaciar(t){ return this._tx(t, 'readwrite', s => s.clear()); }
  async kv(k){ const r = await this.get('kv', k); return r ? r.v : undefined; }
  kvSet(k, v){ return this.put('kv', {id:k, v}); }
}
export async function pedirPersistencia(){ try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch(e){ return false; } }

/* ---------- archivos: enviar, recibir ---------- */
export function descargarTexto(nombre, texto){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([texto], {type:'text/plain'})); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/* Chrome no deja compartir .json: va como .txt con JSON dentro. Devuelve 'compartido' | 'cancelado' | 'descargado'. */
export async function enviarArchivo(nombre, texto){
  try {
    const f = new File([texto], nombre, {type:'text/plain'});
    if(navigator.canShare && navigator.canShare({files:[f]})){ await navigator.share({files:[f], title:nombre}); return 'compartido'; }
  } catch(e){ if(e && e.name === 'AbortError') return 'cancelado'; }
  descargarTexto(nombre, texto); return 'descargado';
}
/* Igual que enviarArchivo, pero para archivos de verdad (Excel, CSV). */
export async function enviarBlob(nombre, bytes, mime){
  const blob = new Blob([bytes], {type:mime});
  try {
    const f = new File([blob], nombre, {type:mime});
    if(navigator.canShare && navigator.canShare({files:[f]})){ await navigator.share({files:[f], title:nombre}); return 'compartido'; }
  } catch(e){ if(e && e.name === 'AbortError') return 'cancelado'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'descargado';
}
export async function copiarTexto(texto){
  try { await navigator.clipboard.writeText(texto); return true; } catch(e){
    const ta = document.createElement('textarea'); ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch(e2){} ta.remove(); return ok;
  }
}
export function elegirArchivo(){
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.txt,.json,text/plain,application/json';
    i.onchange = () => { const f = i.files[0]; if(!f) return res(null); const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(f); };
    i.addEventListener('cancel', () => res(null)); i.click();
  });
}
/* Lo que llega por «Compartir» desde WhatsApp lo guarda el service worker en una bandeja. */
export async function leerBandeja(nombreCache){
  const out = [];
  try {
    const c = await caches.open(nombreCache); const llaves = await c.keys();
    for(const k of llaves){ const r = await c.match(k); out.push(await r.text()); await c.delete(k); }
  } catch(e){}
  return out;
}
