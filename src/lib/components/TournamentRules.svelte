<script lang="ts">
  import { t } from '$lib/i18n';
</script>
<details class="t-panel">
  <summary class="font-bold">{$t('tournament.rules')}</summary>
  <div class="t-stack mt-4">
    <p class="font-mono text-sm t-accent">1 + floor(2.5 × log₂(N / rank))</p>
    <p class="t-muted">{$t('tournament.ruleDescription')}</p>
    <p class="t-muted">{$t('tournament.leagueRules')}</p>
  </div>
</details>
