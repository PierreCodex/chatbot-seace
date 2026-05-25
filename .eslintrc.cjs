/**
 * boundaries: enforce hexagonal-lite import rules from docs/07-arquitectura-backend.md
 *   - src/modules/**   must NOT import from src/adapters/**
 *   - src/ports/**     must NOT import from src/adapters/** or src/modules/**
 *   - src/adapters/**  must NOT import from other adapters or from src/modules/**
 *   - src/common/**    must NOT import from src/adapters/** or src/modules/**
 */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'boundaries'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:boundaries/strict',
  ],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['.eslintrc.cjs', 'dist/', 'node_modules/', 'prisma/'],
  settings: {
    'boundaries/include': ['src/**/*.ts'],
    'boundaries/elements': [
      { type: 'ports',    pattern: 'src/ports/**' },
      { type: 'adapters', pattern: 'src/adapters/*', mode: 'folder', capture: ['family'] },
      { type: 'modules',  pattern: 'src/modules/*',  mode: 'folder', capture: ['name'] },
      { type: 'workers',  pattern: 'src/workers/**' },
      { type: 'jobs',     pattern: 'src/jobs/**' },
      { type: 'common',   pattern: 'src/common/**' },
      { type: 'config',   pattern: 'src/config/**' },
      { type: 'root',     pattern: 'src/*.ts',       mode: 'file' },
    ],
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        rules: [
          { from: 'ports',    allow: ['ports'] },
          { from: 'common',   allow: ['common'] },
          { from: 'config',   allow: ['config', 'common'] },
          { from: 'jobs',     allow: ['jobs'] },
          {
            from: 'adapters',
            allow: ['ports', 'common', 'config', 'jobs', ['adapters', { family: '${from.family}' }]],
          },
          {
            from: 'modules',
            allow: ['ports', 'common', 'config', 'jobs', 'modules'],
          },
          { from: 'workers',  allow: ['ports', 'common', 'config', 'jobs', 'modules'] },
          { from: 'root',     allow: ['adapters', 'modules', 'workers', 'config', 'common', 'ports'] },
        ],
      },
    ],
  },
};
