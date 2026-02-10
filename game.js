/* Escape the Lab (Upgraded): 4 High-score mini-games + survey blocks
   Tweaks included:
   1) Simon brighter lit state (CSS)
   2) Simon best updates correctly
   3) Memory match: more pairs + ultimate frisbee words
   4) Memory match best updates correctly
   5) Verbal memory: no back-to-back same word
   6) Verbal memory best updates correctly
   7) Math race: 3-second pre-countdown
   8) Math race: include * and / (integer division only)
   9) Math race: 5 seconds per question
   10) Math race best updates correctly
   11) Questions modal scroll (CSS)
   12) Final recap: buttons for each game to replay without questions

   Upload policy:
   - Buffer everything locally during gameplay/questions
   - Upload ONLY on recap page ("end") OR when leaving the page (beforeunload)
*/

const CONFIG = {
  API_ENDPOINT: "https://script.google.com/macros/s/AKfycbzvT75pdKQPT0gSmW09LHMB-XkRNbUg5m22vDHkaazp5cDqv78v8tQ0ukzvcDwAMWgX/exec",
  REQUIRE_PARTICIPANT_CODE: true,
};

const els = {
  screen: document.getElementById("screen"),
  panelTitle: document.getElementById("panelTitle"),
  panelBody: document.getElementById("panelBody"),
  panelActions: document.getElementById("panelActions"),
  status: document.getElementById("status"),
  playerBadge: document.getElementById("playerBadge"),
  roomBadge: document.getElementById("roomBadge"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalOk: document.getElementById("modalOk"),
  modalCancel: document.getElementById("modalCancel"),
};

function setStatus(msg) { els.status.textContent = `Status: ${msg}`; }
function nowISO() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uuidLike() {
  return "xxxxxx-xxxx-4xxx-yxxx-xxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getStored(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function setStored(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function button(label, onClick, cls = "btn primary") {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
function card(title, text) {
  const c = document.createElement("div");
  c.className = "card";
  const h = document.createElement("div");
  h.className = "h1";
  h.textContent = title;
  const p = document.createElement("div");
  p.className = "p";
  p.textContent = text;
  c.appendChild(h); c.appendChild(p);
  return c;
}

/* Modal supports real DOM nodes (keeps event listeners alive) */
function modal({ title, bodyNode = null, bodyHTML = null, okText = "OK", cancelText = null }) {
  return new Promise((resolve) => {
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = "";
    if (bodyNode) els.modalBody.appendChild(bodyNode);
    else if (bodyHTML != null) els.modalBody.innerHTML = bodyHTML;

    els.modalOk.textContent = okText;

    if (cancelText) {
      els.modalCancel.textContent = cancelText;
      els.modalCancel.classList.remove("hidden");
    } else {
      els.modalCancel.classList.add("hidden");
    }

    els.modalBackdrop.classList.remove("hidden");

    const cleanup = () => {
      els.modalBackdrop.classList.add("hidden");
      els.modalOk.removeEventListener("click", okHandler);
      els.modalCancel.removeEventListener("click", cancelHandler);
    };

    const okHandler = () => { cleanup(); resolve({ ok: true }); };
    const cancelHandler = () => { cleanup(); resolve({ ok: false }); };

    els.modalOk.addEventListener("click", okHandler);
    els.modalCancel.addEventListener("click", cancelHandler);
  });
}

/* ---------------- Logging ---------------- */

const session = {
  participantId: getStored("etl_participantId") || null,
  sessionId: getStored("etl_sessionId") || uuidLike(),
  startedAt: getStored("etl_startedAt") || nowISO(),
  stage: getStored("etl_stage") || "start", // start, g1, q1, g2, q2, g3, q3, g4, q4, end
  mode: getStored("etl_mode") || "normal",   // normal | freeplay
};

setStored("etl_sessionId", session.sessionId);
setStored("etl_startedAt", session.startedAt);

function updateBadges() {
  els.playerBadge.textContent = `Player: ${session.participantId || "—"}`;
  els.roomBadge.textContent = `Stage: ${session.stage}${session.mode === "freeplay" ? " (freeplay)" : ""}`;
}

async function postPayload(payload) {
  // Keep a local archive (optional but smart)
  const local = getStored("etl_localLog", []);
  local.push(payload);
  setStored("etl_localLog", local);

  // Buffer for recap/exit-only upload
  const buf = getStored("etl_logBuffer", []);
  buf.push(payload);
  setStored("etl_logBuffer", buf);

  // Never send during gameplay/questions
  return { ok: true, buffered: true };
}

let flushing = false;

async function flushLogs() {
  if (!CONFIG.API_ENDPOINT) return { ok: true, skipped: true };
  if (flushing) return { ok: true, alreadyFlushing: true };

  const buf = getStored("etl_logBuffer", []);
  if (!buf.length) return { ok: true, empty: true };

  flushing = true;
  try {
    await fetch(CONFIG.API_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        kind: "batch",
        participantId: session.participantId,
        sessionId: session.sessionId,
        timestamp: nowISO(),
        stage: session.stage,
        mode: session.mode,
        items: buf
      })
    });

    // Clear buffer after send
    setStored("etl_logBuffer", []);
    return { ok: true };
  } catch (e) {
    // Keep buffer so it can retry later
    setStatus("Upload failed, saved locally (will retry on recap/exit).");
    return { ok: false, error: String(e) };
  } finally {
    flushing = false;
  }
}

/*
  Best-effort flush when the user leaves the page.
  Use sendBeacon because browsers often cancel fetch() during unload.
*/
function flushLogsOnExit() {
  try {
    if (!CONFIG.API_ENDPOINT) return;

    const buf = getStored("etl_logBuffer", []);
    if (!buf.length) return;

    const payload = {
      kind: "batch",
      participantId: session.participantId,
      sessionId: session.sessionId,
      timestamp: nowISO(),
      stage: session.stage,
      mode: session.mode,
      items: buf
    };

    const blob = new Blob([JSON.stringify(payload)], { type: "text/plain;charset=utf-8" });
    const ok = navigator.sendBeacon && navigator.sendBeacon(CONFIG.API_ENDPOINT, blob);

    // If we successfully queued the beacon, clear the buffer so we don't double-post next visit.
    // If it fails, leave it so it can retry on recap next time.
    if (ok) setStored("etl_logBuffer", []);
  } catch {
    // swallow: leaving-page code should never crash the game
  }
}

function basePayload(kind) {
  return {
    kind,
    participantId: session.participantId,
    sessionId: session.sessionId,
    timestamp: nowISO(),
    stage: session.stage,
    mode: session.mode,
    userAgent: navigator.userAgent,
  };
}

async function logEvent(eventType, payload = {}) {
  await postPayload({ ...basePayload("event"), eventType, payload });
}
async function logResponse(questionId, response) {
  await postPayload({ ...basePayload("response"), questionId, response });
}
async function logScore(gameId, runStats, bestStats) {
  await postPayload({ ...basePayload("score"), gameId, runStats, bestStats });
}

/* ---------------- High score storage ---------------- */

function getBest() {
  return getStored("etl_best", {
    simon: { bestLevel: 0 },
    memory: { bestTimeMs: null }, // lower is better
    verbal: { bestScore: 0 },
    math: { bestScore: 0 },
  });
}
function setBest(best) { setStored("etl_best", best); }

function betterTime(newMs, oldMs) {
  if (oldMs == null) return true;
  return newMs < oldMs;
}

/* ---------------- Survey blocks ---------------- */

async function runTerminalSurvey(blockId, questions) {
  const container = document.createElement("div");
  container.className = "terminal";
  container.innerHTML = `
    <div><span class="kbd">TERMINAL</span> Survey block <span class="kbd">${blockId}</span></div>
    <div class="puzzle-hint">Answer to proceed.</div>
  `;

  const form = document.createElement("div");
  form.className = "grid";
  form.style.marginTop = "12px";

  const answers = {};

  for (const q of questions) {
    const qWrap = document.createElement("div");
    qWrap.className = "card";

    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.textContent = q.prompt;
    qWrap.appendChild(title);

    if (q.type === "mc") {
      const optWrap = document.createElement("div");
      optWrap.className = "grid two";
      optWrap.style.marginTop = "10px";

      q.options.forEach((opt) => {
        const label = document.createElement("label");
        label.style.display = "flex";
        label.style.gap = "8px";
        label.style.alignItems = "center";
        label.style.cursor = "pointer";

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = q.id;
        radio.value = opt;
        radio.addEventListener("change", () => { answers[q.id] = opt; });

        const span = document.createElement("span");
        span.textContent = opt;

        label.appendChild(radio);
        label.appendChild(span);
        optWrap.appendChild(label);
      });

      qWrap.appendChild(optWrap);
    } else if (q.type === "text") {
      const ta = document.createElement("textarea");
      ta.placeholder = q.placeholder || "Type here…";
      ta.addEventListener("input", () => { answers[q.id] = ta.value; });
      ta.style.marginTop = "10px";
      qWrap.appendChild(ta);
    }

    const req = document.createElement("div");
    req.className = "puzzle-hint";
    req.textContent = q.required ? "Required" : "Optional";
    qWrap.appendChild(req);

    form.appendChild(qWrap);
  }

  container.appendChild(form);

  await modal({ title: "Terminal Interaction", bodyNode: container, okText: "Submit" });

  for (const q of questions) {
    if (q.required) {
      const v = answers[q.id];
      if (q.type === "mc" && !v) {
        await modal({ title: "Terminal Error", bodyHTML: `<div class="fail">Missing: <span class="kbd">${q.id}</span></div>`, okText: "Try again" });
        return await runTerminalSurvey(blockId, questions);
      }
      if (q.type === "text" && (!v || !v.trim())) {
        await modal({ title: "Terminal Error", bodyHTML: `<div class="fail">Missing: <span class="kbd">${q.id}</span></div>`, okText: "Try again" });
        return await runTerminalSurvey(blockId, questions);
      }
    }
  }

  for (const q of questions) {
    await logResponse(q.id, answers[q.id] ?? null);
  }
  await logEvent("survey_block_complete", { blockId, questions: questions.map(q => q.id) });

  return answers;
}

/* ---------------- Flow control ---------------- */

function setStage(stage) {
  session.stage = stage;
  setStored("etl_stage", stage);
  updateBadges();
  render();
}
function setMode(mode) {
  session.mode = mode;
  setStored("etl_mode", mode);
  updateBadges();
}

function render() {
  clearNode(els.screen);
  clearNode(els.panelBody);
  clearNode(els.panelActions);
  updateBadges();

  if (!session.participantId) return renderStart();

  switch (session.stage) {
    case "start": return renderHub();
    case "g1": return renderSimon();
    case "q1": return renderSurvey1();
    case "g2": return renderMemoryTimed();
    case "q2": return renderSurvey2();
    case "g3": return renderVerbalMemory();
    case "q3": return renderSurvey3();
    case "g4": return renderMathRace();
    case "q4": return renderSurvey4();
    case "end": return renderEnd();
    default: return renderHub();
  }
}

function renderStart() {
  els.screen.appendChild(card("Escape the Lab", "With some fun ;)."));
  const box = document.createElement("div");
  box.className = "card";
  box.innerHTML = `
  <div class="h1">Your Name</div>
  <div class="p">Type your name so your scores and answers are labeled correctly.</div>
  <input id="pidInput" class="input" placeholder="Enter your name here" />
`;
  els.screen.appendChild(box);

  els.panelTitle.textContent = "Start";
  els.panelBody.textContent = "Enter name, then begin.";
  els.panelActions.appendChild(button("Start", async () => {
    const pid = document.getElementById("pidInput").value.trim();
    if (CONFIG.REQUIRE_PARTICIPANT_CODE && !pid) {
      await modal({ title: "Nope", bodyHTML: "Enter your name.", okText: "Fine" });
      return;
    }
    session.participantId = pid || `anon_${session.sessionId.slice(0,6)}`;
    setStored("etl_participantId", session.participantId);
    setMode("normal");
    await logEvent("session_start", { startedAt: session.startedAt });
    setStage("start");
    setStatus("Ready.");
  }, "btn ok"));
}

function renderHub() {
  els.screen.appendChild(card(
    "Lab Corridor",
    "There are 4 games and 4 question sections. After each game, you’ll answer questions, then move on to the next game."
  ));

  const info = document.createElement("div");
  info.className = "card";
  info.innerHTML = `
    <div class="h1">How this works</div>
    <div class="p">
      Each game ends when you fail (or finish). You can retry any game to improve your score/time.
      New high scores are saved automatically.
    </div>
    <div class="puzzle-hint">Tip: Try each game multiple times. The lab respects effort. Kind of.</div>
  `;
  els.screen.appendChild(info);

  els.panelTitle.textContent = "Begin";
  els.panelBody.textContent = "Start Game 1 when ready.";
  els.panelActions.appendChild(button("Begin Game 1: Simon Says", async () => {
    setMode("normal");
    await logEvent("enter_game", { game: "simon" });
    setStage("g1");
  }, "btn ok"));
}

/* ---------------- Game 1: Simon Says ---------------- */

function renderSimon() {
  async function preCountdown() {
  setSimonStatus("Get ready...");
  Object.values(btnEls).forEach(b => b.disabled = true);

  for (let i = 3; i >= 1; i--) {
    setSimonStatus(`Starting in ${i}...`);
    await sleep(900);
  }
  setSimonStatus("GO!");
  await sleep(250);
  }
  const best = getBest();

  els.screen.appendChild(card("Game 1: Simon Says", "Repeat the sequence. Lose when you click wrong."));

  const hud = document.createElement("div");
  hud.className = "game-hud";
  hud.innerHTML = `
    <div class="hud-pill">Level: <span id="simonLevel">0</span></div>
    <div class="hud-pill">Best: <span id="simonBest">${best.simon.bestLevel}</span></div>
    <div class="hud-pill">Status: <span id="simonStatus">Press Start</span></div>
  `;
  els.screen.appendChild(hud);

  const grid = document.createElement("div");
  grid.className = "simon-grid";

  const colors = [
    { id: "red", cls: "simon-btn simon-red" },
    { id: "blue", cls: "simon-btn simon-blue" },
    { id: "green", cls: "simon-btn simon-green" },
    { id: "yellow", cls: "simon-btn simon-yellow" },
  ];

  const btnEls = {};
  colors.forEach(c => {
    const b = document.createElement("button");
    b.className = c.cls;
    b.disabled = true;
    b.addEventListener("click", () => simonHandleClick(c.id));
    btnEls[c.id] = b;
    grid.appendChild(b);
  });

  els.screen.appendChild(grid);

  let seq = [];
  let userIdx = 0;
  let level = 0;
  let accepting = false;

  const statusEl = () => document.getElementById("simonStatus");
  const levelEl = () => document.getElementById("simonLevel");
  const bestEl = () => document.getElementById("simonBest");

  function setSimonStatus(t) { statusEl().textContent = t; }
  function setSimonLevel(n) { levelEl().textContent = String(n); }

  async function flash(id, ms = 420) {
    const b = btnEls[id];
    b.classList.add("lit");
    await sleep(ms);
    b.classList.remove("lit");
    await sleep(140);
  }

  async function playSeq() {
    accepting = false;
    Object.values(btnEls).forEach(b => b.disabled = true);
    setSimonStatus("Watch");
    for (const id of seq) await flash(id);
    setSimonStatus("Your turn");
    userIdx = 0;
    accepting = true;
    Object.values(btnEls).forEach(b => b.disabled = false);
  }

  async function nextRound() {
    level += 1;
    setSimonLevel(level);
    const pick = colors[Math.floor(Math.random() * colors.length)].id;
    seq.push(pick);
    await logEvent("simon_round_start", { level, seqLen: seq.length });
    await playSeq();
  }

  async function exitAfterGame() {
    // normal flow goes to questions, freeplay returns to recap
    if (session.mode === "freeplay") setStage("end");
    else setStage("q1");
  }

  async function gameOver() {
    accepting = false;
    Object.values(btnEls).forEach(b => b.disabled = true);
    setSimonStatus("Game over");

    const bestNow = getBest();
    let improved = false;

    if (level > bestNow.simon.bestLevel) {
      bestNow.simon.bestLevel = level;
      setBest(bestNow);
      improved = true;
      bestEl().textContent = String(bestNow.simon.bestLevel);
    }

    await logScore("simon", { level, improved }, { bestLevel: getBest().simon.bestLevel });
    await logEvent("game_over", { game: "simon", level });

    const node = document.createElement("div");
    node.innerHTML = `
      <div>Final level: <span class="kbd">${level}</span></div>
      <div class="puzzle-hint">${improved ? "<span class='success'>New best!</span>" : "Try again if you want."}</div>
    `;

    const res = await modal({
      title: "Simon Says",
      bodyNode: node,
      okText: "Try again",
      cancelText: session.mode === "freeplay" ? "Back to recap" : "Continue to Questions"
    });

    if (res.ok) {
      seq = []; userIdx = 0; level = 0;
      setSimonLevel(0);
      setSimonStatus("Restarting");
      await preCountdown();
      await nextRound();
    } else {
      await exitAfterGame();
    }
  }

  async function simonHandleClick(id) {
    if (!accepting) return;
    await flash(id, 170);

    if (id !== seq[userIdx]) {
      await logEvent("simon_miss", { level, expected: seq[userIdx], got: id, idx: userIdx });
      return await gameOver();
    }

    userIdx += 1;
    await logEvent("simon_hit", { level, idx: userIdx });

    if (userIdx === seq.length) {
      setSimonStatus("Correct");
      Object.values(btnEls).forEach(b => b.disabled = true);
      await sleep(280);
      await nextRound();
    }
  }

  window.simonHandleClick = simonHandleClick;

  els.panelTitle.textContent = "Simon";
  els.panelBody.textContent = "Press Start, repeat the sequence.";
els.panelActions.appendChild(button("Start", async () => {
  seq = []; userIdx = 0; level = 0;
  setSimonLevel(0);
  await preCountdown();
  await nextRound();
}, "btn ok"));

  els.panelActions.appendChild(button(session.mode === "freeplay" ? "Back to recap" : "Continue", async () => {
    await (session.mode === "freeplay" ? setStage("end") : setStage("q1"));
  }, "btn secondary"));
}

/* ---------------- Surveys ---------------- */

function renderSurvey1() {
  els.screen.appendChild(card("Terminal Block 1", "Answer a few questions, then proceed."));
  els.panelTitle.textContent = "Questions 1";
  els.panelBody.textContent = "Survey block 1.";
  els.panelActions.appendChild(button("Open Terminal", async () => {
    await runTerminalSurvey("Q1", [
      { id: "Q1_mood", type: "mc", prompt: "How locked in are you?", options: ["Not at all", "Somewhat", "Fully dialed"], required: true },
      { id: "Q1_simon_strategy", type: "mc", prompt: "Simon strategy?", options: ["Pure memory", "Chunking", "Random hope"], required: true },
      { id: "Q1_comment", type: "text", prompt: "One sentence about the experience so far:", placeholder: "It felt...", required: true },
    ]);
    setStage("g2");
  }, "btn ok"));
}

function renderSurvey2() {
  els.screen.appendChild(card("Terminal Block 2", "More questions."));
  els.panelTitle.textContent = "Questions 2";
  els.panelBody.textContent = "Survey block 2.";
  els.panelActions.appendChild(button("Open Terminal", async () => {
    await runTerminalSurvey("Q2", [
      { id: "Q2_pressure", type: "mc", prompt: "How stressful was the timer?", options: ["Not stressful", "Medium", "High"], required: true },
      { id: "Q2_memory_feel", type: "mc", prompt: "Memory game felt:", options: ["Fair", "Tricky", "Rude"], required: true },
      { id: "Q2_notes", type: "text", prompt: "What did you do to go faster?", placeholder: "I tried...", required: true },
    ]);
    setStage("g3");
  }, "btn ok"));
}

function renderSurvey3() {
  els.screen.appendChild(card("Terminal Block 3", "Almost done."));
  els.panelTitle.textContent = "Questions 3";
  els.panelBody.textContent = "Survey block 3.";
  els.panelActions.appendChild(button("Open Terminal", async () => {
    await runTerminalSurvey("Q3", [
      { id: "Q3_focus", type: "mc", prompt: "How focused were you?", options: ["Low", "Medium", "High"], required: true },
      { id: "Q3_verbal_difficulty", type: "mc", prompt: "Verbal memory difficulty:", options: ["Easy", "Medium", "Hard"], required: true },
      { id: "Q3_feedback", type: "text", prompt: "One improvement suggestion:", placeholder: "I would change...", required: true },
    ]);
    setStage("g4");
  }, "btn ok"));
}

function renderSurvey4() {
  els.screen.appendChild(card("Terminal Block 4", "Final questions."));
  els.panelTitle.textContent = "Questions 4";
  els.panelBody.textContent = "Survey block 4.";
  els.panelActions.appendChild(button("Open Terminal", async () => {
    await runTerminalSurvey("Q4", [
      { id: "Q4_math_fun", type: "mc", prompt: "Math race felt:", options: ["Fun", "Okay", "Pain"], required: true },
      { id: "Q4_overall", type: "mc", prompt: "Overall experience:", options: ["Good", "Neutral", "Bad"], required: true },
      { id: "Q4_final", type: "text", prompt: "Any final comment:", placeholder: "Final thoughts...", required: true },
    ]);
    await logEvent("session_complete", { finishedAt: nowISO() });
    setStage("end");
  }, "btn ok"));
}

/* ---------------- Game 2: Timed Memory Match (more pairs, frisbee words) ---------------- */

function renderMemoryTimed() {
  const best = getBest();
  els.screen.appendChild(card("Game 2: Memory Match (Timed)", "Match all pairs as fast as possible. Beat your best time."));

  const hud = document.createElement("div");
  hud.className = "game-hud";
  hud.innerHTML = `
    <div class="hud-pill">Time: <span id="memTime">0.00</span>s</div>
    <div class="hud-pill">Matches: <span id="memMatches">0</span>/<span id="memTotal">12</span></div>
    <div class="hud-pill">Best: <span id="memBest">${best.memory.bestTimeMs == null ? "—" : (best.memory.bestTimeMs/1000).toFixed(2) + "s"}</span></div>
  `;
  els.screen.appendChild(hud);

  const TOTAL_PAIRS = 8; // more matches

  let state = initMemoryState(TOTAL_PAIRS);
  let first = null;
  let lock = false;
  let matches = 0;
  let start = null;
  let timerInt = null;

  document.getElementById("memTotal").textContent = String(TOTAL_PAIRS);

  const grid = document.createElement("div");
  grid.className = "memory-grid";
  els.screen.appendChild(grid);

  function updateHUD() {
    document.getElementById("memMatches").textContent = String(matches);
  }

  function tick() {
    const t = (performance.now() - start) / 1000;
    document.getElementById("memTime").textContent = t.toFixed(2);
  }

  function setBestLabel() {
    const b = getBest().memory.bestTimeMs;
    document.getElementById("memBest").textContent = (b == null) ? "—" : (b/1000).toFixed(2) + "s";
  }

  function renderGrid() {
    grid.innerHTML = "";
    state.cards.forEach((c, idx) => {
      const b = document.createElement("button");
      b.className = "mem-card";
      if (c.matched) b.classList.add("matched");
      if (c.revealed) b.classList.add("revealed");
      b.textContent = (c.revealed || c.matched) ? c.value : "???";
      b.disabled = c.matched;

      b.addEventListener("click", async () => {
        if (lock) return;
        if (!start) {
          start = performance.now();
          timerInt = setInterval(tick, 50);
          await logEvent("memory_timer_start", {});
        }
        if (c.matched || c.revealed) return;

        c.revealed = true;
        renderGrid();

        if (first == null) {
          first = idx;
          await logEvent("memory_pick", { idx, value: c.value, which: "first" });
          return;
        }

        lock = true;
        await logEvent("memory_pick", { idx, value: c.value, which: "second" });

        const a = state.cards[first];
        const b2 = state.cards[idx];

        if (a.value === b2.value) {
          a.matched = true;
          b2.matched = true;
          matches += 1;
          updateHUD();
          await logEvent("memory_match", { value: a.value, matches });
        } else {
          await logEvent("memory_miss", { a: a.value, b: b2.value });
          await sleep(650);
          a.revealed = false;
          b2.revealed = false;
        }

        first = null;
        lock = false;
        renderGrid();

        if (matches === TOTAL_PAIRS) {
          clearInterval(timerInt);
          const timeMs = Math.round(performance.now() - start);

          const bestNow = getBest();
          let improved = false;
          if (betterTime(timeMs, bestNow.memory.bestTimeMs)) {
            bestNow.memory.bestTimeMs = timeMs;
            setBest(bestNow);
            improved = true;
            setBestLabel();
          }

          await logScore("memory", { timeMs, improved }, { bestTimeMs: getBest().memory.bestTimeMs });

          const node = document.createElement("div");
          node.innerHTML = `
            <div>Time: <span class="kbd">${(timeMs/1000).toFixed(2)}s</span></div>
            <div class="puzzle-hint">${improved ? "<span class='success'>New best time!</span>" : "Try again to beat it."}</div>
          `;

          const res = await modal({
            title: "Memory Match Complete",
            bodyNode: node,
            okText: "Try again",
            cancelText: session.mode === "freeplay" ? "Back to recap" : "Continue to Questions"
          });

          if (res.ok) {
            state = initMemoryState(TOTAL_PAIRS);
            first = null; lock = false; matches = 0;
            start = null;
            document.getElementById("memTime").textContent = "0.00";
            updateHUD();
            renderGrid();
          } else {
            if (session.mode === "freeplay") setStage("end");
            else setStage("q2");
          }
        }
      });

      grid.appendChild(b);
    });
  }

  renderGrid();
  updateHUD();
  setBestLabel();

  els.panelTitle.textContent = "Memory Match";
  els.panelBody.textContent = "Timer starts on first flip.";
  els.panelActions.appendChild(button("Restart", async () => {
    if (timerInt) clearInterval(timerInt);
    state = initMemoryState(TOTAL_PAIRS);
    first = null; lock = false; matches = 0;
    start = null;
    document.getElementById("memTime").textContent = "0.00";
    updateHUD();
    renderGrid();
    setBestLabel();
    await logEvent("memory_restart", {});
  }, "btn secondary"));

  els.panelActions.appendChild(button(session.mode === "freeplay" ? "Back to recap" : "Continue to Questions", async () => {
    if (session.mode === "freeplay") setStage("end");
    else setStage("q2");
  }, "btn ok"));
}

function initMemoryState(pairs) {
  // Ultimate frisbee-related pairs (expand as needed)
  const base = [
    "disc","handler","cutter","huck","layout","mark",
    "stack","zone","pull","flick","backhand","forehand",
    "dump","swing","break","bid","stall","sideline",
    "reset","poach","clapcatch","endzone","upline","pivot"
  ];

  // pick N unique words
  const pool = shuffle([...base]).slice(0, pairs);
  const values = shuffle(pool.flatMap(w => [w, w])); // make pairs and shuffle

  return { cards: values.map(v => ({ value: v, revealed: false, matched: false })) };
}

/* ---------------- Game 3: Verbal Memory (no back-to-back) ---------------- */

function renderVerbalMemory() {
  const best = getBest();
  els.screen.appendChild(card("Game 3: Verbal Memory", "Seen or New. 3 lives. No back-to-back repeats."));

  const hud = document.createElement("div");
  hud.className = "game-hud";
  hud.innerHTML = `
    <div class="hud-pill">Score: <span id="vmScore">0</span></div>
    <div class="hud-pill">Lives: <span id="vmLives">3</span></div>
    <div class="hud-pill">Best: <span id="vmBest">${best.verbal.bestScore}</span></div>
  `;
  els.screen.appendChild(hud);

  const wordBox = document.createElement("div");
  wordBox.className = "word-card";
  wordBox.id = "vmWord";
  els.screen.appendChild(wordBox);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.marginTop = "12px";
  els.screen.appendChild(actions);

  let score = 0;
  let lives = 3;
  const seen = new Set();
  let current = null;
  let lastWord = null;

  let pool = buildWordPool();

  function setBestLabel() {
    document.getElementById("vmBest").textContent = String(getBest().verbal.bestScore);
  }

  function nextWord() {
    // 65% chance new word if available, else repeat, but never back-to-back same
    let chooseRepeat = Math.random() < 0.35 && seen.size > 0;
    if (pool.length === 0) chooseRepeat = true;

    if (chooseRepeat) {
      let arr = Array.from(seen).filter(w => w !== lastWord);
      if (arr.length === 0) {
        // only possible repeat is lastWord; if we still have new words, force new
        if (pool.length > 0) chooseRepeat = false;
        else arr = Array.from(seen); // unavoidable
      }
      if (chooseRepeat) current = arr[Math.floor(Math.random() * arr.length)];
    }
    if (!chooseRepeat) {
      // ensure new isn't equal to lastWord (rare but handle)
      let tries = 0;
      do {
        current = pool.pop();
        tries += 1;
      } while (current === lastWord && pool.length > 0 && tries < 5);
    }

    lastWord = current;
    wordBox.textContent = current;
  }

  function updateHUD() {
    document.getElementById("vmScore").textContent = String(score);
    document.getElementById("vmLives").textContent = String(lives);
  }

  async function pick(choice) {
    const isSeen = seen.has(current);
    const correct = (choice === "seen") ? isSeen : !isSeen;

    await logEvent("verbal_pick", { word: current, choice, isSeen, correct });

    // After any display, it is now "seen"
    seen.add(current);

    if (correct) {
      score += 1;
      updateHUD();
      nextWord();
    } else {
      lives -= 1;
      updateHUD();
      if (lives <= 0) {
        await gameOver();
      } else {
        nextWord();
      }
    }
  }

  async function gameOver() {
    const bestNow = getBest();
    let improved = false;
    if (score > bestNow.verbal.bestScore) {
      bestNow.verbal.bestScore = score;
      setBest(bestNow);
      improved = true;
      setBestLabel();
    }

    await logScore("verbal", { score, improved }, { bestScore: getBest().verbal.bestScore });
    await logEvent("game_over", { game: "verbal", score });

    const node = document.createElement("div");
    node.innerHTML = `
      <div>Score: <span class="kbd">${score}</span></div>
      <div class="puzzle-hint">${improved ? "<span class='success'>New best!</span>" : "Try again."}</div>
    `;

    const res = await modal({
      title: "Verbal Memory",
      bodyNode: node,
      okText: "Try again",
      cancelText: session.mode === "freeplay" ? "Back to recap" : "Continue to Questions"
    });

    if (res.ok) {
      score = 0; lives = 3;
      seen.clear();
      lastWord = null;
      pool = buildWordPool();
      updateHUD();
      setBestLabel();
      nextWord();
    } else {
      if (session.mode === "freeplay") setStage("end");
      else setStage("q3");
    }
  }

  actions.appendChild(button("Seen", () => pick("seen"), "btn primary"));
  actions.appendChild(button("New", () => pick("new"), "btn primary"));

  nextWord();
  updateHUD();
  setBestLabel();

  els.panelTitle.textContent = "Verbal Memory";
  els.panelBody.textContent = "Lock in";
  els.panelActions.appendChild(button(session.mode === "freeplay" ? "Back to recap" : "Continue to Questions", async () => {
    if (session.mode === "freeplay") setStage("end");
    else setStage("q3");
  }, "btn ok"));
}

function buildWordPool() {
  const words = [
    "disc","handler","cutter","huck","layout","mark","stack","zone","pull","flick","backhand","forehand",
    "dump","swing","break","bid","stall","sideline","reset","poach","upline","pivot","cup","force",
    "deep","under","sidestack","vert","iso","brick","turnover","callahan","hammer","scoober","blade",
    "sky","clapcatch","pancake","toe-drag","endzone","line","D-line","O-line","pull-play","handler-set"
  ];
  return shuffle([...words]);
}

/* ---------------- Game 4: Math Race (countdown, 5s, + - * /) ---------------- */

function renderMathRace() {
  const best = getBest();
  els.screen.appendChild(card("Game 4: Math Race", "5 seconds per question."));

  const hud = document.createElement("div");
  hud.className = "game-hud";
  hud.innerHTML = `
    <div class="hud-pill">Score: <span id="mrScore">0</span></div>
    <div class="hud-pill">Lives: <span id="mrLives">3</span></div>
    <div class="hud-pill">Time: <span id="mrTime">5.00</span>s</div>
    <div class="hud-pill">Best: <span id="mrBest">${best.math.bestScore}</span></div>
  `;
  els.screen.appendChild(hud);

  const eq = document.createElement("div");
  eq.className = "big-answer";
  eq.id = "mrEq";
  eq.textContent = "Get ready…";
  els.screen.appendChild(eq);

  const inputWrap = document.createElement("div");
  inputWrap.style.marginTop = "12px";
  inputWrap.innerHTML = `
    <input id="mrAns" class="input" placeholder="Type answer and press Enter" />
    <div class="puzzle-hint">Tip: division is always a whole number.</div>
  `;
  els.screen.appendChild(inputWrap);

  const ansEl = () => document.getElementById("mrAns");

  let score = 0;
  let lives = 3;
  let difficulty = 1;
  let current = null;
  let deadline = null;
  let timer = null;
  let started = false;

  function updateHUD() {
    document.getElementById("mrScore").textContent = String(score);
    document.getElementById("mrLives").textContent = String(lives);
  }
  function setBestLabel() {
    document.getElementById("mrBest").textContent = String(getBest().math.bestScore);
  }

  function makeProblem() {
    // include / by constructing divisible problems
    const opsByDiff = (d) => {
      if (d <= 2) return ["+","-","*"];
      return ["+","-","*","/"];
    };
    const ops = opsByDiff(difficulty);
    const op = ops[Math.floor(Math.random() * ops.length)];

    let a, b, answer, text;

    if (op === "/") {
      // Build: (a*b) / b so it's integer
      b = randInt(2, difficulty <= 3 ? 9 : 12);
      a = randInt(2, difficulty <= 3 ? 12 : 20);
      const prod = a * b;
      answer = a;
      text = `${prod} / ${b}`;
    } else {
      if (difficulty === 1) { a = randInt(1, 9); b = randInt(1, 9); }
      else if (difficulty === 2) { a = randInt(5, 20); b = randInt(5, 20); }
      else if (difficulty === 3) { a = randInt(8, 35); b = randInt(2, 12); }
      else if (difficulty === 4) { a = randInt(20, 70); b = randInt(10, 50); }
      else { a = randInt(30, 120); b = randInt(2, 25); }

      if (op === "+") answer = a + b;
      if (op === "-") answer = a - b;
      if (op === "*") answer = a * b;
      text = `${a} ${op} ${b}`;
    }

    return { a, b, op, answer, text };
  }

  async function preCountdown() {
    ansEl().disabled = true;
    for (let i = 3; i >= 1; i--) {
      eq.textContent = `Starting in ${i}…`;
      await sleep(900);
    }
    eq.textContent = "GO!";
    await sleep(250);
    ansEl().disabled = false;
    ansEl().focus();
    started = true;
    showProblem();
  }

  function showProblem() {
    current = makeProblem();
    eq.textContent = current.text;
    ansEl().value = "";
    ansEl().focus();

    const PER_Q_MS = 5000; // 5 seconds
    deadline = performance.now() + PER_Q_MS;

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const left = Math.max(0, (deadline - performance.now()) / 1000);
      document.getElementById("mrTime").textContent = left.toFixed(2);
      if (left <= 0) {
        clearInterval(timer);
        onTimeout();
      }
    }, 30);
  }

  async function onTimeout() {
    lives -= 1;
    updateHUD();
    await logEvent("math_timeout", { problem: current.text, answer: current.answer, difficulty });
    if (lives <= 0) return await gameOver();
    showProblem();
  }

  async function submit() {
    if (!started) return;
    const val = ansEl().value.trim();
    if (val === "") return;

    const num = Number(val);
    const correct = Number.isFinite(num) && num === current.answer;
    await logEvent("math_submit", { problem: current.text, input: val, correct, answer: current.answer, difficulty });

    if (correct) {
      score += 1;
      if (score % 5 === 0) difficulty += 1;
      updateHUD();
      showProblem();
    } else {
      lives -= 1;
      updateHUD();
      if (lives <= 0) return await gameOver();
      showProblem();
    }
  }

  async function gameOver() {
    if (timer) clearInterval(timer);

    const bestNow = getBest();
    let improved = false;
    if (score > bestNow.math.bestScore) {
      bestNow.math.bestScore = score;
      setBest(bestNow);
      improved = true;
      setBestLabel();
    }

    await logScore("math", { score, improved }, { bestScore: getBest().math.bestScore });
    await logEvent("game_over", { game: "math", score });

    const node = document.createElement("div");
    node.innerHTML = `
      <div>Score: <span class="kbd">${score}</span></div>
      <div class="puzzle-hint">${improved ? "<span class='success'>New best!</span>" : "Retry if you want."}</div>
    `;

    const res = await modal({
      title: "Math Race",
      bodyNode: node,
      okText: "Try again",
      cancelText: session.mode === "freeplay" ? "Back to recap" : "Continue to Questions"
    });

    if (res.ok) {
      score = 0; lives = 3; difficulty = 1;
      updateHUD();
      setBestLabel();
      started = false;
      await preCountdown();
    } else {
      if (session.mode === "freeplay") setStage("end");
      else setStage("q4");
    }
  }

  ansEl().addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  updateHUD();
  setBestLabel();
  preCountdown();

  els.panelTitle.textContent = "Math Race";
  els.panelBody.textContent = "5 seconds each. Countdown included.";
  els.panelActions.appendChild(button(session.mode === "freeplay" ? "Back to recap" : "Continue to Questions", async () => {
    if (session.mode === "freeplay") setStage("end");
    else setStage("q4");
  }, "btn ok"));
}

/* ---------------- End: replay each game without questions ---------------- */

function renderEnd() {
  // Upload when reaching recap page
  flushLogs();

  const best = getBest();
  els.screen.appendChild(card("You Escaped", "Your responses have been saved and submitted, but get a highscore. The leaderboard will be posted in #ride-responses"));

  const c = document.createElement("div");
  c.className = "card";
  c.innerHTML = `
    <div class="h1">Best Scores</div>
    <div class="p"><span class="kbd">Simon</span> best level: ${best.simon.bestLevel}</div>
    <div class="p"><span class="kbd">Memory</span> best time: ${best.memory.bestTimeMs == null ? "—" : (best.memory.bestTimeMs/1000).toFixed(2) + "s"}</div>
    <div class="p"><span class="kbd">Verbal</span> best score: ${best.verbal.bestScore}</div>
    <div class="p"><span class="kbd">Math</span> best score: ${best.math.bestScore}</div>
    <div class="puzzle-hint">
  Your responses have been sent. Every time you set a new high score, it’s saved and updated too.
  Replay the games on the right panel to improve your scores.
</div>
  `;
  els.screen.appendChild(c);

  els.panelTitle.textContent = "Freeplay";
  els.panelBody.textContent = "Pick a game to replay. Bests still save and log.";

  const go = (stage) => {
    setMode("freeplay");
    setStage(stage);
  };

  els.panelActions.appendChild(button("Play Simon", () => go("g1"), "btn ok"));
  els.panelActions.appendChild(button("Play Memory Match", () => go("g2"), "btn ok"));
  els.panelActions.appendChild(button("Play Verbal Memory", () => go("g3"), "btn ok"));
  els.panelActions.appendChild(button("Play Math Race", () => go("g4"), "btn ok"));

  els.panelActions.appendChild(button("Submit Another Response", async () => {
    [
      "etl_participantId","etl_sessionId","etl_startedAt","etl_stage",
      "etl_best","etl_localLog","etl_mode"
    ].forEach(k => localStorage.removeItem(k));
    location.reload();
  }, "btn danger"));
}

/* ---------------- Utils ---------------- */

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- Boot ---------------- */
(function init() {
  // Step 4: Upload on leaving the page (best-effort, no lag)
  window.addEventListener("beforeunload", () => {
    flushLogsOnExit();
  });

  updateBadges();
  setStatus("Loaded.");
  if (!session.participantId) {
    setStage("start");
  } else {
    render();
  }

})();
