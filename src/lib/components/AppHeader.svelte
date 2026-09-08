<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { page } from "$app/stores";

  import { t, type TranslationKey } from "$lib/i18n";
  import UserMenu from "./UserMenu.svelte";

  export let currentUser:
    | {
        id?: string;
        username?: string;
        displayName?: string | null;
        role?: string;
      }
    | null
    | undefined = null;
  export let userLoaded = false;

  type NavItem = {
    href: string;
    label: TranslationKey;
    kicker: TranslationKey;
    match: (pathname: string) => boolean;
  };

  const navItems: NavItem[] = [
    {
      href: "/analyzer",
      label: "nav.deckAnalyzer",
      kicker: "nav.deckAnalyzerKicker",
      match: (pathname) => pathname.startsWith("/analyzer") || pathname.startsWith("/analysis")
    },
    {
      href: "/matches",
      label: "nav.matcher",
      kicker: "nav.matcherKicker",
      match: (pathname) => pathname.startsWith("/matches")
    },
    {
      href: "/tournament",
      label: "tournament.title",
      kicker: "tournament.kicker",
      match: (pathname) => pathname.startsWith("/tournament")
    }
  ];

  let optimisticPath: string | null = null;

  $: currentPath = $page.url.pathname;
  $: if (optimisticPath && currentPath === optimisticPath) {
    optimisticPath = null;
  }
  $: pathname = optimisticPath ?? currentPath;
  $: visibleNavItems = currentUser || !userLoaded ? navItems : navItems.filter((item) => item.href === "/analyzer");

  afterNavigate(() => {
    optimisticPath = null;
  });

  function markNavigation(href: string): void {
    if (href !== currentPath) {
      optimisticPath = href;
    }
  }

  function navigateOnPointerDown(event: PointerEvent, href: string): void {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    markNavigation(href);
    if (href !== currentPath) {
      void goto(href);
    }
  }
</script>

<header class="sticky top-0 z-50 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-primary-100/10 bg-[#0f1110] px-2 py-2 sm:px-5 sm:py-3 lg:grid-cols-[180px_minmax(0,1fr)_auto] lg:gap-3">
  <a
    class="flex min-w-0 select-none items-center gap-3 text-stone-100 no-underline"
    href="/"
    draggable="false"
    data-sveltekit-preload-code="eager"
    data-sveltekit-preload-data="hover"
    aria-label="Karton home"
  >
    <img class="size-9 shrink-0 rounded border border-primary-100/20 bg-stone-950 object-contain p-1 sm:size-9" src="/icon.svg" alt="" aria-hidden="true" />
    <span class="grid min-w-0">
      <strong class="truncate text-sm leading-tight">Karton</strong>
      <small class="truncate text-[0.68rem] uppercase text-stone-400">{$t("nav.mtgTools")}</small>
    </span>
  </a>

  <nav class="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto grid min-w-0 grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-1 sm:gap-2 lg:justify-self-center lg:w-[min(720px,100%)]" aria-label="Application sections">
    <a
      class={`grid h-10 min-w-10 select-none place-items-center rounded border px-2 text-center no-underline transition sm:min-h-[3.375rem] sm:min-w-11 sm:px-3 sm:py-2 ${pathname === "/" ? "border-primary-300 bg-primary-300 text-stone-950" : "border-primary-100/10 bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100"}`}
      href="/"
      draggable="false"
      data-sveltekit-preload-code="eager"
      data-sveltekit-preload-data="hover"
      on:pointerdown={(event) => navigateOnPointerDown(event, "/")}
      on:click={() => markNavigation("/")}
      aria-label={$t("nav.home")}
      aria-current={pathname === "/" ? "page" : undefined}
      title={$t("nav.home")}
    >
      <svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1v-10.5Z"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
        />
      </svg>
    </a>
    {#each navItems as item}
      <a
        class={`grid h-10 min-w-0 select-none place-items-center rounded border px-1 text-center no-underline transition sm:min-h-[3.375rem] sm:px-3 sm:py-2 ${visibleNavItems.includes(item) ? "" : "invisible pointer-events-none"} ${item.match(pathname) ? "border-primary-300 bg-primary-300 text-stone-950" : "border-primary-100/10 bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-100"}`}
        href={item.href}
        draggable="false"
        data-sveltekit-preload-code="eager"
        data-sveltekit-preload-data="hover"
        on:pointerdown={(event) => navigateOnPointerDown(event, item.href)}
        on:click={() => markNavigation(item.href)}
        aria-current={item.match(pathname) ? "page" : undefined}
        aria-hidden={!visibleNavItems.includes(item)}
        tabindex={visibleNavItems.includes(item) ? undefined : -1}
      >
        <span class="block w-full min-w-0 whitespace-normal text-xs leading-tight font-extrabold sm:truncate sm:text-sm">{$t(item.label)}</span>
        <small class="hidden w-full min-w-0 truncate text-[0.66rem] uppercase sm:block">{$t(item.kicker)}</small>
      </a>
    {/each}
  </nav>

  {#if currentUser}
    <div class="col-start-2 row-start-1 sm:col-start-3 justify-self-end">
      <UserMenu {currentUser} />
    </div>
  {/if}
</header>
