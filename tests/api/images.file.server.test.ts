import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GET } from '../../src/routes/api/images/[filename]/+server';

vi.mock('node:fs');
vi.mock('node:path');

describe('GET /api/images/[filename]', () => {
  const baseEvent = {
    params: { filename: 'a.jpg' },
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
    platform: {},
    request: undefined as any,
    route: { id: '/api/images/[filename]' as '/api/images/[filename]' },
    setHeaders: vi.fn(),
    url: new URL('http://localhost'),
    isDataRequest: false,
    isSubRequest: false
  };

  it('serves image file with correct content type', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(Buffer.from([1,2,3]));
    (path.extname as any).mockReturnValue('.jpg');
    const response = await GET(baseEvent as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('returns 404 if file not found', () => {
    (fs.existsSync as any).mockReturnValue(false);
    expect(() => GET(baseEvent as any)).toThrow();
  });

  it('returns 500 on fs error', () => {
    (fs.existsSync as any).mockImplementation(() => { throw new Error('fail'); });
    expect(() => GET(baseEvent as any)).toThrow();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 