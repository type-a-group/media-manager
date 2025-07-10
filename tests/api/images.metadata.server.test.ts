import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { GET, POST } from '../../src/routes/api/images/metadata/[filename]/+server';

vi.mock('node:fs');

describe('/api/images/metadata/[filename]', () => {
  const mockJson = JSON.stringify({ images: [
    { file_name: 'a.jpg', image_name: 'A', default: false },
    { file_name: 'b.png', image_name: 'B', default: true }
  ] });

  it('GET returns metadata for existing file', async () => {
    (fs.readFileSync as any).mockReturnValue(mockJson);
    const params = { filename: 'a.jpg' };
    const response = await GET({ params } as any);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.file_name).toBe('a.jpg');
  });

  it('GET returns default if not found', async () => {
    (fs.readFileSync as any).mockReturnValue(mockJson);
    const params = { filename: 'notfound.jpg' };
    const response = await GET({ params } as any);
    const data = await response.json();
    expect(data.file_name).toBe('notfound.jpg');
    expect(data.default).toBe(false);
  });

  it('GET throws 400 if filename missing', () => {
    expect(() => GET({ params: {} } as any)).toThrow();
  });

  it('POST updates metadata for existing file', async () => {
    (fs.readFileSync as any).mockReturnValue(mockJson);
    (fs.writeFileSync as any).mockImplementation(() => {});
    const params = { filename: 'a.jpg' };
    const request = { json: async () => ({ image_name: 'A2' }) };
    const response = await POST({ params, request } as any);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.metadata.image_name).toBe('A2');
  });

  it('POST adds metadata for new file', async () => {
    (fs.readFileSync as any).mockReturnValue(mockJson);
    (fs.writeFileSync as any).mockImplementation(() => {});
    const params = { filename: 'c.gif' };
    const request = { json: async () => ({ image_name: 'C' }) };
    const response = await POST({ params, request } as any);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.metadata.image_name).toBe('C');
  });

  it('POST throws 400 if filename missing', async () => {
    await expect(POST({ params: {}, request: { json: async () => ({}) } } as any)).rejects.toThrow();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 