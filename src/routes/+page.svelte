<script lang="ts">
  import { currentUser } from "$lib/current-user";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { t, type TranslationKey } from "$lib/i18n";

  const tools: { href: string; title: TranslationKey; description: TranslationKey; membersOnly: boolean }[] = [
    { href: "/analyzer", title: "nav.deckAnalyzer", description: "home.analyzerDescription", membersOnly: false },
    { href: "/matches", title: "nav.matcher", description: "home.matcherDescription", membersOnly: true },
    { href: "/tournament", title: "tournament.title", description: "tournament.homeDescription", membersOnly: true }
  ];
</script>

<svelte:head><title>Karton</title></svelte:head>

<main class="home-page">
  <PageHeader title={$t("home.title")} />
  <section class="tool-list" aria-label={$t("home.title")}>
    {#each tools as tool}
      {#if !tool.membersOnly || $currentUser}
        <a class="tool-row" href={tool.href} data-sveltekit-preload-code="eager" data-sveltekit-preload-data="hover">
          <div><h2>{$t(tool.title)}</h2><p>{$t(tool.description)}</p></div>
          <span class="arrow" aria-hidden="true">→</span>
        </a>
      {:else}
        <article class="tool-row locked">
          <div><h2>{$t(tool.title)}</h2><p>{$t(tool.description)}</p><span class="access-note">{$t("home.registeredOnly")}</span></div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></svg>
        </article>
      {/if}
    {/each}
  </section>
</main>

<style>
  .home-page { width: min(800px, calc(100% - 40px)); margin: auto; padding: 40px 0 64px; }
  .tool-list { margin-top: 16px; border-top: 1px solid var(--border); }
  .tool-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 26px 16px; border-bottom: 1px solid var(--border); color: var(--text); text-decoration: none; }
  a.tool-row:hover { background: var(--surface); }
  h2 { font-size: 16px; font-weight: 600; }
  p { margin-top: 6px; color: var(--muted); font-size: 14px; line-height: 1.6; }
  .arrow { font-size: 22px; color: var(--muted); }
  .locked svg { flex-shrink: 0; color: var(--muted); }
  .access-note { display: inline-block; margin-top: 10px; color: var(--muted); font-size: 12px; }
  @media (max-width: 639px) { .home-page { width: calc(100% - 32px); padding-top: 24px; } .tool-row { padding: 22px 4px; gap: 16px; } }
</style>
