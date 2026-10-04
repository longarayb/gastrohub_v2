import { next } from '@gastrohub/config/eslint/next';

export default [
  ...next,
  {
    rules: {
      // Not a Next.js app: pages/ and next/link rules do not apply here.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];
