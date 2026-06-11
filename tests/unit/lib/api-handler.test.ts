import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withErrorHandling,
  badRequest,
  notFound,
  forbidden,
  unauthorized,
} from '@/lib/api-handler';

describe('api-handler', () => {
  describe('badRequest', () => {
    it('returns 400 with {ok:false, error:{code, message}} shape', async () => {
      const res = badRequest('bad_input', 'invalid input');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'bad_input', message: 'invalid input' } });
    });
  });

  describe('notFound', () => {
    it('returns 404 with default code/message when called with no args', async () => {
      const res = notFound();
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'not_found', message: 'not_found' } });
    });

    it('returns 404 with custom code and message', async () => {
      const res = notFound('worksheet_missing', 'worksheet not found');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'worksheet_missing', message: 'worksheet not found' } });
    });
  });

  describe('forbidden', () => {
    it('returns 403 with default code/message when called with no args', async () => {
      const res = forbidden();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'forbidden', message: 'forbidden' } });
    });

    it('returns 403 with custom code and message', async () => {
      const res = forbidden('not_admin', 'admin only');
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'not_admin', message: 'admin only' } });
    });
  });

  describe('unauthorized', () => {
    it('returns 401 with default code/message when called with no args', async () => {
      const res = unauthorized();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'unauthorized', message: 'unauthorized' } });
    });

    it('returns 401 with custom code and message', async () => {
      const res = unauthorized('unauthenticated', 'please login');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'unauthenticated', message: 'please login' } });
    });
  });

  describe('withErrorHandling', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('returns the handler result on success', async () => {
      const result = await withErrorHandling(async () => 'ok');
      expect(result).toBe('ok');
    });

    it('returns 500 {ok:false, error:{code:"server", message:"server error"}} on thrown error', async () => {
      const result = await withErrorHandling(async () => {
        throw new Error('boom');
      });
      expect(result).toBeInstanceOf(Response);
      const res = result as Response;
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ ok: false, error: { code: 'server', message: 'server error' } });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
