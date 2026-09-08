<script context="module" lang="ts">
  export type IconName = 'scan' | 'search' | 'users' | 'trophy' | 'plus' | 'minus' | 'check' | 'trash' | 'close' | 'settings' | 'qr' | 'logout' | 'save' | 'user' | 'calendar' | 'chevron' | 'loader' | 'publish';
</script>

<script lang="ts">
  export let name: IconName;
  export let size = 18;
  const paths: Record<IconName, string> = {
    scan: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M8 8h8v8H8z',
    search: 'M21 21l-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m4-3.87a4 4 0 0 1 0 7.75',
    trophy: 'M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v9m-4 0h8',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'm5 12 4 4L19 6',
    trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    close: 'm6 6 12 12M6 18 18 6',
    settings: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
    qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 14v3m-6 4h3m3-1v1',
    logout: 'M9 21H4V3h5m5 4 5 5-5 5m-6-5h11',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
    user: 'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z',
    chevron: 'm6 9 6 6 6-6', loader: 'M21 12a9 9 0 1 1-9-9',
    publish: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5'
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class:spinning={name === 'loader'}>
  <path d={paths[name]} />
</svg>

<style>
  svg { flex-shrink: 0; }
  .spinning { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
