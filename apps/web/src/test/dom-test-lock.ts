type DomTestState = typeof globalThis & {
  __closerDomTestTail?: Promise<void>;
};

const state = globalThis as DomTestState;
state.__closerDomTestTail ??= Promise.resolve();

export async function acquireDomTestLock(): Promise<() => void> {
  const previous = state.__closerDomTestTail!;
  let release!: () => void;
  state.__closerDomTestTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}
