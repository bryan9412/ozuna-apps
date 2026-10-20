/* Mezcla de datos entre los teléfonos del dueño (sin pantallas, para poder probarla sola).
   Todos usan la misma llave, así que cada uno puede firmar entregas. Cada registro lleva la hora de su último cambio y al cargar un paquete
   gana el más nuevo; lo borrado deja una marca para que no reaparezca. */
const COLS = ['puestos', 'personas', 'productos', 'agregos', 'gastos', 'listas', 'dispositivos'];
const ESC = ['nombre', 'clave', 'tasas', 'tasasFecha', 'redondeo', 'fondoCents', 'preciosPend', 'margen', 'ultimaCopia'];
const hashItem = it => { const c = Object.assign({}, it); delete c._mod; return JSON.stringify(c); };
const hashEsc = N => JSON.stringify(ESC.map(k => N[k] === undefined ? null : N[k]));
const marca = r => r.mod || r.ts || r.recibidoEn || 0;

/* Se llama antes de guardar: pone la hora de cambio a lo que cambió y deja marca de lo que se borró. */
export function sellarN(N, ahora){
  ahora = ahora || Date.now(); N._h = N._h || {}; N._tomb = N._tomb || [];
  for(const c of COLS){
    N[c] = N[c] || []; const vistos = new Set();
    for(const it of N[c]){ const k = c + ':' + it.id; vistos.add(k); const hh = hashItem(it); if(N._h[k] !== hh){ it._mod = ahora; N._h[k] = hh; } }
    for(const k of Object.keys(N._h)) if(k.startsWith(c + ':') && !vistos.has(k)){ N._tomb.push({c, id:k.slice(c.length + 1), ts:ahora}); delete N._h[k]; }
  }
  if(N._tomb.length > 500) N._tomb = N._tomb.slice(-500);
  const he = hashEsc(N); if(N._hEsc !== he){ N._cfgMod = ahora; N._hEsc = he; }
}
/* Mezcla la configuración de otro teléfono (R) en la mía (N). Devuelve cuántas cosas cambiaron. */
export function fusionarN(N, R){
  let cambios = 0; N._h = N._h || {}; N._tomb = N._tomb || [];
  const tombs = new Map(); for(const t of [...N._tomb, ...(R._tomb || [])]){ const k = t.c + ':' + t.id; if(!tombs.has(k) || tombs.get(k).ts < t.ts) tombs.set(k, t); }
  for(const c of COLS){
    const loc = N[c] = N[c] || []; const mapa = new Map(loc.map(x => [x.id, x]));
    for(const r of (R[c] || [])){
      const t = tombs.get(c + ':' + r.id); if(t && t.ts >= (r._mod || 0)) continue;
      const x = mapa.get(r.id);
      if(!x){ const copia = JSON.parse(JSON.stringify(r)); loc.push(copia); mapa.set(r.id, copia); N._h[c + ':' + r.id] = hashItem(copia); cambios++; }
      else if((r._mod || 0) > (x._mod || 0)){ for(const k of Object.keys(x)) delete x[k]; Object.assign(x, JSON.parse(JSON.stringify(r))); N._h[c + ':' + r.id] = hashItem(x); cambios++; }
    }
    for(let i = loc.length - 1; i >= 0; i--){ const t = tombs.get(c + ':' + loc[i].id); if(t && t.ts > (loc[i]._mod || 0)){ delete N._h[c + ':' + loc[i].id]; loc.splice(i, 1); cambios++; } }
  }
  N._tomb = [...tombs.values()].slice(-500);
  if((R._cfgMod || 0) > (N._cfgMod || 0)){ for(const k of ESC) if(R[k] !== undefined) N[k] = JSON.parse(JSON.stringify(R[k])); N._cfgMod = R._cfgMod; N._hEsc = hashEsc(N); cambios++; }
  return cambios;
}
/* Dos versiones del mismo registro: gana la más nueva; en los cierres se juntan las marcas de «llegó» y las decisiones. */
export function fusionarRegistro(tienda, local, remoto){
  if(!local) return remoto;
  const gana = marca(remoto) > marca(local) ? remoto : local, pierde = gana === remoto ? local : remoto;
  if(tienda === 'cierres') return Object.assign({}, gana, {transfOk:Object.assign({}, pierde.transfOk || {}, gana.transfOk || {}), decisiones:Object.assign({}, pierde.decisiones || {}, gana.decisiones || {})});
  return gana;
}
export async function armarSync(db, N, desde){
  const nn = JSON.parse(JSON.stringify(N)); delete nn._h; delete nn._hEsc;
  const tomar = async t => (await db.todos(t)).filter(r => marca(r) >= desde);
  return {desde, hasta:Date.now(), N:nn, entregas:await tomar('entregas'), cierres:await tomar('cierres'), eventos:await tomar('eventos')};
}
/* Aplica un paquete de cambios. Devuelve {config, nuevos, actualizados}. */
export async function aplicarSync(db, N, p){
  const config = fusionarN(N, p.N || {}); let nuevos = 0, actualizados = 0;
  for(const t of ['entregas', 'cierres', 'eventos']) for(const r of p[t] || []){
    const loc = await db.get(t, r.id); const res = fusionarRegistro(t, loc, r);
    if(!loc){ await db.put(t, res, true); nuevos++; }
    else if(JSON.stringify(res) !== JSON.stringify(loc)){ await db.put(t, res, true); actualizados++; }
  }
  return {config, nuevos, actualizados};
}
