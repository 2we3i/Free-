export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntil<T>(options: {
  label: string;
  intervalMs: number;
  timeoutMs: number;
  check: () => Promise<{ done: boolean; value?: T }>;
}): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    const result = await options.check();
    if (result.done && result.value !== undefined) {
      return result.value;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(`${options.label} polling timed out after ${options.timeoutMs}ms`);
}
