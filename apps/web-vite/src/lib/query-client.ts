import { QueryClient } from "@tanstack/react-query";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
        retry: 2,
      },
    },
  });
}

export const queryClient = createQueryClient();
