// Guidance documents, frameworks & toolkits Luke authors or contributes to —
// often shared with other school districts. Add an `href` (a public link, a
// hosted PDF, or a Google Doc set to "anyone with the link can view") when each
// one is ready to share publicly. Items without an href render as
// "Available on request". Content confirmed with Luke on 2026-06-05.

export type GuidanceItem = {
  title: string;
  org: string;
  year: string;
  description: string;
  href?: string;
  status?: 'Published' | 'Draft' | 'In review';
};

export const GUIDANCE: GuidanceItem[] = [
  {
    title: '2026 Arizona AI Guidance',
    org: 'Arizona AI Alliance',
    year: '2026',
    status: 'Published',
    description:
      'Contributing author on the statewide generative-AI guidance for Arizona schools — part of the shift from restrictive "red-light" policy toward responsible AI literacy: teaching students when, where, and how to use these tools well.',
    // href: 'https://…',  // add the public link to the released guidance
  },
  {
    title: 'K-12 AI Data Privacy & App-Vetting Checklist',
    org: 'Arizona education community',
    year: '2025',
    status: 'Published',
    description:
      'A practical data-privacy framework and checklist for districts evaluating AI platforms — covering data-protected LLM workspaces, safety standards, and vendor-contract questions administrators can actually use.',
    // href: 'https://…',
  },
  {
    title: '“3ssential” District AI Implementation Framework',
    org: 'Arizona AI Alliance',
    year: '2025–2026',
    status: 'Draft',
    description:
      'A configuration map and “3-in-3 Challenge” to help districts benchmark AI maturity, with verification and state-level badging to recognize districts doing the work.',
  },
  {
    title: 'District AI Guidance & Acceptable-Use Framework',
    org: 'Agua Fria Union High School District',
    year: '2025',
    status: 'Draft',
    description:
      'Locally adapted guidance translating statewide principles into day-to-day practice for staff and students — written for real classrooms, not press releases.',
  },
  {
    title: 'AI Newsletter',
    org: 'Arizona AI Alliance',
    year: '2025–2026',
    status: 'Published',
    description:
      'Curator and author — synthesizing research-to-practice trends, district case studies, and practical AI guidance for Arizona education leaders.',
  },
];
