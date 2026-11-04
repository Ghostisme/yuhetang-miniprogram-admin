import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8790'
  const proxy = {'/api': target, '/uploads': target}
  return {
    plugins: [react()],
    server: {host: '0.0.0.0', port: 5181, strictPort: true, proxy},
    preview: {host: '0.0.0.0', port: 5181, strictPort: true, proxy},
  }
})
