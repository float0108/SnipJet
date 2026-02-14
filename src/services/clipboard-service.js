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
 */
async function loadRealData(container, statusElement) {
  try {
    updateStatus(statusElement, "加载中...");

    // 测试Tauri连接
    const isConnected = await testTauriConnection();

    if (isConnected) {
      // 获取真实数据
      const history = await getClipboardHistory();
      renderHistory(history, container, statusElement);
    } else {
      // 使用模拟数据
      const mockHistory = createMockHistory();
      renderHistory(mockHistory, container, statusElement);
      updateStatus(statusElement, "使用模拟数据（Tauri未连接）");
    }
  } catch (error) {
    console.error("加载数据失败:", error);
    // 使用模拟数据作为 fallback
    const mockHistory = createMockHistory();
    renderHistory(mockHistory, container, statusElement);
    updateStatus(statusElement, "使用模拟数据（加载失败）");
  }
}

/**
 * 监听剪贴板更新事件
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} statusElement - 状态元素
 */
async function listenToClipboardUpdate(container, statusElement) {
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
        updateUIWithNewItem(event.payload, container, statusElement);
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
        updateUIWithNewItem(event.detail, container, statusElement);
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
 */
function updateUIWithNewItem(newItem, container, statusElement) {
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

  // 使用ClipboardItem.js中的renderClipboardItem函数渲染新项目
  const newItemHtml = renderClipboardItem(parsedItem);
  const newItemElement = document.createElement("div");
  newItemElement.innerHTML = newItemHtml;

  // 获取渲染后的元素（去掉外层的div包装）
  const actualItemElement = newItemElement.firstElementChild;

  // 在顶部插入新项目
  container.insertBefore(actualItemElement, container.firstChild);

  // 直接更新状态，因为这是在收到剪贴板更新信号时执行的
  const currentItems = container.querySelectorAll(".clipboard-item");
  const count = currentItems.length;
  updateStatus(statusElement, "");
  console.log("Updated record count to:", count);
}

export {
  updateStatus,
  loadRealData,
  listenToClipboardUpdate,
  updateUIWithNewItem,
};