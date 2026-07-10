import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic units run in Node; DOM-dependent wiring is verified by
    // `npm run build` + manual two-tab testing instead.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
