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

// 切换视图模式
function switchMode(mode) {
  currentMode = mode;
  const htmlFrame = document.getElementById("html-frame");
  const sourceView = document.getElementById("source-view");
  const textFallback = document.getElementById("text-fallback");
  const btns = document.querySelectorAll(".toggle-btn");

  // 更新按钮状态
  btns.forEach((btn) => {
    if (btn.dataset.mode === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // 切换显示
  if (mode === "render") {
    htmlFrame.style.display = "block";
    sourceView.style.display = "none";
    textFallback.style.display = "none";
  } else if (mode === "text") {
    htmlFrame.style.display = "none";
    sourceView.style.display = "none";
    textFallback.style.display = "block";
  } else {
    htmlFrame.style.display = "none";
    sourceView.style.display = "block";
    textFallback.style.display = "none";
  }
}

// 格式化文件大小
function formatSize(bytes) {
  if (!bytes) return "未知";
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
  // 尝试从 localStorage 获取内容，如果没有则尝试从 URL 直接获取 (兜底)
  const realContent = localStorage.getItem(cacheKey) || params.content;

  if (realContent) {
    // 解码内容（先解码，后续都使用解码后的内容）
    let decodedContent = realContent;
    try {
      // 有些内容可能被多次编码，根据实际情况调整
      if (realContent.includes("%") && !realContent.includes("<html")) {
        decodedContent = decodeURIComponent(realContent);
      }
    } catch (e) {
      console.warn("解码可能失败，使用原内容", e);
    }

    // 保存解码后的内容到全局以便复制
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
      // 隐藏其他视图
      viewToggle.style.display = "none";
      htmlFrame.style.display = "none";
      sourceView.style.display = "none";
      textFallback.style.display = "none";

      // 相对路径 (content 存储的是相对路径)
      const relativePath = decodedContent;

      // 更新类型显示（显示具体格式）
      const imageFormat = params.imageFormat || "png";
      document.getElementById("meta-type").textContent = imageFormat.toUpperCase();

      // 更新大小显示
      document.getElementById("meta-size").textContent = params.imageSize
        ? formatSize(params.imageSize)
        : "未知";

      // 异步加载图片
      try {
        const base64 = await invoke('read_image_as_base64', { relativePath });

        // 查找或创建图片容器
        const contentContainer = document.getElementById("content-container");
        let imageView = document.getElementById("image-view");

        // 隐藏其他子元素
        htmlFrame.style.display = "none";
        textFallback.style.display = "none";
        sourceView.style.display = "none";

        if (!imageView) {
          // 创建图片视图
          imageView = document.createElement("div");
          imageView.id = "image-view";
          imageView.className = "image-view";
          contentContainer.appendChild(imageView);
        }

        imageView.innerHTML = `
          <div class="image-wrapper">
            <img src="data:image/png;base64,${base64}" alt="剪贴板图片" class="full-image" />
          </div>
          <div class="image-info">
            <span>尺寸: ${params.imageWidth || '-'} × ${params.imageHeight || '-'}</span>
            <span>大小: ${params.imageSize ? formatSize(params.imageSize) : '未知'}</span>
          </div>
        `;
        imageView.style.display = "flex";
        contentContainer.style.display = "block";
      } catch (e) {
        console.error("[Reader] 加载图片失败:", e);
        // 显示错误信息
        textFallback.style.display = "block";
        const textContent = textFallback.querySelector(".text-content");
        if (textContent) {
          textContent.textContent = `[图片加载失败: ${e}]`;
        }
      }
    } else if (params.format === "html" || params.format === "markdown") {
      // --- HTML/Markdown 处理逻辑 ---

      // 隐藏图片视图
      const imageView = document.getElementById("image-view");
      if (imageView) imageView.style.display = "none";

      // A. 显示切换开关
      viewToggle.style.display = "flex";

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
      const styledHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { box-sizing: border-box; }
            html, body { height: 100%; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              padding: 16px;
              word-break: break-word;
              color: #333;
              line-height: 1.5;
              overflow-y: overlay !important;
              scrollbar-width: thin !important;
              scrollbar-color: transparent transparent !important;
            }
            body::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
            body::-webkit-scrollbar-track { background: transparent !important; }
            body::-webkit-scrollbar-thumb { background-color: transparent !important; border-radius: 3px !important; }
            body:hover { scrollbar-color: rgba(148, 163, 184, 0.5) transparent !important; }
            body:hover::-webkit-scrollbar-thumb { background-color: rgba(148, 163, 184, 0.5) !important; }
            body:hover::-webkit-scrollbar-thumb:hover { background-color: rgba(148, 163, 184, 0.8) !important; }
            img { max-width: 100%; height: auto; }
            pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>${contentToRender}</body>
        </html>
      `;
      htmlFrame.srcdoc = styledHtml;

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

      // 隐藏切换开关
      viewToggle.style.display = "none";
      htmlFrame.style.display = "none";
      sourceView.style.display = "none";

      // 隐藏图片视图
      const imageView = document.getElementById("image-view");
      if (imageView) imageView.style.display = "none";

      // 显示文本 Fallback
      textFallback.style.display = "block";
      const textContent = textFallback.querySelector(".text-content");
      textContent.textContent = decodedContent;
    }
  } else {
    const textFallback = document.getElementById("text-fallback");
    const textContent = textFallback.querySelector(".text-content");
    textContent.textContent = "无法读取内容或内容已过期。";
    textFallback.style.display = "block";
  }
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
      btn.innerHTML = "已保存!";
      setTimeout(() => (btn.innerHTML = originalText), 2000);
    }
  }
}

// 编辑内容
function editContent() {
  // 简单的编辑功能，打开一个prompt让用户编辑内容
  const editedContent = prompt("编辑内容:", currentContent);
  if (editedContent !== null && editedContent !== currentContent) {
    currentContent = editedContent;
    // 更新显示
    init();
    // 显示编辑成功提示
    const btn = document.querySelector(".edit-btn");
    const originalText = btn.innerHTML;
    btn.innerHTML = "已保存!";
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
    btn.innerHTML = "已复制!";
    setTimeout(() => (btn.innerHTML = originalText), 2000);
  } catch (err) {
    alert("复制失败: " + err);
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
  }
}

// 添加到收藏
async function addToFavorites() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) {
    showToast("无法获取条目ID", "error");
    return;
  }

  try {
    const newState = await invoke("toggle_favorite", { id });
    updateFavoriteButton(newState);
    showToast(newState ? "已添加到收藏" : "已取消收藏", "success");

    // 保存数据到文件
    try {
      await invoke("save_clipboard_history");
    } catch (saveError) {
      console.error("保存数据失败:", saveError);
    }
  } catch (error) {
    console.error("切换收藏状态失败:", error);
    showToast("操作失败，请重试", "error");
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
    showToast("导航失败，请重试", "error");
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
    showToast("导航失败，请重试", "error");
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
    // 1. 初始化内容渲染
    init();

    // 2. 初始化事件监听 (刷新等)
    await initEventListeners();

    // 3. 初始化拖拽 (自定义标题栏)
    await initDragWindow();

    // 4. 初始化窗口尺寸监听 (关键)
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

// 将函数暴露到全局作用域
window.switchMode = switchMode;
window.saveTextContent = saveTextContent;
window.editContent = editContent;
window.copyContent = copyContent;
window.addToFavorites = addToFavorites;
window.closeWindow = closeWindow;
window.navigateToPrevious = navigateToPrevious;
window.navigateToNext = navigateToNext;

// 确保页面加载完成后执行
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
