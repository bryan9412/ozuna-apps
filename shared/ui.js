/* Piezas de interfaz comunes: elementos, avisos, hojas emergentes y confirmaciones dentro de la página. */
import { temaGuardado, guardarTema } from './tema.js';
export function h(tag, attrs, ...hijos){
  const e = document.createElement(tag);
  for(const [k, v] of Object.entries(attrs || {})){
    if(k === 'class') e.className = v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if(k === 'value') e.value = v;
    else if(v === true) e.setAttribute(k, '');
    else if(v !== false && v != null) e.setAttribute(k, v);
  }
  for(const c of hijos.flat(Infinity)){ if(c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
export function montar(raiz, ...hijos){ raiz.replaceChildren(...hijos.flat(Infinity).filter(Boolean)); }

/* Aviso flotante: se ajusta al texto, trae una barra que se va vaciando y dura 5 segundos como máximo (20/10/2026). */
export const SEG_AVISO = 5;
let tt;
export function aviso(msg, malo){
  let t = document.getElementById('aviso');
  if(!t){ t = h('div', {id:'aviso', role:'status'}); document.body.append(t); }
  t.className = ''; t.replaceChildren(h('span', {}, msg), h('i', {class:'barra'})); void t.offsetWidth;
  t.className = 'show' + (malo ? ' malo' : '');
  clearTimeout(tt); tt = setTimeout(() => { t.className = ''; }, SEG_AVISO * 1000);
}
/* Hoja que sube desde abajo. contenido(cerrar) devuelve el cuerpo. */
export function hoja(titulo, contenido, alCerrar){
  const fondo = h('div', {class:'hoja-fondo'});
  const cerrar = () => { fondo.remove(); if(!document.querySelector('.hoja-fondo')) document.body.classList.remove('sin-scroll'); if(alCerrar) alCerrar(); };
  const cuerpo = h('div', {class:'hoja', role:'dialog', 'aria-modal':'true', 'aria-label':titulo},
    h('div', {class:'hoja-cab'}, h('h2', {}, titulo), h('button', {class:'x', 'aria-label':'Cerrar', onclick:cerrar}, '✕')),
    contenido(cerrar));
  fondo.append(cuerpo);
  fondo.addEventListener('click', e => { if(e.target === fondo) cerrar(); });
  document.body.append(fondo); document.body.classList.add('sin-scroll');
  return cerrar;
}
/* Confirmación dentro de la página (los diálogos del navegador no se usan). */
export function confirmar(titulo, texto, si, no){
  return new Promise(res => {
    hoja(titulo, c => h('div', {},
      texto ? h('p', {class:'ayuda'}, texto) : null,
      h('button', {class:'btn', onclick:() => { res(true); c(); }}, si || 'Sí'),
      h('button', {class:'btn suave', onclick:() => { res(false); c(); }}, no || 'No')), () => res(false));
  });
}
export function campo(etiqueta, input, ayuda){
  return h('label', {class:'campo'}, h('span', {}, etiqueta), input, ayuda ? h('small', {}, ayuda) : null);
}
/* Íconos de trazo, incluidos aquí (nada de internet ni de emoji, que cambian de un teléfono a otro). Estilo Feather, licencia MIT. */
const TRAZOS = {
  carrito:'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  recibo:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  check:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  ajustes:'<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  buscar:'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  cerrar:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  mas:'<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  menos:'<line x1="5" y1="12" x2="19" y2="12"/>',
  papelera:'<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  grafica:'<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  caja:'<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  etiqueta:'<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  repetir:'<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  alerta:'<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  efectivo:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>',
  tarjeta:'<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>',
  dolar:'<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  libreta:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
};
export function icono(nombre, tam){
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); tam = tam || 24;
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', tam); s.setAttribute('height', tam); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ic');
  s.innerHTML = TRAZOS[nombre] || ''; return s;
}
/* Aviso con un botón (por ejemplo «Deshacer»). Dura unos segundos. */
export function avisoAccion(msg, etiqueta, accion){
  let t = document.getElementById('aviso-accion');
  if(!t){ t = h('div', {id:'aviso-accion', role:'status'}); document.body.append(t); }
  clearTimeout(avisoAccion.t);
  t.className = ''; t.replaceChildren(h('span', {}, msg), h('button', {onclick:() => { t.className = ''; clearTimeout(avisoAccion.t); accion(); }}, etiqueta), h('i', {class:'barra'})); void t.offsetWidth; t.className = 'show';
  avisoAccion.t = setTimeout(() => { t.className = ''; }, SEG_AVISO * 1000);
}
export function barraNav(items, actual, ir){
  return h('nav', {class:'nav', 'aria-label':'Secciones'}, h('div', {class:'nav-in'},
    items.map(([id, ico, nombre]) => h('button', {class:'nav-b', 'aria-current':id === actual ? 'page' : null, onclick:() => ir(id)}, h('span', {class:'ico', 'aria-hidden':'true'}, TRAZOS[ico] ? icono(ico, 24) : ico), nombre))));
}
/* Selector de tema: Automático (sigue al teléfono), Claro u Oscuro. */
export function selectorTema(){
  const caja = h('div', {class:'opts'});
  const pinta = () => caja.replaceChildren(...[['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([v, t]) =>
    h('button', {class:'op', 'aria-pressed':temaGuardado() === v, onclick:() => { guardarTema(v); pinta(); }}, t)));
  pinta();
  return h('div', {class:'card'}, h('h3', {}, 'Apariencia'), h('p', {class:'ayuda'}, 'Automático usa el modo claro u oscuro del teléfono.'), caja);
}
/* Aviso de versión nueva: el service worker nuevo queda esperando hasta que la persona lo acepte. */
let regSW = null;
/* Botón «Buscar actualización»: pregunta ya si hay versión nueva (sin esperar a que el navegador lo note) y, si la hay, la instala. */
export async function buscarActualizacion(){
  if(!regSW){ aviso('Este navegador no permite actualizar desde aquí. Cierra la app y ábrela con internet.', true); return; }
  aviso('Buscando…');
  try { await regSW.update(); } catch(e){ aviso('No se pudo comprobar. ¿Hay internet?', true); return; }
  if(regSW.installing){
    const w = regSW.installing;
    await new Promise(res => { const t = setTimeout(res, 20000); w.addEventListener('statechange', () => { if(w.state === 'installed' || w.state === 'redundant'){ clearTimeout(t); res(); } }); });
  }
  if(regSW.waiting && navigator.serviceWorker.controller){ aviso('Hay versión nueva. Actualizando…'); regSW.waiting.postMessage('saltar'); return; }
  aviso('Ya tienes la última versión.');
}
export function tarjetaActualizar(version){
  return h('div', {class:'card'}, h('h3', {}, 'Actualizar la aplicación'), h('p', {class:'ayuda'}, 'Versión ' + version + '. Con internet, toca el botón y se pone la versión más nueva si hay una.'),
    h('button', {class:'btn', onclick:buscarActualizacion}, 'Buscar actualización'));
}
export function registrarSW(ruta, alHaber){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(ruta).then(reg => {
    regSW = reg;
    const esperar = w => w.addEventListener('statechange', () => { if(w.state === 'installed' && navigator.serviceWorker.controller) alHaber(() => w.postMessage('saltar')); });
    if(reg.waiting && navigator.serviceWorker.controller) alHaber(() => reg.waiting.postMessage('saltar'));
    reg.addEventListener('updatefound', () => esperar(reg.installing));
  }).catch(() => {});
  let recargado = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(recargado) return; recargado = true; location.reload(); });
}
