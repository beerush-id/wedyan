/// <reference types="@airlib/vite/ambient" />

interface AirRouteMeta {
  name?: string;
  label?: string;
}

/** The home seed, as `vite.seed.ts` gives it: text bundled, pictures and media among the client build's files. */
declare module 'virtual:home-seed' {
  /** Each text seed's content, by its path in the home without `~/`. */
  export const TEXT: Record<string, string>;
  /** Each picture or media seed's type, by its path in the home without `~/`. */
  export const MEDIA: Record<string, string>;
  /** Where the pictures and media are served from, among the client build's files. */
  export const MEDIA_URL: string;
  /** Reads a picture or media seed from its folder; only in development, where the server runs beside it. */
  export const readMedia: ((path: string) => Promise<Uint8Array>) | undefined;
}
