import { useEffect, useState } from 'react';
import { ChevronLeft, RefreshCw } from 'lucide-react';
import type { ListeningStatisticsResponse, StatisticsPeriod, Track } from '@home-music/shared';
import { apiFetch } from '../api-client';
import { formatListeningMinutes, formatPlayCount, STATISTICS_PERIODS } from '../statistics-utils';

type StatisticsScreenProps = {
  onBack: () => void;
  onPlayTrack: (track: Track) => void;
};

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="statistics-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RankingRow({
  position,
  title,
  subtitle,
  plays
}: {
  position: number;
  title: string;
  subtitle?: string;
  plays: number;
}) {
  return (
    <>
      <span className="statistics-row__position">{position}</span>
      <span className="statistics-row__copy">
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <span className="statistics-row__plays">{formatPlayCount(plays)}</span>
    </>
  );
}

export function StatisticsScreen({ onBack, onPlayTrack }: StatisticsScreenProps) {
  const [period, setPeriod] = useState<StatisticsPeriod>('30d');
  const [data, setData] = useState<ListeningStatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    apiFetch(`/api/statistics?period=${period}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || `Falha HTTP ${response.status}`);
        }
        return response.json() as Promise<ListeningStatisticsResponse>;
      })
      .then(setData)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setError(error instanceof Error ? error.message : 'Não foi possível carregar as estatísticas.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period, requestVersion]);

  return (
    <div className="statistics-screen">
      <header className="statistics-header">
        <button className="icon-button" aria-label="Voltar à biblioteca" onClick={onBack}><ChevronLeft /></button>
        <div className="statistics-header__title">
          <strong>Estatísticas</strong>
          <small>Seu histórico de reprodução</small>
        </div>
        <button
          className={`icon-button ${loading ? 'is-loading' : ''}`}
          aria-label="Atualizar estatísticas"
          disabled={loading}
          onClick={() => setRequestVersion(version => version + 1)}
        >
          <RefreshCw />
        </button>
      </header>

      <nav className="statistics-periods" aria-label="Período das estatísticas">
        {STATISTICS_PERIODS.map(option => (
          <button
            key={option.value}
            className={period === option.value ? 'is-active' : ''}
            aria-pressed={period === option.value}
            onClick={() => setPeriod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </nav>

      {loading && !data ? (
        <div className="statistics-state">Calculando suas estatísticas…</div>
      ) : error ? (
        <div className="statistics-state">
          <strong>Não foi possível carregar</strong>
          <span>{error}</span>
          <button className="secondary-action" onClick={() => setRequestVersion(version => version + 1)}>Tentar novamente</button>
        </div>
      ) : data && data.totalPlays > 0 ? (
        <>
          <div className="statistics-metrics">
            <Metric value={data.totalPlays} label="Reproduções" />
            <Metric value={formatListeningMinutes(data.totalMinutes)} label="Tempo estimado" />
            <Metric value={data.uniqueTracks} label="Faixas diferentes" />
            <Metric value={data.uniqueArtists} label="Artistas diferentes" />
          </div>

          <section className="statistics-section">
            <div className="section-heading"><span>Músicas mais ouvidas</span></div>
            <div className="statistics-ranking">
              {data.topTracks.map((item, index) => (
                <button className="statistics-row" key={item.track.id} onClick={() => onPlayTrack(item.track)}>
                  <RankingRow position={index + 1} title={item.track.title} subtitle={item.track.artist} plays={item.plays} />
                </button>
              ))}
            </div>
          </section>

          <section className="statistics-section">
            <div className="section-heading"><span>Artistas mais ouvidos</span></div>
            <div className="statistics-ranking">
              {data.topArtists.map((item, index) => (
                <div className="statistics-row" key={item.artist}>
                  <RankingRow position={index + 1} title={item.artist} plays={item.plays} />
                </div>
              ))}
            </div>
          </section>

          <section className="statistics-section">
            <div className="section-heading"><span>Álbuns mais ouvidos</span></div>
            <div className="statistics-ranking">
              {data.topAlbums.map((item, index) => (
                <div className="statistics-row" key={`${item.albumArtist}\0${item.album}`}>
                  <RankingRow position={index + 1} title={item.album} subtitle={item.albumArtist} plays={item.plays} />
                </div>
              ))}
            </div>
          </section>

          <p className="statistics-note">
            Baseado no histórico local, limitado às {data.historyCapacity.toLocaleString('pt-BR')} reproduções mais recentes.
            O tempo estimado soma a duração das faixas iniciadas.
          </p>
        </>
      ) : (
        <div className="statistics-state">
          <strong>Ainda não há reproduções neste período</strong>
          <span>Ouça algumas músicas e volte para acompanhar seus destaques.</span>
        </div>
      )}
    </div>
  );
}
