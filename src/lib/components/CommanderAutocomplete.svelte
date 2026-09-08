<script lang="ts">
  import { t } from '$lib/i18n';
  import type { CommanderCard } from '$lib/commanders';
  import CardAutocomplete from './CardAutocomplete.svelte';

  export let id: string;
  export let searchEndpoint = '/tournament/commanders';
  export let label: string;
  export let value = '';
  export let disabled = false;
  export let withId: string | undefined = undefined;
  export let onresolve: (card: CommanderCard | null, selected: boolean) => void = () => {};
  export let onedit: () => void = () => {};
  export let onfailure: () => void = () => {};
</script>

<CardAutocomplete {id} {searchEndpoint} {label} bind:value {disabled} {withId}
  {onresolve} {onedit} {onfailure} resolveOnBlur
  placeholder={$t('tournament.commanderSearch')}
  unavailableMessage={$t('tournament.commanderUnavailable')}
  loadingMessage={$t('tournament.commanderLoading')}
  emptyMessage={$t('tournament.commanderNoResults')} />
