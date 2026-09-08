<script lang="ts">
  export let title: string;
  export let subtitle: string | undefined = undefined;
</script>

<section class="page-header">
  <div class="min-w-0">
    <h1>{title}</h1>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>
  {#if $$slots.actions}<div class="header-actions"><slot name="actions" /></div>{/if}
</section>

<style>
  .page-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 20px; padding: 8px 0 12px; }
  h1 { color: var(--text); font-size: 28px; font-weight: 600; line-height: 1.25; letter-spacing: -.025em; }
  p { margin-top: 8px; max-width: 640px; color: var(--muted); font-size: 14px; line-height: 1.6; }
  .header-actions { min-width: 0; }
  @media (max-width: 639px) { h1 { font-size: 24px; } }
</style>
