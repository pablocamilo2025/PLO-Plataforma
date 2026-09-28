const assert=require('node:assert/strict');
require('../../apps/Portal-PLO/radar-operations.js');
const {publication}=globalThis.RadarOperations;
const state={cloud:{id:'test',revision:1},dirty:false,report:{products:[]},decisions:{}};
for(let i=0;i<200;i++){
 const p={sku:'TEST-'+i,strength:'50 mg',presentation:'30 comprimidos',sources:[]};
 for(const source of ['drsimi','eco','cruzverde']){
  const candidate={product_id:String(i),name:'Producto de prueba',url:'https://example.test/'+i};
  p.sources.push({source,candidates:[candidate]});
  state.decisions[i+source]={...candidate,sku:p.sku,source,decision:'proposed',verified:true,evidence:'Verificación sintética para test local'};
 }
 state.report.products.push(p);
}
const plan=publication(state);assert.equal(plan.products,200);assert.equal(plan.covered,200);assert.equal(plan.mappings.length,600);assert.equal(plan.missing,0);
assert.throws(()=>publication({...state,dirty:true}),/Guarda/);
assert.throws(()=>publication({...state,cloud:null}),/Guarda/);
assert.throws(()=>publication({...state,decisions:{}}),/Todavía/);
const bad=structuredClone(state);bad.decisions['0eco'].verified=false;assert.throws(()=>publication(bad),/verificación/);
bad.decisions['0eco'].verified=true;delete bad.decisions['0eco'].evidence;assert.throws(()=>publication(bad),/verificación/);
const partial=structuredClone(state);partial.decisions['0eco'].decision='rejected';assert.equal(publication(partial).missing,1);
const duplicate=structuredClone(state);duplicate.decisions.duplicate=duplicate.decisions['0eco'];assert.throws(()=>publication(duplicate),/Más de una/);
console.log('PASS: 200 SKU / 600 mappings, partial coverage, unsaved drafts, missing evidence and duplicate proposal rejection');
