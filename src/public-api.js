'use strict';
const RESERVED = new Set(['toc','outline','format','tidy','help']);
function validateTemplates(value) {
  if (!Array.isArray(value) || value.length > 50) throw Error('Use an array of at most 50 templates.');
  const names = new Set(RESERVED);
  return value.map(item => {
    if (!item || typeof item !== 'object' || !/^[a-z][a-z-]{0,39}$/.test(item.name || '')) throw Error('Each template needs a lowercase name of 1–40 letters/hyphens.');
    if (names.has(item.name)) throw Error('Duplicate or reserved command: ' + item.name);
    names.add(item.name);
    if (typeof item.template !== 'string' || item.template.length > 16000) throw Error('Each template needs text of at most 16,000 characters.');
    if (item.description != null && (typeof item.description !== 'string' || item.description.length > 200)) throw Error('Descriptions must be at most 200 characters.');
    return { name:item.name, description:item.description || 'Insert '+item.name+' template', template:item.template };
  });
}
function renderTemplate(template, { title='', date=new Date(), selection='' }={}) {
  const localDate = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const values = { title, date:localDate, time:[date.getHours(),date.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':'), selection };
  // One pass: inserted values are never interpreted as more placeholders/code.
  return template.replace(/\{\{(title|date|time|selection)\}\}/g, (_,name)=>values[name]);
}
function createPublicAPI(plugin) {
  return Object.freeze({
    version:1,
    request: request=>plugin.agent.request(request),
    formatMarkdown: text=>{ if(typeof text!=='string') throw Error('Expected Markdown text'); return plugin.format.formatMarkdown(text); },
    registerSlashCommand: command=>{ const dispose=plugin.slash.register(command); plugin.register(dispose); return dispose; }
  });
}
function installTemplates(plugin, templates) {
  const validated=validateTemplates(templates);
  for(const dispose of plugin.templateDisposers || []) dispose();
  plugin.templateDisposers=[];
  for(const template of validated) {
    const dispose=plugin.slash.register({ id:template.name, name:template.name, aliases:[],icon:'📝',description:template.description,
      run:({editor,from,to,title})=>{
        const insert=renderTemplate(template.template,{title,selection:editor.getSelection?.() || ''});
        plugin.applyEditorPlan(editor,{changes:[{from,to,insert}],cursor:from+insert.length},'input.hstack-template');
      }
    });
    plugin.templateDisposers.push(dispose);
  }
}
module.exports={validateTemplates,renderTemplate,createPublicAPI,installTemplates};
