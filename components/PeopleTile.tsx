import { $static, Snippet, setup, template } from '@airlib/react';
import { Button, Popover, Tooltip } from '@airlib/react-aui';
import type { PersonaDocument } from '@/lib/documents/types.js';

type PeopleTileProps = {
  /** Who's cast. */
  persona: PersonaDocument;
  /**
   * The picture one of their pictures shows.
   *
   * @param source - The picture, as the persona writes it.
   * @returns Its address, if it leads to one.
   */
  pictureOf: (source: string) => string | undefined;
  /** Which of their pictures the generation takes along, as the persona writes them. */
  picked: () => string[];
  /** Says what's taken along now. */
  onpick: (pictures: string[]) => void;
};

/** A run of a person's pictures, under its name. */
type PictureGroup = { label: string; sources: string[] };

/**
 * Someone cast in a generation, as a square tile of their portrait. Hovered or focused, their name
 * shows below it; clicked, every picture of theirs — face, expressions, figure, poses, wardrobe — opens
 * above it, to pick which ones the generation takes along.
 */
export const PeopleTile = setup<PeopleTileProps>((props) => {
  // The tile is made for one person; their pictures are read as it's made.
  const groups = $static(() => groupsOf(props.persona));
  const name = $static(() => props.persona.name || 'Unnamed');
  // Theirs may still be on its way, so it's read as it's drawn.
  const portrait = () => (props.persona.head?.main ? props.pictureOf(props.persona.head.main) : undefined);

  /**
   * Takes a picture along, or leaves it out.
   *
   * @param source - The picture, as the persona writes it.
   */
  const toggle = (source: string) => {
    const picked = props.picked();
    props.onpick(picked.includes(source) ? picked.filter((each) => each !== source) : [...picked, source]);
  };

  return () => (
    <Button variant="text" aria-label={name} className="wedyan-people-tile">
      <Snippet data={portrait}>
        {(src) => (src ? <img src={src} alt="" /> : <span aria-hidden="true">{initialsOf(name)}</span>)}
      </Snippet>
      <Tooltip yDir="below" xDir="between">
        {name}
      </Tooltip>
      {groups.length > 0 && (
        <Popover mode={['click']} yDir="above" xDir="between" popupRole="dialog">
          <div className="wedyan-people-pictures" aria-label={`Pictures of ${name} it takes`}>
            {groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label} className="wedyan-people-pictures-group">
                <span className="wedyan-people-pictures-label" aria-hidden="true">
                  {group.label}
                </span>
                <div className="wedyan-people-pictures-row">
                  {group.sources.map((source) => (
                    <button
                      key={source}
                      type="button"
                      className="wedyan-people-picture"
                      aria-label={pictureName(source)}
                      title={pictureName(source)}
                      aria-pressed={props.picked().includes(source)}
                      onClick={() => toggle(source)}
                    >
                      <Picture src={props.pictureOf(source)} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </Button>
  );
}, 'PeopleTile');

/** One of their pictures, or a blank square while its path leads to none. */
const Picture = template<{ src?: string }>(({ src }) => (src ? <img src={src} alt="" /> : <span aria-hidden="true" />), 'Picture');

/**
 * A person's pictures by what they are, leaving out what they have none of.
 *
 * @param persona - The person.
 * @returns Their face, expressions, figure, poses and wardrobe, each as a group.
 */
function groupsOf(persona: PersonaDocument): PictureGroup[] {
  const groups: PictureGroup[] = [
    { label: 'Face', sources: persona.head?.main ? [persona.head.main] : [] },
    { label: 'Expressions', sources: persona.head?.poses ?? [] },
    { label: 'Figure', sources: persona.body?.main ? [persona.body.main] : [] },
    { label: 'Poses', sources: persona.body?.poses ?? [] },
    { label: 'Wardrobe', sources: persona.wardrobe ? [persona.wardrobe.main, ...(persona.wardrobe.outfits ?? [])].filter(Boolean) : [] },
  ];
  return groups.filter((group) => group.sources.length);
}

/**
 * What one of a person's pictures is called: its still's name.
 *
 * @param source - The picture, as the persona writes it: a path to its `.still`.
 * @returns E.g. `Oilskin coat` for `Ayla/Oilskin coat.still`.
 */
function pictureName(source: string): string {
  return source.slice(source.lastIndexOf('/') + 1).replace(/\.still$/, '');
}

/**
 * A name's initials, for a person with no portrait yet.
 *
 * @param name - Their name.
 * @returns Up to two letters, e.g. `AY` for Ayla, `TR` for The River.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}
