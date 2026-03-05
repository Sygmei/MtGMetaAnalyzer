<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onDestroy } from "svelte";

  import CardTable from "$lib/components/CardTable.svelte";
  import type { AnalysisResult } from "$lib/server/types";

  export let form:
    | {
        error?: string;
        traceId?: string;
        values?: {
          moxfieldUrl: string;
          startDate: string;
          endDate: string;
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
            source: "moxfield" | "archidekt";
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
    moxfieldUrl: string;
    startDate: string;
    endDate: string;
    keepTop: string;
    cutTop: string;
    addTop: string;
  } = {
    moxfieldUrl: "",
    startDate: "",
    endDate: "",
    keepTop: "50",
    cutTop: "50",
    addTop: "50"
  };

  let output = form?.output;
  type AnalysisTab = "cut" | "add" | "keep";
  let activeAnalysisTab: AnalysisTab = "cut";

  $: values = {
    moxfieldUrl: form?.values?.moxfieldUrl ?? "",
    startDate: form?.values?.startDate ?? "",
    endDate: form?.values?.endDate ?? "",
    keepTop: form?.values?.keepTop ?? "50",
    cutTop: form?.values?.cutTop ?? "50",
    addTop: form?.values?.addTop ?? "50"
  };

  $: output = form?.output;

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

  function deckSourceLabel(source: string | undefined): string {
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

  onDestroy(() => {
    stopProgressPolling();
    stopProgressSmoothing();
  });
</script>

<svelte:head>
  <title>MtG Meta Analyzer</title>
</svelte:head>

<main class="stage">
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="grain"></div>

  {#if isSubmitting}
    <section class="progress-shell" aria-live="polite" aria-busy="true">
      <div class="progress-head">
        <p>Analyzing Deck ({progressStageLabel})</p>
        <span>{Math.round(progress)}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style={`width:${progress}%`}></div>
      </div>
      <p class="progress-message">{progressMessage}</p>
      <div class="progress-metro" aria-hidden="true">
        {#each displayedProgressStages as step, idx (step.key)}
          <div class={`metro-step ${stageClass(step.key)} ${idx === displayedProgressStages.length - 1 ? "last" : ""}`}>
            <span class="metro-pill" title={step.label} aria-label={step.label}>
              <span class="metro-number">{idx + 1}</span>
              <span class="metro-label">{compactStageLabel(step)}</span>
            </span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <section class="panel hero">
    <div class="hero-head">
      <h1>MtG DC Meta Atelier</h1>
      <p class="subtitle">
        Analyze your deck against live Duel Commander trends from
        MtgTop8!
      </p>
    </div>

    <form method="POST" class="form" use:enhance={enhanceSubmit}>
      <label class="field full">
        <span>Deck URL (Moxfield or Archidekt)</span>
        <input
          name="moxfieldUrl"
          type="text"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          required
          placeholder="https://www.moxfield.com/decks/... or https://archidekt.com/decks/..."
          value={values.moxfieldUrl}
        />
      </label>

      <div class="grid two">
        <label class="field">
          <span>Ignore MtGTop8 decks before date ...</span>
          <input name="startDate" type="date" value={values.startDate} />
        </label>

        <label class="field">
          <span>Ignore MtGTop8 decks after date ...</span>
          <input name="endDate" type="date" value={values.endDate} />
        </label>
      </div>

      {#if false}
        <div class="grid three">
          <label class="field">
            <span>Keep top</span>
            <input
              name="keepTop"
              type="number"
              min="1"
              step="1"
              value={values.keepTop}
            />
          </label>

          <label class="field">
            <span>Cut top</span>
            <input
              name="cutTop"
              type="number"
              min="1"
              step="1"
              value={values.cutTop}
            />
          </label>

          <label class="field">
            <span>Add top</span>
            <input
              name="addTop"
              type="number"
              min="1"
              step="1"
              value={values.addTop}
            />
          </label>
        </div>
      {/if}

      <button type="submit">Analyze Deck</button>
    </form>

    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
    {#if form?.traceId}
      <p class="error-trace">Trace ID: <code>{form.traceId}</code></p>
    {/if}
  </section>

  {#if output}
    <section class="panel info">
      <div class="title-row">
        <h2>Deck Snapshot</h2>
        <span class="stamp"
          >Analyzed {new Date(output.analyzedAt).toLocaleString()}</span
        >
      </div>

      <div class="meta-grid">
        <article>
          <p class="k">Deck</p>
          <p class="v">{output.moxfieldDeck.name}</p>
          <p class="sub">{deckSourceLabel(output.moxfieldDeck.source)} · {output.moxfieldDeck.deckId}</p>
        </article>
        <article>
          <p class="k">Commander</p>
          <p class="v">{output.moxfieldDeck.commanders.join(" / ")}</p>
          <p class="sub">
            MtgTop8 match:
            <a href={output.commander.url} target="_blank" rel="noreferrer"
              >{output.commander.name}</a
            >
            ({output.commander.score.toFixed(2)})
          </p>
        </article>
        <article>
          <p class="k">Decks considered</p>
          <p class="v">{output.analysis.totalDecksConsidered}</p>
          <p class="sub">
            Latest cache date: {output.cache.latestCachedEventDate ?? "none"}
          </p>
        </article>
        <article>
          <p class="k">Ignore Filters</p>
          <p class="v">Before: {output.analysis.startDate ?? "none"}</p>
          <p class="sub">After: {output.analysis.endDate ?? "none"}</p>
        </article>
        <article>
          <p class="k">Cache updates</p>
          <p class="v">+{output.cache.insertedDeckRows}</p>
          <p class="sub">
            fetched {output.cache.fetchedDeckRows}, total stored {output.cache
              .totalCachedDeckRows}
          </p>
        </article>
        {#if output.share}
          <article>
            <p class="k">Share</p>
            <p class="v"><a href={output.share.url}>{output.share.id}</a></p>
            <p class="sub">
              <a href={output.share.url} target="_blank" rel="noreferrer"
                >Open permalink</a
              >
            </p>
          </article>
        {/if}
      </div>
    </section>

    <section class="panel analysis-tabs-panel">
      <div class="analysis-tabs" role="tablist" aria-label="Analysis views">
        <button
          type="button"
          role="tab"
          class:active={activeAnalysisTab === "cut"}
          aria-selected={activeAnalysisTab === "cut"}
          on:click={() => (activeAnalysisTab = "cut")}
        >
          Cut
        </button>
        <button
          type="button"
          role="tab"
          class:active={activeAnalysisTab === "add"}
          aria-selected={activeAnalysisTab === "add"}
          on:click={() => (activeAnalysisTab = "add")}
        >
          Add
        </button>
        <button
          type="button"
          role="tab"
          class:active={activeAnalysisTab === "keep"}
          aria-selected={activeAnalysisTab === "keep"}
          on:click={() => (activeAnalysisTab = "keep")}
        >
          Keep
        </button>
      </div>

      {#if activeAnalysisTab === "cut"}
        <article class="analysis-view cut">
          <h2>Cards To Cut</h2>
          <CardTable cards={output.analysis.cut} />
        </article>
      {:else if activeAnalysisTab === "add"}
        <article class="analysis-view add">
          <h2>Cards To Add</h2>
          <CardTable cards={output.analysis.toAdd} />
        </article>
      {:else}
        <article class="analysis-view keep">
          <h2>Cards To Keep</h2>
          <CardTable cards={output.analysis.keep} />
        </article>
      {/if}
    </section>
  {/if}
</main>

<style>
  :global(body) {
    --bg: #0b1217;
    --ink: #eef4f8;
    --muted: #bfd0dc;
    --panel: rgba(14, 27, 35, 0.78);
    --line: rgba(183, 213, 230, 0.28);
    --a: #22b4c8;
    --b: #f4a340;

    margin: 0;
    min-height: 100vh;
    color: var(--ink);
    font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
    background: radial-gradient(
        circle at 15% 10%,
        rgba(43, 141, 175, 0.35),
        transparent 42%
      ),
      radial-gradient(
        circle at 80% 25%,
        rgba(255, 164, 76, 0.3),
        transparent 38%
      ),
      radial-gradient(
        circle at 50% 90%,
        rgba(255, 95, 95, 0.23),
        transparent 44%
      ),
      var(--bg);
    overflow-x: hidden;
  }

  .stage {
    position: relative;
    width: min(1200px, 93vw);
    margin: 1.4rem auto 3rem;
    display: grid;
    gap: 1rem;
    isolation: isolate;
  }

  .progress-shell {
    position: sticky;
    top: 0.9rem;
    z-index: 18;
    border-radius: 14px;
    border: 1px solid rgba(156, 211, 235, 0.45);
    background: rgba(7, 20, 28, 0.92);
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(4px);
    padding: 0.72rem 0.85rem;
    animation: reveal 0.32s ease both;
  }

  .progress-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.8rem;
    font-weight: 700;
  }

  .progress-head p {
    margin: 0;
    font-size: 0.86rem;
    color: #ddedf6;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .progress-head span {
    font-size: 0.84rem;
    color: #8fdded;
  }

  .progress-track {
    margin-top: 0.48rem;
    height: 9px;
    border-radius: 999px;
    background: rgba(115, 160, 184, 0.25);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #2cc4da, #5ce5ad, #f4b14f);
    background-size: 220% 100%;
    animation: sheen 1.8s linear infinite;
    transition: width 200ms ease;
  }

  .progress-message {
    margin: 0.44rem 0 0;
    font-size: 0.82rem;
    color: #b9d2df;
  }

  .progress-metro {
    margin-top: 0.66rem;
    display: flex;
    align-items: center;
    gap: 0;
    overflow-x: auto;
    padding-bottom: 0.05rem;
  }

  .metro-step {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: 0;
    flex: 1 1 0;
  }

  .metro-step::after {
    content: "";
    display: block;
    width: 100%;
    height: 2px;
    margin: 0 0.38rem;
    background: linear-gradient(90deg, rgba(79, 120, 143, 0.3), rgba(87, 136, 160, 0.22));
  }

  .metro-step.last {
    flex: 0 0 auto;
  }

  .metro-step.last::after {
    display: none;
  }

  .metro-pill {
    width: 1.78rem;
    height: 1.78rem;
    min-width: 1.78rem;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    overflow: hidden;
    border-radius: 999px;
    border: 1px solid rgba(135, 170, 188, 0.46);
    background: rgba(15, 35, 46, 0.8);
    padding: 0;
    transition:
      width 260ms ease,
      padding 260ms ease,
      border-color 200ms ease,
      background 220ms ease;
  }

  .metro-number {
    width: 1.78rem;
    min-width: 1.78rem;
    height: 1.78rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #b6d0de;
    font-size: 0.78rem;
    font-weight: 800;
    line-height: 1;
  }

  .metro-label {
    max-width: 11.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #d5e7f1;
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 700;
    opacity: 0;
    transform: translateX(-0.35rem);
    transition: all 250ms ease;
    padding-right: 0.1rem;
  }

  .metro-step.active .metro-pill {
    width: min(17.8rem, 62vw);
    padding-right: 0.5rem;
    border-color: rgba(126, 202, 222, 0.84);
    background: linear-gradient(
      120deg,
      rgba(28, 106, 128, 0.88),
      rgba(59, 153, 133, 0.84),
      rgba(29, 123, 145, 0.9)
    );
    background-size: 180% 100%;
    animation: metroFlow 2.8s ease-in-out infinite;
  }

  .metro-step.active .metro-number {
    color: #05222b;
  }

  .metro-step.active .metro-label {
    opacity: 1;
    transform: translateX(0);
    color: #ecf5fa;
  }

  .metro-step.done .metro-pill {
    border-color: rgba(138, 216, 194, 0.65);
    background: linear-gradient(130deg, rgba(77, 182, 146, 0.82), rgba(147, 217, 194, 0.72));
  }

  .metro-step.done .metro-number {
    color: #123941;
  }

  .metro-step.pending .metro-label {
    color: #cfe3ee;
  }

  .metro-step.done::after {
    background: linear-gradient(90deg, rgba(96, 223, 179, 0.74), rgba(129, 231, 194, 0.68));
  }

  .orb {
    position: fixed;
    border-radius: 999px;
    filter: blur(45px);
    z-index: -3;
    pointer-events: none;
    animation: drift 14s ease-in-out infinite;
  }

  .orb-a {
    width: 320px;
    height: 320px;
    top: -90px;
    right: -40px;
    background: linear-gradient(
      145deg,
      rgba(34, 180, 200, 0.45),
      rgba(46, 86, 175, 0.12)
    );
  }

  .orb-b {
    width: 260px;
    height: 260px;
    bottom: 8%;
    left: -70px;
    background: linear-gradient(
      145deg,
      rgba(255, 130, 87, 0.5),
      rgba(255, 214, 139, 0.08)
    );
    animation-delay: -5s;
  }

  .grain {
    position: fixed;
    inset: 0;
    z-index: -2;
    opacity: 0.12;
    pointer-events: none;
    background-image: radial-gradient(
      rgba(255, 255, 255, 0.8) 0.45px,
      transparent 0.45px
    );
    background-size: 4px 4px;
  }

  .panel {
    border-radius: 20px;
    border: 1px solid var(--line);
    background: linear-gradient(145deg, rgba(14, 27, 35, 0.92), var(--panel));
    box-shadow: 0 20px 55px rgba(0, 0, 0, 0.32);
    backdrop-filter: blur(7px);
    padding: 1.1rem 1.2rem;
    animation: reveal 0.45s ease both;
  }

  .hero {
    position: relative;
    overflow: clip;
  }

  .hero::after {
    content: "";
    position: absolute;
    inset: auto -25% -80% auto;
    width: 68%;
    aspect-ratio: 1;
    background: conic-gradient(
      from 190deg,
      rgba(34, 180, 200, 0.2),
      rgba(244, 163, 64, 0.2),
      transparent 52%
    );
    filter: blur(16px);
    transform: rotate(-12deg);
    pointer-events: none;
  }

  .hero-head {
    margin-bottom: 1.1rem;
    max-width: 820px;
  }

  h1,
  h2 {
    margin: 0;
    font-family: "Sora", "Space Grotesk", sans-serif;
    letter-spacing: 0.01em;
  }

  h1 {
    margin-top: 0.35rem;
    font-size: clamp(1.85rem, 3vw, 2.6rem);
    line-height: 1.12;
  }

  h2 {
    font-size: 1.25rem;
    margin-bottom: 0.85rem;
  }

  .subtitle {
    margin: 0.55rem 0 0;
    max-width: 760px;
    color: var(--muted);
    line-height: 1.45;
  }

  .form {
    position: relative;
    z-index: 1;
    display: grid;
    gap: 0.8rem;
  }

  .grid {
    display: grid;
    gap: 0.8rem;
  }

  .grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .field {
    display: grid;
    gap: 0.4rem;
  }

  .field > span {
    font-size: 0.86rem;
    color: #b7cfdd;
    font-weight: 700;
  }

  input,
  button {
    border: 1px solid rgba(167, 208, 227, 0.35);
    border-radius: 11px;
    padding: 0.62rem 0.72rem;
    font: inherit;
    color: var(--ink);
    background: rgba(8, 20, 27, 0.86);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  input::placeholder {
    color: rgba(197, 216, 227, 0.5);
  }

  input:focus {
    outline: none;
    border-color: rgba(86, 201, 222, 0.82);
    box-shadow: 0 0 0 3px rgba(41, 164, 188, 0.22);
  }

  button {
    width: fit-content;
    padding-inline: 1.05rem;
    font-weight: 700;
    background: linear-gradient(130deg, var(--a), var(--b));
    color: #0d1c24;
    border-color: transparent;
    box-shadow: 0 14px 30px rgba(28, 156, 183, 0.35);
    cursor: pointer;
  }

  button:hover {
    transform: translateY(-1px);
    box-shadow: 0 18px 35px rgba(239, 149, 70, 0.35);
  }

  .error {
    margin: 0.25rem 0 0;
    color: #ffb3a9;
    font-weight: 700;
  }

  .error-trace {
    margin: 0.2rem 0 0;
    color: #ffd2cb;
    font-size: 0.84rem;
  }

  .info {
    animation-delay: 60ms;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.7rem;
  }

  .stamp {
    font-size: 0.8rem;
    color: #9eb8c8;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.7rem;
  }

  .meta-grid article {
    border: 1px solid rgba(166, 209, 228, 0.2);
    border-radius: 14px;
    background: rgba(8, 19, 25, 0.52);
    padding: 0.75rem;
  }

  .meta-grid p {
    margin: 0;
  }

  .meta-grid .k {
    color: #8fb0c2;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .meta-grid .v {
    margin-top: 0.38rem;
    font-size: 1.02rem;
    font-weight: 700;
  }

  .meta-grid .sub {
    margin-top: 0.35rem;
    color: #a9c0ce;
    font-size: 0.83rem;
    line-height: 1.35;
  }

  a {
    color: #76d6ea;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .analysis-tabs-panel {
    display: grid;
    gap: 0.9rem;
  }

  .analysis-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    padding: 0.25rem;
    border: 1px solid rgba(155, 205, 227, 0.25);
    border-radius: 13px;
    background: rgba(6, 17, 24, 0.55);
    width: fit-content;
  }

  .analysis-tabs button {
    border: 1px solid rgba(121, 170, 193, 0.26);
    border-radius: 10px;
    background: rgba(15, 40, 52, 0.7);
    color: #d2e4ee;
    box-shadow: none;
    padding: 0.45rem 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.76rem;
  }

  .analysis-tabs button:hover {
    transform: none;
    box-shadow: none;
    border-color: rgba(111, 200, 219, 0.68);
  }

  .analysis-tabs button.active {
    border-color: rgba(124, 208, 227, 0.8);
    background: linear-gradient(
      130deg,
      rgba(37, 173, 196, 0.75),
      rgba(244, 163, 64, 0.65)
    );
    color: #07131a;
  }

  .analysis-view {
    min-width: 0;
    display: grid;
    gap: 0.65rem;
    animation: reveal 0.26s ease both;
  }

  .analysis-view.keep h2 {
    color: #87d7e8;
  }

  .analysis-view.cut h2 {
    color: #ffb77d;
  }

  .analysis-view.add h2 {
    color: #8ee2b7;
  }

  @keyframes reveal {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes drift {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
    }
    50% {
      transform: translate(-14px, 12px) scale(1.05);
    }
  }

  @keyframes sheen {
    0% {
      background-position: 0% 0;
    }
    100% {
      background-position: 210% 0;
    }
  }

  @keyframes metroFlow {
    0%,
    100% {
      background-position: 0% 50%;
      filter: brightness(1);
    }
    50% {
      background-position: 100% 50%;
      filter: brightness(1.03);
    }
  }

  @media (max-width: 760px) {
    .grid.two,
    .grid.three,
    .meta-grid {
      grid-template-columns: 1fr;
    }

    .title-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }

    .stage {
      width: 94vw;
      margin-top: 1rem;
    }

    .progress-shell {
      top: 0.55rem;
    }

    .progress-metro {
      margin-top: 0.58rem;
    }

    .metro-step::after {
      margin: 0 0.28rem;
    }

    .metro-pill {
      width: 1.56rem;
      height: 1.56rem;
      min-width: 1.56rem;
    }

    .metro-number {
      width: 1.56rem;
      min-width: 1.56rem;
      height: 1.56rem;
      font-size: 0.72rem;
    }

    .metro-step.active .metro-pill {
      width: min(14.6rem, 68vw);
      padding-right: 0.4rem;
    }

    .metro-label {
      font-size: 0.56rem;
    }
  }
</style>
