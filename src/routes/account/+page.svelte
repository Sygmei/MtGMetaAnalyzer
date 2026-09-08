<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";

  export let data: {
    currentUser: {
      username: string;
      displayName?: string | null;
      role: string;
    };
  };
  export let form:
    | {
        error?: string;
        success?: string;
        generatedLink?: {
          connectionUrl: string;
          expiresAt: string;
          qrDataUrl: string;
        };
      }
    | undefined;

  const pageClass = "mx-auto grid w-[min(900px,94vw)] gap-4 py-4 pb-12";
  const navClass = "flex flex-wrap items-center gap-3 text-sm";
  const panelClass = "ui-panel";
  const inputClass =
    "w-full rounded border border-white/15 bg-stone-950 px-3 py-2 text-stone-100";
  const eyebrowClass =
    "mb-1 text-xs font-extrabold uppercase tracking-widest text-amber-300";
</script>

<svelte:head>
  <title>My Account - Karton</title>
</svelte:head>

<main class={pageClass}>
  <PageHeader
    title={data.currentUser.displayName || data.currentUser.username}
    subtitle={`@${data.currentUser.username} - ${data.currentUser.role}`}
  >
    <div slot="actions" class="flex flex-wrap items-center gap-3">
      <form method="POST" action="?/loginLink">
        <button class="ui-icon-button" type="submit" aria-label="Login on another device" title="Login on another device"><Icon name="qr" /></button>
      </form>
      <form method="POST" action="/logout">
        <button class="ui-icon-button" type="submit" aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
      </form>
    </div>
  </PageHeader>

  {#if form?.error}
    <p class={`${panelClass} text-red-200`}>{form.error}</p>
  {:else if form?.success}
    <p class={`${panelClass} text-primary-300`}>{form.success}</p>
  {/if}

  {#if form?.generatedLink}
    <section
      class={`${panelClass} grid gap-4 md:grid-cols-[1fr_auto] md:items-center`}
    >
      <div class="grid gap-3">
        <p class={eyebrowClass}>Temporary access</p>
        <h2 class="text-xl font-bold">Login on another device</h2>
        <p class="text-stone-400">
          Valid until {new Date(form.generatedLink.expiresAt).toLocaleString()}
        </p>
        <input
          class={inputClass}
          readonly
          value={form.generatedLink.connectionUrl}
        />
      </div>
      <img
        class="size-36 rounded bg-white p-2"
        src={form.generatedLink.qrDataUrl}
        alt="Temporary login QR code"
      />
    </section>
  {/if}

  <section class={`${panelClass} grid gap-4`}>
    <div>
      <p class={eyebrowClass}>Profile</p>
      <h2 class="text-xl font-bold">Account</h2>
    </div>
    <form
      class="flex flex-wrap items-end gap-3"
      method="POST"
      action="?/updateProfile"
    >
      <label class="grid min-w-64 flex-1 gap-1">
        <span class="text-sm text-stone-300">Display name</span>
        <input
          class={inputClass}
          name="displayName"
          placeholder="Optional"
          value={data.currentUser.displayName || ""}
        />
      </label>
      <button class="ui-icon-button ui-icon-primary" type="submit" aria-label="Save account" title="Save account"><Icon name="save" /></button>
    </form>
  </section>
</main>
