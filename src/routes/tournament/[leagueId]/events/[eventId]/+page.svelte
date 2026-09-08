<script lang="ts">
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n';
  import { scorePlacements } from '$lib/tournament';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TournamentRules from '$lib/components/TournamentRules.svelte';
  import TournamentCommanderPicker from '$lib/components/TournamentCommanderPicker.svelte';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
  let ranks: Record<string, string | number | undefined> = {};
  let commanders: Record<string, string> = {};
  let loadedVersion = '';
  let saving = false;
  $: if (loadedVersion !== `${data.event.id}:${data.event.revision}`) {
    ranks = Object.fromEntries(data.results.map((row) => [row.memberId, row.rank]));
    commanders = Object.fromEntries(data.results.map((row) => [row.memberId, row.commanders]));
    loadedVersion = `${data.event.id}:${data.event.revision}`;
  }
  $: preview = getPreview(ranks);
  $: participantCount = Object.values(ranks).filter((rank) => rank !== undefined && String(rank).trim()).length;
  function getPreview(values: typeof ranks) {
    try { return scorePlacements(Object.entries(values).filter(([, rank]) => rank !== undefined && String(rank).trim())
      .map(([memberId, rank]) => ({ memberId, rank: Number(rank) }))); }
    catch { return null; }
  }
</script>

<svelte:head><title>{data.event.name} - {data.league.name} - Karton</title></svelte:head>
<main class="t-page">
  <a class="t-muted" href={`/tournament/${data.league.id}`}>← {$t('tournament.viewLeague')} · {data.league.name}</a>
  <PageHeader title={data.event.name} subtitle={`${data.event.eventDate} · ${data.league.name}`}>
    <span slot="actions" class="t-badge">{$t(data.event.status === 'published' ? 'tournament.published' : 'tournament.draft')}</span>
  </PageHeader>
  {#if form && 'error' in form}<div class="t-error" role="alert"><p>{form.error}</p><a class="underline" href={`/tournament/${data.league.id}/events/${data.event.id}`} data-sveltekit-reload>{$t('tournament.reload')}</a></div>{/if}
  {#if form && 'success' in form}<p class="t-success" role="status">{$t('tournament.saved')}</p>{/if}
  {#if data.league.archived}<p class="t-panel t-muted">{$t('tournament.archiveHint')}</p>{/if}

  {#if data.event.status === 'published'}
    <section class="t-panel t-stack">
      <div class="t-row t-between"><h2 class="t-heading">{$t('tournament.results')}</h2><span class="t-muted">{data.results.length} {$t('tournament.participants')}</span></div>
      <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.results')}>
        <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
        <tbody>{#each data.results as result}<tr><td class="font-bold" class:t-accent={result.rank <= 3}>#{result.rank}</td><td>{result.name}{#if result.commanders}<span class="block t-muted mt-1">{result.commanders}</span>{/if}</td><td class="font-bold">+{result.points}</td></tr>{/each}</tbody>
      </table></div>
    </section>
  {:else if !data.admin}<p class="t-panel t-muted">{$t('tournament.noResults')}</p>{/if}

  {#if data.admin && !data.league.archived}
    {#key loadedVersion}
      <form method="POST" action="?/save" class="t-stack" use:enhance={() => {
        saving = true;
        return async ({ update }) => { try { await update({ reset: false }); } finally { saving = false; } };
      }}>
        <input type="hidden" name="revision" value={data.event.revision} />
        <section class="t-panel t-stack">
          <h2 class="t-heading">{$t(data.event.status === 'published' ? 'tournament.editPublished' : 'tournament.editResults')}</h2>
          <div class="t-grid">
            <label class="t-label">{$t('tournament.name')}<input class="t-input" name="name" value={data.event.name} required maxlength="120" /></label>
            <label class="t-label">{$t('tournament.eventDate')}<input class="t-input" name="eventDate" type="date" value={data.event.eventDate} min={data.league.startsOn} max={data.league.endsOn} required /></label>
          </div>
          <p class="t-muted">{$t('tournament.entryHelp')}</p>
          <p class="t-muted">{$t('tournament.commandersHelp')}</p>
          <div class="t-grid">
            {#each data.roster as member}
              <div class="t-stack content-start rounded border border-white/10 p-3">
                <label class="t-row t-between">
                <span class="min-w-0 flex-1 break-words">{member.name}{#if !member.active || !member.userId}<small class="block t-muted">{$t('tournament.former')}</small>{/if}</span>
                <input class="t-input !w-24" name={`rank:${member.id}`} type="number" min="1" max={data.roster.length} step="1" placeholder="—" bind:value={ranks[member.id]} aria-label={`${member.name} — ${$t('tournament.rank')}`} />
                </label>
                <TournamentCommanderPicker memberId={member.id} playerName={member.name}
                  bind:value={commanders[member.id]} disabled={!ranks[member.id]} />
              </div>
            {:else}<p class="t-muted">{$t('tournament.noEligible')}</p>{/each}
          </div>
        </section>
        <section class="t-panel t-stack" aria-live="polite">
          <div class="t-row t-between"><h2 class="t-heading">{$t('tournament.preview')}</h2><span class="t-muted">{participantCount} {$t('tournament.participants')}</span></div>
          <p class="t-muted">{$t('tournament.previewHelp')}</p>
          {#if preview === null}<p class="t-error">{$t('tournament.invalidRanks')}</p>
          {:else if preview.length}
            <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.preview')}>
              <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
              <tbody>{#each preview as row}<tr><td>#{row.rank}</td><td>{data.roster.find((member) => member.id === row.memberId)?.name}{#if commanders[row.memberId]}<span class="block t-muted mt-1">{commanders[row.memberId]}</span>{/if}</td><td class="font-bold t-accent">+{row.points}</td></tr>{/each}</tbody>
            </table></div>
          {/if}
          {#if participantCount < 2}<p class="t-muted">{$t('tournament.minPlayers')}</p>{/if}
          {#if data.event.status === 'published'}
            <label class="t-label">{$t('tournament.reason')}<textarea class="t-input" name="reason" rows="2" maxlength="1000" required></textarea></label>
          {/if}
          <div class="t-row">
            <button class="t-button" type="submit" name="status" value="published" disabled={saving || !preview || participantCount < 2}>{$t(saving ? 'tournament.saving' : data.event.status === 'published' ? 'tournament.saveCorrections' : 'tournament.publish')}</button>
            <button class="t-button t-button-secondary" type="submit" name="status" value="draft" disabled={saving || !preview}>{$t(data.event.status === 'published' ? 'tournament.unpublish' : 'tournament.saveDraft')}</button>
          </div>
        </section>
      </form>
    {/key}
  {/if}
  <TournamentRules />
  {#if data.admin}
    <section class="t-stack">
      <h2 class="t-heading">{$t('tournament.history')}</h2>
      {#each data.history as change}
        <details class="t-panel">
          <summary><span class="font-bold">{$t('tournament.revision')} {change.revision}</span> · {change.actorName} · {$t(change.snapshot.status === 'published' ? 'tournament.published' : 'tournament.draft')}<span class="block t-muted mt-1">{new Date(change.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</span></summary>
          <div class="t-stack mt-4">
            <p>{change.reason || (change.revision === 0 ? $t('tournament.initialDraft') : '—')}</p>
            <p class="t-muted">{change.snapshot.name} · {change.snapshot.eventDate}</p>
            <div class="t-table-wrap"><table class="t-table">
              <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th></tr></thead>
              <tbody>{#each change.snapshot.results as row}<tr><td>#{row.rank}</td><td>{row.name}{#if row.commanders}<span class="block t-muted mt-1">{row.commanders}</span>{/if}</td><td>{row.points}</td></tr>{/each}</tbody>
            </table></div>
          </div>
        </details>
      {/each}
    </section>
  {/if}
</main>
