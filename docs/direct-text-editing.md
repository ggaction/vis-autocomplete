# Canvas text editing

## Interaction

- Double-click an individual visible text element to edit its complete string.
- Enter applies; Cmd+Enter (Ctrl+Enter on non-Mac keyboards) inserts a newline; Escape cancels.
- IME composition Enter only completes composition. Text is always literal, never HTML.
- One accepted edit creates one history entry and uses public ggaction calls; Undo/Redo, saved projects, and exports retain it.
- Picking is based on the rendered text bounds, including rotation and composition offsets. Text hit regions are resolved on demand, rather than adding one DOM element per label.

## Existing public owners

Use `editTitle` for title/subtitle, axis title editors for axis titles, `editLegendTitle` for legend titles, Cartesian axis `labels.labelMap` for tick text, `editLegendBlock.labelMap` for categorical/continuous-size entries, `editFacetHeaders.labelMap` for facet headings, and `encodeText({target,value})` for annotations. Keep typed data values and existing mappings; change only the selected display entry. Shared/faceted guides edit their authored owner, and adjacent charts retain their childPath scope.

## Proposed public extensions — ready for review

These are the remaining native gaps; they are not implemented by this proposal.

1. Extend `editThetaAxisLabels` and `editRadialAxisLabels` `labelMap` to numeric tick values, and add `labels.labelMap` / `ticksAndLabels.labels.labelMap` to `editParallelAxis`. Reuse `{value,label}[] | 'auto'` semantics, typed categorical values, finite numeric/Unix-ms tick values, and fallback formatting for unmapped values. Empty labels suppress text only. Tick positions, marks, scales and data remain unchanged.
2. Extend `editLegendBlock({target,channel,labelMap})` from categorical/continuous-size blocks to the other legend families. Sampled/gradient entries use their finite numeric sample values; discrete interval entries use a stable serialized interval-boundary key supplied by the label resolver. Mapping changes display text only. Preserve unaffected entries and whole-block styles.
3. Add `editTextMark({target,textOverrides})`, where `textOverrides` is an array of `{match:{fields?:Record<string,scalar>,channels?:Record<string,scalar>},occurrence:number,text:string}` or `'auto'`. A scalar is string, boolean, null, or finite number. `match` must contain at least one nonempty dictionary; both dictionaries are conjunctive. `occurrence` is a required nonnegative index among matching semantic items, not an index into rendered graphics. Row-backed text matches its row fields/encoded channels; attached labels match their source item fields/channels. The app supplies the complete available identity for the selected item. Unmatched overrides are retained but do not alter another label. Arrays replace this policy; omission preserves it; `'auto'` clears it. Conflicting duplicate selectors are rejected. Missing/filtered items never cause an override to be reassigned by graphic index.

Example target calls (extensions above require approval before implementation):

```js
program.editRadialAxisLabels({labelMap:[{value:10,label:'Ten\nunits'}]});
program.editParallelAxis({target:'plot',field:'Horsepower',labels:{labelMap:[{value:100,label:'100\nhp'}]}});
program.editLegendBlock({target:'plot',channel:'opacity',labelMap:[{value:50,label:'Middle\nvalue'}]});
program.editTextMark({target:'labels',textOverrides:[{
  match:{fields:{Region:'North',Sales:12},channels:{x:'North',y:12}},occurrence:0,text:'North\nsales'
}]});
```

All edited text must preserve explicit hard breaks, including blank lines, through the native text-layout pipeline in Canvas, SVG and PDF. Existing multiline title, legend and Cartesian-label behavior provides the visual primitive; this is not a new chart geometry or renderer.

## Compatibility and validation

Existing calls and schemas retain their behavior when new options are omitted. New policies belong to their existing guide/mark materialization config, not application-only state or raw graphic edits. Public declarations, inspection metadata, current contracts, generated references and documentation must accompany any native change.

Verification covers literal/duplicate labels, numeric and categorical values, multiline and blank lines, repeated edits, filter/scale/resize replay, unit/facet/adjacent/overlay scopes, all legend families, independent annotation/mark labels, IME, Undo/Redo, save/reload, exports, and dense text scenes. The current supported baseline uses native legend-content, size-label-map, title-hard-break and axis-title-hard-break tests.
