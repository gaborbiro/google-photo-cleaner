// A local build (`npm run build`, loaded unpacked) shows that it is one: it has the red icons of
// local-icons/ (copied to dist-app/local/), in Chrome's extensions page, on its toolbar button and on
// its own tabs (the review tab); Chrome's extensions page lists it as "… (local build)" and its toolbar
// button's tooltip says the same, so it can't be mistaken for the store version installed beside it.
// A release build (`npm run package`) keeps the manifest and the pages as they are, and the store
// package refuses a manifest marked local (scripts/package.mjs).

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

/** A page's tab icon: the link up to its file, the file, and the rest of the link. */
const TAB_ICON = /(<link rel="icon"[^>]*\shref=")([^"]+)("[^>]*>)/g;

/** The page [html] as built into dist-app: as it is for a release, else with the local build's tab icon. */
export function builtPage(html, release) {
  if (release) return html;
  return html.replace(TAB_ICON, (_, start, file, end) => `${start}${LOCAL_ICONS_DIR}/${file}${end}`);
}

/** Whether [manifest] is a local build's. */
export function isLocal(manifest) {
  return manifest.name.endsWith(LOCAL_MARK);
}
