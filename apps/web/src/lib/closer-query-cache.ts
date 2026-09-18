import type { QueryClient } from "@tanstack/react-query";

/** Remove participant-relative server state whenever browser auth identity changes. */
export function clearCloserQueryCache(queryClient: QueryClient) {
  queryClient.clear();
}
