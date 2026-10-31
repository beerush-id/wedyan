import type { PainterClip } from './composition.js';

/**
 * Paints one moment of a painter clip.
 *
 * @param context - The clip's canvas, sized to its box.
 * @param clip - The clip's values at the moment.
 * @param time - How far into the clip the moment is, in seconds.
 */
export type Painter = (context: CanvasRenderingContext2D, clip: PainterClip, time: number) => void;

/** The painters Wedyan has, by name: each is a kind of clip a painter track takes, its `type` the name. */
export const PAINTERS: Record<string, Painter> = {
  /**
   * Particles drifting across the stage, each at its own pace and swaying as it goes: lights and
   * embers rising, snow falling, dust or bokeh hanging. Reads `count`, `color` (an RGB triple, e.g.
   * `255, 196, 120`), `size`, `speed` (stage units a second), `direction` (`up`, the default, or
   * `down`), `sway` (how far they swing, in their own sizes; 2 unless set) and `glow` (0 a plain
   * dot, 1 a soft light, the default).
   */
  particle(context, clip, time) {
    const { width, height } = context.canvas;
    const count = Number(clip.count ?? 24);
    const color = String(clip.color ?? '255, 196, 120');
    const size = Number(clip.size ?? 18);
    const speed = Number(clip.speed ?? 60);
    const falling = clip.direction === 'down';
    const sway = Number(clip.sway ?? 2);
    const glow = Math.min(Math.max(Number(clip.glow ?? 1), 0), 1);

    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = glow > 0 ? 'lighter' : 'source-over';
    for (let index = 0; index < count; index++) {
      const seed = random(index);
      const radius = size * (0.5 + seed);
      const travel = (time * speed * (0.6 + random(index + 0.5)) + seed * height) % (height + radius * 4);
      const x = random(index + 0.25) * width + Math.sin(time * (0.4 + seed) + index) * radius * sway;
      const y = falling ? travel - radius * 2 : height + radius * 2 - travel;
      // A glowing particle fades out over three of its sizes; a plain one is a solid dot.
      const reach = radius * (1 + glow * 2);
      const light = context.createRadialGradient(x, y, 0, x, y, reach);
      light.addColorStop(0, `rgba(${color}, 0.9)`);
      light.addColorStop(glow > 0 ? 0.25 : 0.9, `rgba(${color}, ${glow > 0 ? 0.35 : 0.9})`);
      light.addColorStop(1, `rgba(${color}, 0)`);
      context.fillStyle = light;
      context.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    }
    context.globalCompositeOperation = 'source-over';
  },
};

/**
 * A steady stand-in for randomness, so a particle is in the same place every time its moment is painted.
 *
 * @param seed - Which particle.
 * @returns A number in [0, 1).
 */
function random(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
