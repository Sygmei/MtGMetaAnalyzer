<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TournamentRules from '$lib/components/TournamentRules.svelte';
  import type { PageData, ActionData } from './$types';
  export let data: PageData;
  export let form: ActionData;
  $: activeIds = new Set(data.roster.filter((member) => member.active).map((member) => member.userId));
  $: availableAccounts = data.accounts.filter((account) => !activeIds.has(account.id));
</script>

<svelte:head><title>{data.league.name} - Karton</title></svelte:head>
<main class="t-page">
  <a href="/tournament" class="t-muted">← {$t('tournament.back')}</a>
  <PageHeader title={data.league.name} subtitle={data.league.description || `${data.league.startsOn} → ${data.league.endsOn}`}>
    <div slot="actions" class="t-stack">
      <span class="t-badge">{$t(data.league.archived ? 'tournament.archived' : 'tournament.active')}</span>
      {#if data.league.description}<p class="t-muted">{data.league.startsOn} → {data.league.endsOn}</p>{/if}
    </div>
  </PageHeader>
  {#if form && 'error' in form}<p class="t-error" role="alert">{form.error}</p>{/if}
  {#if form && 'success' in form}<p class="t-success" role="status">{$t('tournament.saved')}</p>{/if}
  {#if data.league.archived}<p class="t-panel t-muted">{$t('tournament.archiveHint')}</p>{/if}

  {#if data.mine}
    <section class="t-panel t-stack">
      <h2 class="t-heading">{$t('tournament.myProgress')}</h2>
      <div class="grid grid-cols-3 gap-3">
        <div><p class="t-stat t-accent">#{data.mine.rank}</p><p class="t-muted">{$t('tournament.rank')}</p></div>
        <div><p class="t-stat">{data.mine.points}</p><p class="t-muted">{$t('tournament.points')}</p></div>
        <div><p class="t-stat">{data.mine.attendance}</p><p class="t-muted">{$t('tournament.attendance')}</p></div>
      </div>
      {#if data.myHistory.length}
        <div class="t-table-wrap"><table class="t-table">
          <thead><tr><th>{$t('tournament.event')}</th><th class="hidden sm:table-cell">{$t('tournament.date')}</th><th>{$t('tournament.rank')}</th><th>{$t('tournament.points')}</th></tr></thead>
          <tbody>{#each data.myHistory as result}<tr>
            <td><a class="font-bold" href={`/tournament/${data.league.id}/events/${result.eventId}`}>{result.eventName}</a>{#if result.commanders}<span class="block t-muted mt-1">{result.commanders}</span>{/if}<span class="block t-muted sm:hidden">{result.eventDate}</span></td>
            <td class="hidden whitespace-nowrap sm:table-cell">{result.eventDate}</td><td>#{result.rank}</td><td class="font-bold t-accent">+{result.points}</td>
          </tr>{/each}</tbody>
        </table></div>
      {:else}<p class="t-muted">{$t('tournament.noProgress')}</p>{/if}
    </section>
  {/if}

  <section class="t-panel t-stack">
    <h2 class="t-heading">{$t('tournament.standings')}</h2>
    {#if data.standings.length}
      <div class="t-table-wrap"><table class="t-table" aria-label={$t('tournament.standings')}>
        <thead><tr><th>{$t('tournament.rank')}</th><th>{$t('tournament.player')}</th><th>{$t('tournament.points')}</th><th>{$t('tournament.attendance')}</th></tr></thead>
        <tbody>{#each data.standings as row}<tr class:t-me={data.mine?.memberId === row.memberId}>
          <td class="font-bold" class:t-accent={row.rank <= 3}>#{row.rank}</td>
          <td><span class="font-bold">{row.name}</span> {#if data.mine?.memberId === row.memberId}<span class="t-badge">{$t('tournament.you')}</span>{/if}
            {#if !row.active || !row.userId}<span class="t-muted"> · {$t('tournament.former')}</span>{/if}</td>
          <td class="font-bold tabular-nums">{row.points}</td><td>{row.attendance}</td>
        </tr>{/each}</tbody>
      </table></div>
    {:else}<p class="t-muted">{$t('tournament.noStandings')}</p>{/if}
  </section>

  <section class="t-stack">
    <h2 class="t-heading">{$t('tournament.events')}</h2>
    <div class="t-grid">{#each data.events as event}
      <a class="t-panel t-stack no-underline hover:border-primary-300/60" href={`/tournament/${data.league.id}/events/${event.id}`}>
        <div class="t-row t-between"><span class="t-muted">{event.eventDate}</span><span class="t-badge">{$t(event.status === 'published' ? 'tournament.published' : 'tournament.draft')}</span></div>
        <h3 class="font-bold text-lg break-words">{event.name}</h3>
      </a>
    {:else}<p class="t-panel t-muted">{$t('tournament.noEvents')}</p>{/each}</div>
  </section>
  <TournamentRules />

  {#if data.admin}
    {#if !data.league.archived}
      <div class="t-grid items-start">
        <section class="t-panel t-stack">
          <h2 class="t-heading">{$t('tournament.newEvent')}</h2>
          <form method="POST" action="?/createEvent" use:enhance class="t-stack">
            <label class="t-label">{$t('tournament.name')}<input class="t-input" name="name" required maxlength="120" /></label>
            <label class="t-label">{$t('tournament.eventDate')}<input class="t-input" name="eventDate" type="date" min={data.league.startsOn} max={data.league.endsOn} required /></label>
            <div><button type="submit" class="t-button"><Icon name="plus" />{$t('tournament.createEvent')}</button></div>
          </form>
        </section>
        <section class="t-panel t-stack">
          <h2 class="t-heading">{$t('tournament.managePlayers')}</h2>
          <form method="POST" action="?/addMember" use:enhance class="t-stack">
            <label class="t-label">{$t('tournament.player')}
              <select class="t-input" name="userId" required><option value="">{$t('tournament.selectPlayer')}</option>
                {#each availableAccounts as account}<option value={account.id}>{account.name} (@{account.username})</option>{/each}
              </select>
            </label>
            <div><button class="t-button" type="submit" disabled={!availableAccounts.length}><Icon name="plus" />{$t('tournament.addPlayer')}</button></div>
          </form>
          <p class="t-muted">{$t('tournament.preserveResults')}</p>
          <ul class="t-stack">{#each data.roster.filter((member) => member.active && member.userId) as member}
            <li class="t-row t-between"><span class="break-words min-w-0">{member.name}</span>
              <form method="POST" action="?/removeMember" use:enhance>
                <input type="hidden" name="memberId" value={member.id} />
                <button type="submit" class="ui-icon-button ui-icon-danger" aria-label={`${$t('tournament.removePlayer')} ${member.name}`} title={$t('tournament.removePlayer')}><Icon name="trash" /></button>
              </form>
            </li>
          {/each}</ul>
        </section>
      </div>
    {/if}
    <details class="t-panel">
      <summary class="t-heading">{$t('tournament.settings')}</summary>
      <form method="POST" action="?/settings" use:enhance class="t-stack mt-4">
        <label class="t-label">{$t('tournament.name')}<input class="t-input" name="name" value={data.league.name} required maxlength="120" /></label>
        <label class="t-label">{$t('tournament.description')}<textarea class="t-input" name="description" rows="3" maxlength="3000">{data.league.description}</textarea></label>
        <div class="t-grid">
          <label class="t-label">{$t('tournament.startDate')}<input class="t-input" name="startsOn" type="date" value={data.league.startsOn} required /></label>
          <label class="t-label">{$t('tournament.endDate')}<input class="t-input" name="endsOn" type="date" value={data.league.endsOn} required /></label>
        </div>
        <label class="t-row text-sm"><input name="archived" type="checkbox" checked={data.league.archived} />{$t('tournament.archiveLeague')}</label>
        <div><button class="t-button" type="submit"><Icon name="save" />{$t('tournament.save')}</button></div>
      </form>
    </details>
  {/if}
</main>
