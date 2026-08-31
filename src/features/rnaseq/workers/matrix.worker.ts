import { normalizeCountMatrix, parseDelimited, detectDelimiter } from '@/lib/rnaseq/matrix';

type Request = { id: number; text: string; preset: string };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, text, preset } = event.data;
  try {
    const rows = parseDelimited(text, detectDelimiter(text));
    const result = normalizeCountMatrix(rows, preset);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
