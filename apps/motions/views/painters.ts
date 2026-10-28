import type { CanvasClip } from './composition.js';

/**
 * Paints one moment of a canvas clip.
 *
 * @param context - The clip's canvas, sized to its box.
 * @param clip - The clip's values at the moment.
 * @param time - How far into the clip the moment is, in seconds.
 */
export type Painter = (context: CanvasRenderingContext2D, clip: CanvasClip, time: number) => void;

/** The painters a canvas clip can name, by name. */
export const PAINTERS: Record<string, Painter> = {
  /**
   * Glowing lights drifting up and swaying, each at its own pace. Reads `count`, `color` (an RGB
   * triple, e.g. `255, 196, 120`), `size` and `speed` (stage units a second).
   */
  lanterns(context, clip, time) {
    const { width, height } = context.canvas;
    const count = Number(clip.count ?? 24);
    const color = String(clip.color ?? '255, 196, 120');
    const size = Number(clip.size ?? 18);
    const speed = Number(clip.speed ?? 60);

    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index++) {
      const seed = random(index);
      const radius = size * (0.5 + seed);
      const rise = (time * speed * (0.6 + random(index + 0.5)) + seed * height) % (height + radius * 4);
      const x = random(index + 0.25) * width + Math.sin(time * (0.4 + seed) + index) * radius * 2;
      const y = height + radius * 2 - rise;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3);
      glow.addColorStop(0, `rgba(${color}, 0.9)`);
      glow.addColorStop(0.25, `rgba(${color}, 0.35)`);
      glow.addColorStop(1, `rgba(${color}, 0)`);
      context.fillStyle = glow;
      context.fillRect(x - radius * 3, y - radius * 3, radius * 6, radius * 6);
    }
    context.globalCompositeOperation = 'source-over';
  },
};

/**
 * A steady stand-in for randomness, so a light is in the same place every time its moment is painted.
 *
 * @param seed - Which light.
 * @returns A number in [0, 1).
 */
function random(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
