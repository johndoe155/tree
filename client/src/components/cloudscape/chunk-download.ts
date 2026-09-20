/**
 * Large-asset fetch that survives a flaky connection.
 *
 * A 50MB .glb asked for as one long response is the weakest link in this scene: a proxied dev server
 * (or an exhausted connection) can end the stream quietly, and a truncated single request has to start
 * over. Ranged slices are individually retryable, and their completion doubles as a progress signal
 * that distinguishes "still transferring" from "stuck".
 *
 * Deliberately dependency-free so it can be run and verified outside the app.
 */

const CHUNK_BYTES = 6 * 1024 * 1024;
const CHUNK_PARALLEL = 2; // HTTP/1.1 gives a page six connections; leave the rest for everything else
const CHUNK_RETRIES = 3;

export type ChunkProgress = (received: number, total: number) => void;
export type ChunkNote = (note: string) => void;

type Slice = {
  status: number;
  body: Uint8Array;
  contentRange: string | null;
  contentLength: number;
};

async function fetchSlice(
  url: string,
  start: number,
  end: number
): Promise<Slice> {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}`);
  }
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
    contentRange: response.headers.get("content-range"),
    contentLength: Number(response.headers.get("content-length") ?? 0),
  };
}

/** Total file size from a `bytes 0-6291455/49701048` header, or 0 when there is nothing to read. */
function totalFromContentRange(header: string | null) {
  if (!header) return 0;
  const slash = header.lastIndexOf("/");
  if (slash < 0) return 0;
  const total = Number(header.slice(slash + 1));
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/**
 * Resolves with the complete file, byte for byte. The first ranged request doubles as the capability
 * probe: a server that answers 200 instead of 206 ignored the Range header and has already returned
 * the whole body, so it is handed straight back.
 */
export async function downloadInChunks(
  url: string,
  onProgress: ChunkProgress,
  onNote: ChunkNote
): Promise<ArrayBuffer> {
  let received = 0;
  let first: Slice | null = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      first = await fetchSlice(url, 0, CHUNK_BYTES - 1);
      break;
    } catch (error) {
      if (attempt >= CHUNK_RETRIES) throw error;
      onNote(`slice 1 retry ${attempt}: ${message(error)}`);
      await sleep(400 * attempt);
    }
  }
  if (!first) throw new Error("no response");

  const advertised =
    first.status === 206 ? totalFromContentRange(first.contentRange) : 0;
  if (advertised === 0) {
    // No range support (or a file small enough that it did not matter): one request, whole body.
    onNote(
      `single request (status ${first.status}, ${first.body.byteLength} bytes, ranges: ${first.contentRange ? "yes" : "no"})`
    );
    received = first.body.byteLength;
    onProgress(received, received);
    if (
      first.contentLength > 0 &&
      first.body.byteLength !== first.contentLength
    ) {
      // The stream died mid-flight and nothing else will notice: say so here rather than letting a
      // half file reach the parser.
      throw new Error(
        `truncated: ${first.body.byteLength} of ${first.contentLength} bytes arrived`
      );
    }
    return first.body.buffer;
  }

  const size = advertised;
  const pieces = new Uint8Array(size);
  pieces.set(first.body, 0);
  received = first.body.byteLength;
  onProgress(received, size);

  const starts: number[] = [];
  for (let offset = CHUNK_BYTES; offset < size; offset += CHUNK_BYTES)
    starts.push(offset);
  const slices = starts.length + 1;

  let cursor = 0;
  let failure = "";

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= starts.length) return;
      const start = starts[index];
      const end = Math.min(size - 1, start + CHUNK_BYTES - 1);
      for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt += 1) {
        try {
          const slice = await fetchSlice(url, start, end);
          if (slice.status !== 206) throw new Error(`answered ${slice.status}`);
          if (slice.body.byteLength !== end - start + 1) {
            throw new Error(
              `short ${slice.body.byteLength}/${end - start + 1}`
            );
          }
          pieces.set(slice.body, start);
          received += slice.body.byteLength;
          onProgress(received, size);
          if (index % 3 === 0) onNote(`slice ${index + 2}/${slices} ok`);
          break;
        } catch (error) {
          if (attempt >= CHUNK_RETRIES) {
            failure = `slice ${index + 2}/${slices} at ${start}: ${message(error)}`;
            onNote(failure);
          } else {
            onNote(
              `slice ${index + 2}/${slices} retry ${attempt}: ${message(error)}`
            );
            await sleep(400 * attempt);
          }
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CHUNK_PARALLEL, starts.length) }, () =>
      worker()
    )
  );
  if (failure) throw new Error(failure);
  if (received !== size)
    throw new Error(`incomplete: ${received} of ${size} bytes`);
  return pieces.buffer;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
