<script lang="ts">
  import { onMount } from "svelte";

  import PageHeader from "$lib/components/PageHeader.svelte";
  import { t } from "$lib/i18n";

  type UserList = {
    id: string;
    kind: "buyer" | "seller";
    label: string | null;
    url: string;
    position: number;
  };

  type DirectoryUser = {
    id: string;
    username: string;
    displayName?: string | null;
    role: string;
    lists: UserList[];
  };

  type DirectoryPayload = {
    users: DirectoryUser[];
  };

  let directoryPromise: Promise<DirectoryPayload> = pending();
  let query = "";

  $: normalizedQuery = query.trim().toLowerCase();

  onMount(() => {
    directoryPromise = fetchJson<DirectoryPayload>("/matches/users/data");
  });

  function pending<T>(): Promise<T> {
    return new Promise(() => {});
  }

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error((await response.text()) || "Request failed.");
    }
    return (await response.json()) as T;
  }

  function visibleUsers(users: DirectoryUser[]): DirectoryUser[] {
    if (!normalizedQuery) {
      return users;
    }
    return users.filter((user) => {
      const haystack = [
        user.username,
        user.displayName || "",
        ...user.lists.flatMap((list) => [list.label || "", list.url])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  function listsByKind(user: DirectoryUser, kind: "buyer" | "seller"): UserList[] {
    return user.lists.filter((list) => list.kind === kind);
  }

  function displayName(user: DirectoryUser): string {
    return user.displayName || user.username;
  }

  const pageClass = "mx-auto grid w-[min(1180px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "ui-panel";
  const inputClass = "ui-input";
  const skeletonBlockClass = "animate-pulse rounded bg-stone-950/80";
</script>

<svelte:head>
  <title>Matcher users - Karton</title>
</svelte:head>

<main class={pageClass}>
  <PageHeader
    title={$t("matcher.directoryTitle")}
    subtitle={$t("matcher.directoryDescription")}
  >
    <div slot="actions" class="grid gap-3 sm:min-w-80">
      <a
        class="w-fit rounded border border-white/15 bg-transparent px-4 py-2 text-sm font-bold text-stone-100 no-underline hover:border-primary-300/50"
        href="/matches"
      >
        {$t("nav.matcher")}
      </a>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">{$t("matcher.filter")}</span>
        <input class={inputClass} bind:value={query} placeholder={$t("matcher.filterPlaceholder")} />
      </label>
    </div>
  </PageHeader>

  {#await directoryPromise}
    <section class="grid gap-3 md:grid-cols-2">
      {#each Array(6) as _}
        <article class={`${panelClass} grid gap-3`}>
          <span class={`${skeletonBlockClass} h-6 w-40 max-w-full`}></span>
          <span class={`${skeletonBlockClass} h-4 w-28 max-w-full`}></span>
          <span class={`${skeletonBlockClass} h-16 w-full`}></span>
        </article>
      {/each}
    </section>
  {:then directory}
    {@const users = visibleUsers(directory.users)}
    <section class={`${panelClass} flex flex-wrap items-center justify-between gap-3`}>
      <span class="text-sm text-stone-300">{$t("matcher.usersShown", { count: users.length })}</span>
      <span class="text-sm text-stone-400">
        {$t("matcher.savedListsTotal", { count: directory.users.reduce((sum, user) => sum + user.lists.length, 0) })}
      </span>
    </section>

    {#if users.length}
      <section class="grid gap-3 md:grid-cols-2">
        {#each users as user}
          {@const buyerLists = listsByKind(user, "buyer")}
          {@const sellerLists = listsByKind(user, "seller")}
          <article class={`${panelClass} grid gap-4 content-start`}>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h2 class="truncate text-xl font-bold">{displayName(user)}</h2>
                <p class="truncate text-sm text-stone-400">@{user.username} - {user.role}</p>
              </div>
              <span class="rounded bg-stone-950 px-3 py-1 text-sm text-stone-300">{user.lists.length} lists</span>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="grid content-start gap-2">
                <h3 class="text-sm font-bold text-primary-300">{$t("matcher.lookingForShort")} ({buyerLists.length})</h3>
                {#if buyerLists.length}
                  {#each buyerLists as list}
                    <a class="grid min-w-0 rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline hover:border-primary-300/50" href={list.url} target="_blank" rel="noreferrer">
                      <strong class="truncate">{list.label || list.url}</strong>
                      <span class="truncate text-sm text-stone-400">{list.url}</span>
                    </a>
                  {/each}
                {:else}
                  <p class="text-sm text-stone-500">{$t("matcher.noLookingLists")}</p>
                {/if}
              </div>

              <div class="grid content-start gap-2">
                <h3 class="text-sm font-bold text-primary-300">{$t("matcher.sellingShort")} ({sellerLists.length})</h3>
                {#if sellerLists.length}
                  {#each sellerLists as list}
                    <a class="grid min-w-0 rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline hover:border-primary-300/50" href={list.url} target="_blank" rel="noreferrer">
                      <strong class="truncate">{list.label || list.url}</strong>
                      <span class="truncate text-sm text-stone-400">{list.url}</span>
                    </a>
                  {/each}
                {:else}
                  <p class="text-sm text-stone-500">{$t("matcher.noSellingLists")}</p>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </section>
    {:else}
      <section class={`${panelClass} text-stone-400`}>{$t("matcher.noUsersMatch")}</section>
    {/if}
  {:catch error}
    <section class={`${panelClass} text-red-200`}>
      {error instanceof Error ? error.message : $t("matcher.loadUsersFailed")}
    </section>
  {/await}
</main>
