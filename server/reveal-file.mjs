import { spawn } from 'node:child_process';

// SHOpenFolderAndSelectItems: cidl=0 selects the full item PIDL in its parent folder.
// https://learn.microsoft.com/windows/win32/api/shlobj_core/nf-shlobj_core-shopenfolderandselectitems
export const REVEAL_SCRIPT = `
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
try {

  $request=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json);
  # A running Directory Opus may intercept Shell selection without bringing the file forward.
  # Use its supported command entry point when available; do not change system associations.
  $opus=Get-Process -Name dopus -ErrorAction SilentlyContinue | Select-Object -First 1;
  $runtime=if($opus -and $opus.Path){Join-Path (Split-Path -LiteralPath $opus.Path) 'dopusrt.exe'}else{$null};
  if($runtime -and (Test-Path -LiteralPath $runtime -PathType Leaf)){
    $arguments='/acmd Go "'+[string]$request.path+'" '+$(if([bool]$request.directory){''}else{'OPENCONTAINER '})+'NEWTAB=tofront';
    $command=Start-Process -FilePath $runtime -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru;
    if($command.ExitCode -ne 0){throw 'Directory Opus rejected file selection'}
  }else{
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RHExplorer {
 [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved,uint mode);
 [DllImport("ole32.dll")] static extern void CoUninitialize();
 [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr value);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHParseDisplayName(string name,IntPtr binding,out IntPtr pidl,uint attrs,out uint found);
 [DllImport("shell32.dll")] static extern int SHOpenFolderAndSelectItems(IntPtr pidl,uint count,IntPtr children,uint flags);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern IntPtr ShellExecute(IntPtr hwnd,string operation,string file,string parameters,string directory,int show);
 public static void Open(string path,bool directory) {
  if(directory){if(ShellExecute(IntPtr.Zero,"open",path,null,null,1).ToInt64()<=32)throw new Exception("Cannot open folder");return;}
  int initialized=CoInitializeEx(IntPtr.Zero,2);if(initialized<0)Marshal.ThrowExceptionForHR(initialized);
  IntPtr pidl=IntPtr.Zero;
  try{uint attrs;Marshal.ThrowExceptionForHR(SHParseDisplayName(path,IntPtr.Zero,out pidl,0,out attrs));Marshal.ThrowExceptionForHR(SHOpenFolderAndSelectItems(pidl,0,IntPtr.Zero,0));}
  finally{if(pidl!=IntPtr.Zero)CoTaskMemFree(pidl);CoUninitialize();}
 }
}
'@;
    [RHExplorer]::Open([string]$request.path,[bool]$request.directory);
  }
  [Console]::WriteLine('OK');
  if($runtime){[Console]::Write('OPUS:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime)));}
} catch { [Console]::Error.Write('Explorer failed: '+$_.Exception.Message); exit 1; }
`;
// Cache the native command entry point after discovery; subsequent clicks need no
// PowerShell startup or C# compilation. Each invocation still waits for its exit.
export function createFileRevealer({spawnProcess=spawn}={}){
  let cached,warming;
  const remember=output=>{const match=output.match(/OPUS:([A-Za-z0-9+/=]+)/);if(match)cached={runtime:Buffer.from(match[1],'base64').toString('utf8')};};
  const run=(command,args,input,requireOK)=>new Promise((resolve,reject)=>{
    let output='',failure='',settled=false;
    const child=spawnProcess(command,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(output);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('资源管理器响应超时，请重试定位文件'));},15000);
    child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>failure=(failure+data).slice(-1200));
    child.once('error',()=>finish(new Error('无法启动 Windows 文件定位服务')));
    child.once('close',code=>finish(code===0&&(!requireOK||output.trim().split(/\r?\n/)[0]==='OK')?undefined:new Error('资源管理器未能定位文件：'+(failure.trim()||'系统未确认打开'))));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
  const reveal=async(path,directory=false)=>{
    if(process.platform!=='win32')throw new Error('定位功能当前支持 Windows');
    if(typeof path!=='string'||!path||path.includes('\0'))throw new Error('定位路径无效');
    if(warming)await warming;
    if(cached){
      try{await run(cached.runtime,['/acmd','Go',path,...(directory?[]:['OPENCONTAINER']),'NEWTAB=tofront'],'',false);return {ok:true};}
      catch{cached=undefined;}
    }
    const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-STA','-Command',REVEAL_SCRIPT],Buffer.from(JSON.stringify({path,directory}),'utf8').toString('base64'),true);
    remember(output);
    return {ok:true};
  };
  reveal.prepare=()=>{
    if(process.platform!=='win32'||cached)return Promise.resolve();
    if(warming)return warming;
    const script="$ErrorActionPreference='Stop';$opus=Get-Process -Name dopus -ErrorAction SilentlyContinue|Select-Object -First 1;if($opus -and $opus.Path){$runtime=Join-Path (Split-Path -LiteralPath $opus.Path) 'dopusrt.exe';if(Test-Path -LiteralPath $runtime -PathType Leaf){[Console]::Write('OPUS:'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runtime)));}}";
    warming=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],'',false).then(remember).catch(()=>{}).finally(()=>{warming=undefined;});
    return warming;
  };
  return reveal;
}
const nativeReveal=createFileRevealer();
export const prepareFileRevealer=()=>nativeReveal.prepare();
export async function revealInExplorer(path,directory=false,options){
  return (options?createFileRevealer(options):nativeReveal)(path,directory);
}
