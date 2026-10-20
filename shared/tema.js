/* Tema: por defecto sigue al teléfono; la persona puede fijar claro u oscuro. Se recuerda en este teléfono. */
const KEY = 'ozuna-tema';
export function temaGuardado(){ try { const t = localStorage.getItem(KEY); return t === 'claro' || t === 'oscuro' ? t : 'auto'; } catch(e){ return 'auto'; } }
function esOscuro(){ const r = document.documentElement; return r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); }
export function aplicarTema(t){
  t = t || temaGuardado(); const r = document.documentElement;
  if(t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light');
  const m = document.querySelector('meta[name="theme-color"]'); if(m) m.content = esOscuro() ? '#0F1614' : '#0E6A5B';
}
export function guardarTema(t){ try { if(t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch(e){} aplicarTema(t); }
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if(temaGuardado() === 'auto') aplicarTema('auto'); }); } catch(e){}
aplicarTema();
