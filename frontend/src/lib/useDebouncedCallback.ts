import { useEffect, useMemo, useRef } from "react";

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(() => {
    const debounced = (...args: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fnRef.current(...args), wait);
    };
    debounced.flush = (...args: A) => {
      clearTimeout(timer.current);
      fnRef.current(...args);
    };
    debounced.cancel = () => clearTimeout(timer.current);
    return debounced;
  }, [wait]);
}
