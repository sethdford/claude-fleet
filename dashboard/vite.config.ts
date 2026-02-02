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
      '/memory': 'http://localhost:3847',
      '/routing': 'http://localhost:3847',
      '/audit': 'http://localhost:3847',
      '/search': 'http://localhost:3847',
      '/dag': 'http://localhost:3847',
      '/lmsh': 'http://localhost:3847',
      '/workitems': 'http://localhost:3847',
      '/batches': 'http://localhost:3847',
      '/webhooks': 'http://localhost:3847',
      '/coordination': 'http://localhost:3847',
      '/users': 'http://localhost:3847',
      '/chats': 'http://localhost:3847',
      '/handoffs': 'http://localhost:3847',
      '/checkpoints': 'http://localhost:3847',
      '/templates': 'http://localhost:3847',
      '/triggers': 'http://localhost:3847',
      '/steps': 'http://localhost:3847',
      '/compound': 'http://localhost:3847',
      '/waves': 'http://localhost:3847',
      '/multi-repo': 'http://localhost:3847',
      '/worktrees': 'http://localhost:3847',
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
