const STORAGE_KEYS = {
  favorites: "playlist__favorites",
  selectedTags: "playlist__selectedTags"
};

const state = {
  songs: [],
  filteredSongs: [],
  favorites: new Set(),
  selectedTags: new Set(),
  activeFilters: new Set(),
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
  songTableBody: document.getElementById("songTableBody"),
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

  renderTagFilters();
  applySearchAndRender();
}

function bindBaseEvents() {
  elements.searchInput.addEventListener("input", applySearchAndRender);
  setupAlphaDragEvents();

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
}

async function fetchSongs() {
  const response = await fetch("song.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load song.json");
  }

  const json = await response.json();
  return Array.isArray(json.songs) ? json.songs : [];
}

function normalizeSongs(songs) {
  return songs
    .filter((song) => song && typeof song.id === "number")
    .map((song) => ({
      id: song.id,
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

  state.filteredSongs = sortSongs(filtered);
  renderActiveFilters();
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
    (filterValue) => song.singer.includes(filterValue) || song.tags.includes(filterValue)
  );
}

function sortSongs(songs) {
  return [...songs].sort((a, b) => {
    const aFav = state.favorites.has(a.id) ? 1 : 0;
    const bFav = state.favorites.has(b.id) ? 1 : 0;

    if (aFav !== bFav) {
      return bFav - aFav;
    }

    const singerAKey = getMixedSortKey(a.singer[0] || "");
    const singerBKey = getMixedSortKey(b.singer[0] || "");
    const singerCompare = collatorZh.compare(singerAKey, singerBKey);
    if (singerCompare !== 0) {
      return singerCompare;
    }

    const songAKey = getMixedSortKey(a.songName);
    const songBKey = getMixedSortKey(b.songName);
    return collatorZh.compare(songAKey, songBKey);
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

  if (!state.filteredSongs.length) {
    elements.emptyState.hidden = false;
    return;
  }

  elements.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();

  state.filteredSongs.forEach((song) => {
    const tr = document.createElement("tr");
    tr.className = "song-row";
    tr.dataset.songId = String(song.id);

    const singerTd = document.createElement("td");
    singerTd.className = "singer-cell";
    song.singer.forEach((singerName) => {
      const span = document.createElement("span");
      span.className = "singer-pill";
      if (state.activeFilters.has(singerName)) {
        span.classList.add("filter-active");
      }
      span.textContent = singerName;
      span.title = `按歌手「${singerName}」筛选`;
      span.addEventListener("click", () => addFilter(singerName));
      singerTd.appendChild(span);
    });

    const songTd = document.createElement("td");
    songTd.textContent = song.songName;

    const tagsTd = document.createElement("td");
    tagsTd.className = "tags-cell";
    song.tags.forEach((tag) => {
      const tagSpan = document.createElement("span");
      tagSpan.className = "tag";
      if (state.activeFilters.has(tag)) {
        tagSpan.classList.add("filter-active");
      }
      tagSpan.textContent = tag;
      tagSpan.title = `按标签「${tag}」筛选`;
      tagSpan.addEventListener("click", () => addFilter(tag));
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
    favBtn.textContent = isFav ? "❤" : "♡";
    favBtn.setAttribute("aria-label", isFav ? "取消收藏" : "收藏歌曲");
    favBtn.addEventListener("click", () => toggleFavorite(song.id));

    favTd.appendChild(favBtn);

    tr.appendChild(singerTd);
    tr.appendChild(songTd);
    tr.appendChild(tagsTd);
    tr.appendChild(favTd);

    fragment.appendChild(tr);
  });

  elements.songTableBody.appendChild(fragment);
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

function addFilter(value) {
  if (state.activeFilters.has(value)) {
    return;
  }
  state.activeFilters.add(value);
  applySearchAndRender();
}

function removeFilter(value) {
  state.activeFilters.delete(value);
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

  state.activeFilters.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "active-filter-chip";

    const label = document.createElement("span");
    label.textContent = value;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-filter";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `移除筛选：${value}`);
    removeBtn.addEventListener("click", () => removeFilter(value));

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

function buildAlphaIndex() {
  const indexMap = new Map();

  state.filteredSongs.forEach((song) => {
    const letters = new Set(song.singer.map((name) => getSingerInitial(name)));

    letters.forEach((letter) => {
      if (!/^[A-Z]$/.test(letter)) {
        return;
      }
      if (!indexMap.has(letter)) {
        indexMap.set(letter, song.id);
      }
    });
  });

  state.alphaIndexMap = indexMap;
}

function renderAlphaNav() {
  elements.alphaNav.innerHTML = "";
  elements.alphaNav.hidden = false;

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
  const songId = state.alphaIndexMap.get(letter);
  if (!songId) {
    if (!silentIfMissing) {
      showToast(`未找到 ${letter} 开头歌手`);
    }
    return;
  }

  const row = elements.songTableBody.querySelector(`tr[data-song-id="${songId}"]`);
  if (!row) {
    return;
  }

  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("highlight");
  window.setTimeout(() => row.classList.remove("highlight"), 950);
}

function getSingerInitial(name) {
  const value = String(name || "").trim();
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
  const tags = song.tags.map((tag) => `<span class=\"tag\">${escapeHtml(tag)}</span>`).join(" ");

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
