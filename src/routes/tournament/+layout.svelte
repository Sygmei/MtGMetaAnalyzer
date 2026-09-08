<div class="tournament"><slot /></div>

<style>
  .tournament :global(.t-page) { width: min(1100px, 94vw); margin: 0 auto; display: grid; gap: 1.5rem; padding: 1.5rem 0 4rem; }
  .tournament :global(.t-panel) { border: 1px solid #ffffff18; border-radius: .5rem; background: #1c1917b3; padding: 1.25rem; min-width: 0; }
  .tournament :global(.t-stack) { display: grid; gap: 1rem; }
  .tournament :global(.t-grid) { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr)); gap: 1rem; }
  .tournament :global(.t-row) { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
  .tournament :global(.t-between) { justify-content: space-between; }
  .tournament :global(.t-label) { display: grid; gap: .4rem; font-size: .875rem; color: #d6d3d1; }
  .tournament :global(.t-input) { width: 100%; min-width: 0; border: 1px solid #ffffff26; background: #0c0a09; padding: .625rem .75rem; border-radius: .25rem; color: #f5f5f4; }
  .tournament :global(.t-button) { display: inline-flex; align-items: center; justify-content: center; border-radius: .25rem; background: #c93814; padding: .625rem 1rem; color: #fff5f2; font-weight: 700; cursor: pointer; text-decoration: none; }
  .tournament :global(.t-button-secondary) { background: transparent; border: 1px solid #ffffff30; color: #e7e5e4; }
  .tournament :global(button:disabled) { opacity: .45; cursor: not-allowed; }
  .tournament :global(.t-muted) { color: #a8a29e; font-size: .875rem; line-height: 1.6; }
  .tournament :global(.t-heading) { font-size: 1.25rem; font-weight: 800; }
  .tournament :global(.t-badge) { display: inline-block; padding: .2rem .5rem; border: 1px solid #ffffff26; border-radius: .25rem; font-size: .75rem; color: #d6d3d1; }
  .tournament :global(.t-accent) { color: #ffc8b8; }
  .tournament :global(.t-table-wrap) { overflow-x: auto; }
  .tournament :global(.t-table) { width: 100%; border-collapse: collapse; text-align: left; font-size: .875rem; }
  .tournament :global(.t-table th) { color: #a8a29e; font-weight: 500; white-space: nowrap; }
  .tournament :global(.t-table th), .tournament :global(.t-table td) { padding: .75rem .5rem; border-bottom: 1px solid #ffffff0d; }
  .tournament :global(.t-table tr:last-child td) { border-bottom: 0; }
  .tournament :global(.t-me) { background: #c938141a; }
  .tournament :global(.t-stat) { font-size: 2rem; font-weight: 900; font-variant-numeric: tabular-nums; }
  .tournament :global(.t-error) { border: 1px solid #fca5a580; background: #450a0a80; padding: .75rem; border-radius: .25rem; color: #fecaca; }
  .tournament :global(.t-success) { color: #bbf7d0; }
  .tournament :global(summary) { cursor: pointer; }
  .tournament :global(a:hover) { color: #ffc8b8; }
  .tournament :global(input:focus-visible), .tournament :global(select:focus-visible), .tournament :global(textarea:focus-visible), .tournament :global(button:focus-visible), .tournament :global(a:focus-visible) { outline: 2px solid #ffc8b8; outline-offset: 3px; }
  @media (max-width: 639px) {
    .tournament :global(.t-table th), .tournament :global(.t-table td) { padding: .625rem .25rem; }
    .tournament :global(.t-table th) { white-space: normal; }
    .tournament :global(.t-table td) { overflow-wrap: anywhere; }
  }
</style>
