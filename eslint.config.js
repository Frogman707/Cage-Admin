// Minimal lint config for a no-build, plain-<script> codebase. index.html, avatar/app.js,
// partner-admin/app.js, and shared/*.js all define and consume globals across separate <script>
// tags with no module system - and index.html's HTML additionally references many of those
// functions only from inline onclick="..." attributes, which ESLint can't see either way. So
// no-unused-vars stays off for the browser-side files: every top-level function there would show
// up as a false positive. functions/index.js is an ordinary Node/CommonJS module (no cross-file
// globals problem), so it gets the stricter rule.
const js = require("@eslint/js");
const html = require("eslint-plugin-html");

const BROWSER_GLOBALS = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  localStorage: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  navigator: "readonly",
  location: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  Promise: "readonly",
  URL: "readonly",
  Blob: "readonly",
  firebase: "readonly",
};

module.exports = [
  js.configs.recommended,
  {
    files: ["**/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: BROWSER_GLOBALS,
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["avatar/**/*.js", "partner-admin/**/*.js", "shared/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: BROWSER_GLOBALS,
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        exports: "writable",
        require: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ["node_modules/**", "functions/node_modules/**", "shared/assets/**", "eslint.config.js"],
  },
];
