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
  let progressRequestId = "";
  let progressPollTimer: ReturnType<typeof setInterval> | null = null;
  let currentProgressId = "";

  type ProgressPayload = {
    id: string;
    stage:
      | "queued"
      | "moxfield"
      | "commander"
      | "mtgtop8"
      | "analysis"
      | "done"
      | "error";
    percent: number;
    message: string;
    done: boolean;
    error: string | null;
  };

  function startProgress(id: string): void {
    progressRequestId = id;
    currentProgressId = id;
    isSubmitting = true;
    progress = 2;
    progressStageLabel = "Queued";
    progressMessage = "Preparing request...";
    stopProgressPolling();
    startProgressPolling(id);
  }

  function stopProgress(): void {
    stopProgressPolling();
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
    progress = Math.max(progress, Math.min(100, parsed.percent));
    progressMessage = parsed.error || parsed.message;
    progressStageLabel = mapStageLabel(parsed.stage);
    if (parsed.done) {
      stopProgressPolling();
    }
  }

  function startProgressPolling(id: string): void {
    stopProgressPolling();
    void pollProgress(id);
    progressPollTimer = setInterval(() => {
      void pollProgress(id);
    }, 1200);
  }

  function stopProgressPolling(): void {
    if (!progressPollTimer) {
      return;
    }
    clearInterval(progressPollTimer);
    progressPollTimer = null;
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

  function mapStageLabel(stage: ProgressPayload["stage"]): string {
    if (stage === "queued") return "Queued";
    if (stage === "moxfield") return "Moxfield";
    if (stage === "commander") return "Commander";
    if (stage === "mtgtop8") return "MtgTop8";
    if (stage === "analysis") return "Analysis";
    if (stage === "done") return "Done";
    return "Error";
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
        progressStageLabel = "Done";
        progressMessage = "Opening shared permalink...";
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
    </section>
  {/if}

  <section class="panel hero">
    <div class="hero-head">
      <h1>MtG DC Meta Atelier</h1>
      <p class="subtitle">
        Analyze your Moxfield deck against live Duel Commander trends from
        MtgTop8!
      </p>
    </div>

    <form method="POST" class="form" use:enhance={enhanceSubmit}>
      <input type="hidden" name="progressId" value={progressRequestId} />
      <label class="field full">
        <span>Moxfield deck URL</span>
        <input
          name="moxfieldUrl"
          type="text"
          inputmode="url"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          required
          placeholder="https://www.moxfield.com/decks/..."
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
      {#if form?.traceId && form.traceId !== "none"}
        <p class="error-trace">Trace ID: <code>{form.traceId}</code></p>
      {/if}
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
          <p class="sub">{output.moxfieldDeck.deckId}</p>
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
  }
</style>
