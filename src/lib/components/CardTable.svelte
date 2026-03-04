<script lang="ts">
  import type { CardStat } from '$lib/server/types';

  export let cards: CardStat[] = [];

  type PreviewStatus = 'hidden' | 'loading' | 'ready' | 'error';

  type ScryfallCardPreview = {
    name: string;
    imageUrl: string;
    scryfallUrl: string;
  };

  type ScryfallResponse = {
    name?: string;
    scryfall_uri?: string;
    image_uris?: Record<string, string>;
    card_faces?: Array<{
      image_uris?: Record<string, string>;
    }>;
  };

  const previewCache = new Map<string, ScryfallCardPreview | null>();
  const previewInflight = new Map<string, Promise<ScryfallCardPreview | null>>();

  let previewStatus: PreviewStatus = 'hidden';
  let previewCard: ScryfallCardPreview | null = null;
  let previewLabel = '';
  let previewError = '';
  let activeCard = '';
  let previewSequence = 0;

  function toPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  function normalizeCardKey(cardName: string): string {
    return cardName.trim().toLowerCase();
  }

  function extractImageUrl(payload: ScryfallResponse): string | null {
    return (
      payload.image_uris?.normal ??
      payload.image_uris?.large ??
      payload.image_uris?.png ??
      payload.card_faces?.[0]?.image_uris?.normal ??
      payload.card_faces?.[0]?.image_uris?.large ??
      payload.card_faces?.[0]?.image_uris?.png ??
      null
    );
  }

  async function fetchScryfallCard(cardName: string): Promise<ScryfallCardPreview | null> {
    const exactUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
    const fuzzyUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
    const endpoints = [exactUrl, fuzzyUrl];

    for (const endpoint of endpoints) {
      const response = await fetch(endpoint);
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as ScryfallResponse;
      const imageUrl = extractImageUrl(payload);
      const scryfallUrl = payload.scryfall_uri;
      const foundName = payload.name ?? cardName;
      if (!imageUrl || !scryfallUrl) {
        continue;
      }

      return {
        name: foundName,
        imageUrl,
        scryfallUrl
      };
    }

    return null;
  }

  async function resolvePreview(cardName: string): Promise<ScryfallCardPreview | null> {
    const key = normalizeCardKey(cardName);
    const cached = previewCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const inflight = previewInflight.get(key);
    if (inflight) {
      return inflight;
    }

    const request = fetchScryfallCard(cardName)
      .then((result) => {
        previewCache.set(key, result);
        return result;
      })
      .finally(() => {
        previewInflight.delete(key);
      });

    previewInflight.set(key, request);
    return request;
  }

  async function openPreview(cardName: string): Promise<void> {
    previewSequence += 1;
    const sequence = previewSequence;
    activeCard = cardName;
    previewLabel = cardName;
    previewError = '';
    previewCard = null;
    previewStatus = 'loading';

    try {
      const result = await resolvePreview(cardName);
      if (sequence !== previewSequence || activeCard !== cardName) {
        return;
      }

      if (result) {
        previewCard = result;
        previewStatus = 'ready';
        return;
      }

      previewError = 'Preview unavailable on Scryfall for this card.';
      previewStatus = 'error';
    } catch {
      if (sequence !== previewSequence || activeCard !== cardName) {
        return;
      }
      previewError = 'Could not fetch preview from Scryfall.';
      previewStatus = 'error';
    }
  }

  function closePreview(): void {
    previewStatus = 'hidden';
    previewCard = null;
    previewError = '';
    previewLabel = '';
    activeCard = '';
  }
</script>

{#if cards.length === 0}
  <p class="empty">No cards found for this section in the selected date range.</p>
{:else}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Card</th>
          <th>Decks</th>
          <th>Ratio</th>
        </tr>
      </thead>
      <tbody>
        {#each cards as row, idx}
          <tr style={`--row-delay:${idx * 18}ms`}>
            <td class="card-cell">
              <button
                type="button"
                class="card-link"
                on:mouseenter={() => openPreview(row.card)}
                on:focus={() => openPreview(row.card)}
              >
                {row.card}
              </button>
            </td>
            <td>{row.decksWithCard} / {row.totalDecks}</td>
            <td>{toPercent(row.ratio)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if previewStatus !== 'hidden'}
  <div class="preview-layer">
    <aside class="preview" aria-live="polite" aria-busy={previewStatus === 'loading'}>
      <div class="preview-toolbar">
        <p>Scryfall Preview</p>
        <button type="button" on:click={closePreview} aria-label="Close card preview">Close</button>
      </div>

      {#if previewStatus === 'loading'}
        <p class="preview-state">Loading Scryfall preview for <strong>{previewLabel}</strong>...</p>
      {:else if previewStatus === 'error'}
        <p class="preview-state">{previewError}</p>
      {:else if previewCard}
        <img src={previewCard.imageUrl} alt={`Scryfall preview for ${previewCard.name}`} loading="lazy" />
        <div class="preview-meta">
          <p>{previewCard.name}</p>
          <a href={previewCard.scryfallUrl} target="_blank" rel="noreferrer">Open on Scryfall</a>
        </div>
      {/if}
    </aside>
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    color: #aac2cf;
    font-size: 0.92rem;
  }

  .table-wrap {
    overflow: auto;
    border: 1px solid rgba(164, 208, 227, 0.22);
    border-radius: 14px;
    background: rgba(5, 18, 24, 0.45);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th,
  td {
    text-align: left;
    padding: 0.57rem 0.65rem;
    white-space: nowrap;
    border-bottom: 1px solid rgba(166, 206, 225, 0.13);
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: linear-gradient(180deg, rgba(24, 53, 67, 0.92), rgba(15, 38, 49, 0.92));
    color: #d4e6f1;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.73rem;
    font-weight: 800;
  }

  tbody tr {
    opacity: 0;
    transform: translateY(2px);
    animation: rowIn 220ms ease forwards;
    animation-delay: var(--row-delay, 0ms);
  }

  tbody tr:hover {
    background: linear-gradient(90deg, rgba(67, 184, 207, 0.16), rgba(245, 163, 68, 0.16));
  }

  tbody td:first-child {
    font-weight: 700;
    color: #ebf4f9;
  }

  .card-cell {
    max-width: 1px;
  }

  .card-link {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0;
    text-align: left;
    font-weight: inherit;
    line-height: 1.25;
  }

  .card-link:hover,
  .card-link:focus-visible {
    color: #7ae5f5;
    text-decoration: underline;
    outline: none;
  }

  tbody td:last-child {
    color: #8fe3ba;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  @keyframes rowIn {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .preview-layer {
    position: fixed;
    inset: 0;
    z-index: 1200;
    pointer-events: none;
  }

  .preview {
    position: absolute;
    top: 5.3rem;
    right: 1rem;
    width: 248px;
    max-height: min(82vh, 420px);
    border-radius: 14px;
    border: 1px solid rgba(153, 210, 232, 0.35);
    background: rgba(6, 16, 22, 0.96);
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(5px);
    overflow: hidden;
    pointer-events: auto;
    animation: previewIn 140ms ease both;
  }

  .preview-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid rgba(149, 199, 220, 0.2);
    background: rgba(9, 29, 39, 0.92);
  }

  .preview-toolbar p {
    margin: 0;
    color: #d8ebf5;
    font-size: 0.73rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 800;
  }

  .preview-toolbar button {
    border: 1px solid rgba(146, 194, 216, 0.32);
    border-radius: 8px;
    background: rgba(17, 45, 59, 0.78);
    color: #d4e6f1;
    font: inherit;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.24rem 0.46rem;
    cursor: pointer;
  }

  .preview-toolbar button:hover {
    border-color: rgba(124, 209, 230, 0.66);
  }

  .preview img {
    display: block;
    width: 100%;
    height: auto;
    border-bottom: 1px solid rgba(149, 199, 220, 0.2);
  }

  .preview-meta {
    padding: 0.55rem 0.65rem 0.6rem;
  }

  .preview-meta p {
    margin: 0;
    color: #f2f8fb;
    font-size: 0.84rem;
    font-weight: 700;
    line-height: 1.35;
  }

  .preview-meta a {
    margin-top: 0.36rem;
    display: inline-block;
    font-size: 0.77rem;
    color: #77d7eb;
    text-decoration: none;
  }

  .preview-meta a:hover {
    text-decoration: underline;
  }

  .preview-state {
    margin: 0;
    padding: 0.9rem 0.8rem;
    color: #b9cfdb;
    font-size: 0.81rem;
    line-height: 1.4;
  }

  @keyframes previewIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 860px) {
    .preview {
      right: 0.65rem;
      top: auto;
      bottom: 0.65rem;
      width: min(248px, calc(100vw - 1.3rem));
      max-height: min(65vh, 420px);
    }
  }
</style>
