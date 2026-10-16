import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/** ESLint config for React apps outside Next (the Android courier app, D050). */
export const react = tseslint.config(...base, {
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
});

export default react;
