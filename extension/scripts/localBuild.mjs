// A local build (`npm run build`, loaded unpacked) shows that it is one: it has the red icons of
// local-icons/ (copied to dist-app/local/), Chrome's extensions page lists it as "… (local build)" and
// its toolbar button's tooltip says the same, so it can't be mistaken for the store version installed
// beside it. A release build (`npm run package`) keeps the manifest as it is, and the store package
// refuses a manifest marked local (scripts/package.mjs).

export const LOCAL_MARK = ' (local build)';

/** Where a local build has its icons, in dist-app; build.mjs copies local-icons/ there. */
export const LOCAL_ICONS_DIR = 'local';

/** Chrome refuses an extension whose name is longer. */
const NAME_LIMIT = 75;

/** [icons] (size → file), each file taken from the local build's icons instead. */
function localIcons(icons) {
  return Object.fromEntries(Object.entries(icons).map(([size, file]) => [size, `${LOCAL_ICONS_DIR}/${file}`]));
}

/** The manifest as built into dist-app: [manifest] for a release, else marked local. */
export function builtManifest(manifest, release) {
  if (release) return manifest;
  const name = manifest.name + LOCAL_MARK;
  if (name.length > NAME_LIMIT) throw new Error(`The local build's name is longer than Chrome allows (${NAME_LIMIT}): ${name}`);
  return {
    ...manifest,
    name,
    icons: localIcons(manifest.icons),
    action: { ...manifest.action, default_title: manifest.action.default_title + LOCAL_MARK, default_icon: localIcons(manifest.action.default_icon) },
  };
}

/** Whether [manifest] is a local build's. */
export function isLocal(manifest) {
  return manifest.name.endsWith(LOCAL_MARK);
}
