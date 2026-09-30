"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage, isRequestError, requestJSON } from "./api";

export function useResource<T>(url: string | null, token?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string; data?: T; loading: boolean; error: string;
  }>({ key: "", loading: true, error: "" });
  const key = JSON.stringify([url, token]);
  const reload = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState(previous => ({ key, data: previous.key === key ? previous.data : undefined, loading: true, error: "" }));
    requestJSON<T>(url, {
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(data => {
      if (!controller.signal.aborted) setState({ key, data, loading: false, error: "" });
    }).catch(error => {
      if (!isRequestError(error)) throw error;
      if (!controller.signal.aborted) setState({ key, loading: false, error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [url, token, key, revision]);

  return {
    data: url && state.key === key ? state.data : undefined,
    loading: Boolean(url) && (state.key !== key || state.loading),
    error: url && state.key === key ? state.error : "",
    reload,
  };
}
