/*
 * Contarina sidebar page (registered by the integration when an entry turns it on).
 *
 * One tab per calendar. Each tab: a month view of the pickups (from the contarina/pickups
 * websocket command) and, on the side, cards reused from the Lovelace card: the EcoCentro
 * (view: ecocenter), the residual emptyings counter (if tracked) and "Where does it go?"
 * (view: search). Colors, icons and texts come from the card (window.ContarinaShared).
 */

const PANEL_STRINGS = {
  en: {
    empty: "No Contarina calendars found.",
    today: "Today",
    previous: "Previous month",
    next: "Next month",
    no_pickups: "No pickups",
    emptied: "emptying marked",
    new_year: "Next year's pickups appear in January, when Contarina publishes the new calendar.",
    unavailable: "Pickups not available: the calendar couldn't be loaded.",
    emptyings_off: "Residual bin emptyings aren't counted for this calendar.",
    emptyings_how: "To count them against the yearly allowance, open Configure in the Contarina integration and enter the household members in the \"Residual bin emptyings\" section.",
    emptyings_open: "Open the integration",
    pace_marker: "Even pace: {expected}",
    next_residual: "Next residual pickup: {date}",
    mark_pickup: "Mark the bin put out for {date}",
    marked_pickup: "Bin put out for {date}",
    add_other: "Another day",
    add_other_hint: "A forgotten emptying, e.g. on a different day than the pickup.",
  },
  it: {
    empty: "Nessun calendario Contarina trovato.",
    today: "Oggi",
    previous: "Mese precedente",
    next: "Mese successivo",
    no_pickups: "Nessuna raccolta",
    emptied: "svuotamento segnato",
    new_year: "Le raccolte dell'anno prossimo compaiono a gennaio, quando Contarina pubblica il nuovo calendario.",
    unavailable: "Raccolte non disponibili: il calendario non si è caricato.",
    emptyings_off: "Gli svuotamenti del secco non vengono contati per questo calendario.",
    emptyings_how: "Per contarli rispetto alla soglia annua, apri Configura nell'integrazione Contarina e inserisci i componenti del nucleo familiare nella sezione \"Svuotamenti del secco\".",
    emptyings_open: "Apri l'integrazione",
    pace_marker: "Ritmo regolare: {expected}",
    next_residual: "Prossimo ritiro del secco: {date}",
    mark_pickup: "Segna il bidone esposto per {date}",
    marked_pickup: "Bidone esposto per {date}",
    add_other: "Un altro giorno",
    add_other_hint: "Uno svuotamento dimenticato, anche in un giorno diverso dal ritiro.",
  },
};

const ECO_STRINGS = {
  en: {
    back: "Back to the map",
    own: "Your municipality",
    unavailable: "EcoCentri not available right now.",
    hint: "Tap an EcoCentro on the map to see its opening hours.",
  },
  it: {
    back: "Torna alla mappa",
    own: "Il tuo comune",
    unavailable: "EcoCentri non disponibili al momento.",
    hint: "Tocca un EcoCentro sulla mappa per vederne gli orari.",
  },
};

const LEAFLET_URL = "/contarina/leaflet";
// The open/closed status changes during the day: refresh the map every few minutes
const ECOCENTERS_MAX_AGE = 5 * 60 * 1000;

let leafletPromise = null;
// Leaflet (bundled with the integration) sets window.L
const loadLeaflet = () => {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${LEAFLET_URL}/leaflet.js`;
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error("Leaflet could not be loaded"));
      };
      document.head.append(script);
    });
  }
  return leafletPromise;
};

/*
 * Base map: OpenStreetMap through Home Assistant's own tile proxy (map_tiles, since
 * 2026.9), as its map card does. The proxy wants an access token that core rotates every
 * 30 minutes, keeping two live: ask for it again every 20 minutes and whenever a tile is
 * refused. Without the proxy (older versions), the tiles come straight from OpenStreetMap.
 */
const PROXY_TILE_URL = "/api/map_tiles/raster/{z}/{x}/{y}.png?token={token}";
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILES_TOKEN_MAX_AGE = 20 * 60 * 1000;
const TILES_RETRY = 30 * 1000;

let tilesToken = null; // {token, at}
const getTilesToken = async (hass, force = false) => {
  if (!force && tilesToken && Date.now() - tilesToken.at < TILES_TOKEN_MAX_AGE) return tilesToken.token;
  try {
    const { token } = await hass.callWS({ type: "map_tiles/access_token" });
    tilesToken = { token, at: Date.now() };
  } catch (err) {
    // No proxy on this version: keep whatever we had (null → OpenStreetMap directly)
  }
  return tilesToken?.token ?? null;
};

/*
 * EcoCentro card of the sidebar page: a map of every EcoCentro (colored by status, the
 * calendar's own ones bigger); tapping one shows its hours, with a button back to the map.
 */
class EcoMap {
  constructor(panel) {
    this.panel = panel;
    this.el = document.createElement("ha-card");
    this.el.className = "eco-card";
    this.el.innerHTML = `
      <div class="eco-head"></div>
      <div class="eco-map-view">
        <div class="eco-map"></div>
        <div class="eco-own"></div>
        <div class="eco-legend"></div>
      </div>
      <div class="eco-details" hidden></div>`;
    this.head = this.el.querySelector(".eco-head");
    this.mapView = this.el.querySelector(".eco-map-view");
    this.mapEl = this.el.querySelector(".eco-map");
    this.ownEl = this.el.querySelector(".eco-own");
    this.legendEl = this.el.querySelector(".eco-legend");
    this.detailsEl = this.el.querySelector(".eco-details");
    this.el.addEventListener("click", (ev) => this.click(ev));
    this.entryId = null;
    this.data = null;
    this.at = 0;
    this.selected = null;
  }

  get s() {
    return window.ContarinaShared;
  }

  get t() {
    return this.s.stringsFor(this.panel._hass);
  }

  get et() {
    return ECO_STRINGS[this.t.locale.slice(0, 2)] || ECO_STRINGS.en;
  }

  // Called when the tab changes; the card itself is reused
  setEntry(entryId) {
    if (entryId !== this.entryId) {
      this.entryId = entryId;
      this.data = null;
      this.selected = null;
      this.fitted = false;
      this.load();
    } else {
      this.render();
    }
  }

  refresh() {
    if (!this.loading && Date.now() - this.at > ECOCENTERS_MAX_AGE) this.load();
  }

  async load() {
    const entryId = this.entryId;
    this.loading = true;
    this.at = Date.now();
    try {
      const data = await this.panel._hass.callWS({ type: "contarina/ecocenters", entry_id: entryId });
      if (entryId === this.entryId) this.data = data;
    } catch (err) {
      if (entryId === this.entryId) this.data = { error: true, centers: [] };
    }
    this.loading = false;
    if (entryId === this.entryId) this.render();
  }

  stateColor(state) {
    const css = getComputedStyle(this.el);
    const variable = { open: "--success-color", booking_only: "--warning-color" }[state];
    const fallback = { open: "#43a047", booking_only: "#ffa600" }[state] || "#9e9e9e";
    return (variable && css.getPropertyValue(variable).trim()) || fallback;
  }

  render() {
    const s = this.s;
    const t = this.t;
    const et = this.et;
    const details = this.selected !== null && this.data?.centers?.[this.selected];
    this.head.innerHTML = details
      ? `<button class="eco-back" title="${s.esc(et.back)}" aria-label="${s.esc(et.back)}">
           <ha-icon icon="mdi:arrow-left"></ha-icon></button>
         <span class="eco-title">${s.esc(details.attributes.municipality)}</span>`
      : `<ha-icon class="eco-icon" icon="${s.ECO_STYLE.icon}"></ha-icon><span class="eco-title">${s.esc(t.ecocenter)}</span>`;
    this.mapView.hidden = !!details;
    this.detailsEl.hidden = !details;

    if (details) {
      const notice = s.ecoNoticeText(t, this.data.notice, this.data.closures);
      this.detailsEl.innerHTML = `
        ${s.renderCenter(t, details)}
        ${notice ? `<p class="eco-notice">${s.esc(notice)}</p>` : ""}
        <p><a class="eco-link" href="${s.ECO_HOURS_URL}" target="_blank" rel="noopener noreferrer">
          <ha-icon icon="mdi:open-in-new"></ha-icon>${s.esc(t.eco_page)}</a></p>`;
      return;
    }
    if (this.data?.error) {
      this.ownEl.innerHTML = `<p class="eco-muted">${s.esc(et.unavailable)}</p>`;
      return;
    }
    const centers = this.data?.centers || [];
    // The calendar's own centers, listed under the map: tap to see the hours
    this.ownEl.innerHTML = centers
      .map((c, i) => [c, i])
      .filter(([c]) => c.own)
      .map(
        ([c, i]) => `
        <button class="eco-row" data-index="${i}">
          <span class="dot ${s.esc(c.state)}"></span>
          <span class="eco-row-text"><strong>${s.esc(c.attributes.address)}</strong>
            <span class="eco-muted">${s.esc(s.ecoStatusText(t, c))}</span></span>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </button>`
      )
      .join("") || `<p class="eco-muted">${s.esc(et.hint)}</p>`;
    this.legendEl.innerHTML = ["open", "booking_only", "closed"]
      .map((state) => `<span><span class="dot ${state}"></span>${s.esc(t.eco_state[state])}</span>`)
      .join("") + `<span><span class="dot own"></span>${s.esc(et.own)}</span>`;
    this.drawMap(centers);
  }

  async drawMap(centers) {
    let L;
    try {
      L = await loadLeaflet();
    } catch (err) {
      this.mapEl.hidden = true;
      return;
    }
    if (!this.map) {
      this.map = L.map(this.mapEl, { scrollWheelZoom: false });
      this.tiles = null;
      this.markers = L.layerGroup().addTo(this.map);
    }
    // Raster tiles have no dark version: inverted in CSS, like Home Assistant does
    this.mapEl.classList.toggle("dark", !!this.panel._hass.themes?.darkMode);
    const token = await getTilesToken(this.panel._hass);
    if (!this.tiles) {
      this.tiles = L.tileLayer(token ? PROXY_TILE_URL : OSM_TILE_URL, {
        token: token ?? "",
        maxZoom: 19,
        attribution: OSM_ATTRIBUTION,
        // OpenStreetMap refuses browser requests without a referrer
        referrerPolicy: token ? undefined : "origin",
      }).addTo(this.map);
      this.tilesAt = 0;
      // Probably a token that expired while the page stayed open: get a new one
      this.tiles.on("tileerror", async () => {
        if (!token || Date.now() - this.tilesAt < TILES_RETRY) return;
        this.tilesAt = Date.now();
        const fresh = await getTilesToken(this.panel._hass, true);
        if (fresh && fresh !== this.tiles.options.token) {
          this.tiles.options.token = fresh;
          this.tiles.redraw();
        }
      });
    } else if (token && token !== this.tiles.options.token) {
      // Substituted per tile: only the new ones use it
      this.tiles.options.token = token;
    }
    // The card may have been hidden or moved: let Leaflet measure it again
    this.map.invalidateSize();

    this.markers.clearLayers();
    const located = centers.map((c, i) => [c, i]).filter(([c]) => c.attributes.latitude != null);
    // Own centers last, so they are drawn on top
    located.sort(([a], [b]) => Number(a.own) - Number(b.own));
    located.forEach(([c, i]) => {
      const marker = L.circleMarker([c.attributes.latitude, c.attributes.longitude], {
        radius: c.own ? 10 : 7,
        weight: c.own ? 3 : 1.5,
        color: c.own ? "#ffffff" : "rgba(0, 0, 0, 0.45)",
        fillColor: this.stateColor(c.state),
        fillOpacity: 0.95,
      });
      // Tooltips are HTML: the names come from contarina.it, escape them
      marker.bindTooltip(`${this.s.esc(c.attributes.municipality)} · ${this.s.esc(c.attributes.address)}`);
      marker.on("click", () => this.select(i));
      marker.addTo(this.markers);
    });

    if (!this.fitted && located.length) {
      this.fitted = true;
      const own = located.filter(([c]) => c.own);
      const points = (own.length ? own : located).map(([c]) => [c.attributes.latitude, c.attributes.longitude]);
      // Around the own centers, with the neighbouring ones in view
      this.map.fitBounds(L.latLngBounds(points).pad(own.length ? 2 : 0.05), { maxZoom: 13 });
    }
  }

  select(index) {
    this.selected = index;
    this.render();
    this.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  click(ev) {
    if (ev.target.closest(".eco-back")) {
      this.selected = null;
      this.render();
      return;
    }
    const row = ev.target.closest(".eco-row");
    if (row) this.select(Number(row.dataset.index));
  }
}

/*
 * Residual emptyings card of the sidebar page: the counter with a progress bar against the
 * yearly allowance, the emptyings of the year (removable), a button to mark the bin put out
 * for the next pickup (today or tomorrow) and a date picker for the forgotten ones.
 */
class EmptyingsCard {
  constructor(panel) {
    this.panel = panel;
    this.el = document.createElement("ha-card");
    this.el.className = "emp-card";
    this.el.addEventListener("click", (ev) => this.click(ev));
    this.el.addEventListener("change", (ev) => {
      if (ev.target.matches(".emp-date")) this.error(false);
    });
    this.key = null;
  }

  get s() {
    return window.ContarinaShared;
  }

  // Called at every hass update: redrawn only when something shown changes
  update(entryId) {
    const states = this.panel._hass.states;
    this.sensorId = Object.keys(states).find(
      (i) => i.startsWith("sensor.") && states[i].attributes.entry_id === entryId && states[i].attributes.emptyings_total !== undefined
    );
    this.residualId = this.panel._wasteSensor(entryId, "residual");
    const st = states[this.sensorId];
    const residual = states[this.residualId];
    if (!st) return;
    const t = this.s.stringsFor(this.panel._hass);
    const key = JSON.stringify([t.locale, st.state, st.attributes, residual?.attributes.next_date, this.s.isoDate(new Date())]);
    if (key === this.key) return;
    this.key = key;
    this.render(t, st, residual);
  }

  num(t, n) {
    return Number(n).toLocaleString(t.locale, { maximumFractionDigits: 1 });
  }

  render(t, st, residual) {
    const s = this.s;
    const pt = this.panel._pt;
    const a = st.attributes;
    const used = Number(st.state);
    const total = a.emptyings_total;
    const left = total - used;
    const full = used >= total;
    const color = s.WASTE_STYLE.residual.color;
    const dates = [...(a.dates || [])].reverse();
    const longDate = (iso, opts = { weekday: "long", day: "numeric", month: "long" }) =>
      s.capitalize(new Date(`${iso}T00:00:00`).toLocaleDateString(t.locale, opts));

    // Today's or tomorrow's pickup: the bin goes out the evening before
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const next = residual?.attributes.next_date;
    const soon = next && next <= s.isoDate(tomorrow) ? next : null;
    const marked = soon && (a.dates || []).includes(soon);
    const markBtn = soon
      ? `<button class="emp-mark ${marked ? "marked" : ""}" data-date="${soon}">
           <ha-icon icon="${marked ? "mdi:check-circle" : "mdi:plus-circle-outline"}"></ha-icon>
           ${s.esc(
             s.fill(marked ? pt.marked_pickup : pt.mark_pickup, {
               // Mid-sentence: not capitalized
               date: new Date(`${soon}T00:00:00`).toLocaleDateString(t.locale, { weekday: "long", day: "numeric" }),
             })
           )}
         </button>`
      : next
      ? `<p class="muted">${s.esc(s.fill(pt.next_residual, { date: longDate(next) }))}</p>`
      : "";

    const pct = (n) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
    const list = dates.length
      ? `<ul class="emp-list">${dates
          .map(
            (d) => `
            <li>
              <span class="emp-check"><ha-icon icon="mdi:check"></ha-icon></span>
              <span class="emp-day">${s.esc(longDate(d))}</span>
              <button class="emp-remove" data-date="${d}" title="${s.esc(t.remove)}" aria-label="${s.esc(t.remove)}">
                <ha-icon icon="mdi:delete-outline"></ha-icon></button>
            </li>`
          )
          .join("")}</ul>`
      : `<p class="muted">${s.esc(t.no_emptyings)}</p>`;

    // The date picker stays open (and keeps its value) across redraws
    const addOpen = this.el.querySelector(".emp-add")?.open ? "open" : "";
    const typed = this.el.querySelector(".emp-date")?.value || s.isoDate(today);

    this.el.innerHTML = `
      <div class="emp-head">
        <span class="pick" style="--c:${color}"><ha-icon icon="${s.WASTE_STYLE.residual.icon}"></ha-icon></span>
        <span class="emp-title">${s.esc(t.emptyings_title)}</span>
      </div>
      <div class="emp-stat ${full ? "full" : ""}">
        <span class="emp-big">${s.esc(used)}</span><span class="emp-total">/ ${s.esc(this.num(t, total))}</span>
        <span class="emp-left">${s.esc(left >= 0 ? s.fill(t.left, { left: this.num(t, left) }) : s.fill(t.over, { over: this.num(t, -left) }))}</span>
      </div>
      <div class="emp-bar ${full ? "full" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="${s.esc(total)}" aria-valuenow="${s.esc(used)}">
        <span class="emp-fill" style="width:${pct(used)}"></span>
        <span class="emp-pace" style="left:${pct(a.expected_by_now)}" title="${s.esc(s.fill(pt.pace_marker, { expected: this.num(t, a.expected_by_now) }))}"></span>
      </div>
      <p class="muted">${s.esc(s.fill(used <= a.expected_by_now ? t.pace_ok : t.pace_over, { expected: this.num(t, a.expected_by_now) }))}</p>
      <p class="muted">${s.esc(s.fill(t.liters, { used: a.liters_used, total: a.liters_total, bin: a.bin_liters }))}</p>
      ${markBtn}
      <div class="emp-section">${s.esc(s.fill(t.dates_title, { year: today.getFullYear() }))}</div>
      ${list}
      <details class="emp-add" ${addOpen}>
        <summary><ha-icon icon="mdi:calendar-plus"></ha-icon>${s.esc(pt.add_other)}</summary>
        <p class="muted">${s.esc(pt.add_other_hint)}</p>
        <div class="emp-add-row">
          <input type="date" class="emp-date" value="${s.esc(typed)}" min="${today.getFullYear()}-01-01" max="${s.isoDate(today)}">
          <button class="emp-add-btn">${s.esc(t.add)}</button>
        </div>
        <p class="emp-error" hidden>${s.esc(t.already_marked)}</p>
      </details>`;
  }

  error(show) {
    const el = this.el.querySelector(".emp-error");
    if (el) el.hidden = !show;
  }

  call(service, date) {
    this.panel._hass.callService("contarina", service, { entity_id: this.sensorId, date });
  }

  click(ev) {
    const mark = ev.target.closest(".emp-mark");
    if (mark) {
      this.call(mark.classList.contains("marked") ? "remove_emptying" : "add_emptying", mark.dataset.date);
      return;
    }
    const remove = ev.target.closest(".emp-remove");
    if (remove) {
      this.call("remove_emptying", remove.dataset.date);
      return;
    }
    if (ev.target.closest(".emp-add-btn")) {
      const day = this.el.querySelector(".emp-date").value;
      if (!day) return;
      const dates = this.panel._hass.states[this.sensorId]?.attributes.dates || [];
      // A day already marked isn't added again: say so instead
      this.error(dates.includes(day));
      if (!dates.includes(day)) this.call("add_emptying", day);
    }
  }
}

const TAB_STORAGE_KEY = "contarina-panel-tab";
// The calendar is downloaded once a day: refetching it hourly is plenty
const PICKUPS_MAX_AGE = 60 * 60 * 1000;

const monthStart = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, 1);

class ContarinaPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cards = new Map();
    this._pickups = new Map(); // entry_id -> {list, at, error}
    this._month = monthStart(new Date());
    this._selected = null;
    this._ready = false;
    try {
      this._active = localStorage.getItem(TAB_STORAGE_KEY);
    } catch (err) {
      this._active = null;
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  set narrow(narrow) {
    this._narrow = narrow;
    if (this._menu) this._menu.narrow = narrow;
  }

  // Passed by Home Assistant, not used
  set panel(panel) {}
  set route(route) {}

  async connectedCallback() {
    if (!this._content) this._build();
    // The card is loaded on every page, but maybe not yet when the panel opens
    await customElements.whenDefined("contarina-card");
    if (!this._ecoStyle) {
      // Styles of the EcoCentro hours, shared with the card
      this._ecoStyle = document.createElement("style");
      this._ecoStyle.textContent = this._s.ECO_CSS;
      this.shadowRoot.append(this._ecoStyle);
    }
    this._ready = true;
    this._update();
  }

  get _s() {
    return window.ContarinaShared;
  }

  get _t() {
    return this._s.stringsFor(this._hass);
  }

  get _pt() {
    const lang = (this._hass.locale?.language || this._hass.language || "en").split("-")[0];
    return PANEL_STRINGS[lang] || PANEL_STRINGS.en;
  }

  _build() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="${LEAFLET_URL}/leaflet.css">
      <style>
        :host {
          display: flex; flex-direction: column; height: 100%;
          background: var(--primary-background-color); color: var(--primary-text-color);
        }
        .toolbar {
          flex: none; display: flex; align-items: center; gap: 8px; box-sizing: border-box;
          height: var(--header-height, 56px); padding: 0 12px;
          background: var(--app-header-background-color, var(--primary-color));
          color: var(--app-header-text-color, var(--text-primary-color, #fff));
          font-size: 20px;
        }
        .title { flex: none; margin: 0 12px; }
        /* One chip per calendar, in the toolbar */
        .tabs {
          flex: 1; min-width: 0; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none;
          padding: 4px 0;
        }
        .tabs::-webkit-scrollbar { display: none; }
        .tabs[hidden] { display: none; }
        .tab {
          flex: none; padding: 6px 14px; border-radius: 999px; cursor: pointer;
          font: inherit; font-size: 14px; font-weight: 500; white-space: nowrap;
          color: inherit; background: none;
          border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
        }
        .tab:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
        .tab.active {
          background: var(--primary-color); border-color: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .content { flex: 1; overflow: auto; padding: 16px; box-sizing: border-box; }
        .layout {
          display: grid; gap: 16px; align-items: start; max-width: 1400px; margin: 0 auto;
          grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr);
        }
        .main, .side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        @media (max-width: 900px) { .layout { grid-template-columns: minmax(0, 1fr); } }
        .empty { padding: 32px; text-align: center; color: var(--secondary-text-color); }

        /* Month view */
        .month { padding: 16px; }
        .month-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .month-title { flex: 1; font-size: 1.4em; font-weight: 500; }
        .nav, .today-btn {
          display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;
          background: none; color: var(--primary-text-color); font: inherit;
        }
        .nav { width: 36px; height: 36px; border-radius: 50%; }
        .nav:hover:not(:disabled), .today-btn:hover { background: var(--secondary-background-color); }
        .nav:disabled { opacity: 0.3; cursor: default; }
        .today-btn {
          padding: 6px 14px; border-radius: 999px; border: 1px solid var(--divider-color);
        }
        .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
        .weekday {
          padding: 4px 0 8px; text-align: center; font-size: 0.85em;
          color: var(--secondary-text-color); text-transform: capitalize;
        }
        .day {
          min-height: 84px; padding: 6px; box-sizing: border-box; border-radius: 10px;
          background: var(--secondary-background-color); display: flex; flex-direction: column; gap: 4px;
          border: 2px solid transparent; text-align: left; font: inherit; color: inherit;
        }
        button.day { cursor: pointer; }
        button.day:hover { border-color: var(--divider-color); }
        .day.other { opacity: 0.35; }
        .day.past { opacity: 0.55; }
        .day.today { border-color: var(--primary-color); }
        .day.selected { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.15); }
        .num { font-weight: 500; }
        .day.today .num { color: var(--primary-color); }
        .picks { display: flex; flex-wrap: wrap; gap: 4px; }
        .pick {
          position: relative; width: 28px; height: 28px; border-radius: 50%; flex: none;
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 18px;
          background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--c);
        }
        .pick.remind { cursor: pointer; }
        .pick.remind:hover { box-shadow: 0 0 0 2px var(--c); }
        .bell {
          position: absolute; right: -4px; top: -4px; width: 14px; height: 14px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 10px;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
        }
        .tick {
          position: absolute; right: -4px; bottom: -4px; width: 14px; height: 14px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 12px;
          background: var(--success-color, #43a047); color: #fff;
        }
        @media (max-width: 600px) {
          .content { padding: 8px; }
          .month { padding: 12px 8px; }
          .grid { gap: 2px; }
          .day { min-height: 56px; padding: 4px; border-radius: 8px; }
          .pick { width: 18px; height: 18px; --mdc-icon-size: 12px; }
          .picks { gap: 2px; }
          .tick { width: 10px; height: 10px; --mdc-icon-size: 8px; right: -3px; bottom: -3px; }
          .bell { width: 10px; height: 10px; --mdc-icon-size: 8px; right: -3px; top: -3px; }
        }
        .details {
          margin-top: 12px; padding: 12px; border-radius: 10px;
          background: var(--secondary-background-color);
        }
        .details-date { font-weight: 500; margin-bottom: 8px; }
        .details-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .details-item { display: flex; align-items: center; gap: 8px; }
        .details-item .pick { width: 32px; height: 32px; --mdc-icon-size: 20px; }
        .muted { color: var(--secondary-text-color); }
        .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font-size: 0.9em; }
        .legend span { display: flex; align-items: center; gap: 6px; }
        .legend .pick { width: 20px; height: 20px; --mdc-icon-size: 13px; }
        .note { margin: 12px 0 0; font-size: 0.9em; color: var(--secondary-text-color); }

        /* Residual emptyings card */
        .emp-card { padding: 16px; }
        .emp-head { display: flex; align-items: center; gap: 10px; }
        .emp-head .pick { width: 36px; height: 36px; --mdc-icon-size: 22px; }
        .emp-title { font-size: 1.2em; font-weight: 500; }
        .emp-stat { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 6px; margin-top: 14px; }
        .emp-big { font-size: 2.6em; font-weight: 500; line-height: 1; }
        .emp-total { font-size: 1.2em; color: var(--secondary-text-color); }
        .emp-left { margin-left: auto; color: var(--secondary-text-color); }
        .emp-stat.full .emp-big, .emp-stat.full .emp-left { color: var(--error-color, #db4437); }
        .emp-bar {
          position: relative; height: 10px; margin: 10px 0 4px; border-radius: 999px;
          background: var(--secondary-background-color);
        }
        .emp-fill {
          position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px;
          background: var(--success-color, #43a047); transition: width 0.3s;
        }
        .emp-bar.full .emp-fill { background: var(--error-color, #db4437); }
        .emp-pace {
          position: absolute; top: -4px; bottom: -4px; width: 3px; margin-left: -1px; border-radius: 2px;
          background: var(--primary-text-color); opacity: 0.6;
        }
        .emp-card p { margin: 8px 0 0; }
        .emp-mark {
          display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
          margin-top: 14px; padding: 10px 14px; border: none; border-radius: 10px; cursor: pointer;
          font: inherit; font-weight: 500; background: var(--primary-color); color: var(--text-primary-color, #fff);
        }
        .emp-mark.marked {
          background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent);
          color: var(--success-color, #43a047);
        }
        .emp-section { margin-top: 18px; font-weight: 500; }
        .emp-list { list-style: none; margin: 6px 0 0; padding: 0; }
        .emp-list li {
          display: flex; align-items: center; gap: 10px; padding: 4px 0;
          border-bottom: 1px solid var(--divider-color);
        }
        .emp-check {
          flex: none; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center;
          justify-content: center; --mdc-icon-size: 16px;
          background: color-mix(in srgb, var(--success-color, #43a047) 18%, transparent);
          color: var(--success-color, #43a047);
        }
        .emp-day { flex: 1; }
        .emp-remove {
          flex: none; display: flex; padding: 6px; border: none; border-radius: 50%; cursor: pointer;
          background: none; color: var(--secondary-text-color);
        }
        .emp-remove:hover { color: var(--error-color, #db4437); }
        .emp-add { margin-top: 14px; }
        .emp-add summary {
          display: inline-flex; align-items: center; gap: 6px; cursor: pointer; list-style: none;
          color: var(--primary-color); --mdc-icon-size: 18px;
        }
        .emp-add summary::-webkit-details-marker { display: none; }
        .emp-add-row { display: flex; gap: 8px; margin-top: 8px; }
        .emp-date {
          flex: 1; min-width: 0; padding: 6px 8px; font: inherit; color-scheme: light dark;
          border: 1px solid var(--divider-color); border-radius: 8px;
          background: var(--card-background-color, #fff); color: var(--primary-text-color);
        }
        .emp-add-btn {
          padding: 6px 16px; font: inherit; border: none; border-radius: 8px; cursor: pointer;
          background: var(--primary-color); color: var(--text-primary-color, #fff);
        }
        .emp-error { color: var(--error-color, #db4437); }

        /* Emptyings counting turned off */
        .off-card { padding: 16px; }
        .off-head { display: flex; align-items: center; gap: 10px; }
        .off-head .pick { width: 36px; height: 36px; --mdc-icon-size: 22px; }
        .off-title { font-size: 1.2em; font-weight: 500; }
        .off-card p { margin: 12px 0 0; }
        .open-integration {
          display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; padding: 6px 14px;
          border: 1px solid var(--divider-color); border-radius: 999px; background: none; cursor: pointer;
          color: var(--primary-color); font: inherit; --mdc-icon-size: 18px;
        }
        .open-integration:hover { background: var(--secondary-background-color); }

        /* EcoCentro map card */
        .eco-card { padding: 16px; }
        .eco-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; min-height: 36px; }
        .eco-title { font-size: 1.2em; font-weight: 500; }
        .eco-icon { color: #00897b; }
        .eco-back {
          display: flex; padding: 6px; margin-left: -6px; border: none; border-radius: 50%;
          background: none; color: var(--primary-text-color); cursor: pointer;
        }
        .eco-back:hover { background: var(--secondary-background-color); }
        .eco-map {
          height: 320px; border-radius: 10px; overflow: hidden; z-index: 0;
          background: var(--secondary-background-color);
        }
        /* Same filter as Home Assistant's map in dark mode */
        .eco-map.dark .leaflet-tile-pane {
          filter: invert(0.9) hue-rotate(170deg) brightness(1.5) contrast(1.2);
        }
        .eco-own { display: flex; flex-direction: column; margin-top: 8px; }
        .eco-row {
          display: flex; align-items: center; gap: 10px; padding: 8px 4px; border: none; border-radius: 8px;
          background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
        }
        .eco-row:hover { background: var(--secondary-background-color); }
        .eco-row-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .eco-muted { color: var(--secondary-text-color); font-size: 0.9em; }
        .eco-legend {
          display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px;
          font-size: 0.85em; color: var(--secondary-text-color);
        }
        .eco-legend > span { display: flex; align-items: center; gap: 6px; }
        .eco-legend .dot.own {
          width: 12px; height: 12px; box-sizing: border-box; border: 2px solid var(--primary-text-color);
        }
        .eco-details .guide-title:first-child { margin-top: 0; font-size: 1.05em; }
        .eco-notice { font-size: 0.9em; color: var(--secondary-text-color); }
        @media (max-width: 600px) { .eco-map { height: 260px; } }
      </style>
      <div class="toolbar">
        <ha-menu-button></ha-menu-button>
        <div class="title">Contarina</div>
        <div class="tabs" role="tablist" hidden></div>
      </div>
      <div class="content"></div>`;
    this._menu = this.shadowRoot.querySelector("ha-menu-button");
    this._tabs = this.shadowRoot.querySelector(".tabs");
    this._content = this.shadowRoot.querySelector(".content");
    this.shadowRoot.addEventListener("click", (ev) => this._click(ev));
  }

  // One entry per calendar, sorted by name: {key: entry_id, location}
  _calendars() {
    const states = this._hass.states;
    const calendars = new Map();
    Object.keys(states).forEach((id) => {
      const a = states[id].attributes;
      if (!id.startsWith("sensor.") || a.waste === undefined || a.municipality_number === undefined) return;
      const location = a.location || a.municipality_name;
      if (location && a.entry_id) calendars.set(a.entry_id, location);
    });
    return [...calendars.entries()]
      .map(([key, location]) => ({ key, location }))
      .sort((a, b) => a.location.localeCompare(b.location));
  }

  // Sensor of an entry with the given attribute (EcoCentro: opening_hours, emptyings: emptyings_total)
  _hasSensor(entryId, attribute) {
    const states = this._hass.states;
    return Object.keys(states).some(
      (id) => id.startsWith("sensor.") && states[id].attributes.entry_id === entryId && states[id].attributes[attribute] !== undefined
    );
  }

  _emptiedDates(entryId) {
    const states = this._hass.states;
    const id = Object.keys(states).find(
      (i) => i.startsWith("sensor.") && states[i].attributes.entry_id === entryId && states[i].attributes.emptyings_total !== undefined
    );
    return id ? states[id].attributes.dates || [] : [];
  }

  // Waste type sensor of an entry: reminders are set on it
  _wasteSensor(entryId, waste) {
    const states = this._hass.states;
    return Object.keys(states).find(
      (i) => i.startsWith("sensor.") && states[i].attributes.entry_id === entryId && states[i].attributes.waste === waste
    );
  }

  // Pickup days with a reminder, per waste type: {waste: [date, ...]}
  _reminders(entryId) {
    const result = {};
    this._s.WASTE_KEYS.forEach((waste) => {
      const id = this._wasteSensor(entryId, waste);
      result[waste] = id ? (this._hass.states[id].attributes.reminders || []).map((r) => r.date) : [];
    });
    return result;
  }

  _card(key, config) {
    let card = this._cards.get(key);
    if (!card) {
      card = document.createElement("contarina-card");
      card.setConfig(config);
      this._cards.set(key, card);
    }
    card.hass = this._hass;
    return card;
  }

  _update() {
    if (!this._hass || !this._content) return;
    if (this._menu) {
      this._menu.hass = this._hass;
      this._menu.narrow = this._narrow;
    }
    if (!this._ready) return;

    const calendars = this._calendars();
    if (!calendars.some((c) => c.key === this._active)) this._active = calendars[0]?.key || null;
    const active = calendars.find((c) => c.key === this._active);

    // Rebuild the layout only when the calendars, the tab or the side cards change
    const sideCards = active
      ? { eco: this._hasSensor(active.key, "opening_hours"), emptyings: this._hasSensor(active.key, "emptyings_total") }
      : {};
    const layoutKey = JSON.stringify([calendars, this._active, sideCards, this._t.locale]);
    if (layoutKey !== this._layoutKey) {
      this._layoutKey = layoutKey;
      this._renderLayout(calendars, active, sideCards);
    } else {
      this._cards.forEach((card) => {
        card.hass = this._hass;
      });
    }
    if (!active) return;

    const cached = this._pickups.get(active.key);
    if (!cached || (!cached.loading && Date.now() - cached.at > PICKUPS_MAX_AGE)) this._loadPickups(active.key);
    this._renderMonth();
    if (sideCards.eco && this._ecoMap) this._ecoMap.refresh();
    if (sideCards.emptyings && this._emptyingsCard) this._emptyingsCard.update(active.key);
  }

  _renderLayout(calendars, active, sideCards) {
    const s = this._s;
    this._tabs.hidden = calendars.length < 2;
    this._tabs.innerHTML = calendars
      .map(
        (c) =>
          `<button class="tab ${c.key === this._active ? "active" : ""}" role="tab"
            aria-selected="${c.key === this._active}" data-key="${s.esc(c.key)}">${s.esc(c.location)}</button>`
      )
      .join("");

    this._content.replaceChildren();
    if (!active) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = this._pt.empty;
      this._content.append(empty);
      return;
    }

    const layout = document.createElement("div");
    layout.className = "layout";
    const month = document.createElement("ha-card");
    month.className = "month";
    this._monthEl = month;
    this._monthKey = null;
    // Left: the month and, under it, the search (second on a phone, where it's one column)
    const main = document.createElement("div");
    main.className = "main";
    main.append(month, this._card("search", { view: "search" }));
    const side = document.createElement("div");
    side.className = "side";

    // The cards are reused across tab switches
    if (sideCards.eco) {
      if (!this._ecoMap) this._ecoMap = new EcoMap(this);
      side.append(this._ecoMap.el);
    }
    if (sideCards.emptyings) {
      if (!this._emptyingsCard) this._emptyingsCard = new EmptyingsCard(this);
      this._emptyingsCard.key = null;
      this._emptyingsCard.update(active.key);
      side.append(this._emptyingsCard.el);
    } else {
      side.append(this._emptyingsOff());
    }
    layout.append(main, side);
    this._content.append(layout);
    // After it's in the page: the map needs a sized container
    if (sideCards.eco) this._ecoMap.setEntry(active.key);
  }

  // Counting turned off: what it is and where to turn it on (the options are for admins)
  _emptyingsOff() {
    const s = this._s;
    const pt = this._pt;
    const card = document.createElement("ha-card");
    card.className = "off-card";
    card.innerHTML = `
      <div class="off-head">
        <span class="pick" style="--c:${s.WASTE_STYLE.residual.color}"><ha-icon icon="${s.WASTE_STYLE.residual.icon}"></ha-icon></span>
        <span class="off-title">${s.esc(this._t.emptyings_title)}</span>
      </div>
      <p>${s.esc(pt.emptyings_off)}</p>
      <p class="muted">${s.esc(pt.emptyings_how)}</p>
      ${
        this._hass.user?.is_admin
          ? `<button class="open-integration"><ha-icon icon="mdi:cog-outline"></ha-icon>${s.esc(pt.emptyings_open)}</button>`
          : ""
      }`;
    return card;
  }

  async _loadPickups(entryId) {
    const previous = this._pickups.get(entryId);
    this._pickups.set(entryId, { ...(previous || { list: [] }), loading: true, at: Date.now() });
    try {
      const result = await this._hass.callWS({ type: "contarina/pickups", entry_id: entryId });
      this._pickups.set(entryId, { list: result.pickups || [], at: Date.now(), loading: false });
    } catch (err) {
      this._pickups.set(entryId, { list: previous?.list || [], at: Date.now(), loading: false, error: true });
    }
    if (entryId === this._active) this._renderMonth();
  }

  _renderMonth() {
    if (!this._monthEl || !this._active) return;
    const s = this._s;
    const t = this._t;
    const pt = this._pt;
    const data = this._pickups.get(this._active) || { list: [] };
    const emptied = new Set(this._emptiedDates(this._active));
    const reminders = this._reminders(this._active);
    const hasReminder = (type, iso) => (reminders[type] || []).includes(iso);
    const today = s.isoDate(new Date());
    const byDate = new Map(data.list.map((p) => [p.date, p.types]));
    // Default selection: the first pickup from today on
    const selected = this._selected || data.list.find((p) => p.date >= today)?.date || today;

    const key = JSON.stringify([t.locale, this._month.getTime(), selected, today, data, [...emptied], reminders]);
    if (key === this._monthKey) return;
    this._monthKey = key;

    const first = this._month;
    const offset = (first.getDay() + 6) % 7; // Monday first
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);

    // `iso`: a pickup from today on, tappable to set a reminder (bell if there is one)
    const pick = (type, withTick, iso = null) => {
      const style = s.WASTE_STYLE[type] || { icon: "mdi:delete", color: "#9e9e9e" };
      const tick = withTick ? `<span class="tick"><ha-icon icon="mdi:check"></ha-icon></span>` : "";
      const bell = iso && hasReminder(type, iso) ? `<span class="bell"><ha-icon icon="mdi:bell"></ha-icon></span>` : "";
      const name = t.waste[type] || type;
      const active = iso && iso >= today;
      const title = active ? `${name} · ${t.reminder_button}` : name;
      return `<span class="pick ${active ? "remind" : ""}" style="--c:${style.color}" title="${s.esc(title)}"${
        active ? ` data-waste="${s.esc(type)}" data-date="${iso}"` : ""
      }><ha-icon icon="${style.icon}"></ha-icon>${tick}${bell}</span>`;
    };

    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 1 + i).toLocaleDateString(t.locale, { weekday: "short" })
    );
    const days = Array.from({ length: cells }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = s.isoDate(date);
      const types = byDate.get(iso) || [];
      const classes = [
        "day",
        date.getMonth() !== first.getMonth() ? "other" : "",
        iso < today ? "past" : "",
        iso === today ? "today" : "",
        iso === selected ? "selected" : "",
      ].join(" ");
      const label = `${date.toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" })}${
        types.length ? `: ${types.map((w) => t.waste[w] || w).join(", ")}` : ""
      }`;
      return `
        <button class="${classes}" data-date="${iso}" aria-label="${s.esc(label)}">
          <span class="num">${date.getDate()}</span>
          <span class="picks">${types.map((w) => pick(w, w === "residual" && emptied.has(iso), iso)).join("")}</span>
        </button>`;
    }).join("");

    // Navigation: from this month (past pickups aren't published) to the last one available
    const thisMonth = monthStart(new Date());
    const lastDate = data.list.length ? new Date(`${data.list[data.list.length - 1].date}T00:00:00`) : null;
    const lastMonth = lastDate ? monthStart(lastDate) : thisMonth;
    const canPrev = this._month > thisMonth;
    const canNext = this._month < lastMonth;
    const title = s.capitalize(first.toLocaleDateString(t.locale, { month: "long", year: "numeric" }));

    const selTypes = byDate.get(selected) || [];
    const selDate = new Date(`${selected}T00:00:00`);
    const details = `
      <div class="details">
        <div class="details-date">${s.esc(
          s.capitalize(selDate.toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long" }))
        )}</div>
        ${
          selTypes.length
            ? `<div class="details-list">${selTypes
                .map(
                  (w) => `<span class="details-item">${pick(w, w === "residual" && emptied.has(selected), selected)}${s.esc(
                    t.waste[w] || w
                  )}${w === "residual" && emptied.has(selected) ? ` <span class="muted">(${s.esc(pt.emptied)})</span>` : ""}</span>`
                )
                .join("")}</div>`
            : `<div class="muted">${s.esc(pt.no_pickups)}</div>`
        }
      </div>`;

    const legend = s.WASTE_KEYS.map((w) => `<span>${pick(w, false)}${s.esc(t.waste[w])}</span>`).join("");
    const notes = [
      data.error && !data.list.length ? pt.unavailable : null,
      !canNext && lastDate && lastDate.getMonth() === 11 && this._month.getTime() === lastMonth.getTime() ? pt.new_year : null,
    ]
      .filter(Boolean)
      .map((n) => `<p class="note">${s.esc(n)}</p>`)
      .join("");

    this._monthEl.innerHTML = `
      <div class="month-head">
        <div class="month-title">${s.esc(title)}</div>
        <button class="today-btn">${s.esc(pt.today)}</button>
        <button class="nav prev" ${canPrev ? "" : "disabled"} title="${s.esc(pt.previous)}" aria-label="${s.esc(pt.previous)}">
          <ha-icon icon="mdi:chevron-left"></ha-icon></button>
        <button class="nav next" ${canNext ? "" : "disabled"} title="${s.esc(pt.next)}" aria-label="${s.esc(pt.next)}">
          <ha-icon icon="mdi:chevron-right"></ha-icon></button>
      </div>
      <div class="grid">
        ${weekdays.map((w) => `<div class="weekday">${s.esc(w.replace(".", ""))}</div>`).join("")}
        ${days}
      </div>
      ${details}
      <div class="legend">${legend}</div>
      ${notes}`;
  }

  _click(ev) {
    const tab = ev.target.closest(".tab");
    if (tab) {
      this._active = tab.dataset.key;
      this._selected = null;
      this._month = monthStart(new Date());
      try {
        localStorage.setItem(TAB_STORAGE_KEY, this._active);
      } catch (err) {
        // Private mode or blocked storage: the tab just isn't remembered
      }
      this._update();
      return;
    }
    if (ev.target.closest(".nav.prev")) {
      this._month = addMonths(this._month, -1);
      this._renderMonth();
      return;
    }
    if (ev.target.closest(".nav.next")) {
      this._month = addMonths(this._month, 1);
      this._renderMonth();
      return;
    }
    if (ev.target.closest(".today-btn")) {
      this._month = monthStart(new Date());
      this._selected = window.ContarinaShared.isoDate(new Date());
      this._renderMonth();
      return;
    }
    if (ev.target.closest(".open-integration")) {
      // Navigation inside Home Assistant, without reloading the page
      history.pushState(null, "", "/config/integrations/integration/contarina");
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return;
    }
    // A waste icon of a pickup (or its button in the details): set a reminder
    const remind = ev.target.closest(".pick[data-waste]");
    if (remind) {
      const entityId = this._wasteSensor(this._active, remind.dataset.waste);
      if (entityId) {
        this._s.openReminder({ hass: this._hass, entityId, date: remind.dataset.date });
        return;
      }
    }
    const day = ev.target.closest(".day[data-date]");
    if (day) {
      this._selected = day.dataset.date;
      // A day of the previous/next month brings that month into view
      const date = new Date(`${day.dataset.date}T00:00:00`);
      if (date.getMonth() !== this._month.getMonth()) this._month = monthStart(date);
      this._renderMonth();
    }
  }
}

if (!customElements.get("contarina-panel")) {
  customElements.define("contarina-panel", ContarinaPanel);
}
