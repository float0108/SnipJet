// 全局设置对象
export let settings = {};

// 加载设置
export async function loadSettings() {
  try {
    if (window.__TAURI__ && window.__TAURI__.fs) {
      const {readTextFile, exists, BaseDirectory} = window.__TAURI__.fs;

      console.log("尝试加载设置文件");

      // 检查设置文件是否存在
      if (await exists("settings.json", {baseDir: BaseDirectory.AppConfig})) {
        // 从应用配置目录加载设置文件
        const content = await readTextFile("settings.json", {
          baseDir: BaseDirectory.AppConfig,
        });
        settings = JSON.parse(content);
        console.log("设置加载成功:", settings);
      } else {
        console.log("设置文件不存在，使用默认设置");
        // 使用默认设置
        settings = {
          shortcuts: {
            toggle_interface: "",
            function_paste: "",
            quick_paste_mode: "ctrl",
          },
          interface: {
            theme: "light",
            language: "cn",
            auto_hide: true,
            preview_size: "small",
            max_history_items: 100,
          },
          copy: {
            strip_formatting: false,
            auto_copy: true,
            copy_on_select: false,
          },
          software: {
            startup_launch: true,
            check_updates: true,
          },
        };
      }
    } else {
      // 在非Tauri环境中，尝试从前端目录加载
      const response = await fetch("/config/settings.json");
      if (response.ok) {
        settings = await response.json();
        console.log("设置加载成功 (非Tauri):", settings);
      } else {
        console.error("加载设置失败:", response.status);
        // 使用默认设置
        settings = {
          shortcuts: {
            toggle_interface: "",
            function_paste: "",
            quick_paste_mode: "ctrl",
          },
          interface: {
            theme: "light",
            language: "cn",
            auto_hide: true,
            preview_size: "small",
            max_history_items: 100,
          },
          copy: {
            strip_formatting: false,
            auto_copy: true,
            copy_on_select: false,
          },
          software: {
            startup_launch: true,
            check_updates: true,
          },
        };
      }
    }
  } catch (error) {
    console.error("加载设置时出错:", error);
    // 使用默认设置
    settings = {
      shortcuts: {
        toggle_interface: "",
        function_paste: "",
        quick_paste_mode: "ctrl",
      },
      interface: {
        theme: "light",
        language: "cn",
        auto_hide: true,
        preview_size: "small",
        max_history_items: 100,
      },
      copy: {
        strip_formatting: false,
        auto_copy: true,
        copy_on_select: false,
      },
      software: {
        startup_launch: true,
        check_updates: true,
      },
    };
  }
}

// 保存设置
export async function saveSettings() {
  try {
    // 使用@tauri-apps/plugin-fs插件将设置保存到文件
    if (window.__TAURI__ && window.__TAURI__.fs) {
      const {writeTextFile, mkdir, exists, BaseDirectory} = window.__TAURI__.fs;

      // 确保应用配置目录存在
      try {
        // 检查目录是否存在
        const dirExists = await exists("", {
          baseDir: BaseDirectory.AppConfig,
        });
        console.log("应用配置目录存在:", dirExists);

        // 如果目录不存在，创建它
        if (!dirExists) {
          try {
            await mkdir("", {
              baseDir: BaseDirectory.AppConfig,
              recursive: true,
            });
            console.log("应用配置目录创建成功");
          } catch (mkdirError) {
            console.warn("创建目录时出错:", mkdirError);
          }
        }
      } catch (dirError) {
        console.warn("检查目录时出错:", dirError);
      }

      // 在应用配置目录下写入设置文件
      await writeTextFile("settings.json", JSON.stringify(settings, null, 2), {
        baseDir: BaseDirectory.AppConfig,
      });
      console.log("设置保存成功:", settings);
    } else {
      // 在非Tauri环境中，仅打印日志
      console.log("保存设置:", settings);
    }

    // 显示保存成功通知
    import("./ui.js").then(({showNotification}) => {
      showNotification("设置已保存");
    });
  } catch (error) {
    console.error("保存设置时出错:", error);
  }
}

// 更新软件设置
export function updateSoftwareSettings() {
  // 更新开机启动
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.checked = settings.software?.startup_launch ?? true;
  }

  // 更新检查更新
  const checkUpdates = document.getElementById("check-updates");
  if (checkUpdates) {
    checkUpdates.checked = settings.software?.check_updates ?? true;
  }
}

// 更新复制设置
export function updateCopySettings() {
  // 更新去除格式
  const stripFormatting = document.getElementById("strip-formatting");
  if (stripFormatting) {
    stripFormatting.checked = settings.copy?.strip_formatting ?? false;
  }

  // 更新自动复制
  const autoCopy = document.getElementById("auto-copy");
  if (autoCopy) {
    autoCopy.checked = settings.copy?.auto_copy ?? true;
  }

  // 更新选择时复制
  const copyOnSelect = document.getElementById("copy-on-select");
  if (copyOnSelect) {
    copyOnSelect.checked = settings.copy?.copy_on_select ?? false;
  }
}

// 更新界面设置
export function updateInterfaceSettings() {
  // 更新主题
  const theme = document.getElementById("theme");
  if (theme) {
    theme.value = settings.interface?.theme ?? "light";
  }

  // 更新语言
  const language = document.getElementById("language");
  if (language) {
    language.value = settings.interface?.language ?? "cn";
  }

  // 更新自动隐藏
  const autoHide = document.getElementById("auto-hide");
  if (autoHide) {
    autoHide.checked = settings.interface?.auto_hide ?? true;
  }

  // 更新预览大小
  const previewSize = document.getElementById("preview-size");
  if (previewSize) {
    previewSize.value = settings.interface?.preview_size ?? "small";
  }

  // 更新最大历史记录数
  const maxHistoryItems = document.getElementById("max-history-items");
  if (maxHistoryItems) {
    maxHistoryItems.value = settings.interface?.max_history_items ?? 100;
  }
}

// 绑定设置变化监听器
export function bindSettingsListeners() {
  // 监听软件设置变化
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.addEventListener("change", async function () {
      if (!settings.software) settings.software = {};
      settings.software.startup_launch = this.checked;
      await saveSettings();
    });
  }

  const checkUpdates = document.getElementById("check-updates");
  if (checkUpdates) {
    checkUpdates.addEventListener("change", async function () {
      if (!settings.software) settings.software = {};
      settings.software.check_updates = this.checked;
      await saveSettings();
    });
  }

  // 监听复制设置变化
  const stripFormatting = document.getElementById("strip-formatting");
  if (stripFormatting) {
    stripFormatting.addEventListener("change", async function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.strip_formatting = this.checked;
      await saveSettings();
    });
  }

  const autoCopy = document.getElementById("auto-copy");
  if (autoCopy) {
    autoCopy.addEventListener("change", async function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.auto_copy = this.checked;
      await saveSettings();
    });
  }

  const copyOnSelect = document.getElementById("copy-on-select");
  if (copyOnSelect) {
    copyOnSelect.addEventListener("change", async function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.copy_on_select = this.checked;
      await saveSettings();
    });
  }

  // 监听界面设置变化
  const theme = document.getElementById("theme");
  if (theme) {
    theme.addEventListener("change", async function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.theme = this.value;
      await saveSettings();
    });
  }

  const autoHideEl = document.getElementById("auto-hide");
  if (autoHideEl) {
    autoHideEl.addEventListener("change", async function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.auto_hide = this.checked;
      await saveSettings();
    });
  }

  const maxHistoryItems = document.getElementById("max-history-items");
  if (maxHistoryItems) {
    maxHistoryItems.addEventListener("change", async function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.max_history_items = parseInt(this.value);
      await saveSettings();
    });
  }

  const language = document.getElementById("language");
  if (language) {
    language.addEventListener("change", async function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.language = this.value;
      await saveSettings();
    });
  }

  const previewSize = document.getElementById("preview-size");
  if (previewSize) {
    previewSize.addEventListener("change", async function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.preview_size = this.value;
      await saveSettings();
    });
  }
}
