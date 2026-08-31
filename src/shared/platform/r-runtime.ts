/** Public boundary for the optional external R runtime. */
export {
  checkRscript,
  findRscript,
  resetRscriptCache,
  resolveRunnerR,
  defaultOutputBase,
} from "@/lib/rnaseq/runner";
export type { LogLevel, RunCallbacks, RunHandle, RunResult } from "@/lib/rnaseq/runner";
