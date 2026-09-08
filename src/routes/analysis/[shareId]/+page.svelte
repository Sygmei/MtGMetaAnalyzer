<script lang="ts">
  import CardTable from '$lib/components/CardTable.svelte';
  import { t } from '$lib/i18n';
  import type { AnalyzeOutput } from '$lib/server/types';

  export let data: {
    shareId: string;
    shareUrl: string;
    createdAt: string;
    commanderName: string;
    ignoreBefore: string | null;
    ignoreAfter: string | null;
    output: AnalyzeOutput;
  };

  type AnalysisTab = 'cut' | 'add' | 'keep';
  let activeAnalysisTab: AnalysisTab = 'cut';

  function activateAnalysisTabOnPointerDown(event: PointerEvent, tab: AnalysisTab): void {
    if (event.button === 0) {
      activeAnalysisTab = tab;
    }
  }

  $: deckSourceLabel =
    data.output.moxfieldDeck.source === 'manabox'
      ? 'ManaBox'
      : data.output.moxfieldDeck.source === 'archidekt'
        ? 'Archidekt'
        : 'Moxfield';

  const pageClass = "mx-auto grid w-[min(1200px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "rounded border border-white/10 bg-stone-900/80 p-4";
  const eyebrowClass = "text-xs font-extrabold uppercase tracking-widest text-primary-300";
  const statLabelClass = "text-xs font-bold uppercase tracking-wider text-stone-400";
  const statValueClass = "mt-1 text-lg font-black text-stone-100";
  const linkButtonClass = "rounded border border-primary-200/30 px-3 py-2 text-sm font-bold text-primary-300 no-underline hover:bg-primary-300 hover:text-stone-950";
</script>

<svelte:head>
  <title>Shared Analysis - Karton</title>
</svelte:head>

<main class={pageClass}>
  <section class={panelClass}>
    <p class={eyebrowClass}>Shared Analysis</p>
    <h1 class="mt-2 text-2xl font-black">{data.output.moxfieldDeck.name}</h1>
    <p class="mt-2 text-stone-400">
      Commander: {data.output.moxfieldDeck.commanders.join(' / ')} - Analyzed {new Date(data.output.analyzedAt).toLocaleString()}
    </p>
    {#if data.ignoreBefore || data.ignoreAfter}
      <p class="mt-3 flex flex-wrap items-center gap-2 text-stone-400">
        {#if data.ignoreBefore}
          <span>Ignore MtgTop8 decks before:</span>
          <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.ignoreBefore}</code>
        {/if}
        {#if data.ignoreAfter}
          <span>Ignore MtgTop8 decks after:</span>
          <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.ignoreAfter}</code>
        {/if}
      </p>
    {/if}
    <p class="mt-2 text-stone-400">
      Share id: <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{data.shareId}</code>
    </p>
    {#if data.output.analysis.requiredCards?.length}
      <p class="mt-3 text-sm text-stone-300">{$t("analyzer.requiredCards")}: {data.output.analysis.requiredCards.join(' · ')}</p>
      {#if data.output.analysis.totalDecksConsidered === 0}
        <p class="mt-2 text-sm text-amber-200" role="status">{$t("analyzer.noMatchingDecks")}</p>
      {/if}
    {/if}
    <div class="mt-4 flex flex-wrap gap-2">
      <a class={linkButtonClass} href="/analyzer" rel="noreferrer">New analysis</a>
      {#if data.output.moxfieldDeck.source !== "commander"}
      <a class={linkButtonClass} href={data.output.moxfieldDeck.url} target="_blank" rel="noreferrer">Open {deckSourceLabel}</a>
      {/if}
      <a class={linkButtonClass} href={data.shareUrl} target="_blank" rel="noreferrer">Permalink</a>
    </div>
  </section>

  <section class={panelClass}>
    <div class="grid gap-3 md:grid-cols-3">
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>MtgTop8 Commander</p>
        <p class={statValueClass}>
          <a class="text-primary-300 no-underline" href={data.output.commander.url} target="_blank" rel="noreferrer">{data.commanderName}</a>
        </p>
      </article>
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>Decks considered</p>
        <p class={statValueClass}>{data.output.analysis.totalDecksConsidered}</p>
      </article>
      <article class="rounded border border-white/10 bg-stone-950/60 p-4">
        <p class={statLabelClass}>Cached decks</p>
        <p class={statValueClass}>{data.output.cache.totalCachedDeckRows}</p>
      </article>
    </div>
  </section>

  <section class={`${panelClass} grid gap-4`}>
    {#if data.output.moxfieldDeck.source === 'commander'}
      <h2 class="text-xl font-bold">{$t('analyzer.popularCards')}</h2>
      <CardTable cards={data.output.analysis.toAdd} />
    {:else}
    <div class="grid grid-cols-3 rounded border border-white/10 bg-stone-950 p-1" role="tablist" aria-label="Shared analysis views">
      <button
        class={`select-none rounded px-3 py-2 font-bold ${activeAnalysisTab === 'cut' ? "bg-primary-300 text-stone-950" : "text-stone-300 hover:bg-stone-800"}`}
        type="button"
        role="tab"
        aria-selected={activeAnalysisTab === 'cut'}
        on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, 'cut')}
        on:click={() => (activeAnalysisTab = 'cut')}
      >
        Cut
      </button>
      <button
        class={`select-none rounded px-3 py-2 font-bold ${activeAnalysisTab === 'add' ? "bg-primary-300 text-stone-950" : "text-stone-300 hover:bg-stone-800"}`}
        type="button"
        role="tab"
        aria-selected={activeAnalysisTab === 'add'}
        on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, 'add')}
        on:click={() => (activeAnalysisTab = 'add')}
      >
        Add
      </button>
      <button
        class={`select-none rounded px-3 py-2 font-bold ${activeAnalysisTab === 'keep' ? "bg-primary-300 text-stone-950" : "text-stone-300 hover:bg-stone-800"}`}
        type="button"
        role="tab"
        aria-selected={activeAnalysisTab === 'keep'}
        on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, 'keep')}
        on:click={() => (activeAnalysisTab = 'keep')}
      >
        Keep
      </button>
    </div>

    {#if activeAnalysisTab === 'cut'}
      <article class="grid gap-3">
        <h2 class="text-xl font-bold">Cards To Cut</h2>
        <CardTable cards={data.output.analysis.cut} />
      </article>
    {:else if activeAnalysisTab === 'add'}
      <article class="grid gap-3">
        <h2 class="text-xl font-bold">Cards To Add</h2>
        <CardTable cards={data.output.analysis.toAdd} />
      </article>
    {:else}
      <article class="grid gap-3">
        <h2 class="text-xl font-bold">Cards To Keep</h2>
        <CardTable cards={data.output.analysis.keep} />
      </article>
    {/if}
    {/if}
  </section>
</main>
