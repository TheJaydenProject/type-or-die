import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'

export default [
  {
    ignores: ['dist']
  },
  // Use standard JS rules
  js.configs.recommended,
  // Use Vue Essential rules
  ...pluginVue.configs['flat/essential'],
  
  {
    files: ['**/*.{js,mjs,cjs,vue}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      // Add custom rules here if needed
      'no-unused-vars': 'warn',
      'vue/multi-word-component-names': 'off' // Optional: turns off the rule requiring multi-word component names
    }
  }
]