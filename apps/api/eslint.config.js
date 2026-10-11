import nest from '@app/config/eslint/nest';

/**
 * The platform admin module (D041) reads across restaurants. Outside it, only its explicit,
 * restricted surface may be imported: the current store's own billing state, the route
 * decorators and the metadata keys. Everything else (directory, customers, admin auth...) is
 * off limits, so no restaurant code can reach other tenants through it.
 */
const PLATFORM_ALLOWED = [
  '**/platform/billing-access.service.js',
  '**/platform/billing.decorators.js',
  '**/platform/platform.keys.js',
  '**/platform/platform.module.js',
];

export default [
  ...nest,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/modules/platform/**', 'src/cli/**', 'src/app.module.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/platform/*', ...PLATFORM_ALLOWED.map((p) => `!${p}`)],
              message:
                'Fora do módulo platform, use só billing-access.service, billing.decorators e platform.keys (D041).',
            },
          ],
        },
      ],
    },
  },
];
