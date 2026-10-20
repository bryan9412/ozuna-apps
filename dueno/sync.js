/* Pantalla de sincronización entre los teléfonos del dueño. La mezcla de datos vive en merge.js. */
import * as C from '../shared/core.js';
import { h, montar, aviso } from '../shared/ui.js';
import { armarSync } from './merge.js';

export async function vSincronizar(ctx){
  const { db, N } = ctx; const SOLO = ctx.SOLO; const est = (await db.kv('sync')) || {};
  const mandar = async todo => {
    const desde = todo ? 0 : Math.max(0, (est.ultimo || 0) - 3 * 3600 * 1000);
    const p = await armarSync(db, N, desde); const env = await C.firmarSobre('sync', ctx.perfil, null, p, ctx.llaves.privateKey);
    const r = await C.enviarArchivo(C.nombreArchivo(todo ? 'sync-completo' : 'sync', ctx.perfil.nombre), C.sobreATexto(env));
    if(r === 'cancelado') return;
    await db.kvSet('sync', Object.assign({}, est, {ultimo:p.hasta})); aviso(r === 'compartido' ? 'Listo. Mándaselo a quien lo necesite.' : 'Se guardó en Descargas. Mándalo por WhatsApp.'); ctx.pintar();
  };
  montar(ctx.raiz, ctx.banner(), h('button', {class:'enlace', onclick:ctx.volver}, '‹ Más'), h('h1', {}, 'Sincronizar'),
    h('p', {class:'ayuda'}, 'Para que tú, Yelenis y tu papá vean lo mismo. Cada teléfono manda sus cambios por WhatsApp y los otros los cargan: se juntan sin borrar nada. Hazlo cuando termines de trabajar, y antes de armar una entrega carga lo que hayan mandado los demás.'),
    SOLO ? null : h('div', {class:'card'}, h('h3', {}, 'Mandar mis cambios'), h('p', {class:'ayuda'}, est.ultimo ? 'Último envío: ' + new Date(est.ultimo).toLocaleString('es') : 'Todavía no has mandado cambios.'),
      h('button', {class:'btn', onclick:() => mandar(false)}, 'Mandar lo nuevo'), h('button', {class:'btn suave', onclick:() => mandar(true)}, 'Mandar todo (para un teléfono nuevo)')),
    ctx.cajaCarga('Cargar los cambios de otro teléfono', 'Elige el archivo «Ozuna_sync_…» que te mandaron, o pega el mensaje.'),
    h('div', {class:'card'}, h('h3', {}, 'Teléfono nuevo de la familia'), h('p', {class:'ayuda'}, SOLO ? 'Esta aplicación es de solo consulta: puedes cargar cambios, no mandarlos.' : 'Para que otra persona use la aplicación igual que tú: en Ajustes manda una copia de seguridad (copia completa) y que la cargue al abrir la aplicación por primera vez. Después se mantienen al día con estos paquetes.')));
}
