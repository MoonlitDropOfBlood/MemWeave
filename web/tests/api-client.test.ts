import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';

describe('ApiError', () => {
  it('captures status, body, and a derived message', () => {
    const e = new ApiError(404, { error: 'not found' }, 'GET /memories/x → 404');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
    expect(e.status).toBe(404);
    expect(e.body).toEqual({ error: 'not found' });
    expect(e.message).toContain('404');
  });
});
