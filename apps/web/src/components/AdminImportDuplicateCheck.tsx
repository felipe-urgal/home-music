import { useEffect, useState } from 'react';
import type { ImportJob } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  CopyCheck,
  LoaderCircle,
  RefreshCw,
  ShieldAlert
} from 'lucide-react';
import {
  detectAdminImportDuplicates,
  getAdminImportDuplicateCheck,
  reviewAdminImportDuplicates,
  type AdminImportDuplicateCheck,
  type AdminImportDuplicateReason
} from '../admin-import-client';

const REASON_LABELS: Record<AdminImportDuplicateReason, string> = {
  hash: 'Hash idêntico',
  title: 'Mesmo título',
  artist: 'Mesmo artista',
  album: 'Mesmo álbum',
  duration: 'Duração próxima',
  filename: 'Nome do arquivo'
};

function resultLabel(check: AdminImportDuplicateCheck) {
  if (!check.hashCompared && check.confidence === 'none') return 'Verificação parcial';
  if (check.disposition === 'blocked') return 'Duplicata exata';
  if (check.disposition === 'review') return check.reviewedAt ? 'Provável · revisada' : 'Duplicata provável';
  if (check.disposition === 'notice') return 'Possível duplicata';
  return 'Sem duplicata';
}

function resultDescription(check: AdminImportDuplicateCheck) {
  if (!check.hashCompared && check.confidence === 'none') {
    return 'Nenhuma semelhança heurística forte foi encontrada, mas ao menos um hash comparável não pôde ser confirmado.';
  }
  if (check.disposition === 'blocked') {
    return 'O mesmo conteúdo já existe na biblioteca. Esta importação fica bloqueada por padrão.';
  }
  if (check.disposition === 'review') {
    return check.reviewedAt
      ? 'A semelhança foi revisada manualmente e pode seguir para a próxima etapa.'
      : 'Metadata e duração indicam uma duplicata provável. Revise antes de continuar.';
  }
  if (check.disposition === 'notice') {
    return 'Há semelhanças, mas não suficientes para bloquear ou exigir revisão.';
  }
  return 'Nenhuma correspondência relevante foi encontrada na biblioteca atual.';
}

export function AdminImportDuplicateCheckPanel({ job }: { job: ImportJob }) {
  const [check, setCheck] = useState<AdminImportDuplicateCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getAdminImportDuplicateCheck(job.id)
      .then(result => { if (active) setCheck(result); })
      .catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : 'Não foi possível consultar duplicatas.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [job.id, job.metadataPreview?.generatedAt]);

  const detect = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      setCheck(await detectAdminImportDuplicates(job.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível verificar duplicatas.');
    } finally {
      setWorking(false);
    }
  };

  const review = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      setCheck(await reviewAdminImportDuplicates(job.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar a revisão.');
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-import-duplicates is-loading" role="status">
        <LoaderCircle className="is-spinning" /> Consultando verificação de duplicatas…
      </div>
    );
  }

  if (!check) {
    return (
      <div className="admin-import-duplicates is-pending">
        <div>
          <CopyCheck />
          <span>
            <strong>Verificação de duplicatas</strong>
            <small>Compare hash, duração, nome e metadata com a biblioteca atual.</small>
          </span>
        </div>
        <button type="button" disabled={working} onClick={() => void detect()}>
          {working ? <LoaderCircle className="is-spinning" /> : <CopyCheck />}
          {working ? 'Verificando…' : 'Verificar duplicatas'}
        </button>
        {error && <small className="admin-import-duplicates__error" role="alert">{error}</small>}
      </div>
    );
  }

  const ResultIcon = check.disposition === 'blocked'
    ? ShieldAlert
    : check.disposition === 'review' || check.disposition === 'notice'
      ? AlertTriangle
      : CheckCircle2;

  return (
    <div className={`admin-import-duplicates is-${check.disposition}`}>
      <div className="admin-import-duplicates__summary">
        <ResultIcon />
        <span>
          <strong>{resultLabel(check)}</strong>
          <small>{resultDescription(check)}</small>
          {!check.hashCompared && check.confidence !== 'none' && (
            <small>Nem todos os hashes comparáveis puderam ser lidos; as heurísticas continuam visíveis.</small>
          )}
        </span>
        <button type="button" aria-label="Verificar duplicatas novamente" disabled={working} onClick={() => void detect()}>
          {working ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
        </button>
      </div>

      {check.matches.length > 0 && (
        <div className="admin-import-duplicates__matches">
          {check.matches.slice(0, 5).map(match => (
            <article key={match.trackId}>
              <div>
                <strong>{match.title}</strong>
                <small>{match.artist} · {match.album || 'Álbum não informado'} · {match.format}</small>
              </div>
              <div className="admin-import-duplicates__reasons">
                {match.reasons.map(reason => <span key={reason}>{REASON_LABELS[reason]}</span>)}
              </div>
            </article>
          ))}
          {check.matches.length > 5 && <small>+ {check.matches.length - 5} correspondências adicionais</small>}
        </div>
      )}

      {check.disposition === 'review' && !check.reviewedAt && (
        <div className="admin-import-duplicates__review">
          <span>Confirme apenas depois de comparar as faixas acima.</span>
          <button type="button" disabled={working} onClick={() => void review()}>
            {working ? <LoaderCircle className="is-spinning" /> : <CheckCircle2 />}
            {working ? 'Registrando…' : 'Revisado, pode continuar'}
          </button>
        </div>
      )}

      {error && <small className="admin-import-duplicates__error" role="alert">{error}</small>}
    </div>
  );
}
