import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const load=path=>{const code=buildSync({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,module={exports:{}};return new Function('module','exports',code+';return module.exports;')(module,module.exports);};
const accounts=load('../services/accountManagement.ts'),presentation=load('../services/productionPresentation.ts');
test('account text import previews malformed groups and skips duplicates without replacing existing identity',()=>{
 const existing=[{id:'keep-id',apiKey:'key-a',note:'keep note',enabled:false}];
 const rows=accounts.parseAccountImport('key-a\nchanged note\n\nkey-b\nnew note\n\nkey-b\nrepeat\n\norphan-key',existing);
 assert.equal(rows.length,4);assert.equal(rows[0].duplicate,true);assert.equal(rows[2].duplicate,true);assert.match(rows[3].issue,/缺少备注/);
 const merged=accounts.mergeImportedAccounts(existing,rows);assert.equal(merged.added.length,1);assert.equal(merged.accounts[0],existing[0]);assert.equal(merged.added[0].enabled,false);
});
test('text and JSON account exports round trip names and keys; malformed JSON is not misread as key text',()=>{
 const input=[{id:'a',apiKey:'alpha-key',note:'邮箱@example.test'},{id:'b',apiKey:'beta-key',note:'备用账号'}];
 for(const format of ['text','json']){const rows=accounts.parseAccountImport(accounts.exportAccounts(input,format),[]);assert.deepEqual(rows.map(({apiKey,note})=>({apiKey,note})),input.map(({apiKey,note})=>({apiKey,note})));assert.ok(rows.every(r=>!r.issue));}
 assert.match(accounts.parseAccountImport('{broken',[])[0].issue,/JSON/);assert.equal(accounts.parseAccountImport(accounts.exportAccounts([{apiKey:'paused-key',note:'paused',enabled:false}],'json'),[])[0].enabled,false);assert.equal(accounts.maskAccountKey('alpha-private-key').includes('private'),false);
});
test('record durations distinguish reported zero, observed waiting and unknown historic timing',()=>{
 const base={status:'saved',createdAt:1000,updatedAt:999999,usage:{taskTime:272,taskTimeReported:true}};
 assert.equal(presentation.attemptDuration(base).value,'4分32秒');
 assert.equal(presentation.attemptDuration({...base,usage:{taskTime:0,taskTimeReported:true}}).value,'0秒');
 assert.equal(presentation.attemptDuration({...base,usage:undefined}).value,'未记录');
 const observed={...base,usage:undefined,timings:{generationObservedAt:61000,archivedAt:500000}};
 assert.equal(presentation.attemptDuration(observed).value,'1分');assert.equal(presentation.attemptDuration(observed).label,'总等待');
 assert.deepEqual(presentation.timingDetails(observed),[['总等待','1分']]);assert.equal(presentation.formatDuration(3600),'1小时');
});
