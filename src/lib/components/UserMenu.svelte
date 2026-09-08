<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { afterNavigate } from "$app/navigation";
  import { t } from "$lib/i18n";

  export let currentUser: { username?: string; displayName?: string | null; role?: string };
  let menu: HTMLDetailsElement;
  let trigger: HTMLElement;
  $: currentName = currentUser.displayName || currentUser.username || "";
  $: currentInitial = (currentName || "?").slice(0, 1).toUpperCase();

  afterNavigate(() => { if (menu) menu.open = false; });

  function closeOutside(event: PointerEvent) {
    if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && menu?.open) {
      menu.open = false;
      trigger?.focus();
    }
  }
</script>

<svelte:window on:pointerdown={closeOutside} on:keydown={onKeydown} />

<details class="user-menu" bind:this={menu}>
  <summary bind:this={trigger} aria-label={$t("nav.userMenu")} title={$t("nav.userMenu")}>
    <span class="avatar">{currentInitial}</span>
    <span class="username">{currentName}</span>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
  </summary>
  <div class="dropdown">
    <div class="identity"><strong>{currentName}</strong><small>{currentUser.username}</small></div>
    <a href="/account"><Icon name="user" />{$t("nav.account")}</a>
    {#if currentUser.role === "admin" || currentUser.role === "superadmin"}<a href="/admin"><Icon name="settings" />{$t("nav.admin")}</a>{/if}
    <form method="POST" action="/logout"><button type="submit"><Icon name="logout" />{$t("nav.signOut")}</button></form>
  </div>
</details>

<style>
  .user-menu { position: relative; flex-shrink: 0; }
  summary { display: flex; align-items: center; gap: 8px; min-height: 44px; list-style: none; color: var(--muted); font-size: 13px; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { color: var(--text); }
  .avatar { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); color: var(--text); font-size: 12px; font-weight: 600; }
  .username { max-width: 140px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .dropdown { position: absolute; right: 0; top: calc(100% + 8px); width: 240px; max-width: calc(100vw - 32px); padding: 6px; border: 1px solid #ffffff26; border-radius: 8px; background: var(--surface); box-shadow: 0 8px 24px #0004; }
  .identity { display: grid; gap: 4px; padding: 10px 10px 14px; margin-bottom: 4px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  .identity strong { font-size: 14px; font-weight: 600; }
  .identity small { color: var(--muted); font-size: 12px; }
  .dropdown a, button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 10px; border-radius: 4px; background: transparent; color: var(--text); font-size: 14px; text-align: left; text-decoration: none; }
  .dropdown a:hover, button:hover { background: #ffffff0a; }
  @media (max-width: 767px) { .username { display: none; } }
</style>
