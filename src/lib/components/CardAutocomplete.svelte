<script lang="ts" generics="Card extends { name: string; typeLine: string }">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '$lib/i18n';

  export let id: string;
  export let searchEndpoint = '/analyzer/cards';
  export let placeholder: string | undefined = undefined;
  export let unavailableMessage: string | undefined = undefined;
  export let emptyMessage: string | undefined = undefined;
  export let loadingMessage: string | undefined = undefined;
  export let clearOnSelect = false;
  export let resolveOnBlur = false;
  export let label: string;
  export let value = '';
  export let disabled = false;
  export let withId: string | undefined = undefined;
  export let onresolve: (card: Card | null, selected: boolean) => void = () => {};
  export let onedit: () => void = () => {};
  export let onfailure: () => void = () => {};
  let cards: Card[] = [];
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
    const response = await fetch(`${searchEndpoint}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Card lookup failed');
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
      const exactIndex = cards.findIndex((card) => card.name.toLowerCase() === value.trim().toLowerCase());
      active = clearOnSelect && cards.length ? Math.max(0, exactIndex) : -1;
      if (exactIndex >= 0 && resolveOnBlur) onresolve(cards[exactIndex], false);
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
  function choose(card: Card) {
    cancel(); value = clearOnSelect ? '' : card.name; open = false; failed = false; searched = false;
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
    } else if (event.key === 'Enter' && clearOnSelect) {
      event.preventDefault();
    }
  }
  onMount(() => {
    if (value && resolveOnBlur) void resolveName();
    window.visualViewport?.addEventListener('resize', positionMenu);
    return () => window.visualViewport?.removeEventListener('resize', positionMenu);
  });
  onDestroy(cancel);
</script>

<div class="commander-autocomplete">
  <label class="t-label" for={id}>{label}</label>
  <div class="commander-input">
  <input bind:this={input} {id} class="t-input" bind:value {disabled} maxlength="150"
    placeholder={placeholder ?? $t('analyzer.cardSearch')} autocomplete="off" spellcheck="false"
    role="combobox" aria-autocomplete="list" aria-expanded={open && cards.length > 0}
    aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
    aria-describedby={`${id}-status`} on:input={edit} on:keydown={keydown}
    on:focus={() => { focused = true; if (!disabled && (withId || value.length >= 2)) timer = setTimeout(search, 150); }}
    on:blur={() => { focused = false; open = false; if (resolveOnBlur) void resolveName(); }} />
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
    {#if failed}{unavailableMessage ?? $t('analyzer.cardSearchUnavailable')}
    {:else if loading}{loadingMessage ?? $t('analyzer.cardSearchLoading')}
    {:else if focused && searched && !cards.length}{emptyMessage ?? $t('analyzer.cardSearchNoResults')}{/if}
  </span>
</div>

<style>
  .commander-autocomplete { min-width: 0; }
  .t-label { display: grid; gap: .4rem; font-size: .875rem; color: #d6d3d1; }
  .t-input { width: 100%; min-width: 0; border: 1px solid #ffffff26; background: var(--canvas); padding: .625rem .75rem; border-radius: .375rem; color: #f5f5f4; }
  .t-muted { color: #a8a29e; }
  .commander-input { position: relative; margin-top: .4rem; }
  .commander-options { position: absolute; z-index: 20; top: calc(100% + .35rem); left: 0; right: 0; overflow-y: auto; overscroll-behavior: contain; background: #1c1917; border: 1px solid #78716c; border-radius: .5rem; box-shadow: 0 12px 24px #0006; padding: .25rem; }
  .commander-options.above { top: auto; bottom: calc(100% + .35rem); }
  .commander-options li { cursor: pointer; padding: .55rem .65rem; border-radius: .25rem; overflow-wrap: anywhere; }
  .commander-options li:hover, .commander-options li.active { background: #c9381433; color: #ffc8b8; }
  .commander-options small { display: block; color: #a8a29e; margin-top: .2rem; }
  .commander-status { display: block; min-height: 1.1rem; font-size: .75rem; }
</style>
