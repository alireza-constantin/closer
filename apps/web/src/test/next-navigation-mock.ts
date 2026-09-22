type Router = {
  back: () => void;
  forward: () => void;
  prefetch: () => Promise<void>;
  push: (href: string) => void;
  refresh: () => void;
  replace: (href: string) => void;
};

type NavigationMock = {
  notFound: () => never;
  redirect: (destination: string) => never;
  unstable_rethrow: (error: unknown) => void;
  useParams: () => Record<string, string | string[]>;
  usePathname: () => string;
  useRouter: () => Partial<Router>;
  useSearchParams: () => URLSearchParams;
};

export function createNextNavigationMock(overrides: Partial<NavigationMock> = {}): NavigationMock {
  return {
    notFound: () => {
      throw new Error("NOT_FOUND");
    },
    redirect: (destination) => {
      throw new Error(`REDIRECT:${destination}`);
    },
    unstable_rethrow: () => {},
    useParams: () => ({}),
    usePathname: () => "/",
    useRouter: () => ({
      back: () => {},
      forward: () => {},
      prefetch: async () => {},
      push: () => {},
      refresh: () => {},
      replace: () => {},
    }),
    useSearchParams: () => new URLSearchParams(),
    ...overrides,
  };
}
