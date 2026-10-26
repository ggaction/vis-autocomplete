# In-place text editing and alignment

## Requested interaction

Double-clicked text is edited at its rendered position, with its actual font,
size, color, line spacing, rotation and viewport scale. A thin text-box outline
replaces the floating dialog. The original Canvas glyphs are hidden only while
the editor is open; the underlying program remains unchanged until commit.
Enter applies, Cmd/Ctrl+Enter inserts a hard break, and Escape restores the
original text. IME composition does not submit. One accepted edit is one history
transaction. Leaving the text box applies an accepted edit.

The visualization header gains left/center/right text alignment buttons. They
follow the existing selected-element/text-group scope, including Shift-selected
groups. Alignment edits use public authoring actions and survive save, reload,
Undo/Redo and exports. No release is part of this change.

## Approved native alignment completion

Approved by the user: “이 API 확장으로 진행”. Annotation editing is explicitly included.

Reuse the existing `align: 'left' | 'center' | 'right'` text-style vocabulary in
owners that currently reject it:

```js
program.editTitle({ titleStyle: { align: 'center' }, subtitleStyle: { align: 'left' } });
program.editLegend({ target: 'plot', channel: 'color', labels: { align: 'right' } });
program.editThetaAxisLabels({ align: 'right' });
program.editThetaAxisTitle({ align: 'center' });
program.editRadialAxisLabels({ align: 'left' });
program.editRadialAxisTitle({ align: 'center' });
program.editParallelAxis({ target: 'plot', field: 'Origin',
  labels: { align: 'right' }, title: { align: 'center' } });
```

- Title/subtitle style alignment acts independently within the measured title
  block. Existing top-level `editTitle({ align })` still places the whole block
  against the plot and supplies omitted component alignment defaults.
- Legend labels align inside their label column; symbols and the legend title
  retain their positions. Explicit hard breaks use that same alignment.
- Polar and parallel text align against their existing text anchor, as current
  Cartesian axis text does. Existing rotation, offsets and font styles survive.
- Cartesian axes, text marks, legend titles and facet headers already expose
  alignment. Their current contracts are reused; the facet start/center/end
  vocabulary is mapped by the header controls.
- Omission preserves existing rendered behavior. Unsupported values fail before
  changing state. The same options are valid on the corresponding create/style
  paths and are retained in immutable config, persistence and composition replay.
- Guide typography remains scoped to its native owner (for example one legend's
  labels, or one axis's labels). Editing an individual label's string remains
  independently keyed to its category/semantic identity.

## Implementation and verification

Native declarations, inspection metadata, current contracts and public docs now
describe the same alignment options used by the editor. Annotation uses its
existing `encodeText` / `editTextMark` owner; text plus alignment is committed as
one history transaction, including inside facets and adjacent charts.

Browser regression coverage runs 22 editing cases in Preview and Transition
modes across ordinary, faceted, adjacent, polar, parallel-coordinate and bar
charts. It includes rotated annotation, multiline titles with blank lines,
custom line spacing, zoom and viewport changes, outside-click apply, IME,
keyboard shortcuts, Undo/Redo and save/reload. Continuous numeric ticks and
legend values remain read-only. Native tests cover alignment geometry,
immutability, composition replay, TypeScript signatures and invalid values.

Relevant checks are `test/browser/text-editing.py`, `test/text-editing.test.js`,
`test/chart-typography.test.js`, `test/element-selection.test.js`, and the native
`test/unit/actions/guides/text-style-alignment.test.js` and
`test/contracts/polar-component-types.test.js` suites.
