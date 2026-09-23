// window-service.js
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { cursorPosition, monitorFromPoint } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { log, error } from "../utils/logger.js";

// 防抖动控制变量
let isTogglingWindow = false;

// 1. 归一化 Key (保持不变)
function getNormalizedKey(label) {
  if (label === "reader" || label.startsWith("reader-")) {
    return "reader-settings";
  }
  return label;
}

// 2. 获取/保存工具函数 (保持不变)
function getWindowSize(label) {
  try {
    // 逻辑必须和 reader.js 中的 setupWindowResizeHandler 保持一致
    const storageKey =
      label === "reader" || label.startsWith("reader-")
        ? "window-size-reader-settings"
        : `window-size-${label}`;
    const sizeStr = localStorage.getItem(storageKey);
    return sizeStr ? JSON.parse(sizeStr) : null;
  } catch (e) {
    return null;
  }
}

function saveWindowSize(label, width, height) {
  // 逻辑必须和 reader.js 中的 setupWindowResizeHandler 保持一致
  const storageKey =
    label === "reader" || label.startsWith("reader-")
      ? "window-size-reader-settings"
      : `window-size-${label}`;
  localStorage.setItem(storageKey, JSON.stringify({width, height}));
  // console.log(`已保存窗口大小 ${label}: ${width}x${height}`);
}

/**
 * [新功能] 初始化窗口尺寸监听
 * 请在 reader.html (子窗口) 的 js 中调用此函数
 */
export async function initWindowResizeListener() {
  const appWindow = getCurrentWebviewWindow();
  const label = appWindow.label;
  const persistentKey = getNormalizedKey(label);

  console.log(`正在初始化窗口监听: ${label} (Key: ${persistentKey})`);

  // 1. 监听调整大小事件 (Tauri v2 API)
  // 注意：onResized 回调直接返回 size 对象，不需要解构 payload
  await appWindow.onResized((size) => {
    // 这里的 size 通常是 PhysicalSize (物理像素)
    // 直接保存物理像素即可，Tauri 创建窗口时也接受物理像素
    saveWindowSize(persistentKey, size.width, size.height);
  });

  // 2. 监听移动事件 (可选，如果以后想保存位置)
  // await appWindow.onMoved((position) => { ... });
}

/**
 * 创建新窗口
 * @param {string} label - 窗口唯一标识
 * @param {object} options - 配置项
 */
export async function createWindow(label, options) {
  // 检查是否存在
  const existingWin = await WebviewWindow.getByLabel(label);
  if (existingWin) {
    await existingWin.setFocus();
    return existingWin;
  }

  // --- 关键：读取保存的大小 ---
  const persistentKey = getNormalizedKey(label);
  const savedSize = getWindowSize(persistentKey);

  const windowOptions = {
    ...options,
    alwaysOnTop: true,
    // 如果有保存的大小，直接应用到创建参数中
    // 这样窗口一出来就是对的大小，不会闪烁
    ...(savedSize ? {width: savedSize.width, height: savedSize.height} : {}),
  };

  const webview = new WebviewWindow(label, windowOptions);

  webview.once("tauri://created", () => {
    console.log("窗口创建成功");
  });

  webview.once("tauri://error", (e) => console.error("创建失败", e));

  return webview;
}

/**
 * 关闭当前窗口
 */
export async function closeCurrentWindow() {
  try {
    console.log("getCurrentWebviewWindow 是否可用:", !!getCurrentWebviewWindow);
    const appWindow = getCurrentWebviewWindow();
    console.log("获取当前窗口成功:", appWindow);
    await appWindow.close();
    console.log("窗口关闭成功");
  } catch (err) {
    console.error("关闭窗口失败", err);
    window.close(); // 降级方案
  }
}

/**
 * 打开内容查看器窗口
 * @param {HTMLElement} element
 */
export async function openReaderWindow(element) {
  const contentId = element.id.replace("item-", "");

  // 为了支持多开，每个窗口 label 必须唯一
  // 但我们的 getNormalizedKey 会识别 "reader-" 前缀并统一 Key
  const label = `reader-${contentId}`;

  // 2. 获取数据
  const content = element.getAttribute("data-content");
  const format = element.getAttribute("data-format");
  const timestamp = element.getAttribute("data-timestamp");
  // 图片元数据
  const imageWidth = element.getAttribute("data-image-width");
  const imageHeight = element.getAttribute("data-image-height");
  const imageSize = element.getAttribute("data-image-size");
  const imageFormat = element.getAttribute("data-image-format");
  // 收藏状态
  const isFavorite = element.classList.contains("is-favorite");

  // 3. 使用 localStorage 传递大数据内容，避免 URL 长度限制
  const storageKey = `transfer-${contentId}`;
  localStorage.setItem(storageKey, content);

  // 打印调试信息
  console.log("获取到的数据:", {
    contentId,
    content: content ? content.substring(0, 100) + "..." : "",
    format,
    timestamp,
    storageKey: storageKey,
  });

  const params = new URLSearchParams({
    id: contentId,
    cacheKey: storageKey, // 传递 localStorage 的 key，而不是直接传递 content
    format: format,
    timestamp: timestamp,
  });

  // 添加图片元数据
  if (imageWidth) params.set("imageWidth", imageWidth);
  if (imageHeight) params.set("imageHeight", imageHeight);
  if (imageSize) params.set("imageSize", imageSize);
  if (imageFormat) params.set("imageFormat", imageFormat);
  // 添加收藏状态
  params.set("isFavorite", isFavorite);

  console.log(`尝试打开窗口: ${label}`);

  try {
    // 直接使用 /reader.html 路径
    const path = `/reader.html?${params.toString()}`;
    console.log(`使用路径: ${path}`);
    await createWindow(label, {
      url: path,
      title: "查看详情",
      width: 800, // 这是默认值，如果有缓存会覆盖它
      height: 600,
      decorations: false,
      center: true,
      focus: true,
    });
  } catch (error) {
    console.error("打开窗口异常:", error);
    alert("无法打开新窗口");
  }
}

/**
 * 获取鼠标位置
 * @returns {Promise<{x: number, y: number}>}
 */
async function getMousePosition() {
  try {
    const position = await cursorPosition();
    return { x: position.x, y: position.y };
  } catch (err) {
    await error("获取鼠标位置失败:", err);
    // 返回屏幕中心作为降级方案
    return { x: window.screen.width / 2 - 160, y: window.screen.height / 2 - 300 };
  }
}

/**
 * 计算窗口显示位置，确保不溢出屏幕
 * 支持多显示器环境，根据鼠标所在屏幕计算
 * @param {number} mouseX - 鼠标 X 坐标
 * @param {number} mouseY - 鼠标 Y 坐标
 * @param {number} windowWidth - 窗口宽度
 * @param {number} windowHeight - 窗口高度
 * @param {number} offset - 距离鼠标的偏移量
 * @returns {Promise<{x: number, y: number}>}
 */
async function calculateWindowPosition(
  mouseX,
  mouseY,
  windowWidth,
  windowHeight,
  offset = 10
) {
  // 获取鼠标所在的显示器信息
  let monitor = null;
  try {
    monitor = await monitorFromPoint(mouseX, mouseY);
  } catch (e) {
    // 降级方案：使用主显示器
    console.warn("无法获取鼠标所在显示器，使用主显示器", e);
  }

  // 获取屏幕边界
  let screenLeft = 0;
  let screenTop = 0;
  let screenWidth = window.screen.width;
  let screenHeight = window.screen.height;

  if (monitor) {
    screenLeft = monitor.position.x;
    screenTop = monitor.position.y;
    screenWidth = monitor.size.width;
    screenHeight = monitor.size.height;
  }

  const screenRight = screenLeft + screenWidth;
  const screenBottom = screenTop + screenHeight;

  // 计算相对屏幕的鼠标位置
  const relativeMouseX = mouseX;
  const relativeMouseY = mouseY;

  let x = relativeMouseX + offset;
  let y = relativeMouseY + offset;

  // 优先顺序：右下 -> 左下 -> 右上 -> 左上

  // 检查右边界溢出（相对于屏幕）
  const overflowRight = x + windowWidth > screenRight;
  // 检查下边界溢出（相对于屏幕）
  const overflowBottom = y + windowHeight > screenBottom;
  // 检查左边界溢出（相对于屏幕）
  const overflowLeft = relativeMouseX - windowWidth - offset < screenLeft;
  // 检查上边界溢出（相对于屏幕）
  const overflowTop = relativeMouseY - windowHeight - offset < screenTop;

  if (!overflowRight && !overflowBottom) {
    // 默认：右下
    x = relativeMouseX + offset;
    y = relativeMouseY + offset;
  } else if (overflowRight && !overflowBottom) {
    // 左下：超出右边界但未超出下边界
    x = relativeMouseX - windowWidth - offset;
    y = relativeMouseY + offset;
  } else if (!overflowRight && overflowBottom) {
    // 右上：未超出右边界但超出下边界
    x = relativeMouseX + offset;
    y = relativeMouseY - windowHeight - offset;
  } else if (overflowRight && overflowBottom) {
    // 左上：既超出右边界又超出下边界
    x = relativeMouseX - windowWidth - offset;
    y = relativeMouseY - windowHeight - offset;
  }

  // 最终边界保护：确保窗口不会完全移出屏幕
  x = Math.max(screenLeft, Math.min(x, screenRight - windowWidth));
  y = Math.max(screenTop, Math.min(y, screenBottom - windowHeight));

  return { x, y };
}

/**
 * 设置窗口是否可激活（是否抢焦点）
 * @param {boolean} focusable - true 表示可激活（抢焦点），false 表示不可激活
 * @returns {Promise<void>}
 *
 * 直接调用 Rust 命令 set_window_focusable_raw 切换 WS_EX_NOACTIVATE，
 * 绕过 tao 自身的 setFocusable（避免 tao 与 WebView2 focus 路由的
 * 状态机竞争，导致全局快捷键失效）。
 */
export async function setWindowFocusable(focusable) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_window_focusable_raw", { focusable });
    await log(`窗口焦点状态已设置: ${focusable ? "可激活" : "不可激活"}`);
  } catch (err) {
    await error("设置窗口焦点状态失败:", err);
  }
}

/**
 * 切换当前窗口可见性
 * 显示时窗口位置跟随鼠标
 *
 * 注意：WS_EX_NOACTIVATE 标志由 Rust 端 set_window_focusable_raw 直接管理，
 * 本函数不去触碰 setFocusable（避免触发 tao 与 WebView2 focus 路由的竞争）。
 * 进入搜索时主动把 WS_EX_NOACTIVATE 临时去掉，搜索退出/失焦时保持它不变。
 */
export async function toggleWindowVisibility() {
  // 防抖动检查
  if (isTogglingWindow) {
    return;
  }

  try {
    // 设置防抖动标志
    isTogglingWindow = true;

    const appWindow = getCurrentWebviewWindow();

    // 尝试获取窗口可见性状态
    let isVisible;
    try {
      isVisible = await appWindow.isVisible();
    } catch (visibilityError) {
      await error("获取窗口可见性状态失败:", visibilityError);
      try {
        await appWindow.hide();
        setTimeout(async () => {
          try { await appWindow.show(); }
          finally { isTogglingWindow = false; }
        }, 100);
      } catch (toggleError) {
        await error("直接切换窗口状态失败:", toggleError);
        isTogglingWindow = false;
      }
      return;
    }

    if (isVisible) {
      // 当前可见 → 隐藏。无需操作 WS_EX_NOACTIVATE（Rust 端管理）。
      await appWindow.hide();
    } else {
      // 当前隐藏 → 显示并移动到鼠标位置。
      const mousePos = await getMousePosition();
      const windowSize = await appWindow.outerSize();
      const position = await calculateWindowPosition(
        mousePos.x,
        mousePos.y,
        windowSize.width,
        windowSize.height
      );
      await appWindow.setPosition(new PhysicalPosition(position.x, position.y));
      await appWindow.show();
      // 兜底：显式重新置顶。如果之前直接调过 set_window_focusable_raw
      // 改过 ex-style，tao 内部的 ALWAYS_ON_TOP 状态没变，apply_diff
      // 不会主动调 SetWindowPos(HWND_TOPMOST)，Z 序会被其它窗口盖住。
      // 通过 Rust 直接 SetWindowPos 强制修正。
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ensure_window_topmost");
      } catch (e) {
        await error("重新置顶失败:", e);
      }
    }
  } catch (err) {
    await error("切换窗口可见性失败:", err);
  } finally {
    setTimeout(() => {
      isTogglingWindow = false;
    }, 200);
  }
}
