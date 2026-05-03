'use client';

import { ReactNode, useMemo } from 'react';
import { ConvexProvider as Provider, ConvexReactClient } from 'convex/react';

// Wraps the app so any client component can call useQuery / useMutation.
// NEXT_PUBLIC_CONVEX_URL is written by `npx convex dev` on first auth and must
// also be set in Vercel project env (Production + Preview).
//
// Until the new clapcheeks Convex project is created, this falls back to
// rendering children without the provider — the messaging-engine UI just
// won't be reactive yet, but nothing else breaks.
export function ConvexProvider({ children }: { children: ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;

  const client = useMemo(() => {
    if (!url) return null;
    return new ConvexReactClient(url);
  }, [url]);

  if (!client) return <>{children}</>;
  return <Provider client={client}>{children}</Provider>;
}
