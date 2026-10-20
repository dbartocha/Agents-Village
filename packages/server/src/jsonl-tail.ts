import { open } from 'node:fs/promises';

/** Incremental complete-line reader; incomplete UTF-8/JSON lines wait for the next read. */
export class JsonlTail {
  private offset = 0;
  private rest: Buffer = Buffer.alloc(0);

  async read(path: string, line: (text: string) => void): Promise<void> {
    const previousOffset = this.offset, previousRest = this.rest;
    const fh = await open(path, 'r');
    try {
      const { size } = await fh.stat();
      if (size < this.offset) { this.offset = 0; this.rest = Buffer.alloc(0); }
      while (this.offset < size) {
        const buf = Buffer.alloc(Math.min(4 * 1024 * 1024, size - this.offset));
        const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        let data = this.rest.length ? Buffer.concat([this.rest, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
        let nl = data.indexOf(10);
        while (nl >= 0) {
          line(data.subarray(0, nl).toString('utf8'));
          data = data.subarray(nl + 1);
          nl = data.indexOf(10);
        }
        this.rest = Buffer.from(data);
      }
    } catch (err) {
      this.offset = previousOffset;
      this.rest = previousRest;
      throw err;
    } finally { await fh.close(); }
  }
}
