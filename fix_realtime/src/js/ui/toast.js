const TOAST_TYPES = Object.freeze({
  SUCCESS: "success",
  ERROR: "error",
  WARNING: "warning",
  INFO: "info",
});

const TOAST_ICONS = Object.freeze({
  success: "✓",
  error: "×",
  warning: "!",
  info: "i",
});

const DEFAULT_DURATION = 3500;

function getToastContainer() {
  let container = document.querySelector("#toastContainer");

  if (container) {
    return container;
  }

  container = document.createElement("div");
  container.id = "toastContainer";
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "true");

  document.body.appendChild(container);

  return container;
}

export function showToast({
  type = TOAST_TYPES.INFO,
  title = "",
  message = "",
  duration = DEFAULT_DURATION,
} = {}) {
  const container = getToastContainer();

  const safeType = Object.values(TOAST_TYPES).includes(type)
    ? type
    : TOAST_TYPES.INFO;

  const toast = document.createElement("article");

  toast.className = `toast toast-${safeType}`;
  toast.setAttribute("role", safeType === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = TOAST_ICONS[safeType];

  const content = document.createElement("div");
  content.className = "toast-content";

  if (title) {
    const titleElement = document.createElement("strong");
    titleElement.className = "toast-title";
    titleElement.textContent = title;
    content.appendChild(titleElement);
  }

  if (message) {
    const messageElement = document.createElement("p");
    messageElement.className = "toast-message";
    messageElement.textContent = message;
    content.appendChild(messageElement);
  }

  const closeButton = document.createElement("button");
  closeButton.className = "toast-close-button";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "إغلاق الإشعار");
  closeButton.textContent = "×";

  const progress = document.createElement("span");
  progress.className = "toast-progress";
  progress.style.animationDuration = `${duration}ms`;

  toast.append(icon, content, closeButton, progress);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("toast-visible");
  });

  let removalTimer = window.setTimeout(() => {
    removeToast(toast);
  }, duration);

  closeButton.addEventListener("click", () => {
    window.clearTimeout(removalTimer);
    removeToast(toast);
  });

  toast.addEventListener("mouseenter", () => {
    window.clearTimeout(removalTimer);
    progress.style.animationPlayState = "paused";
  });

  toast.addEventListener("mouseleave", () => {
    progress.style.animationPlayState = "running";

    removalTimer = window.setTimeout(() => {
      removeToast(toast);
    }, 1500);
  });

  return toast;
}

function removeToast(toast) {
  if (!toast || toast.classList.contains("toast-removing")) {
    return;
  }

  toast.classList.add("toast-removing");
  toast.classList.remove("toast-visible");

  toast.addEventListener(
    "transitionend",
    () => {
      toast.remove();
    },
    {
      once: true,
    },
  );

  window.setTimeout(() => {
    toast.remove();
  }, 400);
}

export function showSuccessToast(message, title = "تم بنجاح") {
  return showToast({
    type: TOAST_TYPES.SUCCESS,
    title,
    message,
  });
}

export function showErrorToast(message, title = "حدث خطأ") {
  return showToast({
    type: TOAST_TYPES.ERROR,
    title,
    message,
    duration: 5000,
  });
}

export function showWarningToast(message, title = "تنبيه") {
  return showToast({
    type: TOAST_TYPES.WARNING,
    title,
    message,
    duration: 4500,
  });
}

export function showInfoToast(message, title = "معلومة") {
  return showToast({
    type: TOAST_TYPES.INFO,
    title,
    message,
  });
}