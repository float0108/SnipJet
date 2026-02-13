// 前端应用主入口

import {
  getClipboardHistory,
  testTauriConnection,
  listen,
} from "../../services/tauri-api.js";
import {parseClipboardItem} from "../../services/content-parser.js";
import {openReaderWindow, createWindow} from "../../services/window-service.js";
import {html2text} from "../../services/formatter.js";
import {renderClipboardItem} from "../../components/clipboard-history/clipboard-item.js";
import {
  renderHistory,
  createMockHistory,
} from "../../components/clipboard-history/clipboard-history.js";
// 使用全局变量window.__TAURI__

// 确保函数被暴露到全局作用域
if (typeof window !== "undefined") {
  window.openReaderWindow = openReaderWindow;

  // 复制到剪贴板
  window.copyToClipboard = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        // 获取invoke函数
        const tauri = window.__TAURI__;
        const invoke = tauri?.core?.invoke || tauri?.invoke;

        if (invoke) {
          try {
            // 使用后端命令复制，避免触发历史更新
            await invoke("copy_to_clipboard_no_history", {
              content: decodeURIComponent(content),
              format: format,
            });
            console.log("内容已复制到剪贴板（无历史更新）");
          } catch (e) {
            console.error("后端调用失败:", e);
            // 后端API调用失败，使用前端fallback
            await navigator.clipboard.writeText(decodeURIComponent(content));
            console.log("内容已复制到剪贴板（前端fallback）");
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(decodeURIComponent(content));
          console.log("内容已复制到剪贴板（前端fallback）");
        }
      }
    } catch (error) {
      console.error("复制失败:", error);
    }
  };

  // 模拟粘贴到当前窗口
  window.pasteToCurrentWindow = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        // 获取invoke函数
        const tauri = window.__TAURI__;
        const invoke = tauri?.core?.invoke || tauri?.invoke;

        // 先复制到剪贴板，使用后端命令避免触发历史更新
        if (invoke) {
          try {
            await invoke("copy_to_clipboard_no_history", {
              content: decodeURIComponent(content),
              format: format,
            });
            console.log("内容已复制到剪贴板（无历史更新），准备模拟粘贴");
          } catch (e) {
            console.error("后端复制命令执行失败:", e);
            // 后端API不可用，使用前端fallback
            await navigator.clipboard.writeText(decodeURIComponent(content));
            console.log("内容已复制到剪贴板（前端fallback），准备模拟粘贴");
          }

          // 尝试使用后端的paste_to_active_window命令
          try {
            await invoke("paste_to_active_window", {
              content: decodeURIComponent(content),
              format: format,
              isPinned: isPinned,
            });
            console.log("后端粘贴命令执行成功");
            return;
          } catch (tauriError) {
            console.error("后端粘贴命令执行失败:", tauriError);
            // 后端命令失败，使用前端模拟作为 fallback
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(decodeURIComponent(content));
          console.log("内容已复制到剪贴板（前端fallback），准备模拟粘贴");
        }

        // 前端模拟作为 fallback
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const modifierKey = isMac ? "Meta" : "Control";

        // 创建键盘事件
        const pasteEvent = new KeyboardEvent("keydown", {
          key: "v",
          ctrlKey: !isMac,
          metaKey: isMac,
          bubbles: true,
          cancelable: true,
        });

        // 分发事件到当前活动元素
        const activeElement = document.activeElement;
        if (activeElement) {
          activeElement.dispatchEvent(pasteEvent);
          console.log("模拟粘贴事件已发送");
        } else {
          console.log("没有活动元素，无法发送粘贴事件");
        }
      }
    } catch (error) {
      console.error("模拟粘贴失败:", error);
    }
  };

  // 粘贴为纯文本
  window.pasteAsPlainText = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        // 获取纯文本内容（从后端html转text api获取，类似text-frame的方式）
        const encodedContent = decodeURIComponent(content);
        let plainText = encodedContent;

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

        // 如果是html格式，使用后端API获取纯文本
        if (format === "html") {
          plainText = await getPlainTextFromBackend(encodedContent);
        }
        console.log("纯文本内容:", plainText.substring(0, 50) + "...");

        // 获取invoke函数
        const tauri = window.__TAURI__;
        const invoke = tauri?.core?.invoke || tauri?.invoke;

        // 先复制纯文本到剪贴板，使用后端命令避免触发历史更新
        if (invoke) {
          try {
            await invoke("copy_to_clipboard_no_history", {
              content: plainText,
              format: "plain",
            });
            console.log("纯文本已复制到剪贴板（无历史更新），准备模拟粘贴");
          } catch (e) {
            console.error("后端复制命令执行失败:", e);
            // 后端API不可用，使用前端fallback
            await navigator.clipboard.writeText(plainText);
            console.log("纯文本已复制到剪贴板（前端fallback），准备模拟粘贴");
          }

          // 尝试使用后端的paste_to_active_window命令
          try {
            await invoke("paste_to_active_window", {
              content: plainText,
              format: "plain",
              isPinned: isPinned,
            });
            console.log("后端粘贴命令执行成功");
            return;
          } catch (tauriError) {
            console.error("后端粘贴命令执行失败:", tauriError);
            // 后端命令失败，使用前端模拟作为 fallback
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(plainText);
          console.log("纯文本已复制到剪贴板（前端fallback），准备模拟粘贴");
        }

        // 前端模拟作为 fallback
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const modifierKey = isMac ? "Meta" : "Control";

        // 创建键盘事件
        const pasteEvent = new KeyboardEvent("keydown", {
          key: "v",
          ctrlKey: !isMac,
          metaKey: isMac,
          bubbles: true,
          cancelable: true,
        });

        // 分发事件到当前活动元素
        const activeElement = document.activeElement;
        if (activeElement) {
          activeElement.dispatchEvent(pasteEvent);
          console.log("模拟粘贴纯文本事件已发送");
        } else {
          console.log("没有活动元素，无法发送粘贴事件");
        }
      }
    } catch (error) {
      console.error("粘贴纯文本失败:", error);
    }
  };

  // 删除剪贴板项
  window.deleteClipboardItem = function (id) {
    console.log("删除剪贴板项:", id);
    // 这里可以添加删除逻辑
  };
}

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
 * 初始化应用
 */
async function init() {
  console.log("开始初始化应用");
  const container = document.getElementById("clipboard-history");
  const statusElement = document.getElementById("status");

  console.log("获取DOM元素:", {
    container: !!container,
    statusElement: !!statusElement,
  });

  if (!container) {
    console.error("找不到剪贴板历史容器元素");
    return;
  }

  // 初始显示加载状态
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">加载中</div>
      <div class="loading-description">正在获取剪贴板历史</div>
    </div>
    
    <!-- 骨架屏效果 -->
    <div>
      <div>
        <div></div>
        <div></div>
      </div>
      <div></div>
    </div>
    
    <div>
      <div>
        <div></div>
        <div></div>
      </div>
      <div></div>
    </div>
  `;
  updateStatus(statusElement, "初始化中...");

  // 初始加载历史记录
  console.log("开始加载初始数据");
  await loadRealData(container, statusElement);
  console.log("初始数据加载完成");

  // 初始化自定义标题栏按钮事件
  initTitlebarButtons();
  console.log("自定义标题栏按钮事件已初始化");

  // 监听剪贴板更新事件
  console.log("开始设置事件监听");
  try {
    await listenToClipboardUpdate(container, statusElement);
    console.log("剪贴板更新事件监听已启动");
  } catch (error) {
    console.error("事件监听失败:", error);
    // 不再降级到轮询模式，完全依赖事件驱动
  }

  // 监听导航剪贴板事件
  try {
    await listen("navigate-clipboard", (event) => {
      console.log("收到导航剪贴板事件:", event);
      if (event && event.payload) {
        handleNavigation(event.payload, container);
      }
    });
    console.log("导航剪贴板事件监听已启动");
  } catch (error) {
    console.error("导航事件监听失败:", error);
  }

  console.log("SnipJet前端应用初始化完成");

  // 测试手动触发事件处理
  console.log("测试手动触发事件处理...");
  setTimeout(() => {
    console.log("测试完成，等待真实事件...");
  }, 2000);
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

// 禁用右键菜单
if (window.location.hostname !== "localhost") {
  // 仅在生产环境禁用，开发环境保留右键方便调试
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

// 全局变量，用于存储窗口的pin状态
let isPinned = true; // 默认置顶
let appWindow = null;

// 初始化自定义标题栏按钮事件
function initTitlebarButtons() {
  // 固定按钮
  const pinBtn = document.getElementById("pin-btn");
  if (pinBtn) {
    // 初始化窗口置顶状态
    async function initWindowState() {
      try {
        if (
          window.__TAURI__ &&
          window.__TAURI__.window &&
          window.__TAURI__.window.getCurrentWindow
        ) {
          appWindow = window.__TAURI__.window.getCurrentWindow();
          // 设置窗口默认置顶
          await appWindow.setAlwaysOnTop(isPinned);
          console.log(`窗口默认已置顶`);
          // 更新按钮样式
          pinBtn.classList.toggle("pinned", isPinned);

          // 添加焦点变化监听器
          appWindow.on("blur", async () => {
            console.log("窗口失去焦点");
            if (!isPinned) {
              console.log("窗口未置顶，正在隐藏...");
              await appWindow.hide();
            }
          });

          // 同步pin状态到后端
          const tauri = window.__TAURI__;
          const invoke = tauri?.core?.invoke || tauri?.invoke;
          if (invoke) {
            try {
              await invoke("update_window_pin_state", {
                isPinned: isPinned,
              });
              console.log("Pin状态已同步到后端");
            } catch (e) {
              console.error("同步pin状态失败:", e);
            }
          }
        }
      } catch (error) {
        console.error("初始化窗口状态失败:", error);
      }
    }

    // 执行初始化
    initWindowState();

    pinBtn.addEventListener("click", async () => {
      try {
        if (
          !appWindow &&
          window.__TAURI__ &&
          window.__TAURI__.window &&
          window.__TAURI__.window.getCurrentWindow
        ) {
          appWindow = window.__TAURI__.window.getCurrentWindow();
        }
        if (appWindow) {
          isPinned = !isPinned;
          await appWindow.setAlwaysOnTop(isPinned);
          console.log(`窗口已${isPinned ? "置顶" : "取消置顶"}`);
          // 更新按钮样式
          pinBtn.classList.toggle("pinned", isPinned);

          // 同步pin状态到后端
          const tauri = window.__TAURI__;
          const invoke = tauri?.core?.invoke || tauri?.invoke;
          if (invoke) {
            try {
              await invoke("update_window_pin_state", {
                isPinned: isPinned,
              });
              console.log("Pin状态已同步到后端");
            } catch (e) {
              console.error("同步pin状态失败:", e);
            }
          }
        }
      } catch (error) {
        console.error("设置窗口置顶失败:", error);
      }
    });
  }

  // 设置按钮
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", async () => {
      console.log("打开设置");
      try {
        await openSettingsWindow();
      } catch (error) {
        console.error("打开设置窗口失败:", error);
      }
    });
  }

  // 关闭按钮（改为隐藏窗口）
  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      try {
        if (
          window.__TAURI__ &&
          window.__TAURI__.window &&
          window.__TAURI__.window.getCurrentWindow
        ) {
          const appWindow = window.__TAURI__.window.getCurrentWindow();
          await appWindow.hide();
          console.log("窗口已隐藏");
        } else if (window.__TAURI__ && window.__TAURI__.appWindow) {
          await window.__TAURI__.appWindow.hide();
          console.log("窗口已隐藏");
        }
      } catch (error) {
        console.error("隐藏窗口失败:", error);
      }
    });
  }
}

/**
 * 打开设置窗口
 */
async function openSettingsWindow() {
  try {
    const label = "settings-window";
    await createWindow(label, {
      url: "/settings.html",
      title: "SnipJet 设置",
      width: 600,
      height: 500,
      center: true,
      focus: true,
      decorations: false,
    });
  } catch (error) {
    console.error("打开设置窗口失败:", error);
    throw error;
  }
}

/**
 * 处理导航事件
 * @param {Object} payload - 导航事件数据
 * @param {string} payload.direction - 导航方向 ("previous" 或 "next")
 * @param {string} payload.currentId - 当前剪贴板项的ID
 * @param {HTMLElement} container - 剪贴板历史容器
 */
async function handleNavigation(payload, container) {
  try {
    const {direction, currentId} = payload;
    console.log("处理导航事件:", {direction, currentId});

    // 获取所有剪贴板项
    const items = container.querySelectorAll(".clipboard-item");
    let currentIndex = -1;

    // 找到当前项目的索引
    items.forEach((item, index) => {
      if (item.id === `item-${currentId}`) {
        currentIndex = index;
      }
    });

    console.log("当前项目索引:", currentIndex);

    // 计算目标索引
    let targetIndex = currentIndex;
    if (direction === "previous") {
      targetIndex = currentIndex + 1;
    } else if (direction === "next") {
      targetIndex = currentIndex - 1;
    }

    console.log("目标项目索引:", targetIndex);

    // 检查目标索引是否有效
    if (targetIndex >= 0 && targetIndex < items.length) {
      const targetItem = items[targetIndex];
      console.log("找到目标项目:", targetItem.id);

      // 获取目标项目的数据
      const content = targetItem.getAttribute("data-content");
      const format = targetItem.getAttribute("data-format");
      const timestamp = targetItem.getAttribute("data-timestamp");
      const targetId = targetItem.id.replace("item-", "");

      console.log("目标项目数据:", {content, format, timestamp, targetId});

      // 使用 localStorage 传递大数据内容，避免 URL 长度限制
      const storageKey = `transfer-${targetId}`;
      localStorage.setItem(storageKey, content);

      // 发送事件给当前reader窗口，通知其刷新内容
      if (
        window.__TAURI__ &&
        window.__TAURI__.event &&
        window.__TAURI__.event.emit
      ) {
        console.log("准备发送刷新事件");
        window.__TAURI__.event.emit("refresh-reader", {
          id: targetId,
          cacheKey: storageKey,
          format: format,
          timestamp: timestamp,
        });
        console.log("发送刷新reader窗口的事件成功");
      } else {
        console.error("无法发送刷新事件，Tauri事件API不可用");
      }
    } else {
      console.log("没有更多项目可以导航");

      // 发送事件给当前reader窗口，通知其没有更多项目
      if (
        window.__TAURI__ &&
        window.__TAURI__.event &&
        window.__TAURI__.event.emit
      ) {
        window.__TAURI__.event.emit("refresh-reader", {
          error: "没有更多项目可以导航",
        });
        console.log("发送没有更多项目的事件");
      }
    }
  } catch (error) {
    console.error("处理导航事件失败:", error);

    // 发送事件给当前reader窗口，通知其导航失败
    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      window.__TAURI__.event.emit
    ) {
      window.__TAURI__.event.emit("refresh-reader", {
        error: "导航失败，请重试",
      });
      console.log("发送导航失败的事件");
    }
  }
}

// 启动应用
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
