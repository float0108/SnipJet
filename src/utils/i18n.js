// 国际化（i18n）模块
// 支持中文/英文切换，所有前端中文字符串统一管理

const translations = {
  cn: {
    view: {
      favorites: "收藏",
      history: "历史",
      all: "全部",
    },
    action: {
      favorite: "收藏",
      unfavorite: "取消收藏",
      edit: "详情/编辑",
      delete: "删除",
      pasteAsPlainText: "粘贴为纯文本",
      showAll: "显示全部",
      viewFavorites: "查看收藏",
    },
    empty: {
      noFavorites: "暂无收藏内容",
      noFavoritesHint: "点击卡片上的爱心图标收藏内容",
      noHistory: "暂无剪贴板内容",
      noHistoryHint: "复制内容后将显示在这里",
      noFavoritesMatch: "未找到匹配的收藏内容",
      noHistoryMatch: "没有找到匹配的内容",
      // 空状态组件未显式传入文案时使用
      defaultText: "暂无剪贴板内容",
      defaultHint: "复制内容后将显示在这里",
    },
    toast: {
      addedToFavorites: "已添加到收藏",
      removedFromFavorites: "已取消收藏",
    },
    // 主窗口工具栏（按钮 title / aria-label、搜索框 placeholder 等）
    toolbar: {
      pageTitle: "SnipJet - 剪贴板监控",
      viewFavorites: "查看收藏",
      showAll: "显示全部",
      expander: "文本扩展",
      search: "搜索",
      searchPlaceholder: "搜索...",
      searchHistoryAriaLabel: "搜索剪贴板历史",
      closeSearch: "关闭搜索",
      pin: "固定",
      pinWindowAriaLabel: "固定窗口",
      settings: "设置",
      close: "关闭",
      closeWindowAriaLabel: "关闭窗口",
      backToTop: "回到顶部",
    },
    // 状态栏文案
    status: {
      initComplete: "初始化完成",
      initializing: "初始化中...",
      loading: "加载中...",
      mockNoTauri: "使用模拟数据（Tauri未连接）",
      mockLoadFailed: "使用模拟数据（加载失败）",
    },
    // 剪贴板条目相关
    item: {
      // {n} 为字数
      charCount: "{n}字",
      unknownSize: "未知尺寸",
      imageAlt: "剪贴板图片",
      imageLoadFailed: "[图片加载失败]",
      // Tauri 未连接时的模拟条目内容
      mockContent: "暂时没有剪贴板内容...",
    },
    // 剪贴板条目右下角的格式标签
    // text / html / markdown / rtf 是格式简写，两种语言下取同一份值；
    // image / files / custom 是普通文案，按语言翻译
    format: {
      text: "TEXT",
      plain: "TEXT",
      html: "HTML",
      markdown: "MD",
      rtf: "RTF",
      image: "图片",
      files: "文件",
      custom: "自定义",
    },
    // 窗口标题与窗口操作提示
    window: {
      detailTitle: "查看详情",
      openFailed: "无法打开新窗口",
      settingsTitle: "SnipJet 设置",
      expanderTitle: "SnipJet 文本扩展",
    },
    // 主窗口发往查看器窗口的导航提示
    navigation: {
      notFound: "未找到该剪贴板项的完整内容",
      noMoreItems: "没有更多项目可以导航",
      failed: "导航失败，请重试",
    },
    reader: {
      pageTitle: "SnipJet - 内容查看器",
      view: {
        render: "预览",
        text: "纯文本",
        source: "源码",
      },
      close: {
        title: "关闭",
        ariaLabel: "关闭窗口",
      },
      nav: {
        prev: "上一个",
        next: "下一个",
      },
      favorite: {
        add: "添加到收藏",
        remove: "取消收藏",
      },
      // {n} 为字数
      charCount: {
        selected: "已选 {n} 字",
        total: "共 {n} 字",
      },
      unknown: "未知",
      image: {
        alt: "剪贴板图片",
        // {w} 宽，{h} 高
        dimensions: "尺寸: {w} × {h}",
        // {s} 为已格式化的大小文本
        size: "大小: {s}",
        // {error} 为错误信息
        loadFailed: "[图片加载失败: {error}]",
      },
      contentUnavailable: "无法读取内容或内容已过期。",
      saved: "已保存!",
      copied: "已复制!",
      // {error} 为错误信息
      copyFailed: "复制失败: {error}",
      editPrompt: "编辑内容:",
      toast: {
        noItemId: "无法获取条目ID",
        operationFailed: "操作失败，请重试",
        navigateFailed: "导航失败，请重试",
      },
    },
    expander: {
      pageTitle: "SnipJet - 文本扩展",
      filter: {
        title: "按分组筛选",
        ariaLabel: "按分组筛选",
        all: "全部分组",
        // {n} 为规则总数
        allWithCount: "全部分组 ({n})",
      },
      search: {
        placeholder: "搜索触发词...",
        inputAriaLabel: "搜索触发词",
        buttonTitle: "搜索 (Ctrl+F)",
        buttonAriaLabel: "搜索",
        closeAriaLabel: "关闭搜索",
      },
      help: {
        title: "使用说明",
        ariaLabel: "使用说明",
        // 说明条目：strong 为条目标题，desc 为其后的解释文字
        triggerWord: "触发词",
        triggerWordDesc: " - 输入关键词自动触发扩展",
        group: "分组",
        groupDesc: " - 点击标签编辑，用于归类管理",
        confirm: "确认",
        confirmDesc: " - 点击底部确认按钮或 Ctrl+S",
        search: "搜索",
        searchDesc: " - Ctrl+F 打开搜索框",
        esc: "Esc",
        escDesc: " - 取消更改并关闭窗口",
      },
      close: {
        title: "关闭",
        ariaLabel: "关闭窗口",
      },
      cancel: "取消",
      confirm: "确认",
      // 规则卡片
      rule: {
        triggerPlaceholder: "触发词",
        contentPlaceholder: "扩展后的内容",
        confirmAdd: "确认添加",
        delete: "删除",
        groupPlaceholder: "分组名...",
        prefixConflict: "前缀冲突：此触发词可能无法被触发",
      },
      // {name} 为分组名
      createGroup: "创建 \"{name}\"",
      // 空状态
      empty: {
        noMatch: "未找到匹配的规则",
        noMatchHint: "尝试其他搜索关键词",
        noGroupRules: "该分组暂无规则",
        noRules: "暂无文本扩展规则",
        noRulesHint: "在上方空卡片填写触发词与扩展内容，点击 ✔ 即可添加",
      },
      dialog: {
        cancel: "取消",
        confirm: "确定",
      },
      deleteDialog: {
        title: "删除规则",
        message: "确定要删除这条规则吗？",
      },
      discardDialog: {
        title: "放弃更改",
        message: "有未保存的更改，确定要放弃吗？",
      },
      prefixConflictDialog: {
        title: "前缀冲突警告",
        // {keys} 为存在前缀冲突的触发词列表
        message: "以下触发词可能无法被触发：{keys}\n\n这是因为存在更短的前缀触发词。是否仍要保存？",
      },
      toast: {
        deleted: "规则已删除",
        added: "规则已添加",
        required: "触发词和扩展内容不能为空",
        // {keys} 为重复的触发词列表
        duplicateKeys: "发现重复的触发词: {keys}",
        // {error} 为错误信息
        saveFailed: "保存失败: {error}",
      },
    },
    settings: {
      pageTitle: "SnipJet 设置",
      sidebar: {
        ariaLabel: "设置分区",
      },
      // 侧边栏分区名（同时用作顶部分区标题）
      section: {
        general: "常规",
        appearance: "外观",
        shortcuts: "快捷键",
        clipboard: "剪贴板",
        history: "历史记录",
        advanced: "高级",
      },
      // 分区内的分组小标题
      blocks: {
        theme: "主题",
        text: "文字",
        listWindow: "列表与窗口",
        record: "记录",
        pasteFormat: "粘贴格式",
        storageLimit: "存储上限",
        autoCleanup: "自动清理",
        mcp: "MCP 服务",
        performance: "性能",
      },
      close: {
        ariaLabel: "关闭窗口",
      },
      // 下拉框选项显示文字（option 的 value 不随语言变化）
      options: {
        theme: {
          light: "浅色",
          dark: "深色",
          system: "跟随系统",
        },
        font: {
          systemDefault: "系统默认",
          // 次要字体空值（未启用）
          none: "未设置",
          // {name} 为字体名
          missing: "{name}（已不存在）",
        },
        lines: {
          n1: "1 行",
          n2: "2 行",
          n3: "3 行",
          n5: "5 行",
          n8: "8 行",
        },
        chars: {
          n200: "200 字符",
          n400: "400 字符",
          n600: "600 字符",
          n1000: "1000 字符",
          n2000: "2000 字符",
        },
        imageSize: {
          large: "大 (100%)",
          medium: "中 (60%)",
          small: "小 (30%)",
          none: "无 (仅显示元信息)",
        },
        quickPaste: {
          none: "无",
        },
      },
      general: {
        startupLaunch: "开机启动",
        startupLaunchDesc: "启动电脑时自动运行 SnipJet",
        checkUpdates: "自动检查更新",
        language: "界面语言",
      },
      appearance: {
        themeMode: "主题模式",
        primaryColor: "界面主题色",
        primaryColorDesc: "按钮、选中项等界面强调色",
        favoriteColor: "收藏主题色",
        favoriteColorDesc: "收藏视图与卡片的强调色",
        fontFamily: "主要字体",
        fontFamilyDesc: "从系统已安装的字体中选择",
        fontFamilySecondary: "次要字体",
        fontFamilySecondaryDesc: "主要字体缺字形时使用",
        reset: "重置",
        fontSize: "基础字号",
        fontSizeDesc: "取值范围 10 ~ 20，可精确到 0.5",
        zoomLevel: "界面缩放",
        zoomLevelDesc: "等比缩放所有窗口，1 表示原始大小",
        latestPreviewLines: "最新条目预览行数",
        latestPreviewLinesDesc: "最新条目显示的文字行数",
        historyPreviewLines: "历史条目预览行数",
        historyPreviewLinesDesc: "其余条目显示的文字行数",
        previewMaxChars: "预览字符上限",
        previewMaxCharsDesc: "单条预览最多保留的字符数",
        imagePreviewSize: "图片预览大小",
        imagePreviewSizeDesc: "列表中图片缩略图的大小",
        autoHide: "失去焦点隐藏",
      },
      shortcuts: {
        toggleInterface: "显示/隐藏界面",
        functionPaste: "功能粘贴",
        clear: "清空",
        notSet: "未设置",
        placeholderIdle: "按下快捷键...",
        placeholderRecording: "请录制组合键...",
        quickPasteMode: "快捷粘贴修饰键",
        quickPasteModeDesc: "配合数字键 1~9 粘贴对应序数的历史项，选\"无\"可禁用",
        rotatingPaste: "候选粘贴快捷键",
        rotatingPasteDesc: "从第 1 项开始依次轮转粘贴，留空可禁用",
        toastOccupied: "该快捷键已被占用",
      },
      clipboard: {
        autoCopy: "自动监听",
        autoCopyDesc: "剪贴板变化时自动记录",
        stripFormatting: "去除格式",
        stripFormattingDesc: "粘贴时仅保留纯文本",
        usePandoc: "使用 Pandoc 粘贴 Markdown",
        usePandocDesc: "启用后以 Docx 粘贴，禁用则以 HTML 粘贴",
        pandocTemplatePath: "Pandoc 模板路径",
        pandocTemplatePathDesc: "自定义 Docx 模板路径，留空用默认模板",
      },
      history: {
        maxItems: "最大历史条目数",
        maxItemsDesc: "留空不限制，超出时自动清理旧条目",
        maxItemsPlaceholder: "无限制",
        cleanupIntro: "启动时自动清理历史记录（收藏条目除外）。",
        cleanupByCount: "按条数清理",
        cleanupByCountDesc: "超过设定值时，删除最旧的非收藏条目",
        keepCount: "保留条数",
        keepCountDesc: "最多保留的历史条数",
        keepCountPlaceholder: "例如 500",
        cleanupByAge: "按时间清理",
        cleanupByAgeDesc: "删除超过指定天数的条目",
        keepDays: "保留天数",
        keepDaysDesc: "保留最近多少天的记录",
        keepDaysPlaceholder: "例如 30",
      },
      advanced: {
        mcpIntro: "允许 AI 助手（如 Claude）访问并管理剪贴板历史。",
        mcpEnabled: "启用 MCP 服务",
        mcpEnabledDesc: "开启后 AI 助手可访问剪贴板历史",
        mcpPort: "服务端口",
        mcpPortDesc: "MCP 服务的监听端口",
        mcpStatus: "服务状态",
        mcpRunning: "运行中",
        mcpStopped: "未运行",
        searchScanLimit: "搜索扫描上限 (KB)",
        searchScanLimitDesc: "单条内容参与搜索的最大长度，留空用默认 1024 KB",
        searchScanLimitPlaceholder: "1024",
      },
      toast: {
        saved: "设置已保存",
      },
      cancel: "取消",
      confirm: "确定",
    },
  },
  en: {
    view: {
      favorites: "Favorites",
      history: "History",
      all: "All",
    },
    action: {
      favorite: "Favorite",
      unfavorite: "Unfavorite",
      edit: "Details / Edit",
      delete: "Delete",
      pasteAsPlainText: "Paste as Plain Text",
      showAll: "Show All",
      viewFavorites: "View Favorites",
    },
    empty: {
      noFavorites: "No favorites yet",
      noFavoritesHint: "Click the heart icon on a card to add favorites",
      noHistory: "No clipboard history",
      noHistoryHint: "Copied content will appear here",
      noFavoritesMatch: "No matching favorites found",
      noHistoryMatch: "No matching content found",
      // 空状态组件未显式传入文案时使用
      defaultText: "No clipboard history",
      defaultHint: "Copied content will appear here",
    },
    toast: {
      addedToFavorites: "Added to favorites",
      removedFromFavorites: "Removed from favorites",
    },
    // 主窗口工具栏（按钮 title / aria-label、搜索框 placeholder 等）
    toolbar: {
      pageTitle: "SnipJet - Clipboard Monitor",
      viewFavorites: "View Favorites",
      showAll: "Show All",
      expander: "Text Expansion",
      search: "Search",
      searchPlaceholder: "Search...",
      searchHistoryAriaLabel: "Search clipboard history",
      closeSearch: "Close search",
      pin: "Pin",
      pinWindowAriaLabel: "Pin window",
      settings: "Settings",
      close: "Close",
      closeWindowAriaLabel: "Close window",
      backToTop: "Back to top",
    },
    // 状态栏文案
    status: {
      initComplete: "Initialized",
      initializing: "Initializing...",
      loading: "Loading...",
      mockNoTauri: "Using mock data (Tauri not connected)",
      mockLoadFailed: "Using mock data (load failed)",
    },
    // 剪贴板条目相关
    item: {
      // {n} is the character count
      charCount: "{n} chars",
      unknownSize: "Unknown size",
      imageAlt: "Clipboard image",
      imageLoadFailed: "[Failed to load image]",
      // Tauri 未连接时的模拟条目内容
      mockContent: "No clipboard content yet...",
    },
    // 剪贴板条目右下角的格式标签
    // text / html / markdown / rtf 是格式简写，两种语言下取同一份值；
    // image / files / custom 是普通文案，按语言翻译
    format: {
      text: "TEXT",
      plain: "TEXT",
      html: "HTML",
      markdown: "MD",
      rtf: "RTF",
      image: "Image",
      files: "Files",
      custom: "Custom",
    },
    // 窗口标题与窗口操作提示
    window: {
      detailTitle: "Details",
      openFailed: "Unable to open new window",
      settingsTitle: "SnipJet Settings",
      expanderTitle: "SnipJet Text Expansion",
    },
    // 主窗口发往查看器窗口的导航提示
    navigation: {
      notFound: "Unable to get the full content of this clipboard item",
      noMoreItems: "No more items to navigate",
      failed: "Navigation failed, please try again",
    },
    reader: {
      pageTitle: "SnipJet - Content Viewer",
      view: {
        render: "Preview",
        text: "Text",
        source: "Source",
      },
      close: {
        title: "Close",
        ariaLabel: "Close window",
      },
      nav: {
        prev: "Previous",
        next: "Next",
      },
      favorite: {
        add: "Add to favorites",
        remove: "Remove from favorites",
      },
      // {n} is the character count
      charCount: {
        selected: "{n} selected",
        total: "{n} chars",
      },
      unknown: "Unknown",
      image: {
        alt: "Clipboard image",
        // {w} width, {h} height
        dimensions: "Dimensions: {w} × {h}",
        // {s} formatted size text
        size: "Size: {s}",
        // {error} error message
        loadFailed: "[Failed to load image: {error}]",
      },
      contentUnavailable: "Unable to read content or the content has expired.",
      saved: "Saved!",
      copied: "Copied!",
      // {error} error message
      copyFailed: "Copy failed: {error}",
      editPrompt: "Edit content:",
      toast: {
        noItemId: "Unable to get item ID",
        operationFailed: "Operation failed, please try again",
        navigateFailed: "Navigation failed, please try again",
      },
    },
    expander: {
      pageTitle: "SnipJet - Text Expansion",
      filter: {
        title: "Filter by group",
        ariaLabel: "Filter by group",
        all: "All Groups",
        // {n} 为规则总数
        allWithCount: "All Groups ({n})",
      },
      search: {
        placeholder: "Search triggers...",
        inputAriaLabel: "Search triggers",
        buttonTitle: "Search (Ctrl+F)",
        buttonAriaLabel: "Search",
        closeAriaLabel: "Close search",
      },
      help: {
        title: "Help",
        ariaLabel: "Help",
        // 说明条目：strong 为条目标题，desc 为其后的解释文字
        triggerWord: "Trigger",
        triggerWordDesc: " - Type a keyword to trigger an expansion automatically",
        group: "Group",
        groupDesc: " - Click the tag to edit; used to organize rules",
        confirm: "Confirm",
        confirmDesc: " - Click the confirm button at the bottom or press Ctrl+S",
        search: "Search",
        searchDesc: " - Press Ctrl+F to open the search box",
        esc: "Esc",
        escDesc: " - Discard changes and close the window",
      },
      close: {
        title: "Close",
        ariaLabel: "Close window",
      },
      cancel: "Cancel",
      confirm: "Confirm",
      // 规则卡片
      rule: {
        triggerPlaceholder: "Trigger",
        contentPlaceholder: "Expanded content",
        confirmAdd: "Confirm add",
        delete: "Delete",
        groupPlaceholder: "Group name...",
        prefixConflict: "Prefix conflict: this trigger may not be triggered",
      },
      // {name} 为分组名
      createGroup: "Create \"{name}\"",
      // 空状态
      empty: {
        noMatch: "No matching rules found",
        noMatchHint: "Try a different search keyword",
        noGroupRules: "No rules in this group",
        noRules: "No text expansion rules",
        noRulesHint: "Fill in the trigger and expanded content in the empty card above, then click ✔ to add",
      },
      dialog: {
        cancel: "Cancel",
        confirm: "OK",
      },
      deleteDialog: {
        title: "Delete Rule",
        message: "Are you sure you want to delete this rule?",
      },
      discardDialog: {
        title: "Discard Changes",
        message: "You have unsaved changes. Are you sure you want to discard them?",
      },
      prefixConflictDialog: {
        title: "Prefix Conflict Warning",
        // {keys} 为存在前缀冲突的触发词列表
        message: "The following triggers may not be triggered: {keys}\n\nThis is because shorter prefix triggers exist. Save anyway?",
      },
      toast: {
        deleted: "Rule deleted",
        added: "Rule added",
        required: "Trigger and expanded content cannot be empty",
        // {keys} 为重复的触发词列表
        duplicateKeys: "Found duplicate triggers: {keys}",
        // {error} 为错误信息
        saveFailed: "Save failed: {error}",
      },
    },
    settings: {
      pageTitle: "SnipJet Settings",
      sidebar: {
        ariaLabel: "Settings sections",
      },
      // 侧边栏分区名（同时用作顶部分区标题）
      section: {
        general: "General",
        appearance: "Appearance",
        shortcuts: "Shortcuts",
        clipboard: "Clipboard",
        history: "History",
        advanced: "Advanced",
      },
      // 分区内的分组小标题
      blocks: {
        theme: "Theme",
        text: "Text",
        listWindow: "List & Window",
        record: "Recording",
        pasteFormat: "Paste Format",
        storageLimit: "Storage Limit",
        autoCleanup: "Auto Cleanup",
        mcp: "MCP Service",
        performance: "Performance",
      },
      close: {
        ariaLabel: "Close window",
      },
      // 下拉框选项显示文字（option 的 value 不随语言变化）
      options: {
        theme: {
          light: "Light",
          dark: "Dark",
          system: "Follow System",
        },
        font: {
          systemDefault: "System Default",
          // Empty value of the secondary font (not enabled)
          none: "Not set",
          // {name} 为字体名
          missing: "{name} (missing)",
        },
        lines: {
          n1: "1 line",
          n2: "2 lines",
          n3: "3 lines",
          n5: "5 lines",
          n8: "8 lines",
        },
        chars: {
          n200: "200 chars",
          n400: "400 chars",
          n600: "600 chars",
          n1000: "1000 chars",
          n2000: "2000 chars",
        },
        imageSize: {
          large: "Large (100%)",
          medium: "Medium (60%)",
          small: "Small (30%)",
          none: "None (metadata only)",
        },
        quickPaste: {
          none: "None",
        },
      },
      general: {
        startupLaunch: "Launch at Startup",
        startupLaunchDesc: "Run SnipJet automatically when the computer starts",
        checkUpdates: "Automatic Update Check",
        language: "Interface Language",
      },
      appearance: {
        themeMode: "Theme Mode",
        primaryColor: "Accent Color",
        primaryColorDesc: "Accent color for buttons and selected items",
        favoriteColor: "Favorite Accent Color",
        favoriteColorDesc: "Accent color for the favorites view and cards",
        fontFamily: "Primary Font",
        fontFamilyDesc: "Choose from fonts installed on the system",
        fontFamilySecondary: "Secondary Font",
        fontFamilySecondaryDesc: "Used when the primary font lacks a glyph",
        reset: "Reset",
        fontSize: "Base Font Size",
        fontSizeDesc: "Range 10 ~ 20, step 0.5",
        zoomLevel: "Interface Zoom",
        zoomLevelDesc: "Scale all windows proportionally; 1 means the original size",
        latestPreviewLines: "Preview Lines for Latest Item",
        latestPreviewLinesDesc: "Text lines shown for the latest item",
        historyPreviewLines: "Preview Lines for History Items",
        historyPreviewLinesDesc: "Text lines shown for the remaining items",
        previewMaxChars: "Preview Character Limit",
        previewMaxCharsDesc: "Maximum characters kept per preview",
        imagePreviewSize: "Image Preview Size",
        imagePreviewSizeDesc: "Thumbnail size of images in the list",
        autoHide: "Hide When Unfocused",
      },
      shortcuts: {
        toggleInterface: "Show / Hide Interface",
        functionPaste: "Function Paste",
        clear: "Clear",
        notSet: "Not set",
        placeholderIdle: "Press a shortcut...",
        placeholderRecording: "Recording keys...",
        quickPasteMode: "Quick Paste Modifier Key",
        quickPasteModeDesc: "With number keys 1-9 to paste that history item; \"None\" disables it",
        rotatingPaste: "Rotating Paste Shortcut",
        rotatingPasteDesc: "Paste history items in turn starting from the first; leave empty to disable",
        toastOccupied: "This shortcut is already in use",
      },
      clipboard: {
        autoCopy: "Auto Monitor",
        autoCopyDesc: "Record automatically when the clipboard changes",
        stripFormatting: "Strip Formatting",
        stripFormattingDesc: "Paste as plain text only",
        usePandoc: "Use Pandoc to Paste Markdown",
        usePandocDesc: "Paste as Docx when enabled, otherwise as HTML",
        pandocTemplatePath: "Pandoc Template Path",
        pandocTemplatePathDesc: "Custom Docx template path; empty uses the default",
      },
      history: {
        maxItems: "Maximum History Items",
        maxItemsDesc: "Empty means no limit; oldest items are cleaned up automatically",
        maxItemsPlaceholder: "No limit",
        cleanupIntro: "History is cleaned up at startup (favorites are never removed).",
        cleanupByCount: "Clean up by Count",
        cleanupByCountDesc: "Delete the oldest non-favorite items above the threshold",
        keepCount: "Keep Count",
        keepCountDesc: "Maximum number of entries to keep",
        keepCountPlaceholder: "e.g. 500",
        cleanupByAge: "Clean up by Age",
        cleanupByAgeDesc: "Delete items older than the given number of days",
        keepDays: "Keep Days",
        keepDaysDesc: "How many recent days to keep",
        keepDaysPlaceholder: "e.g. 30",
      },
      advanced: {
        mcpIntro: "Let AI assistants (such as Claude) access and manage your clipboard history.",
        mcpEnabled: "Enable MCP Service",
        mcpEnabledDesc: "AI assistants can access clipboard history when enabled",
        mcpPort: "Service Port",
        mcpPortDesc: "Listening port of the MCP service",
        mcpStatus: "Service Status",
        mcpRunning: "Running",
        mcpStopped: "Not running",
        searchScanLimit: "Search Scan Limit (KB)",
        searchScanLimitDesc: "Maximum length of an item included in search; empty uses 1024 KB",
        searchScanLimitPlaceholder: "1024",
      },
      toast: {
        saved: "Settings saved",
      },
      cancel: "Cancel",
      confirm: "OK",
    },
  },
};

// 当前语言设置（默认英语，用户可在设置里切换）
let _currentLocale = "en";

// 语言 -> <html lang> 取值（供无障碍与浏览器断词使用）
const HTML_LANG = { cn: "zh-CN", en: "en" };

// 同步 <html lang>
function syncHtmlLang() {
  document.documentElement.lang = HTML_LANG[_currentLocale] || HTML_LANG.cn;
}

// 获取当前翻译
function getTranslations() {
  return translations[_currentLocale] || translations.cn;
}

// 获取翻译后的字符串
export function t(key) {
  const trans = getTranslations();
  const keys = key.split(".");
  let value = trans;
  for (const k of keys) {
    value = value?.[k];
  }
  return value ?? key;
}

// 获取当前语言设置
export function getLocale() {
  return _currentLocale;
}

// 设置语言
export function setLocale(locale) {
  if (translations[locale]) {
    _currentLocale = locale;
    syncHtmlLang();
  }
}

// 把 HTML 中 data-i18n* 标注的静态文案替换为当前语言，并同步 <html lang>。
// 支持：data-i18n（文本）、data-i18n-title、data-i18n-aria-label、data-i18n-placeholder
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  const attrMap = {
    "data-i18n-title": "title",
    "data-i18n-aria-label": "aria-label",
    "data-i18n-placeholder": "placeholder",
  };
  Object.entries(attrMap).forEach(([dataAttr, attr]) => {
    root.querySelectorAll(`[${dataAttr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(dataAttr)));
    });
  });

  syncHtmlLang();
}

// 从 localStorage 加载语言设置
export function loadLocaleFromSettings() {
  try {
    const saved = localStorage.getItem("snipjet-settings");
    if (saved) {
      const settings = JSON.parse(saved);
      const lang = settings?.interface?.language;
      if (lang && translations[lang]) {
        _currentLocale = lang;
      }
    }
  } catch (e) {
    // ignore
  }
  syncHtmlLang();
}

// 快捷访问别名
export { t as i18n };