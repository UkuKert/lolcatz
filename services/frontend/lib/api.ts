import { fetchResponse, NetworkError } from "./fetch";

export function isRequestError(error: unknown): error is APIError | NetworkError {
  return error instanceof APIError || error instanceof NetworkError;
}

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  if (!isRequestError(error)) throw error;
  return error.message;
}

export async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "Your session has expired. Sign in again to continue.",
      403: "You do not have permission to do this.",
      404: "The requested content could not be found.",
    };
    const detail = response.headers.get("content-type")?.startsWith("text/plain")
      ? (await response.text()).trim() : "";
    throw new APIError(response.status, messages[response.status] ||
      (response.status < 500 && detail ? detail : "The service is unavailable. Please try again."));
  }
  return response;
}

export async function requestJSON<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init)).json();
}
