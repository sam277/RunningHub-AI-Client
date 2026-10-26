import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { revealInExplorer,createFileRevealer,REVEAL_SCRIPT } from '../server/reveal-file.mjs';
const code=buildSync({entryPoints:[fileURLToPath(new URL('../services/resultPreview.ts',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node'}).outputFiles[0].text,module={exports:{}};
const preview=new Function('module','exports',code+';return module.exports;')(module,module.exports);
test('preview types handle MIME, extensions, download fallback and saved or missing local receipts',()=>{
 assert.equal(preview.resultMediaKind({fileType:'video',fileUrl:'https://test/no-extension'}),'video');
 assert.equal(preview.resultMediaKind({fileType:'audio/wav'}),'audio');assert.equal(preview.resultMediaKind({fileType:'image/jpeg'}),'image');
 assert.equal(preview.resultMediaKind({fileType:'file',downloadUrl:'https://test/name.PNG?token=x'}),'image');
 assert.equal(preview.resultMediaKind({fileType:'pdf',fileUrl:'https://test/file.pdf'}),'file');
 const attempt={outputs:[{fileUrl:'https://remote/video.mp4'},{downloadUrl:'https://remote/fallback.wav'}],files:[{index:0,filename:'0001_中文 name.mp4'}]};
 assert.equal(preview.resultMediaUrl(attempt,0,true),'/__rh/result/'+encodeURIComponent(attempt.files[0].filename));
 assert.equal(preview.resultMediaUrl({...attempt,missingResultIndexes:[0]},0,true),'https://remote/video.mp4');
 assert.equal(preview.resultMediaUrl(attempt,1,true),'https://remote/fallback.wav');assert.equal(preview.resultMediaUrl(attempt,0,false),'https://remote/video.mp4');
});
function fakeShell({fail=false,onRequest=()=>{}}={}){
 return (command,args,options)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};let input='';child.stdin=new Writable({write(chunk,encoding,done){input+=chunk;done();},final(done){queueMicrotask(()=>{onRequest({command,args,options,request:JSON.parse(Buffer.from(input,'base64').toString('utf8'))});if(fail)child.stderr.write('native failure');else child.stdout.write('OK');child.emit('close',fail?1:0);});done();}});return child;};
}
test('Explorer selection sends special-character paths through stdin, not shell arguments',{skip:process.platform!=='win32'},async()=>{
 const path="J:\\测试 目录\\含逗号,单引号'与&符号.mp4";let called=0;
 await revealInExplorer(path,false,{spawnProcess:fakeShell({onRequest(value){called++;assert.equal(value.command,'powershell.exe');assert.equal(value.request.path,path);assert.equal(value.request.directory,false);assert.equal(value.args.includes('-STA'),true);assert.equal(value.args.join(' ').includes(path),false);assert.equal(value.options.windowsHide,true);}})});assert.equal(called,1);
});
test('Explorer failures reject instead of reporting an unconfirmed success',{skip:process.platform!=='win32'},async()=>{
 await assert.rejects(revealInExplorer('J:\\file.mp4',false,{spawnProcess:fakeShell({fail:true})}),/资源管理器未能定位文件/);
});

test('Directory Opus fast path avoids recompilation and preserves Unicode paths',{skip:process.platform!=='win32'},async()=>{
  assert.ok(REVEAL_SCRIPT.indexOf('Add-Type')>REVEAL_SCRIPT.indexOf('}else{'));
  const runtime='D:\\Program Files\\Opus\\dopusrt.exe',target="J:\\测试 目录\\含逗号,单引号'与&符号.mp4",calls=[];
  const spawnProcess=(command,args,options)=>{
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    child.stdin=new Writable({write(_chunk,_encoding,done){done();},final(done){queueMicrotask(()=>{calls.push({command,args,options});if(command==='powershell.exe')child.stdout.write('OK\nOPUS:'+Buffer.from(runtime).toString('base64'));child.emit('close',0);});done();}});
    return child;
  };
  const reveal=createFileRevealer({spawnProcess});await reveal(target);await reveal(target);
  assert.equal(calls[0].command,'powershell.exe');assert.equal(calls[1].command,runtime);
  assert.deepEqual(calls[1].args,['/acmd','Go',target,'OPENCONTAINER','NEWTAB=tofront']);assert.equal(calls[1].options.windowsHide,true);
});
