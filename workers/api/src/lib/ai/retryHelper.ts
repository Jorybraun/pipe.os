export interface RetryOptions {
  baseDelayMs?: number;
  maxRetries?: number;
  onRetry?: (attempt: number, error: unknown) => void;
  onCircuitOpen?: (error: unknown) => void;
}

export function classifyError(error: unknown): 'transient' | 'fatal' {
  if (error == null) return 'transient';
  const e = error as { status?: number; statusCode?: number | string; code?: number | string };
  if (e.status === 400 || e.status === 404 || e.statusCode === 404 || e.statusCode === '403' || e.code === '403') {
    return 'fatal';
  }
  return 'transient';
}

export async function retryWithBackoff<T>(
  fn: () => T | Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { baseDelayMs = 1000, maxRetries = 3, onRetry, onCircuitOpen } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (classifyError(error) === 'fatal') {
        onCircuitOpen?.(error);
        throw error;
      }
      if (attempt >= maxRetries) {
        onCircuitOpen?.(error);
        throw error;
      }
      const delay = Math.floor(baseDelayMs * 2 ** attempt * (0.5 + Math.random() * 0.5));
      onRetry?.(attempt + 1, error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Retry loop exhausted');
}
