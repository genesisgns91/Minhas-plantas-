import globals from 'globals';
export default [{
  files: ['js/**/*.js', 'sw.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-redeclare': 'error' }
}];
