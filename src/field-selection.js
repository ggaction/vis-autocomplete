// A field set describes interest, not an encoding. Legacy role selections are
// still accepted for saved projects and the adjacent-chart editor.
export function selectionFields(selection = {}) {
  return [...new Set((Array.isArray(selection.fields) ? selection.fields
    : [selection.x, selection.y, selection.color]).filter(name => typeof name === 'string' && name))];
}

export function projectFields(rows, profile, names) {
  const fields = new Map(profile.fields.map(field => [field.name, field]));
  names = [...new Set(names)];
  for (const name of names) if (!fields.get(name)?.usable) throw new Error(`Variable ${name} has no usable values.`);
  return { rows: rows.map(row => Object.fromEntries(names.map(name => [name, row[name] ?? null]))),
    profile: { ...profile, sourceFields: profile.sourceFields ?? profile.fields.map(field => field.name), fields: names.map(name => fields.get(name)) }, fields: names };
}
