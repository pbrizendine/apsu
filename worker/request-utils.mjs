// Shared bounded JSON reader for untrusted request and provider response bodies.
export async function jsonWithin(response, max) {
  const reader = response.body?.getReader();

  if (!reader) throw Error('empty');

  let size = 0;
  const chunks = [];

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw Error('large');
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let i = 0;

  for (const c of chunks) {
    bytes.set(c, i);
    i += c.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(bytes));
}

export const isText = (value, max) => typeof value === 'string' && value.length <= max;
