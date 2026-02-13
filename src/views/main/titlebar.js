// 标题栏功能

// 全局变量，用于存储窗口的pin状态
let isPinned = true; // 默认置顶
let appWindow = null;

/**
 * 初始化自定义标题栏按钮事件
 */
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
        } else if (window.__TAURI__ && window.__TAURI__.appWindow) {
          await window.__TAURI__.appWindow.hide();
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

export {initTitlebarButtons, openSettingsWindow, isPinned, appWindow};
