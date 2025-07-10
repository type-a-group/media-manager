import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { GET, DELETE } from '../../src/routes/api/schema/+server';

vi.mock('node:fs');

describe('/api/schema', () => {
  const mockSchema = JSON.stringify({ schema: { foo: { type: 'string', removable: true, defaultValue: '' } } });
  const mockImageData = JSON.stringify({ images: [{ foo: 'bar' }] });

  it('GET returns schema', async () => {
    (fs.readFileSync as any).mockReturnValue(mockSchema);
    const response = await GET({} as any);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.foo).toBeDefined();
  });

  it('DELETE removes field from schema and images', async () => {
    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.includes('schema.json')) return mockSchema;
      if (path.includes('image-data.json')) return mockImageData;
      return '';
    });
    (fs.writeFileSync as any).mockImplementation(() => {});
    const request = { json: async () => ({ fieldName: 'foo' }) };
    const response = await DELETE({ request } as any);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.schema.foo).toBeUndefined();
  });

  it('DELETE throws if fieldName missing', async () => {
    const request = { json: async () => ({}) };
    await expect(DELETE({ request } as any)).rejects.toThrow();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
}); 