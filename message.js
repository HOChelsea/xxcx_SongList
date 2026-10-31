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
  templateId: "template_2fsg8kp",         // 主留言模板
  commentTemplateId: "template_5cifoa7"  // ← 换成你新建的评论模板 id
};

const CONTACT_COOLDOWN_MS = 10_000;

const state = {
  contactSubmitting: false,
  contactCooldownUntil: 0,
  commentSubmitting: false,
  commentCooldownUntil: 0,
  emailJsReady: false
};

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit"
});

init().catch((error) => {
  console.error(error);
  renderEmptyState("留言加载失败，请稍后再试。");
});

async function init() {
  initEmailJs();
  bindContactEvents();

  const messages = await fetchMessages();
  const normalized = normalizeMessages(messages);
  sortSubmissions(normalized);

  renderMessages(normalized);
}

/* ============================================================
 * 主留言弹窗
 * ============================================================ */

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
    if (isOutside) elements.contactModal.close();
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
    window.emailjs.init({ publicKey: EMAILJS_CONFIG.publicKey });
    state.emailJsReady = true;
  } catch (error) {
    state.emailJsReady = false;
    console.warn("EmailJS init failed", error);
  }
}

function openContactModal() {
  hideContactSuccessTip();
  const savedName = readTextStorage(STORAGE_KEYS.contactName, "").trim();
  if (savedName) elements.contactNameInput.value = savedName;

  elements.contactModal.showModal();
  if (savedName) elements.contactMessageInput.focus();
  else elements.contactNameInput.focus();
}

async function handleContactSubmit(event) {
  event.preventDefault();
  if (state.contactSubmitting) return;

  const now = Date.now();
  if (state.contactCooldownUntil > now) {
    const seconds = Math.ceil((state.contactCooldownUntil - now) / 1000);
    showToast(`提交太频繁，请 ${seconds} 秒后再试`);
    return;
  }

  const name = String(elements.contactNameInput.value || "").trim();
  const message = String(elements.contactMessageInput.value || "").trim();
  const submitterName = name || "匿名用戶";

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

    if (name) writeTextStorage(STORAGE_KEYS.contactName, name);
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
  if (!tip) return;
  tip.hidden = false;
  tip.classList.add("show");
  window.clearTimeout(showContactSuccessTip.timer);
  showContactSuccessTip.timer = window.setTimeout(() => {
    tip.classList.remove("show");
    window.setTimeout(() => { tip.hidden = true; }, 220);
  }, 2200);
}

function hideContactSuccessTip() {
  const tip = elements.contactSuccessTip;
  if (!tip) return;
  window.clearTimeout(showContactSuccessTip.timer);
  tip.classList.remove("show");
  tip.hidden = true;
}

/* ============================================================
 * 数据获取 & 解析
 * ============================================================ */

async function fetchMessages() {
  const response = await fetch("message.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load message.json");
  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

function parseId(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function normalizeMessages(records) {
  return records
    .map((record, index) => {
      const submission = record && typeof record === "object" ? record.submission : null;
      if (!submission || typeof submission !== "object") return null;

      const id = parseId(submission.id);
      const name = String(submission.name || "").trim();
      const message = String(submission.message || "").trim();
      const submittedAt = String(submission.submitted_at || "").trim();
      const timestamp = Date.parse(submittedAt);

      if (!name || !message) return null;

      const rawComments = Array.isArray(submission.comment) ? submission.comment : [];
      const comments = rawComments
        .map((c, ci) => {
          if (!c || typeof c !== "object") return null;
          const cName = String(c.name || "").trim();
          const cMessage = String(c.message || "").trim();
          const cAt = String(c.submitted_at || "").trim();
          const cTs = Date.parse(cAt);
          if (!cName || !cMessage) return null;
          return {
            id: parseId(c.id),
            name: cName,
            message: cMessage,
            submittedAt: cAt,
            timestamp: Number.isNaN(cTs) ? null : cTs,
            originalIndex: ci
          };
        })
        .filter(Boolean);

      return {
        id, name, message, submittedAt,
        timestamp: Number.isNaN(timestamp) ? null : timestamp,
        originalIndex: index,
        comments
      };
    })
    .filter(Boolean);
}

function compareByTime(a, b, direction) {
  if (a.timestamp === null && b.timestamp === null) return a.originalIndex - b.originalIndex;
  if (a.timestamp === null) return 1;
  if (b.timestamp === null) return -1;
  if (a.timestamp !== b.timestamp) {
    return direction === "desc" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
  }
  return a.originalIndex - b.originalIndex;
}

function sortSubmissions(list) {
  list.sort((a, b) => compareByTime(a, b, "desc"));       // 主楼：新 → 旧
  list.forEach((item) => {
    item.comments.sort((a, b) => compareByTime(a, b, "asc")); // 楼中楼：旧 → 新
  });
}

/* ============================================================
 * 渲染
 * ============================================================ */

function renderMessages(list) {
  elements.messageList.innerHTML = "";
  if (!list.length) {
    renderEmptyState("暂时还没有留言。");
    return;
  }
  elements.emptyState.hidden = true;

  const fragment = document.createDocumentFragment();
  list.forEach((submission) => fragment.appendChild(createSubmissionCard(submission)));
  elements.messageList.appendChild(fragment);
}

function createSubmissionCard(submission) {
  const article = document.createElement("article");
  article.className = "message-card";
  if (submission.id !== null) article.id = `message-${submission.id}`;

  // header
  const header = document.createElement("header");
  header.className = "message-card-header";

  const name = document.createElement("p");
  name.className = "message-name";
  name.textContent = submission.name;

  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = submission.submittedAt;
  time.textContent = formatTimestamp(submission.timestamp);

  header.appendChild(name);
  header.appendChild(time);

  // body
  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = submission.message;

  article.appendChild(header);
  article.appendChild(body);

  // 右下角「评论」按钮
  if (submission.id !== null) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const commentBtn = document.createElement("button");
    commentBtn.type = "button";
    commentBtn.className = "message-comment-btn";
    commentBtn.textContent = "评论";

    actions.appendChild(commentBtn);
    article.appendChild(actions);

    // 内联评论表单（默认收起）
    const inlineForm = createInlineCommentForm(submission);
    article.appendChild(inlineForm);

    commentBtn.addEventListener("click", () => {
      const willOpen = inlineForm.hidden;

      // 同时只允许一个表单展开
      document.querySelectorAll(".inline-comment-form").forEach((f) => {
        if (f !== inlineForm) f.hidden = true;
      });

      inlineForm.hidden = !willOpen;
      if (willOpen) {
        inlineForm.querySelector(".inline-comment-textarea")?.focus();
      }
    });
  }

  // 已有评论
  if (submission.comments.length) {
    const wrap = document.createElement("div");
    wrap.className = "message-children";
    submission.comments.forEach((c) => wrap.appendChild(createCommentCard(c)));
    article.appendChild(wrap);
  }

  return article;
}

function createCommentCard(comment) {
  const article = document.createElement("article");
  article.className = "message-card message-card--reply";
  if (comment.id !== null) article.id = `comment-${comment.id}`;

  const header = document.createElement("header");
  header.className = "message-card-header";

  const name = document.createElement("p");
  name.className = "message-name";
  name.textContent = comment.name;

  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = comment.submittedAt;
  time.textContent = formatTimestamp(comment.timestamp);

  header.appendChild(name);
  header.appendChild(time);

  const body = document.createElement("p");
  body.className = "message-body";
  body.textContent = comment.message;

  article.appendChild(header);
  article.appendChild(body);
  return article;
}

/* ============================================================
 * 内联评论表单
 * ============================================================ */

function createInlineCommentForm(submission) {
  const form = document.createElement("form");
  form.className = "inline-comment-form";
  form.hidden = true;
  form.noValidate = true;

  const savedName = readTextStorage(STORAGE_KEYS.contactName, "").trim();

  // 名字
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "inline-comment-input";
  nameInput.placeholder = "怎么称呼你呀？（选填，留空显示匿名用戶）";
  nameInput.maxLength = 40;
  nameInput.autocomplete = "name";
  nameInput.value = savedName;

  // 内容
  const textarea = document.createElement("textarea");
  textarea.className = "inline-comment-textarea";
  textarea.placeholder = "写下你的评论...";
  textarea.rows = 3;
  textarea.maxLength = 1000;
  textarea.required = true;

  // 按钮
  const btnRow = document.createElement("div");
  btnRow.className = "inline-comment-actions";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "inline-comment-submit";
  submitBtn.textContent = "提交评论";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "inline-comment-cancel";
  cancelBtn.textContent = "取消";

  btnRow.appendChild(submitBtn);
  btnRow.appendChild(cancelBtn);

  // 成功提示
  const tip = document.createElement("p");
  tip.className = "inline-comment-tip";
  tip.hidden = true;
  tip.textContent = "提交成功，審核中";

  form.appendChild(nameInput);
  form.appendChild(textarea);
  form.appendChild(btnRow);
  form.appendChild(tip);

  cancelBtn.addEventListener("click", () => {
    form.hidden = true;
    textarea.value = "";
    tip.hidden = true;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleInlineCommentSubmit({ submission, form, nameInput, textarea, submitBtn, tip });
  });

  return form;
}

async function handleInlineCommentSubmit({ submission, form, nameInput, textarea, submitBtn, tip }) {
  if (state.commentSubmitting) return;

  const now = Date.now();
  if (state.commentCooldownUntil > now) {
    const seconds = Math.ceil((state.commentCooldownUntil - now) / 1000);
    showToast(`提交太频繁，请 ${seconds} 秒后再试`);
    return;
  }

  const name = String(nameInput.value || "").trim();
  const message = String(textarea.value || "").trim();
  const submitterName = name || "匿名用戶";

  if (!message) {
    showToast("请先输入评论内容");
    textarea.focus();
    return;
  }

  if (!state.emailJsReady || !window.emailjs || typeof window.emailjs.send !== "function") {
    showToast("邮件服务尚未配置");
    return;
  }

  state.commentSubmitting = true;
  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.textContent = "提交中...";

  try {
    await window.emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.commentTemplateId, {
      name: submitterName,
      message,
      parent_id: String(submission.id),
      submitted_at: new Date().toISOString(),
      page_url: window.location.href
    });

    if (name) writeTextStorage(STORAGE_KEYS.contactName, name);

    state.commentCooldownUntil = Date.now() + CONTACT_COOLDOWN_MS;
    textarea.value = "";
    tip.hidden = false;

    window.clearTimeout(form._tipTimer);
    form._tipTimer = window.setTimeout(() => {
      tip.hidden = true;
      form.hidden = true;
    }, 2200);
  } catch (error) {
    console.error("Comment send failed", error);
    showToast("提交失败，请稍后再试");
  } finally {
    state.commentSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

/* ============================================================
 * 工具
 * ============================================================ */

function formatTimestamp(timestamp) {
  if (timestamp === null) return "时间未填写";
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
  } catch { /* ignore */ }
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