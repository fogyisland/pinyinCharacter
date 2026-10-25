import { describe, expect, it } from 'vitest';
import { extractBearer, isAuthorized } from '@/mcp/auth';

/**
 * The authorization of the MCP server.
 *
 * A client is a program, not a browser, so it carries a Bearer token rather
 * than a cookie session.
 */

describe('the bearer token', () => {
  it('is pulled out of the Authorization header', () => {
    expect(extractBearer('Bearer secret')).toBe('secret');
  });

  it('does not care about the case of the scheme', () => {
    expect(extractBearer('bearer secret')).toBe('secret');
    expect(extractBearer('BEARER secret')).toBe('secret');
  });

  it('ignores the spaces around it', () => {
    expect(extractBearer('  Bearer   secret  ')).toBe('secret');
  });

  it('is null when the header is missing', () => {
    expect(extractBearer(undefined)).toBeNull();
  });

  it('is null when the scheme is another one', () => {
    expect(extractBearer('Basic secret')).toBeNull();
    expect(extractBearer('secret')).toBeNull();
  });

  it('is null when the token is missing or empty', () => {
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer   ')).toBeNull();
  });

  it('is null when the header carries more than a scheme and a token', () => {
    expect(extractBearer('Bearer secret extra')).toBeNull();
  });
});

describe('the authorization check', () => {
  it('passes the right token', () => {
    expect(isAuthorized('Bearer secret', 'secret')).toBe(true);
  });

  it('refuses the wrong token', () => {
    expect(isAuthorized('Bearer wrong', 'secret')).toBe(false);
  });

  it('refuses a token that shares a prefix with the right one', () => {
    expect(isAuthorized('Bearer sec', 'secret')).toBe(false);
    expect(isAuthorized('Bearer secret-longer', 'secret')).toBe(false);
  });

  it('refuses a missing header', () => {
    expect(isAuthorized(undefined, 'secret')).toBe(false);
  });

  it('refuses another scheme', () => {
    expect(isAuthorized('Basic secret', 'secret')).toBe(false);
  });

  it('lets every request through in anonymous mode', () => {
    expect(isAuthorized(undefined, null)).toBe(true);
    expect(isAuthorized('Bearer anything', null)).toBe(true);
  });
});
