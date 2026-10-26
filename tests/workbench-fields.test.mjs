import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../services/workbenchFields.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,module={exports:{}};
const fields=new Function('module','exports',code+';return module.exports;')(module,module.exports);
const node=(type='IMAGE')=>({nodeId:'1',fieldName:'reference',fieldType:type,fieldValue:'upload/account-specific.png'});
const clipboard=files=>({files,items:[]});
test('media paste consumes one real matching clipboard file and never imports plain URLs or HTML',()=>{
 const image=new File([new Uint8Array([1,2,3])],'screenshot.png',{type:'image/png'});
 assert.equal(fields.pastedMedia(clipboard([image]),'IMAGE').file,image);
 assert.ok(fields.pastedMedia(clipboard([]),'VIDEO').error);
 assert.ok(fields.pastedMedia(clipboard([image]),'AUDIO').error);
 assert.ok(fields.pastedMedia(clipboard([image,image]),'IMAGE').error);
 assert.ok(fields.pastedMedia(clipboard([new File([],'empty.png',{type:'image/png'})]),'IMAGE').error);
 const movie=new File([new Uint8Array([1])],'video.mp4');assert.equal(fields.pastedMedia(clipboard([movie]),'VIDEO').file,movie);
 const audio=new File([new Uint8Array([1])],'audio.wav',{type:'audio/wav'});assert.equal(fields.pastedMedia(clipboard([audio]),'AUDIO').file,audio);
 const fromItem={files:[],items:[{kind:'file',getAsFile:()=>image},{kind:'string',getAsFile:()=>null}]};assert.equal(fields.pastedMedia(fromItem,'IMAGE').file,image);
 assert.ok(fields.pastedMedia(clipboard([new File(['https://site/video.mp4'],'link.txt',{type:'text/plain'})]),'VIDEO').error);
});
test('media comparison hashes bytes instead of trusting matching names, sizes or account upload URLs',async()=>{
 const a=new File(['first'],'same.png',{type:'image/png',lastModified:1}),same=new File(['first'],'same.png',{type:'image/png',lastModified:1}),b=new File(['other'],'same.png',{type:'image/png',lastModified:1});
 const tokenA=await fields.fieldTokens([node()],{'single|1|reference':a}),tokenSame=await fields.fieldTokens([{...node(),fieldValue:'upload/other-account.png'}],{'single|1|reference':same}),tokenB=await fields.fieldTokens([node()],{'single|1|reference':b});
 assert.deepEqual(tokenA,tokenSame);assert.notDeepEqual(tokenA,tokenB);
 const hash=await fields.fileDigest(a);assert.deepEqual(tokenA,await fields.fieldTokens([node()],{'single|1|reference':{$rhFile:hash}}));
});
test('comparison groups keep application and field identity separate and fingerprints include effective values',async()=>{
 assert.notEqual(fields.schemaKey('111',[node()]),fields.schemaKey('222',[node()]));
 assert.notEqual(fields.schemaKey('111',[node()]),fields.schemaKey('111',[{...node(),fieldName:'another'}]));
 const choice={...node('LIST'),fieldData:JSON.stringify(['small','large'])};assert.notEqual(fields.schemaKey('111',[choice]),fields.schemaKey('111',[{...choice,fieldData:JSON.stringify(['small','medium'])}]));
 assert.notEqual(fields.schemaKey('111',[node()]),fields.schemaKey('111',[{...node(),required:true}]));
 assert.equal(fields.schemaKey('111',[node(),{...node('STRING'),nodeId:'2'}]),fields.schemaKey('111',[{...node('STRING'),nodeId:'2'},node()]));
 assert.notEqual(await fields.configurationFingerprint([node('STRING')],{},{}),await fields.configurationFingerprint([{...node('STRING'),fieldValue:'changed'}],{},{}));
 assert.notEqual(await fields.configurationFingerprint([node('STRING')],{},{instanceType:'default'}),await fields.configurationFingerprint([node('STRING')],{},{instanceType:'plus'}));
});

test('configuration digest tracks batch-only changes, effective row media and instance options without exposing secrets',async()=>{
 const base={nodes:[node('STRING')],batchList:[[{...node('STRING'),_taskId:'row-a',fieldValue:'row value'}]],pendingFiles:{},instanceType:'default',runOptions:{accessPassword:'secret-fixture'}};
 const first=await fields.taskConfigurationDigest(base,'111');assert.match(first,/^[a-f0-9]{64}$/);
 assert.notEqual(first,await fields.taskConfigurationDigest({...base,batchList:[[{...node('STRING'),fieldValue:'different row'}]]},'111'));
 assert.notEqual(first,await fields.taskConfigurationDigest({...base,instanceType:'plus'},'111'));
 const fileA=new File(['same'],'a.png'),fileB=new File(['other'],'a.png');
 const media={nodes:[node()],batchList:[[{...node(),_taskId:'row-a'}]],pendingFiles:{'row-a|1|reference':fileA}};
 assert.notEqual(await fields.taskConfigurationDigest(media,'111'),await fields.taskConfigurationDigest({...media,pendingFiles:{'row-a|1|reference':fileB}},'111'));
});
