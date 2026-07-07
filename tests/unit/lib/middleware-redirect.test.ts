import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function callMiddleware(pathname: string, opts?: { cookie?: string }) {
  const url = `http://localhost${pathname}`;
  const req = new NextRequest(url);
  if (opts?.cookie) req.cookies.set('setup_completed', opts.cookie);
  return middleware(req);
}

async function status(res: Response | any): Promise<number> {
  return res.status;
}

async function redirectedTo(res: any): Promise<string | null> {
  // NextResponse.redirect sets the Location header
  return res.headers.get('location') ?? res.headers.get('Location') ?? null;
}

describe('middleware: whitelist', () => {
  it('/init is allowed even without cookie', async () => {
    const res = callMiddleware('/init');
    expect(await status(res)).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('/init/db is allowed (wizard itself)', async () => {
    const res = callMiddleware('/init/db');
    expect(await status(res)).toBe(200);
  });

  it('/api/init/db-config is allowed', async () => {
    const res = callMiddleware('/api/init/db-config');
    expect(await status(res)).toBe(200);
  });

  it('/_next/static/foo is allowed', async () => {
    const res = callMiddleware('/_next/static/foo');
    expect(await status(res)).toBe(200);
  });

  it('/favicon.ico is allowed', async () => {
    const res = callMiddleware('/favicon.ico');
    expect(await status(res)).toBe(200);
  });
});

describe('middleware: cookie gate', () => {
  it('redirects /login to /init when cookie missing', async () => {
    const res = callMiddleware('/login');
    expect(await status(res)).toBe(307); // NextResponse.redirect default
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });

  it('redirects / to /init when cookie missing', async () => {
    const res = callMiddleware('/');
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });

  it('allows /login when setup_completed=1 cookie is set', async () => {
    const res = callMiddleware('/login', { cookie: '1' });
    expect(await status(res)).toBe(200);
  });

  it('allows / when cookie set', async () => {
    const res = callMiddleware('/', { cookie: '1' });
    expect(await status(res)).toBe(200);
  });

  it('cookie value other than "1" still redirects', async () => {
    const res = callMiddleware('/login', { cookie: '0' });
    expect(await redirectedTo(res)).toBe('http://localhost/init');
  });
});