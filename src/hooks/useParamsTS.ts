"use client";

import { useParams } from "next/navigation";

/** `useParams` aplati : chaque segment dynamique en `string` (jamais `string[]`). */
export function useParamsTS<T extends Record<string, string | undefined>>(): T {
  const params = useParams();
  const cleaned: Record<string, string> = {};
  for (const key in params) {
    const value = params[key];
    cleaned[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return cleaned as T;
}
