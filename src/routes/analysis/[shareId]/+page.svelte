<script lang="ts">
  import CardTable from '$lib/components/CardTable.svelte';
  import type { AnalyzeOutput } from '$lib/server/types';

  export let data: {
    shareId: string;
    shareUrl: string;
    createdAt: string;
    output: AnalyzeOutput;
  };

  type AnalysisTab = 'cut' | 'add' | 'keep';
  let activeAnalysisTab: AnalysisTab = 'cut';
</script>

<svelte:head>
  <title>Shared Analysis · MtG Meta Analyzer</title>
</svelte:head>

<main class="stage">
  <section class="panel">
    <p class="eyebrow">Shared Analysis</p>
    <h1>{data.output.moxfieldDeck.name}</h1>
    <p class="meta">
      Commander: {data.output.moxfieldDeck.commanders.join(' / ')} · Analyzed {new Date(data.output.analyzedAt).toLocaleString()}
    </p>
    <p class="meta">
      Share id: <code>{data.shareId}</code>
    </p>
    <div class="actions">
      <a href="/" rel="noreferrer">New analysis</a>
      <a href={data.output.moxfieldDeck.url} target="_blank" rel="noreferrer">Open Moxfield</a>
      <a href={data.shareUrl} target="_blank" rel="noreferrer">Permalink</a>
    </div>
  </section>

  <section class="panel">
    <div class="stats">
      <article>
        <p class="k">MtgTop8 Commander</p>
        <p class="v">
          <a href={data.output.commander.url} target="_blank" rel="noreferrer">{data.output.commander.name}</a>
        </p>
      </article>
      <article>
        <p class="k">Decks considered</p>
        <p class="v">{data.output.analysis.totalDecksConsidered}</p>
      </article>
      <article>
        <p class="k">Cached decks</p>
        <p class="v">{data.output.cache.totalCachedDeckRows}</p>
      </article>
    </div>
  </section>

  <section class="panel analysis-tabs-panel">
    <div class="analysis-tabs" role="tablist" aria-label="Shared analysis views">
      <button
        type="button"
        role="tab"
        class:active={activeAnalysisTab === 'cut'}
        aria-selected={activeAnalysisTab === 'cut'}
        on:click={() => (activeAnalysisTab = 'cut')}
      >
        Cut
      </button>
      <button
        type="button"
        role="tab"
        class:active={activeAnalysisTab === 'add'}
        aria-selected={activeAnalysisTab === 'add'}
        on:click={() => (activeAnalysisTab = 'add')}
      >
        Add
      </button>
      <button
        type="button"
        role="tab"
        class:active={activeAnalysisTab === 'keep'}
        aria-selected={activeAnalysisTab === 'keep'}
        on:click={() => (activeAnalysisTab = 'keep')}
      >
        Keep
      </button>
    </div>

    {#if activeAnalysisTab === 'cut'}
      <article class="analysis-view cut">
        <h2>Cards To Cut</h2>
        <CardTable cards={data.output.analysis.cut} />
      </article>
    {:else if activeAnalysisTab === 'add'}
      <article class="analysis-view add">
        <h2>Cards To Add</h2>
        <CardTable cards={data.output.analysis.toAdd} />
      </article>
    {:else}
      <article class="analysis-view keep">
        <h2>Cards To Keep</h2>
        <CardTable cards={data.output.analysis.keep} />
      </article>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #0b1217;
    color: #eef4f8;
    font-family: 'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif;
  }

  .stage {
    width: min(1200px, 94vw);
    margin: 1rem auto 2.5rem;
    display: grid;
    gap: 1rem;
  }

  .panel {
    border-radius: 18px;
    border: 1px solid rgba(183, 213, 230, 0.28);
    background: linear-gradient(145deg, rgba(14, 27, 35, 0.92), rgba(14, 27, 35, 0.78));
    padding: 1rem 1.1rem;
  }

  .eyebrow {
    margin: 0;
    color: #88d2dd;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-size: 0.74rem;
    font-weight: 700;
  }

  h1,
  h2 {
    margin: 0;
    font-family: 'Sora', 'Space Grotesk', sans-serif;
  }

  h1 {
    margin-top: 0.35rem;
    font-size: clamp(1.45rem, 2.4vw, 2rem);
  }

  h2 {
    font-size: 1.1rem;
  }

  .meta {
    margin: 0.45rem 0 0;
    color: #b4c8d5;
    line-height: 1.35;
  }

  code {
    color: #b8e6f1;
  }

  .actions {
    margin-top: 0.75rem;
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  a {
    color: #76d6ea;
    text-decoration: none;
    font-weight: 600;
  }

  a:hover {
    text-decoration: underline;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.7rem;
  }

  .stats article {
    border: 1px solid rgba(166, 209, 228, 0.2);
    border-radius: 14px;
    background: rgba(8, 19, 25, 0.52);
    padding: 0.75rem;
  }

  .stats .k {
    margin: 0;
    color: #8fb0c2;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .stats .v {
    margin: 0.38rem 0 0;
    font-size: 1.02rem;
    font-weight: 700;
  }

  .analysis-tabs-panel {
    display: grid;
    gap: 0.9rem;
  }

  .analysis-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    padding: 0.25rem;
    border: 1px solid rgba(155, 205, 227, 0.25);
    border-radius: 13px;
    background: rgba(6, 17, 24, 0.55);
    width: fit-content;
  }

  .analysis-tabs button {
    border: 1px solid rgba(121, 170, 193, 0.26);
    border-radius: 10px;
    background: rgba(15, 40, 52, 0.7);
    color: #d2e4ee;
    padding: 0.45rem 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.76rem;
    font-weight: 700;
    cursor: pointer;
  }

  .analysis-tabs button.active {
    border-color: rgba(124, 208, 227, 0.8);
    background: linear-gradient(130deg, rgba(37, 173, 196, 0.75), rgba(244, 163, 64, 0.65));
    color: #07131a;
  }

  .analysis-view {
    min-width: 0;
    display: grid;
    gap: 0.65rem;
  }

  .analysis-view.keep h2 {
    color: #87d7e8;
  }

  .analysis-view.cut h2 {
    color: #ffb77d;
  }

  .analysis-view.add h2 {
    color: #8ee2b7;
  }

  @media (max-width: 900px) {
    .stats {
      grid-template-columns: 1fr;
    }
  }
</style>
