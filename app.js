const STORAGE_KEYS = {
  favorites: "playlist__favorites",
  selectedTags: "playlist__selectedTags",
  sortMode: "playlist__sortMode"
};

const state = {
  songs: [],
  filteredSongs: [],
  viewMode: "gallery",
  favorites: new Set(),
  selectedTags: new Set(),
  activeFilters: new Map(),
  sortMode: "song",
  searchRecommendations: [],
  allTags: [],
  alphaIndexMap: new Map(),
  alphaDragActive: false,
  lastDraggedLetter: ""
};

const collatorZh = new Intl.Collator("zh-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
  ignorePunctuation: true
});
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const elements = {
  searchInput: document.getElementById("searchInput"),
  searchWrap: document.querySelector(".search-wrap"),
  searchRecommendations: document.getElementById("searchRecommendations"),
  songTableBody: document.getElementById("songTableBody"),
  songTableHeader: document.getElementById("songTableHeader"),
  tableWrap: document.getElementById("tableWrap"),
  galleryWrap: document.getElementById("galleryWrap"),
  listModeBtn: document.getElementById("listModeBtn"),
  galleryModeBtn: document.getElementById("galleryModeBtn"),
  sortSongBtn: document.getElementById("sortSongBtn"),
  sortSingerBtn: document.getElementById("sortSingerBtn"),
  emptyState: document.getElementById("emptyState"),
  alphaNav: document.getElementById("alphaNav"),
  recommendBubble: document.getElementById("recommendBubble"),
  recommendModal: document.getElementById("recommendModal"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  tagFilters: document.getElementById("tagFilters"),
  randomBtn: document.getElementById("randomBtn"),
  recommendResult: document.getElementById("recommendResult"),
  toast: document.getElementById("toast"),
  activeFilters: document.getElementById("activeFilters")
};

init().catch((error) => {
  console.error(error);
  showToast("歌曲加载失败，请稍后重试");
});

async function init() {
  bindBaseEvents();
  restoreStorage();

  const songs = await fetchSongs();
  state.songs = normalizeSongs(songs);
  state.allTags = collectAllTags(state.songs);

  try {
    state.searchRecommendations = await fetchSearchRecommendations();
  } catch (error) {
    console.error(error);
    showToast("搜索推荐加载失败，请检查 recommendations.json");
  }

  renderTagFilters();
  applySearchAndRender();
}

function bindBaseEvents() {
  elements.searchInput.addEventListener("input", applySearchAndRender);
  elements.searchInput.addEventListener("focus", renderSearchRecommendations);
  document.addEventListener("pointerdown", (event) => {
    if (!elements.searchWrap.contains(event.target)) {
      hideSearchRecommendations();
    }
  });
  setupAlphaDragEvents();

  elements.listModeBtn.addEventListener("click", () => setViewMode("list"));
  elements.galleryModeBtn.addEventListener("click", () => setViewMode("gallery"));
  elements.sortSongBtn.addEventListener("click", () => setSortMode("song"));
  elements.sortSingerBtn.addEventListener("click", () => setSortMode("singer"));

  elements.recommendBubble.addEventListener("click", () => {
    elements.recommendModal.showModal();
  });

  elements.closeModalBtn.addEventListener("click", () => {
    elements.recommendModal.close();
  });

  elements.recommendModal.addEventListener("click", (event) => {
    const rect = elements.recommendModal.getBoundingClientRect();
    const isOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (isOutside) {
      elements.recommendModal.close();
    }
  });

  elements.randomBtn.addEventListener("click", () => {
    const song = pickRandomRecommendation();
    renderRecommendation(song);
  });
}

function setupAlphaDragEvents() {
  elements.alphaNav.addEventListener("pointerdown", (event) => {
    state.alphaDragActive = true;
    state.lastDraggedLetter = "";
    elements.alphaNav.classList.add("dragging");
    selectAlphaByPoint(event.clientX, event.clientY, true);
    event.preventDefault();
  });

  elements.alphaNav.addEventListener("pointermove", (event) => {
    if (!state.alphaDragActive) {
      return;
    }
    selectAlphaByPoint(event.clientX, event.clientY, true);
    event.preventDefault();
  });

  window.addEventListener("pointerup", () => {
    state.alphaDragActive = false;
    state.lastDraggedLetter = "";
    elements.alphaNav.classList.remove("dragging");
  });
}

function selectAlphaByPoint(clientX, clientY, silentIfMissing) {
  const target = document.elementFromPoint(clientX, clientY);
  if (!target) {
    return;
  }

  const alphaButton = target.closest(".alpha-btn");
  if (!alphaButton || !elements.alphaNav.contains(alphaButton)) {
    return;
  }

  const letter = alphaButton.dataset.letter;
  if (!letter || letter === state.lastDraggedLetter) {
    return;
  }

  state.lastDraggedLetter = letter;
  scrollToSongByLetter(letter, { silentIfMissing });
}

function restoreStorage() {
  state.favorites = new Set(readJsonStorage(STORAGE_KEYS.favorites, []));
  state.selectedTags = new Set(readJsonStorage(STORAGE_KEYS.selectedTags, []));
  const savedSortMode = readTextStorage(STORAGE_KEYS.sortMode, "");
  if (savedSortMode === "song" || savedSortMode === "singer") {
    state.sortMode = savedSortMode;
  }
}

async function fetchSongs() {
  const response = await fetch("song.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load song.json");
  }

  const json = await response.json();
  return Array.isArray(json.songs) ? json.songs : [];
}

async function fetchSearchRecommendations() {
  const response = await fetch("recommendations.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load recommendations.json");
  }

  const json = await response.json();
  if (!Array.isArray(json.recommendations)) {
    throw new Error("Invalid recommendations.json: expected a recommendations array");
  }

  return json.recommendations.map((item) => {
    if (
      !item ||
      !["song", "singer"].includes(item.type) ||
      typeof item.value !== "string" ||
      (item.note !== undefined && typeof item.note !== "string")
    ) {
      throw new Error("Invalid search recommendation: expected song or singer type and a string value");
    }

    const value = item.value.trim();
    const exists = item.type === "song"
      ? state.songs.some((song) => song.songName === value)
      : state.songs.some((song) => song.singer.includes(value));
    if (!value || !exists) {
      throw new Error(`Search recommendation does not match a song or singer: ${value}`);
    }

    return {
      type: item.type,
      value,
      note: String(item.note || "").trim()
    };
  });
}

function normalizeSongs(songs) {
  return songs
    .filter((song) => song && typeof song.id === "number")
    .map((song, index) => ({
      id: song.id,
      originalIndex: index,
      songName: String(song.songName || "").trim(),
      singer: normalizeSinger(song.singer),
      tags: Array.isArray(song.tags) ? song.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
    }));
}

function normalizeSinger(rawSinger) {
  if (Array.isArray(rawSinger)) {
    return rawSinger.map((name) => String(name).trim()).filter(Boolean);
  }

  if (typeof rawSinger === "string" && rawSinger.trim()) {
    return rawSinger
      .split("/")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  return ["未知歌手"];
}

function collectAllTags(songs) {
  const tagSet = new Set();
  songs.forEach((song) => {
    song.tags.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort((a, b) => collatorZh.compare(a, b));
}

function applySearchAndRender() {
  const keywords = tokenize(elements.searchInput.value);

  let filtered = keywords.length
    ? state.songs.filter((song) => matchAllKeywords(song, keywords))
    : [...state.songs];

  if (state.activeFilters.size) {
    filtered = filtered.filter((song) => matchAllActiveFilters(song));
  }

  state.filteredSongs = state.viewMode === "gallery"
    ? sortSongs(filtered, "song")
    : sortSongs(filtered);

  renderActiveFilters();
  renderCurrentView();
  if (document.activeElement === elements.searchInput) {
    renderSearchRecommendations();
  }
}

function setSortMode(mode) {
  if (mode !== "song" && mode !== "singer") {
    return;
  }
  if (state.sortMode === mode) {
    return;
  }

  state.sortMode = mode;
  writeTextStorage(STORAGE_KEYS.sortMode, mode);
  applySearchAndRender();
}

function setViewMode(mode) {
  if (mode !== "list" && mode !== "gallery") {
    return;
  }
  if (state.viewMode === mode) {
    return;
  }

  state.viewMode = mode;
  applySearchAndRender();
}

function renderCurrentView() {
  const inGalleryMode = state.viewMode === "gallery";

  elements.listModeBtn.classList.toggle("active", !inGalleryMode);
  elements.galleryModeBtn.classList.toggle("active", inGalleryMode);
  elements.listModeBtn.setAttribute("aria-pressed", String(!inGalleryMode));
  elements.galleryModeBtn.setAttribute("aria-pressed", String(inGalleryMode));
  const sortBySong = state.sortMode === "song";
  elements.sortSongBtn.classList.toggle("active", sortBySong);
  elements.sortSingerBtn.classList.toggle("active", !sortBySong);
  elements.sortSongBtn.setAttribute("aria-pressed", String(sortBySong));
  elements.sortSingerBtn.setAttribute("aria-pressed", String(!sortBySong));
  elements.sortSongBtn.disabled = inGalleryMode;
  elements.sortSingerBtn.disabled = inGalleryMode;

  elements.tableWrap.hidden = inGalleryMode;
  elements.galleryWrap.hidden = !inGalleryMode;

  if (inGalleryMode) {
    renderSongGallery();
    buildAlphaIndex("song");
    renderAlphaNav();
    return;
  }

  // Clear gallery content when switching to list mode
  elements.galleryWrap.innerHTML = "";

  renderSongTable();
  buildAlphaIndex();
  renderAlphaNav();
}

function tokenize(inputValue) {
  return String(inputValue || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function matchAllKeywords(song, keywords) {
  const fields = [song.songName, song.singer.join(" "), song.tags.join(" ")]
    .join(" ")
    .toLowerCase();

  return keywords.every((keyword) => fields.includes(keyword));
}

function matchAllActiveFilters(song) {
  return Array.from(state.activeFilters).every(
    ([, filter]) => {
      if (filter.type === "song") {
        return song.songName === filter.value;
      }
      if (filter.type === "singer") {
        return song.singer.includes(filter.value);
      }
      return song.tags.includes(filter.value);
    }
  );
}

function sortSongs(songs, sortMode = state.sortMode) {
  return [...songs].sort((a, b) => {
    const singerAKey = getMixedSortKey(a.singer[0] || "");
    const singerBKey = getMixedSortKey(b.singer[0] || "");
    const songAKey = getMixedSortKey(a.songName);
    const songBKey = getMixedSortKey(b.songName);
    const primaryCompare = sortMode === "song"
      ? collatorZh.compare(songAKey, songBKey)
      : collatorZh.compare(singerAKey, singerBKey);
    if (primaryCompare !== 0) {
      return primaryCompare;
    }

    const secondaryCompare = sortMode === "song"
      ? collatorZh.compare(singerAKey, singerBKey)
      : collatorZh.compare(songAKey, songBKey);
    if (secondaryCompare !== 0) {
      return secondaryCompare;
    }

    return a.originalIndex - b.originalIndex;
  });
}

function getMixedSortKey(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  if (window.pinyinPro && typeof window.pinyinPro.pinyin === "function") {
    const pinyinArray = window.pinyinPro.pinyin(text, {
      toneType: "none",
      type: "array"
    });

    if (Array.isArray(pinyinArray) && pinyinArray.length) {
      return pinyinArray.join("").toLowerCase();
    }
  }

  return text.toLowerCase();
}

function renderSongTable() {
  elements.songTableBody.innerHTML = "";
  renderSongTableHeader();

  if (!state.filteredSongs.length) {
    elements.emptyState.hidden = false;
    return;
  }

  elements.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  let previousLetter = "";

  state.filteredSongs.forEach((song) => {
    const letter = getPrimaryLetter(song);
    if (letter !== previousLetter) {
      const groupRow = document.createElement("tr");
      groupRow.className = "song-group-row";
      const groupHeading = document.createElement("th");
      groupHeading.colSpan = 4;
      groupHeading.scope = "rowgroup";
      groupHeading.textContent = letter;
      groupRow.appendChild(groupHeading);
      fragment.appendChild(groupRow);
      previousLetter = letter;
    }

    const tr = document.createElement("tr");
    tr.className = "song-row";
    tr.dataset.songId = String(song.id);

    const singerTd = document.createElement("td");
    singerTd.className = "singer-cell";
    song.singer.forEach((singerName) => {
      const span = document.createElement("span");
      span.className = "singer-pill";
      if (hasActiveFilter("singer", singerName)) {
        span.classList.add("filter-active");
      }
      span.textContent = singerName;
      span.title = `按歌手「${singerName}」筛选`;
      span.addEventListener("click", () => addFilter(singerName, "singer"));
      singerTd.appendChild(span);
    });

    const songTd = document.createElement("td");
    songTd.className = "copyable-song-name";
    songTd.textContent = song.songName;
    songTd.title = "长按复制歌名";
    bindLongPressCopy(songTd, song.songName);

    const tagsTd = document.createElement("td");
    tagsTd.className = "tags-cell";
    song.tags.forEach((tag) => {
      const tagSpan = document.createElement("span");
      tagSpan.className = "tag";
      if (hasActiveFilter("tag", tag)) {
        tagSpan.classList.add("filter-active");
      }
      tagSpan.textContent = tag;
      tagSpan.title = `按标签「${tag}」筛选`;
      tagSpan.addEventListener("click", () => addFilter(tag, "tag"));
      tagsTd.appendChild(tagSpan);
    });

    const favTd = document.createElement("td");
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "fav-btn";
    const isFav = state.favorites.has(song.id);
    if (isFav) {
      favBtn.classList.add("favored");
    }
    favBtn.textContent = "❤";
    favBtn.setAttribute("aria-label", isFav ? "取消收藏" : "收藏歌曲");
    favBtn.addEventListener("click", () => toggleFavorite(song.id));

    favTd.appendChild(favBtn);

    if (state.sortMode === "song") {
      tr.appendChild(songTd);
      tr.appendChild(singerTd);
    } else {
      tr.appendChild(singerTd);
      tr.appendChild(songTd);
    }
    tr.appendChild(tagsTd);
    tr.appendChild(favTd);

    fragment.appendChild(tr);
  });

  elements.songTableBody.appendChild(fragment);
}

function renderSongTableHeader() {
  elements.songTableHeader.innerHTML = "";
  const columns = state.sortMode === "song"
    ? ["歌名", "歌手", "标签", "收藏"]
    : ["歌手", "歌名", "标签", "收藏"];

  columns.forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    elements.songTableHeader.appendChild(th);
  });
}

function renderSongGallery() {
  elements.galleryWrap.innerHTML = "";

  if (!state.filteredSongs.length) {
    elements.emptyState.hidden = false;
    return;
  }

  elements.emptyState.hidden = true;

  const header = document.createElement("div");
  header.className = "gallery-header";
  const title = document.createElement("h3");
  title.className = "gallery-title";
  title.textContent = "全部歌曲";
  const count = document.createElement("span");
  count.className = "gallery-count";
  count.textContent = `${state.filteredSongs.length} 首`;
  header.append(title, count);

  const fragment = document.createDocumentFragment();
  let currentLetter = "";
  let songGrid = null;

  state.filteredSongs.forEach((song) => {
    const letter = getPrimaryLetter(song, "song");
    if (letter !== currentLetter) {
      const group = document.createElement("section");
      group.className = "gallery-group";
      group.dataset.letter = letter;

      const heading = document.createElement("h4");
      heading.className = "gallery-group-heading";
      heading.textContent = letter;

      songGrid = document.createElement("div");
      songGrid.className = "gallery-song-grid";
      group.append(heading, songGrid);
      fragment.appendChild(group);
      currentLetter = letter;
    }

    const item = document.createElement("div");
    item.className = "gallery-song";
    const name = document.createElement("span");
    name.className = "gallery-song-name";
    name.textContent = song.songName;

    const requestButton = document.createElement("button");
    requestButton.type = "button";
    requestButton.className = "gallery-request-btn";
    requestButton.textContent = "点歌";
    requestButton.setAttribute("aria-label", `复制歌名：${song.songName}`);
    requestButton.addEventListener("click", () => copySongName(song.songName));

    item.append(name, requestButton);
    songGrid.appendChild(item);
  });

  elements.galleryWrap.append(header, fragment);
}

async function copySongName(songName) {
  try {
    await navigator.clipboard.writeText(songName);
    showToast(`已复制歌名：${songName}`);
  } catch (error) {
    console.error("Failed to copy song name", error);
    showToast("复制失败，请检查浏览器剪贴板权限");
  }
}

function bindLongPressCopy(element, songName) {
  const holdDuration = 550;
  const movementThreshold = 10;
  let pointerStart = null;
  let copyTriggered = false;

  element.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }

    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: Date.now()
    };
    copyTriggered = false;
  });

  element.addEventListener("pointermove", (event) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y
    );
    if (distance > movementThreshold) {
      pointerStart = null;
    }
  });

  element.addEventListener("pointerup", (event) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) {
      return;
    }

    const heldLongEnough = Date.now() - pointerStart.time >= holdDuration;
    pointerStart = null;
    if (heldLongEnough && !copyTriggered) {
      copyTriggered = true;
      event.preventDefault();
      copySongName(songName);
    }
  });

  element.addEventListener("pointercancel", () => {
    pointerStart = null;
  });

  element.addEventListener("contextmenu", (event) => {
    if (!pointerStart || Date.now() - pointerStart.time < holdDuration) {
      return;
    }

    event.preventDefault();
    if (!copyTriggered) {
      copyTriggered = true;
      copySongName(songName);
    }
  });
}

function toggleFavorite(songId) {
  if (state.favorites.has(songId)) {
    state.favorites.delete(songId);
  } else {
    state.favorites.add(songId);
  }

  writeJsonStorage(STORAGE_KEYS.favorites, Array.from(state.favorites));
  applySearchAndRender();
}

function filterKey(type, value) {
  return `${type}:${value}`;
}

function hasActiveFilter(type, value) {
  return state.activeFilters.has(filterKey(type, value));
}

function addFilter(value, type) {
  const key = filterKey(type, value);
  if (state.activeFilters.has(key)) {
    return;
  }
  state.activeFilters.set(key, { type, value });
  applySearchAndRender();
}

function removeFilter(key) {
  state.activeFilters.delete(key);
  applySearchAndRender();
}

function clearAllFilters() {
  state.activeFilters.clear();
  applySearchAndRender();
}

function renderActiveFilters() {
  const container = elements.activeFilters;
  container.innerHTML = "";

  if (!state.activeFilters.size) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const fragment = document.createDocumentFragment();

  state.activeFilters.forEach(({ type, value }, key) => {
    const chip = document.createElement("span");
    chip.className = "active-filter-chip";

    const label = document.createElement("span");
    label.textContent = type === "song" ? `歌名：${value}` : value;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-filter";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `移除筛选：${label.textContent}`);
    removeBtn.addEventListener("click", () => removeFilter(key));

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    fragment.appendChild(chip);
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "clear-filters-btn";
  clearBtn.textContent = "清除全部";
  clearBtn.addEventListener("click", clearAllFilters);
  fragment.appendChild(clearBtn);

  container.appendChild(fragment);
}

function buildAlphaIndex(sortMode = state.sortMode) {
  const indexMap = new Map();

  state.filteredSongs.forEach((song) => {
    const primaryLetter = getPrimaryLetter(song, sortMode);
    if (/^[A-Z]$/.test(primaryLetter) && !indexMap.has(primaryLetter)) {
      indexMap.set(primaryLetter, song.id);
    }
  });

  state.alphaIndexMap = indexMap;
}

function renderAlphaNav() {
  elements.alphaNav.innerHTML = "";
  elements.alphaNav.hidden = false;
  elements.alphaNav.setAttribute(
    "aria-label",
    `按${state.viewMode === "gallery" || state.sortMode === "song" ? "歌名" : "歌手"}首字母导航`
  );

  const fragment = document.createDocumentFragment();

  ALPHABET.forEach((letter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alpha-btn";
    button.dataset.letter = letter;
    button.textContent = letter;

    if (!state.alphaIndexMap.has(letter)) {
      button.classList.add("disabled");
      button.setAttribute("aria-disabled", "true");
    }

    button.addEventListener("click", () => {
      scrollToSongByLetter(letter, { silentIfMissing: false });
    });
    fragment.appendChild(button);
  });

  elements.alphaNav.appendChild(fragment);
}

function scrollToSongByLetter(letter, options = {}) {
  const { silentIfMissing = false } = options;
  if (!state.alphaIndexMap.has(letter)) {
    if (!silentIfMissing) {
      const sortBySong = state.viewMode === "gallery" || state.sortMode === "song";
      showToast(`未找到 ${letter} 开头${sortBySong ? "歌名" : "歌手"}`);
    }
    return;
  }

  if (state.viewMode === "gallery") {
    const group = elements.galleryWrap.querySelector(
      `.gallery-group[data-letter="${letter}"]`
    );
    if (!group) {
      return;
    }

    group.scrollIntoView({ behavior: "smooth", block: "start" });
    group.classList.add("highlight");
    window.setTimeout(() => group.classList.remove("highlight"), 950);
    return;
  }

  const songId = state.alphaIndexMap.get(letter);
  const row = elements.songTableBody.querySelector(`tr[data-song-id="${songId}"]`);
  if (!row) {
    return;
  }

  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("highlight");
  window.setTimeout(() => row.classList.remove("highlight"), 950);
}

function getPrimaryLetter(song, sortMode = state.sortMode) {
  const value = String(sortMode === "song" ? song.songName : song.singer[0] || "").trim();
  if (!value) {
    return "#";
  }

  const first = value[0];
  if (/^[a-z]/i.test(first)) {
    return first.toUpperCase();
  }

  if (/^\d$/.test(first)) {
    return first;
  }

  if (/^[\u4e00-\u9fa5]$/.test(first)) {
    if (window.pinyinPro && typeof window.pinyinPro.pinyin === "function") {
      const result = window.pinyinPro.pinyin(first, { toneType: "none", type: "array" });
      if (Array.isArray(result) && result.length) {
        const letter = String(result[0]).charAt(0).toUpperCase();
        return /^[A-Z]$/.test(letter) ? letter : "#";
      }
    }
  }

  return "#";
}

function renderSearchRecommendations() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase("zh-CN");
  const recommendations = state.searchRecommendations.filter((item) => {
    const searchable = `${item.value} ${item.note}`.toLocaleLowerCase("zh-CN");
    return !query || searchable.includes(query);
  });
  elements.searchRecommendations.innerHTML = "";

  if (!recommendations.length) {
    hideSearchRecommendations();
    return;
  }

  const fragment = document.createDocumentFragment();
  [
    { type: "song", title: "最近爱唱", items: recommendations.filter((item) => item.type === "song") },
    { type: "singer", title: "推荐歌手", items: recommendations.filter((item) => item.type === "singer") }
  ].forEach((group) => {
    if (!group.items.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "search-recommendation-group";
    const heading = document.createElement("h3");
    heading.className = "search-recommendation-heading";
    heading.textContent = group.title;

    const options = document.createElement("div");
    options.className = "search-recommendation-options";
    group.items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-recommendation";
      button.textContent = item.value;
      button.setAttribute(
        "aria-label",
        item.note ? `${item.value}，${item.note}` : item.value
      );

      if (item.note) {
        const note = document.createElement("span");
        note.className = "search-recommendation-note";
        note.textContent = item.note;
        button.appendChild(note);
      }

      button.addEventListener("click", () => {
        addFilter(item.value, item.type);
        elements.searchInput.focus();
        hideSearchRecommendations();
      });
      options.appendChild(button);
    });

    section.append(heading, options);
    fragment.appendChild(section);
  });

  elements.searchRecommendations.appendChild(fragment);
  elements.searchRecommendations.hidden = false;
  elements.searchInput.setAttribute("aria-expanded", "true");
}

function hideSearchRecommendations() {
  elements.searchRecommendations.hidden = true;
  elements.searchInput.setAttribute("aria-expanded", "false");
}

function renderTagFilters() {
  elements.tagFilters.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.textContent = tag;

    if (state.selectedTags.has(tag)) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", () => {
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
        btn.classList.remove("active");
      } else {
        state.selectedTags.add(tag);
        btn.classList.add("active");
      }

      writeJsonStorage(STORAGE_KEYS.selectedTags, Array.from(state.selectedTags));
    });

    fragment.appendChild(btn);
  });

  elements.tagFilters.appendChild(fragment);
}

function pickRandomRecommendation() {
  const selectedTags = Array.from(state.selectedTags);

  let pool = [];

  if (selectedTags.length > 0) {
    pool = state.songs.filter((song) => song.tags.some((tag) => state.selectedTags.has(tag)));
  } else {
    const favoriteSongs = state.songs.filter((song) => state.favorites.has(song.id));
    if (favoriteSongs.length > 0) {
      const favoriteTagSet = new Set(favoriteSongs.flatMap((song) => song.tags));
      pool = state.songs.filter((song) => song.tags.some((tag) => favoriteTagSet.has(tag)));
    }
  }

  if (!pool.length) {
    pool = [...state.songs];
  }

  if (!pool.length) {
    return null;
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
}

function renderRecommendation(song) {
  if (!song) {
    elements.recommendResult.innerHTML = "<p>暂无可推荐歌曲，请先检查数据。</p>";
    return;
  }

  const singers = song.singer.join(" / ");
  const tags = song.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(" ");

  elements.recommendResult.innerHTML = `
    <p class="recommend-title">${escapeHtml(song.songName)}</p>
    <p class="recommend-singer">歌手：${escapeHtml(singers)}</p>
    <div class="tags-cell">${tags}</div>
  `;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 1500);
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(fallback) && !Array.isArray(parsed) ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("localStorage write failed", error);
  }
}

function readTextStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : String(raw);
  } catch (error) {
    return fallback;
  }
}

function writeTextStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    console.warn("localStorage write failed", error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
