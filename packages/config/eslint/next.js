import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/** ESLint config for Next.js apps and React packages. */
export const next = tseslint.config(...base, {
  plugins: {
    '@next/next': nextPlugin,
    'react-hooks': reactHooks,
  },
  languageOptions: {
    globals: { ...globals.browser },
  },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
});

export default next;
