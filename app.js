(() => {
  "use strict";

  const TZ = "America/Bogota";
  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseEmbedded(id) {
    const node = $(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch {
      return null;
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(url + " " + res.status);
    return res.json();
  }

  function metricsMap(snapshot) {
    if (!snapshot) return {};
    if (snapshot.metrics && !Array.isArray(snapshot.metrics)) {
      return snapshot.metrics;
    }
    const out = {};
    const list = snapshot.metrics || snapshot.properties || snapshot.sites || [];
    if (Array.isArray(list)) {
      for (const row of list) {
        const id = row.id || row.propertyId;
        if (id) out[id] = row.metrics || row;
      }
    }
    return out;
  }

  function mergeSnapshot(seed, live) {
    if (!live || typeof live !== "object") return seed;
    const out = Object.assign({}, seed);
    if (live.asOf) out.asOf = live.asOf;
    if (live.asOfLabel) out.asOfLabel = live.asOfLabel;
    if (live.timezone) out.timezone = live.timezone;
    if (live.source) out.source = live.source;
    out.metrics = Object.assign({}, metricsMap(seed));
    const liveMetrics = metricsMap(live);
    for (const [id, row] of Object.entries(liveMetrics)) {
      if (!row || typeof row !== "object") continue;
      const hasNumber =
        row.activeUsers != null ||
        row.events != null ||
        row.activeUsersChangePct != null ||
        row.eventsChangePct != null;
      if (!hasNumber) continue;
      out.metrics[id] = Object.assign({}, out.metrics[id] || {}, row);
    }
    return out;
  }

  function lookupMetrics(map, prop) {
    const keys = [prop.id, prop.propertyId, prop.measurementId].filter(Boolean);
    for (const key of keys) {
      if (map[key]) return map[key];
    }
    return null;
  }

  function formatCount(n) {
    if (n == null || n === "") return null;
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    if (Math.abs(num) >= 1000) {
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(num);
    }
    return new Intl.NumberFormat("en-US").format(num);
  }

  function formatPct(n) {
    if (n == null || n === "") return null;
    const num = Number(n);
    if (!Number.isFinite(num)) return null;
    const abs = Math.abs(num);
    const body = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: abs % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    }).format(abs);
    if (num > 0) return { dir: "up", text: "↑" + body + "%" };
    if (num < 0) return { dir: "down", text: "↓" + body + "%" };
    return { dir: "flat", text: body + "%" };
  }

  function formatAsOf(snapshot) {
    if (snapshot.asOfLabel) {
      return { when: snapshot.asOfLabel, tz: "Bogotá" };
    }
    const iso = snapshot.asOf;
    if (!iso) return { when: "Time unknown", tz: "Bogotá" };
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { when: String(iso), tz: "Bogotá" };
    const when = new Intl.DateTimeFormat("en-GB", {
      timeZone: snapshot.timezone || TZ,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
    return { when: when.replace(" am", "am").replace(" pm", "pm"), tz: "Bogotá" };
  }

  function gaUrl(prop) {
    if (!prop.accountId || !prop.propertyId) return null;
    return (
      "https://analytics.google.com/analytics/web/#/" +
      prop.accountId +
      prop.propertyId +
      "/reports/intelligenthome"
    );
  }

  function deltaHtml(pct) {
    const parsed = formatPct(pct);
    if (!parsed) return '<span class="delta delta--empty">—</span>';
    if (parsed.dir === "flat") {
      return '<span class="delta">' + esc(parsed.text) + "</span>";
    }
    return (
      '<span class="delta delta-pill delta--' +
      parsed.dir +
      '">' +
      esc(parsed.text) +
      "</span>"
    );
  }

  function identityLine(prop) {
    const bits = [];
    if (
      prop.propertyName &&
      prop.propertyName !== prop.name &&
      prop.propertyName !== prop.domain
    ) {
      bits.push(prop.propertyName);
    }
    if (prop.account) bits.push(prop.account);
    return bits.join(" · ");
  }

  function metricPair(metrics) {
    return (
      '<div class="metrics">' +
      '<div class="metric">' +
      '<p class="num">' +
      esc(formatCount(metrics.activeUsers) ?? "—") +
      "</p>" +
      deltaHtml(metrics.activeUsersChangePct) +
      '<p class="label">Active users</p>' +
      "</div>" +
      '<div class="metric">' +
      '<p class="num">' +
      esc(formatCount(metrics.events) ?? "—") +
      "</p>" +
      deltaHtml(metrics.eventsChangePct) +
      '<p class="label">Events</p>' +
      "</div>" +
      "</div>"
    );
  }

  function emptyState(prop) {
    const extra = prop.measurementId
      ? "<span>Measurement " + esc(prop.measurementId) + "</span>"
      : "<span>Waiting on a snapshot</span>";
    return (
      '<div class="empty"><div><strong>No data yet</strong>' +
      extra +
      "</div></div>"
    );
  }

  function renderCard(prop, metrics, variant) {
    const href = gaUrl(prop);
    const hasData =
      metrics && (metrics.activeUsers != null || metrics.events != null);
    const domain = prop.domain || prop.measurementId || "";
    const ident = identityLine(prop);
    const rangeLabel = (metrics && metrics.rangeLabel) || "";
    const pid = prop.propertyId || prop.id || "";
    const emptyClass = hasData ? "" : " card--empty";
    const optClass = variant === "optional" ? " card--optional" : "";

    return (
      '<article class="card' +
      optClass +
      emptyClass +
      '">' +
      '<header class="card-head"><div>' +
      '<h3 class="card-name">' +
      esc(prop.name) +
      "</h3>" +
      (domain ? '<p class="card-domain">' + esc(domain) + "</p>" : "") +
      (ident ? '<p class="card-meta">' + esc(ident) + "</p>" : "") +
      "</div>" +
      (href
        ? '<a class="card-ga" href="' +
          esc(href) +
          '" target="_blank" rel="noopener noreferrer" title="Open in Google Analytics">GA</a>'
        : "") +
      "</header>" +
      (hasData ? metricPair(metrics) : emptyState(prop)) +
      '<footer class="card-foot">' +
      '<span class="range">' +
      esc(rangeLabel || (hasData ? "" : "No range")) +
      "</span>" +
      '<span class="pid">' +
      esc(pid) +
      "</span>" +
      "</footer></article>"
    );
  }

  function render(properties, snapshot) {
    const map = metricsMap(snapshot);
    $("subtitle").textContent = properties.subtitle || "Last 7 days";
    const asof = formatAsOf(snapshot);
    $("asof").innerHTML =
      esc(asof.when) + '<span class="tz">' + esc(asof.tz) + "</span>";
    document.title = properties.title || "Sites";

    $("primary").innerHTML = (properties.primary || [])
      .map((prop) => renderCard(prop, lookupMetrics(map, prop), "primary"))
      .join("");

    $("optional").innerHTML = (properties.optional || [])
      .map((prop) => renderCard(prop, lookupMetrics(map, prop), "optional"))
      .join("");
  }

  async function load() {
    const embeddedProperties = parseEmbedded("embedded-properties");
    const embeddedSnapshot = parseEmbedded("embedded-snapshot");

    let properties = embeddedProperties;
    try {
      properties = await fetchJson("data/properties.json");
    } catch {
      properties = embeddedProperties;
    }

    let snapshot = embeddedSnapshot;
    try {
      snapshot = await fetchJson("data/snapshot.json");
    } catch {
      snapshot = embeddedSnapshot;
    }

    try {
      const live = await fetchJson("../live-snapshot.json");
      snapshot = mergeSnapshot(snapshot, live);
    } catch {
      /* no live file */
    }

    render(properties, snapshot);
  }

  load().catch((err) => {
    const primary = $("primary");
    if (primary) {
      primary.innerHTML = '<p class="empty">Could not load dashboard data.</p>';
    }
    console.error(err);
  });
})();
