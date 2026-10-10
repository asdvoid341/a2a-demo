export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Run cancelled', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Run cancelled', 'AbortError')); }, { once: true });
  });
}

export const uuid = () => crypto.randomUUID();

/** Rough token estimate (≈4 characters per token) for the scripted model's usage numbers. */
export const estimateTokens = (v) => Math.ceil((typeof v === 'string' ? v : JSON.stringify(v ?? '')).length / 4);
