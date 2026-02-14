// 全局状态
let currentContent = "";
let currentMode = "render"; // 'render' or 'source'
let refreshEventListener = null;

// 导入格式化工具
import {html2text} from "../../utils/formatter.js";

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

// 初始化页面
function init() {
  const params = getUrlParams();
  console.log("初始化参数:", params);

  const cacheKey = params.cacheKey;
  // 尝试从 localStorage 获取内容，如果没有则尝试从 URL 直接获取 (兜底)
  const realContent = localStorage.getItem(cacheKey) || params.content;

  if (realContent) {
    currentContent = realContent; // 保存到全局以便复制

    // 1. 更新元数据
    document.getElementById("meta-type").textContent = (
      params.format || "TEXT"
    ).toUpperCase();
    // 如果有 timestamp，转换一下
    if (params.timestamp) {
      const date = new Date(parseInt(params.timestamp) || params.timestamp);
      document.getElementById("meta-time").textContent = date.toLocaleString();
    }
    // 简略计算大小 (字符数)
    document.getElementById("meta-size").textContent =
      `${realContent.length} chars`;

    // 2. 准备 DOM 元素
    const htmlFrame = document.getElementById("html-frame");
    const textFallback = document.getElementById("text-fallback");
    const sourceView = document.getElementById("source-view");
    const viewToggle = document.getElementById("view-toggle");

    // 解码内容
    let decodedContent = realContent;
    try {
      // 有些内容可能被多次编码，根据实际情况调整
      if (realContent.includes("%") && !realContent.includes("<html")) {
        decodedContent = decodeURIComponent(realContent);
      }
    } catch (e) {
      console.warn("解码可能失败，使用原内容", e);
    }

    // 3. 根据格式渲染
    if (params.format === "html") {
      // --- HTML 处理逻辑 ---

      // A. 显示切换开关
      viewToggle.style.display = "flex";

      // B. 填充渲染视图 (iframe)
      // 注入一些基础 CSS 让 iframe 里的内容不至于太丑（比如默认无衬线字体）
      const styledHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * {
              box-sizing: border-box;
            }
            html, body {
              height: 100%;
              margin: 0;
              padding: 0;
            }
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
            body::-webkit-scrollbar {
              width: 6px !important;
              height: 6px !important;
            }
            body::-webkit-scrollbar-track {
              background: transparent !important;
            }
            body::-webkit-scrollbar-thumb {
              background-color: transparent !important;
              border-radius: 3px !important;
            }
            body:hover {
              scrollbar-color: rgba(148, 163, 184, 0.5) transparent !important;
            }
            body:hover::-webkit-scrollbar-thumb {
              background-color: rgba(148, 163, 184, 0.5) !important;
            }
            body:hover::-webkit-scrollbar-thumb:hover {
              background-color: rgba(148, 163, 184, 0.8) !important;
            }
            img { max-width: 100%; height: auto; }
            pre { background: #f5f5f5; padding: 10px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>${decodedContent}</body>
        </html>
      `;
      htmlFrame.srcdoc = styledHtml;

      // C. 填充纯文本视图
      // 调用后端的html_to_text API获取纯文本
      async function getPlainTextFromBackend(html) {
        try {
          if (window.__TAURI__ && window.__TAURI__.invoke) {
            return await window.__TAURI__.invoke("html_to_text", {html});
          } else {
            // 后端API不可用，使用前端fallback
            return html2text(html);
          }
        } catch (error) {
          console.error("调用后端html_to_text API失败:", error);
          // 出错时使用前端fallback
          return html2text(html);
        }
      }

      // 获取纯文本并填充
      getPlainTextFromBackend(decodedContent).then((plainText) => {
        const textContent = textFallback.querySelector(".text-content");
        textContent.textContent = plainText;
      });

      // D. 填充源码视图 (Text)
      // 使用 textContent 防止 XSS 并在文本框中显示
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

// 添加到收藏
function addToFavorites() {
  try {
    if (window.__TAURI__ && window.__TAURI__.invoke) {
      // 调用后端添加到收藏的API
      window.__TAURI__
        .invoke("add_to_favorites", {
          content: currentContent,
        })
        .then(() => {
          // 显示成功提示
          showToast("已添加到收藏", "success");
        })
        .catch((error) => {
          console.error("添加到收藏失败:", error);
          // 显示失败提示
          showToast("添加到收藏失败，请重试", "error");
        });
    } else {
      // 前端模拟
      console.log("添加到收藏:", currentContent);
      showToast("已添加到收藏", "success");
    }
  } catch (error) {
    console.error("添加到收藏失败:", error);
    showToast("添加到收藏失败，请重试", "error");
  }
}

// 关闭窗口
function closeWindow() {
  try {
    if (
      window.__TAURI__ &&
      window.__TAURI__.window &&
      window.__TAURI__.window.getCurrentWindow
    ) {
      // 使用正确的 Tauri API 关闭窗口
      const appWindow = window.__TAURI__.window.getCurrentWindow();
      appWindow.close();
    }
  } catch (error) {
    // 忽略错误，因为在沙箱环境中可能会受限
  }
}

// 初始化窗口拖动功能
function initDragWindow() {
  console.log("初始化窗口拖动功能");
  try {
    if (
      window.__TAURI__ &&
      window.__TAURI__.window &&
      window.__TAURI__.window.getCurrentWindow
    ) {
      console.log("Tauri窗口API可用");
      const appWindow = window.__TAURI__.window.getCurrentWindow();
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
function navigateToPrevious() {
  try {
    const currentId = new URLSearchParams(window.location.search).get("id");
    console.log("点击上一个按钮，当前ID:", currentId);

    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      window.__TAURI__.event.emit
    ) {
      // 发送导航事件到主应用
      window.__TAURI__.event.emit("navigate-clipboard", {
        direction: "next",
        currentId: currentId,
      });
      console.log("发送导航到上一个剪贴板项的事件");
    } else {
      // 前端模拟
      console.log("导航到上一个剪贴板项");
    }
  } catch (error) {
    console.error("导航失败:", error);
    showToast("导航失败，请重试", "error");
  }
}

// 导航到下一个剪贴板项
function navigateToNext() {
  try {
    const currentId = new URLSearchParams(window.location.search).get("id");
    console.log("点击下一个按钮，当前ID:", currentId);

    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      window.__TAURI__.event.emit
    ) {
      // 发送导航事件到主应用
      window.__TAURI__.event.emit("navigate-clipboard", {
        direction: "previous",
        currentId: currentId,
      });
      console.log("发送导航到下一个剪贴板项的事件");
    } else {
      // 前端模拟
      console.log("导航到下一个剪贴板项");
    }
  } catch (error) {
    console.error("导航失败:", error);
    showToast("导航失败，请重试", "error");
  }
}

// 初始化事件监听器
function initEventListeners() {
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
  if (
    window.__TAURI__ &&
    window.__TAURI__.event &&
    window.__TAURI__.event.listen
  ) {
    window.__TAURI__.event
      .listen("refresh-reader", (event) => {
        console.log("收到刷新事件:", event);
        if (event && event.payload) {
          const {error, id, cacheKey, format, timestamp} = event.payload;
          if (error) {
            // 显示错误提示
            showToast(error, "error");
          } else {
            // 刷新页面内容
            refreshContent(id, cacheKey, format, timestamp);
          }
        }
      })
      .then((unlistenFn) => {
        refreshEventListener = unlistenFn;
        console.log("注册了刷新事件监听器");
      })
      .catch((error) => {
        console.error("注册事件监听器失败:", error);
      });
  }
}

// 刷新页面内容
function refreshContent(id, cacheKey, format, timestamp) {
  console.log("刷新页面内容:", {id, cacheKey, format, timestamp});

  // 更新URL参数
  const params = new URLSearchParams(window.location.search);
  params.set("id", id);
  params.set("cacheKey", cacheKey);
  params.set("format", format);
  params.set("timestamp", timestamp);
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
    if (!window.__TAURI__) return;

    const {getCurrentWindow} = window.__TAURI__.window;
    const appWindow = getCurrentWindow();
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

        const sizeObj = {width: w, height: h};
        localStorage.setItem(storageKey, JSON.stringify(sizeObj));
        // console.log(`尺寸已保存 (逻辑像素): ${w}x${h}`);
      }, 500);
    };

    // 2. 监听 Resize
    await appWindow.onResized(({payload: size}) => {
      // 兼容 Tauri 不同版本的 payload
      // 有些版本直接返回 size，有些是在 payload 里
      const rawSize = size || {};

      // 优先寻找 payload 中的逻辑像素 (Tauri v2 部分事件直接提供)
      if (rawSize.logical) {
        saveSize(rawSize.logical.width, rawSize.logical.height);
        return;
      }

      // 否则使用物理像素进行换算
      let physW, physH;
      if (rawSize.physical) {
        physW = rawSize.physical.width;
        physH = rawSize.physical.height;
      } else {
        // 假设直接是物理像素 (Tauri v1 常见情况)
        physW = rawSize.width;
        physH = rawSize.height;
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
    initEventListeners();

    // 3. 初始化拖拽 (自定义标题栏)
    initDragWindow();

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
// window.onload = initialize; // 建议用 DOMContentLoaded 更快
