<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { enhance } from "$app/forms";
  import PageHeader from "$lib/components/PageHeader.svelte";

  type AdminUser = {
    id: string;
    username: string;
    displayName?: string | null;
    role: string;
  };

  type PreviousAnalysis = {
    shareId: string;
    moxfieldUrl: string;
    commanderName: string | null;
    ignoreBefore: string | null;
    ignoreAfter: string | null;
    createdAt: string;
  };

  type SavedList = {
    id: string;
    kind: "buyer" | "seller";
    label: string | null;
    url: string;
  };

  type ManagedUserDetails = {
    user: AdminUser;
    analyses: PreviousAnalysis[];
    lists: SavedList[];
  };

  type ManagedSection = "information" | "analysis" | "lists";

  export let data: {
    currentUser: AdminUser;
    users: AdminUser[] | Promise<AdminUser[]>;
  };
  export let form:
    | {
        error?: string;
        success?: string;
        generatedLink?: {
          userId: string;
          connectionUrl: string;
          expiresAt: string;
          qrDataUrl: string;
          ttlMinutes?: number;
        };
      }
    | undefined;

  let creating = false;
  let selectedLoginLinkUserId = "";
  let dismissedGeneratedLinkUrl = "";
  let selectedManagedUserId = "";
  let activeManagedSection: ManagedSection = "information";
  let managedUserPromise: Promise<ManagedUserDetails> | null = null;
  let managedError = "";
  let managedSuccess = "";
  let savingManagedUser = false;
  let addingManagedList = false;

  $: activeGeneratedLink =
    form?.generatedLink &&
    dismissedGeneratedLinkUrl !== form.generatedLink.connectionUrl
      ? form.generatedLink
      : null;
  $: usersPromise = Promise.resolve(data.users ?? []);

  const createEnhance = () => {
    creating = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      await update();
      creating = false;
    };
  };

  const pageClass = "mx-auto grid w-[min(1100px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "ui-panel";
  const inputClass =
    "w-full rounded border border-white/15 bg-stone-950 px-3 py-2 text-stone-100";
  const buttonClass =
    "h-10 rounded bg-primary-300 px-4 py-2 font-bold text-stone-950 disabled:opacity-50";
  const ghostButtonClass =
    "h-10 rounded border border-white/15 bg-transparent px-4 py-2 font-bold text-stone-100";
  const eyebrowClass =
    "mb-1 text-xs font-extrabold uppercase tracking-widest text-amber-300";
  const skeletonBlockClass = "animate-pulse rounded bg-stone-950/80";
  const loginLinkTtlOptions = [
    { value: 5, label: "5 min" },
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "1 hour" },
    { value: 240, label: "4 hours" },
    { value: 1440, label: "1 day" },
  ];

  function formatTtl(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    if (minutes % 1440 === 0) {
      return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
    }
    return `${minutes} min`;
  }

  function openLoginLinkModal(userId: unknown): void {
    selectedLoginLinkUserId = String(userId || "");
  }

  function closeLoginLinkModal(): void {
    selectedLoginLinkUserId = "";
  }

  function dismissGeneratedLink(): void {
    dismissedGeneratedLinkUrl = activeGeneratedLink?.connectionUrl || "";
  }

  function openManageUser(userId: unknown): void {
    selectedManagedUserId = String(userId || "");
    activeManagedSection = "information";
    managedError = "";
    managedSuccess = "";
    refreshManagedUser();
  }

  function closeManageUser(): void {
    selectedManagedUserId = "";
    managedUserPromise = null;
    managedError = "";
    managedSuccess = "";
  }

  function refreshManagedUser(): void {
    if (!selectedManagedUserId) return;
    managedUserPromise = fetchJson<ManagedUserDetails>(`/admin/users/${encodeURIComponent(selectedManagedUserId)}`);
  }

  function refreshUsers(): void {
    usersPromise = fetchJson<AdminUser[]>("/admin/users");
  }

  function canEditRole(user: AdminUser): boolean {
    return data.currentUser.role === "superadmin" && user.id !== data.currentUser.id && user.role !== "superadmin";
  }

  function kindLabel(kind: "buyer" | "seller"): string {
    return kind === "buyer" ? "Looking for" : "Selling";
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  async function submitManagedInformation(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selectedManagedUserId) return;
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    savingManagedUser = true;
    managedError = "";
    managedSuccess = "";
    try {
      await fetchJson(`/admin/users/${encodeURIComponent(selectedManagedUserId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: String(formData.get("displayName") || ""),
          role: String(formData.get("role") || "")
        })
      });
      managedSuccess = "User updated.";
      refreshManagedUser();
      refreshUsers();
    } catch (error) {
      managedError = error instanceof Error ? error.message : "Could not update user.";
    } finally {
      savingManagedUser = false;
    }
  }

  async function submitManagedList(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!selectedManagedUserId) return;
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    addingManagedList = true;
    managedError = "";
    managedSuccess = "";
    try {
      await fetchJson(`/admin/users/${encodeURIComponent(selectedManagedUserId)}`, {
        method: "POST",
        body: JSON.stringify({
          kind: String(formData.get("kind") || "buyer"),
          label: String(formData.get("label") || ""),
          url: String(formData.get("url") || "")
        })
      });
      form.reset();
      managedSuccess = "List added.";
      refreshManagedUser();
    } catch (error) {
      managedError = error instanceof Error ? error.message : "Could not add list.";
    } finally {
      addingManagedList = false;
    }
  }

  async function deleteManagedList(listId: string): Promise<void> {
    if (!selectedManagedUserId || !listId) return;
    managedError = "";
    managedSuccess = "";
    try {
      await fetchJson(`/admin/users/${encodeURIComponent(selectedManagedUserId)}`, {
        method: "DELETE",
        body: JSON.stringify({ listId })
      });
      managedSuccess = "List deleted.";
      refreshManagedUser();
    } catch (error) {
      managedError = error instanceof Error ? error.message : "Could not delete list.";
    }
  }

  async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...options.headers
      }
    });
    if (!response.ok) {
      throw new Error((await response.text()) || "Request failed.");
    }
    return (await response.json()) as T;
  }
</script>

<svelte:head>
  <title>Admin - Karton</title>
</svelte:head>

<main class={pageClass}>
  <PageHeader
    title="User accounts"
    subtitle="Create, invite, and manage user records."
  >
    <form slot="actions" method="POST" action="/logout">
      <button class="ui-icon-button" type="submit" aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
    </form>
  </PageHeader>

  {#if form?.error}
    <p class={`${panelClass} text-red-200`}>{form.error}</p>
  {:else if form?.success}
    <p class={`${panelClass} text-primary-300`}>{form.success}</p>
  {/if}

  <section class={`${panelClass} grid gap-4`}>
    <h2 class="text-xl font-bold">Create user</h2>
    <form
      class="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end"
      method="POST"
      action="?/createUser"
      use:enhance={createEnhance}
    >
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Username</span>
        <input
          class={inputClass}
          name="username"
          placeholder="example: alex"
          required
        />
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Display name</span>
        <input class={inputClass} name="displayName" placeholder="Optional" />
      </label>
      <label class="grid gap-1">
        <span class="text-sm text-stone-300">Role</span>
        <select class={inputClass} name="role">
          {#if data.currentUser.role === "superadmin"}
            <option value="admin">Admin</option>
          {/if}
          <option value="user" selected>User</option>
        </select>
      </label>
      <button class={buttonClass} type="submit" disabled={creating}
        >{creating ? "Creating..." : "Create user"}</button
      >
    </form>
  </section>

  {#await usersPromise}
    <section class="grid gap-3 md:grid-cols-2" aria-hidden="true">
      {#each Array(6) as _}
        <article
          class={`${panelClass} flex items-center justify-between gap-4`}
        >
          <div class="grid min-w-0 flex-1 gap-2">
            <span class={`${skeletonBlockClass} h-5 w-40 max-w-full`}></span>
            <span class={`${skeletonBlockClass} h-4 w-28 max-w-full`}></span>
          </div>
          <div class="flex items-center gap-2">
            <span class={`${skeletonBlockClass} h-10 w-16`}></span>
            <span class={`${skeletonBlockClass} h-10 w-24`}></span>
          </div>
        </article>
      {/each}
    </section>
  {:then users}
    <section class="grid gap-3 md:grid-cols-2">
      {#each users as user}
        <article
          class={`${panelClass} flex items-center justify-between gap-4`}
        >
          <div>
            <strong class="block">{user.displayName || user.username}</strong>
            <span class="text-sm text-stone-400"
              >@{user.username} - {user.role}</span
            >
          </div>
          <div class="flex items-center gap-2">
            <button
              class="ui-icon-button" aria-label={`Manage ${user.displayName || user.username}`} title="Manage user"
              type="button"
              on:click={() => openManageUser(user.id)}><Icon name="settings" /></button
            >
            <button
              class="ui-icon-button" aria-label={`Login QR for ${user.displayName || user.username}`} title="Login QR"
              type="button"
              on:click={() => openLoginLinkModal(user.id)}><Icon name="qr" /></button
            >
            {#if user.id !== data.currentUser.id && user.role !== "superadmin"}
              <form method="POST" action="?/deleteUser">
                <input type="hidden" name="userId" value={String(user.id)} />
                <button class="ui-icon-button ui-icon-danger" type="submit" aria-label={`Delete ${user.displayName || user.username}`} title="Delete user"><Icon name="trash" /></button>
              </form>
            {/if}
          </div>
        </article>
      {/each}
    </section>
  {:catch}
    <section class={`${panelClass} text-red-200`}>
      Could not load user accounts.
    </section>
  {/await}
</main>

{#await usersPromise then users}
  {@const selectedLoginLinkUser = selectedLoginLinkUserId
    ? users.find((user) => user.id === selectedLoginLinkUserId)
    : null}
  {@const generatedUser = activeGeneratedLink
    ? users.find((user) => user.id === activeGeneratedLink.userId)
    : null}

  {#if selectedLoginLinkUser}
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <section class={`${panelClass} grid w-full max-w-md gap-4 shadow-2xl`}>
        <div>
          <p class={eyebrowClass}>Temporary access</p>
          <h2 class="text-xl font-bold">
            Create QR for {selectedLoginLinkUser.username}
          </h2>
          <p class="mt-1 text-sm text-stone-400">
            Choose how long this login link should remain usable.
          </p>
        </div>

        <form class="grid gap-4" method="POST" action="?/loginLink">
          <input
            type="hidden"
            name="userId"
            value={String(selectedLoginLinkUser.id)}
          />
          <label class="grid gap-1">
            <span class="text-sm text-stone-300">Expires after</span>
            <select class={inputClass} name="ttlMinutes">
              {#each loginLinkTtlOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <div class="flex justify-end gap-2">
            <button
              class={ghostButtonClass}
              type="button"
              on:click={closeLoginLinkModal}>Cancel</button
            >
            <button class={`${buttonClass} ui-action`} type="submit"><Icon name="qr" />Generate QR</button>
          </div>
        </form>
      </section>
    </div>
  {/if}

  {#if activeGeneratedLink}
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <section
        class={`${panelClass} grid w-full max-w-2xl gap-4 shadow-2xl md:grid-cols-[1fr_auto] md:items-center`}
      >
        <div class="grid gap-3">
          <p class={eyebrowClass}>Temporary access</p>
          <h2 class="text-xl font-bold">
            {generatedUser?.username ?? "Login link"}
          </h2>
          <p class="text-stone-400">
            Valid until {new Date(
              activeGeneratedLink.expiresAt,
            ).toLocaleString()}
            {#if activeGeneratedLink.ttlMinutes}
              ({formatTtl(activeGeneratedLink.ttlMinutes)})
            {/if}
          </p>
          <input
            class={inputClass}
            readonly
            value={activeGeneratedLink.connectionUrl}
          />
          <div>
            <button
              class="ui-icon-button" aria-label="Close" title="Close"
              type="button"
              on:click={dismissGeneratedLink}><Icon name="close" /></button
            >
          </div>
        </div>
        <img
          class="size-40 rounded bg-white p-2"
          src={activeGeneratedLink.qrDataUrl}
          alt="Temporary login QR code"
        />
      </section>
    </div>
  {/if}
{/await}

{#if managedUserPromise}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <section class="grid max-h-[90vh] w-full max-w-5xl overflow-hidden rounded border border-primary-100/20 bg-stone-950 shadow-2xl md:grid-cols-[220px_minmax(0,1fr)]">
      {#await managedUserPromise}
        <aside class="border-b border-white/10 bg-stone-900/80 p-4 md:border-b-0 md:border-r">
          <span class={`${skeletonBlockClass} block h-6 w-32`}></span>
          <span class={`${skeletonBlockClass} mt-3 block h-10 w-full`}></span>
          <span class={`${skeletonBlockClass} mt-2 block h-10 w-full`}></span>
          <span class={`${skeletonBlockClass} mt-2 block h-10 w-full`}></span>
        </aside>
        <div class="grid gap-4 p-5">
          <span class={`${skeletonBlockClass} h-8 w-48`}></span>
          <span class={`${skeletonBlockClass} h-40 w-full`}></span>
        </div>
      {:then managed}
        <aside class="grid content-start gap-3 border-b border-white/10 bg-stone-900/80 p-4 md:border-b-0 md:border-r md:border-white/10">
          <div>
            <p class={eyebrowClass}>Manage</p>
            <h2 class="text-lg font-black">{managed.user.displayName || managed.user.username}</h2>
            <p class="truncate text-sm text-stone-400">@{managed.user.username}</p>
          </div>
          <button class={`${activeManagedSection === "information" ? buttonClass : ghostButtonClass} w-full`} type="button" on:click={() => (activeManagedSection = "information")}>Informations</button>
          <button class={`${activeManagedSection === "analysis" ? buttonClass : ghostButtonClass} w-full`} type="button" on:click={() => (activeManagedSection = "analysis")}>Analysis</button>
          <button class={`${activeManagedSection === "lists" ? buttonClass : ghostButtonClass} w-full`} type="button" on:click={() => (activeManagedSection = "lists")}>Lists</button>
          <button class={`${ghostButtonClass} mt-2 w-full`} type="button" on:click={closeManageUser}>Close</button>
        </aside>

        <div class="grid max-h-[90vh] gap-4 overflow-auto p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class={eyebrowClass}>{activeManagedSection}</p>
              <h2 class="text-2xl font-black">{managed.user.displayName || managed.user.username}</h2>
            </div>
            <button class="ui-icon-button" type="button" on:click={closeManageUser} aria-label="Close" title="Close"><Icon name="close" /></button>
          </div>

          {#if managedError}
            <p class="rounded border border-red-300/20 bg-red-950/30 p-3 text-red-200">{managedError}</p>
          {:else if managedSuccess}
            <p class="rounded border border-primary-300/20 bg-primary-950/30 p-3 text-primary-200">{managedSuccess}</p>
          {/if}

          {#if activeManagedSection === "information"}
            <form class="grid gap-4" on:submit={submitManagedInformation}>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">Username</span>
                <input class={inputClass} value={managed.user.username} readonly />
              </label>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">Display name</span>
                <input class={inputClass} name="displayName" value={managed.user.displayName || ""} placeholder="Optional" />
              </label>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">Role</span>
                <select class={inputClass} name="role" disabled={!canEditRole(managed.user)}>
                  {#if data.currentUser.role === "superadmin"}
                    <option value="admin" selected={managed.user.role === "admin"}>Admin</option>
                  {/if}
                  <option value="user" selected={managed.user.role === "user"}>User</option>
                  {#if managed.user.role === "superadmin"}
                    <option value="superadmin" selected>Superadmin</option>
                  {/if}
                </select>
              </label>
              <div>
                <button class={buttonClass} type="submit" disabled={savingManagedUser}>
                  {savingManagedUser ? "Saving..." : "Save user"}
                </button>
              </div>
            </form>
          {:else if activeManagedSection === "analysis"}
            {#if managed.analyses.length}
              <div class="grid gap-2">
                {#each managed.analyses as analysis}
                  <a class="grid gap-1 rounded border border-white/10 bg-stone-900/80 p-3 text-stone-100 no-underline hover:border-primary-300/50" href={`/analysis/${analysis.shareId}`}>
                    <strong>{analysis.commanderName || "Deck analysis"}</strong>
                    <span class="truncate text-sm text-stone-400">{analysis.moxfieldUrl}</span>
                    <small class="text-stone-500">
                      {formatDate(analysis.createdAt)}
                      {#if analysis.ignoreBefore || analysis.ignoreAfter}
                        - {analysis.ignoreBefore || "start"} to {analysis.ignoreAfter || "now"}
                      {/if}
                    </small>
                  </a>
                {/each}
              </div>
            {:else}
              <p class="text-sm text-stone-400">No saved analyses.</p>
            {/if}
          {:else}
            <form class="grid gap-3 rounded border border-white/10 bg-stone-900/80 p-3 md:grid-cols-[150px_1fr_2fr_auto] md:items-end" on:submit={submitManagedList}>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">Type</span>
                <select class={inputClass} name="kind">
                  <option value="buyer">Looking for</option>
                  <option value="seller">Selling</option>
                </select>
              </label>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">Label</span>
                <input class={inputClass} name="label" placeholder="Optional" />
              </label>
              <label class="grid gap-1">
                <span class="text-sm text-stone-300">URL</span>
                <input class={inputClass} name="url" placeholder="Moxfield, Archidekt, ManaBox, Mythic Tools" required />
              </label>
              <button class={buttonClass} type="submit" disabled={addingManagedList}>
                {addingManagedList ? "Adding..." : "Add"}
              </button>
            </form>

            {#if managed.lists.length}
              <div class="grid gap-2">
                {#each managed.lists as list}
                  <article class="flex items-center justify-between gap-3 rounded border border-white/10 bg-stone-900/80 p-3">
                    <a class="grid min-w-0 text-stone-100 no-underline" href={list.url} target="_blank" rel="noreferrer">
                      <strong class="truncate">{list.label || list.url}</strong>
                      <span class="truncate text-sm text-stone-400">{kindLabel(list.kind)} - {list.url}</span>
                    </a>
                    <button class="ui-icon-button ui-icon-danger" type="button" on:click={() => deleteManagedList(list.id)} aria-label={`Delete ${list.label || list.url}`} title="Delete list"><Icon name="trash" /></button>
                  </article>
                {/each}
              </div>
            {:else}
              <p class="text-sm text-stone-400">No saved lists.</p>
            {/if}
          {/if}
        </div>
      {:catch error}
        <div class="grid gap-4 p-5">
          <p class="text-red-200">{error instanceof Error ? error.message : "Could not load user."}</p>
          <button class="ui-icon-button" type="button" on:click={closeManageUser} aria-label="Close" title="Close"><Icon name="close" /></button>
        </div>
      {/await}
    </section>
  </div>
{/if}
