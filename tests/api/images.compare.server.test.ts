import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { GET } from '../../src/routes/api/images/compare/+server';

vi.mock('node:fs');

describe('GET /api/images/compare', () => {
  const mockJson = JSON.stringify({ images: [
    { file_name: 'a.jpg' },
    { file_name: 'b.png' },
    { file_name: 'c.gif' }
  ] });
  const mockFsImages = ['a.jpg', 'b.png', 'd.svg'];

  it('returns inBoth, inAssetsOnly, inJsonOnly', async () => {
    (fs.readdirSync as any).mockReturnValue(mockFsImages);
    (fs.readFileSync as any).mockReturnValue(mockJson);
    const url = { searchParams: new URLSearchParams() } as any;
    const response = await GET({ url });
    const data = await response.json();
    expect(data.inBoth).toEqual(['a.jpg', 'b.png']);
    expect(data.inAssetsOnly).toEqual(['d.svg']);
    expect(data.inJsonOnly).toEqual(['c.gif']);
  });

  it('returns error on fs/read error', async () => {
    (fs.readdirSync as any).mockImplementation(() => { throw new Error('fail'); });
    const url = { searchParams: new URLSearchParams() } as any;
    const response = await GET({ url });
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 