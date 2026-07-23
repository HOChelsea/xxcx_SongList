const elements = {
  messageList: document.getElementById("messageList"),
  emptyState: document.getElementById("emptyState")
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
  const messages = await fetchMessages();
  const normalizedMessages = normalizeMessages(messages);
  const sortedMessages = sortMessages(normalizedMessages);

  renderMessages(sortedMessages);
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
