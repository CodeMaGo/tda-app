'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface ReferenceData {
  people: { id: string; name: string; email: string; jobTitle: string | null; status: string }[];
  teams: { id: string; name: string; description: string | null }[];
  projects: { id: string; name: string; code: string; status: string }[];
  technologies: {
    id: string;
    name: string;
    version: string | null;
    category: string;
    status: string;
  }[];
  types: { id: string; name: string; description: string | null; position: number }[];
  criteria: { id: string; name: string; weight: number; description: string | null }[];
  riskCategories: { id: string; name: string }[];
  authorities: {
    id: string;
    userId: string;
    name: string;
    scope: string;
    title: string | null;
    maxSignificance: string;
    domains: string[] | null;
  }[];
}

/**
 * One call feeds every picker on every form. Reference data changes rarely, so
 * it is cached for the session rather than refetched per screen.
 */
export function useReferenceData() {
  return useQuery({
    queryKey: ['reference-data'],
    queryFn: () => api.get<ReferenceData>('/reference-data'),
    staleTime: 5 * 60_000,
  });
}

export const toOptions = <T extends { id: string; name: string }>(
  items: T[] | undefined,
  hint?: (item: T) => string | undefined,
) => (items ?? []).map((item) => ({ value: item.id, label: item.name, hint: hint?.(item) }));
