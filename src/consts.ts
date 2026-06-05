// Site-wide constants. Edit these to update metadata everywhere.

export const SITE = {
  name: 'Luke Allpress',
  // Headline / role line
  title: 'Luke Allpress — Education Technology & AI Leader',
  tagline: 'Making complicated things simple.',
  role: 'CETL · Director of Innovative Solutions',
  location: 'Phoenix, Arizona',
  description:
    'Luke Allpress is an education technology and AI leader in Arizona — Director of Innovative Solutions at Agua Fria Union High School District, AzTEA board member, and contributor to the Arizona AI Alliance. Projects, writing, and selected work.',
  // Used by sitemap/RSS and absolute URLs. Keep in sync with astro.config.mjs.
  url: 'https://lukeallpress.github.io',
  email: 'lallpress@aguafria.org',
};

// Primary navigation
export const NAV = [
  { label: 'Work', href: '/#work' },
  { label: 'Writing', href: '/writing' },
  { label: 'Speaking', href: '/#speaking' },
  { label: 'CV', href: '/cv' },
];

// External / social links. Add or remove freely.
export const SOCIAL = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/lukeallpress' },
  { label: 'Email', href: 'mailto:lallpress@aguafria.org' },
  // { label: 'GitHub', href: 'https://github.com/lukeallpress' },
];
