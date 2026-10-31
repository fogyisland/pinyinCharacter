import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COOKIE,
  MIN_PAGE_BYTES,
  assertHtmlResponse,
  describeResponse,
  parseCommonArgs,
} from '../../../scripts/perf/fetch-page.mjs';

/**
 * A response as the self check sees it.
 */
function response(
  overrides: Partial<{
    status: number;
    contentType: string;
    location: string;
    bytes: number;
  }> = {},
) {
  return {
    status: overrides.status ?? 200,
    contentType: overrides.contentType ?? 'text/html; charset=utf-8',
    location: overrides.location ?? '',
    bytes: overrides.bytes ?? 45_919,
  };
}

describe('parseCommonArgs', () => {
  it('carries the setup cookie by default', () => {
    const options = parseCommonArgs([]);
    expect(options.cookie).toBe(DEFAULT_COOKIE);
    expect(options.base).toBe('https://ziyun.pudafo.com');
    expect(options.rest).toEqual([]);
  });

  it('takes the cookie and the base out of the command line', () => {
    const options = parseCommonArgs(['--base', 'https://example.test', '--cookie', 'a=1']);
    expect(options.base).toBe('https://example.test');
    expect(options.cookie).toBe('a=1');
  });

  it('accepts an empty cookie, which is how the gate is reproduced on purpose', () => {
    const options = parseCommonArgs(['--cookie', '']);
    expect(options.cookie).toBe('');
  });

  it('leaves the arguments of the probe itself alone', () => {
    const options = parseCommonArgs(['--samples', '3', '--cookie', 'a=1']);
    expect(options.rest).toEqual(['--samples', '3']);
  });

  it('drops the trailing slashes of the base', () => {
    expect(parseCommonArgs(['--base', 'https://example.test/']).base).toBe('https://example.test');
  });

  it('refuses a base that is not a URL', () => {
    expect(() => parseCommonArgs(['--base', 'not a url'])).toThrow(/is not a URL/);
  });
});

describe('assertHtmlResponse', () => {
  it('lets a real page through', () => {
    expect(() => assertHtmlResponse(response(), 'https://ziyun.pudafo.com/')).not.toThrow();
  });

  it('throws on the redirect of the initialization gate', () => {
    // Without the setup cookie the site answers with a 307 to /init and a
    // body of five bytes. A probe that measured this would report green
    // while it measured nothing.
    const gate = response({ status: 307, contentType: '', location: '/init', bytes: 5 });
    expect(() => assertHtmlResponse(gate, 'https://ziyun.pudafo.com/')).toThrow(
      /the status is 307/,
    );
    expect(() => assertHtmlResponse(gate, 'https://ziyun.pudafo.com/')).toThrow(/the body is 5 B/);
    expect(() => assertHtmlResponse(gate, 'https://ziyun.pudafo.com/')).toThrow(
      /location "\/init"/,
    );
  });

  it('names the condition that failed and the response it got', () => {
    const gate = response({ status: 307, contentType: '', location: '/init', bytes: 5 });
    let message = '';
    try {
      assertHtmlResponse(gate, 'https://ziyun.pudafo.com/');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).toContain('the status is 307, it must be 200');
    expect(message).toContain('the content type is ""');
    expect(message).toContain(`the body is 5 B, it must be more than ${MIN_PAGE_BYTES} B`);
    expect(message).toContain('status 307, content-type "", 5 B, location "/init"');
    expect(message).toContain('the GATE and not the page');
  });

  it('throws when the content type is not HTML', () => {
    expect(() =>
      assertHtmlResponse(response({ contentType: 'application/json' }), 'https://x.test/'),
    ).toThrow(/it must start with "text\/html"/);
  });

  it('throws when the body is too small to be a page', () => {
    expect(() =>
      assertHtmlResponse(response({ bytes: MIN_PAGE_BYTES }), 'https://x.test/'),
    ).toThrow(/it must be more than 10000 B/);
  });

  it('does not blame the gate when the answer is not a redirect', () => {
    const broken = response({ status: 500, contentType: '', bytes: 100 });
    expect(() => assertHtmlResponse(broken, 'https://x.test/')).not.toThrow(/the GATE/);
  });
});

describe('describeResponse', () => {
  it('lists the status, the content type, the size and the location', () => {
    expect(
      describeResponse(response({ status: 307, contentType: '', location: '/init', bytes: 5 })),
    ).toBe('status 307, content-type "", 5 B, location "/init"');
  });

  it('leaves the location out when there is none', () => {
    expect(describeResponse(response())).toBe(
      'status 200, content-type "text/html; charset=utf-8", 45919 B',
    );
  });
});
