<script lang="ts">
  import { t } from '$lib/i18n';
  import { compatibleCommanders, splitCommanders, type CommanderCard, type CommanderPairing } from '$lib/commanders';
  import CommanderAutocomplete from './CommanderAutocomplete.svelte';
  export let memberId: string;
  export let playerName: string;
  export let value = '';
  export let disabled = false;
  export let searchEndpoint = '/tournament/commanders';
  export let fieldName = `commanders:${memberId}`;
  let [primaryName, secondaryName] = splitCommanders(value ?? '');
  let primary: CommanderCard | null = null;
  let secondary: CommanderCard | null = null;
  let manualSecond = false;
  let lookupFailed = false;
  $: value = [primaryName.trim(), secondaryName.trim()].filter(Boolean).join(' + ');
  $: showSecond = Boolean(primary?.pairings.length || secondaryName || manualSecond);
  $: incompatible = primary && secondary && !compatibleCommanders(primary, secondary);
  function setPrimary(card: CommanderCard | null, selected: boolean) {
    primary = card; lookupFailed = false;
    // Existing results remain intact on hydration; an explicit new selection replaces an incompatible pair.
    if (selected && card && (!card.pairings.length || (secondaryName && (!secondary || !compatibleCommanders(card, secondary))))) {
      secondaryName = ''; secondary = null; manualSecond = false;
    }
  }
  function pairingLabel(pairing: CommanderPairing) {
    switch (pairing.kind) {
      case 'partner': return pairing.group ? `Partner—${pairing.group}` : 'Partner';
      case 'named': return `Partner with ${pairing.name}`;
      case 'choose-background': return $t('tournament.chooseBackground');
      case 'background': return $t('tournament.backgroundNeedsCommander');
      case 'doctor': return $t('tournament.addDoctorsCompanion');
      case 'doctors-companion': return $t('tournament.addDoctor');
    }
  }
</script>

<div class="t-stack grid gap-4 min-w-0" data-commander-picker={memberId}>
  <input type="hidden" name={fieldName} {value} {disabled} />
  <CommanderAutocomplete id={`commander-${memberId}`} label={`${playerName ? `${playerName} — ` : ''}${$t('tournament.commander')}`}
    bind:value={primaryName} {disabled} {searchEndpoint} onresolve={setPrimary} onfailure={() => lookupFailed = true}
    onedit={() => { primary = null; if (!primaryName.trim()) { secondaryName = ''; secondary = null; manualSecond = false; } }} />
  {#if primary?.pairings.length}<p class="t-muted text-sm">{primary.pairings.map(pairingLabel).join(' · ')}</p>{/if}
  {#if showSecond}
    <CommanderAutocomplete id={`commander-second-${memberId}`} label={`${playerName ? `${playerName} — ` : ''}${$t('tournament.secondCommander')}`}
      bind:value={secondaryName} {disabled} {searchEndpoint} withId={primary?.id}
      onresolve={(card) => secondary = card} onedit={() => secondary = null} />
  {:else if lookupFailed && primaryName}
    <button class="t-muted underline text-left text-sm" type="button" {disabled} on:click={() => manualSecond = true}>{$t('tournament.manualSecondCommander')}</button>
  {/if}
  {#if incompatible}<p class="t-muted text-sm" role="status">{$t('tournament.incompatibleCommanders')}</p>{/if}
</div>
