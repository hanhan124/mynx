/** Public platform file boundary. Feature code should depend on this module,
 * not on the RNA-seq implementation that originally owned these helpers. */
export {
  base64ToBytes,
  bytesToBase64,
  fmtDateTime,
  isWindows,
  joinPath,
  openInShell,
  pathBase,
  pathDir,
  pathExists,
  psQuote,
  readBytesAny,
  readDirAny,
  readTextAny,
  statAny,
  shQuote,
} from "@/lib/rnaseq/io";

export type { FileMeta } from "@/lib/rnaseq/io";
