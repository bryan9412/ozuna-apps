# ozuna-apps

Dos aplicaciones web sin conexión (PWA) para ventas e inventario:

- `vendedor/` — la vendedora recibe la entrega del día, anota ventas, pide devoluciones y manda el cierre.
- `dueno/` — el dueño arma el catálogo, manda entregas y reposiciones, recibe cierres y ve el cuadre.
- `shared/` — núcleo común: dinero en enteros, firmas (ECDSA P-256), archivos de intercambio, cadena de ventas, cuadre.

Los datos del negocio nunca están en este repositorio: viven solo en cada teléfono (IndexedDB). Los archivos de intercambio van por WhatsApp como `.txt` con JSON firmado.

Sin paso de compilación: se publica tal cual con GitHub Pages. Al cambiar archivos del núcleo o de una app, subir también la constante `VERSION` de su `sw.js` para que los teléfonos actualicen.
