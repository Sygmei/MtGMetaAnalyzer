<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';

  onMount(() => {
    void initFaro();
  });

  async function initFaro(): Promise<void> {
    if (!isEnabled(env.PUBLIC_FARO_ENABLED)) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const url = (env.PUBLIC_FARO_URL || '').trim();
    if (!url) {
      console.warn('[faro] PUBLIC_FARO_ENABLED=true but PUBLIC_FARO_URL is empty');
      return;
    }

    if ((window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized) {
      return;
    }
    (window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized = true;

    try {
      const { getWebInstrumentations, initializeFaro } = await import('@grafana/faro-web-sdk');
      initializeFaro({
        url,
        app: {
          name: (env.PUBLIC_FARO_APP_NAME || 'mtg-meta-analyzer-web').trim() || 'mtg-meta-analyzer-web',
          version: (env.PUBLIC_FARO_APP_VERSION || '0.1.0').trim() || '0.1.0'
        },
        instrumentations: [...getWebInstrumentations()]
      });
      console.info('[faro] initialized');
    } catch (error) {
      (window as Window & { __mtgMetaFaroInitialized?: boolean }).__mtgMetaFaroInitialized = false;
      console.error('[faro] initialization failed', error);
    }
  }

  function isEnabled(raw: string | undefined): boolean {
    const value = (raw || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  }
</script>

<slot />
