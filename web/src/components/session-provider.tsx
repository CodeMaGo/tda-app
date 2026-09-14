'use client';

import type { Permission, SessionContext } from '@tda/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { api, ApiError, setSelectedOrganisation } from '@/lib/api';
import { supabase } from '@/lib/supabase';

interface SessionValue {
  session: SessionContext | null;
  loading: boolean;
  error: string | null;
  can: (permission: Permission) => boolean;
  signOut: () => Promise<void>;
  switchOrganisation: (organisationId: string) => void;
  refresh: () => Promise<void>;
}

const Context = React.createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [authReady, setAuthReady] = React.useState(false);
  const [signedIn, setSignedIn] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(Boolean(data.session));
      setAuthReady(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setSignedIn(Boolean(session));
      if (event === 'SIGNED_OUT') {
        setSelectedOrganisation(null);
        queryClient.clear();
      }
      if (event === 'SIGNED_IN') {
        // A different person may be signing in on this browser; anything held
        // from the previous session is no longer theirs to see.
        queryClient.clear();
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionContext>('/session'),
    enabled: authReady && signedIn,
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status >= 500 ? failureCount < 2 : false,
    staleTime: 60_000,
  });

  const session = query.data ?? null;

  // Keep the stored organisation in step with what the API actually returned.
  React.useEffect(() => {
    if (session?.organisation) setSelectedOrganisation(session.organisation.id);
  }, [session?.organisation]);

  const value = React.useMemo<SessionValue>(() => {
    const granted = new Set(session?.permissions ?? []);
    return {
      session,
      loading: !authReady || (signedIn && query.isLoading),
      error: query.error instanceof Error ? query.error.message : null,
      can: (permission) => granted.has(permission),
      signOut: async () => {
        await supabase.auth.signOut();
        setSelectedOrganisation(null);
        queryClient.clear();
        router.push('/sign-in');
      },
      switchOrganisation: (organisationId) => {
        setSelectedOrganisation(organisationId);
        queryClient.clear();
        router.push('/');
      },
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['session'] });
      },
    };
  }, [session, authReady, signedIn, query.isLoading, query.error, queryClient, router]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionValue {
  const value = React.useContext(Context);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

/** Redirects to sign-in when there is no session. */
export function useRequireSession(): SessionValue {
  const value = useSession();
  const router = useRouter();

  React.useEffect(() => {
    if (!value.loading && !value.session) router.replace('/sign-in');
  }, [value.loading, value.session, router]);

  return value;
}
