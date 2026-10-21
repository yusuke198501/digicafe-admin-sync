const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT',
  'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET', 'ERR_NETWORK',
]);

function statusOf(value) {
  return value?.response?.status ?? value?.status;
}

export function retryableNetworkFailure(error) {
  const status = statusOf(error);
  if (status) return status === 429 || status >= 500 && status <= 599;
  return TRANSIENT_CODES.has(error?.code) || TRANSIENT_CODES.has(error?.cause?.code)
    || error?.name === 'TimeoutError';
}

function safeReason(error) {
  const status = statusOf(error);
  if (Number.isInteger(status)) return `HTTP ${status}`;
  const code = [error?.code, error?.cause?.code].find((value) => TRANSIENT_CODES.has(value));
  return code || 'network failure';
}

// Labels are fixed strings: never log URLs, credentials, response bodies or configs.
export async function networkRetry(label, operation, {
  attempts = 4,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => console.warn(message),
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await operation();
      if (statusOf(result) === 429 || statusOf(result) >= 500) {
        const error = new Error('Temporary HTTP failure');
        error.status = statusOf(result);
        throw error;
      }
      return result;
    } catch (error) {
      if (!retryableNetworkFailure(error)) throw error;
      const reason = safeReason(error);
      if (attempt === attempts) throw new Error(`[${label}] failed after ${attempt} attempt(s): ${reason}`);
      const delay = attempt * 2000;
      log(`[${label}] ${reason}; retry ${attempt}/${attempts - 1} in ${delay / 1000}s`);
      await sleep(delay);
    }
  }
}
