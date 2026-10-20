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

let tt;
export function aviso(msg, malo){
  let t = document.getElementById('aviso');
  if(!t){ t = h('div', {id:'aviso', role:'status'}); document.body.append(t); }
  t.textContent = msg; t.className = 'show' + (malo ? ' malo' : '');
  clearTimeout(tt); tt = setTimeout(() => { t.className = ''; }, malo ? 4200 : 2200);
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
export function barraNav(items, actual, ir){
  return h('nav', {class:'nav', 'aria-label':'Secciones'}, h('div', {class:'nav-in'},
    items.map(([id, ico, nombre]) => h('button', {class:'nav-b', 'aria-current':id === actual ? 'page' : null, onclick:() => ir(id)}, h('span', {class:'ico', 'aria-hidden':'true'}, ico), nombre))));
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
