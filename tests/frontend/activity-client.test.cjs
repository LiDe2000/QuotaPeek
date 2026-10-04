const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const lib = require('../../src/lib/activities/catalogClient.ts');
const catalog = revision => ({ schemaVersion: 2, revision, activities: [] });
test('valid remote empty catalog wins without reading or merging the local file', async t => {
  const server = http.createServer((req, res) => res.end(JSON.stringify(catalog('remote'))));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await lib.fetchCatalog('http://127.0.0.1:' + server.address().port + '/v1/activities', async () => {
    assert.fail('A valid remote empty catalog must not read local activities');
  });
  assert.equal(result.source, 'server');
  assert.deepEqual(result.catalog.activities, []);
});
test('invalid, missing and unavailable remote catalog fall back to the local file', async t => {
  let code = 200;
  const server = http.createServer((req, res) => { res.statusCode = code; res.end('{'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  for (const status of [200, 404, 503]) {
    code = status;
    const result = await lib.fetchCatalog('http://127.0.0.1:' + server.address().port, async () => catalog('local'));
    assert.equal(result.source, 'local');
    assert.equal(result.catalog.revision, 'local');
  }
  const result = await lib.fetchCatalog('', async () => catalog('file-only'));
  assert.equal(result.catalog.revision, 'file-only');
});
test('both invalid sources produce no executable catalog; abort never reads fallback', async () => {
  const result = await lib.fetchCatalog('', async () => ({schemaVersion: 77}));
  assert.equal(result.catalog, null);
  const stop = new AbortController(); stop.abort();
  await assert.rejects(() => lib.fetchCatalog('', async () => assert.fail('aborted'), stop.signal));
});
