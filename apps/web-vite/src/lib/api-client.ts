import { z } from "zod";

export const API_BASE_PATH = "/api/v1";

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type JsonRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

function apiUrl(path: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
    throw new TypeError("API paths must be same-origin relative paths.");
  }

  const normalizedPath = path.replace(/^\/+/, "");
  const pathname = normalizedPath.split(/[/?#]/).filter(Boolean);
  if (pathname.includes("..")) {
    throw new TypeError("API paths cannot escape the versioned API base path.");
  }

  return `${API_BASE_PATH}/${normalizedPath}`;
}

function parseError(responseStatus: number, payload: unknown): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError(
      parsed.data.error.message,
      responseStatus,
      parsed.data.error.code,
      parsed.data.error.requestId,
    );
  }

  return new ApiError("The request could not be completed.", responseStatus, "HTTP_ERROR", null);
}

export async function requestJson<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
  const { body, headers: requestHeaders, ...requestOptions } = options;
  const headers = new Headers(requestHeaders);
  headers.set("accept", "application/json");

  let serializedBody: string | undefined;
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    serializedBody = JSON.stringify(body);
  }

  const response = await fetch(apiUrl(path), {
    ...requestOptions,
    body: serializedBody,
    credentials: "same-origin",
    headers,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw parseError(response.status, null);
    }
    throw new ApiError(
      "The server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
      null,
    );
  }

  if (!response.ok) {
    throw parseError(response.status, payload);
  }

  return payload as T;
}
