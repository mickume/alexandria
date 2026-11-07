import { describe, expect, it } from 'vitest';
import { app } from '../app';
import { api, signIn } from '../test/helpers';

describe('the OpenAPI document', () => {
  it('is served as OpenAPI 3.1 with the bearer and cookie schemes', async () => {
    const user = await signIn();
    const r = await api('GET', '/api/v1/openapi.json', { as: user.session });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(r.json.openapi).toBe('3.1.0');
    const schemes = Object.values(r.json.components.securitySchemes) as Record<string, string>[];
    expect(schemes).toContainEqual(expect.objectContaining({ type: 'http', scheme: 'bearer' }));
    expect(schemes).toContainEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'alexandria_session' }),
    );
  });

  it('documents exactly the routes the application registers', async () => {
    const user = await signIn();
    const doc = (await api('GET', '/api/v1/openapi.json', { as: user.session })).json;
    const registered = new Set(
      app.routes
        .filter((r) => r.path.startsWith('/api/v1/') && r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path.replace(/:([a-zA-Z]+)/g, '{$1}')}`),
    );
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths as Record<string, object>)) {
      for (const method of Object.keys(item)) {
        documented.add(`${method.toUpperCase()} /api/v1${path}`);
      }
    }
    expect([...registered].sort()).toEqual([...documented].sort());
  });
});
