// 剪贴板服务

import {getClipboardHistory, testTauriConnection, listen} from "./tauri-api.js";
import {parseClipboardItem} from "../utils/content-parser.js";
import {renderClipboardItem} from "../components/clipboard-history/clipboard-item.js";
import {renderHistory, createMockHistory} from "../components/clipboard-history/clipboard-history.js";

/**
 * 更新状态显示
 * @param {HTMLElement} element - 状态元素
 * @param {string} message - 状态消息
 */
function updateStatus(element, message) {
  if (element) {
    element.textContent = message;
  }
}

/**
 * 加载剪贴板历史记录
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} statusElement - 状态元素
 * @param {Function} onDataLoaded - 数据加载完成后的回调，接收所有原始数据。如果提供此回调，则不会自动渲染，由回调负责渲染。
 */
async function loadRealData(container, statusElement, onDataLoaded) {
  console.log("[loadRealData] 开始加载剪贴板历史记录");
  try {
    updateStatus(statusElement, "加载中...");

    // 测试Tauri连接
    console.log("[loadRealData] 测试 Tauri 连接...");
    const isConnected = await testTauriConnection();
    console.log("[loadRealData] Tauri 连接状态:", isConnected);

    if (isConnected) {
      // 获取真实数据
      console.log("[loadRealData] 获取剪贴板历史...");
      const history = await getClipboardHistory();
      console.log("[loadRealData] 获取到历史记录:", history?.length || 0, "条");

      // 通知数据已加载
      if (onDataLoaded) {
        console.log("[loadRealData] 调用 onDataLoaded 回调");
        onDataLoaded(history);
      } else {
        // 只有在没有回调时才自动渲染
        console.log("[loadRealData] 没有回调，自动渲染");
        renderHistory(history, container, statusElement);
      }
    } else {
      // 使用模拟数据
      const mockHistory = createMockHistory();
      if (onDataLoaded) {
        onDataLoaded(mockHistory);
      } else {
        renderHistory(mockHistory, container, statusElement);
      }
      updateStatus(statusElement, "使用模拟数据（Tauri未连接）");
    }
  } catch (error) {
    console.error("加载数据失败:", error);
    // 使用模拟数据作为 fallback
    const mockHistory = createMockHistory();
    if (onDataLoaded) {
      onDataLoaded(mockHistory);
    } else {
      renderHistory(mockHistory, container, statusElement);
    }
    updateStatus(statusElement, "使用模拟数据（加载失败）");
  }
}

/**
 * 监听剪贴板更新事件
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} statusElement - 状态元素
 * @param {Function} onNewItem - 新项目回调
 */
async function listenToClipboardUpdate(container, statusElement, onNewItem) {
  console.log("开始设置剪贴板更新事件监听");

  // 检查 Tauri API 是否可用
  console.log("Tauri API 状态:", {
    window: !!window,
    window__TAURI__: !!window.__TAURI__,
    window__TAURI__event: window.__TAURI__ && !!window.__TAURI__.event,
    window__TAURI__event_listen:
      window.__TAURI__ &&
      window.__TAURI__.event &&
      !!window.__TAURI__.event.listen,
    listen_function: typeof listen === "function",
  });

  try {
    // 使用导入的 listen 函数来监听事件
    console.log("尝试调用 listen 函数");
    const unlisten = await listen("clipboard-update", (event) => {
      console.log("收到剪贴板更新信号，开始更新UI:", event);
      if (event && event.payload) {
        updateUIWithNewItem(event.payload, container, statusElement, onNewItem);
      } else {
        console.error("事件对象无效，没有 payload 属性:", event);
      }
    });
    console.log("事件监听设置成功，返回的取消监听函数:", unlisten);
    window.unlistenClipboardUpdate = unlisten;
  } catch (error) {
    console.error("事件监听设置失败:", error);
    // 作为备用方案，尝试使用标准的DOM事件监听
    if (window.addEventListener) {
      console.log("尝试使用标准DOM事件监听");
      window.addEventListener("clipboard-update", (event) => {
        console.log("收到DOM剪贴板更新事件:", event.detail);
        updateUIWithNewItem(event.detail, container, statusElement, onNewItem);
      });
    } else {
      console.error("无法设置事件监听，没有可用的API");
    }
  }

  console.log("事件监听设置完成");
}

/**
 * 使用新项目更新UI
 * @param {Object} newItem - 新的剪贴板项目
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} statusElement - 状态元素
 * @param {Function} onNewItem - 新项目的回调
 */
function updateUIWithNewItem(newItem, container, statusElement, onNewItem) {
  // 打印调试信息
  console.log(
    "Received clipboard-update event, updating UI with new item:",
    newItem,
  );

  // 检查并移除加载状态元素
  const loadingElement = container.querySelector(".loading-state");
  if (loadingElement) {
    container.removeChild(loadingElement);
    console.log("Removed loading state element");
  }

  // 检查并移除空状态元素
  const emptyElement = container.querySelector(".empty-state");
  if (emptyElement) {
    container.removeChild(emptyElement);
    console.log("Removed empty state element");
  }

  // 解析剪贴板项目数据
  const parsedItem = parseClipboardItem(newItem);
  console.log("Parsed item:", parsedItem);

  // 使用ClipboardItem.js中的renderClipboardItem函数渲染新项目
  const newItemHtml = renderClipboardItem(parsedItem);
  const newItemElement = document.createElement("div");
  newItemElement.innerHTML = newItemHtml;

  // 获取渲染后的元素（去掉外层的div包装）
  const actualItemElement = newItemElement.firstElementChild;

  // 在顶部插入新项目
  container.insertBefore(actualItemElement, container.firstChild);

  // 如果是图片，加载图片预览
  if (parsedItem.format === "image") {
    const imgElement = actualItemElement.querySelector(".preview-image");
    if (imgElement && imgElement.dataset.imagePath) {
      import("../components/clipboard-history/clipboard-item.js")
        .then(({ loadItemImage }) => loadItemImage(imgElement))
        .catch((e) => console.error("Failed to load image preview:", e));
    }
  }

  // 通知新项目
  if (onNewItem) {
    onNewItem(newItem);
  }

  // 直接更新状态，因为这是在收到剪贴板更新信号时执行的
  const currentItems = container.querySelectorAll(".clipboard-item");
  updateStatus(statusElement, "");
}

export {
  updateStatus,
  loadRealData,
  listenToClipboardUpdate,
  updateUIWithNewItem,
};