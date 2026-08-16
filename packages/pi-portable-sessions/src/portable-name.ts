import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Options controlling portable-name generation. Derived from the extension
 * config (see {@link PortableSessionsConfig}).
 */
export interface PortableNameOptions {
  /** Label replacing the home directory prefix. Default: "HOME". */
  homeLabel: string;
  /** Label replacing the root directory prefix. Default: "ROOT". */
  rootLabel: string;
  /** Map of additional absolute path prefixes to portable labels. */
  extraPrefixes: Record<string, string>;
}

/**
 * Normalize a path for prefix matching: resolve to an absolute path and unify
 * separators to `/` so matching is platform-independent (Windows `\` and `/`
 * both become `/`).
 */
export function toPosixAbsolute(path: string): string {
  return resolve(path).replaceAll("\\", "/");
}

/**
 * Match `path` against `prefix` at a path-segment boundary. Returns the
 * remainder (starting with `/`, or `""` for an exact match), or `null` when
 * the prefix does not match at a boundary.
 */
function matchAtBoundary(path: string, prefix: string): string | null {
  if (path === prefix) {
    return "";
  }
  if (path.startsWith(prefix) && path[prefix.length] === "/") {
    return path.slice(prefix.length);
  }
  return null;
}

/**
 * Compute the portable session directory name for a working directory.
 *
 * Rules, in priority order:
 * 1. The longest configured `extraPrefixes` entry whose prefix matches at a
 *    path-segment boundary.
 * 2. The home directory prefix.
 * 3. The root prefix (any remaining absolute path).
 *
 * The label replaces the matched prefix, and the remainder of the path is
 * percent-encoded (URL encoding), so the result is reversible and free of
 * filesystem-hostile characters. Examples (home `/Users/zpan`):
 *
 * - `/Users/zpan/my-project`      -> `HOME%2Fmy-project`
 * - `/Users/zpan`                 -> `HOME`
 * - `/var/www`                    -> `ROOT%2Fvar%2Fwww`
 * - `/Volumes/Backup/data` (with `{"/Volumes/Backup": "BACKUP"}`) -> `BACKUP%2Fdata`
 */
export function portableSessionDirName(
  cwd: string,
  options: PortableNameOptions,
): string {
  const path = toPosixAbsolute(cwd);
  const home = toPosixAbsolute(homedir());

  const extraPrefixes = Object.entries(options.extraPrefixes)
    .map(([prefix, label]) => ({
      prefix: toPosixAbsolute(prefix),
      label,
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { prefix, label } of extraPrefixes) {
    const remainder = matchAtBoundary(path, prefix);
    if (remainder !== null) {
      return label + encodeURIComponent(remainder);
    }
  }

  const homeRemainder = matchAtBoundary(path, home);
  if (homeRemainder !== null) {
    return options.homeLabel + encodeURIComponent(homeRemainder);
  }

  // Any remaining absolute path falls under the root prefix; the whole
  // posix-normalized path (starting with "/") becomes the encoded remainder.
  return options.rootLabel + encodeURIComponent(path);
}

/** Result of decoding a portable session directory name. */
export interface DecodedPortableName {
  /** The label that matched (homeLabel, rootLabel, or an extra prefix label). */
  label: string;
  /** The percent-decoded remainder of the path (starts with `/`). */
  remainder: string;
}

/**
 * Decode a portable session directory name back into its label and decoded
 * remainder. Returns `null` when the name carries no known label or its
 * remainder is not valid percent-encoding.
 */
export function decodePortableSessionDirName(
  name: string,
  options: PortableNameOptions,
): DecodedPortableName | null {
  const labels = new Set([
    options.homeLabel,
    options.rootLabel,
    ...Object.values(options.extraPrefixes),
  ]);
  const label = [...labels]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => name.startsWith(candidate));
  if (label === undefined) {
    return null;
  }
  try {
    const remainder = decodeURIComponent(name.slice(label.length));
    return { label, remainder };
  } catch {
    // Malformed percent-encoding.
    return null;
  }
}

/**
 * Reconstruct the absolute path a portable session directory name stands for.
 * Returns `null` when the name cannot be decoded.
 */
export function portableSessionDirNameToAbsolute(
  name: string,
  options: PortableNameOptions,
): string | null {
  const decoded = decodePortableSessionDirName(name, options);
  if (decoded === null) {
    return null;
  }
  const home = toPosixAbsolute(homedir());
  // The root prefix is empty: the decoded remainder is already the full path
  // starting with "/", so no prefix text is prepended on reconstruction.
  const rootPrefix = "";
  const extra = new Map(
    Object.entries(options.extraPrefixes).map(([prefix, label]) => [
      label,
      toPosixAbsolute(prefix),
    ]),
  );
  let prefix: string | null = null;
  const extraPrefix = extra.get(decoded.label);
  if (extraPrefix !== undefined) {
    prefix = extraPrefix;
  } else if (decoded.label === options.homeLabel) {
    prefix = home;
  } else if (decoded.label === options.rootLabel) {
    prefix = rootPrefix;
  }
  if (prefix === null) {
    return null;
  }
  return prefix + decoded.remainder;
}
