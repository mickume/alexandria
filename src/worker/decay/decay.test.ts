import { describe, expect, it } from 'vitest';
import { api, signIn, type TestUser } from '../test/helpers';

const DEFAULTS = { dormant_days: 60, archive_days: 120, remove_days: 180 };

function thresholds(user: TestUser) {
  return api('GET', '/api/v1/settings/decay', { as: user.session });
}

function save(user: TestUser, body: unknown) {
  return api('PUT', '/api/v1/settings/decay', { as: user.session, body });
}

describe('the decay thresholds', () => {
  it('are 60, 120 and 180 days for a user who never changed them', async () => {
    const r = await thresholds(await signIn());
    expect(r.status).toBe(200);
    expect(r.json).toEqual(DEFAULTS);
  });

  it('are stored per user', async () => {
    const user = await signIn();
    const other = await signIn('other@example.test', 'Other');
    const r = await save(user, { dormant_days: 7, archive_days: 14, remove_days: 7 });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ dormant_days: 7, archive_days: 14, remove_days: 7 });
    expect((await thresholds(user)).json).toEqual({
      dormant_days: 7,
      archive_days: 14,
      remove_days: 7,
    });
    expect((await thresholds(other)).json).toEqual(DEFAULTS);
    expect(
      (await save(user, { dormant_days: 7, archive_days: 3650, remove_days: 3650 })).status,
    ).toBe(200);
  });

  it.each([
    {
      body: { dormant_days: 60, archive_days: 120 },
      error: 'invalid_threshold',
      field: 'remove_days',
    },
    {
      body: { dormant_days: 6, archive_days: 120, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'dormant_days',
    },
    {
      body: { dormant_days: 60, archive_days: 3651, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'archive_days',
    },
    {
      body: { dormant_days: 60, archive_days: 120, remove_days: 7.5 },
      error: 'invalid_threshold',
      field: 'remove_days',
    },
    {
      body: { dormant_days: '60', archive_days: 120, remove_days: 180 },
      error: 'invalid_threshold',
      field: 'dormant_days',
    },
    {
      body: { dormant_days: 120, archive_days: 120, remove_days: 180 },
      error: 'invalid_thresholds',
      field: 'dormant_days',
    },
  ])('refuses $body', async ({ body, error, field }) => {
    const user = await signIn();
    await save(user, { dormant_days: 30, archive_days: 90, remove_days: 30 });
    const r = await save(user, body);
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error, field, message: expect.any(String) });
    if (error === 'invalid_thresholds') {
      expect(r.json.message).toBe('the dormant threshold must be below the archive threshold');
    }
    expect((await thresholds(user)).json).toEqual({
      dormant_days: 30,
      archive_days: 90,
      remove_days: 30,
    });
  });
});
