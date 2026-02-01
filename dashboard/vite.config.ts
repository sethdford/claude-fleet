import { defineConfig } from 'vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/dashboard/',
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3847',
      '/health': 'http://localhost:3847',
      '/metrics': 'http://localhost:3847',
      '/orchestrate': 'http://localhost:3847',
      '/swarms': 'http://localhost:3847',
      '/blackboard': 'http://localhost:3847',
      '/spawn-queue': 'http://localhost:3847',
      '/teams': 'http://localhost:3847',
      '/tasks': 'http://localhost:3847',
      '/tldr': 'http://localhost:3847',
      '/pheromones': 'http://localhost:3847',
      '/beliefs': 'http://localhost:3847',
      '/credits': 'http://localhost:3847',
      '/consensus': 'http://localhost:3847',
      '/bids': 'http://localhost:3847',
      '/payoffs': 'http://localhost:3847',
      '/scheduler': 'http://localhost:3847',
      '/mail': 'http://localhost:3847',
      '/workflows': 'http://localhost:3847',
      '/executions': 'http://localhost:3847',
      '/debug': 'http://localhost:3847',
      '/ws': {
        target: 'http://localhost:3847',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../public/dashboard',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit'],
          'vendor-chartjs': ['chart.js'],
          'vendor-d3': [
            'd3-selection',
            'd3-force',
            'd3-drag',
            'd3-zoom',
            'd3-transition',
          ],
        },
      },
    },
  },
});
