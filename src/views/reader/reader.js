// 全局状态
let currentContent = "";
let currentMode = "render"; // 'render' or 'source'
let refreshEventListener = null;

// 导入格式化工具
import { html2text } from "../../utils/formatter.js";
// 导入 Tauri v2 API
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
// 导入国际化工具（t / 语言加载 / 静态文案应用）
import { t, loadLocaleFromSettings, applyI18n } from "../../utils/i18n.js";

// Toast 提示函数
function showToast(message, type = "info") {
  // 检查是否已存在 toast 元素
  let toast = document.getElementById("toast");
  if (!toast) {
    // 创建 toast 元素
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }

  // 设置 toast 内容和类型
  toast.textContent = message;
  toast.className = `toast ${type}`;

  // 显示 toast
  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  // 3秒后隐藏 toast
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// 从URL参数获取内容
function getUrlParams() {
  const params = {};
  const searchParams = new URLSearchParams(window.location.search);
  searchParams.forEach((value, key) => {
    params[key] = decodeURIComponent(value);
  });
  return params;
}

// 最近一次渲染进 iframe 的内容：主题切换时需要用新主题色重建 srcdoc
let lastRenderedHtml = "";
// 上次渲染是否使用用户选择的字体（Markdown 预览），主题切换重建时需沿用同一选项
let lastFrameUsesUserFont = false;

// 渲染视图的兜底字体栈（HTML 内容自带字体样式，仅在缺省时生效）
const FRAME_FALLBACK_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// 生成 iframe 的 srcdoc。
// iframe 自身的背景取自父窗口的 --bg-surface，所以内部的文字、链接、代码块
// 颜色必须按当前主题取值，否则深色主题下会出现「深字压深底」和白色代码块。
// useUserFont：正文跟随用户在设置里选择的界面字体（Markdown 转换出的 HTML
// 不带字体样式，需要用用户字体兜底）。
function buildFrameHtml(content, useUserFont = false) {
  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) =>
    styles.getPropertyValue(name).trim() || fallback;
  const bodyFont = useUserFont
    ? read("--font-family", FRAME_FALLBACK_FONT)
    : FRAME_FALLBACK_FONT;
  // 代码块/行内代码默认用等宽字体，跟随用户字体时需一并覆盖
  const codeFontRule = useUserFont
    ? "code, kbd, pre, samp { font-family: inherit; }"
    : "";
  return `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            html, body { height: 100%; margin: 0; padding: 0; }
            body {
              font-family: ${bodyFont};
              padding: 16px;
              word-break: break-word;
              color: ${read("--text-primary", "#1e293b")};
              line-height: 1.5;
              overflow-y: auto !important;
              scrollbar-width: thin !important;
              scrollbar-color: transparent transparent !important;
            }
            body::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            body::-webkit-scrollbar-track { background: transparent !important; }
            body::-webkit-scrollbar-thumb { background-color: transparent !important; border-radius: 3px !important; }
            body:hover { scrollbar-color: rgba(148, 163, 184, 0.5) transparent !important; }
            body:hover::-webkit-scrollbar-thumb { background-color: rgba(148, 163, 184, 0.5) !important; }
            body:hover::-webkit-scrollbar-thumb:hover { background-color: rgba(148, 163, 184, 0.8) !important; }
            a { color: ${read("--primary-color", "#2563eb")}; }
            img { max-width: 100%; height: auto; }
            pre { background: ${read("--bg-hover", "#eef1f6")}; padding: 10px; border-radius: 4px; overflow-x: auto; }
            ${codeFontRule}
          </style>
        </head>
        <body>${content}</body>
        </html>
      `;
}

// 主题切换（含 system 模式跟随系统变化）后按新主题色重建 iframe 内容
function watchThemeChange() {
  new MutationObserver(() => {
    const htmlFrame = document.getElementById("html-frame");
    if (!htmlFrame || !lastRenderedHtml) return;
    htmlFrame.srcdoc = buildFrameHtml(lastRenderedHtml, lastFrameUsesUserFont);
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

// 切换视图模式
function switchMode(mode) {
  currentMode = mode;
  const container = document.getElementById("content-container");
  const btns = document.querySelectorAll(".toggle-btn");

  // 更新按钮状态
  btns.forEach((btn) => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  // 视图显隐交给 CSS：容器上的 mode-* 类决定显示哪一个
  container.classList.remove("mode-render", "mode-text", "mode-source");
  container.classList.add(`mode-${mode}`);

  // 不同视图统计的文字范围不同，切换后重新统计总字数
  refreshTotalCharCount();
}

// ========== 字数统计 ==========

// 当前视图的总字数；null 表示当前视图无文字可统计（如图片）
let totalCharCount = null;

// 读取当前视图的文字内容（无文字可统计时返回 null）
function getActiveViewText() {
  const htmlFrame = document.getElementById("html-frame");
  const sourceView = document.getElementById("source-view");
  const textFallback = document.getElementById("text-fallback");
  const imageView = document.getElementById("image-view");

  // 图片视图没有文字
  if (imageView && imageView.style.display !== "none") return null;

  // 渲染模式：以 iframe 内实际渲染的文字为准
  if (currentMode === "render" && htmlFrame) {
    try {
      const rendered = htmlFrame.contentDocument?.body?.innerText;
      if (rendered) return rendered;
    } catch (e) {
      // 跨域等异常时退回纯文本视图
    }
    // iframe 尚未加载完成时退回纯文本视图，避免总字数先显示为 0
  }

  if (currentMode === "source" && sourceView) {
    return sourceView.textContent || "";
  }

  return textFallback?.querySelector(".text-content")?.textContent || "";
}

// 读取当前选中的文字（仅统计内容区内的选区，避免把顶栏、底栏文字算进来）
function getSelectedContentText() {
  const htmlFrame = document.getElementById("html-frame");

  // 渲染模式的选区在 iframe 内
  if (currentMode === "render" && htmlFrame) {
    try {
      const sel = htmlFrame.contentWindow?.getSelection();
      return sel ? sel.toString() : "";
    } catch (e) {
      return "";
    }
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";

  const container = document.getElementById("content-container");
  const anchor = sel.anchorNode;
  const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentNode);
  if (!container || !anchorEl || !container.contains(anchorEl)) return "";
  return sel.toString();
}

// 刷新顶栏字数显示：未选中显示总字数，选中则显示选中字数
function updateCharCount() {
  const divider = document.getElementById("meta-divider");
  const countEl = document.getElementById("meta-count");
  if (!countEl) return;

  if (totalCharCount === null) {
    divider.hidden = true;
    countEl.hidden = true;
    countEl.textContent = "";
    return;
  }

  const selectedText = getSelectedContentText();
  countEl.textContent = selectedText
    ? t("reader.charCount.selected").replace("{n}", selectedText.length)
    : t("reader.charCount.total").replace("{n}", totalCharCount);
  divider.hidden = false;
  countEl.hidden = false;
}

// 重新计算并缓存当前视图的总字数（内容或视图变化时调用）
function refreshTotalCharCount() {
  const text = getActiveViewText();
  totalCharCount = text === null ? null : text.length;
  updateCharCount();
}

// 监听选区变化（含 iframe 内的选区），实时切换显示总字数/选中字数
function bindCharCountListeners() {
  document.addEventListener("selectionchange", updateCharCount);

  const htmlFrame = document.getElementById("html-frame");
  if (htmlFrame) {
    // iframe 每次写入 srcdoc 都会重建文档，需在每次加载后重新绑定
    htmlFrame.addEventListener("load", () => {
      try {
        htmlFrame.contentDocument?.addEventListener(
          "selectionchange",
          updateCharCount
        );
      } catch (e) {
        // 忽略跨域等异常
      }
      refreshTotalCharCount();
    });
  }
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes) return t("reader.unknown");
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

// 初始化页面
async function init() {
  // 初始化主题
  try {
    const { initTheme } = await import("../../services/theme-service.js");
    await initTheme();
    console.log("主题初始化完成");
  } catch (e) {
    console.warn("初始化主题失败:", e);
  }

  const params = getUrlParams();
  console.log("初始化参数:", params);

  const cacheKey = params.cacheKey;
  // 主窗口写入 localStorage 的是未编码的原始内容（完整内容按需懒加载后直接写入）
  const realContent = localStorage.getItem(cacheKey) || params.content;

  if (realContent) {
    // 内容已是原始文本，无需再做 URI 解码
    const decodedContent = realContent;

    // 保存内容到全局以便复制
    currentContent = decodedContent;

    // 初始化收藏按钮状态
    const isFavorite = params.isFavorite === "true";
    updateFavoriteButton(isFavorite);

    // 1. 更新元数据
    document.getElementById("meta-type").textContent = (
      params.format || "TEXT"
    ).toUpperCase();
    // 如果有 timestamp，转换一下
    if (params.timestamp) {
      const date = new Date(parseInt(params.timestamp) || params.timestamp);
      document.getElementById("meta-time").textContent = date.toLocaleString();
    }

    // 2. 准备 DOM 元素
    const htmlFrame = document.getElementById("html-frame");
    const textFallback = document.getElementById("text-fallback");
    const sourceView = document.getElementById("source-view");
    const viewToggle = document.getElementById("view-toggle");

    // 3. 根据格式渲染
    console.log("[Reader] 格式类型:", params.format, "内容长度:", decodedContent.length);

    // --- 图片处理逻辑 ---
    if (params.format === "image") {
      // 图片视图由下方动态创建；三个文本类视图保持 CSS 默认的隐藏状态
      viewToggle.classList.add("is-hidden");

      // 相对路径 (content 存储的是相对路径)
      const relativePath = decodedContent;

      // 更新类型显示（显示具体格式）
      const imageFormat = params.imageFormat || "png";
      document.getElementById("meta-type").textContent = imageFormat.toUpperCase();

      // 异步加载图片
      try {
        const base64 = await invoke('read_image_as_base64', { relativePath });

        // 查找或创建图片容器
        const contentContainer = document.getElementById("content-container");
        let imageView = document.getElementById("image-view");

        if (!imageView) {
          // 创建图片视图
          imageView = document.createElement("div");
          imageView.id = "image-view";
          imageView.className = "image-view";
          contentContainer.appendChild(imageView);
        }

        imageView.innerHTML = `
          <div class="image-wrapper">
            <img src="data:image/png;base64,${base64}" alt="${t("reader.image.alt")}" class="full-image" />
          </div>
          <div class="image-info">
            <span>${t("reader.image.dimensions").replace("{w}", params.imageWidth || '-').replace("{h}", params.imageHeight || '-')}</span>
            <span>${t("reader.image.size").replace("{s}", params.imageSize ? formatSize(params.imageSize) : t("reader.unknown"))}</span>
          </div>
        `;
        imageView.style.display = "flex";
      } catch (e) {
        console.error("[Reader] 加载图片失败:", e);
        // 显示错误信息
        const textContent = textFallback.querySelector(".text-content");
        if (textContent) {
          textContent.textContent = t("reader.image.loadFailed").replace("{error}", e);
        }
        switchMode("text");
      }
    } else if (params.format === "html" || params.format === "markdown") {
      // --- HTML/Markdown 处理逻辑 ---

      // 隐藏图片视图
      const imageView = document.getElementById("image-view");
      if (imageView) imageView.style.display = "none";

      // A. 显示切换开关
      viewToggle.classList.remove("is-hidden");

      // 对于 markdown，需要转换为 HTML 再渲染
      let contentToRender = decodedContent;
      if (params.format === "markdown") {
        console.log("[Reader] 检测到 Markdown 格式，准备转换...");
        console.log("[Reader] 解码后内容预览:", decodedContent.substring(0, 200));
        try {
          contentToRender = await invoke("markdown_to_html_command", { markdown: decodedContent });
          console.log("[Reader] Markdown 转换结果预览:", contentToRender.substring(0, 200));
        } catch (e) {
          console.error("[Reader] markdown_to_html_command 失败:", e);
        }
      }

      // B. 填充渲染视图 (iframe)
      // Markdown 转换出的 HTML 不带字体样式，正文跟随用户选择的字体
      lastRenderedHtml = contentToRender;
      lastFrameUsesUserFont = params.format === "markdown";
      htmlFrame.srcdoc = buildFrameHtml(contentToRender, lastFrameUsesUserFont);

      // C. 填充纯文本视图
      // markdown 直接显示原始文本，html 需要转换为纯文本
      if (params.format === "markdown") {
        const textContent = textFallback.querySelector(".text-content");
        textContent.textContent = decodedContent;
      } else {
        // HTML 需要转换为纯文本 - 统一使用前端 formatter
        const textContent = textFallback.querySelector(".text-content");
        textContent.textContent = html2text(decodedContent);
      }

      // D. 填充源码视图 (Text)
      const sourceContent = sourceView.querySelector(".text-content");
      sourceContent.textContent = decodedContent;

      // E. 默认进入渲染模式
      switchMode("render");
    } else {
      // --- 纯文本/其他 处理逻辑 ---

      // 纯文本没有可切换的视图
      viewToggle.classList.add("is-hidden");

      // 隐藏图片视图
      const imageView = document.getElementById("image-view");
      if (imageView) imageView.style.display = "none";

      // 显示文本 Fallback
      const textContent = textFallback.querySelector(".text-content");
      textContent.textContent = decodedContent;
      switchMode("text");
    }
  } else {
    const textFallback = document.getElementById("text-fallback");
    const textContent = textFallback.querySelector(".text-content");
    textContent.textContent = t("reader.contentUnavailable");
    switchMode("text");
  }

  // 内容渲染完成后刷新字数统计（图片等无文字内容会自动隐藏）
  refreshTotalCharCount();
}

// 保存文本内容（当用户编辑纯文本模式下的内容时调用）
function saveTextContent(element) {
  const editedText = element.textContent.trim();
  if (editedText !== currentContent) {
    currentContent = editedText;
    // 显示保存成功提示
    const btn = document.querySelector(".edit-btn");
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = t("reader.saved");
      setTimeout(() => (btn.innerHTML = originalText), 2000);
    }
  }

  // 编辑后文字内容变了，重新统计字数
  refreshTotalCharCount();
}

// 编辑内容
function editContent() {
  // 简单的编辑功能，打开一个prompt让用户编辑内容
  const editedContent = prompt(t("reader.editPrompt"), currentContent);
  if (editedContent !== null && editedContent !== currentContent) {
    currentContent = editedContent;
    // 更新显示
    init();
    // 显示编辑成功提示
    const btn = document.querySelector(".edit-btn");
    const originalText = btn.innerHTML;
    btn.innerHTML = t("reader.saved");
    setTimeout(() => (btn.innerHTML = originalText), 2000);
  }
}

// 复制内容
async function copyContent() {
  if (!currentContent) return;
  try {
    await navigator.clipboard.writeText(currentContent);
    // 简单的视觉反馈
    const btn = document.querySelector(".copy-btn");
    const originalText = btn.innerHTML;
    btn.innerHTML = t("reader.copied");
    setTimeout(() => (btn.innerHTML = originalText), 2000);
  } catch (err) {
    alert(t("reader.copyFailed").replace("{error}", err));
  }
}

// 当前条目是否已收藏
let isCurrentFavorite = false;

// 更新收藏按钮状态
function updateFavoriteButton(isFavorite) {
  isCurrentFavorite = isFavorite;
  const btn = document.querySelector(".favorite-btn");
  if (btn) {
    btn.classList.toggle("active", isFavorite);
    const icon = btn.querySelector(".icon");
    if (icon) {
      icon.className = isFavorite ? "icon icon-favorite-solid" : "icon icon-favorite";
    }
    const text = btn.querySelector(".btn-text");
    if (text) {
      text.textContent = isFavorite ? t("reader.favorite.remove") : t("reader.favorite.add");
    }
  }
}

// 添加到收藏
async function addToFavorites() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    showToast(t("reader.toast.noItemId"), "error");
    return;
  }

  try {
    const newState = await invoke("toggle_favorite", { id });
    updateFavoriteButton(newState);
    showToast(newState ? t("toast.addedToFavorites") : t("toast.removedFromFavorites"), "success");

    // 保存数据到文件
    try {
      await invoke("save_clipboard_history");
    } catch (saveError) {
      console.error("保存数据失败:", saveError);
    }
  } catch (error) {
    console.error("切换收藏状态失败:", error);
    showToast(t("reader.toast.operationFailed"), "error");
  }
}

// 关闭窗口
async function closeWindow() {
  try {
    const appWindow = getCurrentWebviewWindow();
    await appWindow.close();
  } catch (error) {
    // 忽略错误，因为在沙箱环境中可能会受限
  }
}

// 初始化窗口拖动功能
async function initDragWindow() {
  console.log("初始化窗口拖动功能");
  try {
    const appWindow = getCurrentWebviewWindow();
    console.log("获取到窗口实例:", appWindow);

    // 尝试选择不同的元素
    const header = document.querySelector(".header");
    console.log("获取到header元素:", header);

    if (header) {
      console.log("添加鼠标按下事件监听器");
      header.addEventListener("mousedown", (e) => {
        console.log("鼠标按下事件:", e.target);
        // 只有在标题栏区域点击才开始拖动，排除按钮区域
        if (
          !e.target.closest(".header-actions") &&
          !e.target.closest(".view-toggle")
        ) {
          console.log("开始拖动");
          // 尝试使用 Tauri 提供的 startDragging 方法
          if (appWindow.startDragging) {
            console.log("使用 startDragging 方法");
            appWindow.startDragging().catch((error) => {
              console.error("startDragging 失败:", error);
              // 如果 startDragging 失败，尝试手动拖动
              manualDrag(appWindow, e);
            });
          } else {
            console.log("使用手动拖动方法");
            // 如果没有 startDragging 方法，使用手动拖动
            manualDrag(appWindow, e);
          }
        }
      });
    }
  } catch (error) {
    console.error("初始化窗口拖动功能失败:", error);
  }
}

// 手动拖动窗口
function manualDrag(appWindow, e) {
  let isDragging = true;
  let startX = e.clientX;
  let startY = e.clientY;
  let initialPosition;

  // 获取初始位置
  appWindow.getPosition().then((pos) => {
    initialPosition = pos;
    console.log("初始窗口位置:", initialPosition);
  });

  // 鼠标移动事件
  const handleMouseMove = async (moveEvent) => {
    if (isDragging && initialPosition) {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      try {
        const newPosition = {
          x: initialPosition.x + deltaX,
          y: initialPosition.y + deltaY,
        };
        console.log("新窗口位置:", newPosition);
        await appWindow.setPosition(newPosition);
      } catch (error) {
        console.error("设置窗口位置失败:", error);
      }
    }
  };

  // 鼠标释放事件
  const handleMouseUp = () => {
    if (isDragging) {
      console.log("结束拖动");
      isDragging = false;
      // 移除事件监听器
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }
  };

  // 添加事件监听器
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
}

// 导航到上一个剪贴板项
async function navigateToPrevious() {
  try {
    const currentId = new URLSearchParams(window.location.search).get("id");
    console.log("点击上一个按钮，当前ID:", currentId);

    // 发送导航事件到主应用
    await emit("navigate-clipboard", {
      direction: "next",
      currentId: currentId,
    });
    console.log("发送导航到上一个剪贴板项的事件");
  } catch (error) {
    console.error("导航失败:", error);
    showToast(t("reader.toast.navigateFailed"), "error");
  }
}

// 导航到下一个剪贴板项
async function navigateToNext() {
  try {
    const currentId = new URLSearchParams(window.location.search).get("id");
    console.log("点击下一个按钮，当前ID:", currentId);

    // 发送导航事件到主应用
    await emit("navigate-clipboard", {
      direction: "previous",
      currentId: currentId,
    });
    console.log("发送导航到下一个剪贴板项的事件");
  } catch (error) {
    console.error("导航失败:", error);
    showToast(t("reader.toast.navigateFailed"), "error");
  }
}

// 初始化事件监听器
async function initEventListeners() {
  console.log("初始化事件监听器");

  // 移除旧的事件监听器
  if (refreshEventListener) {
    try {
      refreshEventListener();
      console.log("移除了旧的事件监听器");
    } catch (error) {
      console.error("移除旧事件监听器失败:", error);
    }
  }

  // 监听主应用发送的刷新事件，使用固定的事件名称
  try {
    refreshEventListener = await listen("refresh-reader", (event) => {
      console.log("收到刷新事件:", event);
      if (event && event.payload) {
        const { error, id, cacheKey, format, timestamp, imageWidth, imageHeight, imageSize, imageFormat, isFavorite } = event.payload;
        if (error) {
          // 显示错误提示
          showToast(error, "error");
        } else {
          // 刷新页面内容
          refreshContent(id, cacheKey, format, timestamp, imageWidth, imageHeight, imageSize, imageFormat, isFavorite);
        }
      }
    });
    console.log("注册了刷新事件监听器");
  } catch (error) {
    console.error("注册事件监听器失败:", error);
  }
}

// 刷新页面内容
function refreshContent(id, cacheKey, format, timestamp, imageWidth, imageHeight, imageSize, imageFormat, isFavorite) {
  console.log("刷新页面内容:", { id, cacheKey, format, timestamp, imageWidth, imageHeight, imageSize, imageFormat, isFavorite });

  // 更新URL参数
  const params = new URLSearchParams(window.location.search);
  params.set("id", id);
  params.set("cacheKey", cacheKey);
  params.set("format", format);
  params.set("timestamp", timestamp);
  // 添加图片元数据
  if (imageWidth) params.set("imageWidth", imageWidth);
  if (imageHeight) params.set("imageHeight", imageHeight);
  if (imageSize) params.set("imageSize", imageSize);
  if (imageFormat) params.set("imageFormat", imageFormat);
  // 添加收藏状态
  params.set("isFavorite", isFavorite || false);
  window.history.replaceState({}, document.title, `?${params.toString()}`);

  // 重新初始化页面
  init();

  // 重新初始化事件监听器，使用新的ID
  initEventListeners();
}

/**
 * 独立实现的窗口尺寸监听器 (兜底方案)
 */
async function setupWindowResizeHandler() {
  try {
    const appWindow = getCurrentWebviewWindow();
    const label = appWindow.label;

    // 1. 获取屏幕缩放因子 (关键步骤)
    // 如果 API 不支持 scaleFactor，默认为 1
    let scaleFactor = 1;
    try {
      scaleFactor = await appWindow.scaleFactor();
      console.log(`当前屏幕缩放因子: ${scaleFactor}`);
    } catch (e) {
      console.warn("无法获取缩放因子，默认为 1", e);
    }

    // 逻辑 Key
    const storageKey =
      label === "reader" || label.startsWith("reader-")
        ? "window-size-reader-settings"
        : `window-size-${label}`;

    // 保存函数 (保存逻辑像素)
    let saveTimeout;
    const saveSize = (logicalWidth, logicalHeight) => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        // 取整，避免小数
        const w = Math.round(logicalWidth);
        const h = Math.round(logicalHeight);

        const sizeObj = { width: w, height: h };
        localStorage.setItem(storageKey, JSON.stringify(sizeObj));
        // console.log(`尺寸已保存 (逻辑像素): ${w}x${h}`);
      }, 500);
    };

    // 2. 监听 Resize
    await appWindow.onResized((event) => {
      const size = event.payload || event;

      // 优先寻找 payload 中的逻辑像素 (Tauri v2 部分事件直接提供)
      if (size.logical) {
        saveSize(size.logical.width, size.logical.height);
        return;
      }

      // 否则使用物理像素进行换算
      let physW, physH;
      if (size.physical) {
        physW = size.physical.width;
        physH = size.physical.height;
      } else {
        // 假设直接是物理像素 (Tauri v1 常见情况)
        physW = size.width;
        physH = size.height;
      }

      if (physW && physH) {
        // 核心修复：物理像素 / 缩放因子 = 逻辑像素
        saveSize(physW / scaleFactor, physH / scaleFactor);
      }
    });

    // 3. 初始加载保存一次
    // innerSize 返回的是物理像素，需要转换
    const initialSize = await appWindow.innerSize();
    saveSize(initialSize.width / scaleFactor, initialSize.height / scaleFactor);
  } catch (e) {
    console.error("设置窗口监听失败:", e);
  }
}

// 初始化页面
async function initialize() {
  console.log("🚀 Reader 窗口开始初始化...");

  try {
    // 先加载语言设置并应用静态文案，确保用户看到的第一帧即为目标语言
    loadLocaleFromSettings();
    applyI18n();

    // 1. 绑定界面按钮事件
    bindInterfaceEvents();

    // 2. 初始化内容渲染
    init();

    // 3. 主题切换后按新主题色重建 iframe
    watchThemeChange();

    // 4. 绑定字数统计的选区监听（含 iframe 内选区）
    bindCharCountListeners();

    // 5. 初始化事件监听 (刷新等)
    await initEventListeners();

    // 6. 初始化拖拽 (自定义标题栏)
    await initDragWindow();

    // 7. 初始化窗口尺寸监听 (关键)
    console.log("调用 setupWindowResizeHandler...");
    await setupWindowResizeHandler();
    console.log("✅ setupWindowResizeHandler 调用完成");
  } catch (error) {
    console.error("❌ 初始化过程中发生错误:", error);
  }
}

// 监听 ESC 键关闭窗口
window.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeWindow();
  }
});

// 绑定界面按钮（原先写在 HTML 的 on* 属性里）
function bindInterfaceEvents() {
  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchMode(btn.dataset.mode));
  });

  document
    .querySelector(".window-close-btn")
    ?.addEventListener("click", closeWindow);
  document
    .querySelector(".nav-btn.prev-btn")
    ?.addEventListener("click", navigateToPrevious);
  document
    .querySelector(".nav-btn.next-btn")
    ?.addEventListener("click", navigateToNext);
  document
    .querySelector(".favorite-btn")
    ?.addEventListener("click", addToFavorites);

  // 纯文本视图编辑后保存内容
  document
    .querySelector("#text-fallback .text-content")
    ?.addEventListener("blur", (event) => saveTextContent(event.currentTarget));
}

// 确保页面加载完成后执行
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
