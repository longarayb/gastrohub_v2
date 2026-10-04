import tseslint from 'typescript-eslint';
import { base } from './base.js';

/**
 * NestJS relies on runtime metadata emitted for constructor parameter types,
 * so type-only imports must NOT be enforced for injectable classes.
 */
export const nest = tseslint.config(...base, {
  rules: {
    '@typescript-eslint/consistent-type-imports': 'off',
    '@typescript-eslint/no-extraneous-class': 'off',
  },
});

export default nest;
