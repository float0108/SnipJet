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

    // 更新软件设置
    const {
      updateSoftwareSettings,
      updateCopySettings,
      updateInterfaceSettings,
      bindSettingsListeners,
    } = await import("./handlers.js");
    updateSoftwareSettings();
    updateCopySettings();
    updateInterfaceSettings();

    // 绑定设置变化监听器
    bindSettingsListeners();

    // 设置UI交互
    const {setupSidebar, setupCloseButton, setupEscKey, setupConfirmCancelButtons} =
      await import("./ui.js");
    setupSidebar();
    setupCloseButton();
    setupEscKey();
    setupConfirmCancelButtons();

    console.log("设置页面初始化完成");
  } catch (error) {
    console.error("初始化设置页面时出错:", error);
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
