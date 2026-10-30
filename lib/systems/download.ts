/**
 * Saves a file to the person's downloads under a name.
 *
 * @param file - The file.
 * @param name - What to call it, e.g. "Mixed layers.mp4".
 */
export function download(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves an image shown in Wedyan to the person's downloads, named after what it is, its extension
 * from its type. An image whose host won't hand it over opens in a tab of its own instead, to save
 * from there.
 *
 * @param src - The image's address.
 * @param name - What it is, e.g. "Ayla at the jetty".
 */
export async function downloadImage(src: string, name: string): Promise<void> {
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`${response.status}`);
    const file = await response.blob();
    download(file, `${name}.${extensionOf(file.type)}`);
  } catch {
    window.open(src, '_blank', 'noopener');
  }
}

/**
 * The file extension an image type is saved with.
 *
 * @param type - The image's type, e.g. `image/jpeg`.
 * @returns E.g. `jpg`, `png`, `svg`; `png` when the type says nothing.
 */
function extensionOf(type: string): string {
  const subtype = type.split('/')[1]?.split('+')[0] ?? '';
  return subtype === 'jpeg' ? 'jpg' : subtype || 'png';
}
