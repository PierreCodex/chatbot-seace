import { NotFoundException, StreamableFile } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FilesController } from '../../../src/modules/files/files.controller';
import type { FilesPort } from '../../../src/ports/files.port';

function makeController(getPdf: FilesPort['getPdf']): FilesController {
  const files = { getPdf } as unknown as FilesPort;
  return new FilesController(files);
}

describe('FilesController', () => {
  it('sirve el binario como StreamableFile cuando el token existe', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const getPdf = vi.fn().mockResolvedValue(pdf);
    const res = await makeController(getPdf).getPdf('tok');

    expect(getPdf).toHaveBeenCalledWith('tok');
    expect(res).toBeInstanceOf(StreamableFile);
    expect(res.getStream().read()).toEqual(pdf);
  });

  it('tira 404 cuando el token no existe o expiró', async () => {
    const getPdf = vi.fn().mockResolvedValue(null);
    await expect(makeController(getPdf).getPdf('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
