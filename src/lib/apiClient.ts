export class ApiError extends Error {
  public status: number;
  public data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = "ApiError";
  }
}

async function fetchWithHandling<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  let data;
  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || "An error occurred", response.status, data);
  }

  return data as T;
}

export const apiClient = {
  get: <T>(url: string, options?: RequestInit) =>
    fetchWithHandling<T>(url, { ...options, method: "GET" }),

  post: <T>(url: string, body?: any, options?: RequestInit) => {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
    const headers = new Headers(options?.headers);
    
    if (!isFormData && !isBlob && body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    
    return fetchWithHandling<T>(url, {
      ...options,
      method: "POST",
      headers,
      body: (isFormData || isBlob) ? body : (body ? JSON.stringify(body) : undefined),
    });
  },

  put: <T>(url: string, body?: any, options?: RequestInit) => {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
    const headers = new Headers(options?.headers);
    
    if (!isFormData && !isBlob && body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    
    return fetchWithHandling<T>(url, {
      ...options,
      method: "PUT",
      headers,
      body: (isFormData || isBlob) ? body : (body ? JSON.stringify(body) : undefined),
    });
  },

  patch: <T>(url: string, body?: any, options?: RequestInit) => {
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
    const headers = new Headers(options?.headers);
    
    if (!isFormData && !isBlob && body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    
    return fetchWithHandling<T>(url, {
      ...options,
      method: "PATCH",
      headers,
      body: (isFormData || isBlob) ? body : (body ? JSON.stringify(body) : undefined),
    });
  },

  delete: <T>(url: string, bodyOrOptions?: any, options?: RequestInit) => {
    let finalOptions: RequestInit = {};
    if (bodyOrOptions && ("method" in bodyOrOptions || "headers" in bodyOrOptions || "body" in bodyOrOptions || "signal" in bodyOrOptions)) {
      finalOptions = bodyOrOptions;
    } else if (bodyOrOptions !== undefined) {
      const isFormData = typeof FormData !== "undefined" && bodyOrOptions instanceof FormData;
      const isBlob = typeof Blob !== "undefined" && bodyOrOptions instanceof Blob;
      const headers = new Headers(options?.headers);
      if (!isFormData && !isBlob && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      finalOptions = {
        ...options,
        headers,
        body: (isFormData || isBlob) ? bodyOrOptions : JSON.stringify(bodyOrOptions),
      };
    } else {
      finalOptions = options || {};
    }
    return fetchWithHandling<T>(url, { ...finalOptions, method: "DELETE" });
  },
};
