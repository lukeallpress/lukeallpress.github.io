// ============================================================
// Structured resume / CV data.
// Single source of truth for the CV page and the home page's
// "Speaking & Community" and "Toolkit" sections.
//
// Content sources: Luke's LinkedIn, plus the chatgpt/gemini
// briefs he supplied (derived from his Gmail/Drive/Calendar).
// Claims were reviewed and confirmed with Luke on 2026-06-05.
// ============================================================

export const ABOUT = `I help schools turn fast-moving technology into something people can actually use. As Director of Innovative Solutions at the Agua Fria Union High School District, I lead the practical, human side of AI and edtech adoption — building tools, writing guidance, and growing the learning communities that let educators move with confidence.

A lot of my work is translation: between technical systems and human needs, between emerging tools and the realities of a school system, and between what's possible and what's responsible. I came up through the classroom — math and science teacher, interventionist, Teach For America — and that grounding still shapes how I think about every rollout.

My north star is simple: make complicated things simple. That looks like district-owned software instead of another subscription, AI guidance written for real classrooms instead of press releases, and a steady focus on student benefit, leader literacy, and trust.`;

// Short bios for reuse (speaker intros, etc.)
export const BIO_SHORT =
  'Luke Allpress is a K12 innovation and technology leader focused on responsible AI implementation, practical tool-building, and the human side of educational change — across district systems, statewide guidance, professional learning, and public writing in Arizona education.';

export type ExperienceItem = {
  org: string;
  role: string;
  start: string;
  end: string; // 'Present' for current
  location?: string;
  summary?: string;
  current?: boolean;
};

export const EXPERIENCE: ExperienceItem[] = [
  {
    org: 'Agua Fria Union High School District',
    role: 'Director of Innovative Solutions',
    start: 'Mar 2024',
    end: 'Present',
    location: 'Avondale, AZ',
    current: true,
    summary:
      'Lead the district’s innovation, edtech, and AI strategy — building in-house tools, authoring AI guidance, and running professional learning so staff can adopt new technology safely and confidently.',
  },
  {
    org: 'Arizona Technology in Education Association (AzTEA)',
    role: 'Board President-Elect',
    start: 'Jun 2026',
    end: 'Present',
    current: true,
    summary:
      'Elected to lead Arizona’s ISTE affiliate and CoSN state chapter. Previously Board Secretary (2024–2026); board member since 2023. Lead statewide initiatives including the AzTEA Trusted Learning Environment (TLE) cohort.',
  },
  {
    org: 'Agua Fria Union High School District',
    role: 'Technology Specialist',
    start: 'Jan 2022',
    end: 'Mar 2024',
    summary:
      'Built administrative systems and supported district technology operations and leadership development.',
  },
  {
    org: 'Agua Fria Union High School District',
    role: 'Site & District DEI Lead',
    start: '2020',
    end: '2024',
    summary:
      'Led diversity, equity, and inclusion work at the site and district level — facilitating article discussions and building strategic plans to support the district’s diverse students and teachers.',
  },
  {
    org: 'Agua Fria High School',
    role: 'Interventionist',
    start: 'Jul 2018',
    end: 'Dec 2021',
    location: 'Avondale, AZ',
    summary:
      'Managed student data, created administrative systems, and supported teacher intervention strategies through the PLC model at a high school of 1,800 students.',
  },
  {
    org: 'Agua Fria High School',
    role: 'Math & Science Teacher',
    start: 'Jul 2013',
    end: 'Jun 2018',
    summary: 'Taught math and science, grades 10–12.',
  },
  {
    org: 'Teach For America',
    role: 'Corps Member',
    start: 'May 2013',
    end: 'May 2015',
    location: 'Greater Phoenix Area',
    summary: 'Math and science teacher, grades 10–12.',
  },
];

// Roles/affiliations beyond the employment timeline above.
export type AffiliationItem = { org: string; role: string; detail?: string; verify?: boolean };

export const AFFILIATIONS: AffiliationItem[] = [
  {
    org: 'AzTEA (Arizona Technology in Education Association)',
    role: 'Board President-Elect',
    detail: 'Arizona’s CoSN chapter and ISTE / ASCD affiliate.',
  },
  {
    org: 'Arizona AI Alliance',
    role: 'Core team member',
    detail: 'Statewide collaboration on responsible AI in education; contributing author on the Arizona AI Guidance.',
  },
  {
    org: 'BRIDGE Consulting',
    role: 'Partner & co-founder',
    detail: 'AI advisory, training, and operational support for education systems and nonprofits.',
  },
];

export type SpeakingItem = {
  title: string;
  venue: string;
  year: string;
  kind: 'Keynote' | 'Session' | 'Workshop' | 'Panel' | 'Webinar';
  note?: string;
  verify?: boolean;
};

// Ordered most-recent first.
export const SPEAKING: SpeakingItem[] = [
  {
    title: 'Becoming a Builder in the Age of AI',
    venue: 'AZ CSTA',
    year: 'Jul 2026',
    kind: 'Session',
    note: 'The three kinds of software “builders” emerging inside a district in the AI era — pre-AI, alongside-AI, and AI-only — and how we scaffold PD and development infrastructure so any staffer can build tools safely. Wins, cautionary tales, and open-source (Google Apps Script) demos.',
  },
  {
    title: '2026 Arizona AI Guidance — State Launch Webinar',
    venue: 'AZ AI Alliance',
    year: 'Jun 2026',
    kind: 'Webinar',
    note: 'Featured speaker for the public release of the updated statewide generative-AI guidance for Arizona schools.',
  },
  {
    title: 'Vibe Coding for Educators',
    venue: 'AzTEA (ISTE / CoSN Arizona)',
    year: 'May 2026',
    kind: 'Workshop',
    note: 'Hands-on session on building dashboards, workflows, and tools with AI — safely.',
  },
  {
    title: 'Building with Agentic AI',
    venue: 'AzTEA CIO/CTO Meetup',
    year: 'May 2026',
    kind: 'Session',
    note: 'District web-app features, an MCP server for safe agentic tasks, and self-hosted open-source LLMs.',
  },
  {
    title: 'Achieving Statewide AI Leadership',
    venue: 'CoSN 2026 Annual Conference',
    year: '2026',
    kind: 'Session',
    note: 'With Arizona AI Alliance colleagues: how a grassroots coalition became statewide influence — the only state with official AI guidance delivered by a non-governmental entity — now reaching 14+ education organizations through guidance, PD, summits, and newsletters, with a deliberate focus on rural schools.',
  },
  {
    title: 'Human-Centered Design for Education',
    venue: 'AzTEA CI&IT Symposium',
    year: 'Apr 2025',
    kind: 'Keynote',
    note: 'Keynote blending Universal Design for Learning and human-centered design — bringing the NETP pillars of Access, Design, and Use to life so districts build systems that actually work for the humans in them.',
  },
  {
    title: 'Cybersecurity for K12 School Districts',
    venue: 'CoSN 2025 Annual Conference',
    year: '2025',
    kind: 'Session',
    note: 'Practical cybersecurity strategies for protecting district systems and student data.',
    verify: true, // VERIFY: confirm the exact 2025 CoSN session title
  },
  {
    title: 'Learning Futures Tech & Media Meeting',
    venue: 'The Learning Counsel — Phoenix, AZ',
    year: 'Feb 2025',
    kind: 'Panel',
    note: 'Panelist at The Learning Counsel’s regional executive discussion for Arizona district leaders — edtech trends, AI, and workflow, alongside area superintendents and academic leaders.',
  },
  {
    title: 'AI Implementation in K12',
    venue: 'Arizona CIO/CTO Summit',
    year: '2024',
    kind: 'Session',
    note: 'Moving districts from AI curiosity to responsible, practical implementation.',
    verify: true, // VERIFY: confirm exact event name + year with Luke
  },
  {
    title: 'Data-Informed RTI Systems',
    venue: 'Arizona CIO/CTO Summit',
    year: '2023',
    kind: 'Session',
    note: 'Designing Response-to-Intervention systems that make good use of staff and student time.',
    verify: true, // VERIFY: confirm exact event name + year with Luke
  },
];

export type CommitteeItem = {
  org: string;
  role: string;
  detail?: string;
  verify?: boolean;
};

export const COMMITTEES: CommitteeItem[] = [
  {
    org: 'CoSN Driving K12 Innovation Advisory Board',
    role: 'Advisory board member',
    detail: 'Member of CoSN’s global advisory board producing the Driving K12 Innovation trend reports on emerging technology in teaching and learning.',
  },
  {
    org: 'Arizona AI Alliance',
    role: 'Core team member',
    detail: 'Contributing author on the 2026 Arizona AI Guidance and statewide AI strategy for education.',
  },
  {
    org: 'AzTEA (Arizona Technology in Education Association)',
    role: 'Board President-Elect',
    detail: 'Arizona’s ISTE affiliate and CoSN state chapter. Previously Board Secretary.',
  },
  {
    org: 'AzTEA Trusted Learning Environment (TLE) Cohort',
    role: 'Facilitator / Lead',
    detail: 'A statewide cohort working together to strengthen student-data-privacy practices and earn CoSN TLE seals.',
  },
  {
    org: 'AI Learning Network — Community of Practice',
    role: 'Founder / Facilitator',
    detail: 'A cross-district monthly forum for edtech practitioners to share what’s working and work through hard implementation questions.',
  },
];

// Grouped technical / professional toolkit.
export type SkillGroup = { label: string; items: string[] };

export const SKILLS: SkillGroup[] = [
  {
    label: 'Data & systems',
    items: ['SQL Server', 'Synergy SIS data workflows', 'Data cleaning & integration', 'Reporting & dashboards'],
  },
  {
    label: 'Building',
    items: ['Python', 'Dash / Plotly', 'Google Apps Script', 'Git / GitHub', 'Workflow automation'],
  },
  {
    label: 'AI',
    items: ['AI-assisted development', 'MCP & agentic tooling', 'Self-hosted open-source LLMs', 'Prompt & workflow design'],
  },
  {
    label: 'Practice',
    items: ['AI guidance & policy', 'Data privacy (CoSN TLE)', 'Professional learning & facilitation', 'Change leadership'],
  },
];

export type AwardItem = { name: string; org: string; year: string; detail?: string };

export const AWARDS: AwardItem[] = [
  {
    name: 'District Team Leadership Award',
    org: 'CoSN (Consortium for School Networking)',
    year: '2025',
    detail: 'Awarded to Agua Fria UHSD’s Innovative Solutions Department for building in-house apps that support students and staff district-wide.',
  },
];

export type CredItem = { name: string; org: string; detail?: string };

export const EDUCATION: CredItem[] = [
  {
    name: 'Arizona State University',
    org: 'Arizona State University',
    detail: 'Master of Education (M.Ed.), 2015',
  },
  {
    name: 'University of Washington',
    org: 'University of Washington',
    detail: 'B.S. Bioengineering, with Honors, 2013',
  },
];

export const CERTS: CredItem[] = [
  {
    name: 'CETL — Certified Education Technology Leader',
    org: 'CoSN (Consortium for School Networking)',
  },
];
