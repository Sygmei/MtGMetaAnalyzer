<script lang="ts">
  import "../app.css";

  import { afterNavigate, preloadCode, preloadData } from "$app/navigation";
  import { navigating } from "$app/stores";
  import { onMount } from "svelte";

  import AppHeader from "$lib/components/AppHeader.svelte";
  import { currentUser, type CurrentUser } from "$lib/current-user";
  import { initLanguage, t, type TranslationKey } from "$lib/i18n";

  let currentUserLoaded = false;
  let currentUserRefreshId = 0;

  async function refreshCurrentUser(): Promise<void> {
    const refreshId = ++currentUserRefreshId;
    try {
      const response = await fetch("/api/session", {
        headers: {
          accept: "application/json"
        }
      });
      if (refreshId !== currentUserRefreshId) {
        return;
      }
      if (!response.ok) {
        currentUser.set(null);
        return;
      }
      const payload = (await response.json()) as { currentUser?: CurrentUser | null };
      if (refreshId !== currentUserRefreshId) {
        return;
      }
      currentUser.set(payload.currentUser ?? null);
    } catch {
      if (refreshId === currentUserRefreshId) {
        currentUser.set(null);
      }
    } finally {
      if (refreshId === currentUserRefreshId) {
        currentUserLoaded = true;
      }
    }
  }

  onMount(() => {
    initLanguage();
    void refreshCurrentUser();
    void preloadPrimaryRoutes();
  });

  afterNavigate(() => {
    if (currentUserLoaded) {
      void refreshCurrentUser();
    }
  });

  async function preloadPrimaryRoutes(): Promise<void> {
    await Promise.allSettled([
      preloadCode("/"),
      preloadCode("/analyzer"),
      preloadCode("/matches"),
      preloadCode("/tournament"),
      preloadData("/"),
      preloadData("/analyzer"),
      preloadData("/matches")
    ]);
  }

  function routeLabel(pathname: string | undefined): TranslationKey {
    if (pathname?.startsWith("/analyzer") || pathname?.startsWith("/analysis")) {
      return "nav.deckAnalyzer";
    }
    if (pathname?.startsWith("/tournament")) return "tournament.title";
    if (pathname?.startsWith("/matches")) {
      return "nav.matcher";
    }
    return "nav.home";
  }

  $: pendingRouteLabel = routeLabel($navigating?.to?.url.pathname);
</script>

<svelte:head>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <meta name="theme-color" content="#0f1110" />
</svelte:head>

<AppHeader currentUser={$currentUser} userLoaded={currentUserLoaded} />

<div
  class={`transition-opacity duration-150 ${$navigating ? "opacity-40" : "opacity-100"}`}
  aria-busy={$navigating ? "true" : undefined}
>
  <slot />
</div>

{#if $navigating}
  <div class="pointer-events-none fixed inset-0 z-40 bg-stone-950/35 backdrop-blur-[1px]" aria-hidden="true"></div>
  <div class="pointer-events-none fixed inset-x-0 top-0 z-40 h-1 overflow-hidden bg-primary-300/10" aria-hidden="true">
    <div class="route-loading-bar h-full w-1/3 rounded-r-full bg-primary-300 shadow-[0_0_20px_rgba(201,56,20,0.6)]"></div>
  </div>
  <div class="pointer-events-none fixed inset-x-0 top-28 z-40 flex justify-center px-4 sm:top-20" role="status" aria-live="polite">
    <div class="rounded border border-primary-300/40 bg-stone-950/95 px-4 py-2 text-sm font-bold text-primary-100 shadow-xl shadow-black/30">
      Loading {$t(pendingRouteLabel)}...
    </div>
  </div>
{/if}

<style>
  .route-loading-bar {
    animation: route-loading-slide 900ms ease-in-out infinite;
  }

  @keyframes route-loading-slide {
    from {
      transform: translateX(-100%);
    }

    to {
      transform: translateX(300%);
    }
  }
</style>
