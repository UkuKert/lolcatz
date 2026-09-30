"use client";

export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return <div className="form-error" role="alert">
    <p>{error}</p>
    <button className="btn btn-ghost" type="button" onClick={retry}>Try again</button>
  </div>;
}
