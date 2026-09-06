import { useState, type ChangeEvent } from 'react';
import type {
  PersonalDataImportApplySummaryV1,
  PersonalDataImportPreviewIssueReason,
  PersonalDataImportPreviewIssueV1,
  PersonalDataImportPreviewResponseV1
} from '@home-music/shared/personal-data';
import {
  AlertTriangle,
  CheckCircle2,
  FileJson2,
  LoaderCircle,
  RotateCcw,
  Upload
} from 'lucide-react';
import {
  applyPersonalDataImport,
  PersonalDataImportClientError,
  previewPersonalDataImport,
  readPersonalDataImportFile
} from '../personal-data-import-client';

const issueReasonLabel: Record<PersonalDataImportPreviewIssueReason, string> = {
  'relative-path-conflict': 'O caminho existe, mas os dados da faixa não conferem.',
  'relative-path-ambiguous': 'Mais de uma faixa corresponde ao caminho informado.',
  'hints-ambiguous': 'Os dados auxiliares correspondem a mais de uma faixa.',
  'insufficient-hints': 'Não há informações suficientes para reconciliar a faixa com segurança.',
  'no-candidate': 'Nenhuma faixa segura foi encontrada na biblioteca atual.'
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a importação.';
}

function statusLabel(issue: PersonalDataImportPreviewIssueV1) {
  if (issue.status === 'ambiguous') return 'Ambígua';
  if (issue.status === 'conflict') return 'Conflito';
  return 'Ausente';
}

function PreviewCounts({ preview }: { preview: PersonalDataImportPreviewResponseV1 }) {
  const counts = preview.references;
  return (
    <dl className="personal-import-counts" aria-label="Resumo do preview">
      <div><dt>Total</dt><dd>{counts.total}</dd></div>
      <div className="is-success"><dt>Encontradas</dt><dd>{counts.found}</dd></div>
      <div><dt>Ausentes</dt><dd>{counts.missing}</dd></div>
      <div className="is-warning"><dt>Ambíguas</dt><dd>{counts.ambiguous}</dd></div>
      <div className="is-warning"><dt>Conflitos</dt><dd>{counts.conflict}</dd></div>
    </dl>
  );
}

function ApplySummary({ summary }: { summary: PersonalDataImportApplySummaryV1 }) {
  return (
    <section className="personal-import-result" aria-labelledby="personal-import-result-title">
      <span className="personal-import-result__icon"><CheckCircle2 /></span>
      <div>
        <strong id="personal-import-result-title">Importação concluída</strong>
        <p>Os dados resolvidos com segurança foram aplicados à sua conta.</p>
      </div>
      <dl className="personal-import-counts" aria-label="Resumo da aplicação">
        <div className="is-success"><dt>Aplicados</dt><dd>{summary.applied}</dd></div>
        <div><dt>Já existentes</dt><dd>{summary.ignored}</dd></div>
        <div><dt>Ausentes</dt><dd>{summary.missing}</dd></div>
        <div className="is-warning"><dt>Ambíguos</dt><dd>{summary.ambiguous}</dd></div>
        <div className="is-warning"><dt>Conflitos</dt><dd>{summary.conflict}</dd></div>
        <div className={summary.failed > 0 ? 'is-error' : ''}><dt>Falhos</dt><dd>{summary.failed}</dd></div>
      </dl>
      {(summary.missing + summary.ambiguous + summary.conflict) > 0 && (
        <p className="personal-import-note">
          Referências ausentes, ambíguas ou conflitantes foram ignoradas; nenhuma faixa foi escolhida automaticamente.
        </p>
      )}
    </section>
  );
}

export function AccountPersonalDataImport() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [bundle, setBundle] = useState<unknown>(null);
  const [preview, setPreview] = useState<PersonalDataImportPreviewResponseV1 | null>(null);
  const [summary, setSummary] = useState<PersonalDataImportApplySummaryV1 | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFileName(null);
    setBundle(null);
    setPreview(null);
    setSummary(null);
    setConfirmed(false);
    setBusy(null);
    setError(null);
  }

  async function analyzeBundle(nextBundle: unknown) {
    setBusy('preview');
    setError(null);
    setPreview(null);
    setSummary(null);
    setConfirmed(false);
    try {
      const nextPreview = await previewPersonalDataImport(nextBundle);
      setPreview(nextPreview);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || busy) return;

    setFileName(file.name);
    setBundle(null);
    setPreview(null);
    setSummary(null);
    setConfirmed(false);
    setError(null);
    setBusy('preview');
    try {
      const nextBundle = await readPersonalDataImportFile(file);
      setBundle(nextBundle);
      const nextPreview = await previewPersonalDataImport(nextBundle);
      setPreview(nextPreview);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      input.value = '';
      setBusy(null);
    }
  }

  async function applyImport() {
    if (bundle === null || !preview || !confirmed || busy) return;
    setBusy('apply');
    setError(null);
    try {
      const result = await applyPersonalDataImport(bundle, preview.confirmationToken);
      setSummary(result.summary);
      setPreview(null);
      setConfirmed(false);
    } catch (error) {
      if (error instanceof PersonalDataImportClientError && error.code === 'preview-changed') {
        setPreview(null);
        setConfirmed(false);
        setError('A biblioteca ou o arquivo mudou desde o preview. Analise novamente antes de importar.');
      } else {
        setError(errorMessage(error));
      }
    } finally {
      setBusy(null);
    }
  }

  const unresolved = preview
    ? preview.references.missing + preview.references.ambiguous + preview.references.conflict
    : 0;

  return (
    <div className="personal-import-screen">
      <section className="personal-import-card" aria-labelledby="personal-import-file-title">
        <div className="personal-import-heading">
          <span className="my-account-card__icon"><FileJson2 /></span>
          <div>
            <strong id="personal-import-file-title">Importar dados pessoais</strong>
            <small>Use um JSON exportado pelo Home Music. Áudio e arquivos físicos nunca são importados.</small>
          </div>
        </div>

        <label className="personal-import-file">
          <span>Arquivo JSON</span>
          <input
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busy)}
            onChange={event => void selectFile(event)}
          />
        </label>
        {fileName && <p className="personal-import-file-name">Arquivo selecionado: <strong>{fileName}</strong></p>}

        {busy === 'preview' && (
          <div className="personal-import-state" role="status">
            <LoaderCircle className="my-account-spinner" />
            Analisando o arquivo contra a biblioteca atual…
          </div>
        )}
        {error && <div className="my-account-message is-error" role="alert">{error}</div>}

        {bundle !== null && !preview && !summary && busy !== 'preview' && (
          <button className="secondary-action personal-import-retry" type="button" onClick={() => void analyzeBundle(bundle)}>
            <RotateCcw /> Analisar novamente
          </button>
        )}
      </section>

      {preview && (
        <section className="personal-import-card personal-import-preview" aria-labelledby="personal-import-preview-title">
          <div className="personal-import-heading">
            <span className="my-account-card__icon"><Upload /></span>
            <div>
              <strong id="personal-import-preview-title">Preview da importação</strong>
              <small>Nenhuma alteração foi aplicada ainda.</small>
            </div>
          </div>

          <PreviewCounts preview={preview} />

          {unresolved > 0 ? (
            <div className="personal-import-warning" role="status">
              <AlertTriangle />
              <span>{unresolved} referência{unresolved === 1 ? '' : 's'} não será{unresolved === 1 ? '' : 'ão'} aplicada{unresolved === 1 ? '' : 's'} automaticamente.</span>
            </div>
          ) : (
            <div className="personal-import-success" role="status">
              <CheckCircle2 /> Todas as referências de faixa foram resolvidas com segurança.
            </div>
          )}

          {preview.issues.length > 0 && (
            <div className="personal-import-issues" aria-label="Referências não resolvidas">
              {preview.issues.map((issue, index) => (
                <article key={`${issue.field}-${index}`} className={`personal-import-issue is-${issue.status}`}>
                  <div>
                    <strong>{statusLabel(issue)}</strong>
                    <code>{issue.relativePath}</code>
                  </div>
                  <small>{issueReasonLabel[issue.reason]}</small>
                </article>
              ))}
              {preview.issuesTruncated && (
                <p className="personal-import-note">A lista foi resumida; as contagens acima incluem todas as referências.</p>
              )}
            </div>
          )}

          <label className="personal-import-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy === 'apply'}
              onChange={event => setConfirmed(event.target.checked)}
            />
            <span>Revisei o preview e quero aplicar somente os dados que o Home Music resolveu com segurança.</span>
          </label>

          <button
            className="primary-action personal-import-apply"
            type="button"
            disabled={!confirmed || busy === 'apply'}
            onClick={() => void applyImport()}
          >
            {busy === 'apply' && <LoaderCircle className="my-account-spinner" />}
            {busy === 'apply' ? 'Importando…' : 'Confirmar e importar'}
          </button>
        </section>
      )}

      {summary && (
        <>
          <ApplySummary summary={summary} />
          <button className="secondary-action personal-import-reset" type="button" onClick={reset}>
            Importar outro arquivo
          </button>
        </>
      )}
    </div>
  );
}
