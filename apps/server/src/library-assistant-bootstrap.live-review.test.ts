import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source() {
  return readFileSync(new URL('library-assistant-bootstrap.ts', import.meta.url), 'utf8');
}

describe('library assistant live review revision boundary', () => {
  it('não deixa a revisão criada pelo próprio Assistente invalidar o run ativo', () => {
    const bootstrap = source();

    expect(bootstrap).toMatch(/options\.projection\.projectRevision = revision => projectRevision\(revision\) \+ assistantReviewRevision;/);
    expect(bootstrap).toMatch(/const analysisLibrary = \{[\s\S]*revision: \(\) => projectRevision\(options\.library\.status\(\)\.revision\)/);
    expect(bootstrap).toMatch(/const projectedLibrary = \{[\s\S]*revision: \(\) => options\.projection\.projectRevision\(options\.library\.status\(\)\.revision\)/);
    expect(bootstrap).toMatch(/new LibraryAssistantService\(\{[\s\S]*library: analysisLibrary/);
    expect(bootstrap).toMatch(/new LibraryAssistantReviewService\(\{[\s\S]*library: projectedLibrary/);
  });
});
