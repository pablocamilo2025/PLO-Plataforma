/* Catalog ingestion shared by browser UI and tests. Never executes formulas. */
(function(root){
  'use strict';
  const text=value=>String(value??'').trim();
  const normalize=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[ _-]+/g,'');
  const columns={sku:'sku',codigo:'sku',nombre:'name',name:'name',producto:'name',laboratorio:'laboratory',laboratory:'laboratory',concentracion:'strength',dosis:'strength',presentacion:'presentation',ean:'ean',gtin:'ean',marca:'brand',principioactivo:'ingredient'};
  function parseCSV(input){
    const source=input.replace(/^\uFEFF/,'');
    const first=source.split(/\r?\n/)[0],delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
    const rows=[];let row=[],cell='',quoted=false,closed=false;
    for(let i=0;i<source.length;i++){
      const c=source[i];
      if(c==='"'){
        if(quoted&&source[i+1]==='"'){cell+='"';i++;}
        else if(quoted){quoted=false;closed=true;}
        else if(!cell&&!closed)quoted=true;
        else throw Error('Comillas inválidas en el CSV.');
      }else if(!quoted&&(c===delimiter||c==='\n'||c==='\r')){
        row.push(cell);cell='';closed=false;
        if(c!==delimiter){if(c==='\r'&&source[i+1]==='\n')i++;rows.push(row);row=[];}
      }else{if(closed&&c.trim())throw Error('Contenido después de una celda entre comillas.');if(!closed)cell+=c;}
    }
    if(quoted)throw Error('El CSV contiene comillas sin cerrar.');
    if(cell||row.length){row.push(cell);rows.push(row);}return rows;
  }
  function validEAN(value){if(!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value))return false;let sum=0;const digits=value.slice(0,-1).split('').reverse();digits.forEach((n,i)=>sum+=Number(n)*(i%2===0?3:1));return (10-sum%10)%10===Number(value.at(-1));}
  function build(rows,kind,title){
    if(!['test','official'].includes(kind))throw Error('Selecciona Prueba u Oficial.');
    if(text(title).length<3||text(title).length>100)throw Error('El nombre del catálogo debe tener entre 3 y 100 caracteres.');
    rows=rows.filter(row=>row.some(v=>text(v)));if(rows.length<2||rows.length>501)throw Error('El catálogo debe tener entre 1 y 500 productos.');
    const headers=rows[0].map(h=>columns[normalize(h)]||null),seenHeaders=headers.filter(Boolean);
    if(new Set(seenHeaders).size!==seenHeaders.length)throw Error('Hay columnas repetidas.');
    for(const key of ['sku','name','laboratory','strength','presentation'])if(!headers.includes(key))throw Error('Falta la columna '+({name:'nombre',laboratory:'laboratorio',strength:'concentracion',presentation:'presentacion'}[key]||key)+'.');
    const seen=new Set(),products=[],errors=[];
    rows.slice(1).forEach((row,index)=>{
      const record={};headers.forEach((key,i)=>{if(key)record[key]=text(row[i]);});
      const line=index+2;
      if(row.length>headers.length&&row.slice(headers.length).some(v=>text(v)))errors.push(`Fila ${line}: hay valores sin encabezado.`);
      for(const key of ['sku','name','laboratory','strength','presentation'])if(!record[key]||record[key].length>200)errors.push(`Fila ${line}: ${key} vacío o demasiado largo.`);
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(record.sku||''))errors.push(`Fila ${line}: SKU inválido.`);
      const sku=(record.sku||'').toUpperCase();if(seen.has(sku))errors.push(`Fila ${line}: SKU repetido (${sku}).`);seen.add(sku);
      if(record.ean&&!validEAN(record.ean))errors.push(`Fila ${line}: EAN/GTIN inválido; conserva todos sus dígitos.`);
      products.push({sku,name:record.name,laboratory:record.laboratory,strength:record.strength,presentation:record.presentation,brand:record.brand||null,ingredient:record.ingredient||null,ean:record.ean||null,
        query:record.ingredient||record.name,identity_status:'pending_verification',notes:'Catálogo importado: validar identidad y buscar fichas antes de comparar.',
        sources:['drsimi','eco','cruzverde'].map(source=>({source,status:'not_searched',candidates:[]}))});
    });
    if(errors.length)throw Error(errors.slice(0,12).join('\n')+(errors.length>12?`\nY ${errors.length-12} errores más.`:''));
    return {catalog_kind:kind,catalog_title:text(title),generated_at:new Date().toISOString(),products};
  }
  async function read(file){
    if(!file||file.size>5000000)throw Error('Selecciona un archivo de hasta 5 MB.');
    if(/\.csv$/i.test(file.name))return parseCSV(await file.text());
    if(!/\.xlsx$/i.test(file.name))throw Error('Usa Excel .xlsx o CSV UTF-8.');
    if(!root.XLSX)throw Error('El lector Excel no está disponible. Puedes usar CSV UTF-8.');
    const book=root.XLSX.read(await file.arrayBuffer(),{type:'array',sheetRows:503,cellFormula:true});
    const sheets=book.SheetNames.filter(name=>book.Sheets[name]['!ref']);
    if(sheets.length!==1)throw Error('El Excel debe tener una sola hoja con datos.');
    const sheet=book.Sheets[sheets[0]];
    if(sheet['!merges']?.length)throw Error('El catálogo no admite celdas combinadas.');
    const full=sheet['!fullref']||sheet['!ref'];if(root.XLSX.utils.decode_range(full).e.r>501)throw Error('El catálogo excede 500 productos.');
    for(const [address,cell] of Object.entries(sheet))if(!address.startsWith('!')&&cell.f)throw Error('El catálogo debe contener valores, no fórmulas.');
    return root.XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false});
  }
  const api={parseCSV,validEAN,build,read};root.RadarCatalog=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
