// Synthetic data only. Used by verify-portable-storage.ps1 after the test app exits.
const { DatabaseSync } = require('node:sqlite');
const assert = require('node:assert/strict');
const [mode, path] = process.argv.slice(2);
const db = new DatabaseSync(path, { readOnly: mode !== 'seed' });
assert.equal(db.prepare('PRAGMA application_id').get().application_id, 0x5150454b);
assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
const setting = key => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
if (mode === 'seed') {
  db.exec('BEGIN');
  for (const [key, value] of Object.entries({
    'quotapeek-theme': 'light',
    'quotapeek-selected-account': 'deepseek-smoke-test',
    'quotapeek-provider-selection-v1': '{"deepseek":"deepseek-smoke-test"}',
  })) db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  db.prepare('INSERT INTO accounts(id,namespace,provider_id,public_auth,position) VALUES (?,?,?,?,?)')
    .run('deepseek-smoke-test', 'deepseek-api', 'deepseek', '{"apiKey":"","label":"Synthetic test"}', 0);
  // Invalid DPAPI data forces local reconnect failure before any network query.
  db.prepare('INSERT INTO credentials(account_id,protection,payload) VALUES (?,?,?)')
    .run('deepseek-smoke-test', 'windows-dpapi-user-v1', Buffer.from([0]));
  db.prepare('INSERT INTO quota_cache(account_id,fetched_at,payload) VALUES (?,?,?)')
    .run('deepseek-smoke-test', 42, JSON.stringify({ id: 'deepseek-smoke-test', providerId: 'deepseek', source: 'deepseek-api', label: 'Synthetic test', fetchedAt: 42, isAvailable: true, balances: [] }));
  // Observe actual writes through the app's IPC after restart, not just seeded rows.
  db.exec(`CREATE TABLE smoke_events(kind TEXT, key TEXT, value TEXT);
    CREATE TRIGGER smoke_settings AFTER UPDATE ON settings BEGIN
      INSERT INTO smoke_events VALUES ('setting', NEW.key, NEW.value);
    END;
    CREATE TRIGGER smoke_cache AFTER UPDATE ON quota_cache BEGIN
      INSERT INTO smoke_events VALUES ('cache', NEW.account_id, CAST(NEW.fetched_at AS TEXT));
    END;`);
  db.exec('COMMIT');
} else if (mode === 'restored') {
  assert.equal(setting('quotapeek-theme'), 'light');
  assert.equal(setting('quotapeek-selected-account'), 'deepseek-smoke-test');
  assert.deepEqual(JSON.parse(setting('quotapeek-provider-selection-v1')), { deepseek: 'deepseek-smoke-test' });
  assert.equal(db.prepare('SELECT fetched_at FROM quota_cache WHERE account_id=?').get('deepseek-smoke-test').fetched_at, 42);
  const observed = (kind, key, value) => db.prepare('SELECT count(*) AS count FROM smoke_events WHERE kind=? AND key=? AND value=?').get(kind, key, value).count > 0;
  assert.ok(observed('setting', 'quotapeek-theme', 'light'));
  assert.ok(observed('setting', 'quotapeek-selected-account', 'deepseek-smoke-test'));
  assert.ok(observed('cache', 'deepseek-smoke-test', '42'));
} else {
  // These rows are written by React through IPC, not by startup SQL.
  assert.equal(setting('quotapeek-theme'), 'dark');
  assert.equal(setting('quotapeek-provider-selection-v1'), '{}');
}
db.close();
console.log(`Portable state ${mode}: passed`);
