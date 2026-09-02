// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// NOTE: This is configured for a GitHub *user* site served at the root domain.
// To go live, create a repo named exactly `lukeallpress.github.io` under the
// `lukeallpress` account. Then `site` below is correct and no `base` is needed.
//
// If you'd rather use a *project* repo (e.g. github.com/lukeallpress/luke-site),
// the site would live at https://lukeallpress.github.io/luke-site/ — in that
// case set `base: '/luke-site'` and update `site` accordingly. The user-site
// approach (current) gives the cleanest URL and is recommended.
export default defineConfig({
  site: 'https://lukeallpress.github.io',
  integrations: [
    sitemap({
      // The finance dashboard is private (noindex, passphrase-gated). Keep it
      // out of the sitemap so it is never advertised to crawlers.
      filter: (page) => !page.includes('/finances'),
    }),
  ],
  // Later, to use a custom domain: keep `site` pointing at the final domain,
  // add a CNAME file in /public, and point DNS at GitHub Pages. No rebuild logic
  // changes are required.
});
