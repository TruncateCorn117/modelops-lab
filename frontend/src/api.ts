import { useCallback, useEffect, useRef, useState } from "react";

const TOKEN_KEY = "modelops_api_token";
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}
export function saveToken(value: string) {
  if (value.trim()) sessionStorage.setItem(TOKEN_KEY, value.trim());
  else sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("modelops:refresh"));
}
export function refreshData() {
  window.dispatchEvent(new Event("modelops:refresh"));
}
export class ApiError extends Error {
  code: string;
  requestId?: string;
  constructor(message: string, code = "network_error", requestId?: string) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}
async function fetchResponse(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError("无法连接服务，请检查后端是否启动及网络连接。");
  }
  if (!response.ok) {
    let body: {
      error?: { message?: string; code?: string; request_id?: string };
    } = {};
    try {
      body = await response.json();
    } catch {
      /* Non-JSON reverse proxy failures. */
    }
    throw new ApiError(
      body.error?.message ||
        (response.status === 401
          ? "访问需要有效的 API 密钥，请在右上角连接设置中配置。"
          : `请求失败（HTTP ${response.status}）`),
      body.error?.code || `http_${response.status}`,
      body.error?.request_id,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchResponse(path, options);
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function post<T>(path: string, body?: unknown) {
  return api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
export async function download(path: string, filename: string) {
  const response = await fetchResponse(path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function useApi<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  const loaded = useRef(false);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener("modelops:refresh", reload);
    return () => window.removeEventListener("modelops:refresh", reload);
  }, [reload]);
  useEffect(() => {
    setData(null);
    setError(null);
    loaded.current = false;
    setLoading(Boolean(path));
  }, [path]);
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      if (!loaded.current) setLoading(true);
      try {
        const result = await api<T>(path!, { signal: controller.signal });
        if (!disposed) {
          setData(result);
          setError(null);
          loaded.current = true;
        }
      } catch (reason) {
        if (!disposed)
          setError(
            reason instanceof Error ? reason : new Error(String(reason)),
          );
      } finally {
        if (!disposed) {
          setLoading(false);
          if (pollMs) timer = setTimeout(load, pollMs);
        }
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [path, revision, pollMs]);
  return { data, error, loading, reload };
}
