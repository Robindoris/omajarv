// Reads are explicit, asynchronous, byte-limited, and outside the shell GUI.
export async function readClipboard(exec, { primary = false, imageOnly = false, textOnly = false } = {}) {
  const selection = primary ? ['--primary'] : [];
  if (!textOnly) {
    const listing = await exec('wl-paste', [...selection, '--list-types'], {timeout:5000, maxBuffer:16384});
    const types = listing.stdout.split('\n');
    const type = ['image/png', 'image/jpeg', 'image/webp'].find(t => types.includes(t));
    if (type) {
      const {stdout} = await exec('wl-paste', [...selection, '--no-newline', '--type', type], {encoding:'buffer', timeout:10000, maxBuffer:10*1024*1024});
      return { bytes: stdout, name: 'clipboard.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[type] };
    }
  }
  if (imageOnly) throw new Error('No supported image in clipboard.');
  const {stdout} = await exec('wl-paste', [...selection, '--no-newline', '--type', 'text'], {timeout:5000, maxBuffer:64*1024});
  return {text:stdout};
}
