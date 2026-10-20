// Native ggaction palette names, shared by color/stroke encoders and scale editors.
const categorical = ['tableau10', 'category10', 'set2', 'dark2', 'paired',
  'accent', 'category20', 'category20b', 'category20c', 'observable10', 'pastel1', 'pastel2', 'set1', 'set3', 'tableau20'];
const continuous = ['blues', 'viridis', 'magma', 'redblue', 'cividis',
  'tealblues', 'teals', 'greens', 'browns', 'oranges', 'reds', 'purples', 'warmgreys', 'greys',
  'inferno', 'plasma', 'turbo', 'bluegreen', 'bluepurple', 'goldgreen', 'goldorange', 'goldred',
  'greenblue', 'orangered', 'purplebluegreen', 'purpleblue', 'purplered', 'redpurple',
  'yellowgreenblue', 'yellowgreen', 'yelloworangebrown', 'yelloworangered', 'darkblue',
  'darkgold', 'darkgreen', 'darkmulti', 'darkred', 'lightgreyred', 'lightgreyteal', 'lightmulti',
  'lightorange', 'lighttealblue', 'blueorange', 'brownbluegreen', 'purplegreen', 'pinkyellowgreen',
  'purpleorange', 'redgrey', 'redyellowblue', 'redyellowgreen', 'spectral', 'rainbow', 'sinebow'];

export function paletteChoices(fieldType, { auto = false } = {}) {
  const names = ['nominal', 'ordinal'].includes(fieldType) ? categorical : continuous;
  return [...names.map((value, index) => ({ value, label: value, featured: index < 5 })),
    ...(auto ? [{ value: 'auto', label: 'Auto', featured: false }] : [])];
}
