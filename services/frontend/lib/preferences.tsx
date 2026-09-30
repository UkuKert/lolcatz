"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type Clock = "local" | "utc";

const THEME_KEY = "lolcatz:theme";
const CLOCK_KEY = "lolcatz:clock";

/**
 * Runs before first paint so a dark-mode reload never flashes white. Kept as a
 * string because it has to be inlined into <head> ahead of React hydration.
 */
export const noFlashScript = `
(function () {
  try {
    var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if (t !== "dark" && t !== "light") {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {
    if (!(e instanceof DOMException) || e.name !== "SecurityError") throw e;
    document.documentElement.dataset.theme = "light";
  }
})();
`;

interface PreferencesValue {
  theme: Theme;
  clock: Clock;
  setTheme: (theme: Theme) => void;
  setClock: (clock: Clock) => void;
  /** False until the browser has told us what the stored preferences are. */
  ready: boolean;
}

const PreferencesContext = createContext<PreferencesValue>({
  theme: "light",
  clock: "local",
  setTheme: () => {},
  setClock: () => {},
  ready: false,
});

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [clock, setClockState] = useState<Clock>("local");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The no-flash script already resolved the theme; adopt whatever it picked
    // so the toggle starts in the right position.
    const applied = document.documentElement.dataset.theme;
    if (applied === "dark" || applied === "light") setThemeState(applied);

    const storedClock = window.localStorage.getItem(CLOCK_KEY);
    if (storedClock === "utc" || storedClock === "local") setClockState(storedClock);

    setReady(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch (error) {
      if (!(error instanceof DOMException) || !["SecurityError", "QuotaExceededError"].includes(error.name)) throw error;
      /* private mode — preference just won't survive the session */
    }
  }, []);

  const setClock = useCallback((next: Clock) => {
    setClockState(next);
    try {
      window.localStorage.setItem(CLOCK_KEY, next);
    } catch (error) {
      if (!(error instanceof DOMException) || !["SecurityError", "QuotaExceededError"].includes(error.name)) throw error;
      /* ignore */
    }
  }, []);

  return (
    <PreferencesContext.Provider value={{ theme, clock, setTheme, setClock, ready }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  return useContext(PreferencesContext);
}
