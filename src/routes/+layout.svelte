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
  <meta name="theme-color" content="#111212" />
</svelte:head>

<a class="skip-link" href="#page-content">{$t("nav.skipToContent")}</a>
<AppHeader currentUser={$currentUser} userLoaded={currentUserLoaded} />

<div id="page-content" tabindex="-1" aria-busy={$navigating ? "true" : undefined}>
  <slot />
</div>

{#if $navigating}
  <div class="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" aria-hidden="true">
    <div class="route-loading-bar h-full w-1/3 bg-primary-300"></div>
  </div>
  <div class="sr-only" role="status">{$t("nav.loading", { page: $t(pendingRouteLabel) })}</div>
{/if}

<style>
  .skip-link { position: fixed; top: 8px; left: 16px; z-index: 100; transform: translateY(-200%); border-radius: 4px; background: var(--text); color: var(--canvas); padding: 10px 16px; }
  .skip-link:focus { transform: translateY(0); }
  #page-content:focus { outline: none; }

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
