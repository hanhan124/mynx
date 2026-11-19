import { Channel } from "@tauri-apps/api/core";
import { call } from "../../app/tauri.js";
import type { ConvertEvent } from "../../lib/contracts/generated/image/ConvertEvent.js";
import type { ConvertOptions } from "../../lib/contracts/generated/image/ConvertOptions.js";
import type { Thumbnail } from "../../lib/contracts/generated/image/Thumbnail.js";

/**
 * Image → PNG batch conversion commands. Rust side: `commands/image.rs`;
 * the pipeline lives in the `mynx-image` crate. All failures reject with a
 * `CommandError` via the shared invoke helper.
 */

/** Expands files/folders into the backend's flat list of supported images. */
export function collectImageFiles(paths: string[]): Promise<string[]> {
  return call("image_collect_files", { paths });
}

/**
 * Starts a background conversion job and resolves to the job id once the
 * pipeline is registered. `onEvent` is attached to the channel synchronously
 * (before the invoke), so no early event can be missed.
 */
export async function startImageConvert(
  options: ConvertOptions,
  onEvent: (event: ConvertEvent) => void,
): Promise<number> {
  const channel = new Channel<ConvertEvent>();
  channel.onmessage = onEvent;
  return call<number>("image_convert_start", { options, onProgress: channel });
}

/** Requests cancellation of a running conversion (job id, not pipeline id). */
export function cancelImageConvert(taskId: number): Promise<boolean> {
  return call("image_convert_cancel", { taskId });
}

/** Renders a small base64 PNG thumbnail for the file list. */
export function fetchImageThumbnail(path: string, maxSize = 96): Promise<Thumbnail> {
  return call("image_thumbnail", { path, maxSize });
}
