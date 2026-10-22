import { CHANNELS, canonicalChannel, encodingChannel } from './semantics.js';

// Channel authoring and its scale editor operate on one established encoding.
// Derive editor channels from the shared vocabulary, rather than maintaining a
// second whitelist that only covers the initial X/Y/Color controls.
export function scaleEditorChannel(method) {
  const name = /^edit(.+)Scale$/.exec(method)?.[1];
  const channel = name && canonicalChannel(name[0].toLowerCase() + name.slice(1));
  return CHANNELS.includes(channel) ? channel : undefined;
}

function authoredChannels(method, args) {
  if (method === 'encodeChannels') return Object.keys(args.channels ?? {}).map(canonicalChannel).filter(c => CHANNELS.includes(c));
  if (method === 'encodeXRange') return ['x', 'x2'];
  if (method === 'encodeYRange') return ['y', 'y2'];
  if (method === 'encodeHistogram') return ['x', 'y'];
  const channel = encodingChannel(method);
  return CHANNELS.includes(channel) ? [channel] : [];
}

function bindings(layer, channel) {
  const binding = layer?.encoding?.[channel === 'r' ? 'radius' : channel];
  return channel === 'parallel' ? (binding?.dimensions ?? []).map(d => d.scale).filter(Boolean)
    : [binding?.scale].filter(Boolean);
}

export function createEncodingUsage(program, layer) {
  const channels = new Map(), scales = new Map();
  if (layer) {
    // Plot functions establish their mappings, including polar/parallel scales.
    // Their implicit defaults precede subsequent explicit user actions.
    for (const key of Object.keys(layer.encoding ?? {})) channels.set(canonicalChannel(key), -1);
    for (const [index, node] of program.trace.children.entries()) {
      const { method, options: args = {} } = node.op === 'editFacetSource'
        ? node.args.action ?? {} : { method: node.op, options: node.args };
      if (!method) continue;
      if (args.target === layer.id || args.target === undefined && program.semanticSpec.layers.length === 1) {
        for (const channel of authoredChannels(method, args)) channels.set(channel, index);
        if (method === 'removeEncoding') channels.delete(canonicalChannel(args.channel));
      }
      // Scale calls may address a mark, a shared scale ID, or the sole scale of
      // a channel. Match actual consumers so another mark's edit cannot leak.
      const editedChannel = scaleEditorChannel(method);
      if (!editedChannel && method !== 'editScale') continue;
      const owner = args.target && program.semanticSpec.layers.find(l => l.id === args.target);
      for (const channel of CHANNELS) {
        if (editedChannel && channel !== editedChannel) continue;
        const ids = bindings(layer, channel);
        const affected = args.id ? ids.includes(args.id)
          : args.target ? bindings(owner, channel).some(id => ids.includes(id))
          : editedChannel === channel && ids.length > 0;
        if (affected) scales.set(channel, index);
      }
    }
  }
  return {
    channels: [...channels.keys()].sort(),
    order(candidate) {
      const channel = scaleEditorChannel(candidate.method);
      if (channel) {
        // A fixed value has no active scale. Candidate generation owns whether
        // an editor is applicable; only live bindings establish its usage.
        if (!bindings(layer, channel).length) return undefined;
        return Math.max(channels.get(channel) ?? -1, scales.get(channel) ?? -1);
      }
      return candidate.category === 'encoding' ? channels.get(encodingChannel(candidate.method)) : undefined;
    },
  };
}
