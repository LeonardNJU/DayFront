const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const store = new Map();
let index = 0;
const read = (id) => structuredClone(store.get(id));
function create(kind, value) {
  const id = kind[0] + (++index);
  const obj = { ...value, kind, resourceId:id, id, uid:'uid-'+id, version:'v1', recurring:false,
    priority:value.priority ?? 0, status:value.status ?? 'needs-action' };
  store.set(id,obj); return read(id);
}
function update(id, version, input) {
  const obj = store.get(id);
  if (!obj || obj.version!==version) throw Error('412 VERSION_CONFLICT');
  const n = Number(obj.version.slice(1))+1;
  const changed = {...obj,...input,version:'v'+n};
  store.set(id,changed); return read(id);
}
function remove(id,version) {
  const obj=store.get(id);
  if (!obj || obj.version!==version) throw Error('412 VERSION_CONFLICT');
  store.delete(id);
}
const events=[];
let listener;
const el = {style:{},setAttribute(){},remove(){},textContent:''};
const context = {
  console, setTimeout, clearTimeout, URL, URLSearchParams, Event:class{constructor(type){this.type=type;}},
  Element:class {}, document:{body:{appendChild(){}}, getElementById(){return el;},createElement(){return el;},querySelector(){return null;}},
  window:{addEventListener(type,cb){if(type==='keydown')listener=cb;},dispatchEvent(ev){events.push(ev.type);}},
  fetch:async (uri) => {
    const url = new URL(uri,'https://example.test');
    const id=decodeURIComponent(url.pathname.split('/').pop());
    const item=store.get(id);
    return {ok:!!item,async json(){return {data:read(id)}}};
  },
  by:async v=>create('task',v), xy:async (id,version,v)=>update(id,version,v),
  Sy:async (id,version)=>remove(id,version),
  Cy:async v=>create('event',v), wy:async (id,version,v)=>update(id,version,v),
  Ty:async (id,version)=>remove(id,version),
  yy:async ()=>[...store.values()].filter(x=>x.kind==='task'),
  _y:async ()=>[...store.values()].filter(x=>x.kind==='event'),
  vy:async ()=>[...store.values()].filter(x=>x.kind==='task')
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'sl-history-bridge.js'),'utf8'),context);
context.slHistoryAlert=()=>{};
(async ()=>{
  const cal='cal/test';
  const original=await context.by({calendarId:cal,title:'Before',allDay:true,priority:0,color:'#8E24AA'});
  assert.equal(context.slHistoryState.undo.length,1);
  await context.slHistoryTravel(false);
  assert.equal(store.size,0,'undo create deletes resource');
  await context.slHistoryTravel(true);
  assert.equal(store.size,1,'redo create restores resource');
  const recreated=[...store.values()][0];
  await context.xy(recreated.resourceId,recreated.version,{calendarId:cal,title:'After',allDay:true,priority:1,color:'#D50000',status:'needs-action'});
  assert.equal([...store.values()][0].color,'#D50000');
  await context.slHistoryTravel(false);
  assert.equal([...store.values()][0].title,'Before','undo update restores title');
  assert.equal([...store.values()][0].color,'#8E24AA','undo update restores previous color');
  await context.slHistoryTravel(true);
  assert.equal([...store.values()][0].color,'#D50000','redo update restores red priority color');
  const post=[...store.values()][0];
  await context.Sy(post.resourceId,post.version);
  assert.equal(store.size,0,'delete works');
  await context.slHistoryTravel(false);
  assert.equal([...store.values()][0].title,'After','undo delete recreates task');
  await context.slHistoryTravel(true);
  assert.equal(store.size,0,'redo delete deletes task');
  const event=await context.Cy({calendarId:cal,title:'Event before',allDay:true,start:'2026-11-18',color:'#039BE5'});
  await context.wy(event.resourceId,event.version,{calendarId:cal,title:'Event after',allDay:true,start:'2026-11-19',color:'#039BE5'});
  await context.slHistoryTravel(false);
  assert.equal([...store.values()][0].title,'Event before','undo event update');
  await context.slHistoryTravel(true);
  assert.equal([...store.values()][0].title,'Event after','redo event update');
  // Reject edits from other clients; stale version must not clobber data.
  const postEvent=[...store.values()][0];
  update(postEvent.resourceId,postEvent.version,{title:'Other client'});
  await context.slHistoryTravel(false);
  assert.equal([...store.values()][0].title,'Other client','conflicting remote edits preserved');
  assert.ok(events.includes('sl-history-changed'),'UI refresh dispatched');
  const repeating = await context.by({calendarId:cal,title:'Daily',allDay:true,due:'2026-11-18',status:'needs-action',recurrenceRule:'FREQ=DAILY'});
  const instance = {...repeating,entryType:'todo',recurring:true,recurrenceId:'2026-11-18'};
  context.slHistoryIndex([instance]);
  await context.xy(repeating.resourceId,repeating.version,{calendarId:cal,title:'Daily',allDay:true,due:'2026-11-18',status:'completed',recurrenceRule:'FREQ=DAILY',recurrenceScope:'occurrence',recurrenceId:'2026-11-18',occurrenceStart:'2026-11-18'});
  assert.equal(context.slHistoryState.undo.at(-1).occurrence.recurrenceScope,'occurrence');
  await context.slHistoryTravel(false);
  assert.equal(store.get(repeating.resourceId).status,'needs-action','recurrence occurrence completion reversible');
  await context.slHistoryTravel(true);
  assert.equal(store.get(repeating.resourceId).status,'completed','recurrence occurrence redo');
  const latest=await context.by({calendarId:cal,title:'Shortcut',allDay:true,priority:0});
  let wasPrevented=false;
  listener({key:'z',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,repeat:false,defaultPrevented:false,target:{},preventDefault(){wasPrevented=true;},stopImmediatePropagation(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.has(latest.resourceId),false,'Control-Z invokes undo');
  assert.equal(wasPrevented,true,'shortcut intercepts browser only when usable');
  listener({key:'Z',ctrlKey:false,metaKey:true,altKey:false,shiftKey:true,repeat:false,defaultPrevented:false,target:{},preventDefault(){},stopImmediatePropagation(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok([...store.values()].some(x=>x.title==='Shortcut'),'Command-Shift-Z invokes redo');
  console.log('PASS: CRUD undo/redo, recurring instance, Ctrl-Z / Cmd-Shift-Z, ETag conflict safety');
})().catch(e=>{console.error(e);process.exitCode=1;});
