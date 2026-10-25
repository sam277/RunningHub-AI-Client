import React from 'react';
import './app.css';
import { initializeLocalPersistence } from './services/localPersistence';
import { migrateLegacyWorkspace } from './services/workspaceStorage';
import LocalDataPanel from './components/LocalDataPanel';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LanguageProvider } from './services/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);

// Handle module namespace object if default export is wrapped
// This fixes "object with keys {default}" error when the environment imports the module namespace
const Component = (App as any).default ? (App as any).default : App;

// Note: StrictMode removed to prevent double task submission in development
root.render(<main className="p-8">正在打开独立文件库…</main>);
void (async()=>{
  try {
    await initializeLocalPersistence();
    await migrateLegacyWorkspace();
    root.render(<LanguageProvider><Component /></LanguageProvider>);
  } catch(error:any) {
    root.render(<div className="p-6"><h1 className="mb-3 font-semibold">本地数据尚未就绪，已暂停任务提交</h1><p role="alert">{error.message || '请检查数据目录与启动入口。'}</p><button className="my-4 rounded border p-2" onClick={()=>window.location.reload()}>重试连接</button><LocalDataPanel /></div>);
  }
})();
