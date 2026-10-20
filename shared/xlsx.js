/* Escribe archivos .xlsx sin librerías: ZIP sin compresión + hojas con texto en línea.
   crearXlsx([{nombre, filas:[[...encabezados],[...datos]]}]) → Uint8Array. Los números van como números. */
const te = new TextEncoder();
let tabla;
function crc32(u8){
  if(!tabla){ tabla = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tabla[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for(let i = 0; i < u8.length; i++) c = tabla[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
function unir(partes){ const t = partes.reduce((s, x) => s + x.length, 0), out = new Uint8Array(t); let o = 0; for(const p of partes){ out.set(p, o); o += p.length; } return out; }
function zip(archivos){
  const partes = [], central = []; let offset = 0;
  for(const a of archivos){
    const nombre = te.encode(a.nombre), crc = crc32(a.datos), tam = a.datos.length;
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x0800, true); cab.setUint16(8, 0, true); cab.setUint16(10, 0, true); cab.setUint16(12, 0x21, true);
    cab.setUint32(14, crc, true); cab.setUint32(18, tam, true); cab.setUint32(22, tam, true); cab.setUint16(26, nombre.length, true); cab.setUint16(28, 0, true);
    partes.push(new Uint8Array(cab.buffer), nombre, a.datos);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, 0, true); cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, tam, true); cen.setUint32(24, tam, true); cen.setUint16(28, nombre.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nombre);
    offset += 30 + nombre.length + tam;
  }
  const tc = central.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true); fin.setUint32(12, tc, true); fin.setUint32(16, offset, true);
  return unir([...partes, ...central, new Uint8Array(fin.buffer)]);
}
const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function col(n){ let s = ''; n++; while(n > 0){ const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function hojaXml(filas){
  const ancho = []; filas.forEach(f => f.forEach((v, i) => { const l = String(v == null ? '' : v).length; ancho[i] = Math.min(60, Math.max(ancho[i] || 8, l + 2)); }));
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
    ancho.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols><sheetData>';
  filas.forEach((f, r) => {
    x += '<row r="' + (r + 1) + '">';
    f.forEach((v, c) => {
      if(v == null || v === '') return; const ref = col(c) + (r + 1);
      if(typeof v === 'number' && isFinite(v)) x += '<c r="' + ref + '"><v>' + v + '</v></c>';
      else x += '<c r="' + ref + '" t="inlineStr"' + (r === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    });
    x += '</row>';
  });
  return x + '</sheetData></worksheet>';
}
export function crearXlsx(hojas){
  const nombres = hojas.map((h, i) => (String(h.nombre).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Hoja' + (i + 1)));
  const A = [];
  A.push({nombre:'[Content_Types].xml', datos:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    hojas.map((h, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>')});
  A.push({nombre:'_rels/.rels', datos:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')});
  A.push({nombre:'xl/workbook.xml', datos:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    nombres.map((n, i) => '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>')});
  A.push({nombre:'xl/_rels/workbook.xml.rels', datos:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hojas.map((h, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')});
  A.push({nombre:'xl/styles.xml', datos:te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')});
  hojas.forEach((h, i) => A.push({nombre:'xl/worksheets/sheet' + (i + 1) + '.xml', datos:te.encode(hojaXml(h.filas))}));
  return zip(A);
}
/* CSV para Excel en español: separador «;», coma decimal y marca BOM para las tildes. */
export function crearCsv(filas){
  const celda = v => { if(v == null) return ''; if(typeof v === 'number') return String(v).replace('.', ','); const s = String(v); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + filas.map(f => f.map(celda).join(';')).join('\r\n');
}
