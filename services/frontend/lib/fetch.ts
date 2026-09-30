/** Fetch failures are classified only at the transport boundary. */
export class NetworkError extends Error {
  constructor() { super("The service is unavailable. Please try again."); }
}

export async function fetchResponse(input: RequestInfo | URL, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (error) {
    // Browsers expose network failures as TypeError; Node supplies a transport cause.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    const network = error instanceof TypeError && (
      ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"].includes(error.message) ||
      (error.message === "fetch failed" && typeof cause?.code === "string" &&
        /^(UND_ERR_|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)/.test(cause.code))
    );
    if (network || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))) {
      throw new NetworkError();
    }
    throw error;
  }
}
