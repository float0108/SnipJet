// 主入口文件

// 初始化页面
async function init() {
  try {
    console.log("开始初始化设置页面");

    // 初始化主题
    const { initTheme } = await import("../../services/theme-service.js");
    await initTheme();

    // 加载设置
    const {loadSettings} = await import("./handlers.js");
    await loadSettings();

    console.log("设置加载完成，开始更新UI");

    // 更新快捷键输入框
    const {updateShortcutInputs, initShortcuts} =
      await import("./shortcuts.js");
    updateShortcutInputs();
    initShortcuts();

    // 更新各分区设置
    const {
      updateGeneralSettings,
      updateAppearanceSettings,
      updateClipboardSettings,
      updateHistorySettings,
      updateAdvancedSettings,
      bindSettingsListeners,
    } = await import("./handlers.js");
    updateGeneralSettings();
    updateAppearanceSettings();
    updateClipboardSettings();
    updateHistorySettings();
    updateAdvancedSettings();

    // 绑定设置变化监听器
    bindSettingsListeners();

    // 设置UI交互
    const {setupSidebar, setupCloseButton, setupEscKey, setupConfirmCancelButtons} =
      await import("./ui.js");
    setupSidebar();
    setupCloseButton();
    setupEscKey();
    setupConfirmCancelButtons();

    // 设置已全部应用到 DOM：等两帧后恢复过渡动画，
    // 移除 head 脚本加的 preload 标记（期间 toggle 等控件不播放状态切换动画）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("preload");
      });
    });

    console.log("设置页面初始化完成");
  } catch (error) {
    console.error("初始化设置页面时出错:", error);
    document.documentElement.classList.remove("preload");
  }
}

// 页面加载完成后初始化
window.addEventListener("load", init);

// 暴露全局函数（为了兼容现有的HTML中的onclick调用）
window.clearShortcut = function (inputId) {
  import("./shortcuts.js").then(({clearShortcut}) => {
    clearShortcut(inputId);
  });
};
