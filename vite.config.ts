import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787';
const previewHost = process.env.PREVIEW_HOST?.trim();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
    strictPort: true,
    // يُضاف نطاق المعاينة الحالي فقط عند تشغيل نسخة المعاينة، دون السماح بنطاقات عامة.
    allowedHosts: previewHost ? [previewHost] : undefined,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
