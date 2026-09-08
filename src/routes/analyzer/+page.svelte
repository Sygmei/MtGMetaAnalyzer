<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onDestroy, onMount } from "svelte";

  import RequiredCardsPicker from "$lib/components/RequiredCardsPicker.svelte";
  import TournamentCommanderPicker from "$lib/components/TournamentCommanderPicker.svelte";
  import CardTable from "$lib/components/CardTable.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { currentUser } from "$lib/current-user";
  import { t } from "$lib/i18n";
  import type { AnalysisResult } from "$lib/server/types";

  type PreviousAnalysis = {
    shareId: string;
    moxfieldUrl: string;
    commanderName: string | null;
    ignoreBefore: string | null;
    ignoreAfter: string | null;
    createdAt: string;
  };

  export let form:
    | {
        error?: string;
        traceId?: string;
        values?: {
          inputMode: string;
          commanderNames: string;
          moxfieldUrl: string;
          startDate: string;
          endDate: string;
          requiredCards: string;
          keepTop: string;
          cutTop: string;
          addTop: string;
        };
        output?: {
          analyzedAt: string;
          share?: {
            id: string;
            url: string;
          };
          moxfieldDeck: {
            source: "moxfield" | "archidekt" | "manabox" | "commander";
            name: string;
            deckId: string;
            commanders: string[];
            url: string;
          };
          commander: {
            name: string;
            score: number;
            url: string;
          };
          cache: {
            latestCachedEventDate: string | null;
            fetchedDeckRows: number;
            insertedDeckRows: number;
            totalCachedDeckRows: number;
          };
          analysis: AnalysisResult;
        };
      }
    | undefined;

  let values: {
    inputMode: string;
    commanderNames: string;
    moxfieldUrl: string;
    startDate: string;
    endDate: string;
    requiredCards: string;
    keepTop: string;
    cutTop: string;
    addTop: string;
  } = {
    inputMode: "deck",
    commanderNames: "",
    moxfieldUrl: "",
    startDate: "",
    endDate: "",
    requiredCards: "",
    keepTop: "50",
    cutTop: "50",
    addTop: "50"
  };

  let output = form?.output;
  type AnalysisTab = "cut" | "add" | "keep";
  let activeAnalysisTab: AnalysisTab = "cut";

  $: values = {
    inputMode: form?.values?.inputMode ?? "deck",
    commanderNames: form?.values?.commanderNames ?? "",
    moxfieldUrl: form?.values?.moxfieldUrl ?? "",
    startDate: form?.values?.startDate ?? "",
    endDate: form?.values?.endDate ?? "",
    requiredCards: form?.values?.requiredCards ?? "",
    keepTop: form?.values?.keepTop ?? "50",
    cutTop: form?.values?.cutTop ?? "50",
    addTop: form?.values?.addTop ?? "50"
  };

  $: output = form?.output;

  let previousAnalysesPromise: Promise<PreviousAnalysis[]> = pending();
  let loadedPreviousAnalyses = false;

  onMount(() => {
    return currentUser.subscribe((user) => {
      if (user && !loadedPreviousAnalyses) {
        loadedPreviousAnalyses = true;
        previousAnalysesPromise = fetchJson<PreviousAnalysis[]>("/analyzer/previous-analyses");
      }
      if (!user) {
        previousAnalysesPromise = Promise.resolve([]);
      }
    });
  });

  let isSubmitting = false;
  let progress = 0;
  let progressMessage = "Preparing request...";
  let progressStageLabel = "Queued";
  let progressPollTimer: ReturnType<typeof setInterval> | null = null;
  let progressSmoothingTimer: ReturnType<typeof setInterval> | null = null;
  let currentProgressId = "";
  let backendTargetProgress = 2;
  let activeProgressStage: ProgressStage = "queued";
  let activeStageStartedAtMs = 0;
  let latestProgressDetails: ProgressDetails = {};
  let mtgtop8PageStartedAtMs = 0;
  let mtgtop8CurrentPage = 0;
  let mtgtop8EstimatedPageDurationMs = 5200;
  let metroActiveStageKey = "queued";
  let progressStages: ProgressStageItem[] = [];
  let displayedProgressStages: ProgressStageItem[] = [{ key: "queued", label: "Queued" }];
  let runStartedAtMs = 0;
  let lastProgressUpdateAtMs = 0;
  let backendProgressSettled = false;
  let lastBackendStage: ProgressStage = "queued";
  let lastBackendPercent = 0;
  let lastBackendMessage = "";

  type ProgressStage =
    | "queued"
    | "moxfield"
    | "commander"
    | "mtgtop8"
    | "analysis"
    | "done"
    | "error";

  type MtgTop8ProgressDetails = {
    phase: "start" | "page" | "deck" | "complete";
    currentPage: number;
    totalPages: number | null;
    scannedPages: number;
    rowsOnPage: number;
    rowsToFetchOnPage: number;
    fetchedOnPage: number;
    fetchedDecks: number;
  };

  type ProgressDetails = {
    mtgtop8?: MtgTop8ProgressDetails;
  };

  type ProgressRange = {
    min: number;
    max: number;
    durationMs: number;
  };

  type ProgressStageKey = "queued" | "moxfield" | "commander" | "mtgtop8" | "analysis";
  type ProgressStageItem = {
    key: ProgressStageKey;
    label: string;
  };

  const PROGRESS_RANGES: Record<ProgressStage, ProgressRange> = {
    queued: { min: 0, max: 5, durationMs: 2500 },
    moxfield: { min: 5, max: 32, durationMs: 9000 },
    commander: { min: 32, max: 35, durationMs: 3000 },
    mtgtop8: { min: 35, max: 95, durationMs: 80000 },
    analysis: { min: 95, max: 99, durationMs: 6000 },
    done: { min: 100, max: 100, durationMs: 0 },
    error: { min: 100, max: 100, durationMs: 0 },
  };

  type ProgressPayload = {
    id: string;
    stage: ProgressStage;
    activeStageKey?: ProgressStageKey;
    stages?: ProgressStageItem[];
    percent: number;
    message: string;
    done: boolean;
    error: string | null;
    details?: ProgressDetails;
  };

  $: displayedProgressStages =
    progressStages.length > 0
      ? progressStages
      : ([{ key: "queued", label: "Queued" }] as ProgressStageItem[]);

  function startProgress(id: string): void {
    currentProgressId = id;
    isSubmitting = true;
    progress = 0.8;
    progressStageLabel = "Queued";
    progressMessage = "Preparing request...";
    backendTargetProgress = 2;
    activeProgressStage = "queued";
    metroActiveStageKey = "queued";
    progressStages = [];
    activeStageStartedAtMs = Date.now();
    runStartedAtMs = activeStageStartedAtMs;
    lastProgressUpdateAtMs = activeStageStartedAtMs;
    backendProgressSettled = false;
    lastBackendStage = "queued";
    lastBackendPercent = 0;
    lastBackendMessage = "";
    latestProgressDetails = {};
    mtgtop8CurrentPage = 0;
    mtgtop8PageStartedAtMs = 0;
    mtgtop8EstimatedPageDurationMs = 5200;
    stopProgressPolling();
    startProgressSmoothing();
    startProgressPolling(id);
  }

  function stopProgress(): void {
    stopProgressPolling();
    stopProgressSmoothing();
    progress = 100;
    progressMessage = "Finalizing results...";
    progressStageLabel = "Done";
    setTimeout(() => {
      isSubmitting = false;
      progress = 0;
      progressMessage = "Preparing request...";
      progressStageLabel = "Queued";
      currentProgressId = "";
    }, 320);
  }

  function applyProgressState(parsed: ProgressPayload): void {
    if (parsed.id !== currentProgressId) {
      return;
    }
    if (parsed.stage !== activeProgressStage) {
      activeProgressStage = parsed.stage;
      activeStageStartedAtMs = Date.now();
      if (parsed.stage !== "mtgtop8") {
        mtgtop8CurrentPage = 0;
        mtgtop8PageStartedAtMs = 0;
      }
    }
    if (Array.isArray(parsed.stages) && parsed.stages.length > 0) {
      progressStages = parsed.stages.filter(isProgressStageItem);
    }

    if (parsed.activeStageKey && isProgressStageKey(parsed.activeStageKey)) {
      metroActiveStageKey = parsed.activeStageKey;
    } else {
      metroActiveStageKey = toProgressStageKey(parsed.stage);
    }

    latestProgressDetails = parsed.details || {};
    trackMtgTop8PageTiming(latestProgressDetails.mtgtop8);
    backendTargetProgress = computeBackendTarget(parsed);
    const hasMeaningfulBackendSignal =
      parsed.stage !== lastBackendStage ||
      parsed.percent > lastBackendPercent + 0.25 ||
      parsed.done ||
      (parsed.stage !== "queued" && parsed.message !== lastBackendMessage);

    if (hasMeaningfulBackendSignal) {
      lastProgressUpdateAtMs = Date.now();
    }
    if (parsed.stage !== "queued" || parsed.percent > 5 || parsed.done) {
      backendProgressSettled = true;
    }
    lastBackendStage = parsed.stage;
    lastBackendPercent = parsed.percent;
    lastBackendMessage = parsed.message || "";

    progressMessage = parsed.error || parsed.message;
    progressStageLabel = mapStageLabel(parsed.stage, parsed.details);
    startProgressSmoothing();

    if (parsed.done) {
      stopProgressPolling();
    }
  }

  function startProgressPolling(id: string): void {
    stopProgressPolling();
    void pollProgress(id);
    progressPollTimer = setInterval(() => {
      void pollProgress(id);
    }, 900);
  }

  function stopProgressPolling(): void {
    if (!progressPollTimer) {
      return;
    }
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }

  function startProgressSmoothing(): void {
    if (progressSmoothingTimer) {
      return;
    }
    progressSmoothingTimer = setInterval(() => {
      tickProgress();
    }, 120);
  }

  function stopProgressSmoothing(): void {
    if (!progressSmoothingTimer) {
      return;
    }
    clearInterval(progressSmoothingTimer);
    progressSmoothingTimer = null;
  }

  function tickProgress(): void {
    if (!isSubmitting) {
      return;
    }

    const estimatedTarget = computeEstimatedTarget(activeProgressStage);
    const fallbackTarget = computeFallbackTargetWhenStale();
    const rawTarget = Math.max(backendTargetProgress, estimatedTarget, fallbackTarget);
    const target = Math.max(progress, Math.min(100, rawTarget));
    const delta = target - progress;
    if (delta <= 0) {
      return;
    }

    const isTerminal = activeProgressStage === "done" || activeProgressStage === "error";
    const step = isTerminal
      ? Math.max(1.8, delta * 0.36)
      : Math.max(0.09, Math.min(1.25, delta * 0.18));
    progress = Math.min(target, progress + step);

    if (!backendProgressSettled) {
      metroActiveStageKey = toProgressStageKey(stageFromProgress(progress));
    }
  }

  async function pollProgress(id: string): Promise<void> {
    if (!id || id !== currentProgressId || typeof window === "undefined") {
      return;
    }

    try {
      const response = await fetch(`/api/progress/${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as Partial<ProgressPayload>;
      if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
        return;
      }
      applyProgressState(payload as ProgressPayload);
    } catch {
      // keep polling until the request resolves
    }
  }

  function mapStageLabel(stage: ProgressPayload["stage"], details?: ProgressDetails): string {
    if (stage === "queued") return getStageLabel("queued");
    if (stage === "moxfield") return getStageLabel("moxfield");
    if (stage === "commander") return getStageLabel("commander");
    if (stage === "mtgtop8") {
      const base = getStageLabel("mtgtop8");
      const page = details?.mtgtop8?.currentPage;
      const total = details?.mtgtop8?.totalPages;
      if (page && total && total > 0) {
        return `${base} (Page ${page}/${total})`;
      }
      if (page) {
        return `${base} (Page ${page})`;
      }
      return base;
    }
    if (stage === "analysis") return getStageLabel("analysis");
    if (stage === "done") return "Done";
    return "Error";
  }

  function computeBackendTarget(payload: ProgressPayload): number {
    if (payload.stage === "done" || payload.stage === "error") {
      return 100;
    }
    if (payload.stage === "mtgtop8") {
      return computeMtgTop8Target(payload.details?.mtgtop8, false);
    }

    const range = PROGRESS_RANGES[payload.stage];
    const globalRatio = clamp(payload.percent / 100, 0, 1);
    const base = range.min + (range.max - range.min) * globalRatio;
    return clamp(base, range.min, range.max - 0.2);
  }

  function computeEstimatedTarget(stage: ProgressStage): number {
    if (stage === "done" || stage === "error") {
      return 100;
    }
    if (stage === "mtgtop8") {
      return computeMtgTop8Target(latestProgressDetails.mtgtop8, true);
    }

    const range = PROGRESS_RANGES[stage];
    const elapsed = Date.now() - activeStageStartedAtMs;
    const ratio = range.durationMs > 0 ? Math.min(0.92, elapsed / range.durationMs) : 1;
    const target = range.min + (range.max - range.min) * ratio;
    return clamp(target, range.min, range.max - 0.25);
  }

  function computeMtgTop8Target(details: MtgTop8ProgressDetails | undefined, includeTimeBlend: boolean): number {
    const range = PROGRESS_RANGES.mtgtop8;
    const span = range.max - range.min;
    const now = Date.now();

    if (!details) {
      const elapsed = now - activeStageStartedAtMs;
      const ratio = Math.min(0.9, elapsed / range.durationMs);
      return range.min + span * ratio;
    }

    const totalPages = details.totalPages && details.totalPages > 0 ? details.totalPages : null;
    if (!totalPages) {
      const pagesSeen = Math.max(details.scannedPages || 0, details.currentPage || 0);
      const pageRatio = Math.min(0.9, pagesSeen * 0.04);
      const elapsed = now - activeStageStartedAtMs;
      const timeRatio = Math.min(0.9, elapsed / range.durationMs);
      return range.min + span * Math.max(pageRatio, timeRatio);
    }

    const currentPage = Math.max(1, details.currentPage || 1);
    const pageIndex = currentPage - 1;
    let knownWithinPage = 0;
    if (details.phase === "complete") {
      knownWithinPage = 1;
    } else if (details.rowsToFetchOnPage > 0) {
      knownWithinPage = clamp(details.fetchedOnPage / details.rowsToFetchOnPage, 0, 1);
    } else if (details.phase === "deck") {
      knownWithinPage = 0.14;
    } else if (details.phase === "page") {
      knownWithinPage = 0.06;
    }

    let timeWithinPage = 0;
    if (includeTimeBlend && mtgtop8PageStartedAtMs > 0) {
      timeWithinPage = clamp(
        (now - mtgtop8PageStartedAtMs) / Math.max(1200, mtgtop8EstimatedPageDurationMs),
        0,
        0.96
      );
    }
    const withinPage = Math.max(knownWithinPage, timeWithinPage);
    const ratio =
      details.phase === "complete"
        ? 1
        : clamp((pageIndex + withinPage) / totalPages, 0, 0.995);
    const raw = range.min + span * ratio;
    return details.phase === "complete" ? range.max : clamp(raw, range.min, range.max - 0.18);
  }

  function computeFallbackTargetWhenStale(): number {
    if (activeProgressStage === "done" || activeProgressStage === "error") {
      return 100;
    }
    const now = Date.now();
    const staleMs = now - lastProgressUpdateAtMs;
    if (staleMs < 1600 || runStartedAtMs <= 0) {
      return 0;
    }

    const elapsed = now - runStartedAtMs;
    const softTimelineMs = 105000;
    const ratio = clamp(elapsed / softTimelineMs, 0, 0.985);
    return 2 + ratio * 94;
  }

  function trackMtgTop8PageTiming(details: MtgTop8ProgressDetails | undefined): void {
    if (!details) {
      return;
    }
    const page = Math.max(1, details.currentPage || 1);
    const now = Date.now();
    if (mtgtop8CurrentPage === 0) {
      mtgtop8CurrentPage = page;
      mtgtop8PageStartedAtMs = now;
      return;
    }

    if (page !== mtgtop8CurrentPage) {
      const elapsed = now - mtgtop8PageStartedAtMs;
      if (elapsed >= 250) {
        const nextEstimate = mtgtop8EstimatedPageDurationMs * 0.7 + elapsed * 0.3;
        mtgtop8EstimatedPageDurationMs = clamp(nextEstimate, 1200, 25000);
      }
      mtgtop8CurrentPage = page;
      mtgtop8PageStartedAtMs = now;
    } else if (mtgtop8PageStartedAtMs === 0) {
      mtgtop8PageStartedAtMs = now;
    }
  }

  function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  function stageClass(stage: ProgressStageKey): "done" | "active" | "pending" {
    const idx = displayedProgressStages.findIndex((step) => step.key === stage);
    if (idx === -1) {
      return "pending";
    }

    const activeIndex = displayedProgressStages.findIndex((step) => step.key === metroActiveStageKey);
    if (activeIndex < 0) {
      return "pending";
    }

    if (idx < activeIndex) {
      return "done";
    }
    if (idx === activeIndex) {
      return "active";
    }
    return "pending";
  }

  function stageFromProgress(value: number): ProgressStage {
    const p = clamp(value, 0, 100);
    if (p < 5) return "queued";
    if (p < 32) return "moxfield";
    if (p < 35) return "commander";
    if (p < 95) return "mtgtop8";
    return "analysis";
  }

  function toProgressStageKey(stage: ProgressStage): ProgressStageKey {
    if (stage === "done" || stage === "error") {
      return "analysis";
    }
    return stage;
  }

  function isProgressStageKey(value: string): value is ProgressStageKey {
    return value === "queued" || value === "moxfield" || value === "commander" || value === "mtgtop8" || value === "analysis";
  }

  function isProgressStageItem(value: unknown): value is ProgressStageItem {
    if (!value || typeof value !== "object") {
      return false;
    }
    const item = value as { key?: unknown; label?: unknown };
    return isProgressStageKey(String(item.key || "")) && typeof item.label === "string" && Boolean(item.label.trim());
  }

  function getStageLabel(stageKey: ProgressStageKey): string {
    return displayedProgressStages.find((stage) => stage.key === stageKey)?.label || stageKey;
  }

  function compactStageLabel(stage: ProgressStageItem): string {
    if (stage.key === "queued") return "Queued";
    if (stage.key === "moxfield") return "Decklist";
    if (stage.key === "commander") return "Commander";
    if (stage.key === "mtgtop8") return "MtgTop8";
    return "Analysis";
  }

  function metroPillClass(stage: ProgressStageKey): string {
    const state = stageClass(stage);
    if (state === "done" || state === "active") {
      return "grid min-w-10 place-items-center rounded bg-primary-300 px-3 py-1.5 text-xs font-black text-stone-950";
    }
    return "grid min-w-10 place-items-center rounded border border-white/15 px-3 py-1.5 text-xs font-bold text-stone-400";
  }

  function analysisTabClass(tab: AnalysisTab): string {
    return `select-none rounded px-3 py-2 font-bold ${activeAnalysisTab === tab ? "bg-primary-300 text-stone-950" : "text-stone-300 hover:bg-stone-800"}`;
  }

  function activateAnalysisTabOnPointerDown(event: PointerEvent, tab: AnalysisTab): void {
    if (event.button === 0) {
      activeAnalysisTab = tab;
    }
  }

  function deckSourceLabel(source: string | undefined): string {
    if (source === "manabox") return "ManaBox";
    return source === "archidekt" ? "Archidekt" : "Moxfield";
  }

  function createProgressId(): string {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `progress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const enhanceSubmit: SubmitFunction = ({ formData }) => {
    const id = createProgressId();
    formData.set("progressId", id);
    startProgress(id);

    return async ({ update, result }) => {
      await update();

      const shareUrl = extractShareUrl(result);
      if (shareUrl) {
        stopProgressPolling();
        progress = 100;
        activeProgressStage = "done";
        progressStageLabel = "Done";
        progressMessage = "Opening shared permalink...";
        stopProgressSmoothing();
        await goto(toInternalPath(shareUrl));
        return;
      }

      stopProgress();
    };
  };

  function extractShareUrl(result: unknown): string | null {
    if (!result || typeof result !== "object") {
      return null;
    }
    const actionResult = result as { type?: unknown; data?: unknown };
    if (
      actionResult.type !== "success" ||
      !actionResult.data ||
      typeof actionResult.data !== "object"
    ) {
      return null;
    }
    const data = actionResult.data as {
      output?: { share?: { url?: unknown } };
    };
    const url = data.output?.share?.url;
    return typeof url === "string" && url.trim() ? url : null;
  }

  function toInternalPath(urlLike: string): string {
    try {
      const parsed = new URL(urlLike, window.location.origin);
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return urlLike;
    }
  }

  function pending<T>(): Promise<T> {
    return new Promise(() => {});
  }

  async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return (await response.json()) as T;
  }

  onDestroy(() => {
    stopProgressPolling();
    stopProgressSmoothing();
  });

  function revealInvalidDate(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const details = input.closest("details");
    if (details && !details.open) {
      details.open = true;
      requestAnimationFrame(() => input.focus());
    }
  }

  const pageClass = "mx-auto grid w-[min(1200px,94vw)] gap-4 py-4 pb-12";
  const panelClass = "ui-panel";
  const inputClass = "ui-input";
  const fieldClass = "grid gap-1";
  const labelTextClass = "text-sm font-semibold text-stone-300";
  const eyebrowClass = "text-sm font-medium text-stone-400";
  const statLabelClass = "text-xs font-bold uppercase tracking-wider text-stone-400";
  const statValueClass = "mt-1 text-lg font-black text-stone-100";
  const skeletonBlockClass = "animate-pulse rounded bg-stone-950/80";
</script>

<svelte:head>
  <title>{$t("analyzer.title")} - Karton</title>
</svelte:head>

<main class={`${pageClass} ${output ? "" : "analyzer-start"}`}>
  <PageHeader
    title={$t("analyzer.title")}
    subtitle={$t("analyzer.description")}
  />

  {#if isSubmitting}
    <section class="sticky top-24 z-40 rounded border border-primary-200/30 bg-stone-950/95 p-4 shadow-2xl" aria-live="polite" aria-busy="true">
      <div class="flex items-center justify-between gap-4">
        <p class="font-bold">Analyzing Deck ({progressStageLabel})</p>
        <span class="text-sm font-black text-primary-300">{Math.round(progress)}%</span>
      </div>
      <div class="mt-3 h-2 overflow-hidden rounded bg-stone-800">
        <div class="h-full rounded bg-primary-300 transition-[width]" style={`width:${progress}%`}></div>
      </div>
      <p class="mt-2 text-sm text-stone-400">{progressMessage}</p>
      <div class="mt-3 flex flex-wrap gap-2" aria-hidden="true">
        {#each displayedProgressStages as step, idx (step.key)}
          <div>
            <span class={metroPillClass(step.key)} title={step.label} aria-label={step.label}>
              <span>{idx + 1}. {compactStageLabel(step)}</span>
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class={`${panelClass} grid gap-5`}>
    <form method="POST" class="grid gap-5" use:enhance={enhanceSubmit} aria-busy={isSubmitting}>
      <fieldset class="flex flex-wrap gap-4" disabled={isSubmitting}>
        <legend class="sr-only">{$t('analyzer.inputMode')}</legend>
        <label class="flex items-center gap-2 text-sm"><input type="radio" name="inputMode" value="deck" bind:group={values.inputMode} /> {$t('analyzer.deckMode')}</label>
        <label class="flex items-center gap-2 text-sm"><input type="radio" name="inputMode" value="commander" bind:group={values.inputMode} /> {$t('analyzer.commanderMode')}</label>
      </fieldset>
      {#if values.inputMode === 'commander'}
        {#key form}
          <TournamentCommanderPicker memberId="analyzer" playerName="" fieldName="commanderNames"
            searchEndpoint="/analyzer/commanders" bind:value={values.commanderNames} />
        {/key}
        <p class="text-xs text-stone-400">{$t('analyzer.commanderHelp')}</p>
        <button class="ui-icon-button ui-icon-primary" type="submit" disabled={isSubmitting || !values.commanderNames.trim()}
          aria-label={isSubmitting ? $t('analyzer.analyzing') : $t('analyzer.submit')}
          title={isSubmitting ? $t('analyzer.analyzing') : $t('analyzer.submit')}>
          <Icon name={isSubmitting ? 'loader' : 'scan'} size={20} />
        </button>
      {:else}
      <div class="grid gap-2">
        <label class={labelTextClass} for="deck-url">{$t("analyzer.deckUrl")}</label>
        <div class="flex items-start gap-2">
          <input id="deck-url" class={inputClass} name="moxfieldUrl" type="text" inputmode="url"
            autocapitalize="off" autocorrect="off" spellcheck="false" required
            placeholder="https://www.moxfield.com/decks/…" aria-describedby="deck-sources" bind:value={values.moxfieldUrl} />
          <button class="ui-icon-button ui-icon-primary" type="submit" disabled={isSubmitting}
            aria-label={isSubmitting ? $t("analyzer.analyzing") : $t("analyzer.submit")}
            title={isSubmitting ? $t("analyzer.analyzing") : $t("analyzer.submit")}>
            <Icon name={isSubmitting ? "loader" : "scan"} size={20} />
          </button>
        </div>
        <span id="deck-sources" class="text-xs text-stone-400">{$t("analyzer.sources")}</span>
      </div>

      {/if}

      <details class="date-filter" open={Boolean(values.requiredCards)}>
        <summary>
          <Icon name="search" size={16} /> {$t("analyzer.requiredCards")}
          <span class="filter-chevron"><Icon name="chevron" size={14} /></span>
        </summary>
        <div class="mt-3 grid gap-2">
          <RequiredCardsPicker bind:value={values.requiredCards} disabled={isSubmitting} />
        </div>
      </details>

      <details class="date-filter" open={Boolean(values.startDate || values.endDate)}>
        <summary>
          <Icon name="calendar" size={16} /> {$t("analyzer.dateFilter")}
          <span class="filter-chevron"><Icon name="chevron" size={14} /></span>
          {#if values.startDate || values.endDate}
            <span class="ml-2 text-xs">{values.startDate || "…"} – {values.endDate || "…"}</span>
          {/if}
        </summary>
        <p class="mt-3 text-xs text-stone-400">{$t("analyzer.dateHelp")}</p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class={fieldClass}>
            <span class={labelTextClass}>{$t("analyzer.ignoreBefore")}</span>
            <input class={inputClass} name="startDate" type="date" bind:value={values.startDate} max={values.endDate || undefined} on:invalid={revealInvalidDate} />
          </label>
          <label class={fieldClass}>
            <span class={labelTextClass}>{$t("analyzer.ignoreAfter")}</span>
            <input class={inputClass} name="endDate" type="date" bind:value={values.endDate} min={values.startDate || undefined} on:invalid={revealInvalidDate} />
          </label>
        </div>
      </details>

      {#if false}
        <div class="grid gap-3 md:grid-cols-3">
          <label class={fieldClass}>
            <span class={labelTextClass}>Keep top</span>
            <input
              class={inputClass}
              name="keepTop"
              type="number"
              min="1"
              step="1"
              value={values.keepTop}
            />
          </label>

          <label class={fieldClass}>
            <span class={labelTextClass}>Cut top</span>
            <input
              class={inputClass}
              name="cutTop"
              type="number"
              min="1"
              step="1"
              value={values.cutTop}
            />
          </label>

          <label class={fieldClass}>
            <span class={labelTextClass}>Add top</span>
            <input
              class={inputClass}
              name="addTop"
              type="number"
              min="1"
              step="1"
              value={values.addTop}
            />
          </label>
        </div>
      {/if}

    </form>

    {#if form?.error}
      <p role="alert" class="rounded border border-red-300/20 bg-red-950/30 p-3 text-red-200">{form.error}</p>
    {/if}
    {#if form?.traceId}
      <p class="text-sm text-stone-400">Trace ID: <code class="rounded bg-stone-950 px-2 py-1 text-primary-300">{form.traceId}</code></p>
    {/if}
  </section>

  {#if $currentUser}
    <section class={`${panelClass} grid gap-4`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">{$t("analyzer.previousAnalyses")}</h2>
        </div>
      </div>
      {#await previousAnalysesPromise}
        <div class="grid gap-3" aria-hidden="true">
          <span class={`${skeletonBlockClass} h-7 w-20`}></span>
          {#each Array(3) as _}
            <div class="grid gap-2 rounded border border-white/10 bg-stone-950/60 p-3">
              <span class={`${skeletonBlockClass} h-5 w-44 max-w-full`}></span>
              <span class={`${skeletonBlockClass} h-4 w-full`}></span>
              <span class={`${skeletonBlockClass} h-3 w-32`}></span>
            </div>
          {/each}
        </div>
      {:then previousAnalyses}
        {#if previousAnalyses.length}
          <span class="text-sm text-stone-400">{$t("analyzer.savedCount", { count: previousAnalyses.length })}</span>
          <div class="grid gap-2">
            {#each previousAnalyses as analysis}
              <a class="grid gap-1 rounded border border-white/10 bg-stone-950/60 p-3 text-stone-100 no-underline hover:border-primary-300/50" href={`/analysis/${analysis.shareId}`}>
                <strong>{analysis.commanderName || "Deck analysis"}</strong>
                <span class="truncate text-sm text-stone-400">{analysis.moxfieldUrl || $t("analyzer.commanderMode")}</span>
                <small class="text-stone-500">
                  {new Date(analysis.createdAt).toLocaleString()}
                  {#if analysis.ignoreBefore || analysis.ignoreAfter}
                    - {analysis.ignoreBefore || "start"} to {analysis.ignoreAfter || "now"}
                  {/if}
                </small>
              </a>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-stone-400">{$t("analyzer.noSaved")}</p>
        {/if}
      {:catch}
        <p class="text-sm text-red-200">{$t("analyzer.loadPreviousFailed")}</p>
      {/await}
    </section>
  {/if}

  {#if output}
    {#if output.analysis.requiredCards?.length}
      <section class={panelClass}>
        <p class="text-sm text-stone-300">{$t("analyzer.requiredCards")}: {output.analysis.requiredCards.join(" · ")}</p>
        {#if output.analysis.totalDecksConsidered === 0}
          <p class="mt-2 text-sm text-amber-200" role="status">{$t("analyzer.noMatchingDecks")}</p>
        {/if}
      </section>
    {/if}
    <section class={`${panelClass} grid gap-4`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <h2 class="text-xl font-bold">Deck Snapshot</h2>
        <span class="rounded bg-stone-950 px-3 py-1 text-sm text-stone-300"
          >Analyzed {new Date(output.analyzedAt).toLocaleString()}</span
        >
      </div>

      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article class="rounded border border-white/10 bg-stone-950/60 p-4">
          <p class={statLabelClass}>Deck</p>
          <p class={statValueClass}>{output.moxfieldDeck.name}</p>
          <p class="mt-1 text-sm text-stone-400">{output.moxfieldDeck.source === "commander" ? $t("analyzer.commanderMode") : `${deckSourceLabel(output.moxfieldDeck.source)} - ${output.moxfieldDeck.deckId}`}</p>
        </article>
        <article class="rounded border border-white/10 bg-stone-950/60 p-4">
          <p class={statLabelClass}>Commander</p>
          <p class={statValueClass}>{output.moxfieldDeck.commanders.join(" / ")}</p>
          <p class="mt-1 text-sm text-stone-400">
            MtgTop8 match:
            <a class="text-primary-300 no-underline hover:underline" href={output.commander.url} target="_blank" rel="noreferrer"
              >{output.commander.name}</a
            >
            ({output.commander.score.toFixed(2)})
          </p>
        </article>
        <article class="rounded border border-white/10 bg-stone-950/60 p-4">
          <p class={statLabelClass}>Decks considered</p>
          <p class={statValueClass}>{output.analysis.totalDecksConsidered}</p>
          <p class="mt-1 text-sm text-stone-400">
            Latest cache date: {output.cache.latestCachedEventDate ?? "none"}
          </p>
        </article>
        <article class="rounded border border-white/10 bg-stone-950/60 p-4">
          <p class={statLabelClass}>Ignore Filters</p>
          <p class={statValueClass}>Before: {output.analysis.startDate ?? "none"}</p>
          <p class="mt-1 text-sm text-stone-400">After: {output.analysis.endDate ?? "none"}</p>
        </article>
        <article class="rounded border border-white/10 bg-stone-950/60 p-4">
          <p class={statLabelClass}>Cache updates</p>
          <p class={statValueClass}>+{output.cache.insertedDeckRows}</p>
          <p class="mt-1 text-sm text-stone-400">
            fetched {output.cache.fetchedDeckRows}, total stored {output.cache
              .totalCachedDeckRows}
          </p>
        </article>
        {#if output.share}
          <article class="rounded border border-white/10 bg-stone-950/60 p-4">
            <p class={statLabelClass}>Share</p>
            <p class={statValueClass}><a class="text-primary-300 no-underline hover:underline" href={output.share.url}>{output.share.id}</a></p>
            <p class="mt-1 text-sm text-stone-400">
              <a class="text-primary-300 no-underline hover:underline" href={output.share.url} target="_blank" rel="noreferrer"
                >Open permalink</a
              >
            </p>
          </article>
        {/if}
      </div>
    </section>

    <section class={`${panelClass} grid gap-4`}>
    {#if output.moxfieldDeck.source === 'commander'}
      <h2 class="text-xl font-bold">{$t('analyzer.popularCards')}</h2>
      <CardTable cards={output.analysis.toAdd} />
    {:else}
      <div class="grid grid-cols-3 rounded border border-white/10 bg-stone-950 p-1" role="tablist" aria-label="Analysis views">
        <button
          class={analysisTabClass("cut")}
          type="button"
          role="tab"
          aria-selected={activeAnalysisTab === "cut"}
          on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, "cut")}
          on:click={() => (activeAnalysisTab = "cut")}
        >
          <span class="ui-action"><Icon name="minus" />Cut</span>
        </button>
        <button
          class={analysisTabClass("add")}
          type="button"
          role="tab"
          aria-selected={activeAnalysisTab === "add"}
          on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, "add")}
          on:click={() => (activeAnalysisTab = "add")}
        >
          <span class="ui-action"><Icon name="plus" />Add</span>
        </button>
        <button
          class={analysisTabClass("keep")}
          type="button"
          role="tab"
          aria-selected={activeAnalysisTab === "keep"}
          on:pointerdown={(event) => activateAnalysisTabOnPointerDown(event, "keep")}
          on:click={() => (activeAnalysisTab = "keep")}
        >
          <span class="ui-action"><Icon name="check" />Keep</span>
        </button>
      </div>

      {#if activeAnalysisTab === "cut"}
        <article class="grid gap-3">
          <h2 class="text-xl font-bold">Cards To Cut</h2>
          <CardTable cards={output.analysis.cut} />
        </article>
      {:else if activeAnalysisTab === "add"}
        <article class="grid gap-3">
          <h2 class="text-xl font-bold">Cards To Add</h2>
          <CardTable cards={output.analysis.toAdd} />
        </article>
      {:else}
        <article class="grid gap-3">
          <h2 class="text-xl font-bold">Cards To Keep</h2>
          <CardTable cards={output.analysis.keep} />
        </article>
      {/if}
    {/if}
    </section>
  {/if}
</main>

<style>
  .analyzer-start { max-width: 800px; padding-top: 40px; }
  .date-filter { border-top: 1px solid var(--border); padding-top: 16px; }
  .date-filter summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; list-style: none; width: fit-content; color: var(--muted); font-size: 14px; }
  .date-filter summary::-webkit-details-marker { display: none; }
  .date-filter[open] .filter-chevron { transform: rotate(180deg); }
  .date-filter summary:hover { color: var(--text); }
  @media (max-width: 639px) { .analyzer-start { width: calc(100% - 32px); padding-top: 24px; } }
</style>
