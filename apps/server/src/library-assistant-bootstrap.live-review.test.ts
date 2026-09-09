import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source() {
  return readFileSync(new URL('library-assistant-bootstrap.ts', import.meta.url), 'utf8');
}

test('library assistant live review revision boundary keeps assistant apply from staling the active run', () => {
  const bootstrap = source();

  assert.match(
    bootstrap,
    /options\.projection\.projectRevision = revision => projectRevision\(revision\) \+ assistantReviewRevision;/
  );
  assert.match(
    bootstrap,
    /const analysisLibrary = \{[\s\S]*revision: \(\) => projectRevision\(options\.library\.status\(\)\.revision\)/
  );
  assert.match(
    bootstrap,
    /const projectedLibrary = \{[\s\S]*revision: \(\) => options\.projection\.projectRevision\(options\.library\.status\(\)\.revision\)/
  );
  assert.match(bootstrap, /new LibraryAssistantService\(\{[\s\S]*library: analysisLibrary/);
  assert.match(bootstrap, /new LibraryAssistantReviewService\(\{[\s\S]*library: projectedLibrary/);
});
