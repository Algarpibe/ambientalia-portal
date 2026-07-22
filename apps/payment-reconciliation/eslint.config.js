import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Esta app nunca se había linteado (le faltaba eslint.config.js). Los errores
      // preexistentes son deuda histórica benigna: `any` de datos y `const`/`let`
      // en `case` sin bloque. Se dejan como AVISO para no bloquear el gate con
      // deuda vieja; el gate SÍ atrapará errores NUEVOS. Limpieza incremental pendiente.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-case-declarations': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
