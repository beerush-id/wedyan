/**
 * Something to preview: a document by its path — a still, a take, a sound — or a picture, a video
 * or a sound by its address, with what to call it.
 */
export type PreviewTarget = string | { src: string; type: 'image' | 'video' | 'audio'; name?: string };

/** What Wedyan's own apps offer every app, each filled in by the app that does it as it loads. */
export type SystemServices = {
  /**
   * Opens a preview window for something, or brings forward the one already showing it.
   *
   * @param target - A document's path, or a picture, a video or a sound by its address.
   */
  preview(target: PreviewTarget): void;
};

/**
 * The desktop's services for every app: `system.preview(target)` and the like. Until the app that
 * does a service has loaded, calling it does nothing.
 */
export const system: SystemServices = {
  preview: () => undefined,
};

/**
 * Fills in services an app does, for every app to call through `system`.
 *
 * @param services - The services, by name.
 */
export function provide(services: Partial<SystemServices>): void {
  Object.assign(system, services);
}
