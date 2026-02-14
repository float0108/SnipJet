// window-service.js
const {WebviewWindow} = window.__TAURI__.webviewWindow;
const {getCurrentWindow} = window.__TAURI__.window;
import {log, error} from "../utils/logger.js";

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
  const appWindow = getCurrentWindow();
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
    console.log("getCurrentWindow 是否可用:", !!getCurrentWindow);
    const appWindow = getCurrentWindow();
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
 * 切换当前窗口可见性
 */
export async function toggleWindowVisibility() {
  // 防抖动检查
  if (isTogglingWindow) {
    return;
  }

  try {
    // 设置防抖动标志
    isTogglingWindow = true;

    await log("快捷键触发：切换窗口可见性");

    if (window.__TAURI__ && window.__TAURI__.window) {
      const {getCurrentWindow} = window.__TAURI__.window;
      const appWindow = getCurrentWindow();

      // 尝试获取窗口可见性状态
      let isVisible;
      try {
        isVisible = await appWindow.isVisible();
      } catch (visibilityError) {
        await error("获取窗口可见性状态失败:", visibilityError);
        // 尝试直接切换，不依赖可见性状态
        try {
          // 先尝试隐藏
          await appWindow.hide();
          // 短暂延迟后尝试显示
          setTimeout(async () => {
            await appWindow.show();
            // 重置防抖动标志
            isTogglingWindow = false;
          }, 100);
        } catch (toggleError) {
          await error("直接切换窗口状态失败:", toggleError);
          // 重置防抖动标志
          isTogglingWindow = false;
        }
        return;
      }

      if (isVisible) {
        await appWindow.hide();
      } else {
        await appWindow.show();
      }
    } else {
      await error("Tauri window API 不可用");
    }
  } catch (error) {
    await error("切换窗口可见性失败:", error);
  } finally {
    // 操作完成后重置防抖动标志
    // 添加小延迟，确保操作完全完成
    setTimeout(() => {
      isTogglingWindow = false;
    }, 200);
  }
}
