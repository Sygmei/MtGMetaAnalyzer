<script lang="ts">
  import Icon, { type IconName } from "$lib/components/Icon.svelte";
  import { page } from "$app/stores";
  import { t, type TranslationKey } from "$lib/i18n";
  import UserMenu from "./UserMenu.svelte";

  export let currentUser:
    | { id?: string; username?: string; displayName?: string | null; role?: string }
    | null | undefined = null;
  export let userLoaded = false;

  const navItems: { href: string; label: TranslationKey; icon: IconName; match: (path: string) => boolean }[] = [
    { href: "/analyzer", label: "nav.deckAnalyzer", icon: "scan", match: (path) => path.startsWith("/analyzer") || path.startsWith("/analysis") },
    { href: "/matches", label: "nav.matcher", icon: "search", match: (path) => path.startsWith("/matches") },
    { href: "/tournament", label: "tournament.title", icon: "trophy", match: (path) => path.startsWith("/tournament") }
  ];
  $: visibleNavItems = currentUser ? navItems : navItems.filter((item) => item.href === "/analyzer");
</script>

<header class="app-header">
  <div class="header-inner">
    <a class="brand" href="/" aria-label="Karton home" data-sveltekit-preload-data="hover">
      <img src="/icon.svg" alt="" width="28" height="28" />
      <span>Karton</span>
    </a>
    <nav aria-label={$t("nav.sections")} aria-busy={!userLoaded}>
      {#each visibleNavItems as item}
        <a href={item.href} aria-label={$t(item.label)} title={$t(item.label)} aria-current={item.match($page.url.pathname) ? "page" : undefined}
          data-sveltekit-preload-code="eager" data-sveltekit-preload-data="hover">
          <Icon name={item.icon} size={16} /><span>{$t(item.label)}</span>
        </a>
      {/each}
    </nav>
    {#if currentUser}<UserMenu {currentUser} />{/if}
  </div>
</header>

<style>
  .app-header { position: sticky; top: 0; z-index: 50; border-bottom: 1px solid var(--border); background: var(--canvas); }
  .header-inner { width: min(1200px, calc(100% - 40px)); min-height: 64px; margin: auto; display: flex; align-items: center; gap: 40px; }
  .brand { display: flex; flex-shrink: 0; align-items: center; gap: 9px; color: var(--text); font-size: 16px; font-weight: 600; text-decoration: none; }
  nav { display: flex; align-self: stretch; gap: 28px; flex: 1; min-width: 0; }
  nav a { display: flex; gap: 7px; align-items: center; justify-content: center; border-bottom: 2px solid transparent; padding: 12px 0 10px; color: var(--muted); text-decoration: none; font-size: 14px; line-height: 1.4; text-align: center; }
  nav a:hover { color: var(--text); }
  nav a[aria-current="page"] { color: var(--text); border-color: var(--color-primary-300); }
  @media (max-width: 639px) {
    .header-inner { width: calc(100% - 32px); flex-wrap: wrap; gap: 0; padding-top: 12px; }
    .brand { flex: 1; min-height: 36px; }
    nav { order: 3; flex-basis: 100%; gap: 18px; }
    nav a { flex: 1; min-height: 48px; }
    nav a span { display: none; }
  }
</style>
