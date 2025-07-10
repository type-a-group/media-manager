import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { GET } from '../../src/routes/api/images/+server';

vi.mock('node:fs');

describe('GET /api/images', () => {
  /**
   * Tests that the endpoint returns a list of image files when the directory contains images.
   */
  it('returns a list of image files', async () => {
    (fs.readdirSync as any).mockReturnValue(['a.jpg', 'b.png', 'c.txt']);
    const response = await GET();
    const data = await response.json();
    expect(data).toEqual(['a.jpg', 'b.png']);
  });

  /**
   * Tests that the endpoint returns an error if the directory cannot be read.
   */
  it('returns error if directory cannot be read', async () => {
    (fs.readdirSync as any).mockImplementation(() => { throw new Error('fail'); });
    const response = await GET();
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 