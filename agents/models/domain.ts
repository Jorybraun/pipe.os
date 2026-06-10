import { z } from 'zod';

// Core Domain entity for CEO_STUDIO
// Based on domain-creation-process.md + system-overview.md + domain-terminology.md

export const DomainStatus = z.enum([
  'Defined_Initial',
  'In_Review',
  'Clean',
  'Dirty',
  'Archived'
]);

export const DomainRelationship = z.object({
  domainId: z.string().uuid(),
  type: z.enum(['depends_on', 'depended_by', 'contains', 'overlaps', 'related']),
  notes: z.string().optional()
});

export const Feature = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['proposed', 'defined', 'in_progress', 'done']).default('proposed')
});

export const Domain = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  purpose: z.string().min(10),           // What it owns / is responsible for
  goal: z.string().min(10),              // Long-term outcome / success state
  features: z.array(Feature).default([]),
  relationships: z.array(DomainRelationship).default([]),
  ownerPersona: z.string(),              // e.g. "Domain Architect", "CEO", custom
  status: DomainStatus.default('Defined_Initial'),
  parentDomainId: z.string().uuid().optional(), // for subdomains
  subdomains: z.array(z.string().uuid()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  // Live AGUI state (for the clickable outline)
  outlineNodes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['purpose', 'goal', 'feature', 'relationship', 'subdomain']),
    children: z.array(z.string()).optional()
  })).optional(),
  // Handoff metadata
  lastHandoffId: z.string().uuid().optional(),
  // BA Agent fields
  documentState: z.enum(['Dirty', 'Clean']).default('Dirty'),
  lastReviewedAt: z.date().optional()
});

export type Domain = z.infer<typeof Domain>;
export type DomainStatus = z.infer<typeof DomainStatus>;
export type Feature = z.infer<typeof Feature>;
export type DomainRelationship = z.infer<typeof DomainRelationship>;

// Validation helper used by Domain Architect during interview
export const validateDomainDefinition = (partial: Partial<Domain>) => {
  return Domain.partial().safeParse(partial);
};
