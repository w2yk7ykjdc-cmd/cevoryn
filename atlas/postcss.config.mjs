/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Tailwind v4 uses its own PostCSS plugin (Lightning CSS-based, with
    // vendor prefixing built in - autoprefixer is no longer needed and
    // was removed).
    "@tailwindcss/postcss": {},
  },
};

export default config;
