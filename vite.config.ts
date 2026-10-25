import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createLocalAPI, resolveDataDirectory } from './server/local-api.mjs';

export default defineConfig(async ({ mode }) => {
  const env=loadEnv(mode,'.','');
  const dataDirectory=await resolveDataDirectory(__dirname);
  return {
    cacheDir:path.join(dataDirectory,'cache','vite'),
    server:{port:5187,strictPort:true,host:'127.0.0.1',watch:{ignored:['**/src-tauri/target/**','**/dist/**','**/.browser-test-output/**']}},
    plugins:[react(),{
      name:'rh-local-persistence',
      async configureServer(server) {
        const api=await createLocalAPI({project:__dirname,dataDirectory});
        server.middlewares.use((req,res,next)=>{void api.middleware(req,res,next);});
        server.httpServer?.once('close',()=>{void api.close();});
      },
    }],
    define:{'process.env.API_KEY':JSON.stringify(env.GEMINI_API_KEY),'process.env.GEMINI_API_KEY':JSON.stringify(env.GEMINI_API_KEY)},
    resolve:{alias:{'@':path.resolve(__dirname,'.')}},
  };
});
