import { $static, mutable, Snippet, setup, template } from '@airlib/react';
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
};

/** A run of a person's pictures, under its name. */
type PictureGroup = { label: string; sources: string[] };

/** How many picked pictures the tile stacks before it counts the rest. */
const STACKED = 3;

/**
 * Someone cast in a generation, as a square tile of their portrait, with the pictures it takes of
 * them stacked small at its corner. Hovered or focused, their name shows
 * below it; clicked, every picture of theirs — face, expressions, figure, poses, wardrobe — opens
 * above it, to pick which ones the generation takes along.
 */
export const PeopleTile = setup<PeopleTileProps>((props) => {
  // The tile is made for one person; their pictures are read as it's made.
  const groups = $static(() => groupsOf(props.persona));
  const name = $static(() => props.persona.name || 'Unnamed');
  const portrait = $static(() => (props.persona.head?.main ? props.pictureOf(props.persona.head.main) : undefined));
  // Until the drive keeps the choice on the cast, their face goes along.
  const choice = mutable({ picked: $static(() => (props.persona.head?.main ? [props.persona.head.main] : [])) as string[] });

  /**
   * Takes a picture along, or leaves it out.
   *
   * @param source - The picture, as the persona writes it.
   */
  const toggle = (source: string) => {
    const at = choice.picked.indexOf(source);
    if (at < 0) choice.picked.push(source);
    else choice.picked.splice(at, 1);
  };

  return () => (
    <Button variant="text" aria-label={name} className="wedyan-people-tile">
      {portrait ? <img src={portrait} alt="" /> : <span aria-hidden="true">{initialsOf(name)}</span>}
      {/* What it takes of them, at a glance: the first three picked, then how many more. */}
      <Snippet>
        {() =>
          choice.picked.length > 0 && (
            <span className="wedyan-people-tile-stack" aria-hidden="true">
              {choice.picked.slice(0, STACKED).map((source) => (
                <span key={source}>
                  <Picture src={props.pictureOf(source)} />
                </span>
              ))}
              {choice.picked.length > STACKED && <span>{`+${choice.picked.length - STACKED}`}</span>}
            </span>
          )
        }
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
                  {group.sources.map((source, index) => (
                    <button
                      key={source}
                      type="button"
                      className="wedyan-people-picture"
                      aria-label={pictureName(source, group.label, index)}
                      title={pictureName(source, group.label, index)}
                      aria-pressed={choice.picked.includes(source)}
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
    { label: 'Wardrobe', sources: persona.wardrobe ?? [] },
  ];
  return groups.filter((group) => group.sources.length);
}

/**
 * What one of a person's pictures is called: a still by its name, an outside image by its kind and place.
 *
 * @param source - The picture, as the persona writes it.
 * @param kind - The group it's in, e.g. `Wardrobe`.
 * @param index - Its place in the group, from 0.
 * @returns E.g. `Oilskin coat`, or `Wardrobe 2`.
 */
function pictureName(source: string, kind: string, index: number): string {
  return source.endsWith('.still') ? source.slice(source.lastIndexOf('/') + 1, -'.still'.length) : `${kind} ${index + 1}`;
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
