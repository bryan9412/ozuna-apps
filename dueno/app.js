/* App del dueño: catálogo, entrega del día, recibir cierres y ver el cuadre. Todo sin conexión. */
import * as C from '../shared/core.js';
import { h, montar, aviso, hoja, confirmar, campo, barraNav, registrarSW, selectorTema } from '../shared/ui.js';
import { cierresUltimos, eventos, ganancia, costoCup, fiadoPendiente, sumaDias } from './datos.js';
import { vTraspasos, vCompras, vGastos, vCasa, vConteo, vMerma, vFiado } from './ops.js';
import { vHistorial, vReportes, exportarExcel } from './reportes.js';
import { abrirFicha } from './ficha.js';

const VERSION_APP = '0.2.0';
const BANDEJA = 'ozuna-bandeja-dueno';
const db = new C.DB('ozuna-dueno');
let perfil, llaves, N, pantalla = 'hoy', masSub = null, fechaVista = C.hoy(), reporteId = null, desbloqueado = false, hayVersionNueva = null, tabPuesto = null;
const NAV_TODO = [['hoy', '📊', 'Hoy'], ['entrega', '📦', 'Entrega'], ['cierres', '✅', 'Cierres'], ['catalogo', '🏷️', 'Catálogo'], ['mas', '⚙️', 'Más']];
const NAV_SOLO = [['hoy', '📊', 'Hoy'], ['cierres', '✅', 'Cierres'], ['mas', '⚙️', 'Más']];
const raiz = document.getElementById('app');
const ticket = n => 'T-' + String(n).padStart(3, '0');
const guardarN = () => db.kvSet('negocio', N);
const MEDIDA_OPS = Object.keys(C.MEDIDAS);
const ROLES = ['Vendedora o vendedor', 'Pizzero', 'Cocinero', 'Encargado', 'Mensajero', 'Familiar', 'Otro'];
const BASES = ['Un porciento de lo que se vende en su puesto', 'Un porciento de lo que él produce', 'Un pago fijo al día', 'Otra forma'];
const puesto = id => N.puestos.find(p => p.id === id);
const nomPuesto = id => (puesto(id) || {nombre:'(puesto borrado)'}).nombre;

function selector(opciones, valor, cambio, vacio){
  const s = h('select', {onchange:e => cambio(e.target.value)}, vacio != null ? h('option', {value:''}, vacio) : null,
    opciones.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h('option', {value:v, selected:v === valor}, t); }));
  s.value = valor == null ? '' : valor; return s;
}
function nuevoNegocio(nombre, clave){
  return {nombre, clave, puestos:[], personas:[], productos:[], agregos:[], tasas:{}, tasasFecha:null, redondeo:500, fondoCents:400000, gastos:[], dispositivos:[]};
}

/* ---------- arranque y clave ---------- */
async function iniciar(){
  perfil = await db.kv('perfil'); llaves = await db.kv('llaves'); N = await db.kv('negocio');
  registrarSW('./sw.js', aplicar => { hayVersionNueva = aplicar; if(desbloqueado) pintar(); });
  if(!perfil || !N) return bienvenida();
  C.pedirPersistencia();
  if(!desbloqueado) return bloqueo();
  await arrancado();
}
async function arrancado(){ desbloqueado = true; await revisarBandeja(); pintar(); }
function bloqueo(){
  const pin = h('input', {type:'password', inputmode:'numeric', placeholder:'Clave', autocomplete:'off', 'aria-label':'Clave del dueño'});
  const entrar = async () => { if(await C.hashClave(pin.value, N.clave.sal) === N.clave.hash) await arrancado(); else { aviso('Esa no es la clave.', true); pin.value = ''; pin.focus(); } };
  pin.addEventListener('keydown', e => { if(e.key === 'Enter') entrar(); });
  montar(raiz, h('p', {class:'marca'}, N.nombre), h('h1', {}, 'Clave del dueño'), campo('Escribe tu clave', pin), h('button', {class:'btn', onclick:entrar}, 'Entrar'));
  montar(document.getElementById('navbox')); setTimeout(() => pin.focus(), 50);
}
function bienvenida(){
  const nombre = h('input', {placeholder:'Nombre del negocio', value:'Ozuna', autocomplete:'off'});
  const yo = h('input', {placeholder:'Tu nombre', autocomplete:'off'});
  const c1 = h('input', {type:'password', inputmode:'numeric', placeholder:'4 a 6 números'});
  const c2 = h('input', {type:'password', inputmode:'numeric', placeholder:'Repite la clave'});
  const cues = h('textarea', {class:'bloque-codigo', placeholder:'Pega aquí las respuestas del cuestionario (opcional)'});
  montar(raiz, h('h1', {}, 'Bienvenido'), h('p', {class:'ayuda'}, 'Vamos a dejar lista la aplicación del dueño. Funciona sin internet.'),
    campo('Negocio', nombre), campo('Tu nombre', yo), campo('Clave para entrar', c1, 'La necesitas cada vez que abras la aplicación y para autorizar fiados.'), campo('Repite la clave', c2),
    campo('Datos del cuestionario', cues, 'Si tienes el texto que copiaste del cuestionario, pégalo y se cargan puestos, personas, productos y precios.'),
    h('button', {class:'btn', onclick:async () => {
      if(!yo.value.trim() || !nombre.value.trim()){ aviso('Escribe el nombre del negocio y el tuyo.', true); return; }
      if(!/^\d{4,6}$/.test(c1.value)){ aviso('La clave debe tener de 4 a 6 números.', true); return; }
      if(c1.value !== c2.value){ aviso('Las dos claves no coinciden.', true); return; }
      llaves = await C.nuevasLlaves(true); perfil = {id:C.uid(), nombre:yo.value.trim(), pub:llaves.pub};
      const sal = C.nuevaSal(); N = nuevoNegocio(nombre.value.trim(), {sal, hash:await C.hashClave(c1.value, sal)});
      if(cues.value.trim()){ const r = desdeCuestionario(cues.value); if(r) aviso(r, true); else aviso('Datos del cuestionario cargados.'); }
      await db.kvSet('llaves', llaves); await db.kvSet('perfil', perfil); await guardarN(); C.pedirPersistencia();
      desbloqueado = true; pantalla = 'hoy'; pintar();
    }}, 'Empezar'),
    h('div', {class:'card', style:'margin-top:18px'}, h('h3', {}, '¿Eres de la familia?'), h('p', {class:'ayuda'}, 'Si solo quieres ver las cuentas, carga la copia que te mande el dueño. No podrás cambiar nada.'),
      h('button', {class:'btn suave', onclick:abrirConsulta}, 'Cargar una copia para ver')));
  montar(document.getElementById('navbox'));
}
/* Devuelve null si todo bien, o el texto del problema. */
function desdeCuestionario(txt){
  let d; try { d = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)); } catch(e){ return 'El texto del cuestionario está incompleto.'; }
  if(!d || d.app !== 'cuestionario-ozuna' || !d.respuestas) return 'Ese texto no es del cuestionario de Ozuna.';
  const r = d.respuestas; const med = {Unidad:'unidad', Libra:'libra', Kilo:'kilo', Paquete:'paquete', 'Porción':'porcion', Vaso:'vaso', Otra:'unidad'};
  N.puestos = (r.puestos || []).map(p => ({id:p.id, nombre:p.nombre, tipos:p.tipos || [], lugar:p.lugar || ''}));
  N.personas = (r.personas || []).map(p => ({id:p.id, nombre:p.nombre, rol:p.rol, puestoId:p.puesto || '', pct:p.pct || '', base:p.base || ''}));
  N.productos = (r.productos || []).filter(p => p.nombre).map(p => { const pr = C.aCentavos(p.precio), co = C.aCentavos(p.costo);
    return {id:C.uid(), puestoId:p.puesto || '', nombre:p.nombre, medida:med[p.medida] || 'unidad', precioCents:isNaN(pr) ? 0 : pr, moneda:'CUP', costoCents:isNaN(co) ? null : co, costoMoneda:'CUP',
      admiteAgregos:/pizza/i.test(p.nombre), controlStock:!/pizza/i.test(p.nombre), activo:true}; });
  N.agregos = (r.agregos || []).filter(a => a.nombre).map(a => ({id:C.uid(), nombre:a.nombre, precioCents:C.aCentavos(a.precio) || 0}));
  const t = C.aCentavos(r.tasaHoy); if(!isNaN(t) && t > 0 && (r.monedas || []).includes('Dólares')) N.tasas.USD = t;
  const f = C.aCentavos(r.fondo); if(!isNaN(f)) N.fondoCents = f;
  N.gastos = (r.gastos || []).filter(g => g.nombre).map(g => ({id:C.uid(), nombre:g.nombre, montoCents:C.aCentavos(g.monto) || 0, ambito:g.amb || '', puestoId:g.puesto || ''}));
  return null;
}

/* ---------- pintado ---------- */
function pintar(){
  const solo = !!(perfil && perfil.consulta);
  if(solo && (pantalla === 'entrega' || pantalla === 'catalogo')) pantalla = 'hoy';
  const v = {hoy:vHoy, entrega:vEntrega, cierres:vCierres, catalogo:vCatalogo, mas:vMas};
  (v[pantalla] || vHoy)();
  montar(document.getElementById('navbox'), barraNav(solo ? NAV_SOLO : NAV_TODO, pantalla, p => { pantalla = p; reporteId = null; masSub = null; pintar(); window.scrollTo(0, 0); }));
}
const banner = () => hayVersionNueva ? h('div', {class:'banner'}, 'Hay una versión nueva', h('button', {onclick:hayVersionNueva}, 'Actualizar')) : null;
const filaDato = (t, v, cls) => h('div', {class:'lin'}, h('span', {}, t), h('b', {class:'num ' + (cls || '')}, v));
/* Lo que comparten las pantallas que viven en otros archivos (ops.js, reportes.js, ficha.js). */
const ctx = {db, get N(){ return N; }, get perfil(){ return perfil; }, get llaves(){ return llaves; }, get SOLO(){ return !!(perfil && perfil.consulta); }, get raiz(){ return raiz; },
  guardarN, pintar, selector, puesto, nomPuesto, banner, filaDato,
  volver(){ masSub = null; pintar(); window.scrollTo(0, 0); }, ir(s){ masSub = s; pintar(); window.scrollTo(0, 0); }};
async function revisarBandeja(){ for(const t of await C.leerBandeja(BANDEJA)) await procesarTexto(t); }
function cajaCarga(titulo, ayuda){
  return h('div', {class:'card'}, h('h3', {}, titulo), ayuda ? h('p', {class:'ayuda'}, ayuda) : null,
    h('button', {class:'btn', onclick:async () => { const t = await C.elegirArchivo(); if(t) await procesarTexto(t); }}, 'Elegir el archivo que llegó'),
    h('button', {class:'enlace', onclick:() => hoja('Pegar el mensaje', cerrar => { const ta = h('textarea', {class:'bloque-codigo'});
      return h('div', {}, h('p', {class:'ayuda'}, 'En WhatsApp mantén el dedo sobre el mensaje, toca Copiar y pégalo aquí.'), ta, h('button', {class:'btn', onclick:async () => { cerrar(); await procesarTexto(ta.value); }}, 'Cargar')); })}, 'Me llegó como mensaje: pegarlo'));
}
async function procesarTexto(txt){
  const env = C.leerTexto(txt);
  if(!env){ aviso('Eso no es un archivo de Ozuna.', true); return; }
  if(ctx.SOLO){ aviso('Esta aplicación es solo de consulta. Pídele al dueño una copia nueva.', true); return; }
  if(env.tipo === 'enlace') return recibirEnlace(env);
  if(env.tipo === 'cierre') return recibirCierre(env);
  aviso('Ese archivo es para la vendedora, no para ti.', true);
}

/* ---------- equipo: enlazar teléfonos ---------- */
async function recibirEnlace(env){
  const v = await C.verificarSobre(env); if(!v.ok){ aviso(v.motivo, true); return; }
  const f = await C.huella(env.de.pub); const ya = N.dispositivos.find(d => d.id === env.de.id);
  hoja(ya ? 'Actualizar teléfono' : 'Nuevo teléfono', cerrar => {
    let pid = ya ? ya.puestoId : (N.puestos[0] || {}).id || '';
    return h('div', {}, h('p', {}, h('b', {}, env.payload.nombre), ' quiere enlazarse (huella ', h('b', {}, f), ').'),
      h('p', {class:'ayuda'}, 'Confirma con ella, por WhatsApp o en persona, que esa huella aparece en su teléfono en «Más».'),
      N.puestos.length ? campo('¿En qué puesto trabaja?', selector(N.puestos.map(p => [p.id, p.nombre]), pid, x => pid = x)) : h('p', {class:'mal'}, 'Primero crea los puestos en Más → Equipo.'),
      h('button', {class:'btn', onclick:async () => {
        if(!pid){ aviso('Elige el puesto.', true); return; }
        const d = {id:env.de.id, nombre:env.payload.nombre, pub:env.de.pub, huella:f, puestoId:pid};
        const i = N.dispositivos.findIndex(x => x.id === d.id); if(i >= 0) N.dispositivos[i] = d; else N.dispositivos.push(d);
        await guardarN(); cerrar(); aviso('Enlazado. Ya puedes mandarle una entrega.'); pintar();
      }}, ya ? 'Actualizar' : 'Enlazar'));
  });
}

/* ---------- hoy ---------- */
async function entregasDe(fecha){ return (await db.todos('entregas')).filter(e => e.fecha === fecha); }
async function cierresDe(fecha){ const t = await db.todos('cierres'); return t.filter(c => c.fecha === fecha); }
function ultimosCierres(lista){ const m = {}; for(const c of lista){ const k = c.entregaId; if(!m[k] || c.version > m[k].version) m[k] = c; } return Object.values(m); }
async function vHoy(){
  const fecha = fechaVista; const ent = await entregasDe(fecha); const cie = ultimosCierres(await cierresDe(fecha));
  const fAyer = sumaDias(fecha, -1);
  const cieAyer = ultimosCierres(await cierresDe(fAyer));
  const netoDe = c => C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents).netoCup;
  const totalHoy = cie.reduce((s, c) => s + netoDe(c), 0), totalAyer = cieAyer.reduce((s, c) => s + netoDe(c), 0);
  const gans = cie.map(c => ganancia(N, c)); const ganTotal = gans.reduce((s, g) => s + g.ganancia, 0); const sinCosto = [...new Set(gans.flatMap(g => g.sinCosto))];
  const debe = (await fiadoPendiente(db)).reduce((s, x) => s + Math.max(0, x.debe), 0);
  const nCierres = (await db.todos('cierres')).length;
  const diasCopia = N.ultimaCopia ? Math.floor((Date.now() - new Date(N.ultimaCopia).getTime()) / 864e5) : null;
  const pedirCopia = !ctx.SOLO && nCierres > 0 && (diasCopia == null || diasCopia >= 7);
  const tarjetas = N.puestos.map(p => {
    const e = ent.filter(x => x.puestoId === p.id), c = cie.filter(x => x.puestoId === p.id);
    const neto = c.reduce((s, x) => s + netoDe(x), 0);
    const falt = c.map(x => { const q = C.calcularCuadre(x.ventas, x.solicitudes, x.fondoCents); return x.contado.CUP != null ? x.contado.CUP - q.esperado.CUP : null; }).filter(d => d != null);
    const com = c.length ? C.comisiones(N.personas, p.id, neto) : [];
    return h('div', {class:'card'}, h('div', {class:'fila'}, h('h3', {}, p.nombre), h('span', {class:'etq ' + (c.length ? '' : e.length ? 'warn' : 'bad')}, c.length ? 'Cierre recibido' : e.length ? 'Falta el cierre' : 'Sin entrega')),
      c.length ? [filaDato('Ventas netas', C.dinero(neto) + ' CUP'), falt.length ? filaDato(falt[0] === 0 ? 'La caja cuadra' : falt[0] < 0 ? 'Falta dinero' : 'Sobra dinero', C.dinero(Math.abs(falt[0])), falt[0] === 0 ? 'bien' : 'mal') : filaDato('Caja', 'Sin contar', 'mal'),
        com.map(x => filaDato('Comisión de ' + x.nombre + ' (' + x.pct + ' %)', C.dinero(x.cup))),
        h('button', {class:'enlace', onclick:() => { reporteId = c[0].id; pantalla = 'cierres'; pintar(); window.scrollTo(0, 0); }}, 'Ver el cierre')] : null);
  });
  const fecha0 = h('input', {type:'date', value:fecha, onchange:e => { fechaVista = e.target.value || C.hoy(); pintar(); }, 'aria-label':'Fecha'});
  const sinTasa = Object.keys(N.tasas).length && N.tasasFecha !== C.hoy();
  const sabado = !ctx.SOLO && new Date().getDay() === 6 && fecha === C.hoy();
  montar(raiz, banner(), h('p', {class:'marca'}, N.nombre + (ctx.SOLO ? ' · solo consulta' : '')), h('h1', {}, 'Resumen del día'), campo('Fecha', fecha0),
    sinTasa && !ctx.SOLO ? h('div', {class:'card aviso-c'}, h('b', {}, 'No has confirmado el cambio de hoy.'), h('p', {}, 'Los precios en dólares se calculan con el cambio que pongas en el catálogo.'), h('button', {class:'btn chico suave', onclick:() => { pantalla = 'catalogo'; pintar(); }}, 'Poner el cambio')) : null,
    sabado ? h('div', {class:'card aviso-c'}, h('b', {}, 'Hoy es sábado: toca contar.'), h('button', {class:'btn chico suave', style:'margin-top:8px', onclick:() => { pantalla = 'mas'; masSub = 'conteo'; pintar(); }}, 'Hacer el conteo')) : null,
    pedirCopia ? h('div', {class:'card aviso-c'}, h('b', {}, diasCopia == null ? 'Todavía no has hecho una copia de seguridad.' : 'Hace ' + diasCopia + ' días que no haces una copia.'), h('button', {class:'btn chico suave', style:'margin-top:8px', onclick:copiar}, 'Mandarme una copia')) : null,
    h('div', {class:'total'}, h('span', {}, 'Vendido (cierres recibidos)'), h('b', {class:'num'}, C.dinero(totalHoy))),
    cieAyer.length ? h('p', {class:'ayuda'}, 'Ayer: ' + C.dinero(totalAyer) + (totalAyer ? ' · ' + (totalHoy >= totalAyer ? '+' : '') + Math.round((totalHoy - totalAyer) / totalAyer * 100) + ' %' : '')) : null,
    cie.length ? h('div', {class:'card'}, filaDato('Ganancia aproximada', C.dinero(ganTotal), ganTotal < 0 ? 'mal' : 'bien'), sinCosto.length ? h('p', {class:'ayuda'}, 'No cuenta el costo de: ' + sinCosto.join(', ') + '. Ponlo en el catálogo.') : null,
      debe ? filaDato('Te deben (fiado)', C.dinero(debe)) : null,
      h('button', {class:'btn chico', style:'margin-top:8px', onclick:() => exportarExcel(ctx, fecha, fecha)}, 'Mandar el reporte del día (Excel)')) : null,
    N.puestos.length ? tarjetas : h('div', {class:'card aviso-c'}, 'Todavía no hay puestos. Créalos en Más → Equipo, o carga el cuestionario en Más.'));
}

/* ---------- entrega y reposición ---------- */
function catalogoDe(pid){ return N.productos.filter(p => p.puestoId === pid && p.activo !== false); }
function catalogoPayload(pid){ return catalogoDe(pid).map(p => ({id:p.id, nombre:p.nombre, medida:p.medida, precioCents:C.precioEnCup(p, N.tasas, N.redondeo), admiteAgregos:!!p.admiteAgregos, controlStock:!!p.controlStock})); }
async function vEntrega(){
  const conTel = N.puestos.filter(p => N.dispositivos.some(d => d.puestoId === p.id));
  if(!conTel.length){ montar(raiz, banner(), h('h1', {}, 'Entrega'), h('div', {class:'card aviso-c'}, 'Primero enlaza el teléfono de una vendedora en Más → Equipo.')); return; }
  const st = vEntrega.st = vEntrega.st || {pid:conTel[0].id, modo:'entrega', fecha:C.hoy(), cant:{}, fondo:null};
  if(!conTel.some(p => p.id === st.pid)) st.pid = conTel[0].id;
  const dispos = N.dispositivos.filter(d => d.puestoId === st.pid); st.did = st.did && dispos.some(d => d.id === st.did) ? st.did : dispos[0].id;
  const prods = catalogoDe(st.pid); const conStock = prods.filter(p => p.controlStock);
  const miss = prods.filter(p => !p.precioCents || (p.moneda === 'USD' && !N.tasas.USD) || isNaN(C.precioEnCup(p, N.tasas, N.redondeo)));
  const hoyEnts = (await entregasDe(st.fecha)).filter(e => e.dispositivoId === st.did);
  const fondoStr = st.fondo != null ? st.fondo : String(N.fondoCents / 100);
  const filas = conStock.map(p => h('div', {class:'card'}, h('div', {class:'fila'}, h('div', {}, h('b', {}, p.nombre), h('div', {class:'ayuda num'}, C.dinero(C.precioEnCup(p, N.tasas, N.redondeo)) + ' la ' + C.nombreMedida(p.medida, 1000))),
    h('input', {inputmode:'decimal', placeholder:'0', style:'max-width:120px;text-align:right', value:st.cant[p.id] || '', 'aria-label':'Cantidad de ' + p.nombre, oninput:e => { st.cant[p.id] = e.target.value; }}))));
  montar(raiz, banner(), h('h1', {}, 'Entrega'),
    h('div', {class:'opts'}, h('button', {class:'op', 'aria-pressed':st.modo === 'entrega', onclick:() => { st.modo = 'entrega'; pintar(); }}, 'Entrega del día'), h('button', {class:'op', 'aria-pressed':st.modo === 'reposicion', onclick:() => { st.modo = 'reposicion'; pintar(); }}, 'Reposición')),
    campo('Puesto', selector(conTel.map(p => [p.id, p.nombre]), st.pid, v => { st.pid = v; st.cant = {}; pintar(); })),
    dispos.length > 1 ? campo('Teléfono', selector(dispos.map(d => [d.id, d.nombre]), st.did, v => { st.did = v; pintar(); })) : h('p', {class:'ayuda'}, 'Para ' + dispos[0].nombre),
    campo('Fecha', h('input', {type:'date', value:st.fecha, onchange:e => { st.fecha = e.target.value || C.hoy(); pintar(); }})),
    st.modo === 'entrega' ? campo('Dinero suelto para el vuelto (pesos)', h('input', {inputmode:'decimal', value:fondoStr, oninput:e => { st.fondo = e.target.value; }})) : null,
    miss.length ? h('div', {class:'card aviso-c'}, 'Faltan precios o el cambio del dólar en: ' + miss.map(p => p.nombre).join(', ') + '. Arréglalo en Catálogo.') : null,
    Object.keys(N.tasas).length && N.tasasFecha !== C.hoy() ? h('div', {class:'card aviso-c'}, 'Ojo: el cambio del dólar no está confirmado hoy (' + Object.entries(N.tasas).map(([m, t]) => m + ' ' + C.dinero(t)).join(', ') + ').') : null,
    st.modo === 'entrega' ? h('button', {class:'btn suave', onclick:async () => { const q = await ultimoRestante(st.did); if(!q){ aviso('No hay un cierre anterior de este teléfono.', true); return; } st.cant = {}; for(const p of conStock){ const r = q[p.id]; if(r && r > 0) st.cant[p.id] = C.cantidad(r); } aviso('Puse lo que sobró del último cierre'); pintar(); }}, 'Poner lo que sobró del último cierre') : null,
    h('h2', {}, st.modo === 'entrega' ? 'Lo que le das' : 'Lo que le llevas ahora'), conStock.length ? filas : h('p', {class:'ayuda'}, 'No hay productos con control de cantidad en este puesto.'),
    prods.length > conStock.length ? h('p', {class:'ayuda'}, 'Se venden sin límite: ' + prods.filter(p => !p.controlStock).map(p => p.nombre).join(', ') + '.') : null,
    st.modo === 'reposicion' && !hoyEnts.length ? h('div', {class:'card aviso-c'}, 'No hay una entrega de esta fecha para este teléfono. Haz primero la entrega del día.') : null,
    h('button', {class:'btn', onclick:() => generarEntrega(st, hoyEnts)}, st.modo === 'entrega' ? 'Generar y mandar la entrega' : 'Generar y mandar la reposición'));
}
async function ultimoRestante(did){
  const lista = ultimosCierres((await db.todos('cierres')).filter(c => c.dispositivoId === did)).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.cerradoEn - a.cerradoEn); if(!lista.length) return null;
  const out = {}; for(const [id, r] of Object.entries(lista[0].restante || {})) out[id] = r.entregado - r.vendido; return out;
}
async function generarEntrega(st, hoyEnts){
  const prods = catalogoDe(st.pid);
  const cant = {}; for(const p of prods.filter(x => x.controlStock)){ const m = C.aMilesimas(st.cant[p.id]); if(st.cant[p.id] && !isNaN(m) && m > 0) cant[p.id] = m; else if(st.cant[p.id] && isNaN(m)){ aviso('Revisa la cantidad de ' + p.nombre, true); return; } }
  const malos = prods.filter(p => isNaN(C.precioEnCup(p, N.tasas, N.redondeo)) || !C.precioEnCup(p, N.tasas, N.redondeo)); if(malos.length){ aviso('Faltan precios: ' + malos.map(p => p.nombre).join(', '), true); return; }
  const d = N.dispositivos.find(x => x.id === st.did); const pu = puesto(st.pid);
  let env, nombre;
  if(st.modo === 'entrega'){
    const f = C.aCentavos(st.fondo != null ? st.fondo : String(N.fondoCents / 100)); if(isNaN(f) || f < 0){ aviso('Revisa el dinero suelto', true); return; }
    if(!Object.keys(cant).length && prods.some(p => p.controlStock)){ const si = await confirmar('No pusiste cantidades', 'La vendedora recibiría el catálogo pero ningún producto con cantidad.', 'Mandarla así', 'Volver'); if(!si) return; }
    const payload = {entregaId:C.uid(), fecha:st.fecha, puesto:{id:pu.id, nombre:pu.nombre}, dispositivoId:d.id, fondoCents:f, tasas:Object.assign({}, N.tasas), catalogo:catalogoPayload(st.pid), agregos:N.agregos.map(a => ({id:a.id, nombre:a.nombre, precioCents:a.precioCents})), cantidades:cant, clave:N.clave, listas:(N.listas || []).map(l => ({id:l.id, nombre:l.nombre, pct:l.pct})), mensajeros:N.personas.filter(x => x.rol === 'Mensajero').map(x => x.nombre)};
    env = await C.firmarSobre('entrega', perfil, d.id, payload, llaves.privateKey);
    await db.put('entregas', {id:payload.entregaId, fecha:st.fecha, puestoId:pu.id, dispositivoId:d.id, ts:Date.now(), fondoCents:f, cantidades:cant});
    nombre = 'entrega-' + pu.nombre.replace(/[^\wáéíóúñ]+/gi, '-').toLowerCase() + '-' + st.fecha + '.txt';
  } else {
    if(!hoyEnts.length){ aviso('Haz primero la entrega del día.', true); return; }
    if(!Object.keys(cant).length){ aviso('Pon al menos una cantidad para la reposición.', true); return; }
    const base = hoyEnts.sort((a, b) => b.ts - a.ts)[0];
    const payload = {entregaId:base.id, dispositivoId:d.id, cantidades:cant, catalogo:catalogoPayload(st.pid), agregos:N.agregos.map(a => ({id:a.id, nombre:a.nombre, precioCents:a.precioCents})), tasas:Object.assign({}, N.tasas),
      listas:(N.listas || []).map(l => ({id:l.id, nombre:l.nombre, pct:l.pct})), mensajeros:N.personas.filter(x => x.rol === 'Mensajero').map(x => x.nombre)};
    env = await C.firmarSobre('reposicion', perfil, d.id, payload, llaves.privateKey);
    base.cantidades = Object.assign({}, base.cantidades); /* la reposición también lleva precios, listas y mensajeros al día */ for(const [k, v] of Object.entries(cant)) base.cantidades[k] = (base.cantidades[k] || 0) + v; await db.put('entregas', base);
    nombre = 'reposicion-' + pu.nombre.replace(/[^\wáéíóúñ]+/gi, '-').toLowerCase() + '-' + C.horaDe(Date.now()).replace(':', '') + '.txt';
  }
  const r = await C.enviarArchivo(nombre, C.sobreATexto(env));
  if(r !== 'cancelado'){ aviso(r === 'compartido' ? 'Listo. Si lo mandaste por WhatsApp, ya llegó.' : 'Se guardó en Descargas. En WhatsApp: clip, Documento.'); vEntrega.st.cant = {}; pintar(); }
}

/* ---------- cierres ---------- */
async function recibirCierre(env){
  const d = N.dispositivos.find(x => x.id === env.de.id);
  if(!d){ aviso('Ese cierre es de un teléfono que no está enlazado.', true); return; }
  const v = await C.verificarSobre(env, d.pub); if(!v.ok){ aviso(v.motivo, true); return; }
  if(await db.get('cierres', env.id)){ aviso('Ese cierre ya estaba cargado.'); return; }
  const p = env.payload; const cad = await C.verificarCadena(p.ventas);
  const rec = {id:env.id, entregaId:p.entregaId, fecha:p.fecha, puestoId:d.puestoId, puestoNombre:p.puesto.nombre, dispositivoId:d.id, vendedora:p.vendedorNombre, version:p.version, cerradoEn:p.cerradoEn, recibidoEn:Date.now(),
    fondoCents:p.fondoCents, ventas:p.ventas, solicitudes:p.solicitudes, contado:p.contado, restante:p.restante, capturas:p.capturas || {}, cadenaOk:cad.ok, cadenaMotivo:cad.motivo || '', puestoCoincide:p.puesto.id === d.puestoId, transfOk:{}, decisiones:{}};
  const previo = (await db.todos('cierres')).filter(c => c.entregaId === rec.entregaId);
  const ultimo = previo.sort((a, b) => b.version - a.version)[0];
  if(ultimo){ rec.transfOk = ultimo.transfOk || {}; rec.decisiones = ultimo.decisiones || {}; }
  await db.put('cierres', rec); aviso(cad.ok ? 'Cierre cargado.' : 'Cierre cargado, pero con un problema en las ventas.', !cad.ok);
  fechaVista = rec.fecha; reporteId = rec.id; pantalla = 'cierres'; pintar(); window.scrollTo(0, 0);
}
async function vCierres(){
  if(reporteId) return vReporte();
  const todos = (await db.todos('cierres')).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.recibidoEn - a.recibidoEn);
  const ult = ultimosCierres(todos).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.recibidoEn - a.recibidoEn);
  montar(raiz, banner(), h('h1', {}, 'Cierres'), ctx.SOLO ? null : cajaCarga('Cargar un cierre', 'Cuando la vendedora mande su cierre por WhatsApp, cárgalo aquí.'),
    h('h2', {}, 'Recibidos'), ult.length ? ult.map(c => { const q = C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents);
      return h('button', {class:'card', style:'display:block;width:100%;text-align:left', onclick:() => { reporteId = c.id; pintar(); window.scrollTo(0, 0); }},
        h('div', {class:'fila'}, h('b', {}, C.fechaBonita(c.fecha) + ' · ' + c.puestoNombre), h('b', {class:'num'}, C.dinero(q.netoCup))),
        h('div', {class:'ayuda'}, c.vendedora + ' · versión ' + c.version + (c.cadenaOk ? '' : ' · con problemas'))); }) : h('div', {class:'card'}, 'Todavía no has recibido cierres.'));
}
async function vReporte(){
  const c = await db.get('cierres', reporteId); if(!c){ reporteId = null; return vCierres(); }
  const q = C.calcularCuadre(c.ventas, c.solicitudes, c.fondoCents); const g = ganancia(N, c);
  const versiones = (await db.todos('cierres')).filter(x => x.entregaId === c.entregaId).length;
  const monedas = Object.keys(q.esperado); const SOLO = ctx.SOLO;
  const mermas = (await eventos(db, 'merma', c.fecha, c.fecha)).filter(m => m.donde === c.puestoId);
  const mermaDe = nombre => mermas.filter(m => m.nombre.trim().toLowerCase() === nombre.trim().toLowerCase()).reduce((s, m) => s + m.qtyMilli, 0);
  const cuadre = monedas.map(m => { const cont = c.contado[m]; const d = cont != null ? cont - q.esperado[m] : null;
    const contar = () => hoja('Contar el efectivo en ' + m, cerrar => { const inp = h('input', {inputmode:'decimal', placeholder:'0'}); return h('div', {}, h('p', {class:'ayuda'}, 'Debe haber ' + C.dinero(q.esperado[m], m) + '.'), campo('Lo que cuentas', inp),
      h('button', {class:'btn', onclick:async () => { const v = C.aCentavos(inp.value); if(isNaN(v) || v < 0){ aviso('Revisa la cantidad', true); return; } c.contado[m] = v; c.contadoPor = 'dueno'; await db.put('cierres', c); cerrar(); pintar(); }}, 'Guardar')); });
    return h('div', {class:'lin'}, h('span', {}, 'Efectivo ' + m, h('div', {class:'d ayuda num'}, 'Debe haber ' + C.dinero(q.esperado[m]) + ' · contó ' + (cont != null ? C.dinero(cont) + (c.contadoPor === 'dueno' ? ' (lo contaste tú)' : '') : 'nada'))),
      d == null ? (SOLO ? h('b', {}, 'Sin contar') : h('button', {class:'btn chico', onclick:contar}, 'Contar yo')) : h('b', {class:'num ' + (d === 0 ? 'bien' : 'mal')}, d === 0 ? 'Cuadra' : (d < 0 ? 'Faltan ' : 'Sobran ') + C.dinero(Math.abs(d), m))); });
  const stock = Object.entries(c.restante || {}).map(([id, r]) => { const p = N.productos.find(x => x.id === id); const mm = p ? mermaDe(p.nombre) : 0; const quedan = r.entregado - r.vendido - mm;
    return h('tr', {}, h('td', {}, p ? p.nombre : id.slice(0, 6)), h('td', {class:'num'}, C.cantidad(r.entregado)), h('td', {class:'num'}, C.cantidad(r.vendido)), h('td', {class:'num'}, mm ? C.cantidad(mm) : ''), h('td', {class:'num ' + (quedan < 0 ? 'mal' : '')}, C.cantidad(quedan))); });
  const com = C.comisiones(N.personas, c.puestoId, q.netoCup);
  const trans = q.transferencias.map(t => h('label', {class:'lin', style:'cursor:pointer'}, h('span', {}, ticket(t.num) + ' · ' + C.horaDe(t.hora) + ' · ' + (t.metodo === 'qr' ? 'QR' : 'Transferencia'), h('div', {class:'d num'}, C.dinero(t.cup) + (c.capturas[t.ventaId] ? ' · mandó captura' : ' · sin captura'))),
    h('span', {}, 'Llegó ', h('input', {type:'checkbox', disabled:SOLO, style:'width:26px;min-height:26px;vertical-align:middle', checked:!!c.transfOk[t.ventaId], onchange:async e => { c.transfOk[t.ventaId] = e.target.checked; await db.put('cierres', c); }}))));
  const sol = (c.solicitudes || []).map(s => { const dec = c.decisiones[s.id];
    return h('div', {class:'card'}, h('div', {class:'fila top'}, h('div', {}, h('b', {}, (s.tipo === 'devolucion' ? 'Devolución' : 'Anulación') + ' del ' + ticket(s.num)), h('div', {class:'ayuda'}, s.motivo + ' · devolvió ' + C.dinero(s.efectivoDevueltoCents))),
        dec ? h('span', {class:'etq ' + (dec === 'aprobada' ? '' : 'bad')}, dec) : h('span', {class:'etq warn'}, 'pendiente')),
      SOLO ? null : h('div', {class:'opts'}, ['aprobada', 'rechazada'].map(x => h('button', {class:'op', 'aria-pressed':dec === x, onclick:async () => { c.decisiones[s.id] = x; await db.put('cierres', c); pintar(); }}, x === 'aprobada' ? 'Aprobar' : 'Rechazar')))); });
  const fiado = q.fiado.map(f => filaDato(ticket(f.num) + ' · ' + (f.cliente || 'sin nombre'), C.dinero(f.cup)));
  const domi = c.ventas.filter(v => v.domicilio).map(v => h('div', {class:'lin'}, h('span', {}, ticket(v.num) + ' · ' + v.domicilio.direccion, h('div', {class:'d'}, v.domicilio.mensajero ? 'Mensajero: ' + v.domicilio.mensajero : 'Sin mensajero')), h('b', {class:'num'}, C.dinero(v.totalCents))));
  const especiales = c.ventas.flatMap(v => v.lineas.filter(l => l.lista).map(l => filaDato(ticket(v.num) + ' · ' + l.nombre + ' (' + l.lista + ')', C.dinero(l.precioCents) + ' en vez de ' + C.dinero(l.precioBaseCents))));
  const tras = (c.traspasos || []).map(t => filaDato((t.sentido === 'salida' ? 'Salió hacia ' : 'Entró desde ') + t.contra, t.items.map(i => { const p = N.productos.find(x => x.id === i.productoId); return (p ? p.nombre : '?') + ' ' + C.cantidad(i.qtyMilli); }).join(', ')));
  const ventas = c.ventas.map(v => h('div', {class:'lin'}, h('span', {}, ticket(v.num) + ' · ' + C.horaDe(v.ts), h('div', {class:'d'}, v.lineas.map(l => l.nombre + ' ×' + C.cantidad(l.qtyMilli)).join(', '))), h('b', {class:'num'}, C.dinero(v.totalCents))));
  montar(raiz, banner(), h('button', {class:'enlace', onclick:() => { reporteId = null; pintar(); }}, '‹ Volver a los cierres'),
    h('p', {class:'marca'}, c.puestoNombre + ' · ' + c.vendedora), h('h1', {}, C.fechaBonita(c.fecha)),
    h('div', {class:'opts'}, h('span', {class:'etq'}, 'Firma correcta ✓'), h('span', {class:'etq ' + (c.cadenaOk ? '' : 'bad')}, c.cadenaOk ? 'Ventas sin cambios ✓' : 'Problema en las ventas'), h('span', {class:'etq'}, 'Versión ' + c.version + (versiones > 1 ? ' de ' + versiones : '')), c.puestoCoincide ? null : h('span', {class:'etq bad'}, 'Puesto distinto al enlazado')),
    c.cadenaOk ? null : h('div', {class:'card malo', style:'margin-top:10px'}, c.cadenaMotivo),
    h('div', {class:'total'}, h('span', {}, 'Ventas netas'), h('b', {class:'num'}, C.dinero(q.netoCup))),
    h('div', {class:'card', style:'margin-top:10px'}, filaDato('Vendido', C.dinero(q.ventasCup)), q.devueltoCup ? filaDato('Devuelto', '-' + C.dinero(q.devueltoCup)) : null,
      filaDato('Efectivo', C.dinero(q.porMetodo.efectivo || 0)), filaDato('Transferencia y QR', C.dinero((q.porMetodo.transferencia || 0) + (q.porMetodo.qr || 0))), q.porMetodo.fiado ? filaDato('Fiado', C.dinero(q.porMetodo.fiado)) : null),
    h('h2', {}, 'Cuadre de la caja'), h('div', {class:'card'}, cuadre),
    h('h2', {}, 'Ganancia aproximada'), h('div', {class:'card'}, filaDato('Ventas netas', C.dinero(g.neto)), filaDato('Costo de lo vendido', '-' + C.dinero(g.costo)), filaDato('Comisiones', '-' + C.dinero(g.comisiones)), filaDato('Ganancia', C.dinero(g.ganancia), g.ganancia < 0 ? 'mal' : 'bien'),
      g.sinCosto.length ? h('p', {class:'ayuda'}, 'No cuenta el costo de: ' + g.sinCosto.join(', ') + '.') : null),
    com.length ? [h('h2', {}, 'Comisiones'), h('div', {class:'card'}, com.map(x => filaDato(x.nombre + ' (' + x.pct + ' %)', C.dinero(x.cup))))] : null,
    trans.length ? [h('h2', {}, 'Transferencias y QR'), SOLO ? null : h('p', {class:'ayuda'}, 'Marca las que ya viste llegar a tu cuenta.'), h('div', {class:'card'}, trans)] : null,
    sol.length ? [h('h2', {}, 'Pedidos de la vendedora'), sol] : null,
    especiales.length ? [h('h2', {}, 'Precios especiales'), h('div', {class:'card'}, especiales)] : null,
    domi.length ? [h('h2', {}, 'Domicilios'), h('div', {class:'card'}, domi)] : null,
    tras.length ? [h('h2', {}, 'Traspasos'), h('div', {class:'card'}, tras)] : null,
    fiado.length ? [h('h2', {}, 'Fiado'), h('div', {class:'card'}, fiado)] : null,
    stock.length ? [h('h2', {}, 'Lo que queda'), h('div', {class:'card tabla'}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Producto'), h('th', {}, 'Entregado'), h('th', {}, 'Vendido'), h('th', {}, 'Merma'), h('th', {}, 'Queda'))), h('tbody', {}, stock)))] : null,
    h('h2', {}, 'Cada venta (' + c.ventas.length + ')'), h('div', {class:'card'}, ventas));
}

/* ---------- catálogo ---------- */
function vCatalogo(){
  if(!N.puestos.length){ montar(raiz, banner(), h('h1', {}, 'Catálogo'), h('div', {class:'card aviso-c'}, 'Primero crea los puestos en Más → Equipo.')); return; }
  tabPuesto = tabPuesto && puesto(tabPuesto) ? tabPuesto : N.puestos[0].id;
  const prods = N.productos.filter(p => p.puestoId === tabPuesto);
  montar(raiz, banner(), h('h1', {}, 'Catálogo'),
    h('div', {class:'card'}, h('h3', {}, 'Cambio del día'), h('p', {class:'ayuda'}, 'Pesos por cada moneda. Se usa para precios en dólares y para cobrar en otras monedas. Confírmalo cada mañana.'), tasasEditor()),
    h('div', {class:'opts'}, N.puestos.map(p => h('button', {class:'op', 'aria-pressed':p.id === tabPuesto, onclick:() => { tabPuesto = p.id; pintar(); }}, p.nombre))),
    h('h2', {}, 'Productos de ' + nomPuesto(tabPuesto)),
    prods.length ? prods.map(p => { const cc = costoCup(N, p), pc = C.precioEnCup(p, N.tasas, N.redondeo);
      return h('button', {class:'card', style:'display:block;width:100%;text-align:left;' + (p.activo === false ? 'opacity:.5' : ''), onclick:() => editarProducto(p)},
        h('div', {class:'fila'}, h('b', {}, p.nombre), h('b', {class:'num'}, C.dinero(p.precioCents, p.moneda === 'USD' ? 'USD' : '') + (p.moneda === 'USD' && N.tasas.USD ? ' ≈ ' + C.dinero(pc) : ''))),
        h('div', {class:'ayuda'}, 'por ' + C.MEDIDAS[p.medida].s + (p.controlStock ? ' · con cantidad' : ' · sin límite') + (p.admiteAgregos ? ' · con agregos' : '') + (p.activo === false ? ' · oculto' : '') + (cc != null && pc ? ' · gana ' + C.dinero(pc - cc) : ' · sin costo'))); }) : h('div', {class:'card'}, 'Este puesto no tiene productos. Añade el primero.'),
    h('button', {class:'btn', onclick:() => editarProducto({id:C.uid(), puestoId:tabPuesto, nombre:'', medida:'unidad', precioCents:0, moneda:'CUP', costoCents:null, costoMoneda:'CUP', admiteAgregos:false, controlStock:true, activo:true}, true)}, '+ Añadir producto'),
    h('h2', {}, 'Agregos de la pizza'), N.agregos.map(a => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, a.nombre), h('b', {class:'num'}, C.dinero(a.precioCents)),
      h('button', {class:'enlace', onclick:() => editarAgrego(a)}, 'Editar')))),
    h('button', {class:'btn suave', onclick:() => editarAgrego({id:C.uid(), nombre:'', precioCents:0}, true)}, '+ Añadir agrego'),
    h('h2', {}, 'Precios especiales'), h('p', {class:'ayuda'}, 'Rebajas que la vendedora puede aplicar, pero solo con tu clave: conocidos, familia, el que compra mucho, otros negocios.'),
    (N.listas || []).map(l => h('div', {class:'card'}, h('div', {class:'fila'}, h('b', {}, l.nombre), h('b', {class:'num'}, '−' + l.pct + ' %'), h('button', {class:'enlace', onclick:() => editarLista(l)}, 'Editar')))),
    h('button', {class:'btn suave', onclick:() => editarLista({id:C.uid(), nombre:'', pct:10}, true)}, '+ Añadir precio especial'));
}
function editarLista(l, nuevo){
  const e = Object.assign({}, l); N.listas = N.listas || [];
  hoja(nuevo ? 'Nuevo precio especial' : l.nombre, cerrar => h('div', {}, campo('¿Para quién?', h('input', {value:e.nombre, placeholder:'Conocidos y familia', oninput:x => e.nombre = x.target.value})),
    campo('Rebaja (% menos que el precio normal)', h('input', {inputmode:'decimal', value:String(e.pct), oninput:x => e.__p = x.target.value})),
    h('button', {class:'btn', onclick:async () => { const n = e.__p != null ? C.num(e.__p) : e.pct; if(!e.nombre.trim() || isNaN(n) || n <= 0 || n > 90){ aviso('Revisa el nombre y la rebaja (entre 1 y 90)', true); return; }
      if(n > 50 && !(await confirmar('Rebaja muy grande', 'Es más de la mitad del precio.', 'Es correcto', 'Corregir'))) return;
      e.nombre = e.nombre.trim(); e.pct = n; delete e.__p; const i = N.listas.findIndex(x => x.id === e.id); if(i >= 0) N.listas[i] = e; else N.listas.push(e); await guardarN(); cerrar(); pintar(); }}, 'Guardar'),
    nuevo ? null : h('button', {class:'btn suave', onclick:async () => { N.listas = N.listas.filter(x => x.id !== l.id); await guardarN(); cerrar(); pintar(); }}, 'Quitar')));
}
function tasasEditor(){
  const caja = h('div'); const monedas = Object.keys(N.tasas);
  const filas = (monedas.length ? monedas : ['USD']).map(m => { const inp = h('input', {inputmode:'decimal', value:N.tasas[m] ? String(N.tasas[m] / 100) : '', placeholder:'0', 'aria-label':'Pesos por 1 ' + m});
    return h('div', {class:'fila', style:'margin-top:8px'}, h('b', {}, '1 ' + m + ' ='), inp, h('span', {}, 'CUP'),
      h('button', {class:'btn chico', onclick:async () => { const t = C.aCentavos(inp.value); if(isNaN(t) || t <= 0){ aviso('Pon cuántos pesos vale 1 ' + m, true); return; }
        if(t < 10000 || t > 200000){ const si = await confirmar('¿Seguro del cambio?', 'Pusiste ' + C.dinero(t) + ' pesos por 1 ' + m + ', que parece fuera de lo normal.', 'Sí, es correcto', 'Corregir'); if(!si) return; }
        N.tasas[m] = t; N.tasasFecha = C.hoy(); await guardarN(); aviso('Cambio de ' + m + ' guardado'); pintar(); }}, 'Guardar'));
  });
  caja.append(...filas, h('button', {class:'enlace', onclick:() => { const o = h('input', {placeholder:'EUR', maxlength:'4'}); hoja('Otra moneda', cerrar => h('div', {}, campo('Código de la moneda', o, 'Por ejemplo EUR'),
    h('button', {class:'btn', onclick:async () => { const m = o.value.trim().toUpperCase(); if(!/^[A-Z]{3}$/.test(m) || m === 'CUP'){ aviso('Escribe 3 letras, por ejemplo EUR', true); return; } N.tasas[m] = N.tasas[m] || 0; await guardarN(); cerrar(); pintar(); }}, 'Añadir'))); }}, '+ Otra moneda'));
  return caja;
}
function editarProducto(p, nuevo){
  const e = Object.assign({}, p);
  hoja(nuevo ? 'Nuevo producto' : p.nombre, cerrar => {
    const nom = h('input', {value:e.nombre, placeholder:'Nombre', oninput:x => e.nombre = x.target.value});
    const pre = h('input', {inputmode:'decimal', value:e.precioCents ? String(e.precioCents / 100) : '', placeholder:'0', oninput:x => e.__p = x.target.value});
    const cos = h('input', {inputmode:'decimal', value:e.costoCents != null ? String(e.costoCents / 100) : '', placeholder:'Opcional', oninput:x => e.__c = x.target.value});
    const chk = (t, k) => h('label', {class:'lin', style:'cursor:pointer'}, h('span', {}, t), h('input', {type:'checkbox', style:'width:26px;min-height:26px', checked:!!e[k], onchange:x => e[k] = x.target.checked}));
    return h('div', {}, campo('Nombre', nom), campo('Se vende por', selector(MEDIDA_OPS.map(m => [m, C.MEDIDAS[m].s]), e.medida, v => e.medida = v)),
      h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Precio de venta', pre)), h('div', {style:'width:110px'}, campo('Moneda', selector(['CUP', 'USD'], e.moneda, v => e.moneda = v)))),
      h('div', {class:'fila'}, h('div', {style:'flex:1'}, campo('Lo que te cuesta (solo tú lo ves)', cos)), h('div', {style:'width:110px'}, campo('Moneda', selector(['CUP', 'USD'], e.costoMoneda || 'CUP', v => e.costoMoneda = v)))),
      chk('Se le da una cantidad a la vendedora', 'controlStock'), chk('Se le pueden poner agregos', 'admiteAgregos'), chk('Activo (aparece en la entrega)', 'activo'),
      h('button', {class:'btn', onclick:async () => {
        if(!e.nombre.trim()){ aviso('Escribe el nombre', true); return; }
        const pr = e.__p != null ? C.aCentavos(e.__p) : e.precioCents; if(isNaN(pr) || pr <= 0){ aviso('Revisa el precio de venta', true); return; }
        let co = e.__c != null ? (e.__c.trim() === '' ? null : C.aCentavos(e.__c)) : e.costoCents; if(co !== null && isNaN(co)){ aviso('Revisa el costo', true); return; }
        if(co != null && e.costoMoneda === e.moneda && co >= pr){ const si = await confirmar('Te cuesta más de lo que cobras', 'El costo (' + C.dinero(co) + ') es mayor o igual al precio (' + C.dinero(pr) + ').', 'Guardar igual', 'Corregir'); if(!si) return; }
        const dup = N.productos.find(x => x.id !== e.id && x.puestoId === e.puestoId && x.nombre.trim().toLowerCase() === e.nombre.trim().toLowerCase());
        if(dup){ const si = await confirmar('Ya hay un producto con ese nombre', '«' + dup.nombre + '» ya está en este puesto.', 'Guardar igual', 'Corregir'); if(!si) return; }
        delete e.__p; delete e.__c; e.nombre = e.nombre.trim(); e.precioCents = pr; e.costoCents = co;
        const i = N.productos.findIndex(x => x.id === e.id); if(i >= 0) N.productos[i] = e; else N.productos.push(e);
        await guardarN(); cerrar(); aviso('Guardado'); pintar();
      }}, 'Guardar'),
      nuevo ? null : h('button', {class:'btn suave', onclick:() => { cerrar(); abrirFicha(ctx, p, pintar); }}, 'Ficha de costo (ingredientes y precio sugerido)'),
      nuevo ? null : h('button', {class:'btn suave', onclick:async () => { if(await confirmar('¿Quitar «' + p.nombre + '»?', 'Deja de salir en las entregas. Los cierres viejos no cambian.', 'Quitar', 'No')){ N.productos = N.productos.filter(x => x.id !== p.id); await guardarN(); cerrar(); pintar(); } }}, 'Quitar este producto'));
  });
}
function editarAgrego(a, nuevo){
  const e = Object.assign({}, a);
  hoja(nuevo ? 'Nuevo agrego' : a.nombre, cerrar => h('div', {}, campo('Nombre', h('input', {value:e.nombre, oninput:x => e.nombre = x.target.value})),
    campo('Precio (pesos)', h('input', {inputmode:'decimal', value:e.precioCents ? String(e.precioCents / 100) : '', oninput:x => e.__p = x.target.value})),
    h('button', {class:'btn', onclick:async () => { const pr = e.__p != null ? C.aCentavos(e.__p) : e.precioCents; if(!e.nombre.trim() || isNaN(pr) || pr <= 0){ aviso('Revisa el nombre y el precio', true); return; }
      e.nombre = e.nombre.trim(); e.precioCents = pr; delete e.__p; const i = N.agregos.findIndex(x => x.id === e.id); if(i >= 0) N.agregos[i] = e; else N.agregos.push(e); await guardarN(); cerrar(); pintar(); }}, 'Guardar'),
    nuevo ? null : h('button', {class:'btn suave', onclick:async () => { N.agregos = N.agregos.filter(x => x.id !== a.id); await guardarN(); cerrar(); pintar(); }}, 'Quitar')));
}

/* ---------- más ---------- */
function vMas(){
  if(masSub){
    const subs = {compras:vCompras, gastos:vGastos, casa:vCasa, conteo:vConteo, merma:vMerma, traspasos:vTraspasos, fiado:vFiado, historial:vHistorial, reportes:vReportes, equipo:vEquipo, ajustes:vAjustes};
    return subs[masSub](ctx);
  }
  const t = (id, ico, nombre, desc) => h('button', {class:'card', style:'display:block;width:100%;text-align:left', onclick:() => ctx.ir(id)}, h('div', {class:'fila'}, h('div', {}, h('b', {}, ico + ' ' + nombre), h('div', {class:'ayuda'}, desc)), h('span', {'aria-hidden':'true'}, '›')));
  const todas = [t('historial', '📈', 'Historial', 'Días, semanas y meses; lo que más se vende'), t('reportes', '📤', 'Reportes', 'Excel y resumen para Yelenis'), t('fiado', '📒', 'Fiado', 'Quién debe y cuánto'),
    t('compras', '🛒', 'Compras', 'Lo que compras cada día'), t('gastos', '💡', 'Gastos', 'Fijos del mes y los del día'), t('casa', '🏠', 'Almacén de casa', 'Lo que hay guardado en casa'),
    t('merma', '🗑️', 'Merma', 'Lo que se echa a perder'), t('traspasos', '🔁', 'Traspasos', 'Mercancía de un puesto a otro'), t('conteo', '🔢', 'Conteo del sábado', 'Contar y comparar'),
    t('equipo', '👥', 'Equipo', 'Teléfonos, puestos y personas'), t('ajustes', '⚙️', 'Ajustes y copia', 'Apariencia, copia de seguridad, clave')];
  const solo = [todas[0], todas[1], todas[2], t('ajustes', '⚙️', 'Ajustes', 'Apariencia y copia de consulta')];
  montar(raiz, banner(), h('h1', {}, 'Más'), ctx.SOLO ? solo : todas);
}
function vEquipo(){
  const disp = N.dispositivos.map(d => h('div', {class:'card'}, h('div', {class:'fila'}, h('div', {}, h('b', {}, d.nombre), h('div', {class:'ayuda'}, nomPuesto(d.puestoId) + ' · huella ' + d.huella)),
    h('button', {class:'enlace', onclick:async () => { if(await confirmar('¿Quitar el teléfono de ' + d.nombre + '?', 'Dejarás de aceptar sus cierres.', 'Quitar', 'No')){ N.dispositivos = N.dispositivos.filter(x => x.id !== d.id); await guardarN(); pintar(); } }}, 'Quitar'))));
  montar(raiz, banner(), h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más'), h('h1', {}, 'Equipo'),
    h('div', {class:'card'}, h('h3', {}, 'Teléfonos de las vendedoras'), disp.length ? disp : h('p', {class:'ayuda'}, 'Ninguno todavía. La vendedora te manda su código de enlace desde su teléfono, en «Más».'), cajaCarga('Cargar un código de enlace')),
    h('div', {class:'card'}, h('h3', {}, 'Puestos'), N.puestos.map(p => h('div', {class:'lin'}, h('span', {}, h('b', {}, p.nombre), h('div', {class:'d'}, (p.tipos || []).join(' + '))), h('button', {class:'enlace', onclick:() => editarPuesto(p)}, 'Editar'))),
      h('button', {class:'btn suave', onclick:() => editarPuesto({id:C.uid(), nombre:'', tipos:[], lugar:''}, true)}, '+ Añadir puesto')),
    h('div', {class:'card'}, h('h3', {}, 'Personas'), N.personas.map(p => h('div', {class:'lin'}, h('span', {}, h('b', {}, p.nombre), h('div', {class:'d'}, p.rol + ' · ' + nomPuesto(p.puestoId) + (p.pct ? ' · ' + p.pct + ' %' : ''))), h('button', {class:'enlace', onclick:() => editarPersona(p)}, 'Editar'))),
      h('button', {class:'btn suave', onclick:() => editarPersona({id:C.uid(), nombre:'', rol:ROLES[0], puestoId:(N.puestos[0] || {}).id || '', pct:'', base:BASES[0]}, true)}, '+ Añadir persona')));
}
function vAjustes(){
  const SOLO = ctx.SOLO;
  montar(raiz, banner(), h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más'), h('h1', {}, 'Ajustes'), selectorTema(),
    SOLO ? h('div', {class:'card'}, h('h3', {}, 'Copia de consulta'), h('p', {class:'ayuda'}, 'Esta aplicación solo muestra las cuentas. Para ver lo más nuevo, carga una copia reciente que te mande el dueño.'), h('button', {class:'btn', onclick:abrirConsulta}, 'Cargar una copia nueva')) : [
      h('div', {class:'card'}, h('h3', {}, 'Cargar datos del cuestionario'), h('p', {class:'ayuda'}, 'Reemplaza puestos, personas, productos, agregos y gastos con lo que dice el cuestionario.'),
        h('button', {class:'btn suave', onclick:() => hoja('Datos del cuestionario', cerrar => { const ta = h('textarea', {class:'bloque-codigo'}); return h('div', {}, ta, h('button', {class:'btn', onclick:async () => {
          if(!(await confirmar('¿Reemplazar tus datos?', 'Se cambian los puestos, personas y productos actuales.', 'Reemplazar', 'Cancelar'))) return;
          const r = desdeCuestionario(ta.value); if(r){ aviso(r, true); return; } await guardarN(); cerrar(); aviso('Datos cargados'); pintar(); }}, 'Cargar')); })}, 'Pegar el cuestionario')),
      h('div', {class:'card'}, h('h3', {}, 'Copia de seguridad'), h('p', {class:'ayuda'}, 'Incluye tu llave y todos tus datos. Guárdala solo para ti (mándatela a ti mismo): quien la tenga puede firmar como tú. La misma copia sirve para que tu familia vea las cuentas en su teléfono.'),
        N.ultimaCopia ? h('p', {class:'ayuda'}, 'Última copia: ' + N.ultimaCopia.slice(0, 10)) : null,
        h('button', {class:'btn suave', onclick:copiar}, 'Guardar o mandar una copia'), h('button', {class:'btn suave', onclick:restaurar}, 'Recuperar una copia')),
      h('div', {class:'card'}, h('h3', {}, 'Clave del dueño'), h('button', {class:'btn suave', onclick:cambiarClave}, 'Cambiar la clave'))],
    h('div', {class:'card'}, h('h3', {}, 'Mi llave'), h('p', {class:'ayuda'}, 'Huella de esta aplicación: ', h('b', {id:'mi-huella'}, '…')), h('button', {class:'btn suave', onclick:() => { desbloqueado = false; masSub = null; bloqueo(); }}, 'Bloquear ahora')),
    h('p', {class:'ayuda'}, 'Ozuna Dueño · versión ' + VERSION_APP));
  C.huella(perfil.pub).then(f => { const e = document.getElementById('mi-huella'); if(e) e.textContent = f; });
}
function cambiarClave(){
  hoja('Cambiar la clave', cerrar => { const a = h('input', {type:'password', inputmode:'numeric', placeholder:'Clave actual'}), b = h('input', {type:'password', inputmode:'numeric', placeholder:'4 a 6 números'}), c2 = h('input', {type:'password', inputmode:'numeric', placeholder:'Repite la nueva'});
    return h('div', {}, campo('Clave actual', a), campo('Clave nueva', b), campo('Repite la nueva', c2), h('p', {class:'ayuda'}, 'Los teléfonos de las vendedoras usan la clave nueva desde la próxima entrega que les mandes.'),
      h('button', {class:'btn', onclick:async () => {
        if(await C.hashClave(a.value, N.clave.sal) !== N.clave.hash){ aviso('La clave actual no es correcta.', true); return; }
        if(!/^\d{4,6}$/.test(b.value)){ aviso('La clave nueva debe tener de 4 a 6 números.', true); return; } if(b.value !== c2.value){ aviso('Las dos claves no coinciden.', true); return; }
        const sal = C.nuevaSal(); N.clave = {sal, hash:await C.hashClave(b.value, sal)}; await guardarN(); cerrar(); aviso('Clave cambiada'); }}, 'Cambiar')); });
}
function editarPuesto(p, nuevo){
  const e = Object.assign({}, p, {tipos:(p.tipos || []).slice()}); const TIPOS = ['Pizzería', 'Cafetería', 'Cárnico', 'Otro'];
  hoja(nuevo ? 'Nuevo puesto' : p.nombre, cerrar => { const ops = h('div', {class:'opts'});
    const pinta = () => ops.replaceChildren(...TIPOS.map(t => h('button', {class:'op', 'aria-pressed':e.tipos.includes(t), onclick:() => { const i = e.tipos.indexOf(t); if(i >= 0) e.tipos.splice(i, 1); else e.tipos.push(t); pinta(); }}, t))); pinta();
    return h('div', {}, campo('Nombre', h('input', {value:e.nombre, oninput:x => e.nombre = x.target.value})), h('p', {class:'marca', style:'margin-top:12px'}, '¿Qué se vende ahí?'), ops,
      campo('¿Dónde está?', h('input', {value:e.lugar || '', oninput:x => e.lugar = x.target.value})),
      h('button', {class:'btn', onclick:async () => { if(!e.nombre.trim()){ aviso('Escribe el nombre', true); return; } e.nombre = e.nombre.trim(); const i = N.puestos.findIndex(x => x.id === e.id); if(i >= 0) N.puestos[i] = e; else N.puestos.push(e); await guardarN(); cerrar(); pintar(); }}, 'Guardar')); });
}
function editarPersona(p, nuevo){
  const e = Object.assign({}, p);
  hoja(nuevo ? 'Nueva persona' : p.nombre, cerrar => h('div', {}, campo('Nombre', h('input', {value:e.nombre, oninput:x => e.nombre = x.target.value})), campo('¿Qué hace?', selector(ROLES, e.rol, v => e.rol = v)),
    campo('¿En qué puesto?', selector(N.puestos.map(x => [x.id, x.nombre]), e.puestoId, v => e.puestoId = v, 'Cambia de puesto')), campo('¿Cómo cobra?', selector(BASES, e.base, v => e.base = v, 'Elige…')),
    campo('Porciento (solo el número)', h('input', {inputmode:'decimal', value:e.pct, oninput:x => e.pct = x.target.value}), 'Para el 2 % escribe 2.'),
    h('button', {class:'btn', onclick:async () => {
      if(!e.nombre.trim()){ aviso('Escribe el nombre', true); return; }
      const n = C.num(e.pct); if(e.pct !== '' && (isNaN(n) || n < 0)){ aviso('Revisa el porciento', true); return; }
      if(n > 50 && !(await confirmar('Porciento muy alto', 'Cobraría el ' + n + ' % de la venta del puesto.', 'Es correcto', 'Corregir'))) return;
      e.nombre = e.nombre.trim(); const i = N.personas.findIndex(x => x.id === e.id); if(i >= 0) N.personas[i] = e; else N.personas.push(e); await guardarN(); cerrar(); pintar(); }}, 'Guardar'),
    nuevo ? null : h('button', {class:'btn suave', onclick:async () => { N.personas = N.personas.filter(x => x.id !== p.id); await guardarN(); cerrar(); pintar(); }}, 'Quitar')));
}
async function copiar(){
  if(ctx.SOLO){ aviso('Esta aplicación es solo de consulta.', true); return; }
  const jwk = await C.exportarPrivada(llaves.privateKey);
  const t = JSON.stringify({ozunaCopia:1, v:2, tipo:'dueno', perfil, llave:jwk, negocio:N, entregas:await db.todos('entregas'), cierres:await db.todos('cierres'), eventos:await db.todos('eventos')});
  const r = await C.enviarArchivo('copia-dueno-' + C.hoy() + '.txt', t);
  if(r !== 'cancelado'){ N.ultimaCopia = new Date().toISOString(); await guardarN(); if(r === 'descargado') aviso('Se guardó en Descargas.'); else aviso('Copia lista'); pintar(); }
}
async function leerCopia(){
  const t = await C.elegirArchivo(); if(!t) return null;
  let d; try { d = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch(e){}
  if(!d || d.ozunaCopia !== 1 || d.tipo !== 'dueno'){ aviso('Ese archivo no es una copia del dueño.', true); return null; }
  return d;
}
async function cargarDatosCopia(d){
  await db.vaciar('entregas'); await db.vaciar('cierres'); await db.vaciar('eventos');
  for(const x of d.entregas || []) await db.put('entregas', x); for(const x of d.cierres || []) await db.put('cierres', x); for(const x of d.eventos || []) await db.put('eventos', x);
}
async function restaurar(){
  const d = await leerCopia(); if(!d) return;
  if(!(await confirmar('Esto reemplaza todo lo que hay ahora', 'Se cargan tu llave, tus datos y los cierres de la copia.', 'Recuperar', 'Cancelar'))) return;
  llaves = {privateKey:await C.importarPrivada(d.llave), pub:d.perfil.pub}; perfil = d.perfil; N = d.negocio;
  await db.kvSet('llaves', llaves); await db.kvSet('perfil', perfil); await guardarN(); await cargarDatosCopia(d);
  aviso('Copia recuperada'); pintar();
}
/* Modo consulta: sin llave, solo para ver cierres, historial y reportes. Sirve para la familia. */
async function abrirConsulta(){
  const d = await leerCopia(); if(!d) return;
  if(perfil && !perfil.consulta && llaves && llaves.privateKey){ aviso('Este teléfono es del dueño: usa «Recuperar una copia».', true); return; }
  if(!(await confirmar('Abrir solo para ver', 'Verás las cuentas de la copia, sin poder cambiar nada ni mandar entregas.', 'Abrir', 'Cancelar'))) return;
  perfil = {id:d.perfil.id, nombre:'Consulta', pub:d.perfil.pub, consulta:true}; llaves = {pub:d.perfil.pub}; N = d.negocio;
  await db.kvSet('perfil', perfil); await db.kvSet('llaves', llaves); await guardarN(); await cargarDatosCopia(d);
  desbloqueado = true; pantalla = 'hoy'; masSub = null; pintar(); aviso('Copia cargada. Esta aplicación solo muestra las cuentas.');
}

iniciar();
