<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import type { CommanderCard } from '$lib/commanders';

  export let id: string;
  export let label: string;
  export let value = '';
  export let disabled = false;
  export let withId: string | undefined = undefined;
  export let onresolve: (card: CommanderCard | null, selected: boolean) => void = () => {};
  export let onedit: () => void = () => {};
  export let onfailure: () => void = () => {};
  let cards: CommanderCard[] = [];
  let open = false;
  let focused = false;
  let loading = false;
  let failed = false;
  let searched = false;
  let active = -1;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout>;
  let controller: AbortController | undefined;
  let input: HTMLInputElement;
  let above = false;
  let menuHeight = 272;
  let previousWith = withId;
  $: if (previousWith !== withId) {
    previousWith = withId;
    cancel();
    cards = []; open = false; searched = false;
  }
  function cancel() { generation++; clearTimeout(timer); controller?.abort(); loading = false; }
  function positionMenu() {
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = rect.top - (viewport?.offsetTop ?? 0);
    const bottom = (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - rect.bottom;
    above = bottom < 180 && top > bottom;
    menuHeight = Math.max(80, Math.min(272, (above ? top : bottom) - 16));
  }
  async function lookup(params: URLSearchParams) {
    controller = new AbortController();
    const response = await fetch(`/tournament/commanders?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Commander lookup failed');
    return response.json();
  }
  async function resolveName() {
    cancel();
    if (!value.trim()) { onresolve(null, false); return; }
    const version = generation;
    try {
      const result = await lookup(new URLSearchParams({ name: value.trim() }));
      if (version === generation) { failed = false; onresolve(result.card, false); }
    } catch {
      if (version === generation) { failed = true; onfailure(); }
    }
  }
  async function search() {
    cancel();
    if (disabled || (!withId && value.trim().length < 2)) { cards = []; open = false; return; }
    const version = generation;
    loading = true; failed = false; searched = false; active = -1;
    try {
      const params = new URLSearchParams({ q: value.trim() });
      if (withId) params.set('with', withId);
      const result = await lookup(params);
      if (version !== generation) return;
      cards = result.cards; searched = true; positionMenu(); open = focused;
      const exact = cards.find((card) => card.name.toLowerCase() === value.trim().toLowerCase());
      if (exact) onresolve(exact, false);
    } catch {
      if (version === generation) { failed = true; cards = []; open = false; onfailure(); }
    } finally { if (version === generation) loading = false; }
  }
  function edit(event: Event) {
    value = (event.currentTarget as HTMLInputElement).value;
    cancel(); cards = []; open = false; failed = false; searched = false;
    onedit();
    timer = setTimeout(search, 300);
  }
  function choose(card: CommanderCard) {
    cancel(); value = card.name; open = false; failed = false; searched = false;
    onresolve(card, true); input.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { cancel(); open = false; return; }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && cards.length) {
      event.preventDefault(); positionMenu(); open = true;
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : cards.length - 1)
        : (active + (event.key === 'ArrowDown' ? 1 : -1) + cards.length) % cards.length;
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault(); choose(cards[active]);
    }
  }
  onMount(() => {
    if (value) void resolveName();
    window.visualViewport?.addEventListener('resize', positionMenu);
    return () => window.visualViewport?.removeEventListener('resize', positionMenu);
  });
  onDestroy(cancel);
</script>

<div class="commander-autocomplete">
  <label class="t-label" for={id}>{label}</label>
  <div class="commander-input">
  <input bind:this={input} {id} class="t-input" bind:value {disabled} maxlength="150"
    placeholder={$t('tournament.commanderSearch')} autocomplete="off" spellcheck="false"
    role="combobox" aria-autocomplete="list" aria-expanded={open && cards.length > 0}
    aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    aria-describedby={`${id}-status`} on:input={edit} on:keydown={keydown}
    on:focus={() => { focused = true; if (!disabled && (withId || value.length >= 2)) timer = setTimeout(search, 150); }}
    on:blur={() => { focused = false; open = false; void resolveName(); }} />
  {#if open && cards.length}
    <ul id={`${id}-list`} class="commander-options" class:above style:max-height={`${menuHeight}px`} role="listbox" aria-label={label}>
      {#each cards as card, index}
        <li id={`${id}-option-${index}`} role="option" aria-selected={index === active} tabindex="-1"
          class:active={index === active} on:mousedown|preventDefault on:click={() => choose(card)}
          on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); choose(card); } }}>
          <span>{card.name}</span><small>{card.typeLine}</small>
        </li>
      {/each}
    </ul>
  {/if}
  </div>
  <span id={`${id}-status`} class="t-muted commander-status" role="status">
    {#if failed}{$t('tournament.commanderUnavailable')}
    {:else if loading}{$t('tournament.commanderLoading')}
    {:else if focused && searched && !cards.length}{$t('tournament.commanderNoResults')}{/if}
  </span>
</div>

<style>
  .commander-autocomplete { min-width: 0; }
  .commander-input { position: relative; margin-top: .4rem; }
  .commander-options { position: absolute; z-index: 20; top: calc(100% + .35rem); left: 0; right: 0; overflow-y: auto; overscroll-behavior: contain; background: #1c1917; border: 1px solid #78716c; border-radius: .5rem; box-shadow: 0 12px 24px #0006; padding: .25rem; }
  .commander-options.above { top: auto; bottom: calc(100% + .35rem); }
  .commander-options li { cursor: pointer; padding: .55rem .65rem; border-radius: .25rem; overflow-wrap: anywhere; }
  .commander-options li:hover, .commander-options li.active { background: #c9381433; color: #ffc8b8; }
  .commander-options small { display: block; color: #a8a29e; margin-top: .2rem; }
  .commander-status { display: block; min-height: 1.1rem; font-size: .75rem; }
</style>
