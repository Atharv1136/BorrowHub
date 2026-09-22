if (typeof window === "undefined") {
  require("./server-db");
} else {
  /* ==========================================================================
     BorrowHub frontend
     Talks to the Express/MySQL API defined in app.js (server).
     No build step — vanilla JS, fetch, localStorage for the logged-in user.
     ========================================================================== */

  const isLocalDev = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port !== "5000" && window.location.port !== "";
  const API_BASE = isLocalDev ? "http://localhost:5000/api" : "/api";

  const state = {
    user: null,          // current logged-in user (from localStorage)
    view: "dashboard",
    categories: [],       // cached
    usersById: {},        // cached, id -> user (for display-only lookups)
  };

  /* ---------------------------------------------------------------------- */
  /* API helper                                                              */
  /* ---------------------------------------------------------------------- */

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const message = (data && data.message) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  /* ---------------------------------------------------------------------- */
  /* Small helpers                                                           */
  /* ---------------------------------------------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str = "") {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function initials(name = "?") {
    return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");
  }

  function fmtDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function fmtDateTime(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function badge(status) {
    const cls = `badge-${String(status).toLowerCase()}`;
    return `<span class="badge ${cls}">${escapeHtml(prettyStatus(status))}</span>`;
  }

  function prettyStatus(s) {
    return String(s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }

  function showBanner(message, type = "ok") {
    const el = $("#banner");
    el.textContent = message;
    el.className = `banner ${type}`;
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => el.classList.add("hidden"), 4500);
  }

  function requireLogin() {
    if (!state.user) {
      showBanner("Please log in first.", "err");
      openLoginModal();
      return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Modal                                                                    */
  /* ---------------------------------------------------------------------- */

  function openModal(html) {
    $("#modal-box").innerHTML = html;
    $("#modal-overlay").classList.remove("hidden");
  }
  function closeModal() {
    $("#modal-overlay").classList.add("hidden");
    $("#modal-box").innerHTML = "";
  }
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

  /* ---------------------------------------------------------------------- */
  /* Auth                                                                     */
  /* ---------------------------------------------------------------------- */

  function loadUser() {
    try {
      const raw = localStorage.getItem("borrowhub_user");
      state.user = raw ? JSON.parse(raw) : null;
    } catch (_) { state.user = null; }
  }

  function saveUser(user) {
    state.user = user;
    localStorage.setItem("borrowhub_user", JSON.stringify(user));
    renderAuthBox();
  }

  function logout() {
    state.user = null;
    localStorage.removeItem("borrowhub_user");
    window.location.replace("/frontend/auth.html?mode=login");
  }

  function renderAuthBox() {
    const box = $("#auth-box");
    if (!state.user) {
      box.innerHTML = `
      <button class="btn btn-primary btn-block" id="btn-login">Log in</button>
      <button class="btn btn-ghost btn-block" id="btn-register">Create account</button>
    `;
      $("#btn-login").addEventListener("click", openLoginModal);
      $("#btn-register").addEventListener("click", openRegisterModal);
    } else {
      const collegeName = state.user.college_name || "";
      box.innerHTML = `
      <div class="user-chip">
        <span class="user-chip__avatar">${escapeHtml(initials(state.user.name))}</span>
        <div>
          <p class="user-chip__name">${escapeHtml(state.user.name)}</p>
          <p class="user-chip__role">${escapeHtml(state.user.role)}${collegeName ? ` · ${collegeName.split(" ")[0]}` : ""}</p>
        </div>
      </div>
      <button class="btn btn-ghost btn-block" id="btn-logout">Log out</button>
    `;
      $("#btn-logout").addEventListener("click", logout);
      // Update sidebar brand tag with college name
      const pillLabel = document.getElementById("college-pill-label");
      if (pillLabel && collegeName) pillLabel.textContent = "🏛️ " + collegeName;
    }
  }

  function openLoginModal() {
    openModal(`
    <h2>Log in</h2>
    <p class="modal-sub">Use the email and password from your BorrowHub account.</p>
    <form id="login-form">
      <div class="field"><label>Email</label><input type="email" name="email" required /></div>
      <div class="field"><label>Password</label><input type="password" name="password" required /></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-login">Cancel</button>
        <button type="submit" class="btn btn-primary">Log in</button>
      </div>
    </form>
  `);
    $("#cancel-login").addEventListener("click", closeModal);
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const user = await api("/auth/login", { method: "POST", body: Object.fromEntries(fd) });
        saveUser(user);
        closeModal();
        showBanner(`Welcome back, ${user.name}.`, "ok");
        switchView("dashboard");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  function openRegisterModal() {
    openModal(`
    <h2>Create your account</h2>
    <p class="modal-sub">Use your college email so people know you're a verified student.</p>
    <form id="register-form">
      <div class="field"><label>Full name</label><input type="text" name="name" required /></div>
      <div class="field"><label>College email</label><input type="email" name="email" required /></div>
      <div class="field">
        <label>🏛️ Select Your College (Pune)</label>
        <select name="college_name" required style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:14px;">
          <option value="" disabled selected>-- Select your Pune college --</option>
          <option>Pune Institute of Computer Technology (PICT)</option>
          <option>College of Engineering Pune (COEP)</option>
          <option>Vishwakarma Institute of Technology (VIT Pune)</option>
          <option>MIT College of Engineering (MITCOE)</option>
          <option>Symbiosis Institute of Technology (SIT Pune)</option>
          <option>Army Institute of Technology (AIT Pune)</option>
          <option>Dr. D.Y. Patil College of Engineering (DYPCE)</option>
          <option>Bharati Vidyapeeth College of Engineering (BVCE)</option>
          <option>Sinhgad College of Engineering (SCOE)</option>
          <option>Maharashtra Institute of Technology (MIT Kothrud)</option>
          <option>Indira College of Engineering &amp; Management (ICEM)</option>
          <option>Zeal College of Engineering and Research (ZCOER)</option>
          <option>Genba Sopanrao Moze College of Engineering (GSMCOE)</option>
          <option>Savitribai Phule Pune University (SPPU)</option>
          <option>Ferguson College Pune</option>
          <option>Modern College of Engineering Pune</option>
          <option>Cummins College of Engineering for Women</option>
          <option>Pimpri Chinchwad College of Engineering (PCCOE)</option>
          <option>Sandip Institute of Engineering and Management</option>
          <option>NBN Sinhgad School of Engineering</option>
          <option>Other</option>
        </select>
        <p class="field-hint">🔒 Only students from the same college can borrow from each other.</p>
      </div>
      <div class="field"><label>Password</label><input type="password" name="password" required minlength="4" /></div>
      <div class="field-row">
        <div class="field"><label>Department</label><input type="text" name="department" placeholder="e.g. Computer Engineering" /></div>
        <div class="field"><label>Year</label><input type="text" name="year" placeholder="e.g. 3rd Year" /></div>
      </div>
      <div class="field"><label>Phone</label><input type="tel" name="phone" /></div>
      <div class="field">
        <label>Role</label>
        <select name="role">
          <option value="student">Student</option>
          <option value="writer">Writer</option>
          <option value="both">Both</option>
        </select>
        <p class="field-hint">Setting this to Writer/Both labels your account only — a writer profile with pricing and subjects still needs to be added directly in the database for now.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-register">Cancel</button>
        <button type="submit" class="btn btn-primary">Create account</button>
      </div>
    </form>
  `);
    $("#cancel-register").addEventListener("click", closeModal);
    $("#register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const user = await api("/auth/register", { method: "POST", body: Object.fromEntries(fd) });
        saveUser(user);
        closeModal();
        showBanner(`Account created — welcome, ${user.name}.`, "ok");
        switchView("dashboard");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                               */
  /* ---------------------------------------------------------------------- */

  const VIEW_META = {
    dashboard: { title: "Dashboard", desc: "A quick look at what's happening around campus." },
    items: { title: "Browse items", desc: "Find something you need for a few days instead of buying it." },
    "my-items": { title: "My items", desc: "Items you've listed for other students to borrow." },
    "borrow-requests": { title: "Borrow requests", desc: "Requests you've sent, and requests waiting on your items." },
    transactions: { title: "Transactions", desc: "Every approved borrow, from hand-off to return." },
    "need-board": { title: "Need board", desc: "Post what you couldn't find — owners of a matching item can offer to lend it." },
    "writing-requests": { title: "Writing requests", desc: "Notes, assignments, and reports students need written." },
    writers: { title: "Writers", desc: "Students offering to write notes, assignments, and reports." },
    "writing-orders": { title: "Orders", desc: "Writing jobs that have been assigned to a writer." },
    favorites: { title: "Favorites", desc: "Items you've bookmarked for later." },
    notifications: { title: "Notifications", desc: "Updates on your requests, offers, and orders." },
    profile: { title: "Profile", desc: "Your account details." },
  };

  function switchView(view) {
    state.view = view;
    $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
    const meta = VIEW_META[view] || { title: view, desc: "" };
    $("#view-title").textContent = meta.title;
    $("#view-desc").textContent = meta.desc;
    $("#topbar-actions").innerHTML = "";
    renderView(view);
  }

  function setupNav() {
    $$(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Shared lookups                                                           */
  /* ---------------------------------------------------------------------- */

  async function ensureCategories() {
    if (state.categories.length) return state.categories;
    state.categories = await api("/categories");
    return state.categories;
  }

  async function ensureUsersMap() {
    if (Object.keys(state.usersById).length) return state.usersById;
    const users = await api("/users");
    state.usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));
    return state.usersById;
  }

  /* ---------------------------------------------------------------------- */
  /* Router                                                                   */
  /* ---------------------------------------------------------------------- */

  function renderView(view) {
    const content = $("#view-content");
    content.innerHTML = `<p class="loading">Loading…</p>`;
    const renderers = {
      dashboard: renderDashboard,
      items: renderItems,
      "my-items": renderMyItems,
      "borrow-requests": renderBorrowRequests,
      transactions: renderTransactions,
      "need-board": renderNeedBoard,
      "writing-requests": renderWritingRequests,
      writers: renderWriters,
      "writing-orders": renderWritingOrders,
      favorites: renderFavorites,
      notifications: renderNotifications,
      profile: renderProfile,
    };
    (renderers[view] || renderDashboard)(content).catch((err) => {
      content.innerHTML = `<div class="empty-state"><strong>Couldn't load this page</strong>${escapeHtml(err.message)}</div>`;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Dashboard                                                                */
  /* ---------------------------------------------------------------------- */

  async function renderDashboard(content) {
    const [items, writingRequests, writers] = await Promise.all([
      state.user && state.user.college_name
        ? api(`/items?available=true&college_name=${encodeURIComponent(state.user.college_name)}`)
        : api("/items?available=true"),
      api("/writing-requests?status=open"),
      api("/writer-profiles"),
    ]);

    let mine = { sent: [], received: [], notifs: [] };
    if (state.user) {
      const [sent, allItems, notifs] = await Promise.all([
        api(`/borrow-requests?borrower_id=${state.user.user_id}`),
        api(`/items?owner_id=${state.user.user_id}`),
        api(`/notifications/${state.user.user_id}`),
      ]);
      mine.sent = sent;
      mine.notifs = notifs;
      mine.myItemIds = allItems.map((i) => i.item_id);
    }

    content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="n">${items.length}</div><div class="l">Items available now</div></div>
      <div class="stat-card olive"><div class="n">${writingRequests.length}</div><div class="l">Open writing requests</div></div>
      <div class="stat-card olive"><div class="n">${writers.length}</div><div class="l">Registered writers</div></div>
      <div class="stat-card amber"><div class="n">${state.user ? mine.notifs.filter((n) => !n.is_read).length : "—"}</div><div class="l">Unread notifications</div></div>
    </div>

    ${!state.user ? `
      <div class="empty-state">
        <strong>You're not logged in</strong>
        Log in or create an account to borrow items, list your own, or hire a writer.
      </div>
    ` : `
      <div class="dash-section">
        <h3>Your recent borrow requests</h3>
        ${mine.sent.length ? renderBorrowRequestTable(mine.sent.slice(0, 5), { showOwnerActions: false }) : emptyState("Nothing yet", "Browse items and send your first borrow request.")}
      </div>
    `}

    <div class="dash-section">
      <h3>Recently listed items</h3>
      ${items.length ? renderItemGrid(items.slice(0, 4)) : emptyState("No items listed yet", "Be the first to list something.")}
    </div>
  `;

    wireItemCardButtons(content, items.slice(0, 4));
  }

  function emptyState(title, body) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(body)}</div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Items — browse                                                          */
  /* ---------------------------------------------------------------------- */

  async function renderItems(content) {
    await ensureCategories();

    $("#topbar-actions").innerHTML = `<button class="btn btn-primary" id="btn-add-item">List an item</button>`;
    $("#btn-add-item").addEventListener("click", () => openItemFormModal());

    content.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="filter-category">
          <option value="">All categories</option>
          ${state.categories.map((c) => `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`).join("")}
        </select>
        <label class="checkbox-row"><input type="checkbox" id="filter-available" checked /> Available only</label>
      </div>
      ${state.user ? `<div></div>` : `<p class="field-hint">Log in to request or favorite items.</p>`}
    </div>
    <div id="items-slot"><p class="loading">Loading items…</p></div>
  `;

    const load = async () => {
      const cat = $("#filter-category").value;
      const availOnly = $("#filter-available").checked;
      const qs = new URLSearchParams();
      if (cat) qs.set("category_id", cat);
      if (availOnly) qs.set("available", "true");
      // College isolation: only show items from the logged-in user's college
      if (state.user && state.user.college_name) qs.set("college_name", state.user.college_name);
      const items = await api(`/items?${qs.toString()}`);
      const slot = $("#items-slot");
      slot.innerHTML = items.length ? renderItemGrid(items) : emptyState("No items match those filters", state.user ? `No items available from ${state.user.college_name || "your college"}. Try a different filter.` : "Log in to see items from your college.");
      wireItemCardButtons(slot, items);
    };

    $("#filter-category").addEventListener("change", load);
    $("#filter-available").addEventListener("change", load);
    await load();
  }

  function renderItemGrid(items) {
    return `<div class="item-grid">${items.map(itemCard).join("")}</div>`;
  }

  function itemCard(item) {
    const isMine = state.user && item.owner_id === state.user.user_id;
    const imgUrl = item.image_url || 'https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=500&auto=format&fit=crop&q=80';
    return `
    <div class="item-card" data-item-id="${item.item_id}">
      <div class="item-card__img-wrap">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.item_name)}" class="item-card__img" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=500&auto=format&fit=crop&q=80'" />
        <span class="item-card__tab">${escapeHtml(item.category_name || "Item")}</span>
      </div>
      <div class="item-card__body">
        <h4>${escapeHtml(item.item_name)}</h4>
        <p class="meta">Owner: ${escapeHtml(item.owner_name || "—")} · ${escapeHtml(item.location || "Campus")}</p>
        <p class="desc">${escapeHtml(item.description || "No description provided.")}</p>
        <p class="meta">${badge(item.availability ? "available" : "unavailable")} ${badge(item.borrowing_type)} · Condition: ${escapeHtml(item.item_condition || "—")}</p>
        <div class="item-card__foot">
          ${isMine
          ? `<span class="field-hint">This is your item</span>`
          : `<button class="btn btn-primary btn-sm btn-borrow" data-id="${item.item_id}" ${item.availability ? "" : "disabled"}>Request to borrow</button>`}
          ${state.user && !isMine ? `<button class="btn-icon btn-fav" data-id="${item.item_id}" title="Save to favorites">♥</button>` : ""}
        </div>
      </div>
    </div>
  `;
  }

  function wireItemCardButtons(root, items) {
    $$(".btn-borrow", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!requireLogin()) return;
        const item = items.find((i) => String(i.item_id) === btn.dataset.id);
        openBorrowRequestModal(item);
      });
    });
    $$(".btn-fav", root).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!requireLogin()) return;
        try {
          await api("/favorites", { method: "POST", body: { user_id: state.user.user_id, item_id: Number(btn.dataset.id) } });
          showBanner("Added to favorites.", "ok");
          btn.classList.add("active");
        } catch (err) { showBanner(err.message, "err"); }
      });
    });
  }

  function openBorrowRequestModal(item) {
    openModal(`
    <h2>Request to borrow</h2>
    <p class="modal-sub">${escapeHtml(item.item_name)} · owned by ${escapeHtml(item.owner_name)}</p>
    <form id="borrow-form">
      <div class="field-row">
        <div class="field"><label>From</label><input type="date" name="start_date" required /></div>
        <div class="field"><label>Until</label><input type="date" name="end_date" required /></div>
      </div>
      <div class="field"><label>Reason</label><input type="text" name="reason" placeholder="e.g. Internal examination" required /></div>
      <div class="field"><label>Message to owner (optional)</label><textarea name="message" placeholder="Anything the owner should know"></textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-borrow">Cancel</button>
        <button type="submit" class="btn btn-primary">Send request</button>
      </div>
    </form>
  `);
    $("#cancel-borrow").addEventListener("click", closeModal);
    $("#borrow-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        await api("/borrow-requests", {
          method: "POST",
          body: { item_id: item.item_id, borrower_id: state.user.user_id, ...fd },
        });
        closeModal();
        showBanner("Borrow request sent.", "ok");
        renderView(state.view);
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* My items                                                                 */
  /* ---------------------------------------------------------------------- */

  async function renderMyItems(content) {
    if (!requireLoginView(content)) return;
    await ensureCategories();

    $("#topbar-actions").innerHTML = `<button class="btn btn-primary" id="btn-add-item">List an item</button>`;
    $("#btn-add-item").addEventListener("click", () => openItemFormModal());

    const items = await api(`/items?owner_id=${state.user.user_id}`);
    content.innerHTML = items.length ? `<div class="item-grid">${items.map(myItemCard).join("")}</div>`
      : emptyState("You haven't listed anything yet", "List an item so other students can borrow it.");

    $$(".btn-edit-item", content).forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((i) => String(i.item_id) === btn.dataset.id);
        openItemFormModal(item);
      });
    });
    $$(".btn-delete-item", content).forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this item from BorrowHub?")) return;
        try {
          await api(`/items/${btn.dataset.id}`, { method: "DELETE" });
          showBanner("Item removed.", "ok");
          renderView("my-items");
        } catch (err) { showBanner(err.message, "err"); }
      });
    });
  }

  function myItemCard(item) {
    const imgUrl = item.image_url || 'https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=500&auto=format&fit=crop&q=80';
    return `
    <div class="item-card">
      <div class="item-card__img-wrap">
        <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(item.item_name)}" class="item-card__img" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=500&auto=format&fit=crop&q=80'" />
        <span class="item-card__tab">${escapeHtml(item.category_name || "Item")}</span>
      </div>
      <div class="item-card__body">
        <h4>${escapeHtml(item.item_name)}</h4>
        <p class="meta">${escapeHtml(item.location || "Campus")}</p>
        <p class="desc">${escapeHtml(item.description || "No description provided.")}</p>
        <p class="meta">${badge(item.availability ? "available" : "unavailable")} ${badge(item.borrowing_type)}</p>
        <div class="item-card__foot">
          <button class="btn btn-ghost btn-sm btn-edit-item" data-id="${item.item_id}">Edit</button>
          <button class="btn btn-danger btn-sm btn-delete-item" data-id="${item.item_id}">Delete</button>
        </div>
      </div>
    </div>
  `;
  }

  function openItemFormModal(item) {
    const isEdit = Boolean(item);
    openModal(`
    <h2>${isEdit ? "Edit item" : "List an item"}</h2>
    <p class="modal-sub">${isEdit ? "Update the details below." : "Give other students the details they need to request it."}</p>
    <form id="item-form">
      <div class="field"><label>Item name</label><input type="text" name="item_name" value="${item ? escapeHtml(item.item_name) : ""}" required /></div>
      <div class="field"><label>Description</label><textarea name="description">${item ? escapeHtml(item.description || "") : ""}</textarea></div>
      
      <div class="field">
        <label>🖼️ Product Image (Upload File or Web Image URL)</label>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
          <input type="file" id="item-file-input" accept="image/*" style="display:none;" />
          <button type="button" class="btn btn-ghost btn-sm" id="btn-trigger-upload">📁 Choose Image File</button>
          <span id="upload-status" class="field-hint">No file chosen</span>
        </div>
        <input type="url" name="image_url" id="item-image-url" value="${item ? escapeHtml(item.image_url || "") : ""}" placeholder="Or paste image URL (e.g. https://images.unsplash.com/...)" style="width:100%;" />
        <div id="image-preview-container" style="margin-top:10px;${item && item.image_url ? "" : "display:none;"}">
          <p class="field-hint" style="margin-bottom:4px;">Image Preview:</p>
          <img id="image-preview" src="${item ? escapeHtml(item.image_url || "") : ""}" style="max-height:140px;border-radius:8px;object-fit:cover;border:1px solid #cbd5e1;" />
        </div>
      </div>

      <div class="field-row">
        ${!isEdit ? `
          <div class="field"><label>Category</label>
            <select name="category_id" required>
              ${state.categories.map((c) => `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`).join("")}
            </select>
          </div>` : ""}
        <div class="field"><label>Condition</label>
          <select name="item_condition">
            ${["New", "Good", "Fair"].map((c) => `<option ${item?.item_condition === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Borrowing type</label>
          <select name="borrowing_type">
            <option value="free" ${item?.borrowing_type === "free" ? "selected" : ""}>Free</option>
            <option value="paid" ${item?.borrowing_type === "paid" ? "selected" : ""}>Paid</option>
          </select>
        </div>
        <div class="field"><label>Max borrow period (days)</label><input type="number" name="max_borrow_period" min="1" value="${item ? item.max_borrow_period : 3}" /></div>
      </div>
      <div class="field"><label>Pickup location</label><input type="text" name="location" value="${item ? escapeHtml(item.location || "") : ""}" placeholder="e.g. College Library" /></div>
      ${isEdit ? `<div class="checkbox-row" style="margin-bottom:14px;"><input type="checkbox" name="availability" id="avail-check" ${item.availability ? "checked" : ""} /><label for="avail-check">Currently available</label></div>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-item">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "List item"}</button>
      </div>
    </form>
  `);

    const fileInput = $("#item-file-input");
    const urlInput = $("#item-image-url");
    const previewContainer = $("#image-preview-container");
    const previewImg = $("#image-preview");
    const uploadStatus = $("#upload-status");

    $("#btn-trigger-upload").addEventListener("click", () => fileInput.click());

    urlInput.addEventListener("input", () => {
      const val = urlInput.value.trim();
      if (val) {
        previewImg.src = val;
        previewContainer.style.display = "block";
      } else {
        previewContainer.style.display = "none";
      }
    });

    fileInput.addEventListener("change", async () => {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      uploadStatus.textContent = "Uploading " + file.name + "...";
      const formData = new FormData();
      formData.append("image", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.image_url) {
          urlInput.value = data.image_url;
          previewImg.src = data.image_url;
          previewContainer.style.display = "block";
          uploadStatus.textContent = "✅ Uploaded " + file.name;
        } else {
          uploadStatus.textContent = "❌ Upload failed";
        }
      } catch (err) {
        uploadStatus.textContent = "❌ Upload failed: " + err.message;
      }
    });

    $("#cancel-item").addEventListener("click", closeModal);
    $("#item-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if (isEdit) body.availability = fd.get("availability") === "on";
      try {
        if (isEdit) {
          await api(`/items/${item.item_id}`, { method: "PUT", body });
          showBanner("Item updated.", "ok");
        } else {
          body.owner_id = state.user.user_id;
          await api("/items", { method: "POST", body });
          showBanner("Item listed successfully!", "ok");
        }
        closeModal();
        renderView(state.view === "items" ? "items" : "my-items");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Borrow requests (sent + received)                                       */
  /* ---------------------------------------------------------------------- */

  async function renderBorrowRequests(content) {
    if (!requireLoginView(content)) return;

    const [sent, received] = await Promise.all([
      api(`/borrow-requests?borrower_id=${state.user.user_id}`),
      api(`/borrow-requests?owner_id=${state.user.user_id}`),
    ]);

    content.innerHTML = `
    <h3 class="subhead">Requests you've sent</h3>
    ${sent.length ? renderBorrowRequestTable(sent, { showOwnerActions: false }) : emptyState("No requests sent yet", "Browse items and send your first request.")}

    <h3 class="subhead">Requests on your items</h3>
    ${received.length ? renderBorrowRequestTable(received, { showOwnerActions: true }) : emptyState("Nothing waiting on you", "Requests other students send for your items will show up here.")}
  `;

    $$(".btn-approve", content).forEach((btn) => btn.addEventListener("click", () => updateRequestStatus(btn.dataset.id, "approved")));
    $$(".btn-reject", content).forEach((btn) => btn.addEventListener("click", () => updateRequestStatus(btn.dataset.id, "rejected")));
  }

  function renderBorrowRequestTable(rows, { showOwnerActions }) {
    return `
    <table class="ledger">
      <thead><tr>
        <th>Item</th><th>${showOwnerActions ? "Borrower" : "Owner"}</th><th>Dates</th><th>Status</th>${showOwnerActions ? "<th>Action</th>" : ""}
      </tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${escapeHtml(r.item_name)}</td>
            <td>${escapeHtml(showOwnerActions ? r.borrower_name : r.owner_name)}</td>
            <td>${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}</td>
            <td>${badge(r.status)}</td>
            ${showOwnerActions ? `
              <td class="actions">
                ${r.status === "requested" ? `
                  <button class="btn btn-olive btn-sm btn-approve" data-id="${r.request_id}">Approve</button>
                  <button class="btn btn-danger btn-sm btn-reject" data-id="${r.request_id}">Reject</button>
                ` : `<span class="field-hint">No action needed</span>`}
              </td>` : ""}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  }

  async function updateRequestStatus(id, status) {
    try {
      await api(`/borrow-requests/${id}/status`, { method: "PATCH", body: { status } });
      showBanner(`Request ${status}.`, "ok");
      renderView("borrow-requests");
    } catch (err) { showBanner(err.message, "err"); }
  }

  /* ---------------------------------------------------------------------- */
  /* Transactions                                                             */
  /* ---------------------------------------------------------------------- */

  async function renderTransactions(content) {
    const [transactions] = await Promise.all([api("/transactions"), ensureUsersMap()]);
    content.innerHTML = transactions.length ? `
    <table class="ledger">
      <thead><tr><th>Item</th><th>Borrower</th><th>Borrowed</th><th>Due</th><th>Returned</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${transactions.map((t) => `
          <tr>
            <td>${escapeHtml(t.item_name)}</td>
            <td>${escapeHtml(state.usersById[t.borrower_id]?.name || "—")}</td>
            <td>${fmtDate(t.borrowed_date)}</td>
            <td>${fmtDate(t.due_date)}</td>
            <td>${fmtDate(t.returned_date)}</td>
            <td>${badge(t.status)}</td>
            <td>${t.status === "borrowed" ? `<button class="btn btn-olive btn-sm btn-return" data-id="${t.transaction_id}">Mark returned</button>` : "—"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : emptyState("No transactions yet", "Once a borrow request is approved, it will show up here.");

    $$(".btn-return", content).forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await api(`/transactions/${btn.dataset.id}/return`, { method: "PATCH", body: {} });
        showBanner("Marked as returned.", "ok");
        renderView("transactions");
      } catch (err) { showBanner(err.message, "err"); }
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Need board                                                               */
  /* ---------------------------------------------------------------------- */

  async function renderNeedBoard(content) {
    $("#topbar-actions").innerHTML = `<button class="btn btn-primary" id="btn-post-need">Post a need</button>`;
    $("#btn-post-need").addEventListener("click", () => {
      if (!requireLogin()) return;
      openNeedPostModal();
    });

    const posts = await api("/need-posts");
    content.innerHTML = posts.length ? posts.map((p) => `
    <div class="list-row">
      <div>
        <p class="list-row__msg"><strong>${escapeHtml(p.item_name)}</strong> needed by ${escapeHtml(p.user_name)}</p>
        <p class="list-row__time">${fmtDate(p.required_from)} → ${fmtDate(p.required_until)} ${p.reason ? "· " + escapeHtml(p.reason) : ""}</p>
      </div>
      ${badge(p.urgency)}
    </div>
  `).join("") : emptyState("No open needs right now", "If you can't find something in Browse items, post it here.");
  }

  function openNeedPostModal() {
    openModal(`
    <h2>Post what you need</h2>
    <p class="modal-sub">Owners of a matching item can see this and offer to lend it.</p>
    <form id="need-form">
      <div class="field"><label>Item</label><input type="text" name="item_name" required /></div>
      <div class="field-row">
        <div class="field"><label>Needed from</label><input type="date" name="required_from" required /></div>
        <div class="field"><label>Needed until</label><input type="date" name="required_until" required /></div>
      </div>
      <div class="field"><label>Reason</label><input type="text" name="reason" /></div>
      <div class="field"><label>Urgency</label>
        <select name="urgency">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-need">Cancel</button>
        <button type="submit" class="btn btn-primary">Post</button>
      </div>
    </form>
  `);
    $("#cancel-need").addEventListener("click", closeModal);
    $("#need-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        await api("/need-posts", { method: "POST", body: { user_id: state.user.user_id, ...fd } });
        closeModal();
        showBanner("Posted to the Need Board.", "ok");
        renderView("need-board");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Writing requests + offers                                               */
  /* ---------------------------------------------------------------------- */

  async function renderWritingRequests(content) {
    $("#topbar-actions").innerHTML = `<button class="btn btn-olive" id="btn-post-writing">Post a writing request</button>`;
    $("#btn-post-writing").addEventListener("click", () => {
      if (!requireLogin()) return;
      openWritingRequestModal();
    });

    content.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="filter-wr-status">
          <option value="">All statuses</option>
          ${["open", "offer_received", "assigned", "in_progress", "delivered", "completed", "cancelled"]
        .map((s) => `<option value="${s}">${prettyStatus(s)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="wr-slot"><p class="loading">Loading…</p></div>
  `;

    const load = async () => {
      const status = $("#filter-wr-status").value;
      const requests = await api(`/writing-requests${status ? `?status=${status}` : ""}`);
      $("#wr-slot").innerHTML = requests.length
        ? `<div class="item-grid">${requests.map(writingRequestCard).join("")}</div>`
        : emptyState("No writing requests here", "Post one so a writer can pick it up.");
      wireWritingRequestButtons($("#wr-slot"), requests);
    };
    $("#filter-wr-status").addEventListener("change", load);
    await load();
  }

  function writingRequestCard(r) {
    return `
    <div class="item-card writing-card">
      <div class="item-card__body" style="padding-top:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <span class="item-card__tab-inline writing">${escapeHtml(r.subject || r.type)}</span>
          ${badge(r.status)}
        </div>
        <h4 style="margin-top:2px;">${escapeHtml(r.title)}</h4>
        <p class="meta">Posted by ${escapeHtml(r.student_name)} · Due ${fmtDate(r.deadline)}</p>
        <p class="desc">${escapeHtml(r.description || "No further details given.")}</p>
        <p class="meta">${r.budget ? `Budget ₹${r.budget}` : ""} ${r.length_pages ? `· ~${r.length_pages} pages` : ""}</p>
        <div class="item-card__foot">
          <button class="btn btn-ghost btn-sm btn-view-offers" data-id="${r.writing_request_id}">View offers</button>
          <button class="btn btn-olive btn-sm btn-make-offer" data-id="${r.writing_request_id}">Submit offer</button>
        </div>
        <div class="offers-slot" data-slot="${r.writing_request_id}"></div>
      </div>
    </div>
  `;
  }

  function wireWritingRequestButtons(root, requests) {
    $$(".btn-view-offers", root).forEach((btn) => btn.addEventListener("click", async () => {
      const slot = root.querySelector(`.offers-slot[data-slot="${btn.dataset.id}"]`);
      if (slot.dataset.open === "1") { slot.innerHTML = ""; slot.dataset.open = "0"; return; }
      slot.innerHTML = `<p class="loading">Loading offers…</p>`;
      try {
        const offers = await api(`/writing-requests/${btn.dataset.id}/offers`);
        slot.dataset.open = "1";
        slot.innerHTML = offers.length ? offers.map((o) => `
        <div class="list-row">
          <div>
            <p class="list-row__msg"><strong>${escapeHtml(o.writer_name)}</strong> — ₹${o.proposed_price} · by ${fmtDate(o.delivery_date)}</p>
            <p class="list-row__time">${escapeHtml(o.message || "No message")} · ${o.avg_rating ? `★ ${o.avg_rating}` : "New writer"}</p>
          </div>
          ${badge(o.status)}
        </div>
      `).join("") : emptyState("No offers yet", "Check back soon.");
      } catch (err) { slot.innerHTML = `<p class="field-hint">${escapeHtml(err.message)}</p>`; }
    }));

    $$(".btn-make-offer", root).forEach((btn) => btn.addEventListener("click", () => {
      if (!requireLogin()) return;
      const req = requests.find((r) => String(r.writing_request_id) === btn.dataset.id);
      openOfferModal(req);
    }));
  }

  function openWritingRequestModal() {
    openModal(`
    <h2>Post a writing request</h2>
    <p class="modal-sub">Describe the work — verified writers will send you offers.</p>
    <form id="wr-form">
      <div class="field"><label>Title</label><input type="text" name="title" placeholder="e.g. DBMS Unit 3 Notes" required /></div>
      <div class="field-row">
        <div class="field"><label>Subject</label><input type="text" name="subject" /></div>
        <div class="field"><label>Type</label>
          <select name="type">
            <option value="notes">Notes</option>
            <option value="assignment">Assignment</option>
            <option value="record">Record</option>
            <option value="project_report">Project report</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Description</label><textarea name="description" placeholder="What exactly do you need covered?"></textarea></div>
      <div class="field-row">
        <div class="field"><label>Length (pages)</label><input type="number" name="length_pages" min="1" /></div>
        <div class="field"><label>Budget (₹)</label><input type="number" name="budget" min="0" /></div>
      </div>
      <div class="field"><label>Deadline</label><input type="date" name="deadline" required /></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-wr">Cancel</button>
        <button type="submit" class="btn btn-olive">Post request</button>
      </div>
    </form>
  `);
    $("#cancel-wr").addEventListener("click", closeModal);
    $("#wr-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        await api("/writing-requests", { method: "POST", body: { student_id: state.user.user_id, ...fd } });
        closeModal();
        showBanner("Writing request posted.", "ok");
        renderView("writing-requests");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  function openOfferModal(req) {
    openModal(`
    <h2>Submit an offer</h2>
    <p class="modal-sub">${escapeHtml(req.title)} — due ${fmtDate(req.deadline)}</p>
    <form id="offer-form">
      <div class="field">
        <label>Your writer ID</label>
        <input type="number" name="writer_id" value="${state.user.user_id}" required />
        <p class="field-hint">This must match an existing Writer_Profiles row — if you haven't been registered as a writer in the database yet, this will be rejected.</p>
      </div>
      <div class="field-row">
        <div class="field"><label>Your price (₹)</label><input type="number" name="proposed_price" min="0" required /></div>
        <div class="field"><label>Delivery date</label><input type="date" name="delivery_date" required /></div>
      </div>
      <div class="field"><label>Message</label><textarea name="message" placeholder="Why you're a good fit for this"></textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-offer">Cancel</button>
        <button type="submit" class="btn btn-olive">Send offer</button>
      </div>
    </form>
  `);
    $("#cancel-offer").addEventListener("click", closeModal);
    $("#offer-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        await api(`/writing-requests/${req.writing_request_id}/offers`, { method: "POST", body: fd });
        closeModal();
        showBanner("Offer sent.", "ok");
        renderView("writing-requests");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Writers directory                                                        */
  /* ---------------------------------------------------------------------- */

  async function renderWriters(content) {
    const writers = await api("/writer-profiles");
    content.innerHTML = writers.length ? `<div class="writer-grid">${writers.map(writerCard).join("")}</div>`
      : emptyState("No writers registered yet", "Writer profiles are added directly in the database for now.");
  }

  function writerCard(w) {
    return `
    <div class="writer-card">
      <div class="writer-card__top">
        <span class="writer-card__avatar">${escapeHtml(initials(w.name))}</span>
        <div>
          <h4>${escapeHtml(w.name)}</h4>
          <p class="writer-card__rating">★ ${w.avg_rating || "New"} · ${w.completed_orders} completed</p>
        </div>
      </div>
      <p class="bio">${escapeHtml(w.bio || "No bio provided.")}</p>
      <div class="tags">${(w.subjects || "").split(",").filter(Boolean).map((s) => `<span class="tag">${escapeHtml(s.trim())}</span>`).join("")}</div>
      <p class="meta">₹${w.price_per_page}/page ${w.is_verified ? "· " + badge("verified") : ""}</p>
    </div>
  `;
  }

  /* ---------------------------------------------------------------------- */
  /* Writing orders                                                           */
  /* ---------------------------------------------------------------------- */

  async function renderWritingOrders(content) {
    const orders = await api("/writing-orders");
    content.innerHTML = orders.length ? `
    <table class="ledger">
      <thead><tr><th>Title</th><th>Student</th><th>Writer</th><th>Agreed price</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>
        ${orders.map((o) => `
          <tr>
            <td>${escapeHtml(o.title)}</td>
            <td>${escapeHtml(o.student_name)}</td>
            <td>${escapeHtml(o.writer_name)}</td>
            <td>₹${o.agreed_price}</td>
            <td>${fmtDate(o.due_date)}</td>
            <td>${badge(o.status)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  ` : emptyState("No orders yet", "Orders appear once a student accepts a writer's offer.");
  }

  /* ---------------------------------------------------------------------- */
  /* Favorites                                                                */
  /* ---------------------------------------------------------------------- */

  async function renderFavorites(content) {
    if (!requireLoginView(content)) return;
    const favorites = await api(`/favorites/${state.user.user_id}`);
    content.innerHTML = favorites.length ? favorites.map((f) => `
    <div class="list-row">
      <div>
        <p class="list-row__msg"><strong>${escapeHtml(f.item_name)}</strong> · ${escapeHtml(f.category_name)}</p>
        <p class="list-row__time">${badge(f.availability ? "available" : "unavailable")}</p>
      </div>
      <button class="btn btn-danger btn-sm btn-unfav" data-id="${f.item_id}">Remove</button>
    </div>
  `).join("") : emptyState("No favorites yet", "Tap the heart on any item to save it here.");

    $$(".btn-unfav", content).forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await api(`/favorites/${state.user.user_id}/${btn.dataset.id}`, { method: "DELETE" });
        showBanner("Removed from favorites.", "ok");
        renderView("favorites");
      } catch (err) { showBanner(err.message, "err"); }
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Notifications                                                            */
  /* ---------------------------------------------------------------------- */

  async function renderNotifications(content) {
    if (!requireLoginView(content)) return;
    const notifs = await api(`/notifications/${state.user.user_id}`);
    $("#notif-dot").classList.toggle("hidden", !notifs.some((n) => !n.is_read));

    content.innerHTML = notifs.length ? notifs.map((n) => `
    <div class="list-row ${n.is_read ? "" : "unread"}">
      <div>
        <p class="list-row__msg">${escapeHtml(n.message)}</p>
        <p class="list-row__time">${fmtDateTime(n.created_at)}</p>
      </div>
      ${n.is_read ? "" : `<button class="btn btn-ghost btn-sm btn-mark-read" data-id="${n.notification_id}">Mark read</button>`}
    </div>
  `).join("") : emptyState("You're all caught up", "New updates on your requests and orders will show up here.");

    $$(".btn-mark-read", content).forEach((btn) => btn.addEventListener("click", async () => {
      try {
        await api(`/notifications/${btn.dataset.id}/read`, { method: "PATCH", body: {} });
        renderView("notifications");
      } catch (err) { showBanner(err.message, "err"); }
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Profile                                                                  */
  /* ---------------------------------------------------------------------- */

  async function renderProfile(content) {
    if (!requireLoginView(content)) return;
    const user = await api(`/users/${state.user.user_id}`);
    content.innerHTML = `
    <form id="profile-form" style="max-width:420px;">
      <div class="field"><label>Full name</label><input type="text" name="name" value="${escapeHtml(user.name)}" required /></div>
      <div class="field"><label>Email (fixed)</label><input type="email" value="${escapeHtml(user.email)}" disabled /></div>
      <div class="field-row">
        <div class="field"><label>Department</label><input type="text" name="department" value="${escapeHtml(user.department || "")}" /></div>
        <div class="field"><label>Year</label><input type="text" name="year" value="${escapeHtml(user.year || "")}" /></div>
      </div>
      <div class="field"><label>Phone</label><input type="tel" name="phone" value="${escapeHtml(user.phone || "")}" /></div>
      <div class="field"><label>Role</label>
        <select name="role">
          <option value="student" ${user.role === "student" ? "selected" : ""}>Student</option>
          <option value="writer" ${user.role === "writer" ? "selected" : ""}>Writer</option>
          <option value="both" ${user.role === "both" ? "selected" : ""}>Both</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary">Save changes</button>
    </form>
    <form id="password-form" style="max-width:420px; margin-top:28px;">
      <h3>Change password</h3>
      <div class="field"><label>New password</label><input type="password" name="new_password" minlength="4" required /></div>
      <button type="submit" class="btn btn-olive">Update password</button>
    </form>
  `;
    $("#profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const updated = await api(`/users/${user.user_id}`, { method: "PUT", body: fd });
        saveUser({ ...state.user, ...updated });
        showBanner("Profile updated.", "ok");
      } catch (err) { showBanner(err.message, "err"); }
    });
    $("#password-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try {
        await api(`/users/${user.user_id}/password`, { method: "PATCH", body });
        e.target.reset();
        showBanner("Password updated.", "ok");
      } catch (err) { showBanner(err.message, "err"); }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Guard for views that need login                                         */
  /* ---------------------------------------------------------------------- */

  function requireLoginView(content) {
    if (state.user) return true;
    content.innerHTML = `
    <div class="empty-state">
      <strong>Log in to see this page</strong>
      This section is personal to your account.
    </div>
  `;
    return false;
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                     */
  /* ---------------------------------------------------------------------- */

  function boot() {
    loadUser();
    if (!state.user) {
      window.location.replace("/frontend/auth.html?mode=login");
      return;
    }
    renderAuthBox();
    setupNav();
    switchView("dashboard");
  }

  document.addEventListener("DOMContentLoaded", boot);
}