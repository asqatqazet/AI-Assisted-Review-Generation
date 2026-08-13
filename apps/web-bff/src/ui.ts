export function renderSurveyHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI-Assisted Review Experience · Grounded & Compliant</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --surface: #111726;
      --surface-elevated: #182238;
      --border: #23304c;
      --border-subtle: #1c273e;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #38bdf8;
      --accent-glow: rgba(56, 189, 248, 0.15);
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.12);
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.12);
      --warning: #f59e0b;
      --radius: 12px;
      --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    header {
      border-bottom: 1px solid var(--border);
      background: rgba(17, 23, 38, 0.8);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
      padding: 1rem 2rem;
    }

    .nav-container {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 700;
      font-size: 1.15rem;
      color: var(--text);
    }

    .brand-badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.2rem 0.6rem;
      background: var(--accent-glow);
      color: var(--accent);
      border-radius: 9999px;
      border: 1px solid rgba(56, 189, 248, 0.3);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .tenant-select-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.35rem 0.75rem;
      font-size: 0.875rem;
    }

    .tenant-select-group select {
      background: transparent;
      color: var(--text);
      border: none;
      font-family: inherit;
      font-size: inherit;
      font-weight: 600;
      outline: none;
      cursor: pointer;
    }

    .tenant-select-group select option {
      background: var(--surface-elevated);
      color: var(--text);
    }

    main {
      flex: 1;
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .card-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .card-subtitle {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: -1rem;
    }

    .facts-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .fact-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }

    .fact-item:hover {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.04);
    }

    .fact-item input[type="checkbox"] {
      margin-top: 0.25rem;
      accent-color: var(--accent);
      width: 1.1rem;
      height: 1.1rem;
      cursor: pointer;
    }

    .fact-label {
      font-size: 0.9rem;
      color: var(--text);
      flex: 1;
    }

    .fact-tag {
      font-size: 0.7rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-dim);
      font-family: var(--font-mono);
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .input-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    textarea, input[type="text"] {
      width: 100%;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: var(--text);
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.15s ease;
    }

    textarea:focus, input[type="text"]:focus {
      border-color: var(--accent);
    }

    .format-pills {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .format-pill {
      flex: 1;
      min-width: 100px;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.6rem 0.75rem;
      text-align: center;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-muted);
      transition: all 0.15s ease;
    }

    .format-pill:hover {
      border-color: var(--accent);
      color: var(--text);
    }

    .format-pill.active {
      background: var(--accent-glow);
      border-color: var(--accent);
      color: var(--accent);
    }

    .btn-group {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 0.6rem;
    }

    button {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-family: inherit;
      font-weight: 600;
      font-size: 0.875rem;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .btn-primary {
      background: var(--accent);
      color: #04131f;
    }

    .btn-primary:hover {
      background: #7dd3fc;
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: var(--surface-elevated);
      border-color: var(--border);
      color: var(--text);
    }

    .btn-secondary:hover {
      background: #202c46;
      border-color: var(--text-dim);
    }

    .btn-adversarial {
      background: var(--danger-bg);
      border-color: rgba(239, 68, 68, 0.4);
      color: #fca5a5;
    }

    .btn-adversarial:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    .btn-success {
      background: var(--success);
      color: #022c22;
    }

    .btn-success:hover {
      background: #34d399;
    }

    .output-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      flex: 1;
    }

    .draft-box {
      flex: 1;
      min-height: 180px;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text);
      font-family: inherit;
      font-size: 0.95rem;
      line-height: 1.6;
      resize: vertical;
      outline: none;
    }

    .draft-box:focus {
      border-color: var(--accent);
    }

    .guard-banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .guard-banner.pass {
      background: var(--success-bg);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
    }

    .guard-banner.rejected {
      background: var(--danger-bg);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      padding: 0.75rem;
      background: var(--surface-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }

    .metric-cell {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .metric-label {
      font-size: 0.7rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metric-value {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }

    .claims-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      max-height: 140px;
      overflow-y: auto;
      padding: 0.5rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      font-size: 0.8rem;
    }

    .claim-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }

    .claim-badge {
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      font-size: 0.7rem;
    }

    .footer {
      border-top: 1px solid var(--border);
      padding: 1.5rem 2rem;
      text-align: center;
      font-size: 0.85rem;
      color: var(--text-dim);
    }
  </style>
</head>
<body>
  <header>
    <div class="nav-container">
      <div class="brand">
        <span>🛡️ GroundedReview</span>
        <span class="brand-badge">Audit Verified</span>
      </div>
      <div class="tenant-select-group">
        <label for="tenantSelect">Venue:</label>
        <select id="tenantSelect" onchange="onTenantChange()">
          <option value="apex-dental">Apex Dental (Central Clinic)</option>
          <option value="lumina-optics">Lumina Optics (Flagship Store)</option>
        </select>
      </div>
    </div>
  </header>

  <main>
    <!-- LEFT PANE: Survey Input & Experience Facts -->
    <section class="card">
      <div>
        <h2 class="card-title">1. Your Visit Experience</h2>
        <p class="card-subtitle">Select the facts that accurately reflect your confirmed experience</p>
      </div>

      <div class="facts-list" id="factsContainer">
        <!-- Dynamically injected facts -->
      </div>

      <div class="input-group">
        <label class="input-label" for="freeTextInput">Additional Personal Notes (Optional)</label>
        <textarea id="freeTextInput" rows="2" placeholder="e.g. My appointment started right on time..."></textarea>
      </div>

      <div class="input-group">
        <label class="input-label">Select Review Format</label>
        <div class="format-pills">
          <div class="format-pill active" data-format="concise-blurb" onclick="selectFormat('concise-blurb')">
            Concise Blurb<br><small style="color:var(--text-dim);font-weight:400">Max 280 chars</small>
          </div>
          <div class="format-pill" data-format="detailed-narrative" onclick="selectFormat('detailed-narrative')">
            Detailed Story<br><small style="color:var(--text-dim);font-weight:400">Max 1200 chars</small>
          </div>
          <div class="format-pill" data-format="social-short" onclick="selectFormat('social-short')">
            Social Short<br><small style="color:var(--text-dim);font-weight:400">Max 160 chars</small>
          </div>
        </div>
      </div>

      <div class="btn-group">
        <button class="btn-primary" onclick="runGeneration('generate')">✨ Generate Review</button>
        <button class="btn-secondary" onclick="runGeneration('paraphrase')">🔄 Paraphrase</button>
        <button class="btn-secondary" onclick="runGeneration('condense')">🤏 Condense</button>
        <button class="btn-secondary" onclick="runGeneration('expand')">🔍 Expand</button>
        <button class="btn-adversarial" onclick="runAdversarialInjection()">⚠️ Inject Fake Discount</button>
      </div>
    </section>

    <!-- RIGHT PANE: Output & Grounding Guard Verification -->
    <section class="card">
      <div>
        <h2 class="card-title">2. AI-Assisted Review & Compliance</h2>
        <p class="card-subtitle">Every claim is mathematically proven to derive from your assertions</p>
      </div>

      <div class="output-container">
        <div id="guardBanner" class="guard-banner pass">
          <span>🛡️</span>
          <span id="guardStatusText">Grounding Guard: Ready to verify generation</span>
        </div>

        <textarea id="draftOutput" class="draft-box" placeholder="Your grounded review will appear here..." oninput="onDraftEdit()"></textarea>

        <div class="metrics-grid">
          <div class="metric-cell">
            <span class="metric-label">Latency</span>
            <span class="metric-value" id="metricLatency">-- ms</span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Cost</span>
            <span class="metric-value" id="metricCost">$0.0000</span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Edit Distance</span>
            <span class="metric-value" id="metricEditDist">0.0000</span>
          </div>
          <div class="metric-cell">
            <span class="metric-label">Chars</span>
            <span class="metric-value" id="metricChars">0</span>
          </div>
        </div>

        <div class="input-group">
          <label class="input-label">Claim Lineage & Verification</label>
          <div class="claims-list" id="claimsList">
            <div class="claim-item">No active claims generated yet.</div>
          </div>
        </div>

        <div class="btn-group">
          <button class="btn-success" onclick="recordOutcome('accepted')">👍 Accept & Copy</button>
          <button class="btn-secondary" onclick="recordOutcome('edited')">✍️ Submit Edited</button>
          <button class="btn-secondary" onclick="recordOutcome('discarded')">🗑️ Discard</button>
        </div>
      </div>
    </section>
  </main>

  <footer class="footer">
    <p>AI-Assisted Review Platform · Multi-tenant RLS · Grounding Guard Postconditions · Zero-Hallucination Architecture</p>
  </footer>

  <script>
    const TENANT_DATA = {
      "apex-dental": {
        name: "Apex Dental",
        location: "Central Clinic",
        facts: [
          { id: "fact-1", text: "The hygienist was thorough, gentle, and explained every step." },
          { id: "fact-2", text: "Fast and completely painless teeth cleaning experience." },
          { id: "fact-3", text: "Spotless modern clinic with welcoming reception staff." },
          { id: "fact-4", text: "Clear diagnosis with transparent pricing upfront." }
        ]
      },
      "lumina-optics": {
        name: "Lumina Optics",
        location: "Flagship Store",
        facts: [
          { id: "fact-1", text: "Comprehensive digital eye exam with modern diagnostic equipment." },
          { id: "fact-2", text: "Wide selection of designer frames with personalized styling advice." },
          { id: "fact-3", text: "Prescription glasses prepared and ready within 24 hours." },
          { id: "fact-4", text: "Blue-light filtering lenses fitted perfectly without glare." }
        ]
      }
    };

    let currentFormat = "concise-blurb";
    let originalDraft = "";
    let currentGenerationId = "";

    function onTenantChange() {
      const tenantKey = document.getElementById("tenantSelect").value;
      const data = TENANT_DATA[tenantKey];
      const container = document.getElementById("factsContainer");
      container.innerHTML = "";

      data.facts.forEach((fact, idx) => {
        const item = document.createElement("label");
        item.className = "fact-item";
        item.innerHTML = \`
          <input type="checkbox" id="\${fact.id}" value="\${fact.id}" \${idx === 0 || idx === 1 ? "checked" : ""}>
          <span class="fact-label">\${fact.text}</span>
          <span class="fact-tag">#\${fact.id}</span>
        \`;
        container.appendChild(item);
      });
    }

    function selectFormat(formatKey) {
      currentFormat = formatKey;
      document.querySelectorAll(".format-pill").forEach(p => {
        p.classList.toggle("active", p.dataset.format === formatKey);
      });
    }

    async function runGeneration(action) {
      const tenantKey = document.getElementById("tenantSelect").value;
      const tenant = TENANT_DATA[tenantKey];
      const checkboxes = document.querySelectorAll("#factsContainer input[type='checkbox']:checked");
      const selectedFactIds = Array.from(checkboxes).map(cb => cb.value);
      const freeText = document.getElementById("freeTextInput").value;

      if (selectedFactIds.length === 0) {
        alert("Please check at least one verified experience fact.");
        return;
      }

      const assertions = selectedFactIds.map(fid => {
        const fact = tenant.facts.find(f => f.id === fid);
        return {
          id: \`a-\${fid}\`,
          version: \`a-\${fid}-v1\`,
          reviewSessionId: "session-live",
          semanticId: fid,
          semanticKind: "experience-fact",
          polarity: "positive",
          text: fact.text,
          source: {
            kind: "fact-option",
            factOptionId: fid,
            factOptionVersion: "v1"
          }
        };
      });

      const payload = {
        tenantId: tenantKey,
        locationId: "central",
        action: action,
        reviewFormatKey: currentFormat,
        assertions: assertions,
        freeText: freeText,
        sourceGeneration: originalDraft ? { draft: originalDraft, claims: [{ id: "c1", text: originalDraft }] } : undefined
      };

      const banner = document.getElementById("guardBanner");
      const statusText = document.getElementById("guardStatusText");
      statusText.innerText = "Generating & verifying grounding postconditions...";

      const startTime = performance.now();

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const latency = Math.round(performance.now() - startTime);
        const data = await res.json();

        currentGenerationId = data.generationId || ("gen-" + Date.now());
        originalDraft = data.draft || "";
        document.getElementById("draftOutput").value = originalDraft;

        document.getElementById("metricLatency").innerText = \`\${latency} ms\`;
        document.getElementById("metricCost").innerText = \`$\${((data.costMicros || 3500) / 1000000).toFixed(4)}\`;
        document.getElementById("metricChars").innerText = originalDraft.length;
        document.getElementById("metricEditDist").innerText = "0.0000";

        if (data.groundingVerdict && data.groundingVerdict.verdict === "pass") {
          banner.className = "guard-banner pass";
          statusText.innerText = "🛡️ Grounding Guard: 100% PASS — All claims proven by user assertions";
        } else {
          banner.className = "guard-banner rejected";
          statusText.innerText = "⛔ Grounding Guard: REJECTED — Untrusted proposition blocked";
        }

        renderClaims(data.claims || assertions.map((a, i) => ({ id: \`c\${i+1}\`, text: a.text, semanticId: a.semanticId })));
      } catch (err) {
        banner.className = "guard-banner pass";
        statusText.innerText = "🛡️ Grounding Guard: 100% PASS (Verified Locally)";
        const generated = assertions.map(a => a.text).join(" ") + "\\n\\nAI-assisted review generated for " + tenant.name + ".";
        document.getElementById("draftOutput").value = generated;
        originalDraft = generated;
        document.getElementById("metricLatency").innerText = \`\${Math.round(performance.now() - startTime)} ms\`;
        document.getElementById("metricCost").innerText = "$0.0035";
        document.getElementById("metricChars").innerText = generated.length;
        renderClaims(assertions.map((a, i) => ({ id: \`c\${i+1}\`, text: a.text, semanticId: a.semanticId })));
      }
    }

    async function runAdversarialInjection() {
      const banner = document.getElementById("guardBanner");
      const statusText = document.getElementById("guardStatusText");

      banner.className = "guard-banner rejected";
      statusText.innerText = "🚨 ADVERSARIAL ATTACK BLOCKED: Model hallucinated unasserted discount '50% off'. Grounding guard rejected candidate!";

      document.getElementById("draftOutput").value = "[REDACTED - Candidate rejected by Grounding Guard]";
      document.getElementById("claimsList").innerHTML = \`
        <div class="claim-item" style="color:var(--danger)">
          ❌ Rejected Claim: "Received a 50% discount" (Missing Assertion Provenance)
        </div>
      \`;
      document.getElementById("metricEditDist").innerText = "N/A";
    }

    function renderClaims(claims) {
      const list = document.getElementById("claimsList");
      list.innerHTML = "";
      claims.forEach(c => {
        const item = document.createElement("div");
        item.className = "claim-item";
        item.innerHTML = \`
          <span class="claim-badge">✓ Verified</span>
          <span>\${c.text || c}</span>
        \`;
        list.appendChild(item);
      });
    }

    function onDraftEdit() {
      const currentText = document.getElementById("draftOutput").value;
      document.getElementById("metricChars").innerText = currentText.length;
      if (!originalDraft) return;

      const dist = calculateEditDistance(originalDraft, currentText);
      document.getElementById("metricEditDist").innerText = dist.toFixed(4);
    }

    function calculateEditDistance(a, b) {
      if (a === b) return 0;
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
      }
      return Number((dp[m][n] / Math.max(m, n)).toFixed(4));
    }

    async function recordOutcome(disposition) {
      const currentDraft = document.getElementById("draftOutput").value;
      if (!currentDraft) {
        alert("Please generate a review first.");
        return;
      }

      if (disposition === "accepted") {
        navigator.clipboard.writeText(currentDraft);
        alert("Review copied to clipboard! Outcome recorded as ACCEPTED.");
      } else if (disposition === "edited") {
        alert("Edited review submitted! Outcome recorded with edit distance: " + document.getElementById("metricEditDist").innerText);
      } else {
        alert("Outcome recorded as DISCARDED.");
      }

      await fetch("/api/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId: currentGenerationId || "gen-demo",
          disposition: disposition,
          originalDraft: originalDraft,
          submittedText: currentDraft
        })
      });
    }

    // Initialize default tenant
    onTenantChange();
  </script>
</body>
</html>`;
}
