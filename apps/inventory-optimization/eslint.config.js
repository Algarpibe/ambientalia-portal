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
      // Patrones idiomáticos y benignos (set-default guardado, sync al cambiar de
      // usuario, fade-in al montar): se dejan como AVISO, no como error, para no
      // forzar refactors arriesgados en render que ya funciona (auditoría, ítem C).
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
