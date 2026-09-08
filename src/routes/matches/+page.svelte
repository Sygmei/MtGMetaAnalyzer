<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { enhance } from "$app/forms";
  import { onMount } from "svelte";

  import PageHeader from "$lib/components/PageHeader.svelte";
  import { currentUser } from "$lib/current-user";
  import { t } from "$lib/i18n";
  import type {
    CardListMatchResult,
    UserContactMatchResult,
  } from "$lib/server/types";

  type CurrentUser = {
    id: string;
    username: string;
    displayName?: string | null;
    role: string;
  };

  type AdminUser = CurrentUser & {
    lists: {
      buyer: number;
      seller: number;
    };
  };

  type SavedList = {
    id: string;
    kind: "buyer" | "seller";
    label: string | null;
    url: string;
  };

  export let form:
    | {
        error?: string;
        success?: string;
        accountOutput?: UserContactMatchResult;
        adminOutput?: CardListMatchResult;
        adminContactOutput?: UserContactMatchResult;
        selectedUserIds?: string[];
        adminFocusUserId?: string;
        traceId?: string;
      }
    | undefined;

  let isSubmitting = false;

  $: accountOutput = form?.accountOutput;
  $: adminOutput = form?.adminOutput;
  $: adminContactOutput = form?.adminContactOutput;
  $: selectedUserIds = form?.selectedUserIds ?? [];
  $: adminFocusUserId = form?.adminFocusUserId ?? "";
  $: isAdmin =
    $currentUser?.role === "admin" ||
    $currentUser?.role === "superadmin";

  let savedListsPromise: Promise<SavedList[]> = pending();
  let adminUsersPromise: Promise<AdminUser[]> = pending();
  let loadedSavedLists = false;
  let loadedAdminUsers = false;

  onMount(() => {
    return currentUser.subscribe((user) => {
      if (user && !loadedSavedLists) {
        loadedSavedLists = true;
        savedListsPromise = fetchJson<SavedList[]>("/matches/lists");
      }
      if (!user) {
        savedListsPromise = Promise.resolve([]);
      }
      if ((user?.role === "admin" || user?.role === "superadmin") && !loadedAdminUsers) {
        loadedAdminUsers = true;
        adminUsersPromise = fetchJson<AdminUser[]>("/matches/admin-users");
      }
      if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        adminUsersPromise = Promise.resolve([]);
      }
    });
  });

  const enhanceSubmit = () => {
    isSubmitting = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      isSubmitting = false;
    };
  };

  function sourceLabel(source: string): string {
    if (source === "mythic-tools") return "Mythic Tools";
    if (source === "manabox") return "ManaBox";
    if (source === "archidekt") return "Archidekt";
    return "Moxfield";
  }

  function listNames(
    items: Array<{ listName: string; url: string; quantity: number }>,
  ): string {
    return items
      .map((item) => `${item.listName} (${item.quantity})`)
      .join(", ");
  }

  function roleLabel(role: "buyer" | "seller"): string {
    return role === "buyer" ? "Looking-for list" : "Selling list";
  }

  function pending<T>(): Promise<T> {
    return new Promise(() => {});
  }

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as T;
  }

  function toggleAllPeople(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const form = input.form;
    if (!form) return;
    for (const checkbox of Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="userIds"]'),
    )) {
      checkbox.checked = input.checked;
    }
  }

  const pageClass = "mx-auto grid w-[min(1180px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "ui-panel";
  const inputClass =
    "ui-input";
  const buttonClass =
    "ui-button";
  const eyebrowClass =
    "text-sm font-medium text-stone-400";
  const tableCellClass =
    "border-b border-white/10 px-3 py-2 text-left align-top";
  const skeletonBlockClass = "animate-pulse rounded bg-stone-950/80";
</script>

<svelte:head>
  <title>Matcher - Karton</title>
</svelte:head>

<main class={pageClass}>
  <PageHeader
    title={$t("matcher.title")}
    subtitle={$t("matcher.description")}
  />

  {#if $currentUser}
    {#await savedListsPromise}
      <div class="flex flex-wrap items-center gap-3">
        <button class={buttonClass} type="button" disabled>
          <Icon name="search" /> {$t("matcher.findPeople")}
        </button>
        <a class="ui-icon-button" href="/matches/users" aria-label={$t("matcher.viewAllUsers")} title={$t("matcher.viewAllUsers")}><Icon name="users" /></a>
      </div>
    {:then savedLists}
      {@const savedBuyerCount = savedLists.filter(
        (list) => list.kind === "buyer",
      ).length}
      {@const savedSellerCount = savedLists.filter(
        (list) => list.kind === "seller",
      ).length}
      <div class="flex flex-wrap items-center gap-3">
        <form method="POST" action="?/saved" use:enhance={enhanceSubmit}>
          <button
            class={buttonClass}
            type="submit"
            disabled={isSubmitting || (!savedBuyerCount && !savedSellerCount)}
          >
            <Icon name={isSubmitting ? "loader" : "search"} /> {isSubmitting ? $t("matcher.finding") : $t("matcher.findPeople")}
          </button>
        </form>
        <a class="ui-icon-button" href="/matches/users" aria-label={$t("matcher.viewAllUsers")} title={$t("matcher.viewAllUsers")}><Icon name="users" /></a>
      </div>
    {:catch}
      <p class="text-sm text-red-200">
        {$t("matcher.loadSavedListsFailed")}
      </p>
    {/await}
  {:else}
    <div class="flex flex-wrap items-center gap-3">
      <a class="ui-icon-button" href="/matches/users" aria-label={$t("matcher.viewAllUsers")} title={$t("matcher.viewAllUsers")}><Icon name="users" /></a>
    </div>
  {/if}

  <section class={`${panelClass} grid gap-4`} id="lists">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="mt-1 text-xl font-bold">{$t("matcher.addList")}</h2>
      </div>
    </div>
    <form
      class="grid gap-3 md:grid-cols-[180px_1fr_2fr_auto] md:items-end"
      method="POST"
      action="?/addList"
    >
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">{$t("matcher.type")}</span>
        <select class={inputClass} name="kind">
          <option value="buyer">{$t("matcher.lookingFor")}</option>
          <option value="seller">{$t("matcher.selling")}</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">{$t("matcher.label")}</span>
        <input class={inputClass} name="label" placeholder={$t("matcher.optional")} />
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">{$t("matcher.url")}</span>
        <input
          class={inputClass}
          name="url"
          placeholder="Moxfield, Archidekt, ManaBox, Mythic Tools"
          required
        />
      </label>
      <button class="ui-icon-button ui-icon-primary" type="submit" aria-label={$t("matcher.add")} title={$t("matcher.add")}><Icon name="plus" /></button>
    </form>
  </section>

  {#await savedListsPromise}
    <section class="grid gap-4 md:grid-cols-2">
      <div class={`${panelClass} grid gap-3 content-start`}>
        <h2 class="text-xl font-bold">{$t("matcher.lookingFor")}</h2>
        {@render ListSkeleton()}
      </div>
      <div class={`${panelClass} grid gap-3 content-start`}>
        <h2 class="text-xl font-bold">{$t("matcher.selling")}</h2>
        {@render ListSkeleton()}
      </div>
    </section>
  {:then savedLists}
    {@const buyerLists = savedLists.filter((list) => list.kind === "buyer")}
    {@const sellerLists = savedLists.filter((list) => list.kind === "seller")}
    <section class="grid gap-4 md:grid-cols-2">
      <div class={`${panelClass} grid gap-3 content-start`}>
        <h2 class="text-xl font-bold">{$t("matcher.lookingFor")}</h2>
        {@render ListColumn(buyerLists)}
      </div>
      <div class={`${panelClass} grid gap-3 content-start`}>
        <h2 class="text-xl font-bold">{$t("matcher.selling")}</h2>
        {@render ListColumn(sellerLists)}
      </div>
    </section>
  {:catch}
    <section class={`${panelClass} text-red-200`}>
      {$t("matcher.loadSavedListsFailed")}
    </section>
  {/await}

  {#if isAdmin}
    {#await adminUsersPromise}
      <section class={`${panelClass} grid gap-4`}>
        <div>
          <p class={eyebrowClass}>{$t("matcher.adminCompute")}</p>
          <h2 class="mt-1 text-xl font-bold">
            {$t("matcher.adminComputeTitle")}
          </h2>
          <div class="mt-2 grid gap-2" aria-hidden="true">
            <span class={`${skeletonBlockClass} h-4 w-80 max-w-full`}></span>
            <span class={`${skeletonBlockClass} h-4 w-60 max-w-full`}></span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4" aria-hidden="true">
          <span class={`${skeletonBlockClass} h-5 w-24`}></span>
          <span class={`${skeletonBlockClass} h-16 w-64`}></span>
        </div>
        <div
          class="grid gap-2 md:grid-cols-2 xl:grid-cols-3"
          aria-hidden="true"
        >
          {#each Array(6) as _}
            <div
              class="flex items-center gap-3 rounded border border-white/10 bg-stone-950/60 p-3"
            >
              <span class={`${skeletonBlockClass} size-4`}></span>
              <span class="grid flex-1 gap-2">
                <span class={`${skeletonBlockClass} h-4 w-32`}></span>
                <span class={`${skeletonBlockClass} h-3 w-28`}></span>
              </span>
            </div>
          {/each}
        </div>
        <span class={`${skeletonBlockClass} h-10 w-52`} aria-hidden="true"
        ></span>
      </section>
    {:then adminUsers}
      <section class={`${panelClass} grid gap-4`}>
        <div>
          <div>
            <p class={eyebrowClass}>{$t("matcher.adminCompute")}</p>
            <h2 class="mt-1 text-xl font-bold">
              {$t("matcher.adminComputeTitle")}
            </h2>
            <p class="text-stone-400">
              {$t("matcher.adminComputeDescription")}
            </p>
          </div>
        </div>
        <form
          class="grid gap-4"
          method="POST"
          action="?/adminSet"
          use:enhance={enhanceSubmit}
        >
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-sm text-stone-300">
              <input
                class="size-4 accent-primary-300"
                type="checkbox"
                on:change={toggleAllPeople}
                checked={adminUsers.length > 0 &&
                  selectedUserIds.length === adminUsers.length}
              />
              <span>{$t("matcher.selectAll")}</span>
            </label>

            <label class="grid min-w-64 gap-1">
              <span class="text-sm text-stone-300">{$t("matcher.searchMatchesAs")}</span>
              <select class={inputClass} name="focusUserId">
                <option value="" selected={!adminFocusUserId}
                  >{$t("matcher.groupOverlap")}</option
                >
                {#each adminUsers as user}
                  <option
                    value={user.id}
                    selected={adminFocusUserId === user.id}
                  >
                    {user.displayName || user.username}
                  </option>
                {/each}
              </select>
            </label>
          </div>

          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {#each adminUsers as user}
              <label
                class="flex items-center gap-3 rounded border border-white/10 bg-stone-950/60 p-3"
              >
                <input
                  class="size-4 accent-primary-300"
                  type="checkbox"
                  name="userIds"
                  value={user.id}
                  checked={selectedUserIds.includes(user.id)}
                />
                <span class="grid">
                  <strong>{user.displayName || user.username}</strong>
                  <small class="text-stone-400"
                    >{$t("matcher.userListCounts", {
                      buyerCount: user.lists.buyer,
                      sellerCount: user.lists.seller
                    })}</small
                  >
                </span>
              </label>
            {/each}
          </div>
          <div>
            <button
              class={buttonClass}
              type="submit"
              disabled={isSubmitting || adminUsers.length < 2}
            >
              <Icon name={isSubmitting ? "loader" : "search"} /> {isSubmitting ? $t("matcher.finding") : $t("matcher.computeSelectedPeople")}
            </button>
          </div>
        </form>
      </section>
    {:catch}
      <section class={`${panelClass} text-red-200`}>
        {$t("matcher.loadAccountsFailed")}
      </section>
    {/await}
  {/if}

  {#if form?.error}
    <section class={`${panelClass} text-red-200`}>
      <p>{form.error}</p>
      {#if form?.traceId}
        <p class="mt-2 text-sm text-stone-400">
          Trace ID: <code class="rounded bg-stone-950 px-2 py-1 text-primary-300"
            >{form.traceId}</code
          >
        </p>
      {/if}
    </section>
  {:else if form?.success}
    <section class={`${panelClass} text-primary-300`}>
      <p>{form.success}</p>
    </section>
  {/if}

  {#if accountOutput}
    <section class="grid gap-4">
      {@render MatchResult(
        "Sellers to contact",
        accountOutput.sellersToContact,
        "No sellers currently match your looking-for lists.",
      )}
      {@render MatchResult(
        "Buyers to contact",
        accountOutput.buyersToContact,
        "No buyers currently match your selling lists.",
      )}
    </section>
  {/if}

  {#if adminOutput}
    {@render CardListResult(
      "Selected people matches",
      adminOutput,
      "No exact card-name overlap found for the selected people.",
    )}
  {/if}

  {#if adminContactOutput}
    {#await adminUsersPromise then adminUsers}
      {@const adminFocusUser = adminUsers.find(
        (user) => user.id === adminFocusUserId,
      )}
      <section class="grid gap-4">
        {@render MatchResult(
          `Sellers to contact for ${adminFocusUser?.displayName || adminFocusUser?.username || "selected user"}`,
          adminContactOutput.sellersToContact,
          "No sellers currently match this user's looking-for lists.",
        )}
        {@render MatchResult(
          `Buyers to contact for ${adminFocusUser?.displayName || adminFocusUser?.username || "selected user"}`,
          adminContactOutput.buyersToContact,
          "No buyers currently match this user's selling lists.",
        )}
      </section>
    {/await}
  {/if}
</main>

{#snippet ListSkeleton()}
  <div class="grid gap-3" aria-hidden="true">
    {#each Array(3) as _}
      <div
        class="grid gap-2 rounded border border-white/10 bg-stone-950/60 p-3"
      >
        <span class={`${skeletonBlockClass} h-5 w-44 max-w-full`}></span>
        <span class={`${skeletonBlockClass} h-4 w-full`}></span>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet ListColumn(
  lists: Array<{ id: string; label: string | null; url: string }>,
)}
  {#if lists.length}
    {#each lists as list}
      <article
        class="flex items-center justify-between gap-3 rounded border border-white/10 bg-stone-950/60 p-3"
      >
        <a
          class="grid min-w-0 gap-1 text-stone-100 no-underline"
          href={list.url}
          target="_blank"
          rel="noreferrer"
        >
          <strong class="truncate">{list.label || list.url}</strong>
          <span class="truncate text-sm text-stone-400">{list.url}</span>
        </a>
        <form method="POST" action="?/deleteList">
          <input type="hidden" name="listId" value={list.id} />
          <button class="ui-icon-button ui-icon-danger" type="submit" aria-label={`${$t("matcher.delete")}: ${list.label || list.url}`} title={$t("matcher.delete")}><Icon name="trash" /></button>
        </form>
      </article>
    {/each}
  {:else}
    <p class="text-sm text-stone-400">{$t("matcher.noListsYet")}</p>
  {/if}
{/snippet}

{#snippet MatchListItems(
  items: Array<{ listName: string; url: string; quantity: number }>,
)}
  <div class="flex flex-wrap gap-2">
    {#each items as item}
      <a
        class="rounded bg-stone-950 px-2 py-1 text-xs text-primary-300 no-underline hover:underline"
        href={item.url}
        target="_blank"
        rel="noreferrer">{item.listName} ({item.quantity})</a
      >
    {/each}
  </div>
{/snippet}

{#snippet CardListResult(
  title: string,
  result: CardListMatchResult,
  empty: string,
)}
  <section class="grid gap-3 md:grid-cols-3">
    <article class={`${panelClass} grid gap-1`}>
      <span class="text-xs uppercase tracking-wider text-stone-400"
        >Matches</span
      >
      <strong class="text-2xl text-primary-300"
        >{result.totals.matchedCards}</strong
      >
      <small class="text-stone-400"
        >{result.totals.matchedQuantity} total copies</small
      >
    </article>
    <article class={`${panelClass} grid gap-1`}>
      <span class="text-xs uppercase tracking-wider text-stone-400"
        >Buyer demand</span
      >
      <strong class="text-2xl text-primary-300"
        >{result.totals.uniqueBuyerCards}</strong
      >
      <small class="text-stone-400"
        >{result.totals.buyerCards} copies across {result.totals.buyerLists} lists</small
      >
    </article>
    <article class={`${panelClass} grid gap-1`}>
      <span class="text-xs uppercase tracking-wider text-stone-400"
        >Seller supply</span
      >
      <strong class="text-2xl text-primary-300"
        >{result.totals.uniqueSellerCards}</strong
      >
      <small class="text-stone-400"
        >{result.totals.sellerCards} copies across {result.totals.sellerLists} lists</small
      >
    </article>
  </section>

  <section class="grid gap-4 md:grid-cols-2">
    <div class={`${panelClass} grid gap-2 content-start`}>
      <h2 class="text-xl font-bold">Buyers</h2>
      {#each result.buyers as list}
        <a
          class="grid rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline"
          href={list.url}
          target="_blank"
          rel="noreferrer"
        >
          <span class="truncate">{list.name}</span>
          <small class="text-stone-400"
            >{sourceLabel(list.source)} - {Object.keys(list.cards).length} cards</small
          >
        </a>
      {/each}
    </div>
    <div class={`${panelClass} grid gap-2 content-start`}>
      <h2 class="text-xl font-bold">Sellers</h2>
      {#each result.sellers as list}
        <a
          class="grid rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline"
          href={list.url}
          target="_blank"
          rel="noreferrer"
        >
          <span class="truncate">{list.name}</span>
          <small class="text-stone-400"
            >{sourceLabel(list.source)} - {Object.keys(list.cards).length} cards</small
          >
        </a>
      {/each}
    </div>
  </section>

  {@render MatchResult(title, result, empty)}
{/snippet}

{#snippet MatchWarnings(
  result: CardListMatchResult,
  traceId: string | undefined,
)}
  {#if result.warnings.length}
    <div
      class="grid gap-3 rounded border border-yellow-300/30 bg-yellow-950/30 p-3 text-sm text-yellow-100"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <strong
          >{result.warnings.length} list{result.warnings.length === 1
            ? ""
            : "s"} could not be loaded</strong
        >
        {#if traceId}
          <span class="text-xs text-stone-300"
            >Trace ID: <code
              class="rounded bg-stone-950 px-2 py-1 text-primary-300"
              >{traceId}</code
            ></span
          >
        {/if}
      </div>
      <p class="text-stone-300">
        The match was computed with the lists that loaded successfully.
      </p>
      <ul class="grid gap-2">
        {#each result.warnings as warning}
          <li class="grid gap-1">
            <a
              class="font-bold text-yellow-100 no-underline hover:underline"
              href={warning.url}
              target="_blank"
              rel="noreferrer"
            >
              {roleLabel(warning.role)}: {warning.listName}
            </a>
            <span class="text-stone-300">{warning.message}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/snippet}

{#snippet MatchResult(
  title: string,
  result: CardListMatchResult,
  empty: string,
)}
  <section class={`${panelClass} grid gap-3`}>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{title}</h2>
      <span class="rounded bg-stone-950 px-3 py-1 text-sm text-stone-300"
        >{result.matches.length} rows</span
      >
    </div>

    {@render MatchWarnings(result, form?.traceId)}

    {#if result.matches.length}
      <div class="overflow-auto rounded border border-white/10 bg-stone-950/50">
        <table class="w-full min-w-[760px] border-collapse text-sm">
          <thead
            class="bg-stone-900 text-xs uppercase tracking-wider text-stone-400"
          >
            <tr>
              <th class={tableCellClass}>Card</th>
              <th class={tableCellClass}>Matched</th>
              <th class={tableCellClass}>Buyers</th>
              <th class={tableCellClass}>Sellers</th>
            </tr>
          </thead>
          <tbody>
            {#each result.matches as match}
              <tr class="hover:bg-white/5">
                <td class={tableCellClass}>
                  <strong>{match.card}</strong>
                  <small class="block text-stone-400"
                    >{match.buyerQuantity} wanted / {match.sellerQuantity} available</small
                  >
                </td>
                <td class={tableCellClass}>{match.matchedQuantity}</td>
                <td class={tableCellClass} title={listNames(match.buyers)}
                  >{@render MatchListItems(match.buyers)}</td
                >
                <td class={tableCellClass} title={listNames(match.sellers)}
                  >{@render MatchListItems(match.sellers)}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="text-sm text-stone-400">{empty}</p>
    {/if}
  </section>
{/snippet}
