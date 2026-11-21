'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {createRegistry}=require('../src/features/slash.js');
const {validateTemplates,renderTemplate,installTemplates,createPublicAPI}=require('../src/public-api.js');
test('registrations are scoped, searchable, collision checked, and disposable',()=>{
  const first=createRegistry(),second=createRegistry();
  const remove=first.register({id:'daily',name:'daily',aliases:['today'],description:'A daily note',run(){}});
  assert.equal(first.search('today')[0].id,'daily');assert.equal(second.search('daily').length,0);
  assert.equal(first.triggerAt('/daily',6).query,'daily');
  assert.throws(()=>first.register({id:'other',name:'other',aliases:['outline'],description:'bad',run(){}}),/already registered/);
  assert.throws(()=>first.register({id:'eval',name:'eval',description:'bad',run:'alert(1)'}),/callback/);
  remove();remove();assert.equal(first.search('daily').length,0);
});
test('template JSON validates bounded names, text and reserved aliases',()=>{
  for(const input of [{},[{name:'toc',template:'x'}],[{name:'outline',template:'x'}],[{name:'daily',template:'x'},{name:'daily',template:'y'}],[{name:'bad name',template:'x'}],[{name:'daily',template:'x'.repeat(16001)}]]) assert.throws(()=>validateTemplates(input));
  assert.equal(validateTemplates([{name:'daily',template:'# {{date}}'}])[0].name,'daily');
});
test('placeholders expand as text in one pass and use local date/time',()=>{
  const date=new Date(2026,10,1,9,5);
  assert.equal(renderTemplate('{{date}} {{time}} {{title}} {{selection}} {{unknown}}',{date,title:'{{date}}',selection:'$1'}),'2026-11-01 09:05 {{date}} $1 {{unknown}}');
});
test('settings templates and public registrations execute a single literal insertion and clean up',async()=>{
  const hooks=[], plans=[];
  const plugin={slash:createRegistry(),register:fn=>hooks.push(fn),applyEditorPlan:(...args)=>plans.push(args),agent:{request:async r=>r},format:{formatMarkdown:t=>t.trim()}};
  installTemplates(plugin,[{name:'daily',template:'# {{title}}\n\n## Questions\n- [ ] '}]);
  plugin.slash.search('daily')[0].run({editor:{getSelection:()=>''},from:0,to:6,title:'Learning'});
  assert.equal(plans.length,1);assert.equal(plans[0][1].changes[0].insert,'# Learning\n\n## Questions\n- [ ] ');
  installTemplates(plugin,[]);assert.equal(plugin.slash.search('daily').length,0);
  const api=createPublicAPI(plugin);assert.equal(api.version,1);assert.equal(api.formatMarkdown('x '),'x');
  api.registerSlashCommand({id:'code',name:'code',description:'Literal code',run(){}});
  hooks.forEach(fn=>fn());assert.equal(plugin.slash.search('code').length,0);
});
