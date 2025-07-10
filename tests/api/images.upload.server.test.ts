import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { POST } from '../../src/routes/api/images/upload/+server';

vi.mock('node:fs');
vi.mock('node:path');

describe('POST /api/images/upload', () => {
  const mockFile = (type = 'image/jpeg', name = 'test.jpg', size = 100) => ({
    type,
    name,
    size,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  });

  // Minimal stub for SvelteKit RequestEvent
  const baseEvent = {
    cookies: {
      get: vi.fn(),
      getAll: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn()
    },
    fetch: vi.fn(),
    getClientAddress: vi.fn(),
    locals: {},
    params: {},
    platform: {},
    request: undefined as any,
    route: { id: '/api/images/upload' as '/api/images/upload' },
    setHeaders: vi.fn(),
    url: new URL('http://localhost'),
    isDataRequest: false,
    isSubRequest: false
  };

  it('uploads a valid image file', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.writeFileSync as any).mockImplementation(() => {});
    const request = {
      formData: async () => new Map([['image', mockFile()]]),
    } as any;
    const event = { ...baseEvent, request };
    const response = await POST(event);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.filename).toBe('test.jpg');
  });

  it('rejects missing file', async () => {
    const request = {
      formData: async () => new Map(),
    } as any;
    const event = { ...baseEvent, request };
    await expect(POST(event)).rejects.toThrow();
  });

  it('rejects invalid file type', async () => {
    const request = {
      formData: async () => new Map([['image', mockFile('text/plain', 'bad.txt')]]),
    } as any;
    const event = { ...baseEvent, request };
    await expect(POST(event)).rejects.toThrow();
  });

  it('handles fs errors gracefully', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    (fs.mkdirSync as any).mockImplementation(() => { throw new Error('fail'); });
    const request = {
      formData: async () => new Map([['image', mockFile()]]),
    } as any;
    const event = { ...baseEvent, request };
    await expect(POST(event)).rejects.toThrow();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 