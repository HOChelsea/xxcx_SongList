const elements = {
  messageList: document.getElementById("messageList"),
  emptyState: document.getElementById("emptyState"),
  contactBubble: document.getElementById("contactBubble"),
  contactModal: document.getElementById("contactModal"),
  closeContactModalBtn: document.getElementById("closeContactModalBtn"),
  contactForm: document.getElementById("contactForm"),
  contactNameInput: document.getElementById("contactNameInput"),
  contactMessageInput: document.getElementById("contactMessageInput"),
  contactSubmitBtn: document.getElementById("contactSubmitBtn"),
  contactSuccessTip: document.getElementById("contactSuccessTip")
};

const STORAGE_KEYS = {
  contactName: "playlist__contactName"
};

const EMAILJS_CONFIG = {
  publicKey: "ZViuSZnR2gTJ0gblY",
  serviceId: "service_6nz05vp",
  templateId: "template_2fsg8kp"
};

const CONTACT_COOLDOWN_MS = 10_000;

const state = {
  contactSubmitting: false,
  contactCooldownUntil: 0,
  emailJsReady: false
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

init().catch((error) => {
  console.error(error);
  renderEmptyState("留言加载失败，请稍后再试。");
});

async function init() {
  initEmailJs();
  bindContactEvents();

  const messages = await fetchMessages();
  const normalizedMessages = normalizeMessages(messages);
  const sortedMessages = sortMessages(normalizedMessages);

  renderMessages(sortedMessages);
}

function bindContactEvents() {
  if (!elements.contactBubble || !elements.contactModal || !elements.contactForm) {
    return;
  }

  elements.contactBubble.addEventListener("click", openContactModal);

  elements.closeContactModalBtn.addEventListener("click", () => {
    elements.contactModal.close();
  });

  elements.contactModal.addEventListener("click", (event) => {
    const rect = elements.contactModal.getBoundingClientRect();
    const isOutside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (isOutside) {
      elements.contactModal.close();
    }
  });

  elements.contactModal.addEventListener("close", hideContactSuccessTip);
  elements.contactForm.addEventListener("submit", handleContactSubmit);
}

function initEmailJs() {
  if (!window.emailjs || typeof window.emailjs.init !== "function") {
    state.emailJsReady = false;
    return;
  }

  try {
    window.emailjs.init({
      publicKey: EMAILJS_CONFIG.publicKey
    });
    state.emailJsReady = true;
  } catch (error) {
    state.emailJsReady = false;
    console.warn("EmailJS init failed", error);
  }
}

function openContactModal() {
  hideContactSuccessTip();
  const savedName = readTextStorage(STORAGE_KEYS.contactName, "").trim();
  if (savedName) {
    elements.contactNameInput.value = savedName;
  }

  elements.contactModal.showModal();
  if (savedName) {
    elements.contactMessageInput.focus();
  } else {
    elements.contactNameInput.focus();
  }
}

async function handleContactSubmit(event) {
  event.preventDefault();

  if (state.contactSubmitting) {
    return;
  }

  const now = Date.now();
  if (state.contactCooldownUntil > now) {
    const seconds = Math.ceil((state.contactCooldownUntil - now) / 1000);
    showToast(`提交太频繁，请 ${seconds} 秒后再试`);
    return;
  }

  const name = String(elements.contactNameInput.value || "").trim();
  const message = String(elements.contactMessageInput.value || "").trim();
  const submitterName = name || "匿名观众";

  if (!message) {
    showToast("请先输入想说的话");
    elements.contactMessageInput.focus();
    return;
  }

  if (!state.emailJsReady || !window.emailjs || typeof window.emailjs.send !== "function") {
    showToast("邮件服务尚未配置");
    return;
  }

  state.contactSubmitting = true;
  elements.contactSubmitBtn.disabled = true;
  elements.contactSubmitBtn.textContent = "提交中...";

  try {
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      name: submitterName,
      message,
      page_url: window.location.href,
      submitted_at: new Date().toISOString()
    });

    if (name) {
      writeTextStorage(STORAGE_KEYS.contactName, name);
    }
    elements.contactNameInput.value = name;
    elements.contactMessageInput.value = "";
    state.contactCooldownUntil = Date.now() + CONTACT_COOLDOWN_MS;
    showContactSuccessTip();
  } catch (error) {
    console.error("Email send failed", error);
    showToast("提交失败，请稍后再试");
  } finally {
    state.contactSubmitting = false;
    elements.contactSubmitBtn.disabled = false;
    elements.contactSubmitBtn.textContent = "提交留言";
  }
}

function showContactSuccessTip() {
  const tip = elements.contactSuccessTip;
  if (!tip) {
    return;
  }

  tip.hidden = false;
  tip.classList.add("show");
  window.clearTimeout(showContactSuccessTip.timer);
  showContactSuccessTip.timer = window.setTimeout(() => {
    tip.classList.remove("show");
    window.setTimeout(() => {
      tip.hidden = true;
    }, 220);
  }, 2200);
}

function hideContactSuccessTip() {
  const tip = elements.contactSuccessTip;
  if (!tip) {
    return;
  }

  window.clearTimeout(showContactSuccessTip.timer);
  tip.classList.remove("show");
  tip.hidden = true;
}

async function fetchMessages() {
  const response = await fetch("message.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load message.json");
  }

  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

function normalizeMessages(records) {
  return records
    .map((record, index) => {
      const submission = record && typeof record === "object" ? record.submission : null;
      if (!submission || typeof submission !== "object") {
        return null;
      }

      const name = String(submission.name || "").trim();
      const message = String(submission.message || "").trim();
      const submittedAt = String(submission.submitted_at || "").trim();
      const timestamp = Date.parse(submittedAt);

      if (!name || !message) {
        return null;
      }

      return {
        id: typeof submission.id === "number" ? submission.id : index,
        name,
        message,
        submittedAt,
        timestamp: Number.isNaN(timestamp) ? null : timestamp,
        originalIndex: index
      };
    })
    .filter(Boolean);
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const aTime = a.timestamp;
    const bTime = b.timestamp;

    if (aTime === null && bTime === null) {
      return a.originalIndex - b.originalIndex;
    }

    if (aTime === null) {
      return 1;
    }

    if (bTime === null) {
      return -1;
    }

    if (aTime !== bTime) {
      return bTime - aTime;
    }

    return b.originalIndex - a.originalIndex;
  });
}

function renderMessages(messages) {
  elements.messageList.innerHTML = "";

  if (!messages.length) {
    renderEmptyState("暂时还没有留言。");
    return;
  }

  elements.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();

  messages.forEach((entry) => {
    const article = document.createElement("article");
    article.className = "message-card";

    const header = document.createElement("header");
    header.className = "message-card-header";

    const name = document.createElement("p");
    name.className = "message-name";
    name.textContent = entry.name;

    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = entry.submittedAt;
    time.textContent = formatTimestamp(entry.timestamp);

    const body = document.createElement("p");
    body.className = "message-body";
    body.textContent = entry.message;

    header.appendChild(name);
    header.appendChild(time);
    article.appendChild(header);
    article.appendChild(body);
    fragment.appendChild(article);
  });

  elements.messageList.appendChild(fragment);
}

function formatTimestamp(timestamp) {
  if (timestamp === null) {
    return "时间未填写";
  }

  return dateTimeFormatter.format(new Date(timestamp));
}

function renderEmptyState(message) {
  elements.messageList.innerHTML = "";
  elements.emptyState.textContent = message;
  elements.emptyState.hidden = false;
}

function readTextStorage(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : String(value);
  } catch {
    return fallback;
  }
}

function writeTextStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore localStorage write failures.
  }
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.textContent = String(message || "");
  toast.classList.add("show");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}
