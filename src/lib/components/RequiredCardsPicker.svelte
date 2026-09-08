<script lang="ts">
  import { t } from '$lib/i18n';
  import CardAutocomplete from './CardAutocomplete.svelte';
  import Icon from './Icon.svelte';

  export let value = '';
  export let disabled = false;
  $: selectedCards = value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);

  function addCard(card: { name: string; typeLine: string } | null, selected: boolean) {
    if (!selected || !card) return;
    if (!selectedCards.some((name) => name.toLowerCase() === card.name.toLowerCase())) {
      value = [...selectedCards, card.name].join('\n');
    }
  }

  function removeCard(card: string) {
    value = selectedCards.filter((name) => name !== card).join('\n');
  }
</script>

<div class="grid min-w-0 gap-2">
  <input type="hidden" name="requiredCards" {value} />
  <CardAutocomplete id="required-cards" label={$t('analyzer.cardNames')}
    {disabled} clearOnSelect onresolve={addCard} />
  {#if selectedCards.length}
    <ul class="flex flex-wrap gap-2" aria-label={$t('analyzer.requiredCards')}>
      {#each selectedCards as card}
        <li class="flex max-w-full items-center gap-1 rounded border border-white/15 bg-stone-950 px-2 py-1 text-sm">
          <span class="min-w-0 break-words">{card}</span>
          <button type="button" class="shrink-0 rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
            {disabled} aria-label={$t('analyzer.removeRequiredCard', { card })} on:click={() => removeCard(card)}>
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="text-xs text-stone-400">{$t('analyzer.requiredCardsHelp')}</p>
</div>
