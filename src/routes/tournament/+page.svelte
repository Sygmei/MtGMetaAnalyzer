<script lang="ts">
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TournamentRules from '$lib/components/TournamentRules.svelte';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
</script>

<svelte:head><title>{$t('tournament.title')} - Karton</title></svelte:head>
<main class="t-page">
  <PageHeader title={$t('tournament.title')} subtitle={$t('tournament.subtitle')} />
  {#if form?.error}<p role="alert" class="t-error">{form.error}</p>{/if}
  <section class="t-stack">
    <h2 class="t-heading">{$t('tournament.leagues')}</h2>
    <div class="t-grid">
      {#each data.leagues as league}
        <a class="t-panel t-stack no-underline transition hover:border-primary-300/60" href={`/tournament/${league.id}`}>
          <div class="t-row t-between">
            <span class="t-badge">{$t(league.archived ? 'tournament.archived' : 'tournament.active')}</span>
            {#if league.mine}<span class="t-badge t-accent">{$t('tournament.myLeague')}</span>{/if}
          </div>
          <h3 class="text-xl font-bold break-words">{league.name}</h3>
          <p class="t-muted">{league.startsOn} → {league.endsOn}</p>
          {#if league.description}<p class="t-muted line-clamp-3">{league.description}</p>{/if}
          <div class="t-row t-between">
            <span class="t-muted">{league.memberCount} {$t('tournament.members')}</span>
            {#if league.mine}<span class="font-bold t-accent">#{league.mine.rank} · {league.mine.points} {$t('tournament.points')}</span>{/if}
          </div>
        </a>
      {:else}<p class="t-panel t-muted">{$t('tournament.noLeagues')}</p>{/each}
    </div>
  </section>
  {#if data.admin}
    <details class="t-panel" open={data.leagues.length === 0 || Boolean(form?.error)}>
      <summary class="t-heading">{$t('tournament.newLeague')}</summary>
      <form method="POST" action="?/create" use:enhance class="t-stack mt-4">
        <label class="t-label">{$t('tournament.name')}<input class="t-input" name="name" required maxlength="120" /></label>
        <label class="t-label">{$t('tournament.description')}<textarea class="t-input" name="description" rows="3" maxlength="3000"></textarea></label>
        <div class="t-grid">
          <label class="t-label">{$t('tournament.startDate')}<input class="t-input" name="startsOn" type="date" required /></label>
          <label class="t-label">{$t('tournament.endDate')}<input class="t-input" name="endsOn" type="date" required /></label>
        </div>
        <div><button class="t-button" type="submit">{$t('tournament.createLeague')}</button></div>
      </form>
    </details>
  {/if}
  <TournamentRules />
</main>
