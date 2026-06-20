import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__test__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/config.ts',
        'src/tech-detect.ts',
        'src/prompts.ts',
        'src/output.ts',
        'src/rules.ts',
        'src/llm/json-parser.ts',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});
