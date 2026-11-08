import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
const network = { host: '0.0.0.0', port: 5188, strictPort: true }
export default defineConfig({ plugins: [vue()], server: { ...network }, preview: { ...network }, build: { chunkSizeWarningLimit: 1000 } })
