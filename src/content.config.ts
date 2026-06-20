import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// —— Writing: introspective essays / blog posts ————————————————
const writing = defineCollection({
  loader: glob({ base: './src/content/writing', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    // One-line standfirst shown in lists and at the top of the essay
    summary: z.string(),
    date: z.coerce.date(),
    // Optional: where this first appeared, e.g. "Adapted from LinkedIn"
    origin: z.string().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// —— Projects: selected work / demos ——————————————————————————
const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    // Lower number = shown earlier in "Selected Work"
    order: z.number().default(99),
    // Short category label, e.g. "Web app", "Bot", "Infrastructure"
    kind: z.string().optional(),
    year: z.coerce.string().optional(),
    // Maturity badge: e.g. "Live", "Prototype", "Demo", "Internal". Omit to hide.
    status: z.string().optional(),
    tags: z.array(z.string()).default([]),
    // Optional live demo + source links. Leave blank to hide the link.
    demo: z.string().optional(),
    source: z.string().optional(),
    // Show on the home page "Selected Work" grid
    featured: z.boolean().default(true),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, projects };
