/**
 * Something to preview: a document by its path — a still, a take, a sound — or a picture, a video
 * or a sound by its address, with what to call it.
 */
export type PreviewTarget = string | { src: string; type: 'image' | 'video' | 'audio'; name?: string };
