import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'http://localhost:8787/' },
    },
  },
});