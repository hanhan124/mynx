export type ProcessStatus = "idle" | "starting" | "running" | "done" | "failed" | "cancelled";

export interface ProcessEvent {
  type: "log" | "status";
  message?: string;
  status?: ProcessStatus;
}

/** Ensures a process completion callback can only transition once. */
export function once<T extends (...args: never[]) => void>(callback: T): T {
  let called = false;
  return ((...args: never[]) => {
    if (called) return;
    called = true;
    callback(...args);
  }) as T;
}
