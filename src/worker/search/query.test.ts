import { describe, expect, it } from 'vitest';
import { parseQuery, QUERY_MAX } from './query';

describe('parseQuery', () => {
  it.each([
    ['queues tag:cloudflare', ['queues'], { tag: ['cloudflare'] }],
    ['TOPIC:"web development" css', ['css'], { topic: ['web development'] }],
    ['tag:a tag:b', [], { tag: ['a', 'b'] }],
    ['host:example.com is:pinned is:dead', [], { host: ['example.com'], is: ['pinned', 'dead'] }],
    ['in:"Reading list" state:any', [], { in: ['Reading list'], state: ['any'] }],
    ['c++: http://x.example foo:bar', ['c++:', 'http://x.example', 'foo:bar'], {}],
    ['   ', [], {}],
    ['tag:"unclosed', ['tag:"unclosed'], {}],
    ['tag:"unclosed more', ['tag:"unclosed', 'more'], {}],
    ['"durable objects" Is:Pinned', ['"durable objects"'], { is: ['pinned'] }],
    ['tag: tag:""', ['tag:', 'tag:""'], {}],
  ])('splits %j into free words and filters', (query, words, filters) => {
    expect(parseQuery(query)).toEqual({ ok: true, words, filters });
  });

  it('refuses a query over 200 characters and accepts one of exactly 200', () => {
    expect(parseQuery('x'.repeat(QUERY_MAX + 1))).toMatchObject({
      ok: false,
      error: 'query_too_long',
    });
    expect(parseQuery('x'.repeat(QUERY_MAX))).toEqual({
      ok: true,
      words: ['x'.repeat(QUERY_MAX)],
      filters: {},
    });
  });

  it.each([
    'state:gone',
    'state:dormant',
    'state:archived',
    'is:starred',
    'state:',
    'is:',
    'state:""',
  ])('refuses the filter %j, naming it', (query) => {
    const parsed = parseQuery(`kiwi ${query}`);
    expect(parsed).toMatchObject({ ok: false, error: 'invalid_filter' });
    expect(parsed.ok ? '' : parsed.message).toContain(query);
  });

  it('accepts every state and is value, in any case', () => {
    expect(
      parseQuery('state:Pending state:active state:unreachable state:Expired state:any'),
    ).toMatchObject({
      ok: true,
      filters: { state: ['pending', 'active', 'unreachable', 'expired', 'any'] },
    });
    expect(parseQuery('IS:DEAD')).toMatchObject({ ok: true, filters: { is: ['dead'] } });
  });
});
