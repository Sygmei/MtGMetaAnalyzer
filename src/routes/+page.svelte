<script lang="ts">
  import { currentUser } from "$lib/current-user";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { t } from "$lib/i18n";

  const cardClass =
    "rounded border border-white/10 bg-stone-900/80 p-5 text-stone-100 no-underline transition hover:border-primary-300/50 hover:bg-stone-900";
  const eyebrowClass =
    "text-xs font-extrabold uppercase tracking-widest text-primary-300";
</script>

<svelte:head>
  <title>Karton</title>
</svelte:head>

<main class="mx-auto grid w-[min(980px,94vw)] gap-5 py-8 pb-12">
  <PageHeader title={$t("home.title")} />

  <section class="grid gap-4 md:grid-cols-2">
    <a class={cardClass} href="/analyzer" data-sveltekit-preload-code="eager" data-sveltekit-preload-data="hover">
      <p class={eyebrowClass}>Deck Analyzer</p>
      <h2 class="mt-2 text-xl font-bold">{$t("home.analyzerTitle")}</h2>
      <p class="mt-2 text-sm text-stone-400">
        {$t("home.analyzerDescription")}
      </p>
    </a>

    {#if $currentUser}
      <a class={cardClass} href="/tournament" data-sveltekit-preload-code="eager" data-sveltekit-preload-data="hover">
        <p class={eyebrowClass}>{$t("tournament.title")}</p>
        <h2 class="mt-2 text-xl font-bold">{$t("tournament.homeTitle")}</h2>
        <p class="mt-2 text-sm text-stone-400">{$t("tournament.homeDescription")}</p>
      </a>
      <a class={cardClass} href="/matches" data-sveltekit-preload-code="eager" data-sveltekit-preload-data="hover">
        <p class={eyebrowClass}>Matcher</p>
        <h2 class="mt-2 text-xl font-bold">{$t("home.matcherTitle")}</h2>
        <p class="mt-2 text-sm text-stone-400">
          {$t("home.matcherDescription")}
        </p>
      </a>
    {:else}
      <article class={`${cardClass} opacity-60`}>
        <div class="flex flex-wrap items-center gap-2">
          <p class={eyebrowClass}>Matcher</p>
          <span
            class="rounded-full border border-amber-200/30 bg-amber-300/10 px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-wide text-amber-200"
          >
            {$t("home.registeredOnly")}
          </span>
        </div>
        <h2 class="mt-2 text-xl font-bold">{$t("home.matcherTitle")}</h2>
        <p class="mt-2 text-sm text-stone-400">
          {$t("home.matcherDescription")}
        </p>
      </article>
    {/if}
  </section>
</main>
